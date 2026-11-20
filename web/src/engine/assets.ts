// Loads everything under assets/ (built by tools/build-assets.mjs) and hands it out by Unreal asset name.

import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Mesh,
  NoColorSpace,
  RepeatWrapping,
  SkinnedMesh,
  SphereGeometry,
  Texture,
  TextureLoader,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { FQuat, FVector } from './ue';

export interface FStaticMeshAsset {
  Name: string;
  Geometry: BufferGeometry;
  /** One entry per geometry group: M_Clay, M_Glow, M_Crowd or M_Sign. */
  Materials: string[];
}

export interface FSkeletalMeshAsset extends FStaticMeshAsset {
  BoneNames: string[];
  BoneInverses: Matrix4[];
  /** Reference pose in Unreal component space. */
  RefPose: Map<string, { Pos: FVector; Rot: FQuat }>;
  /** Top of the head when standing, in cm. */
  Height: number;
}

interface FModelEntry {
  group: string;
  materials: string[];
  skeletal?: boolean;
  bones?: Record<string, number[]>;
  height?: number;
}

export interface FAudioIndex {
  packs: string[];
  loops: string[];
  loopPad: number;
  /** name -> [pack, byte offset, byte length, seconds] */
  clips: Record<string, [number, number, number, number]>;
}

const FONT_FILES: Array<[string, string]> = [
  ['CpvTitle', 'TitanOne-Regular'],
  ['CpvImpact', 'Anton-Regular'],
  ['CpvComic', 'Bangers-Regular'],
  ['CpvBold', 'BarlowCondensed-Bold'],
  ['CpvBoldItalic', 'BarlowCondensed-BoldItalic'],
  ['CpvExtraItalic', 'BarlowCondensed-ExtraBoldItalic'],
  ['CpvSemi', 'BarlowCondensed-SemiBold'],
  ['CpvMedium', 'BarlowCondensed-Medium'],
];

const IMAGE_NAMES = ['P_Bruno', 'P_Chip', 'P_Dirk', 'P_Duchess', 'P_Lola', 'P_Mystica', 'P_Nigel', 'P_Ref', 'P_Rex', 'P_TitleBelt', 'P_Vince', 'P_Wubz'];
const DATA_NAMES = ['arena_layout', 'commentary', 'announcer', 'captions_pt_BR'];

/** "/Game/CPV/Props/SM_Chair.SM_Chair" -> "SM_Chair" (plain names pass through). */
export function AssetName(Path: string): string {
  const Dot = Path.lastIndexOf('.');
  const Slash = Path.lastIndexOf('/');
  return Path.slice(Math.max(Dot, Slash) + 1);
}

class FAssets {
  Base = new URL('../assets/', document.baseURI).href;
  StaticMeshes = new Map<string, FStaticMeshAsset>();
  SkeletalMeshes = new Map<string, FSkeletalMeshAsset>();
  Images = new Map<string, HTMLImageElement>();
  Data = new Map<string, any>();
  ClayNormal!: Texture;
  ClayDetail!: Texture;
  AudioIndex!: FAudioIndex;
  /** Raw pack files; the voice pack arrives after start-up. */
  AudioPacks: Array<ArrayBuffer | null> = [];
  AudioPackReady: Array<Promise<ArrayBuffer>> = [];

  StaticMesh(Path: string): FStaticMeshAsset | null {
    return this.StaticMeshes.get(AssetName(Path)) ?? null;
  }
  SkeletalMesh(Path: string): FSkeletalMeshAsset | null {
    return this.SkeletalMeshes.get(AssetName(Path)) ?? null;
  }
  Image(Name: string): HTMLImageElement | null {
    return this.Images.get(Name) ?? null;
  }
  Json<T = any>(Name: string): T {
    return this.Data.get(Name) as T;
  }

  /** Loads everything the game needs before the title screen. Progress runs from 0 to 1. */
  async Load(OnProgress: (Fraction: number, What: string) => void): Promise<void> {
    const Index = (await (await fetch(this.Base + 'models.json')).json()) as Record<string, FModelEntry>;
    const Names = Object.keys(Index);
    let Done = 0;
    const Total = Names.length + IMAGE_NAMES.length + DATA_NAMES.length + FONT_FILES.length + 4;
    const Step = (What: string) => OnProgress(++Done / Total, What);

    const Loader = new GLTFLoader();
    Loader.setMeshoptDecoder(MeshoptDecoder);
    const LoadModel = async (Name: string) => {
      const Gltf = await Loader.loadAsync(`${this.Base}models/${Name}.glb`);
      this.AddModel(Name, Index[Name], Gltf.scene);
      Step('models');
    };
    const Textures = new TextureLoader();
    const LoadTexture = async (File: string) => {
      const Tex = await Textures.loadAsync(`${this.Base}images/${File}.webp`);
      Tex.wrapS = Tex.wrapT = RepeatWrapping;
      Tex.flipY = false;
      Tex.colorSpace = NoColorSpace;
      Tex.anisotropy = 4;
      Step('textures');
      return Tex;
    };
    const LoadImage = async (Name: string) => {
      const Img = new Image();
      Img.src = `${this.Base}images/${Name}.webp`;
      await Img.decode();
      this.Images.set(Name, Img);
      Step('portraits');
    };
    const LoadData = async (Name: string) => {
      this.Data.set(Name, await (await fetch(`${this.Base}data/${Name}.json`)).json());
      Step('data');
    };
    const LoadFont = async ([Family, File]: [string, string]) => {
      const Face = new FontFace(Family, `url(${this.Base}fonts/${File}.woff2)`);
      document.fonts.add(await Face.load());
      Step('fonts');
    };
    const LoadAudio = async () => {
      this.AudioIndex = (await (await fetch(`${this.Base}audio/audio.json`)).json()) as FAudioIndex;
      this.AudioPacks = this.AudioIndex.packs.map(() => null);
      this.AudioPackReady = this.AudioIndex.packs.map(async (File, i) => {
        const Buffer = await (await fetch(`${this.Base}audio/${File}`)).arrayBuffer();
        this.AudioPacks[i] = Buffer;
        return Buffer;
      });
      Step('sound');
      await this.AudioPackReady[0]; // effects and music; the voices carry on loading behind the title screen
      Step('sound');
    };

    // A few at a time keeps the progress bar honest and the connection pool calm.
    const Queue = [...Names];
    const Workers = Array.from({ length: 6 }, async () => {
      for (let Name = Queue.shift(); Name !== undefined; Name = Queue.shift()) { await LoadModel(Name); }
    });
    const [Normal, Detail] = await Promise.all([
      LoadTexture('T_ClayNormal'),
      LoadTexture('T_ClayDetail'),
      LoadAudio(),
      ...Workers,
      ...IMAGE_NAMES.map(LoadImage),
      ...DATA_NAMES.map(LoadData),
      ...FONT_FILES.map(LoadFont),
    ]);
    this.ClayNormal = Normal as Texture;
    this.ClayDetail = Detail as Texture;
    this.AddEngineShapes();
  }

  private AddModel(Name: string, Entry: FModelEntry, Scene: { updateMatrixWorld(force: boolean): void; traverse(fn: (o: any) => void): void }): void {
    Scene.updateMatrixWorld(true);
    const Parts: Mesh[] = [];
    Scene.traverse((Obj) => { if ((Obj as Mesh).isMesh) { Parts.push(Obj as Mesh); } });
    if (Parts.length === 0) { throw new Error(`${Name}: no geometry`); }
    const Geometries = Parts.map((Part) => {
      const G = Part.geometry;
      // Vertex colours are the clay colour (sRGB) with roughness in alpha; the shaders read them raw.
      if (G.hasAttribute('color')) {
        G.setAttribute('aClay', G.getAttribute('color'));
        G.deleteAttribute('color');
      }
      if (!Entry.skeletal) { BakePositions(G, Part.matrixWorld); }
      return G;
    });
    const Geometry = Geometries.length === 1 ? Geometries[0] : mergeGeometries(Geometries, true);
    if (!Geometry) { throw new Error(`${Name}: parts do not match`); }
    Geometry.computeBoundingBox();
    Geometry.computeBoundingSphere();
    const Materials = Parts.map((Part) => (Part.material as { name: string }).name);
    if (!Entry.skeletal) {
      this.StaticMeshes.set(Name, { Name, Geometry, Materials });
      return;
    }
    const Skeleton = (Parts[0] as SkinnedMesh).skeleton;
    const RefPose = new Map<string, { Pos: FVector; Rot: FQuat }>();
    for (const [Bone, V] of Object.entries(Entry.bones ?? {})) {
      RefPose.set(Bone, { Pos: new FVector(V[0], V[1], V[2]), Rot: new FQuat(V[3], V[4], V[5], V[6]) });
    }
    this.SkeletalMeshes.set(Name, {
      Name,
      Geometry,
      Materials,
      BoneNames: Skeleton.bones.map((Bone) => Bone.name),
      BoneInverses: Skeleton.boneInverses.map((M) => M.clone()),
      RefPose,
      Height: Entry.height ?? 180,
    });
  }

  /** Stand-ins for the two engine meshes the game borrows: a 1 m plane and a 1 m sphere. */
  private AddEngineShapes(): void {
    // Unreal's Plane lies flat (normal +Z) with U along X and V along Y.
    const Plane = new BufferGeometry();
    Plane.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5]), 3));
    Plane.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    Plane.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
    Plane.setIndex([0, 2, 1, 1, 2, 3]);
    Plane.computeBoundingSphere();
    this.StaticMeshes.set('Plane', { Name: 'Plane', Geometry: Plane, Materials: ['M_Screen'] });
    const Sphere = new SphereGeometry(0.5, 10, 8);
    this.StaticMeshes.set('Sphere', { Name: 'Sphere', Geometry: Sphere, Materials: ['M_Flash'] });
  }
}

/** Turns quantized positions into plain floats in the mesh's own space (the node carried the scale). */
function BakePositions(Geometry: BufferGeometry, Matrix: Matrix4): void {
  const Source = Geometry.getAttribute('position');
  const Out = new Float32Array(Source.count * 3);
  const V = new Vector3();
  for (let i = 0; i < Source.count; ++i) {
    V.fromBufferAttribute(Source, i).applyMatrix4(Matrix);
    Out[i * 3] = V.x;
    Out[i * 3 + 1] = V.y;
    Out[i * 3 + 2] = V.z;
  }
  Geometry.setAttribute('position', new BufferAttribute(Out, 3));
}

export const Assets = new FAssets();
