// Prepares the website's pictures and trailer in web/public/media from the game's press kit and art.
//
//   node site/build-media.mjs            (from web/; needs ffmpeg on the PATH)
//
// Inputs:  ../Release/Press/*.jpg, ../Release/Clay-Per-View-Trailer.mp4 and its .srt captions,
//          ../ClayPerView/Art/Export/Portraits/*.png, public/favicon.svg
// Outputs: cast portraits and the title belt (WebP with transparency), the press stills and key art in
//          three widths, the share card, the trailer at 720p with a poster and WebVTT captions.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import sharp from 'sharp';

const run = promisify(execFile);
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(WEB, '..');
const PRESS = path.join(ROOT, 'Release', 'Press');
const PORTRAITS = path.join(ROOT, 'ClayPerView', 'Art', 'Export', 'Portraits');
const TRAILER = path.join(ROOT, 'Release', 'Clay-Per-View-Trailer.mp4');
const OUT = path.join(WEB, 'public', 'media');
const want = (group) => process.argv.length <= 2 || process.argv.includes(group);

const CAST = ['Rex', 'Lola', 'Bruno', 'Chip', 'Wubz', 'Duchess', 'Vince', 'Mystica'];
const STILLS = [
  ['01-Arena', 'arena'],
  ['02-Casting', 'casting'],
  ['03-Studio-clapperboard', 'clapperboard'],
  ['04-Three-count', 'three-count'],
  ['05-Mic-drop', 'mic-drop'],
  ['06-Title-belt', 'title-belt'],
];
const WIDTHS = [640, 960, 1600];

async function images() {
  await fs.mkdir(path.join(OUT, 'cast'), { recursive: true });
  await fs.mkdir(path.join(OUT, 'shots'), { recursive: true });

  for (const id of CAST) {
    for (const size of [256, 512]) {
      await sharp(path.join(PORTRAITS, `P_${id}.png`))
        .resize(size, size)
        .webp({ quality: 80, alphaQuality: 90, effort: 6 })
        .toFile(path.join(OUT, 'cast', `${id.toLowerCase()}-${size}.webp`));
    }
  }

  // The belt render has wide empty margins; trim them so the picture can be sized by its own edges.
  const belt = await sharp(path.join(PORTRAITS, 'P_TitleBelt.png')).trim().toBuffer();
  for (const width of [640, 1200]) {
    await sharp(belt).resize({ width }).webp({ quality: 82, alphaQuality: 92, effort: 6 }).toFile(path.join(OUT, `belt-${width}.webp`));
  }

  for (const [file, name] of [...STILLS, ['Key-art', 'key-art']]) {
    const dir = name === 'key-art' ? OUT : path.join(OUT, 'shots');
    for (const width of WIDTHS) {
      await sharp(path.join(PRESS, `${file}.jpg`))
        .resize({ width })
        .webp({ quality: width > 1000 ? 76 : 70, effort: 6 })
        .toFile(path.join(dir, `${name}-${width}.webp`));
    }
  }

  // Link previews want a 1200x630 JPEG.
  await sharp(path.join(PRESS, 'Key-art.jpg'))
    .resize(1200, 630, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(path.join(OUT, 'share.jpg'));

  const icon = await fs.readFile(path.join(WEB, 'public', 'favicon.svg'));
  await sharp(icon, { density: 400 }).resize(180, 180).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'apple-touch-icon.png'));
}

function toVtt(srt) {
  const cues = srt
    .replace(/\r/g, '')
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.split('\n').filter((line, i) => !(i === 0 && /^\d+$/.test(line))))
    .map((lines) => [lines[0].replace(/,/g, '.'), ...lines.slice(1)].join('\n'));
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

async function trailer() {
  await fs.mkdir(OUT, { recursive: true });
  await run('ffmpeg', [
    '-v', 'error', '-y', '-i', TRAILER, '-map', '0:v:0', '-map', '0:a:0', '-sn', '-map_metadata', '-1',
    '-vf', 'scale=1280:720:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryslow', '-profile:v', 'high', '-level', '4.0', '-crf', '26', '-maxrate', '1500k', '-bufsize', '3000k', '-g', '60',
    '-c:a', 'aac', '-b:a', '112k', '-ac', '2', '-ar', '48000', '-movflags', '+faststart',
    path.join(OUT, 'trailer-720.mp4'),
  ]);

  // Poster: the "versus" card.
  const frame = path.join(os.tmpdir(), `cpv-poster-${process.pid}.png`);
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', '13.2', '-i', TRAILER, '-frames:v', '1', frame]);
  await sharp(frame).resize({ width: 1280 }).webp({ quality: 78, effort: 6 }).toFile(path.join(OUT, 'trailer-poster.webp'));
  await fs.rm(frame, { force: true });

  for (const lang of ['en', 'pt-BR']) {
    const srt = await fs.readFile(path.join(PRESS, `Trailer-${lang}.srt`), 'utf8');
    await fs.writeFile(path.join(OUT, `trailer-${lang}.vtt`), toVtt(srt));
  }
}

if (want('images')) await images();
if (want('trailer')) await trailer();

let total = 0;
const list = async (dir) => {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await list(full);
    else total += (await fs.stat(full)).size;
  }
};
await list(OUT);
console.log(`media: ${(total / 1048576).toFixed(1)} MB in ${path.relative(process.cwd(), OUT) || OUT}`);
