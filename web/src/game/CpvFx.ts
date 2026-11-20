// Port of CpvFx.h / CpvFx.cpp.
//
// Every effect is a lump of clay: impact bursts, comic words, flying chunks that stick to the mat,
// cotton-wool puffs, flames, music notes. They move on the same stepped clock as the cast.

import { Assets } from '../engine/assets';
import { UMaterialInstanceDynamic } from '../engine/materials';
import { GRenderer } from '../engine/render';
import { FLinearColor, FMath, FQuat, FRandomStream, FRotationMatrix, FRotator, FTransform, FVector, UE_HALF_PI } from '../engine/ue';
import { AActor, UInstancedStaticMeshComponent, UStaticMeshComponent } from '../engine/world';
import { ACpvPuppet } from './CpvPuppet';
import { ECpvWord } from './CpvTypes';

enum ELayer { L_Blob, L_Splat, L_Puff, L_Ring, L_Star, L_Tooth, L_Flame, L_Note, L_Bolt, L_Confetti, L_Burst, L_Count }
const F_Billboard = 1, F_Stick = 2, F_Persist = 4, F_Fall = 8, F_Flat = 16;

interface FLayerSpec { Mesh: string; Capacity: number; bShadow: boolean }
const GSpecs: FLayerSpec[] = [
  { Mesh: '/Game/CPV/Props/SM_FxBlob.SM_FxBlob', Capacity: 280, bShadow: true },
  { Mesh: '/Game/CPV/Props/SM_FxSplat.SM_FxSplat', Capacity: 170, bShadow: false },
  { Mesh: '/Game/CPV/Props/SM_FxPuff.SM_FxPuff', Capacity: 70, bShadow: false },
  { Mesh: '/Game/CPV/Props/SM_FxRing.SM_FxRing', Capacity: 12, bShadow: false },
  { Mesh: '/Game/CPV/Props/SM_FxStar.SM_FxStar', Capacity: 70, bShadow: false },
  { Mesh: '/Game/CPV/Props/SM_FxTooth.SM_FxTooth', Capacity: 24, bShadow: false },
  { Mesh: '/Game/CPV/Props/SM_FxFlame.SM_FxFlame', Capacity: 70, bShadow: false },
  { Mesh: '/Game/CPV/Props/SM_FxNote.SM_FxNote', Capacity: 40, bShadow: false },
  { Mesh: '/Game/CPV/Props/SM_FxBolt.SM_FxBolt', Capacity: 14, bShadow: false },
  { Mesh: '/Game/CPV/Props/SM_FxConfetti.SM_FxConfetti', Capacity: 420, bShadow: false },
  { Mesh: '/Game/CPV/Props/SM_FxBurst.SM_FxBurst', Capacity: 14, bShadow: false },
];
const GHidden = new FTransform(FQuat.Identity, new FVector(0, 0, -2000), FVector.Splat(0.0001));
// Web only: how many splats may lie on the mat at each Effects setting (a splat is a detailed little
// sculpture, and a long bout would otherwise leave as many triangles on the mat as there are in the stands).
const SplatLimits = [60, 100, 140, 170];

class FParticle {
  bAlive = false;
  Pos = FVector.ZeroVector;
  Vel = FVector.ZeroVector;
  Rot = FRotator.ZeroRotator;
  Spin = FRotator.ZeroRotator;
  Axes = new FVector(1, 1, 1);
  Scale0 = 1;
  Scale1 = 1;
  Age = 0;
  Life = 1;
  Gravity = 0;
  Drag = 0;
  Flags = 0;
  Colour = FLinearColor.White;
}

class FLayer {
  Mesh: UInstancedStaticMeshComponent | null = null;
  Parts: FParticle[] = [];
  Xf: FTransform[] = [];   // here: the live particles' transforms, packed to the front (the C++ keeps one per slot)
  Next = 0;
  bDirty = true;
}

class FWord {
  Comp: UStaticMeshComponent | null = null;
  Mat: UMaterialInstanceDynamic | null = null;
  Pos = FVector.ZeroVector;
  Age = 0;
  Life = 0;
  Size = 1;
  Tilt = 0;
}

const WordNames = ['', 'Pow', 'Bam', 'Wham', 'Splat', 'Crunch', 'Bonk', 'Oof', 'KO', 'Zap', 'Boom'];
const WordInks = [new FLinearColor(1, 0.82, 0.1), new FLinearColor(1, 0.25, 0.15), new FLinearColor(1, 1, 1), new FLinearColor(0.3, 0.9, 1)];
const ConfettiColours = [new FLinearColor(1, 0.1, 0.1), new FLinearColor(1, 0.8, 0.05), new FLinearColor(0.1, 0.4, 1),
  new FLinearColor(0.1, 0.9, 0.3), new FLinearColor(1, 0.3, 0.7), new FLinearColor(1, 1, 1)];

export class ACpvFx extends AActor {
  private Layers: FLayer[] = [];
  private Words: FWord[] = [];
  private WordMeshes = new Map<ECpvWord, string | null>();
  private CamPos = new FVector(0, 1100, 250);
  private MatHalf = 300;
  private FloorZ = -110;
  private StepAccum = 0;
  private LastStepIndex = -1;
  private HaloSeen: number[] = [-10, -10];
  private HaloPos: FVector[] = [FVector.ZeroVector, FVector.ZeroVector];
  private Age = 0;
  private Rng = new FRandomStream(4242);
  private Dummy = new FParticle();

  constructor() {
    super();
    for (let i = 0; i < ELayer.L_Count; ++i) { this.Layers.push(new FLayer()); }
  }

  Build(InMatHalf: number, InFloorZ: number): void {
    this.MatHalf = InMatHalf;
    this.FloorZ = InFloorZ;
    for (let i = 0; i < ELayer.L_Count; ++i) {
      if (!Assets.StaticMesh(GSpecs[i].Mesh)) {
        console.warn(`Missing effect mesh ${GSpecs[i].Mesh}`);
        continue;
      }
      const Part = new UInstancedStaticMeshComponent();
      Part.SetStaticMesh(GSpecs[i].Mesh);
      Part.SetNumCustomDataFloats(3);
      Part.SetCastShadow(GSpecs[i].bShadow);
      const Layer = this.Layers[i];
      Layer.Mesh = Part;
      Layer.Parts = Array.from({ length: GSpecs[i].Capacity }, () => new FParticle());
      Layer.Xf = new Array<FTransform>(GSpecs[i].Capacity).fill(GHidden);
      Part.AddInstances(Layer.Xf);
      Part.SetDrawCount(0);
      Part.SetVisibility(false);
    }
    for (let i = 0; i < 6; ++i) {
      const Comp = new UStaticMeshComponent();
      Comp.SetCastShadow(false);
      Comp.SetVisibility(false);
      const W = new FWord();
      W.Comp = Comp;
      W.Mat = UMaterialInstanceDynamic.Create('/Game/CPV/Materials/M_Clay.M_Clay');
      this.Words.push(W);
    }
  }

  SetCamera(InCamPos: FVector): void { this.CamPos = InCamPos; }

  private SplatLimit(): number {
    return SplatLimits[FMath.Clamp(Math.round(GRenderer ? GRenderer.Settings.Effects : 3), 0, 3)];
  }

  private WordMesh(Word: ECpvWord): string | null {
    if (this.WordMeshes.has(Word)) { return this.WordMeshes.get(Word) ?? null; }
    const Key = Word as number;
    const Name = Key > 0 && Key < WordNames.length ? `SM_Word${WordNames[Key]}` : null;
    const Mesh = Name && Assets.StaticMesh(Name) ? Name : null;
    this.WordMeshes.set(Word, Mesh);
    return Mesh;
  }

  private Spawn(LayerId: ELayer, Pos: FVector, Colour: FLinearColor): FParticle {
    const Layer = this.Layers[LayerId];
    if (!Layer.Mesh || Layer.Parts.length === 0) { this.Dummy = new FParticle(); return this.Dummy; }
    const Size = LayerId === ELayer.L_Splat ? Math.min(Layer.Parts.length, this.SplatLimit()) : Layer.Parts.length;
    // Take the next free slot, or recycle the one after the last spawn when the layer is full.
    let Slot = Layer.Next % Size;
    for (let i = 0; i < Size; ++i) {
      const Try = (Layer.Next + i) % Size;
      if (!Layer.Parts[Try].bAlive) { Slot = Try; break; }
    }
    Layer.Next = (Slot + 1) % Size;
    const P = new FParticle();
    Layer.Parts[Slot] = P;
    P.bAlive = true;
    P.Pos = Pos;
    P.Colour = Colour;
    Layer.bDirty = true;   // its colour goes to the instance buffer with its transform, on the next step
    return P;
  }

  Impact(At: FVector, Word: ECpvWord, Size: number, Colour: FLinearColor): void {
    const B = this.Spawn(ELayer.L_Burst, At, Colour);
    B.Flags = F_Billboard;
    B.Scale0 = Size * 0.35;
    B.Scale1 = Size;
    B.Life = 0.3;
    B.Rot = B.Rot.WithRoll(this.Rng.FRandRange(0, 360));
    if (Word === ECpvWord.None) { return; }
    const Mesh = this.WordMesh(Word);
    if (!Mesh) { return; }
    let Use = this.Words[0];
    for (const W of this.Words) {
      if (W.Age >= W.Life) { Use = W; break; }
      if (W.Age > Use.Age) { Use = W; }
    }
    if (!Use.Comp) { return; }
    Use.Comp.SetStaticMesh(Mesh);
    Use.Pos = At.Add(new FVector(0, 0, 34 * Size));
    Use.Age = 0;
    Use.Life = 0.75;
    Use.Size = Size * 1.1;
    Use.Tilt = this.Rng.FRandRange(-16, 16);
    if (Use.Mat) {
      Use.Comp.SetMaterial(0, Use.Mat);
      Use.Mat.SetVectorParameterValue('Tint', WordInks[this.Rng.RandRange(0, 3)]);
    }
  }

  Blobs(At: FVector, Dir: FVector, Count: number, A: FLinearColor, B: FLinearColor, Speed: number, bStick = true): void {
    const Rng = this.Rng;
    for (let i = 0; i < Count; ++i) {
      const Where = At.Add(Rng.VRand().Mul(8));
      const P = this.Spawn(ELayer.L_Blob, Where, Rng.FRand() < 0.6 ? A : B);
      const Spread = Dir.GetSafeNormal().Mul(0.9).Add(Rng.VRand().Mul(0.75)).Add(new FVector(0, 0, 0.7)).GetSafeNormal();
      P.Vel = Spread.Mul(Speed * Rng.FRandRange(0.45, 1.2));
      P.Gravity = 1500;
      P.Scale0 = P.Scale1 = Rng.FRandRange(0.5, 1.5);
      const AX = Rng.FRandRange(0.7, 1.3), AY = Rng.FRandRange(0.7, 1.3), AZ = Rng.FRandRange(0.7, 1.3);
      P.Axes = new FVector(AX, AY, AZ);
      const RP = Rng.FRandRange(0, 360), RY = Rng.FRandRange(0, 360);
      P.Rot = new FRotator(RP, RY, 0);
      const SP = Rng.FRandRange(-500, 500), SY = Rng.FRandRange(-500, 500);
      P.Spin = new FRotator(SP, SY, 0);
      P.Life = Rng.FRandRange(5, 9);
      P.Flags = F_Fall | (bStick ? F_Stick : 0);
    }
  }

  Puff(At: FVector, Size: number, Count = 3, Colour: FLinearColor = FLinearColor.White): void {
    const Rng = this.Rng;
    for (let i = 0; i < Count; ++i) {
      const P = this.Spawn(ELayer.L_Puff, At.Add(Rng.VRand().Mul(14 * Size)), Colour);
      P.Vel = Rng.VRand().Mul(60).Add(new FVector(0, 0, 40)).Mul(Size);
      P.Drag = 3;
      P.Scale0 = Size * 0.3;
      P.Scale1 = Size * Rng.FRandRange(0.8, 1.3);
      const RP = Rng.FRandRange(0, 360), RY = Rng.FRandRange(0, 360);
      P.Rot = new FRotator(RP, RY, 0);
      P.Life = Rng.FRandRange(0.35, 0.6);
    }
  }

  Ring(At: FVector, Size: number, Colour: FLinearColor): void {
    const P = this.Spawn(ELayer.L_Ring, At, Colour);
    P.Scale0 = Size * 0.15;
    P.Scale1 = Size;
    P.Life = 0.45;
  }

  Stars(At: FVector, Count: number): void {
    const Rng = this.Rng;
    for (let i = 0; i < Count; ++i) {
      const P = this.Spawn(ELayer.L_Star, At, FLinearColor.White);
      const Dir = Rng.VRand().Add(new FVector(0, 0, 0.8)).GetSafeNormal();
      P.Vel = Dir.Mul(Rng.FRandRange(180, 420));
      P.Gravity = 700;
      P.Scale0 = P.Scale1 = Rng.FRandRange(0.7, 1.4);
      P.Flags = F_Billboard;
      P.Spin = P.Spin.WithRoll(Rng.FRandRange(-400, 400));
      P.Life = Rng.FRandRange(0.45, 0.8);
    }
  }

  Teeth(At: FVector, Dir: FVector, Count: number): void {
    const Rng = this.Rng;
    for (let i = 0; i < Count; ++i) {
      const P = this.Spawn(ELayer.L_Tooth, At, FLinearColor.White);
      const Fling = Dir.GetSafeNormal().Add(Rng.VRand().Mul(0.5)).Add(new FVector(0, 0, 0.9)).GetSafeNormal();
      P.Vel = Fling.Mul(Rng.FRandRange(260, 480));
      P.Gravity = 1500;
      P.Scale0 = P.Scale1 = 1.6;
      const SP = Rng.FRandRange(-700, 700), SY = Rng.FRandRange(-700, 700);
      P.Spin = new FRotator(SP, SY, 0);
      P.Life = 4;
      P.Flags = F_Fall;
    }
  }

  Flames(At: FVector, Dir: FVector, Count: number, Speed = 420): void {
    const Rng = this.Rng;
    for (let i = 0; i < Count; ++i) {
      const P = this.Spawn(ELayer.L_Flame, At.Add(Rng.VRand().Mul(10)), FLinearColor.White);
      const Fling = Dir.GetSafeNormal().Add(Rng.VRand().Mul(0.28)).GetSafeNormal();
      P.Vel = Fling.Mul(Speed * Rng.FRandRange(0.6, 1.15)).Add(new FVector(0, 0, 60));
      P.Drag = 1.6;
      P.Scale0 = 0.6;
      P.Scale1 = Rng.FRandRange(1.3, 2.4);
      P.Rot = P.Rot.WithYaw(Rng.FRandRange(0, 360));
      P.Life = Rng.FRandRange(0.3, 0.55);
    }
  }

  Notes(At: FVector, Dir: FVector, Count: number, Colour: FLinearColor): void {
    const Rng = this.Rng;
    for (let i = 0; i < Count; ++i) {
      const P = this.Spawn(ELayer.L_Note, At.Add(Rng.VRand().Mul(12)), Colour);
      const Fling = Dir.GetSafeNormal().Add(Rng.VRand().Mul(0.3)).GetSafeNormal();
      P.Vel = Fling.Mul(Rng.FRandRange(380, 620));
      P.Drag = 0.6;
      P.Scale0 = 0.8;
      P.Scale1 = Rng.FRandRange(1.2, 2.0);
      P.Flags = F_Billboard;
      P.Rot = P.Rot.WithRoll(Rng.FRandRange(-25, 25));
      P.Life = Rng.FRandRange(0.45, 0.8);
    }
  }

  Bolt(From: FVector, To: FVector): void {
    // A zig-zag of bolt pieces from one point to the other.
    const Delta = To.Sub(From);
    const Pieces = FMath.Clamp(FMath.RoundToInt(Delta.Size() / 95), 1, 6);
    for (let i = 0; i < Pieces; ++i) {
      const A = From.Add(Delta.Mul(i / Pieces));
      const B = From.Add(Delta.Mul((i + 1) / Pieces));
      const P = this.Spawn(ELayer.L_Bolt, A.Add(B).Mul(0.5).Add(this.Rng.VRand().Mul(12)), FLinearColor.White);
      P.Rot = FRotationMatrix.MakeFromZX(B.Sub(A), this.CamPos.Sub(A)).Rotator();
      P.Scale0 = P.Scale1 = B.Sub(A).Size() / 100;
      P.Axes = new FVector(1, 1.4, 1);
      P.Life = 0.22;
    }
  }

  Confetti(Count: number): void {
    const Rng = this.Rng;
    for (let i = 0; i < Count; ++i) {
      const X = Rng.FRandRange(-this.MatHalf, this.MatHalf), Y = Rng.FRandRange(-this.MatHalf, this.MatHalf), Z = Rng.FRandRange(380, 720);
      const P = this.Spawn(ELayer.L_Confetti, new FVector(X, Y, Z), ConfettiColours[Rng.RandRange(0, 5)]);
      const VX = Rng.FRandRange(-40, 40), VY = Rng.FRandRange(-40, 40), VZ = Rng.FRandRange(-190, -90);
      P.Vel = new FVector(VX, VY, VZ);
      P.Scale0 = P.Scale1 = Rng.FRandRange(1.2, 2.2);
      const RP = Rng.FRandRange(0, 360), RY = Rng.FRandRange(0, 360), RR = Rng.FRandRange(0, 360);
      P.Rot = new FRotator(RP, RY, RR);
      const SP = Rng.FRandRange(-300, 300), SY = Rng.FRandRange(-200, 200), SR = Rng.FRandRange(-300, 300);
      P.Spin = new FRotator(SP, SY, SR);
      P.Life = Rng.FRandRange(6, 10);
      P.Flags = F_Fall | F_Flat;
    }
  }

  Splat(At: FVector, Size: number, Colour: FLinearColor): void {
    const P = this.Spawn(ELayer.L_Splat, new FVector(At.X, At.Y, 0.4 + this.Rng.FRandRange(0, 0.5)), Colour);
    P.Scale0 = P.Scale1 = Size * this.Rng.FRandRange(0.7, 1.25);
    P.Rot = P.Rot.WithYaw(this.Rng.FRandRange(0, 360));
    P.Flags = F_Persist;
  }

  Explosion(At: FVector, Size: number): void {
    this.Puff(At, 2.6 * Size, 7, new FLinearColor(0.12, 0.12, 0.13));
    this.Puff(At.Add(new FVector(0, 0, 30)), 2 * Size, 5, new FLinearColor(1, 0.55, 0.1));
    for (let i = 0; i < 10; ++i) {
      this.Flames(At, this.Rng.VRand().Add(new FVector(0, 0, 0.5)), 1, 520 * Size);
    }
    this.Ring(new FVector(At.X, At.Y, 3), 5 * Size, new FLinearColor(1, 0.8, 0.3));
    this.Stars(At, 8);
    this.Impact(At.Add(new FVector(0, 0, 60)), ECpvWord.Boom, 2.6 * Size, new FLinearColor(1, 0.7, 0.1));
  }

  /** Dizzy stars circling a head; call every frame it should show. */
  Halo(Slot: number, HeadTop: FVector): void {
    if (Slot >= 0 && Slot < 2) {
      this.HaloSeen[Slot] = this.Age;
      this.HaloPos[Slot] = HeadTop;
    }
  }

  Clear(bKeepSplats: boolean): void {
    for (let i = 0; i < ELayer.L_Count; ++i) {
      if (bKeepSplats && i === ELayer.L_Splat) { continue; }
      for (const P of this.Layers[i].Parts) { P.bAlive = false; }
      this.Layers[i].bDirty = true;
    }
    for (const W of this.Words) {
      W.Age = W.Life;
      if (W.Comp) { W.Comp.SetVisibility(false); }
    }
  }

  private StepLayer(Layer: FLayer, Dt: number): void {
    if (!Layer.Mesh) { return; }
    let bAny = Layer.bDirty;
    // The desktop game parks dead particles out of sight, one instance per slot. Drawing a few hundred
    // hidden lumps every frame is too dear here, so the live ones are packed to the front and only they are drawn.
    let Shown = 0;
    for (let i = 0; i < Layer.Parts.length; ++i) {
      const P = Layer.Parts[i];
      if (!P.bAlive) { continue; }
      bAny = true;
      if (!(P.Flags & F_Persist)) {
        P.Age += Dt;
        if (P.Age >= P.Life) {
          P.bAlive = false;
          continue;
        }
      }
      const bResting = (P.Flags & F_Fall) !== 0 && P.Vel.IsNearlyZero(1.0) && P.Age > 0.1;
      if (!bResting) {
        P.Vel = P.Vel.WithZ(P.Vel.Z - P.Gravity * Dt);
        P.Vel = P.Vel.Mul(FMath.Max(0, 1 - P.Drag * Dt));
        P.Pos = P.Pos.Add(P.Vel.Mul(Dt));
        P.Rot = P.Rot.Add(P.Spin.Mul(Dt));
      }
      if (P.Flags & F_Fall) {
        // Lands on the mat inside the ring, on the arena floor outside it.
        const bOnMat = FMath.Abs(P.Pos.X) < this.MatHalf && FMath.Abs(P.Pos.Y) < this.MatHalf;
        const Ground = (bOnMat ? 0 : this.FloorZ) + 2;
        if (P.Pos.Z <= Ground && P.Vel.Z <= 0) {
          P.Pos = P.Pos.WithZ(Ground);
          if ((P.Flags & F_Stick) && bOnMat && this.Rng.FRand() < 0.5) {
            this.Splat(P.Pos, P.Scale0 * 0.42, P.Colour);
            P.bAlive = false;
            continue;
          }
          if (P.Vel.Z < -220 && !(P.Flags & F_Flat)) {
            P.Vel = new FVector(P.Vel.X * 0.45, P.Vel.Y * 0.45, -P.Vel.Z * 0.3);
            P.Spin = P.Spin.Mul(0.4);
          } else {
            P.Vel = FVector.ZeroVector;
            P.Spin = FRotator.ZeroRotator;
            if (P.Flags & F_Flat) { P.Rot = new FRotator(0, P.Rot.Yaw, 0); }
          }
        }
      }
      const U = (P.Flags & F_Persist) ? 0 : P.Age / P.Life;
      let Scale = FMath.Lerp(P.Scale0, P.Scale1, FMath.Sqrt(U));
      if (U > 0.8) { Scale *= (1 - U) / 0.2; }
      let Q = P.Rot.Quaternion();
      if (P.Flags & F_Billboard) {
        Q = this.CamPos.Sub(P.Pos).Rotation().Quaternion().Mul(new FRotator(0, 0, P.Rot.Roll).Quaternion());
      }
      Layer.Mesh.SetCustomData(Shown, [P.Colour.R, P.Colour.G, P.Colour.B]);
      Layer.Xf[Shown++] = new FTransform(Q, P.Pos, P.Axes.Mul(Scale));
    }
    if (bAny) {
      Layer.Mesh.BatchUpdateInstancesTransforms(0, Layer.Xf, Shown);
      Layer.Mesh.SetDrawCount(Shown);
      Layer.Mesh.SetVisibility(Shown > 0);
      Layer.bDirty = false;
    }
  }

  override Tick(DeltaTime: number): void {
    this.Age += DeltaTime;
    this.StepAccum += DeltaTime;
    let bStep = ACpvPuppet.StepRate <= 0;
    if (!bStep) {
      const StepIndex = FMath.FloorToInt64(this.GetWorld().GetTimeSeconds() * ACpvPuppet.StepRate);
      bStep = StepIndex !== this.LastStepIndex;
      this.LastStepIndex = StepIndex;
    }
    if (!bStep) { return; }
    const Dt = FMath.Clamp(this.StepAccum, 0.001, 0.2);
    this.StepAccum = 0;

    // Dizzy stars: four per dazed head, re-posed every frame they are wanted.
    for (let Slot = 0; Slot < 2; ++Slot) {
      if (this.Age - this.HaloSeen[Slot] > 0.2) { continue; }
      for (let k = 0; k < 4; ++k) {
        const A = this.Age * 5.5 + k * UE_HALF_PI;
        const P = this.Spawn(ELayer.L_Star, this.HaloPos[Slot].Add(new FVector(FMath.Cos(A) * 24, FMath.Sin(A) * 24, 8 + 4 * FMath.Sin(A * 2))), FLinearColor.White);
        P.Flags = F_Billboard;
        P.Scale0 = P.Scale1 = 0.9;
        P.Life = Dt * 1.05;
        P.Rot = P.Rot.WithRoll(A * 40);
      }
    }
    // If the Effects setting was lowered, the splats beyond the new limit are lifted off the mat.
    const Splats = this.Layers[ELayer.L_Splat];
    for (let i = this.SplatLimit(); i < Splats.Parts.length; ++i) {
      if (Splats.Parts[i].bAlive) { Splats.Parts[i].bAlive = false; Splats.bDirty = true; }
    }
    for (let i = 0; i < ELayer.L_Count; ++i) { this.StepLayer(this.Layers[i], Dt); }

    for (const W of this.Words) {
      if (W.Age >= W.Life || !W.Comp) { continue; }
      W.Age += Dt;
      if (W.Age >= W.Life) {
        W.Comp.SetVisibility(false);
        continue;
      }
      const U = W.Age / W.Life;
      // Pops in with an overshoot, hangs, then shrinks away.
      let Scale = U < 0.18 ? FMath.Lerp(0.3, 1.25, U / 0.18) : (U < 0.3 ? FMath.Lerp(1.25, 1, (U - 0.18) / 0.12) : 1);
      if (U > 0.82) { Scale *= (1 - U) / 0.18; }
      const Pos = W.Pos.Add(new FVector(0, 0, 26 * U));
      const Q = this.CamPos.Sub(Pos).Rotation().Quaternion().Mul(new FRotator(0, 0, W.Tilt).Quaternion());
      W.Comp.SetWorldTransform(new FTransform(Q, Pos, FVector.Splat(Scale * W.Size)));
      W.Comp.SetVisibility(true);
    }
  }
}
