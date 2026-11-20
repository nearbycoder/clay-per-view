// Port of CpvPuppet.h / CpvPuppet.cpp: a clay character on the shared skeleton, animated pose-to-pose and
// shown in stepped "frames" like stop-motion. Fighters, the referee and the commentators are all puppets.

import { UMaterialInstanceDynamic } from '../engine/materials';
import { FLinearColor, FMath, FQuat, FRotator, FTransform, FVector, FVector2D } from '../engine/ue';
import { AActor, UPoseableMeshComponent, UStaticMeshComponent } from '../engine/world';
import { CpvAnim } from './CpvAnims';
import { ECpvBone, ECpvFace, ECpvJoint, ECpvMouth, FCpvClip, FCpvPose, FCpvRig, FCpvRigExtras } from './CpvPose';

/** A damped two-axis wobble for hair, hats, bellies and skirts. */
export class FCpvSpring {
  Angle = FVector2D.ZeroVector; // degrees: X = tip forward, Y = tip to the right
  Vel = FVector2D.ZeroVector;
  Stiffness = 190;
  Damping = 9;
  Gain = 0.5;   // how hard acceleration of the attachment point kicks the tip
  Limit = 38;

  Step(Dt: number, LocalAccel: FVector2D): void {
    // The attachment's acceleration pushes the tip the other way; a spring pulls it back upright.
    const Sub = FMath.Clamp(FMath.CeilToInt(Dt / 0.012), 1, 12);
    const H = Dt / Sub;
    for (let i = 0; i < Sub; ++i) {
      this.Vel = this.Vel.Add(this.Angle.Mul(-this.Stiffness).Sub(this.Vel.Mul(this.Damping)).Sub(LocalAccel.Mul(this.Gain)).Mul(H));
      this.Angle = this.Angle.Add(this.Vel.Mul(H));
    }
    this.Angle = new FVector2D(FMath.Clamp(this.Angle.X, -this.Limit, this.Limit), FMath.Clamp(this.Angle.Y, -this.Limit, this.Limit));
  }

  Rotation(): FQuat {
    return FQuat.FromAxisAngle(new FVector(0, 1, 0), FMath.DegreesToRadians(this.Angle.X))
      .Mul(FQuat.FromAxisAngle(new FVector(-1, 0, 0), FMath.DegreesToRadians(this.Angle.Y)));
  }
}

export class ACpvPuppet extends AActor {
  /** Frames per second the whole cast is animated at; 0 = smooth. */
  static StepRate = 12;

  /** Visual-only adjustments (the actor itself stays where gameplay put it). */
  VisualOffset = FVector.ZeroVector;
  VisualScale = new FVector(1, 1, 1);
  VisualYaw = 0;
  HeadSquash = new FVector2D(1, 1);
  BoneScale: number[] = new Array<number>(ECpvBone.Count).fill(1);
  bHidden = false;
  /** Play everything left-right swapped (fighters facing screen-left do, so both open up toward the camera). */
  bMirror = false;

  protected Mesh = new UPoseableMeshComponent();
  protected Materials: UMaterialInstanceDynamic[] = [];
  protected Rig = new FCpvRig();
  protected CharacterName = '';

  protected ClipName = '';
  protected Clip: FCpvClip | null = null;
  protected ClipTime = 0;
  protected ClipRate = 1;
  protected FromPose = new FCpvPose();
  protected LastPose = new FCpvPose();
  protected BlendTime = 0;
  protected BlendLeft = 0;
  protected FreezeLeft = 0;
  protected MirrorAlpha = 0;

  protected FaceOverride = ECpvFace.Neutral;
  protected FaceOverrideLeft = 0;
  protected BlinkIn = 2;
  protected BlinkLeft = 0;
  protected Flash = 0;
  protected JoltAngle = FVector2D.ZeroVector;
  protected JoltVel = FVector2D.ZeroVector;
  protected LookPoint = FVector.ZeroVector;
  protected LookWeight = 0;
  protected LookNow = FVector2D.ZeroVector;
  protected Age = 0;
  protected Seed = FMath.FRand() * 100;

  protected HairSpring = new FCpvSpring();
  protected TailSpring = new FCpvSpring();
  protected BellySpring = new FCpvSpring();
  protected SkirtSpring = new FCpvSpring();
  protected LastHeadPos = FVector.ZeroVector;
  protected LastHeadVel = FVector.ZeroVector;
  protected LastHipPos = FVector.ZeroVector;
  protected LastHipVel = FVector.ZeroVector;
  protected bHaveHistory = false;

  protected LastStepIndex = -1;
  protected StepAccum = 0;
  protected bForceStep = true;

  constructor() {
    super();
    const Tail = this.TailSpring, Belly = this.BellySpring, Skirt = this.SkirtSpring;
    Tail.Stiffness = 120; Tail.Damping = 6; Tail.Gain = 0.8; Tail.Limit = 55;
    Belly.Stiffness = 260; Belly.Damping = 10; Belly.Gain = 0.25; Belly.Limit = 16;
    Skirt.Stiffness = 150; Skirt.Damping = 7; Skirt.Gain = 0.4; Skirt.Limit = 22;
  }

  /** Loads the character mesh SK_<Name>. */
  SetCharacter(Name: string): void {
    this.CharacterName = Name;
    if (!this.Mesh.SetSkinnedAssetAndUpdate(`SK_${Name}`)) {
      console.error(`Missing character mesh SK_${Name}`);
      return;
    }
    this.Rig.Init(this.Mesh);
    // Materials are chosen by slot name: "Glow" slots are emissive (LED faces, lit soles), everything else is clay.
    this.Materials = [];
    const Slots = this.Mesh.GetMaterialSlotNames();
    for (let i = 0; i < this.Mesh.GetNumMaterials(); ++i) {
      const bGlow = Slots[i].includes('Glow');
      const Mid = UMaterialInstanceDynamic.Create(bGlow ? 'M_Glow' : 'M_Clay');
      this.Mesh.SetMaterial(i, Mid);
      Mid.SetScalarParameterValue('Boil', 0.35);
      Mid.SetScalarParameterValue('BoilRate', FMath.Max(ACpvPuppet.StepRate, 1));
      this.Materials.push(Mid);
    }
    this.bHaveHistory = false;
    this.bForceStep = true;
    if (!this.Clip) { this.Play('Idle', 0); }
  }

  /** Multiplies the clay colours (used to tell twins apart in a mirror match). */
  SetTint(Tint: FLinearColor): void {
    for (const Mid of this.Materials) { Mid.SetVectorParameterValue('Tint', Tint); }
  }
  GetCharacterName(): string { return this.CharacterName; }

  Play(InClip: string, InBlendTime = 0.1, Rate = 1, bRestart = true): void {
    if (!bRestart && this.ClipName === InClip) {
      this.ClipRate = Rate;
      return;
    }
    if (!CpvAnim.Has(InClip)) {
      console.warn(`Unknown clip ${InClip}`);
      return;
    }
    this.FromPose = this.LastPose.Clone();
    // Clips may wind joints past a full turn (rolls, tumbles); blend from the equivalent short angle.
    this.FromPose.J = this.FromPose.J.map((A) => new FVector(FRotator.NormalizeAxis(A.X), FRotator.NormalizeAxis(A.Y), FRotator.NormalizeAxis(A.Z)));
    this.BlendTime = InBlendTime;
    this.BlendLeft = InBlendTime;
    this.ClipName = InClip;
    this.Clip = CpvAnim.Get(InClip);
    this.ClipTime = 0;
    this.ClipRate = Rate;
  }
  GetClip(): string { return this.ClipName; }
  GetClipTime(): number { return this.ClipTime; }
  GetClipLength(): number { return this.Clip ? this.Clip.Length : 0; }
  IsClipDone(): boolean { return !this.Clip || (!this.Clip.bLoop && this.ClipTime >= this.Clip.Length); }
  SetClipTime(NewTime: number): void { this.ClipTime = NewTime; }
  SetRate(NewRate: number): void { this.ClipRate = NewRate; }
  /** Hit-stop: hold the current frame. */
  Freeze(Seconds: number): void { this.FreezeLeft = FMath.Max(this.FreezeLeft, Seconds); }
  IsFrozen(): boolean { return this.FreezeLeft > 0; }

  SetFace(Face: ECpvFace, Seconds: number): void {
    this.FaceOverride = Face;
    this.FaceOverrideLeft = Seconds;
  }
  HitFlash(Strength = 1): void { this.Flash = FMath.Max(this.Flash, Strength); }
  /** Additive flinch in local axes (X = knocked backward, Y = knocked to the right). */
  Jolt(Back: number, Side: number): void {
    this.JoltVel = this.JoltVel.Add(new FVector2D(Back, Side).Mul(14));
    this.JoltAngle = this.JoltAngle.Add(new FVector2D(Back, Side).Mul(0.5));
  }
  SetLookTarget(WorldPoint: FVector, Weight: number): void {
    this.LookPoint = WorldPoint;
    this.LookWeight = Weight;
  }
  /** Show the next frame immediately instead of waiting for the stop-motion step. */
  ForceStep(): void { this.bForceStep = true; }

  GetBoneWorld(Bone: ECpvBone): FTransform { return this.Rig.BoneCS(Bone).Mul(this.Mesh.GetComponentTransform()); }
  GetBoneLocation(Bone: ECpvBone): FVector { return this.GetBoneWorld(Bone).GetLocation(); }
  GetHeadLocation(): FVector {
    const Head = this.GetBoneWorld(ECpvBone.Head);
    return Head.GetLocation().Add(Head.GetRotation().RotateVector(new FVector(0, 14, 0))); // bone Y runs up the head
  }
  GetMesh(): UPoseableMeshComponent { return this.Mesh; }
  GetRig(): FCpvRig { return this.Rig; }
  GetHeight(): number { return this.Rig.Height; }

  /** Attach a prop to a bone (it then follows the stepped animation). */
  AttachProp(Prop: UStaticMeshComponent | null, Bone: ECpvBone, Relative: FTransform): void {
    if (!Prop) { return; }
    Prop.AttachToComponent(this.Mesh, FCpvRig.BoneName(Bone));
    Prop.SetRelativeTransform(Relative);
  }

  override Destroy(): void {
    super.Destroy();
    this.Mesh.DestroyComponent();
  }

  override Tick(DeltaTime: number): void {
    this.Age += DeltaTime;

    if (this.FreezeLeft > 0) {
      this.FreezeLeft -= DeltaTime;
    } else {
      this.ClipTime += DeltaTime * this.ClipRate;
      this.BlendLeft = FMath.Max(0, this.BlendLeft - DeltaTime);
    }
    if (this.Flash > 0) {
      this.Flash = FMath.Max(0, this.Flash - DeltaTime * 7);
      for (const Mid of this.Materials) { Mid.SetScalarParameterValue('Flash', this.Flash * 0.8); }
    }

    // The whole cast changes pose on the same clock, a fixed number of times per second.
    this.StepAccum += DeltaTime;
    let bStep = this.bForceStep || ACpvPuppet.StepRate <= 0;
    if (!bStep) {
      const StepIndex = FMath.FloorToInt64(this.GetWorld().GetTimeSeconds() * ACpvPuppet.StepRate);
      bStep = StepIndex !== this.LastStepIndex;
      this.LastStepIndex = StepIndex;
    }
    if (bStep && this.Rig.IsValid()) {
      this.UpdatePose(FMath.Clamp(this.StepAccum, 0.001, 0.25));
      this.StepAccum = 0;
      this.bForceStep = false;
    }
    this.Mesh.SetVisibility(!this.bHidden);
  }

  protected ApplyFace(Face: ECpvFace, X: FCpvRigExtras, StepDt: number): void {
    const T = this.Age + this.Seed;
    switch (Face) {
      case ECpvFace.Neutral: X.Mouth = ECpvMouth.Closed; X.LidClose = 0.08; break;
      case ECpvFace.Angry: X.Mouth = ECpvMouth.Grit; X.LidClose = 0.2; X.BrowAngry = 0.8; X.BrowRaise = -0.8; break;
      case ECpvFace.Attack: X.Mouth = ECpvMouth.Open; X.LidClose = 0.05; X.BrowAngry = 1; X.BrowRaise = -0.5; break;
      case ECpvFace.Effort: X.Mouth = ECpvMouth.Grit; X.LidClose = 0.45; X.BrowAngry = 1; X.BrowRaise = -1.2; break;
      case ECpvFace.Hurt: X.Mouth = ECpvMouth.Ouch; X.LidClose = 0.95; X.BrowAngry = -0.9; X.BrowRaise = 1.2; break;
      case ECpvFace.Dazed:
        X.Mouth = ECpvMouth.Ouch; X.LidClose = 0.3; X.BrowAngry = -0.6; X.BrowRaise = 1;
        X.PupilL = new FVector2D(FMath.Cos(T * 9), FMath.Sin(T * 9)).Mul(1.5);
        X.PupilR = new FVector2D(FMath.Cos(T * 9 + 2.6), FMath.Sin(T * 9 + 2.6)).Mul(1.5);
        break;
      case ECpvFace.Happy: X.Mouth = ECpvMouth.Grin; X.LidClose = 0.1; X.BrowAngry = -0.2; X.BrowRaise = 1.4; break;
      case ECpvFace.Smug: X.Mouth = ECpvMouth.Closed; X.LidClose = 0.4; X.BrowAngry = 0.3; X.BrowRaise = 0.6; break;
      case ECpvFace.Shock: X.Mouth = ECpvMouth.Open; X.LidClose = -1; X.BrowAngry = -0.5; X.BrowRaise = 2.6; break;
      case ECpvFace.KO: X.Mouth = ECpvMouth.Open; X.LidClose = 1; X.BrowAngry = -0.7; X.BrowRaise = 0.6; break;
    }
    // Blinks, unless the eyes are already shut or wide open.
    this.BlinkIn -= StepDt;
    if (this.BlinkIn <= 0) {
      this.BlinkLeft = 0.13;
      this.BlinkIn = FMath.FRandRange(1.6, 4.5);
    }
    if (this.BlinkLeft > 0) {
      this.BlinkLeft -= StepDt;
      if (X.LidClose >= 0 && X.LidClose < 0.9) { X.LidClose = 1; }
    }
  }

  protected UpdatePose(StepDt: number): void {
    // --- body pose: current clip, cross-faded from wherever the puppet was ---
    let Pose = this.Clip ? this.Clip.Sample(this.ClipTime) : new FCpvPose();
    if (this.BlendLeft > 0 && this.BlendTime > 0) {
      const A = 1 - this.BlendLeft / this.BlendTime;
      Pose = FCpvPose.Blend(this.FromPose, Pose, A * A * (3 - 2 * A));
    }
    this.LastPose = Pose.Clone();
    this.MirrorAlpha = FMath.FInterpConstantTo(this.MirrorAlpha, this.bMirror ? 1 : 0, StepDt, 8);
    if (this.MirrorAlpha > 0) {
      Pose = this.MirrorAlpha >= 1 ? Pose.Mirrored() : FCpvPose.Blend(Pose, Pose.Mirrored(), this.MirrorAlpha);
    }

    // --- flinch: a damped spring kicked by Jolt() ---
    {
      const Sub = 4;
      const H = StepDt / Sub;
      for (let i = 0; i < Sub; ++i) {
        this.JoltVel = this.JoltVel.Add(this.JoltAngle.Mul(-240).Sub(this.JoltVel.Mul(16)).Mul(H));
        this.JoltAngle = this.JoltAngle.Add(this.JoltVel.Mul(H));
      }
      this.JoltAngle = new FVector2D(FMath.Clamp(this.JoltAngle.X, -40, 40), FMath.Clamp(this.JoltAngle.Y, -40, 40));
      const J = this.JoltAngle;
      Pose.J[ECpvJoint.Spine] = Pose.J[ECpvJoint.Spine].Add(new FVector(-J.X * 0.5, 0, J.Y * 0.5));
      Pose.J[ECpvJoint.Chest] = Pose.J[ECpvJoint.Chest].Add(new FVector(-J.X * 0.4, 0, J.Y * 0.4));
      Pose.J[ECpvJoint.Head] = Pose.J[ECpvJoint.Head].Add(new FVector(-J.X * 0.8, 0, J.Y * 0.6));
    }

    const X = new FCpvRigExtras();
    for (let i = 0; i < ECpvBone.Count; ++i) { X.Scale[i] = this.BoneScale[i]; }
    X.HeadSquash = this.HeadSquash;

    // --- face ---
    if (this.FaceOverrideLeft > 0) { this.FaceOverrideLeft -= StepDt; }
    this.ApplyFace(this.FaceOverrideLeft > 0 ? this.FaceOverride : Pose.Face, X, StepDt);

    // --- look at a point (head turn plus a little eye travel) ---
    const Actor = this.GetActorTransform();
    let LookWant = FVector2D.ZeroVector;
    if (this.LookWeight > 0) {
      const Local = Actor.InverseTransformPosition(this.LookPoint).Sub(new FVector(0, 0, this.Rig.HeadHeight));
      const BodyYaw = Pose.J[ECpvJoint.Pelvis].Y + Pose.J[ECpvJoint.Spine].Y + Pose.J[ECpvJoint.Chest].Y + Pose.J[ECpvJoint.Neck].Y + Pose.J[ECpvJoint.Head].Y;
      const Yaw = FMath.RadiansToDegrees(FMath.Atan2(Local.Y, FMath.Max(Local.X, 1)));
      const Pitch = -FMath.RadiansToDegrees(FMath.Atan2(Local.Z, FMath.Max(Local.Size2D(), 1)));
      LookWant = new FVector2D(FMath.Clamp(Yaw - BodyYaw, -55, 55), FMath.Clamp(Pitch, -30, 30)).Mul(this.LookWeight);
    }
    this.LookNow = this.LookNow.Lerp(LookWant, FMath.Clamp(StepDt * 9, 0, 1));
    X.Look = this.LookNow;
    const Eye = new FVector2D(FMath.Clamp(this.LookNow.X * 0.03, -1.1, 1.1), FMath.Clamp(-this.LookNow.Y * 0.03, -0.8, 0.8));
    X.PupilL = X.PupilL.Add(Eye);
    X.PupilR = X.PupilR.Add(Eye);

    // --- secondary motion from how the head and hips moved since the last frame ---
    X.Hair = this.HairSpring.Rotation();
    X.Tail = this.TailSpring.Rotation();
    X.Belly = this.BellySpring.Rotation();
    X.Skirt = this.SkirtSpring.Rotation();

    this.Mesh.SetWorldTransform(new FTransform(new FRotator(0, Actor.Rotator().Yaw + this.VisualYaw, 0), Actor.GetLocation().Add(this.VisualOffset), this.VisualScale));
    this.Rig.Apply(Pose, X);

    const HeadPos = this.GetBoneLocation(ECpvBone.Head);
    const HipPos = this.GetBoneLocation(ECpvBone.Pelvis);
    if (this.bHaveHistory) {
      const HeadVel = HeadPos.Sub(this.LastHeadPos).Div(StepDt);
      const HipVel = HipPos.Sub(this.LastHipPos).Div(StepDt);
      const HeadAcc = Actor.InverseTransformVectorNoScale(HeadVel.Sub(this.LastHeadVel).Div(StepDt)).GetClampedToMaxSize(6000);
      const HipAcc = Actor.InverseTransformVectorNoScale(HipVel.Sub(this.LastHipVel).Div(StepDt)).GetClampedToMaxSize(6000);
      this.HairSpring.Step(StepDt, new FVector2D(HeadAcc.X, HeadAcc.Y));
      this.TailSpring.Step(StepDt, new FVector2D(HeadAcc.X, HeadAcc.Y));
      this.BellySpring.Step(StepDt, new FVector2D(HipAcc.X + HipAcc.Z * 0.6, HipAcc.Y));
      this.SkirtSpring.Step(StepDt, new FVector2D(HipAcc.X, HipAcc.Y));
      this.LastHeadVel = HeadVel;
      this.LastHipVel = HipVel;
    }
    this.LastHeadPos = HeadPos;
    this.LastHipPos = HipPos;
    this.bHaveHistory = true;
  }
}
