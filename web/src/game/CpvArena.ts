// Port of CpvArena.h / CpvArena.cpp and the tape half of CpvReplay.cpp: the venue. Ring, ropes, stands,
// crowd, lights, video screens - everything is assembled from the exported layout.
//
// The logic (layout, seat loop, rope springs, light moods, crowd energy, the replay tape) follows the C++
// line for line. What differs is how the light reaches the picture, because a browser cannot afford
// thirty-seven shadowless spotlights per pixel the way the desktop renderer can:
//   - The ring's key lights, the centre stage boost and the flash are real three.js lights. Each key
//     light stands for a pair of the desktop game's lamps (one of each pair cast shadows there, so here
//     each casts at half strength).
//   - The stage spots, the outer boosts, the fill lights and (on the highest lighting setting) the wash
//     lights are the "stadium" list in the clay shader: diffuse only, no shadows.
//   - The crowd is lit per spectator on the CPU, a slice of the house per frame, from every lamp.
//   - What the desktop game got from global illumination is put back by hand: a soft upward light over the
//     lit mat, a glow from the ring and from the stage that reaches the stands, and a little light from
//     everywhere. Their strengths were set by matching frames of the desktop game.

import {
  Color,
  HemisphereLight,
  InstancedBufferAttribute,
  PointLight,
  SpotLight,
  Texture,
  WebGLRenderTarget,
} from 'three';

import { Assets } from '../engine/assets';
import { FCanvasTarget } from '../engine/canvas';
import { CM, ToVector3 } from '../engine/convert';
import { MAX_STADIUM_LIGHTS, Shared, UMaterialInstanceDynamic } from '../engine/materials';
import { FParse, Log } from '../engine/platform';
import { GRenderer } from '../engine/render';
import { FLinearColor, FMath, FQuat, FRandomStream, FRotationMatrix, FRotator, FTransform, FVector, UE_PI, UE_TWO_PI } from '../engine/ue';
import { AActor, AddToScene, UInstancedStaticMeshComponent, UStaticMeshComponent } from '../engine/world';
import { CpvUi, ECpvAlign, ECpvFont } from './CpvUi';

export enum ECpvLightMood {
  House,    // menus: everything up a little
  Show,     // the fight: bright ring, dim colourful crowd
  Entrance, // ring dimmed, stage and beams hot
  Drama,    // finisher: ring in a tight pool of light
}

interface FSeat { Pos: FVector; Yaw: number; Tier: number }
interface FScreen { Name: string; Center: FVector; Normal: FVector; Width: number; Height: number }
interface FLightSpec { Pos: FVector; Dir: FVector; Kind: string }

/** One lamp of the rig as the lighting maths sees it (Unreal units and axes). */
interface FRigLight {
  Pos: FVector;
  Dir: FVector;        // unit; unused for point lights
  CosInner: number;
  CosOuter: number;    // -2 for a point light
  Radius: number;      // attenuation radius, cm
  Colour: FLinearColor;
  Candelas: number;    // at level 1
}

/** A batch of spectators drawn together, with the light each one receives. */
interface FCrowdPart {
  Comp: UInstancedStaticMeshComponent;
  Count: number;
  Keep: number;              // how many are never thinned out (floor seats, sign holders)
  At: Float32Array;          // chest position of each, cm (x, y, z)
  Static: Float32Array;      // per spectator, three groups (key, stage, fill) of: rgb lux, xyz lux-weighted direction
  Light: InstancedBufferAttribute;
  Dir: InstancedBufferAttribute;
}

function ReadVec(Obj: any, Field: string): FVector {
  const A = Obj ? Obj[Field] : null;
  return Array.isArray(A) && A.length >= 3 ? new FVector(A[0], A[1], A[2]) : FVector.ZeroVector;
}

function Srgb(R: number, G: number, B: number): FLinearColor { return FLinearColor.FromSrgb(R, G, B); }

function Cos(Degrees: number): number { return Math.cos(FMath.DegreesToRadians(Degrees)); }

/**
 * The colour a lamp really has. The C++ hands the engine its light colours with "not sRGB", which stores
 * the numbers as an 8-bit colour that the renderer then reads back as sRGB - so every lamp is deeper and
 * more saturated than the figures in the code suggest (the fill, written 0.5 / 0.62 / 1, is a strong blue).
 */
function Lamp(R: number, G: number, B: number): FLinearColor {
  return FLinearColor.FromSrgb(FMath.Clamp(Math.round(R * 255), 0, 255), FMath.Clamp(Math.round(G * 255), 0, 255), FMath.Clamp(Math.round(B * 255), 0, 255));
}

// Base light strengths in candelas; moods scale these.
const KeyCandelas = 30000;
const StageCandelas = 9000;
const WashCandelas = 16000;
const FillCandelas = 20000;

const RopeSegments = 16;
const TapeCapacity = 48;

// How much of the crowd is drawn at each Effects setting (floor seats always are).
const CrowdDensities = [0.45, 0.65, 0.85, 1];
const CrowdSectors = 8;

/** Lux at a point from one lamp, and the unit direction toward it (written to Out). Returns 0 when out of reach. */
function Reach(L: FRigLight, X: number, Y: number, Z: number, Out: Float32Array): number {
  const DX = L.Pos.X - X, DY = L.Pos.Y - Y, DZ = L.Pos.Z - Z;
  const D2 = DX * DX + DY * DY + DZ * DZ;
  const D = Math.sqrt(D2);
  const R = D / L.Radius;
  if (R >= 1) { return 0; }
  const Inv = 1 / D;
  let Gain = 1 - R * R * R * R;
  Gain *= Gain;
  if (L.CosOuter > -1.5) {
    const Cone = FMath.Clamp((-(DX * L.Dir.X + DY * L.Dir.Y + DZ * L.Dir.Z) * Inv - L.CosOuter) / (L.CosInner - L.CosOuter), 0, 1);
    if (Cone <= 0) { return 0; }
    Gain *= Cone * Cone;
  }
  Out[0] = DX * Inv; Out[1] = DY * Inv; Out[2] = DZ * Inv;
  return (Gain * L.Candelas) / Math.max(D2 * CM * CM, 0.01);
}

/** The venue: ring, ropes, stands, crowd, lights, video screens. Everything is spawned from the exported layout. */
export class ACpvArena extends AActor {
  // --- ring geometry (cm, mat surface at Z = 0) ---
  MatHalf = 300;
  RopeHalf = 262;
  FloorZ = -110;
  RopeZ: number[] = [50, 90, 130];
  /** How far a fighter's centre may go from the middle of the ring. */
  RingLimit(): number { return this.RopeHalf - 26; }

  // --- crowd ---
  SetHype(NewHype: number): void { this.HypeTarget = FMath.Clamp(NewHype, 0, 1); }
  CrowdPop(Amount: number): void { this.HypePop = FMath.Clamp(this.HypePop + Amount, 0, 1); }
  GetHype(): number { return this.HypeShown; }

  // --- lights and screens ---
  Flash(Strength: number): void { this.FlashLevel = FMath.Max(this.FlashLevel, Strength); }
  /** The big screen over the stage door: a 1024x540 canvas the game draws captions on (call MarkDirty after). */
  GetStageScreen(): FCanvasTarget | null { return this.StageScreen; }
  GetSignAtlas(): FCanvasTarget | null { return this.SignAtlas; }
  bFeedEnabled = true;
  FeedInterval = 0.125;
  /** Fraction of the spectators beyond the floor seats that are drawn, on top of the Effects setting (0..1). */
  CrowdDensity = 1;
  IsTaping(): boolean { return this.bTaping; }
  TapeStart = 0;
  TapeEnd = 0;

  // --- layout anchors (Unreal coordinates) ---
  StageDoor = new FVector(-2020, 0, -18);
  StageFront = new FVector(-1510, 0, -18);
  RampBottom = new FVector(-700, 0, -110);
  Ringside = new FVector(-510, 0, -110);
  HardCam = new FVector(0, 1120, 255);
  Bell = new FVector(-200, -440, -22);
  PyroPoints: FVector[] = [];
  AnnounceSeats: FTransform[] = [];

  private MeshParts: UStaticMeshComponent[] = [];
  private CrowdParts: FCrowdPart[] = [];
  private SignPart: FCrowdPart | null = null;
  private RopeMesh: UInstancedStaticMeshComponent | null = null;
  private CrowdMaterial: UMaterialInstanceDynamic | null = null;
  private bBroadcastFlashes = true;
  private CameraFlashes: UInstancedStaticMeshComponent | null = null;
  private FlashMaterial: UMaterialInstanceDynamic | null = null;
  private SignMaterial: UMaterialInstanceDynamic | null = null;
  private RopeMaterial: UMaterialInstanceDynamic | null = null;

  // The rig as data (every lamp the desktop game has), for the stadium list and the crowd.
  private KeyRig: FRigLight[] = [];
  private StageRig: FRigLight[] = [];      // the nine stage spots, then the three long-throw boosts
  private StageBoost: boolean[] = [];      // which of StageRig are boosts
  private WashRig: FRigLight[] = [];
  private FillRig: FRigLight[] = [];
  // Not lamps: the glow of the lit mat and of the lit stage as the stands see it (the desktop game's
  // global illumination provided this). Strengths are per unit of key level and of stage level.
  private RingGlow: FRigLight = { Pos: new FVector(0, 0, 70), Dir: new FVector(0, 0, 1), CosInner: 1, CosOuter: -2, Radius: 4200, Colour: new FLinearColor(1, 0.8, 0.56), Candelas: 9000 };
  private StageGlow: FRigLight = { Pos: new FVector(-1500, 0, 330), Dir: new FVector(0, 0, 1), CosInner: 1, CosOuter: -2, Radius: 2600, Colour: new FLinearColor(1, 0.8, 0.58), Candelas: 2500 };
  private WashBase: FRotator[] = [];
  // The lamps three.js lights for us.
  private KeySpots: SpotLight[] = [];
  private BoostSpot: SpotLight | null = null;
  private FlashLight: PointLight | null = null;
  private Ambient: HemisphereLight | null = null;

  private FeedTargets: WebGLRenderTarget[] = [];
  private Shown: WebGLRenderTarget | null = null;   // what the live screens are showing
  private FeedLocation = new FVector(0, 1120, 255);
  private FeedRotation = FRotator.ZeroRotator;
  private FeedFov = 40;
  private bHaveFeed = false;
  private StageScreen: FCanvasTarget | null = null;
  private SignAtlas: FCanvasTarget | null = null;
  private LiveScreens: UMaterialInstanceDynamic[] = [];
  private TapeFrames: WebGLRenderTarget[] = [];
  private TapeTimes: number[] = new Array<number>(TapeCapacity).fill(0);
  private TapeCount = 0;
  private TapeNext = 0;
  private bTaping = false;
  private NextTapeSample = 0;

  // ropes
  private RopeBend: number[] = [0, 0, 0, 0];
  private RopeVel: number[] = [0, 0, 0, 0];
  private RopeAt: number[] = [0.5, 0.5, 0.5, 0.5];
  private RopeXforms: FTransform[] = [];

  // crowd energy
  private HypeTarget = 0.3;
  private HypeShown = 0.3;
  private HypePop = 0;

  // lights
  private Mood = ECpvLightMood.Show;
  private KeyLevel = 1; private StageLevel = 0.3; private WashLevel = 0.6; private FillLevel = 1;
  private KeyGoal = 1; private StageGoal = 0.3; private WashGoal = 0.6; private FillGoal = 1;
  private Exposure = 0; private ExposureGoal = 0;   // exposure compensation in stops (the stage is far dimmer than the ring)
  private MoodRate = 1;
  private FlashLevel = 0;
  private FeedClock = 0;
  private Age = 0;
  private bBuilt = false;

  // web-only bookkeeping
  private SeenSettings = -1;
  private SeenFeedHz = -1;
  private SeenDensity = -1;
  private LightCursor = 0;
  private LightPart = 0;
  private ReachDir = new Float32Array(3);

  private LoadLayout(Seats: FSeat[], Screens: FScreen[], Lights: FLightSpec[], Meshes: string[]): boolean {
    const Root = Assets.Json('arena_layout');
    if (!Root) {
      console.error('Missing arena_layout.json (run tools/build-assets.mjs)');
      return false;
    }
    const Ring = Root.ring;
    if (Ring) {
      this.MatHalf = Ring.mat_half;
      this.RopeHalf = Ring.rope_half;
      this.FloorZ = Ring.floor_z;
      const Z = Ring.rope_z as number[];
      for (let i = 0; i < 3 && i < Z.length; ++i) { this.RopeZ[i] = Z[i]; }
    }
    for (const V of Root.meshes as string[]) { Meshes.push(V); }
    for (const A of Root.seats as number[][]) {
      if (A.length >= 5) { Seats.push({ Pos: new FVector(A[0], A[1], A[2]), Yaw: A[3], Tier: Math.trunc(A[4]) }); }
    }
    for (const O of Root.screens as any[]) {
      Screens.push({ Name: O.name, Center: ReadVec(O, 'center'), Normal: ReadVec(O, 'normal'), Width: O.width, Height: O.height });
    }
    for (const O of Root.lights as any[]) {
      Lights.push({ Pos: ReadVec(O, 'pos'), Dir: ReadVec(O, 'dir'), Kind: O.kind });
    }
    const Stage = Root.stage;
    if (Stage) {
      this.StageDoor = ReadVec(Stage, 'door');
      this.StageFront = ReadVec(Stage, 'front');
      this.RampBottom = ReadVec(Stage, 'ramp_bottom');
      this.Ringside = ReadVec(Stage, 'ringside');
    }
    if (Array.isArray(Root.pyro)) {
      for (const A of Root.pyro as number[][]) {
        if (A.length >= 3) { this.PyroPoints.push(new FVector(A[0], A[1], A[2])); }
      }
    }
    if (Array.isArray(Root.announce)) {
      for (const O of Root.announce as any[]) {
        this.AnnounceSeats.push(new FTransform(new FRotator(0, O.yaw, 0), ReadVec(O, 'pos')));
      }
    }
    this.Bell = ReadVec(Root, 'bell');
    if (Root.camera) { this.HardCam = ReadVec(Root.camera, 'hard'); }
    return true;
  }

  Build(): void {
    if (this.bBuilt) { return; }
    this.bBuilt = true;
    const Seats: FSeat[] = [];
    const Screens: FScreen[] = [];
    const Lights: FLightSpec[] = [];
    const Meshes: string[] = [];
    if (!this.LoadLayout(Seats, Screens, Lights, Meshes)) { return; }
    this.BuildMeshes(Meshes);
    this.BuildRopes();
    this.BuildScreens(Screens);
    this.BuildLights(Lights);     // before the crowd here: each spectator's share of the fixed lights is worked out once
    if (!FParse.Param('CpvNoCrowd')) { this.BuildCrowd(Seats); }
    this.BuildAtmosphere();
    this.SetMood(ECpvLightMood.Show, 0);
    this.ApplySettings();
    Log(`Arena built: ${Meshes.length} meshes, ${Seats.length} seats, ${Lights.length} lights, ${Screens.length} screens`);
  }

  private BuildMeshes(Meshes: string[]): void {
    for (const Name of Meshes) {
      if (!Assets.StaticMesh(Name)) {
        console.warn(`Missing arena mesh ${Name}`);
        continue;
      }
      const Part = new UStaticMeshComponent();
      Part.SetStaticMesh(Name);
      // Only what stands in the pools of the shadow-casting lights needs to be in their shadow maps.
      Part.SetCastShadow(Name === 'SM_Ring' || Name === 'SM_Ringside' || Name === 'SM_Stage');
      this.MeshParts.push(Part);
    }
  }

  private MakeInstances(MeshPath: string, Material: UMaterialInstanceDynamic | null, CustomFloats: number, bShadow: boolean): UInstancedStaticMeshComponent | null {
    if (!Assets.StaticMesh(MeshPath)) {
      console.warn(`Missing mesh ${MeshPath}`);
      return null;
    }
    const Part = new UInstancedStaticMeshComponent();
    Part.SetStaticMesh(MeshPath);
    if (Material) { Part.SetMaterial(0, Material); }
    Part.SetNumCustomDataFloats(CustomFloats);
    Part.SetCastShadow(bShadow);
    return Part;
  }

  private BuildCrowd(Seats: FSeat[]): void {
    this.CrowdMaterial = UMaterialInstanceDynamic.Create('/Game/CPV/Materials/M_Crowd.M_Crowd', true);
    this.FlashMaterial = UMaterialInstanceDynamic.Create('/Game/CPV/Materials/M_Flash.M_Flash', true);
    this.SignMaterial = UMaterialInstanceDynamic.Create('/Game/CPV/Materials/M_Sign.M_Sign', true);
    this.DrawSignAtlas();
    if (this.SignMaterial && this.SignAtlas) { this.SignMaterial.SetTextureParameterValue('Atlas', this.SignAtlas.Texture); }

    const VariantPaths = [
      '/Game/CPV/Crowd/SM_CrowdA.SM_CrowdA', '/Game/CPV/Crowd/SM_CrowdB.SM_CrowdB', '/Game/CPV/Crowd/SM_CrowdC.SM_CrowdC',
      '/Game/CPV/Crowd/SM_CrowdD.SM_CrowdD', '/Game/CPV/Crowd/SM_CrowdFar.SM_CrowdFar'];
    // The desktop game has one component per figure; here each figure is also split by compass sector, so
    // the stands behind the camera are culled, and ordered so the far end of each batch can be left undrawn.
    interface FPerson { Xf: FTransform; Row: number[]; bKeep: boolean; Order: number }
    const People: FPerson[][] = [];
    for (let i = 0; i < 5 * CrowdSectors; ++i) { People.push([]); }
    const ChairXf: FTransform[] = [], SignXf: FTransform[] = [], FlashXf: FTransform[] = [];
    const SignData: number[] = [], FlashData: number[] = [];

    const Shirts = [
      Srgb(200, 40, 40), Srgb(36, 86, 196), Srgb(242, 194, 48), Srgb(40, 150, 90), Srgb(230, 110, 30), Srgb(130, 60, 190),
      Srgb(235, 235, 228), Srgb(30, 30, 34), Srgb(255, 90, 160), Srgb(25, 170, 160), Srgb(120, 125, 135), Srgb(150, 30, 50),
      Srgb(70, 160, 230), Srgb(245, 245, 245)];
    const Trousers = [Srgb(50, 70, 120), Srgb(30, 40, 70), Srgb(28, 28, 32), Srgb(150, 130, 95), Srgb(90, 92, 100), Srgb(70, 50, 40)];

    const Rng = new FRandomStream(19981);
    const Thin = new FRandomStream(7);   // its own stream: the layout above must not notice the thinning order
    for (const Seat of Seats) {
      // Only the floor seats and the first few rows get the detailed figures; everyone further back is the light version.
      const bFar = Seat.Tier === 2 || (Seat.Tier === 1 && Seat.Pos.Z > 110);
      const V = bFar ? 4 : Rng.RandRange(0, 3);
      const Scale = bFar ? Rng.FRandRange(1.0, 1.16) : Rng.FRandRange(0.92, 1.08);
      const Yaw = Seat.Yaw + Rng.FRandRange(-10, 10);
      const Rot = new FRotator(0, Yaw, 0);
      const Forward = Rot.Vector();
      const JitterX = Rng.FRandRange(-5, 5);
      const JitterY = Rng.FRandRange(-5, 5);
      const Loc = Seat.Pos.Add(new FVector(JitterX, JitterY, 0));
      const Shirt = Shirts[Rng.RandRange(0, Shirts.length - 1)];
      const Legs = Trousers[Rng.RandRange(0, Trousers.length - 1)];
      let Excite = Rng.FRand();
      if (Seat.Tier === 0) { Excite *= 0.75; }
      const Phase = Rng.FRand();
      const bSign = !bFar && Rng.FRand() < 0.04;
      if (bSign) {
        Excite = 0; // sign holders stay on their feet
        SignXf.push(new FTransform(Rot, Loc.Add(new FVector(0, 0, 150 * Scale)).Add(Forward.Mul(18)), FVector.Splat(Scale)));
        SignData.push(Rng.RandRange(0, 15));
        SignData.push(Phase);
      }
      if (Seat.Tier >= 1 && Rng.FRand() < 0.085) {
        FlashXf.push(new FTransform(FRotator.ZeroRotator, Loc.Add(new FVector(0, 0, 125)).Add(Forward.Mul(22)), FVector.Splat(0.11)));
        FlashData.push(Rng.FRand());
      }
      if (Seat.Tier === 0) { ChairXf.push(new FTransform(Rot, Seat.Pos)); }
      const YawRad = FMath.DegreesToRadians(Yaw);
      const Skin = FMath.Pow(Rng.FRand(), 1.4);
      const Hair = Rng.FRand();
      const Row = [Shirt.R, Shirt.G, Shirt.B, Legs.R, Legs.G, Legs.B, Skin, Hair, Phase, Excite,
        FMath.Cos(YawRad) * Scale, FMath.Sin(YawRad) * Scale];
      const Sector = Math.min(CrowdSectors - 1, Math.floor(((Math.atan2(Loc.Y, Loc.X) + UE_PI) / UE_TWO_PI) * CrowdSectors));
      const bKeep = Seat.Tier === 0 || bSign;
      People[Sector * 5 + V].push({ Xf: new FTransform(Rot, Loc, FVector.Splat(Scale)), Row, bKeep, Order: bKeep ? -1 : Thin.FRand() });
    }

    for (let i = 0; i < People.length; ++i) {
      const List = People[i];
      if (List.length === 0) { continue; }
      List.sort((A, B) => A.Order - B.Order);
      const Comp = this.MakeInstances(VariantPaths[i % 5], this.CrowdMaterial, 12, false);
      if (!Comp) { continue; }
      Comp.bFrustumCull = true;
      Comp.AddInstances(List.map((P) => P.Xf));
      for (let k = 0; k < List.length; ++k) { Comp.SetCustomData(k, List[k].Row); }
      Comp.MarkRenderStateDirty();
      const Part = this.MakeCrowdPart(Comp, List.map((P) => P.Xf.GetLocation().Add(new FVector(0, 0, 110))), List.filter((P) => P.bKeep).length);
      if (Part) { this.CrowdParts.push(Part); }
    }

    const Chairs = this.MakeInstances('/Game/CPV/Props/SM_Chair.SM_Chair', null, 3, false);   // three floats left at 1: an untinted clay colour
    if (Chairs && ChairXf.length > 0) { Chairs.AddInstances(ChairXf); }

    const Signs = this.MakeInstances('/Game/CPV/Crowd/SM_Sign.SM_Sign', this.SignMaterial, 2, false);
    if (Signs && SignXf.length > 0) {
      Signs.AddInstances(SignXf);
      for (let i = 0; i < SignXf.length; ++i) { Signs.SetCustomData(i, [SignData[i * 2], SignData[i * 2 + 1]]); }
      this.SignPart = this.MakeCrowdPart(Signs, SignXf.map((Xf) => Xf.GetLocation()), SignXf.length);
    }

    this.CameraFlashes = this.MakeInstances('/Engine/BasicShapes/Sphere.Sphere', this.FlashMaterial, 1, false);
    if (this.CameraFlashes && FlashXf.length > 0) {
      this.CameraFlashes.AddInstances(FlashXf);
      for (let i = 0; i < FlashXf.length; ++i) { this.CameraFlashes.SetCustomData(i, [FlashData[i]]); }
    }
  }

  /** Gives a batch of spectators its light attributes and works out their share of the lamps that never move. */
  private MakeCrowdPart(Comp: UInstancedStaticMeshComponent, Points: FVector[], Keep: number): FCrowdPart | null {
    const Mesh = Comp.Mesh;
    if (!Mesh) { return null; }
    const Count = Points.length;
    const At = new Float32Array(Count * 3);
    const Static = new Float32Array(Count * 18);
    // What the lit mat and the lit stage throw back rises and falls with the lamps that light them.
    const Groups = [[...this.KeyRig, this.RingGlow], [...this.StageRig, this.StageGlow], this.FillRig];
    const Dir = this.ReachDir;
    for (let i = 0; i < Count; ++i) {
      const P = Points[i];
      At[i * 3] = P.X; At[i * 3 + 1] = P.Y; At[i * 3 + 2] = P.Z;
      for (let g = 0; g < 3; ++g) {
        const O = i * 18 + g * 6;
        for (const L of Groups[g]) {
          const Lux = Reach(L, P.X, P.Y, P.Z, Dir);
          if (Lux <= 0) { continue; }
          const C = L.Colour;
          Static[O] += C.R * Lux; Static[O + 1] += C.G * Lux; Static[O + 2] += C.B * Lux;
          const Weight = Lux * (0.2126 * C.R + 0.7152 * C.G + 0.0722 * C.B);
          Static[O + 3] += Dir[0] * Weight; Static[O + 4] += Dir[1] * Weight; Static[O + 5] += Dir[2] * Weight;
        }
      }
    }
    const Light = new InstancedBufferAttribute(new Float32Array(Count * 3), 3);
    const Toward = new InstancedBufferAttribute(new Float32Array(Count * 3), 3);
    for (let i = 0; i < Count; ++i) { Toward.array[i * 3 + 1] = 1; }
    Mesh.geometry.setAttribute('aLight', Light);
    Mesh.geometry.setAttribute('aLightDir', Toward);
    if (Mesh.boundingSphere) { Mesh.boundingSphere.radius += 1.5; }   // they stand up and wave
    return { Comp, Count, Keep, At, Static, Light, Dir: Toward };
  }

  /** Refreshes the light on some of the spectators in a batch (all of them when Num covers the batch). */
  private LightPeople(Part: FCrowdPart, From: number, Num: number): void {
    const Light = Part.Light.array as Float32Array;
    const Toward = Part.Dir.array as Float32Array;
    const S = Part.Static, At = Part.At;
    const Key = this.KeyLevel, Stage = this.StageLevel, Fill = this.FillLevel;
    const Wash = this.WashRig;
    const Dir = this.ReachDir;
    const End = Math.min(Part.Count, From + Num);
    for (let i = From; i < End; ++i) {
      const O = i * 18;
      let R = S[O] * Key + S[O + 6] * Stage + S[O + 12] * Fill;
      let G = S[O + 1] * Key + S[O + 7] * Stage + S[O + 13] * Fill;
      let B = S[O + 2] * Key + S[O + 8] * Stage + S[O + 14] * Fill;
      let DX = S[O + 3] * Key + S[O + 9] * Stage + S[O + 15] * Fill;
      let DY = S[O + 4] * Key + S[O + 10] * Stage + S[O + 16] * Fill;
      let DZ = S[O + 5] * Key + S[O + 11] * Stage + S[O + 17] * Fill;
      const X = At[i * 3], Y = At[i * 3 + 1], Z = At[i * 3 + 2];
      for (let w = 0; w < Wash.length; ++w) {
        const L = Wash[w];
        const Lux = Reach(L, X, Y, Z, Dir);
        if (Lux <= 0) { continue; }
        const C = L.Colour;
        R += C.R * Lux; G += C.G * Lux; B += C.B * Lux;
        const Weight = Lux * (0.2126 * C.R + 0.7152 * C.G + 0.0722 * C.B);
        DX += Dir[0] * Weight; DY += Dir[1] * Weight; DZ += Dir[2] * Weight;
      }
      Light[i * 3] = R; Light[i * 3 + 1] = G; Light[i * 3 + 2] = B;
      const Len = Math.sqrt(DX * DX + DY * DY + DZ * DZ);
      if (Len > 1e-6) {
        // Unreal's axes to three.js's: Y and Z change places.
        Toward[i * 3] = DX / Len; Toward[i * 3 + 1] = DZ / Len; Toward[i * 3 + 2] = DY / Len;
      }
    }
    Part.Light.needsUpdate = true;
    Part.Dir.needsUpdate = true;
  }

  /** A few hundred spectators a frame, so the whole house is relit several times a second. */
  private UpdateCrowdLight(bAll: boolean): void {
    const Parts = this.SignPart ? [...this.CrowdParts, this.SignPart] : this.CrowdParts;
    if (Parts.length === 0) { return; }
    if (bAll) {
      for (const Part of Parts) { this.LightPeople(Part, 0, Part.Count); }
      return;
    }
    let Budget = 1400;
    let Guard = Parts.length + 1;
    while (Budget > 0 && Guard-- > 0) {
      if (this.LightPart >= Parts.length) { this.LightPart = 0; }
      const Part = Parts[this.LightPart];
      const Num = Math.min(Budget, Part.Count - this.LightCursor);
      this.LightPeople(Part, this.LightCursor, Num);
      Budget -= Num;
      this.LightCursor += Num;
      if (this.LightCursor >= Part.Count) {
        this.LightCursor = 0;
        ++this.LightPart;
      }
    }
  }

  private DrawSignAtlas(): void {
    this.SignAtlas = new FCanvasTarget(1024, 1024, '#fff');
    const Canvas = this.SignAtlas.Ctx;
    const Slogans = [
      ['CLAY', '> CGI'], ['HI', 'MOM!'], ['SQUISH', 'HIM!'], ['I LUV', 'LOLA'],
      ['REX', '4 PREZ'], ['MY EX IS', 'A LUMP'], ['THIS IS', 'A SIGN'], ["CHEF'S", 'KISS!'],
      ['DROP', 'THE BASS'], ['OFF WITH', 'HIS HEAD'], ['CANCEL', 'HIM!'], ['RATINGS', 'GOLD'],
      ['MOLD &', 'HOLD'], ['VINCE', 'SHREDS'], ['WE WANT', 'SPLAT'], ['MYSTICA', 'KNEW']];
    const Cards = [Srgb(255, 240, 150), Srgb(255, 255, 255), Srgb(255, 190, 210), Srgb(190, 235, 255), Srgb(200, 255, 190), Srgb(255, 215, 160)];
    const Inks = [Srgb(200, 30, 30), Srgb(25, 40, 120), Srgb(20, 20, 24), Srgb(120, 30, 150)];
    for (let i = 0; i < 16; ++i) {
      const X = (i % 4) * 256, Y = Math.floor(i / 4) * 256;
      CpvUi.Fill(Canvas, X, Y, 256, 256, Cards[i % Cards.length]);
      const Ink = Inks[(i * 7) % Inks.length];
      for (let Line = 0; Line < 2; ++Line) {
        const Str = Slogans[i][Line];
        let Pt = 86;
        while (Pt > 24 && CpvUi.Measure(Str, CpvUi.Font(ECpvFont.Comic, Pt)).X > 226) { Pt -= 4; }
        CpvUi.Text(Canvas, Str, X + 128, Y + 34 + Line * 96 + (86 - Pt) * 0.5, CpvUi.Font(ECpvFont.Comic, Pt), Ink, ECpvAlign.Center);
      }
    }
    this.SignAtlas.MarkDirty();
  }

  private BuildRopes(): void {
    this.RopeMaterial = UMaterialInstanceDynamic.Create('/Game/CPV/Materials/M_Clay.M_Clay', true);
    this.RopeMesh = this.MakeInstances('/Game/CPV/Props/SM_RopeSeg.SM_RopeSeg', this.RopeMaterial, 3, true);
    if (!this.RopeMesh) { return; }
    this.RopeXforms = new Array<FTransform>(4 * 3 * RopeSegments).fill(FTransform.Identity);
    this.RopeMesh.AddInstances(this.RopeXforms);
    const Tints = [Srgb(40, 70, 190), Srgb(238, 236, 228), Srgb(200, 40, 40)]; // bottom, middle, top
    for (let i = 0; i < this.RopeXforms.length; ++i) {
      const C = Tints[Math.floor(i / RopeSegments) % 3];
      this.RopeMesh.SetCustomData(i, [C.R, C.G, C.B]);
    }
    this.UpdateRopes(0);
  }

  /** Ropes: Side 0 = +X, 1 = -X, 2 = +Y, 3 = -Y. Along is -1..1 along that side, Impulse in cm/s outward. */
  BumpRopes(Side: number, Along: number, Impulse: number): void {
    if (Side < 0 || Side > 3) { return; }
    this.RopeVel[Side] += Impulse;
    this.RopeAt[Side] = FMath.Clamp(Along * 0.5 + 0.5, 0.12, 0.88);
  }

  /** Convenience: bump whichever side a ring position is nearest to. */
  BumpRopesAt(Location: FVector, Impulse: number): void {
    if (FMath.Abs(Location.X) > FMath.Abs(Location.Y)) {
      this.BumpRopes(Location.X > 0 ? 0 : 1, Location.Y / this.RopeHalf, Impulse);
    } else {
      this.BumpRopes(Location.Y > 0 ? 2 : 3, Location.X / this.RopeHalf, Impulse);
    }
  }

  private UpdateRopes(DeltaTime: number): void {
    if (!this.RopeMesh) { return; }
    const Sub = FMath.Clamp(FMath.CeilToInt(DeltaTime / 0.008), 1, 8);
    const H = DeltaTime / Sub;
    for (let S = 0; S < 4; ++S) {
      for (let i = 0; i < Sub; ++i) {
        this.RopeVel[S] += (-260 * this.RopeBend[S] - 5.5 * this.RopeVel[S]) * H;
        this.RopeBend[S] += this.RopeVel[S] * H;
      }
      this.RopeBend[S] = FMath.Clamp(this.RopeBend[S], -70, 90);
    }
    const Normals = [new FVector(1, 0, 0), new FVector(-1, 0, 0), new FVector(0, 1, 0), new FVector(0, -1, 0)];
    const Tangents = [new FVector(0, 1, 0), new FVector(0, 1, 0), new FVector(1, 0, 0), new FVector(1, 0, 0)];
    let Index = 0;
    for (let S = 0; S < 4; ++S) {
      for (let Level = 0; Level < 3; ++Level) {
        const LevelScale = Level === 1 ? 1 : 0.8;
        let Prev = FVector.ZeroVector;
        for (let i = 0; i <= RopeSegments; ++i) {
          const U = i / RopeSegments;
          const Peak = this.RopeAt[S];
          const Tent = U < Peak ? U / Peak : (1 - U) / (1 - Peak);
          const Shape = FMath.Pow(FMath.Clamp(Tent, 0, 1), 1.25);
          const P = Normals[S].Mul(this.RopeHalf + this.RopeBend[S] * Shape * LevelScale).Add(Tangents[S].Mul(this.RopeHalf * (U * 2 - 1)))
            .Add(new FVector(0, 0, this.RopeZ[Level] - 2.5 * FMath.Sin(U * UE_PI)));
          if (i > 0) {
            const D = P.Sub(Prev);
            this.RopeXforms[Index++] = new FTransform(FRotationMatrix.MakeFromX(D), P.Add(Prev).Mul(0.5), new FVector((D.Size() / 100) * 1.03, 1, 1));
          }
          Prev = P;
        }
      }
    }
    this.RopeMesh.BatchUpdateInstancesTransforms(0, this.RopeXforms);
  }

  private BuildScreens(Screens: FScreen[]): void {
    // The live feed is filmed into one of two pictures in turn, so a screen that is in shot shows the last one.
    this.FeedTargets = [GRenderer.MakeDisplayTarget(640, 360), GRenderer.MakeDisplayTarget(640, 360)];
    this.Shown = this.FeedTargets[0];
    this.StageScreen = new FCanvasTarget(1024, 540, new FLinearColor(0.01, 0.01, 0.03).Css());
    if (!Assets.StaticMesh('Plane')) { return; }
    for (const Screen of Screens) {
      const Part = new UStaticMeshComponent();
      Part.SetStaticMesh('/Engine/BasicShapes/Plane.Plane');
      Part.SetCastShadow(false);
      // Plane X runs along the picture's width, Y down its height, Z out of the screen.
      const N = Screen.Normal.GetSafeNormal();
      const Right = FVector.CrossProduct(N, FVector.UpVector).GetSafeNormal();
      const Basis = FQuat.FromAxes(Right, new FVector(0, 0, -1), N);
      Part.SetWorldTransform(new FTransform(Basis, Screen.Center.Add(N.Mul(1)), new FVector(Screen.Width / 100, Screen.Height / 100, 1)));
      const Mid = UMaterialInstanceDynamic.Create('/Game/CPV/Materials/M_Screen.M_Screen');
      const bStage = Screen.Name === 'stage';
      Mid.SetTextureParameterValue('Screen', bStage ? this.StageScreen.Texture : this.Shown.texture);
      Mid.SetScalarParameterValue('FlipV', bStage ? 0 : 1);   // a filmed picture is stored bottom row first, a canvas top row first
      Mid.SetScalarParameterValue('LedGrid', bStage ? 190 : 120);
      Mid.SetScalarParameterValue('Intensity', bStage ? 325 : 650);
      Part.SetMaterial(0, Mid);
      if (!bStage) { this.LiveScreens.push(Mid); }
      this.MeshParts.push(Part);
    }
    this.bHaveFeed = true;
    this.FeedLocation = this.HardCam;
    this.FeedRotation = new FVector(0, 0, 60).Sub(this.HardCam).Rotation();
  }

  /** Point the scoreboard's live feed camera (called by the game's camera director). */
  SetFeedView(Location: FVector, Rotation: FRotator, Fov: number): void {
    this.FeedLocation = Location;
    this.FeedRotation = Rotation;
    this.FeedFov = Fov;
  }

  private BuildLights(Lights: FLightSpec[]): void {
    const MakeRig = (Spec: FLightSpec, Inner: number, Outer: number, Radius: number, Colour: FLinearColor, Candelas: number): FRigLight => ({
      Pos: Spec.Pos, Dir: Spec.Dir.GetSafeNormal(), CosInner: Cos(Inner), CosOuter: Cos(Outer), Radius, Colour, Candelas,
    });
    const MakeSpot = (Pos: FVector, Dir: FVector, Inner: number, Outer: number, Radius: number, Colour: FLinearColor): SpotLight => {
      const L = new SpotLight(new Color(Colour.R, Colour.G, Colour.B), 0, Radius * CM, FMath.DegreesToRadians(Outer), 1 - Inner / Outer, 2);
      ToVector3(Pos, L.position);
      ToVector3(Pos.Add(Dir.GetSafeNormal().Mul(1000)), L.target.position);
      L.shadow.camera.near = 2.5;
      L.shadow.camera.far = Radius * CM;
      L.shadow.bias = -0.0006;
      L.shadow.normalBias = 0.025;
      L.shadow.radius = 2.5;
      AddToScene(L);
      AddToScene(L.target);
      return L;
    };
    let KeyCount = 0;
    const KeyPairs: FLightSpec[] = [];
    for (const Spec of Lights) {
      if (Spec.Kind === 'key') {
        // The truss carries sixteen lamps but only the inner two per side are real lights (at double
        // strength), and one of each pair casts shadows: every extra overlapping light costs per pixel.
        const InSide = KeyCount++ % 4;
        if (InSide === 1 || InSide === 2) {
          this.KeyRig.push(MakeRig(Spec, 19, 34, 1500, Lamp(1, 0.93, 0.82), KeyCandelas));
          KeyPairs.push(Spec);
        }
      } else if (Spec.Kind === 'stage') {
        this.StageRig.push(MakeRig(Spec, 12, 24, 2400, Lamp(0.72, 0.84, 1), StageCandelas));
        this.StageBoost.push(false);
      } else if (Spec.Kind === 'wash') {
        this.WashRig.push(MakeRig(Spec, 9, 17, 3300, Lamp(1, 0.2, 0.5), WashCandelas));
        this.WashBase.push(Spec.Dir.Rotation());
      }
    }
    // Here the two lamps of a side share one light, placed between them; its shadow is half strength
    // because on the desktop only one of the two cast any.
    for (let i = 0; i + 1 < KeyPairs.length; i += 2) {
      const A = KeyPairs[i], B = KeyPairs[i + 1];
      const L = MakeSpot(A.Pos.Add(B.Pos).Mul(0.5), A.Dir.GetSafeNormal().Add(B.Dir.GetSafeNormal()), 19, 34, 1500, Lamp(1, 0.93, 0.82));
      L.shadow.intensity = 0.5;
      this.KeySpots.push(L);
    }
    // The stage arch back-lights whoever walks out, so three spots on the ring truss light their faces.
    for (let i = -1; i <= 1; ++i) {
      const Pos = new FVector(-640, i * 300, 700);
      const Spec: FLightSpec = { Pos, Dir: new FVector(-1600, i * 90, 40).Sub(Pos).GetSafeNormal(), Kind: 'boost' };
      // Five times a stage spot's strength (the C++ applies the factor when it sets the intensity).
      this.StageRig.push(MakeRig(Spec, 9, 17, 3200, Lamp(1, 0.95, 0.88), StageCandelas * 5));
      this.StageBoost.push(true);
      if (i === 0) { this.BoostSpot = MakeSpot(Spec.Pos, Spec.Dir, 9, 17, 3200, Lamp(1, 0.95, 0.88)); }
    }
    // Cool overhead fill so the stands never fall to black.
    for (let i = 0; i < 4; ++i) {
      const A = (UE_TWO_PI * (i + 0.5)) / 4;
      this.FillRig.push({
        Pos: new FVector(FMath.Cos(A) * 1750, FMath.Sin(A) * 1750, 1250), Dir: new FVector(0, 0, -1), CosInner: 1, CosOuter: -2,
        Radius: 4400, Colour: Lamp(0.5, 0.62, 1), Candelas: FillCandelas,
      });
    }
    this.FlashLight = new PointLight(0xffffff, 0, 26, 2);
    ToVector3(new FVector(0, 0, 430), this.FlashLight.position);
    AddToScene(this.FlashLight);
    ToVector3(new FVector(0, 0, 430), Shared.uCrowdFlashPos.value);
    // A little light from everywhere, standing in for what bounced around the hall on the desktop.
    this.Ambient = AddToScene(new HemisphereLight(new Color(0.6, 0.62, 0.9), new Color(0.6, 0.48, 0.38), 0));
  }

  private BuildAtmosphere(): void {
    // Nothing to build here. The desktop game's fog is too thin to dim anything across the hall (its job
    // there is to catch the beams of the lamps, which this renderer does not draw), and its post-process
    // settings live in engine/render.ts: the fixed exposure at EV100 8.6, bloom, vignette, grain, the
    // saturation and contrast, and the camera's shallow focus.
  }

  SetBroadcastFlashes(bEnabled: boolean): void {
    this.bBroadcastFlashes = bEnabled;
    if (this.CameraFlashes) { this.CameraFlashes.SetVisibility(bEnabled); }
    if (!bEnabled && this.FlashLight) {
      this.FlashLevel = 0;
      this.FlashLight.intensity = 0;
      Shared.uCrowdFlash.value = 0;
    }
  }

  SetMood(NewMood: ECpvLightMood, BlendSeconds = 1): void {
    this.Mood = NewMood;
    switch (NewMood) {
      case ECpvLightMood.House: this.KeyGoal = 0.75; this.StageGoal = 0.5; this.WashGoal = 0.35; this.FillGoal = 2.6; this.ExposureGoal = 0.2; break;
      case ECpvLightMood.Show: this.KeyGoal = 1; this.StageGoal = 0.25; this.WashGoal = 0.9; this.FillGoal = 1.44; this.ExposureGoal = 0; break;
      case ECpvLightMood.Entrance: this.KeyGoal = 0.2; this.StageGoal = 1.15; this.WashGoal = 1.32; this.FillGoal = 0.88; this.ExposureGoal = 0.85; break;
      case ECpvLightMood.Drama: this.KeyGoal = 1.05; this.StageGoal = 0.1; this.WashGoal = 0.5; this.FillGoal = 0.9; this.ExposureGoal = 0.35; break;
    }
    this.MoodRate = BlendSeconds > 0 ? 1 / BlendSeconds : 0;
    if (BlendSeconds <= 0) {
      this.KeyLevel = this.KeyGoal; this.StageLevel = this.StageGoal; this.WashLevel = this.WashGoal; this.FillLevel = this.FillGoal; this.Exposure = this.ExposureGoal;
      if (this.bBuilt) { this.UpdateLights(0); }
      this.UpdateCrowdLight(true);
    }
  }

  private UpdateLights(DeltaTime: number): void {
    const Approach = (Value: number, Goal: number): number =>
      this.MoodRate > 0 ? FMath.FInterpConstantTo(Value, Goal, DeltaTime, this.MoodRate * 1.2) : Goal;
    this.KeyLevel = Approach(this.KeyLevel, this.KeyGoal);
    this.StageLevel = Approach(this.StageLevel, this.StageGoal);
    this.WashLevel = Approach(this.WashLevel, this.WashGoal);
    this.FillLevel = Approach(this.FillLevel, this.FillGoal);
    this.Exposure = this.MoodRate > 0 ? FMath.FInterpConstantTo(this.Exposure, this.ExposureGoal, DeltaTime, this.MoodRate * 2.6) : this.ExposureGoal;
    GRenderer.ExposureBias = this.Exposure;
    for (const L of this.KeySpots) { L.intensity = KeyCandelas * 2 * this.KeyLevel; }
    if (this.BoostSpot) { this.BoostSpot.intensity = StageCandelas * 5 * this.StageLevel; }
    // Wash lights sweep the stands and drift between two colours.
    const Speed = this.Mood === ECpvLightMood.Entrance ? 1.6 : 0.55;
    for (let i = 0; i < this.WashRig.length; ++i) {
      const Phase = i * 1.31;
      const Base = this.WashBase[i];
      const R = new FRotator(Base.Pitch + 9 * FMath.Sin(this.Age * Speed * 0.7 + Phase * 2), Base.Yaw + 26 * FMath.Sin(this.Age * Speed + Phase), Base.Roll);
      const Mix = 0.5 + 0.5 * FMath.Sin(this.Age * 0.35 + i * 0.9);
      const A = i % 2 === 0 ? new FLinearColor(1, 0.12, 0.45) : new FLinearColor(0.1, 0.55, 1);
      const B = i % 2 === 0 ? new FLinearColor(1, 0.55, 0.1) : new FLinearColor(0.45, 0.2, 1);
      const Blend = A.Lerp(B, Mix);
      const Wash = this.WashRig[i];
      Wash.Dir = R.Vector();
      Wash.Colour = Lamp(Blend.R, Blend.G, Blend.B);
      Wash.Candelas = WashCandelas * this.WashLevel;
    }
    if (this.FlashLight) {
      this.FlashLevel = FMath.Max(0, this.FlashLevel - DeltaTime * 6);
      const Flash = this.bBroadcastFlashes ? this.FlashLevel * 220000 : 0;
      this.FlashLight.intensity = Flash;
      Shared.uCrowdFlash.value = Flash;
    }
    this.UpdateStadium();
  }

  /** Hands the clay shader the lamps that are not three.js lights, and the bounce off the mat. */
  private UpdateStadium(): void {
    const Detail = GRenderer.Settings.Lighting;
    let Count = 0;
    const Put = (L: FRigLight, Candelas: number) => {
      if (Count >= MAX_STADIUM_LIGHTS || Candelas <= 0) { return; }
      Shared.uStadPos.value[Count].set(L.Pos.X * CM, L.Pos.Z * CM, L.Pos.Y * CM, L.Radius * CM);
      if (L.CosOuter > -1.5) {
        Shared.uStadDir.value[Count].set(L.Dir.X, L.Dir.Z, L.Dir.Y, L.CosOuter);
        Shared.uStadCol.value[Count].set(L.Colour.R * Candelas, L.Colour.G * Candelas, L.Colour.B * Candelas, 1 / (L.CosInner - L.CosOuter));
      } else {
        Shared.uStadDir.value[Count].set(0, -1, 0, -2);
        Shared.uStadCol.value[Count].set(L.Colour.R * Candelas, L.Colour.G * Candelas, L.Colour.B * Candelas, 1);
      }
      ++Count;
    };
    for (const L of this.FillRig) { Put(L, L.Candelas * this.FillLevel); }
    // The stage floor and curtain are dark clay; it takes more of this glow to show on them than on the crowd.
    if (Detail >= 1) { Put(this.StageGlow, this.StageGlow.Candelas * 3.5 * this.StageLevel); }
    // On the two lower settings every third stage spot stands in for its neighbours.
    const Stride = Detail >= 2 ? 1 : 3;
    for (let i = 0; i < this.StageRig.length; ++i) {
      if (this.StageBoost[i]) {
        // The centre boost is a real light. Without the outer two (lowest setting) it carries their share.
        const bCentre = this.StageRig[i].Pos.Y === 0;
        if (!bCentre && Detail >= 1) { Put(this.StageRig[i], this.StageRig[i].Candelas * this.StageLevel); }
      } else if (i % Stride === (Stride === 1 ? 0 : 1)) {
        Put(this.StageRig[i], this.StageRig[i].Candelas * this.StageLevel * Stride);
      }
    }
    if (this.BoostSpot && Detail < 1) { this.BoostSpot.intensity *= 1.8; }
    // The wash lights are aimed at the stands, but in passing they tint the ring (the entrance owes its warm mat to them).
    if (Detail >= 3) {
      for (const L of this.WashRig) { Put(L, L.Candelas); }
    }
    Shared.uStadCount.value = Count;
    // The mat throws back roughly a third of what the key lights put on it, warm like the lamps and the canvas.
    const Bounce = 620 * this.KeyLevel;
    Shared.uBounce.value.set(1.0 * Bounce, 0.9 * Bounce, 0.76 * Bounce, 8);
    if (this.Ambient) { this.Ambient.intensity = 14 + 12 * this.FillLevel; }
    const Haze = 3 + 2 * this.FillLevel + 3 * this.KeyLevel;
    Shared.uCrowdAmbient.value.set(1.0 * Haze, 0.62 * Haze, 0.42 * Haze);
  }

  /** Follows the picture-quality settings: which lamps cast shadows and how sharply, and how full the stands are. */
  private ApplySettings(): void {
    this.SeenSettings = GRenderer.SettingsVersion;
    const S = GRenderer.Settings;
    const Size = S.Shadows >= 3 ? 2048 : 1024;
    this.KeySpots.forEach((L, i) => {
      // Low keeps the two whose shadows fall across the mat as the broadcast camera sees it.
      const bCast = S.Shadows >= 2 || (S.Shadows === 1 && (i === 1 || i === 2));
      if (L.castShadow !== bCast || L.shadow.mapSize.x !== Size) {
        L.castShadow = bCast;
        L.shadow.mapSize.set(Size, Size);
        L.shadow.map?.dispose();
        L.shadow.map = null;
      }
    });
    if (this.BoostSpot) {
      const bCast = S.Shadows >= 2;
      if (this.BoostSpot.castShadow !== bCast) {
        this.BoostSpot.castShadow = bCast;
        this.BoostSpot.shadow.mapSize.set(1024, 1024);
        this.BoostSpot.shadow.map?.dispose();
        this.BoostSpot.shadow.map = null;
      }
    }
    if (S.FeedHz !== this.SeenFeedHz) {
      this.SeenFeedHz = S.FeedHz;
      if (S.FeedHz > 0) { this.FeedInterval = 1 / S.FeedHz; }
    }
  }

  private ApplyDensity(): void {
    const Density = FMath.Clamp(this.CrowdDensity, 0, 1) * CrowdDensities[FMath.Clamp(Math.round(GRenderer.Settings.Effects), 0, 3)];
    if (Density === this.SeenDensity) { return; }
    this.SeenDensity = Density;
    for (const Part of this.CrowdParts) { Part.Comp.SetDrawCount(Part.Keep + Math.ceil((Part.Count - Part.Keep) * Density)); }
  }

  override Tick(DeltaTime: number): void {
    if (!this.bBuilt) { return; }
    this.Age += DeltaTime;
    if (GRenderer.SettingsVersion !== this.SeenSettings) { this.ApplySettings(); }
    this.ApplyDensity();
    this.UpdateRopes(DeltaTime);
    this.UpdateLights(DeltaTime);
    this.UpdateCrowdLight(false);

    this.HypePop = FMath.Max(0, this.HypePop - DeltaTime * 0.45);
    this.HypeShown = FMath.FInterpTo(this.HypeShown, FMath.Clamp(this.HypeTarget + this.HypePop, 0, 1), DeltaTime, 5);
    if (this.CrowdMaterial) { this.CrowdMaterial.SetScalarParameterValue('Hype', this.HypeShown); }
    if (this.FlashMaterial) { this.FlashMaterial.SetScalarParameterValue('Hype', this.HypeShown); }
    if (this.SignMaterial) { this.SignMaterial.SetScalarParameterValue('Hype', this.HypeShown); }

    // The scoreboard's live feed refreshes a few times a second, like the cast does.
    this.FeedClock += DeltaTime;
    if (this.bHaveFeed && this.bFeedEnabled && GRenderer.Settings.FeedHz > 0 && this.FeedClock >= this.FeedInterval) {
      this.FeedClock = 0;
      this.CaptureFeed();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Instant replay tape (CpvReplay.cpp): store the ringside camera feed on a short loop.
  // ---------------------------------------------------------------------------------------------

  StartTape(): void {
    this.TapeCount = this.TapeNext = 0;
    this.TapeStart = this.TapeEnd = this.NextTapeSample = 0;
    this.bTaping = this.bFeedEnabled && this.bHaveFeed && GRenderer.Settings.FeedHz > 0;
  }

  StopTape(): void {
    this.bTaping = false;
    if (this.TapeCount < 2) { this.TapeStart = this.TapeEnd = 0; return; }
    const Oldest = this.TapeTimes[this.TapeCount === TapeCapacity ? this.TapeNext : 0];
    this.TapeEnd = this.TapeTimes[(this.TapeNext + TapeCapacity - 1) % TapeCapacity];
    this.TapeStart = FMath.Max(Oldest, this.TapeEnd - 4.5);
  }

  DiscardTape(): void {
    this.bTaping = false;
    this.TapeCount = this.TapeNext = 0;
    this.TapeStart = this.TapeEnd = 0;
    if (this.FeedTargets.length > 0) { this.ShowOnScreens(this.FeedTargets[0]); }
    for (const Frame of this.TapeFrames) { Frame.dispose(); }
    this.TapeFrames = [];
  }

  private ShowOnScreens(Target: WebGLRenderTarget): void {
    if (this.Shown === Target) { return; }
    this.Shown = Target;
    for (const Screen of this.LiveScreens) { Screen.SetTextureParameterValue('Screen', Target.texture); }
  }

  private CaptureFeed(): void {
    const Now = this.GetWorld().GetTimeSeconds();
    // Never film into the picture the screens are showing: they may be in shot.
    let Target = this.Shown === this.FeedTargets[0] ? this.FeedTargets[1] : this.FeedTargets[0];
    if (this.bTaping && Now >= this.NextTapeSample) {
      if (this.TapeNext === this.TapeFrames.length) {
        this.TapeFrames.push(GRenderer.MakeDisplayTarget(640, 360));
      }
      if (this.TapeFrames[this.TapeNext]) {
        Target = this.TapeFrames[this.TapeNext];
        this.TapeTimes[this.TapeNext] = Now;
        this.TapeCount = FMath.Min(this.TapeCount + 1, TapeCapacity);
        this.TapeNext = (this.TapeNext + 1) % TapeCapacity;
        this.NextTapeSample = Now + 0.095;
      }
    }
    GRenderer.CaptureDisplay(Target, this.FeedLocation, this.FeedRotation, this.FeedFov);
    this.ShowOnScreens(Target);
  }

  /** The taped picture for a moment in game time: a finished frame, shown with GRenderer.DrawPicture. */
  TapeFrame(At: number): Texture | null {
    let Index = this.TapeCount === TapeCapacity ? this.TapeNext : 0;
    for (let i = 1; i < this.TapeCount; ++i) {
      const Next = (Index + 1) % TapeCapacity;
      if (this.TapeTimes[Next] > At) { break; }
      Index = Next;
    }
    return this.TapeCount ? this.TapeFrames[Index]?.texture ?? null : null;
  }
}
