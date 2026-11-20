// Port of CpvPose.h / CpvPose.cpp: sculpted poses, pose-to-pose clips and the rig that turns a pose into
// bone transforms for any character's proportions.

import { FMath, FQuat, FRotator, FTransform, FVector, FVector2D, INDEX_NONE, KINDA_SMALL_NUMBER } from '../engine/ue';
import type { UPoseableMeshComponent } from '../engine/world';

/** Bones every clay character shares (names match Art/cpv/charbase.py). */
export enum ECpvBone {
  Root, Pelvis, Spine, Chest, Neck, Head,
  ClavL, ArmL, ForeL, HandL, FistL, OpenL,
  ClavR, ArmR, ForeR, HandR, FistR, OpenR,
  ThighL, ShinL, FootL, ThighR, ShinR, FootR,
  LidL, LidR, PupilL, PupilR, BrowL, BrowR,
  MouthClosed, MouthGrit, MouthOpen, MouthOuch, MouthGrin,
  Hair, Tail, Belly, Skirt,
  Count,
}

/** Joints a pose can turn. Angles are anatomical and in degrees; see FCpvPose. */
export enum ECpvJoint {
  Pelvis, Spine, Chest, Neck, Head,
  ArmL, ElbowL, WristL, ArmR, ElbowR, WristR,
  LegL, KneeL, AnkleL, LegR, KneeR, AnkleR,
  ClavL, ClavR,
  Count,
}

export enum ECpvFace { Neutral, Angry, Attack, Effort, Hurt, Dazed, Happy, Smug, Shock, KO }
export enum ECpvMouth { Closed, Grit, Open, Ouch, Grin }
export enum ECpvEase { Linear, In, Out, InOut, Snap, Over }

const B = ECpvBone;
const JT = ECpvJoint;

const GBoneNames = [
  'root', 'pelvis', 'spine', 'chest', 'neck', 'head',
  'clavicle_l', 'upperarm_l', 'forearm_l', 'hand_l', 'fist_l', 'open_l',
  'clavicle_r', 'upperarm_r', 'forearm_r', 'hand_r', 'fist_r', 'open_r',
  'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r',
  'lid_l', 'lid_r', 'pupil_l', 'pupil_r', 'brow_l', 'brow_r',
  'mouth_closed', 'mouth_grit', 'mouth_open', 'mouth_ouch', 'mouth_grin',
  'hair', 'tail', 'belly', 'skirt',
];

// Parent of each bone, in enum order (parents always come first).
const GParent: ECpvBone[] = [
  B.Count, B.Root, B.Pelvis, B.Spine, B.Chest, B.Neck,
  B.Chest, B.ClavL, B.ArmL, B.ForeL, B.HandL, B.HandL,
  B.Chest, B.ClavR, B.ArmR, B.ForeR, B.HandR, B.HandR,
  B.Pelvis, B.ThighL, B.ShinL, B.Pelvis, B.ThighR, B.ShinR,
  B.Head, B.Head, B.Head, B.Head, B.Head, B.Head,
  B.Head, B.Head, B.Head, B.Head, B.Head,
  B.Head, B.Hair, B.Spine, B.Pelvis,
];

const N = ECpvBone.Count as number;
const NJ = ECpvJoint.Count as number;

function AxisDeg(Axis: FVector, Degrees: number): FQuat { return FQuat.FromAxisAngle(Axis, FMath.DegreesToRadians(Degrees)); }

const AX = new FVector(1, 0, 0), AY = new FVector(0, 1, 0), AZ = new FVector(0, 0, 1);

/** Spine-type joint: X = bend forward, Y = turn right, Z = lean right. */
function QCentral(A: FVector): FQuat { return AxisDeg(AZ, A.Y).Mul(AxisDeg(AY, A.X)).Mul(AxisDeg(AX.Neg(), A.Z)); }

/** Arm or leg hanging straight down: X = swing forward, Y = lift outward, Z = twist inward. Side: +1 right, -1 left. */
function QLimb(A: FVector, Side: number): FQuat { return AxisDeg(AY.Neg(), A.X).Mul(AxisDeg(AX.Mul(Side), A.Y)).Mul(AxisDeg(AZ.Mul(-Side), A.Z)); }

function QElbow(A: FVector, Side: number): FQuat { return AxisDeg(AY.Neg(), A.X).Mul(AxisDeg(AZ.Mul(-Side), A.Z)); }
function QKnee(A: FVector): FQuat { return AxisDeg(AY, A.X); }
function QWrist(A: FVector, Side: number): FQuat { return AxisDeg(AY.Neg(), A.X).Mul(AxisDeg(AZ.Mul(Side), A.Y)).Mul(AxisDeg(AX.Mul(Side), A.Z)); }
function QAnkle(A: FVector): FQuat { return AxisDeg(AY.Neg(), A.X); }
function QClav(A: FVector, Side: number): FQuat { return AxisDeg(AX.Mul(Side), A.X); }

function EaseAlpha(T: number, Ease: ECpvEase): number {
  T = FMath.Clamp(T, 0, 1);
  switch (Ease) {
    case ECpvEase.Linear: return T;
    case ECpvEase.In: return T * T;
    case ECpvEase.Out: return 1 - (1 - T) * (1 - T);
    case ECpvEase.Snap: return T >= 1 ? 1 : 0;
    case ECpvEase.Over: { const S = 1.70158; const U = T - 1; return 1 + U * U * ((S + 1) * U + S); }
    default: return T * T * (3 - 2 * T);
  }
}

// ---------------------------------------------------------------------------------------------
// Poses and clips
// ---------------------------------------------------------------------------------------------

/**
 * One sculpted pose. Angle conventions (all degrees, the character faces +X, right is +Y):
 *   Pelvis/Spine/Chest/Neck/Head : X = bend forward, Y = turn right, Z = lean right
 *   Arm, Leg                     : X = swing forward, Y = lift out to the side, Z = twist inward
 *   Elbow                        : X = bend, Z = twist inward      Knee: X = bend
 *   Wrist                        : X = curl forward, Y = turn, Z = tilt     Ankle: X = toes up
 *   Clav                         : X = shrug up
 * Zero everywhere is standing straight with the arms hanging at the sides.
 *
 * Unlike the vector types this is mutable, as in the C++: the sculpting helpers change the pose and
 * return it. Use Clone() wherever the C++ copied a pose by assignment.
 */
export class FCpvPose {
  J: FVector[] = new Array<FVector>(NJ).fill(FVector.ZeroVector);
  Root = FVector.ZeroVector; // pelvis offset in cm: X forward, Y right, Z up
  Sink = 0;                  // 1 = pelvis lowered to the mat (plus Root.Z), for lying poses
  Ground = 1;                // 1 = slide the body vertically so the lower foot rests on the mat
  Face = ECpvFace.Angry;
  bFistL = true;
  bFistR = true;

  Clone(): FCpvPose {
    const P = new FCpvPose();
    P.J = this.J.slice();
    P.Root = this.Root;
    P.Sink = this.Sink;
    P.Ground = this.Ground;
    P.Face = this.Face;
    P.bFistL = this.bFistL;
    P.bFistR = this.bFistR;
    return P;
  }

  // --- sculpting helpers (chainable) ---
  Pelvis(Fwd: number, Turn = 0, Lean = 0): this { this.J[JT.Pelvis] = new FVector(Fwd, Turn, Lean); return this; }
  Spine(Fwd: number, Turn = 0, Lean = 0): this { this.J[JT.Spine] = new FVector(Fwd, Turn, Lean); return this; }
  Chest(Fwd: number, Turn = 0, Lean = 0): this { this.J[JT.Chest] = new FVector(Fwd, Turn, Lean); return this; }
  Neck(Fwd: number, Turn = 0, Lean = 0): this { this.J[JT.Neck] = new FVector(Fwd, Turn, Lean); return this; }
  Head(Fwd: number, Turn = 0, Lean = 0): this { this.J[JT.Head] = new FVector(Fwd, Turn, Lean); return this; }
  ArmL(Fwd: number, Out = 0, Twist = 0): this { this.J[JT.ArmL] = new FVector(Fwd, Out, Twist); return this; }
  ArmR(Fwd: number, Out = 0, Twist = 0): this { this.J[JT.ArmR] = new FVector(Fwd, Out, Twist); return this; }
  Arms(Fwd: number, Out = 0, Twist = 0): this { return this.ArmL(Fwd, Out, Twist).ArmR(Fwd, Out, Twist); }
  ElbowL(Bend: number, Twist = 0): this { this.J[JT.ElbowL] = new FVector(Bend, 0, Twist); return this; }
  ElbowR(Bend: number, Twist = 0): this { this.J[JT.ElbowR] = new FVector(Bend, 0, Twist); return this; }
  Elbows(Bend: number, Twist = 0): this { return this.ElbowL(Bend, Twist).ElbowR(Bend, Twist); }
  WristL(Curl: number, Turn = 0, Tilt = 0): this { this.J[JT.WristL] = new FVector(Curl, Turn, Tilt); return this; }
  WristR(Curl: number, Turn = 0, Tilt = 0): this { this.J[JT.WristR] = new FVector(Curl, Turn, Tilt); return this; }
  LegL(Fwd: number, Out = 0, Twist = 0): this { this.J[JT.LegL] = new FVector(Fwd, Out, Twist); return this; }
  LegR(Fwd: number, Out = 0, Twist = 0): this { this.J[JT.LegR] = new FVector(Fwd, Out, Twist); return this; }
  Legs(Fwd: number, Out = 0, Twist = 0): this { return this.LegL(Fwd, Out, Twist).LegR(Fwd, Out, Twist); }
  KneeL(Bend: number): this { this.J[JT.KneeL] = new FVector(Bend, 0, 0); return this; }
  KneeR(Bend: number): this { this.J[JT.KneeR] = new FVector(Bend, 0, 0); return this; }
  Knees(Bend: number): this { return this.KneeL(Bend).KneeR(Bend); }
  AnkleL(ToesUp: number): this { this.J[JT.AnkleL] = new FVector(ToesUp, 0, 0); return this; }
  AnkleR(ToesUp: number): this { this.J[JT.AnkleR] = new FVector(ToesUp, 0, 0); return this; }
  Shrug(Left: number, Right: number): this { this.J[JT.ClavL] = new FVector(Left, 0, 0); this.J[JT.ClavR] = new FVector(Right, 0, 0); return this; }
  At(X: number, Y: number, Z: number): this { this.Root = new FVector(X, Y, Z); return this; }
  /** Lying / airborne poses: place the pelvis `Height` cm above the mat and stop foot grounding. */
  Floor(Height: number, X = 0, Y = 0): this { this.Sink = 1; this.Ground = 0; this.Root = new FVector(X, Y, Height); return this; }
  /** Airborne: pelvis `Up` cm above its standing height, no foot grounding. */
  Air(Up: number, X = 0, Y = 0): this { this.Sink = 0; this.Ground = 0; this.Root = new FVector(X, Y, Up); return this; }
  Expr(InFace: ECpvFace): this { this.Face = InFace; return this; }
  Hands(bLeftFist: boolean, bRightFist: boolean): this { this.bFistL = bLeftFist; this.bFistR = bRightFist; return this; }

  Mirrored(): FCpvPose {
    const M = this.Clone();
    const Swap = (L: ECpvJoint, R: ECpvJoint) => { M.J[L] = this.J[R]; M.J[R] = this.J[L]; };
    Swap(JT.ArmL, JT.ArmR); Swap(JT.ElbowL, JT.ElbowR); Swap(JT.WristL, JT.WristR);
    Swap(JT.LegL, JT.LegR); Swap(JT.KneeL, JT.KneeR); Swap(JT.AnkleL, JT.AnkleR); Swap(JT.ClavL, JT.ClavR);
    for (const C of [JT.Pelvis, JT.Spine, JT.Chest, JT.Neck, JT.Head]) {
      M.J[C] = new FVector(M.J[C].X, -M.J[C].Y, -M.J[C].Z);
    }
    M.Root = this.Root.WithY(-this.Root.Y);
    M.bFistL = this.bFistR;
    M.bFistR = this.bFistL;
    return M;
  }

  static Blend(A: FCpvPose, Bp: FCpvPose, Alpha: number): FCpvPose {
    if (Alpha <= 0) { return A.Clone(); }
    if (Alpha >= 1) { return Bp.Clone(); }
    const R = new FCpvPose();
    for (let i = 0; i < NJ; ++i) { R.J[i] = A.J[i].Lerp(Bp.J[i], Alpha); }
    R.Root = A.Root.Lerp(Bp.Root, Alpha);
    R.Sink = FMath.Lerp(A.Sink, Bp.Sink, Alpha);
    R.Ground = FMath.Lerp(A.Ground, Bp.Ground, Alpha);
    const Near = Alpha < 0.5 ? A : Bp; // replacement parts switch at the halfway point
    R.Face = Near.Face;
    R.bFistL = Near.bFistL;
    R.bFistR = Near.bFistR;
    return R;
  }
}

export interface FCpvKey {
  Time: number;
  Pose: FCpvPose;
  Ease: ECpvEase; // how the pose is approached from the previous key
}

/** A pose-to-pose animation, like a dope sheet: a handful of sculpted keys with eases between them. */
export class FCpvClip {
  Keys: FCpvKey[] = [];
  bLoop = false;
  Length = 0;

  Key(Time: number, Pose: FCpvPose, Ease: ECpvEase = ECpvEase.InOut): this {
    this.Keys.push({ Time, Pose: Pose.Clone(), Ease });
    this.Length = FMath.Max(this.Length, Time);
    return this;
  }
  Loop(): this { this.bLoop = true; return this; }
  Mirrored(): FCpvClip {
    const M = new FCpvClip();
    M.bLoop = this.bLoop;
    M.Length = this.Length;
    M.Keys = this.Keys.map((K) => ({ Time: K.Time, Pose: K.Pose.Mirrored(), Ease: K.Ease }));
    return M;
  }
  Sample(Time: number): FCpvPose {
    const Keys = this.Keys;
    if (Keys.length === 0) { return new FCpvPose(); }
    if (this.bLoop && this.Length > 0) { Time = FMath.Fmod(FMath.Max(Time, 0), this.Length); }
    if (Time <= Keys[0].Time) { return Keys[0].Pose.Clone(); }
    for (let i = 1; i < Keys.length; ++i) {
      if (Time <= Keys[i].Time) {
        const Span = Keys[i].Time - Keys[i - 1].Time;
        const T = Span > KINDA_SMALL_NUMBER ? (Time - Keys[i - 1].Time) / Span : 1;
        return FCpvPose.Blend(Keys[i - 1].Pose, Keys[i].Pose, EaseAlpha(T, Keys[i].Ease));
      }
    }
    return Keys[Keys.length - 1].Pose.Clone();
  }
}

/** Face, hands and secondary-motion inputs that are not part of a sculpted pose. */
export class FCpvRigExtras {
  Mouth = ECpvMouth.Closed;
  LidClose = 0;                     // 0 open .. 1 shut, negative = wide-eyed
  BrowAngry = 0;                    // +1 scowl .. -1 worried
  BrowRaise = 0;                    // cm
  PupilL = FVector2D.ZeroVector;    // cm: X toward the character's right, Y up
  PupilR = FVector2D.ZeroVector;
  Look = FVector2D.ZeroVector;      // extra head turn (yaw, pitch) in degrees
  Hair = FQuat.Identity;
  Tail = FQuat.Identity;
  Belly = FQuat.Identity;
  Skirt = FQuat.Identity;
  HeadSquash = new FVector2D(1, 1); // X = width, Y = height (for flattened and inflated heads)
  Scale: number[] = new Array<number>(N).fill(1); // per-bone scale multipliers (1 = normal, ~0 = hidden)
}

// ---------------------------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------------------------

/** Turns poses into bone transforms on a UPoseableMeshComponent, whatever the character's proportions. */
export class FCpvRig {
  Mesh: UPoseableMeshComponent | null = null;
  PelvisHeight = 88;   // standing pelvis height
  AnkleHeight = 9;
  Height = 180;        // top of the head when standing
  HeadHeight = 150;    // head pivot when standing

  private Index: number[] = new Array<number>(N).fill(INDEX_NONE);
  private RestRot: FQuat[] = new Array<FQuat>(N).fill(FQuat.Identity);
  private RestOffset: FVector[] = new Array<FVector>(N).fill(FVector.ZeroVector);
  private RestPos: FVector[] = new Array<FVector>(N).fill(FVector.ZeroVector);
  private CS: FTransform[] = new Array<FTransform>(N).fill(FTransform.Identity);

  static BoneName(Bone: ECpvBone): string { return GBoneNames[Bone]; }

  IsValid(): boolean { return this.Mesh !== null && this.Index[B.Pelvis] !== INDEX_NONE; }
  HasBone(Bone: ECpvBone): boolean { return this.Index[Bone] !== INDEX_NONE; }
  /** Component-space transform from the last Apply. */
  BoneCS(Bone: ECpvBone): FTransform { return this.CS[Bone]; }

  Init(InMesh: UPoseableMeshComponent | null): void {
    this.Mesh = InMesh;
    for (let i = 0; i < N; ++i) {
      this.Index[i] = INDEX_NONE;
      this.RestRot[i] = FQuat.Identity;
      this.RestOffset[i] = FVector.ZeroVector;
      this.RestPos[i] = FVector.ZeroVector;
      this.CS[i] = FTransform.Identity;
    }
    const Asset = InMesh ? InMesh.GetSkinnedAsset() : null;
    if (!InMesh || !Asset) {
      this.Mesh = null;
      return;
    }
    const RefRot: FQuat[] = new Array<FQuat>(N).fill(FQuat.Identity);
    for (let i = 0; i < N; ++i) {
      this.Index[i] = InMesh.FindBoneIndex(GBoneNames[i]);
      if (this.Index[i] !== INDEX_NONE) {
        const Ref = InMesh.GetRefBoneCS(this.Index[i]);
        this.RestPos[i] = Ref.GetLocation();
        RefRot[i] = Ref.GetRotation();
      }
    }

    // The bind pose has the arms out at an angle and the legs very slightly splayed. Poses are authored
    // against a rest skeleton whose limbs hang straight down, so each limb chain gets a fixed correction.
    const Fix: FQuat[] = new Array<FQuat>(N).fill(FQuat.Identity);
    const FixChain = (Upper: ECpvBone, Lower: ECpvBone, Chain: ECpvBone[]) => {
      if (this.Index[Upper] === INDEX_NONE || this.Index[Lower] === INDEX_NONE) { return; }
      const Dir = this.RestPos[Lower].Sub(this.RestPos[Upper]).GetSafeNormal();
      const Q = FQuat.FindBetweenNormals(Dir, new FVector(0, 0, -1));
      for (const Bone of Chain) { Fix[Bone] = Q; }
    };
    FixChain(B.ArmL, B.ForeL, [B.ArmL, B.ForeL, B.HandL, B.FistL, B.OpenL]);
    FixChain(B.ArmR, B.ForeR, [B.ArmR, B.ForeR, B.HandR, B.FistR, B.OpenR]);
    FixChain(B.ThighL, B.ShinL, [B.ThighL, B.ShinL]);
    FixChain(B.ThighR, B.ShinR, [B.ThighR, B.ShinR]);

    for (let i = 0; i < N; ++i) {
      this.RestRot[i] = Fix[i].Mul(RefRot[i]);
      const Parent = GParent[i];
      if (Parent !== B.Count && this.Index[i] !== INDEX_NONE) {
        this.RestOffset[i] = Fix[Parent].RotateVector(this.RestPos[i].Sub(this.RestPos[Parent]));
      }
    }
    this.PelvisHeight = this.RestPos[B.Pelvis].Z;
    this.AnkleHeight = this.RestPos[B.FootL].Z;
    this.HeadHeight = this.RestPos[B.Head].Z;
    this.Height = Asset.Height;
    InMesh.BoundsScale = 2.5;
  }

  Apply(Pose: FCpvPose, Extras: FCpvRigExtras): void {
    const Mesh = this.Mesh;
    if (!Mesh || !this.IsValid()) { return; }

    // Accumulated (component-space) authored rotation and position of every bone.
    const Acc: FQuat[] = new Array<FQuat>(N);
    const Pos: FVector[] = new Array<FVector>(N);
    const Local: FQuat[] = new Array<FQuat>(N).fill(FQuat.Identity);

    Local[B.Pelvis] = QCentral(Pose.J[JT.Pelvis]);
    Local[B.Spine] = QCentral(Pose.J[JT.Spine]);
    Local[B.Chest] = QCentral(Pose.J[JT.Chest]);
    Local[B.Neck] = QCentral(Pose.J[JT.Neck]);
    Local[B.Head] = QCentral(Pose.J[JT.Head].Add(new FVector(Extras.Look.Y, Extras.Look.X, 0)));
    Local[B.ClavL] = QClav(Pose.J[JT.ClavL], -1);
    Local[B.ClavR] = QClav(Pose.J[JT.ClavR], 1);
    Local[B.ArmL] = QLimb(Pose.J[JT.ArmL], -1);
    Local[B.ArmR] = QLimb(Pose.J[JT.ArmR], 1);
    Local[B.ForeL] = QElbow(Pose.J[JT.ElbowL], -1);
    Local[B.ForeR] = QElbow(Pose.J[JT.ElbowR], 1);
    Local[B.HandL] = QWrist(Pose.J[JT.WristL], -1);
    Local[B.HandR] = QWrist(Pose.J[JT.WristR], 1);
    Local[B.ThighL] = QLimb(Pose.J[JT.LegL], -1);
    Local[B.ThighR] = QLimb(Pose.J[JT.LegR], 1);
    Local[B.ShinL] = QKnee(Pose.J[JT.KneeL]);
    Local[B.ShinR] = QKnee(Pose.J[JT.KneeR]);
    Local[B.FootL] = QAnkle(Pose.J[JT.AnkleL]);
    Local[B.FootR] = QAnkle(Pose.J[JT.AnkleR]);
    Local[B.Hair] = Extras.Hair;
    Local[B.Tail] = Extras.Tail;
    Local[B.Belly] = Extras.Belly;
    Local[B.Skirt] = Extras.Skirt;
    // Eyelids swing down over the eye; brows tilt about the forward axis.
    const Lid = Extras.LidClose >= 0 ? Extras.LidClose * 68 : Extras.LidClose * 26;
    Local[B.LidL] = AxisDeg(AY, Lid);
    Local[B.LidR] = AxisDeg(AY, Lid);
    Local[B.BrowL] = AxisDeg(AX.Neg(), Extras.BrowAngry * 24);
    Local[B.BrowR] = AxisDeg(AX, Extras.BrowAngry * 24);

    Acc[B.Root] = FQuat.Identity;
    Pos[B.Root] = FVector.ZeroVector;
    for (let i = 1; i < N; ++i) {
      const P = GParent[i];
      Acc[i] = Acc[P].Mul(Local[i]);
      Pos[i] = Pos[P].Add(Acc[P].RotateVector(this.RestOffset[i]));
      if (i === B.Pelvis) {
        Pos[i] = new FVector(Pose.Root.X, Pose.Root.Y, this.RestPos[i].Z * (1 - Pose.Sink) + Pose.Root.Z);
      }
    }

    // Face parts slide a little in the head's frame.
    const HeadQ = Acc[B.Head];
    const BrowLift = HeadQ.RotateVector(new FVector(0, 0, Extras.BrowRaise));
    Pos[B.BrowL] = Pos[B.BrowL].Add(BrowLift);
    Pos[B.BrowR] = Pos[B.BrowR].Add(BrowLift);
    Pos[B.PupilL] = Pos[B.PupilL].Add(HeadQ.RotateVector(new FVector(0, Extras.PupilL.X, Extras.PupilL.Y)));
    Pos[B.PupilR] = Pos[B.PupilR].Add(HeadQ.RotateVector(new FVector(0, Extras.PupilR.X, Extras.PupilR.Y)));

    // Keep the lower foot on the mat and flatten feet that are close to it.
    if (Pose.Ground > 0) {
      const Lowest = FMath.Min(Pos[B.FootL].Z, Pos[B.FootR].Z);
      const Shift = (this.AnkleHeight - Lowest) * Pose.Ground;
      for (let i = 1; i < N; ++i) { Pos[i] = Pos[i].WithZ(Pos[i].Z + Shift); }
      for (const Foot of [B.FootL, B.FootR]) {
        const Above = Pos[Foot].Z - this.AnkleHeight;
        const Flat = Pose.Ground * (1 - FMath.Clamp(Above / 14, 0, 1));
        if (Flat > 0) {
          const R = Acc[Foot].Rotator();
          Acc[Foot] = FQuat.Slerp(Acc[Foot], new FRotator(0, R.Yaw, 0).Quaternion(), Flat);
        }
      }
    }

    // Replacement parts: one mouth and one hand shape per side are shown, the rest shrink to nothing.
    const Scale = Extras.Scale.slice();
    const Tiny = 0.001;
    const Mouths = [B.MouthClosed, B.MouthGrit, B.MouthOpen, B.MouthOuch, B.MouthGrin];
    for (let m = 0; m < 5; ++m) {
      if (m !== (Extras.Mouth as number)) { Scale[Mouths[m]] = Tiny; }
    }
    Scale[Pose.bFistL ? B.OpenL : B.FistL] = Tiny;
    Scale[Pose.bFistR ? B.OpenR : B.FistR] = Tiny;

    for (let i = 0; i < N; ++i) {
      let S = FVector.Splat(Scale[i]);
      if (i === B.Head) { S = new FVector(Extras.HeadSquash.X, Extras.HeadSquash.Y, Extras.HeadSquash.X).Mul(Scale[i]); } // bone-local Y runs up the head
      if (i === B.PupilL || i === B.PupilR) {
        S = S.WithZ(S.Z * FMath.Lerp(1, 0.14, FMath.Clamp(Extras.LidClose, 0, 1))); // shut eyes squash the pupils (LED faces rely on this)
      }
      this.CS[i] = new FTransform(Acc[i].Mul(this.RestRot[i]), Pos[i], S);
    }
    // Face parts and hair ride along when the head is squashed or stretched.
    const HeadAxes = new FVector(Extras.HeadSquash.X, Extras.HeadSquash.X, Extras.HeadSquash.Y);
    for (let i = B.LidL as number; i <= (B.Tail as number); ++i) {
      const Rel = HeadQ.UnrotateVector(Pos[i].Sub(Pos[B.Head])).MulV(HeadAxes);
      this.CS[i] = this.CS[i].WithLocation(Pos[B.Head].Add(HeadQ.RotateVector(Rel)));
    }

    for (let i = 0; i < N; ++i) {
      if (this.Index[i] !== INDEX_NONE) { Mesh.SetBoneCS(this.Index[i], this.CS[i]); }
    }
    Mesh.RefreshBoneTransforms();
  }
}
