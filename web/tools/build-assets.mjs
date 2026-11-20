// Builds web/public/assets from the Unreal project's art.
//
//   node tools/build-assets.mjs [models] [images] [fonts] [audio] [data]     (no arguments = everything)
//
// Inputs (all inside ../ClayPerView):
//   Saved/WebExport/*.glb + manifest.json   written by Scripts/export_web.py (Unreal's glTF exporter)
//   Art/Export/Portraits, Art/Export/Textures, Art/Fonts, Art/Audio, Content/CPV/Data
//
// Models keep Unreal's vertex data but are slimmed for the browser: tangents and unused UV sets are
// dropped, skin weights are cut to the four strongest bones, positions and normals are quantized and the
// buffers are meshopt-compressed. The reference skeleton of every character is written to models.json in
// Unreal's coordinates, because the pose code in src/game/CpvPose.ts works in them.
// Audio is encoded to MP3 and concatenated into two pack files with a byte-range index.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { Matrix4, Quaternion, Vector3 } from 'three';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..');
const GAME = path.resolve(WEB, '..', 'ClayPerView');
const OUT = path.join(WEB, 'public', 'assets');
const want = (group) => process.argv.length <= 2 || process.argv.includes(group);

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

async function dirSize(dir) {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(full) : (await fs.stat(full)).size;
  }
  return total;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')}\n${err}`))));
  });
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

// ----------------------------------------------------------------------------------------------------
// Models
// ----------------------------------------------------------------------------------------------------

/** Keeps the four strongest of up to eight bone influences per vertex. */
function reduceInfluences(doc, prim) {
  const j0 = prim.getAttribute('JOINTS_0');
  const w0 = prim.getAttribute('WEIGHTS_0');
  const j1 = prim.getAttribute('JOINTS_1');
  const w1 = prim.getAttribute('WEIGHTS_1');
  if (!j0 || !w0) return;
  const count = j0.getCount();
  const joints = new Uint8Array(count * 4);
  const weights = new Float32Array(count * 4);
  const a = [0, 0, 0, 0];
  const b = [0, 0, 0, 0];
  for (let i = 0; i < count; ++i) {
    const pairs = [];
    j0.getElement(i, a);
    w0.getElement(i, b);
    for (let k = 0; k < 4; ++k) pairs.push([a[k], b[k]]);
    if (j1 && w1) {
      j1.getElement(i, a);
      w1.getElement(i, b);
      for (let k = 0; k < 4; ++k) pairs.push([a[k], b[k]]);
    }
    pairs.sort((x, y) => y[1] - x[1]);
    let sum = 0;
    for (let k = 0; k < 4; ++k) sum += pairs[k][1];
    for (let k = 0; k < 4; ++k) {
      const w = sum > 0 ? pairs[k][1] / sum : k === 0 ? 1 : 0;
      joints[i * 4 + k] = w > 0 ? pairs[k][0] : 0;
      weights[i * 4 + k] = w;
    }
  }
  const buffer = doc.getRoot().listBuffers()[0];
  prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));
  prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
  prim.setAttribute('JOINTS_1', null);
  prim.setAttribute('WEIGHTS_1', null);
}

/** Reference pose of every bone in Unreal component space: [x, y, z (cm), qx, qy, qz, qw]. */
function referencePose(skin) {
  const ibm = skin.getInverseBindMatrices();
  const bones = {};
  const m = new Matrix4();
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  const raw = new Array(16);
  skin.listJoints().forEach((joint, i) => {
    ibm.getElement(i, raw);
    m.fromArray(raw).invert().decompose(p, q, s);
    // glTF is right-handed with Y up, in metres; Unreal is left-handed with Z up, in centimetres.
    bones[joint.getName()] = [p.x * 100, p.z * 100, p.y * 100, -q.x, -q.z, -q.y, q.w].map((v) => +v.toFixed(5));
  });
  return bones;
}

async function buildModels() {
  const source = path.join(GAME, 'Saved', 'WebExport');
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
  const dest = path.join(OUT, 'models');
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  const index = {};
  let before = 0;
  let verts = 0;
  for (const name of Object.keys(manifest).sort()) {
    const info = manifest[name];
    const file = path.join(source, `${name}.glb`);
    before += (await fs.stat(file)).size;
    const doc = await io.read(file);
    const root = doc.getRoot();
    const crowd = name.startsWith('SM_Crowd');
    const entry = { group: info.group, materials: [] };

    for (const mesh of root.listMeshes()) {
      mesh.listPrimitives().forEach((prim, i) => {
        // Unreal's slot names decide the shader: "Glow" slots are emissive, the rest is clay.
        const slot = info.slots[i] ?? '';
        const assigned = info.materials[i] ?? '';
        const material = /^M_(Crowd|Sign)$/.test(assigned) ? assigned : slot.includes('Glow') ? 'M_Glow' : 'M_Clay';
        prim.setMaterial(doc.createMaterial(material));
        entry.materials.push(material);
        for (const semantic of prim.listSemantics()) {
          const drop = semantic === 'TANGENT' || (/^TEXCOORD_[1-9]/.test(semantic) && !crowd);
          if (drop) prim.setAttribute(semantic, null);
        }
        reduceInfluences(doc, prim);
        verts += prim.getAttribute('POSITION').getCount();
      });
    }
    if (info.skeletal) {
      entry.skeletal = true;
      entry.bones = referencePose(root.listSkins()[0]);
      entry.height = +(info.origin[2] + info.extent[2]).toFixed(3);
    }

    await doc.transform(
      prune({ keepAttributes: true }),   // the materials here carry no textures, but the game's shaders do use the UVs
      reorder({ encoder: MeshoptEncoder }),
      quantize({ pattern: /^(POSITION|NORMAL|COLOR_0|JOINTS_0|WEIGHTS_0)$/, quantizePosition: 14, quantizeNormal: 8, quantizeWeight: 8 }),
    );
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    await io.write(path.join(dest, `${name}.glb`), doc);
    index[name] = entry;
  }
  await fs.writeFile(path.join(OUT, 'models.json'), JSON.stringify(index));
  console.log(`models: ${Object.keys(index).length} meshes, ${verts} vertices, ${kb(before)} -> ${kb(await dirSize(dest))}`);
}

// ----------------------------------------------------------------------------------------------------
// Images and fonts
// ----------------------------------------------------------------------------------------------------

async function buildImages() {
  const dest = path.join(OUT, 'images');
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  const portraits = path.join(GAME, 'Art', 'Export', 'Portraits');
  for (const file of (await fs.readdir(portraits)).filter((f) => f.endsWith('.png'))) {
    await sharp(path.join(portraits, file)).webp({ quality: 90, alphaQuality: 95 }).toFile(path.join(dest, file.replace('.png', '.webp')));
  }
  // Tiling clay maps: thumbprint normals (RGB) and a mask texture (R roughness, G mottle, B cavity).
  const textures = path.join(GAME, 'Art', 'Export', 'Textures');
  for (const file of (await fs.readdir(textures)).filter((f) => f.endsWith('.png'))) {
    await sharp(path.join(textures, file)).webp({ quality: 92 }).toFile(path.join(dest, file.replace('.png', '.webp')));
  }
  console.log(`images: ${kb(await dirSize(dest))}`);
}

async function buildFonts() {
  const dest = path.join(OUT, 'fonts');
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  const source = path.join(GAME, 'Art', 'Fonts');
  let compress = null;
  try {
    compress = (await import('wawoff2')).default.compress;
  } catch {
    console.log('fonts: wawoff2 is not installed, copying TTF files as they are');
  }
  for (const file of await fs.readdir(source)) {
    if (file.endsWith('.txt')) await fs.copyFile(path.join(source, file), path.join(dest, file));
    if (!file.endsWith('.ttf')) continue;
    const data = await fs.readFile(path.join(source, file));
    if (compress) await fs.writeFile(path.join(dest, file.replace('.ttf', '.woff2')), await compress(data));
    else await fs.writeFile(path.join(dest, file), data);
  }
  console.log(`fonts: ${kb(await dirSize(dest))}`);
}

// ----------------------------------------------------------------------------------------------------
// Audio
// ----------------------------------------------------------------------------------------------------

const LOOPS = ['Music_Fight', 'Music_Menu', 'Crowd_Loop'];
const LOOP_PAD = 0.3; // seconds of wrapped-around audio on each side of a loop, see src/engine/audio.ts

async function buildAudio() {
  const source = path.join(GAME, 'Art', 'Audio');
  const dest = path.join(OUT, 'audio');
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cpv-audio-'));
  const names = (await fs.readdir(source)).filter((f) => f.endsWith('.wav')).map((f) => f.slice(0, -4)).sort();

  const encoded = await pool(names, os.cpus().length, async (name) => {
    const input = path.join(source, `${name}.wav`);
    const output = path.join(temp, `${name}.mp3`);
    const duration = parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input]));
    const voice = name.startsWith('VO_');
    const loop = LOOPS.includes(name);
    const args = ['-v', 'error', '-y', '-i', input];
    if (loop) {
      // MP3 decoders add a little silence at the start and end, which would click at the loop point.
      // The loop is encoded with its own tail in front and its own head behind, and the player loops a
      // window inside that, so wherever the decoder's padding falls the loop stays seamless.
      args.push(
        '-filter_complex',
        `[0]atrim=start=${duration - LOOP_PAD},asetpts=PTS-STARTPTS[a];[0]atrim=end=${LOOP_PAD},asetpts=PTS-STARTPTS[c];[a][0][c]concat=n=3:v=0:a=1`,
      );
    }
    args.push('-ac', '1', '-codec:a', 'libmp3lame');
    if (voice) args.push('-ar', '32000', '-b:a', '48k');
    else args.push('-ar', '44100', '-b:a', loop ? '128k' : '96k');
    args.push(output);
    await run('ffmpeg', args);
    return { name, voice, loop, duration, data: await fs.readFile(output) };
  });
  await fs.rm(temp, { recursive: true, force: true });

  const packs = ['sfx.pack', 'vo.pack'];
  const chunks = [[], []];
  const offsets = [0, 0];
  const clips = {};
  for (const clip of encoded) {
    const p = clip.voice ? 1 : 0;
    clips[clip.name] = [p, offsets[p], clip.data.length, +clip.duration.toFixed(4)];
    chunks[p].push(clip.data);
    offsets[p] += clip.data.length;
  }
  for (let p = 0; p < packs.length; ++p) await fs.writeFile(path.join(dest, packs[p]), Buffer.concat(chunks[p]));
  await fs.writeFile(path.join(dest, 'audio.json'), JSON.stringify({ packs, loops: LOOPS, loopPad: LOOP_PAD, clips }));
  console.log(`audio: ${names.length} clips, sfx ${kb(offsets[0])}, voices ${kb(offsets[1])}`);
}

// ----------------------------------------------------------------------------------------------------
// Data
// ----------------------------------------------------------------------------------------------------

async function buildData() {
  const dest = path.join(OUT, 'data');
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  const source = path.join(GAME, 'Content', 'CPV', 'Data');
  for (const file of (await fs.readdir(source)).filter((f) => f.endsWith('.json'))) {
    const json = JSON.parse(await fs.readFile(path.join(source, file), 'utf8'));
    await fs.writeFile(path.join(dest, file), JSON.stringify(json));
  }
  console.log(`data: ${kb(await dirSize(dest))}`);
}

await fs.mkdir(OUT, { recursive: true });
if (want('models')) await buildModels();
if (want('images')) await buildImages();
if (want('fonts')) await buildFonts();
if (want('audio')) await buildAudio();
if (want('data')) await buildData();
console.log(`assets: ${kb(await dirSize(OUT))} in ${path.relative(process.cwd(), OUT) || OUT}`);
