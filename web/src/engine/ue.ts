// The slice of Unreal's math library the game uses, with Unreal's conventions: a left-handed world with
// X forward, Y right and Z up, measured in centimetres; rotators in degrees (pitch up, yaw to the right,
// roll clockwise). The game code in src/game is a port of the C++ in ClayPerView/Source and keeps its
// numbers, so the maths has to agree with the engine's. Conversion to three.js happens in convert.ts.
//
// Every value type here is immutable: C++ copies structs on assignment, and sharing a mutable vector
// between two owners is the classic way to get a port subtly wrong.

export const UE_PI = Math.PI;
export const UE_TWO_PI = Math.PI * 2;
export const UE_HALF_PI = Math.PI / 2;
export const UE_SMALL_NUMBER = 1e-8;
export const UE_KINDA_SMALL_NUMBER = 1e-4;
export const KINDA_SMALL_NUMBER = UE_KINDA_SMALL_NUMBER;
export const INDEX_NONE = -1;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export class FVector2D {
  constructor(
    readonly X: number = 0,
    readonly Y: number = 0,
  ) {}
  static readonly ZeroVector = new FVector2D(0, 0);
  static DotProduct(A: FVector2D, B: FVector2D): number { return A.X * B.X + A.Y * B.Y; }
  static CrossProduct(A: FVector2D, B: FVector2D): number { return A.X * B.Y - A.Y * B.X; }
  static Distance(A: FVector2D, B: FVector2D): number { return Math.hypot(A.X - B.X, A.Y - B.Y); }
  Add(B: FVector2D): FVector2D { return new FVector2D(this.X + B.X, this.Y + B.Y); }
  Sub(B: FVector2D): FVector2D { return new FVector2D(this.X - B.X, this.Y - B.Y); }
  Mul(S: number): FVector2D { return new FVector2D(this.X * S, this.Y * S); }
  Div(S: number): FVector2D { return new FVector2D(this.X / S, this.Y / S); }
  Neg(): FVector2D { return new FVector2D(-this.X, -this.Y); }
  Dot(B: FVector2D): number { return this.X * B.X + this.Y * B.Y; }
  Size(): number { return Math.hypot(this.X, this.Y); }
  SizeSquared(): number { return this.X * this.X + this.Y * this.Y; }
  IsNearlyZero(Tolerance: number = UE_KINDA_SMALL_NUMBER): boolean { return Math.abs(this.X) <= Tolerance && Math.abs(this.Y) <= Tolerance; }
  IsZero(): boolean { return this.X === 0 && this.Y === 0; }
  GetSafeNormal(Tolerance: number = UE_SMALL_NUMBER): FVector2D {
    const Sq = this.X * this.X + this.Y * this.Y;
    if (Sq > Tolerance) {
      const Inv = 1 / Math.sqrt(Sq);
      return new FVector2D(this.X * Inv, this.Y * Inv);
    }
    return FVector2D.ZeroVector;
  }
  GetRotated(AngleDeg: number): FVector2D {
    const S = Math.sin(AngleDeg * DEG);
    const C = Math.cos(AngleDeg * DEG);
    return new FVector2D(C * this.X - S * this.Y, S * this.X + C * this.Y);
  }
  WithX(X: number): FVector2D { return new FVector2D(X, this.Y); }
  WithY(Y: number): FVector2D { return new FVector2D(this.X, Y); }
  Lerp(B: FVector2D, Alpha: number): FVector2D { return new FVector2D(this.X + (B.X - this.X) * Alpha, this.Y + (B.Y - this.Y) * Alpha); }
  ToString(): string { return `X=${this.X.toFixed(3)} Y=${this.Y.toFixed(3)}`; }
}
/** Unreal's float flavour; one class serves both here. */
export const FVector2f = FVector2D;
export type FVector2f = FVector2D;

export class FVector {
  constructor(
    readonly X: number = 0,
    readonly Y: number = 0,
    readonly Z: number = 0,
  ) {}
  static readonly ZeroVector = new FVector(0, 0, 0);
  static readonly OneVector = new FVector(1, 1, 1);
  static readonly UpVector = new FVector(0, 0, 1);
  static readonly ForwardVector = new FVector(1, 0, 0);
  static readonly RightVector = new FVector(0, 1, 0);
  /** FVector(S): the same value on every axis. */
  static Splat(S: number): FVector { return new FVector(S, S, S); }
  static DotProduct(A: FVector, B: FVector): number { return A.X * B.X + A.Y * B.Y + A.Z * B.Z; }
  static CrossProduct(A: FVector, B: FVector): FVector { return A.Cross(B); }
  static Dist(A: FVector, B: FVector): number { return Math.hypot(A.X - B.X, A.Y - B.Y, A.Z - B.Z); }
  static DistSquared(A: FVector, B: FVector): number { return A.Sub(B).SizeSquared(); }
  Add(B: FVector): FVector { return new FVector(this.X + B.X, this.Y + B.Y, this.Z + B.Z); }
  Sub(B: FVector): FVector { return new FVector(this.X - B.X, this.Y - B.Y, this.Z - B.Z); }
  Mul(S: number): FVector { return new FVector(this.X * S, this.Y * S, this.Z * S); }
  /** Component-wise product (C++: A * B with two vectors). */
  MulV(B: FVector): FVector { return new FVector(this.X * B.X, this.Y * B.Y, this.Z * B.Z); }
  Div(S: number): FVector { return new FVector(this.X / S, this.Y / S, this.Z / S); }
  Neg(): FVector { return new FVector(-this.X, -this.Y, -this.Z); }
  Dot(B: FVector): number { return this.X * B.X + this.Y * B.Y + this.Z * B.Z; }
  Cross(B: FVector): FVector {
    return new FVector(this.Y * B.Z - this.Z * B.Y, this.Z * B.X - this.X * B.Z, this.X * B.Y - this.Y * B.X);
  }
  Size(): number { return Math.hypot(this.X, this.Y, this.Z); }
  SizeSquared(): number { return this.X * this.X + this.Y * this.Y + this.Z * this.Z; }
  Size2D(): number { return Math.hypot(this.X, this.Y); }
  SizeSquared2D(): number { return this.X * this.X + this.Y * this.Y; }
  IsNearlyZero(Tolerance: number = UE_KINDA_SMALL_NUMBER): boolean {
    return Math.abs(this.X) <= Tolerance && Math.abs(this.Y) <= Tolerance && Math.abs(this.Z) <= Tolerance;
  }
  IsZero(): boolean { return this.X === 0 && this.Y === 0 && this.Z === 0; }
  GetSafeNormal(Tolerance: number = UE_SMALL_NUMBER): FVector {
    const Sq = this.SizeSquared();
    if (Sq === 1) { return this; }
    if (Sq < Tolerance) { return FVector.ZeroVector; }
    const Inv = 1 / Math.sqrt(Sq);
    return new FVector(this.X * Inv, this.Y * Inv, this.Z * Inv);
  }
  GetSafeNormal2D(Tolerance: number = UE_SMALL_NUMBER): FVector {
    const Sq = this.X * this.X + this.Y * this.Y;
    if (Sq < Tolerance) { return FVector.ZeroVector; }
    const Inv = 1 / Math.sqrt(Sq);
    return new FVector(this.X * Inv, this.Y * Inv, 0);
  }
  GetClampedToMaxSize(MaxSize: number): FVector {
    if (MaxSize < UE_KINDA_SMALL_NUMBER) { return FVector.ZeroVector; }
    const Sq = this.SizeSquared();
    return Sq > MaxSize * MaxSize ? this.Mul(MaxSize / Math.sqrt(Sq)) : this;
  }
  /** The rotator that points +X along this vector (no roll). */
  Rotation(): FRotator {
    return new FRotator(Math.atan2(this.Z, Math.hypot(this.X, this.Y)) * RAD, Math.atan2(this.Y, this.X) * RAD, 0);
  }
  WithX(X: number): FVector { return new FVector(X, this.Y, this.Z); }
  WithY(Y: number): FVector { return new FVector(this.X, Y, this.Z); }
  WithZ(Z: number): FVector { return new FVector(this.X, this.Y, Z); }
  Lerp(B: FVector, Alpha: number): FVector {
    return new FVector(this.X + (B.X - this.X) * Alpha, this.Y + (B.Y - this.Y) * Alpha, this.Z + (B.Z - this.Z) * Alpha);
  }
  Equals(B: FVector, Tolerance: number = UE_KINDA_SMALL_NUMBER): boolean {
    return Math.abs(this.X - B.X) <= Tolerance && Math.abs(this.Y - B.Y) <= Tolerance && Math.abs(this.Z - B.Z) <= Tolerance;
  }
  ToString(): string { return `X=${this.X.toFixed(3)} Y=${this.Y.toFixed(3)} Z=${this.Z.toFixed(3)}`; }
}
export const FVector3f = FVector;
export type FVector3f = FVector;

export class FRotator {
  constructor(
    readonly Pitch: number = 0,
    readonly Yaw: number = 0,
    readonly Roll: number = 0,
  ) {}
  static readonly ZeroRotator = new FRotator(0, 0, 0);
  /** Wraps an angle to [0, 360). */
  static ClampAxis(Angle: number): number {
    Angle = Angle % 360;
    return Angle < 0 ? Angle + 360 : Angle;
  }
  /** Wraps an angle to (-180, 180]. */
  static NormalizeAxis(Angle: number): number {
    Angle = FRotator.ClampAxis(Angle);
    return Angle > 180 ? Angle - 360 : Angle;
  }
  Add(B: FRotator): FRotator { return new FRotator(this.Pitch + B.Pitch, this.Yaw + B.Yaw, this.Roll + B.Roll); }
  Sub(B: FRotator): FRotator { return new FRotator(this.Pitch - B.Pitch, this.Yaw - B.Yaw, this.Roll - B.Roll); }
  Mul(S: number): FRotator { return new FRotator(this.Pitch * S, this.Yaw * S, this.Roll * S); }
  WithPitch(Pitch: number): FRotator { return new FRotator(Pitch, this.Yaw, this.Roll); }
  WithYaw(Yaw: number): FRotator { return new FRotator(this.Pitch, Yaw, this.Roll); }
  WithRoll(Roll: number): FRotator { return new FRotator(this.Pitch, this.Yaw, Roll); }
  GetNormalized(): FRotator {
    return new FRotator(FRotator.NormalizeAxis(this.Pitch), FRotator.NormalizeAxis(this.Yaw), FRotator.NormalizeAxis(this.Roll));
  }
  Quaternion(): FQuat {
    const HP = (this.Pitch % 360) * DEG * 0.5;
    const HY = (this.Yaw % 360) * DEG * 0.5;
    const HR = (this.Roll % 360) * DEG * 0.5;
    const SP = Math.sin(HP), CP = Math.cos(HP);
    const SY = Math.sin(HY), CY = Math.cos(HY);
    const SR = Math.sin(HR), CR = Math.cos(HR);
    return new FQuat(CR * SP * SY - SR * CP * CY, -CR * SP * CY - SR * CP * SY, CR * CP * SY - SR * SP * CY, CR * CP * CY + SR * SP * SY);
  }
  /** The direction +X points after this rotation. */
  Vector(): FVector {
    const CP = Math.cos(this.Pitch * DEG), SP = Math.sin(this.Pitch * DEG);
    const CY = Math.cos(this.Yaw * DEG), SY = Math.sin(this.Yaw * DEG);
    return new FVector(CP * CY, CP * SY, SP);
  }
  RotateVector(V: FVector): FVector { return this.Quaternion().RotateVector(V); }
  UnrotateVector(V: FVector): FVector { return this.Quaternion().UnrotateVector(V); }
  IsNearlyZero(Tolerance: number = UE_KINDA_SMALL_NUMBER): boolean {
    return Math.abs(FRotator.NormalizeAxis(this.Pitch)) <= Tolerance && Math.abs(FRotator.NormalizeAxis(this.Yaw)) <= Tolerance
      && Math.abs(FRotator.NormalizeAxis(this.Roll)) <= Tolerance;
  }
  ToString(): string { return `P=${this.Pitch.toFixed(2)} Y=${this.Yaw.toFixed(2)} R=${this.Roll.toFixed(2)}`; }
}
export const FRotator3f = FRotator;

export class FQuat {
  constructor(
    readonly X: number = 0,
    readonly Y: number = 0,
    readonly Z: number = 0,
    readonly W: number = 1,
  ) {}
  static readonly Identity = new FQuat(0, 0, 0, 1);
  /** FQuat(Axis, AngleRad): a turn about a unit axis. */
  static FromAxisAngle(Axis: FVector, AngleRad: number): FQuat {
    const S = Math.sin(AngleRad * 0.5);
    return new FQuat(S * Axis.X, S * Axis.Y, S * Axis.Z, Math.cos(AngleRad * 0.5));
  }
  /** The rotation whose local X, Y and Z axes are the given orthonormal vectors (FMatrix(X, Y, Z, 0).ToQuat()). */
  static FromAxes(AxisX: FVector, AxisY: FVector, AxisZ: FVector): FQuat {
    const M = [[AxisX.X, AxisX.Y, AxisX.Z], [AxisY.X, AxisY.Y, AxisY.Z], [AxisZ.X, AxisZ.Y, AxisZ.Z]];
    const Trace = M[0][0] + M[1][1] + M[2][2];
    if (Trace > 0) {
      const InvS = 1 / Math.sqrt(Trace + 1);
      const S = 0.5 * InvS;
      return new FQuat((M[1][2] - M[2][1]) * S, (M[2][0] - M[0][2]) * S, (M[0][1] - M[1][0]) * S, 0.5 / InvS);
    }
    let i = 0;
    if (M[1][1] > M[0][0]) { i = 1; }
    if (M[2][2] > M[i][i]) { i = 2; }
    const Next = [1, 2, 0];
    const j = Next[i];
    const k = Next[j];
    const InvS = 1 / Math.sqrt(M[i][i] - M[j][j] - M[k][k] + 1);
    const S = 0.5 * InvS;
    const Q = [0, 0, 0, 0];
    Q[i] = 0.5 / InvS;
    Q[3] = (M[j][k] - M[k][j]) * S;
    Q[j] = (M[i][j] + M[j][i]) * S;
    Q[k] = (M[i][k] + M[k][i]) * S;
    return new FQuat(Q[0], Q[1], Q[2], Q[3]);
  }
  static FindBetweenNormals(A: FVector, B: FVector): FQuat {
    const W = 1 + A.Dot(B);
    let Q: FQuat;
    if (W >= 1e-6) {
      Q = new FQuat(A.Y * B.Z - A.Z * B.Y, A.Z * B.X - A.X * B.Z, A.X * B.Y - A.Y * B.X, W);
    } else {
      // Opposite directions: any axis at right angles to A will do.
      Q = Math.abs(A.X) > Math.abs(A.Y) ? new FQuat(-A.Z, 0, A.X, 0) : new FQuat(0, -A.Z, A.Y, 0);
    }
    return Q.GetNormalized();
  }
  static Slerp(A: FQuat, B: FQuat, Alpha: number): FQuat {
    const RawCosom = A.X * B.X + A.Y * B.Y + A.Z * B.Z + A.W * B.W;
    const Cosom = Math.abs(RawCosom);
    let Scale0: number;
    let Scale1: number;
    if (Cosom < 0.9999) {
      const Omega = Math.acos(Cosom);
      const InvSin = 1 / Math.sin(Omega);
      Scale0 = Math.sin((1 - Alpha) * Omega) * InvSin;
      Scale1 = Math.sin(Alpha * Omega) * InvSin;
    } else {
      Scale0 = 1 - Alpha;
      Scale1 = Alpha;
    }
    if (RawCosom < 0) { Scale1 = -Scale1; }
    return new FQuat(Scale0 * A.X + Scale1 * B.X, Scale0 * A.Y + Scale1 * B.Y, Scale0 * A.Z + Scale1 * B.Z, Scale0 * A.W + Scale1 * B.W).GetNormalized();
  }
  /** C++ `this * B`: the rotation that applies B first, then this. */
  Mul(B: FQuat): FQuat {
    return new FQuat(
      this.W * B.X + this.X * B.W + this.Y * B.Z - this.Z * B.Y,
      this.W * B.Y - this.X * B.Z + this.Y * B.W + this.Z * B.X,
      this.W * B.Z + this.X * B.Y - this.Y * B.X + this.Z * B.W,
      this.W * B.W - this.X * B.X - this.Y * B.Y - this.Z * B.Z,
    );
  }
  RotateVector(V: FVector): FVector {
    const TX = 2 * (this.Y * V.Z - this.Z * V.Y);
    const TY = 2 * (this.Z * V.X - this.X * V.Z);
    const TZ = 2 * (this.X * V.Y - this.Y * V.X);
    return new FVector(
      V.X + this.W * TX + (this.Y * TZ - this.Z * TY),
      V.Y + this.W * TY + (this.Z * TX - this.X * TZ),
      V.Z + this.W * TZ + (this.X * TY - this.Y * TX),
    );
  }
  UnrotateVector(V: FVector): FVector { return this.Inverse().RotateVector(V); }
  Inverse(): FQuat { return new FQuat(-this.X, -this.Y, -this.Z, this.W); }
  GetNormalized(): FQuat {
    const Sq = this.X * this.X + this.Y * this.Y + this.Z * this.Z + this.W * this.W;
    if (Sq < UE_SMALL_NUMBER) { return FQuat.Identity; }
    const Inv = 1 / Math.sqrt(Sq);
    return new FQuat(this.X * Inv, this.Y * Inv, this.Z * Inv, this.W * Inv);
  }
  Rotator(): FRotator {
    const SingularityTest = this.Z * this.X - this.W * this.Y;
    const YawY = 2 * (this.W * this.Z + this.X * this.Y);
    const YawX = 1 - 2 * (this.Y * this.Y + this.Z * this.Z);
    const Threshold = 0.4999995;
    const Yaw = Math.atan2(YawY, YawX) * RAD;
    if (SingularityTest < -Threshold) {
      return new FRotator(-90, Yaw, FRotator.NormalizeAxis(-Yaw - 2 * Math.atan2(this.X, this.W) * RAD));
    }
    if (SingularityTest > Threshold) {
      return new FRotator(90, Yaw, FRotator.NormalizeAxis(Yaw - 2 * Math.atan2(this.X, this.W) * RAD));
    }
    return new FRotator(
      Math.asin(2 * SingularityTest) * RAD,
      Yaw,
      Math.atan2(-2 * (this.W * this.X + this.Y * this.Z), 1 - 2 * (this.X * this.X + this.Y * this.Y)) * RAD,
    );
  }
  GetAxisX(): FVector { return this.RotateVector(FVector.ForwardVector); }
  GetAxisY(): FVector { return this.RotateVector(FVector.RightVector); }
  GetAxisZ(): FVector { return this.RotateVector(FVector.UpVector); }
}

export const FRotationMatrix = {
  /** Rotation whose X axis points along the given direction, keeping Z as upright as possible. */
  MakeFromX(XAxis: FVector): FQuat {
    const NewX = XAxis.GetSafeNormal();
    const Up = Math.abs(NewX.Z) < 1 - UE_KINDA_SMALL_NUMBER ? FVector.UpVector : FVector.ForwardVector;
    const NewY = Up.Cross(NewX).GetSafeNormal();
    return FQuat.FromAxes(NewX, NewY, NewX.Cross(NewY));
  },
  /** Rotation whose Z axis points along ZAxis, with X as close to XAxis as it can be. */
  MakeFromZX(ZAxis: FVector, XAxis: FVector): FQuat {
    const NewZ = ZAxis.GetSafeNormal();
    let Norm = XAxis.GetSafeNormal();
    if (Math.abs(Math.abs(NewZ.Dot(Norm)) - 1) <= UE_SMALL_NUMBER) {
      Norm = Math.abs(NewZ.Z) < 1 - UE_KINDA_SMALL_NUMBER ? FVector.UpVector : FVector.ForwardVector;
    }
    const NewY = NewZ.Cross(Norm).GetSafeNormal();
    return FQuat.FromAxes(NewY.Cross(NewZ), NewY, NewZ);
  },
};

export class FTransform {
  readonly Rotation: FQuat;
  readonly Translation: FVector;
  readonly Scale3D: FVector;
  constructor(Rotation: FQuat | FRotator = FQuat.Identity, Translation: FVector = FVector.ZeroVector, Scale3D: FVector = FVector.OneVector) {
    this.Rotation = Rotation instanceof FRotator ? Rotation.Quaternion() : Rotation;
    this.Translation = Translation;
    this.Scale3D = Scale3D;
  }
  static readonly Identity = new FTransform();
  GetLocation(): FVector { return this.Translation; }
  GetTranslation(): FVector { return this.Translation; }
  GetRotation(): FQuat { return this.Rotation; }
  GetScale3D(): FVector { return this.Scale3D; }
  Rotator(): FRotator { return this.Rotation.Rotator(); }
  WithLocation(Location: FVector): FTransform { return new FTransform(this.Rotation, Location, this.Scale3D); }
  WithRotation(Rotation: FQuat): FTransform { return new FTransform(Rotation, this.Translation, this.Scale3D); }
  WithScale3D(Scale: FVector): FTransform { return new FTransform(this.Rotation, this.Translation, Scale); }
  /** C++ `this * B`: this transform followed by B (a child's transform times its parent's). */
  Mul(B: FTransform): FTransform {
    return new FTransform(
      B.Rotation.Mul(this.Rotation),
      B.Rotation.RotateVector(B.Scale3D.MulV(this.Translation)).Add(B.Translation),
      this.Scale3D.MulV(B.Scale3D),
    );
  }
  /** This transform expressed in Other's space: `this * Other^-1`. */
  GetRelativeTransform(Other: FTransform): FTransform {
    const Recip = new FVector(SafeRecip(Other.Scale3D.X), SafeRecip(Other.Scale3D.Y), SafeRecip(Other.Scale3D.Z));
    const Inv = Other.Rotation.Inverse();
    return new FTransform(Inv.Mul(this.Rotation), Inv.RotateVector(this.Translation.Sub(Other.Translation)).MulV(Recip), this.Scale3D.MulV(Recip));
  }
  TransformPosition(V: FVector): FVector { return this.Rotation.RotateVector(this.Scale3D.MulV(V)).Add(this.Translation); }
  TransformVector(V: FVector): FVector { return this.Rotation.RotateVector(this.Scale3D.MulV(V)); }
  TransformVectorNoScale(V: FVector): FVector { return this.Rotation.RotateVector(V); }
  InverseTransformPosition(V: FVector): FVector {
    const Local = this.Rotation.UnrotateVector(V.Sub(this.Translation));
    return new FVector(Local.X * SafeRecip(this.Scale3D.X), Local.Y * SafeRecip(this.Scale3D.Y), Local.Z * SafeRecip(this.Scale3D.Z));
  }
  InverseTransformVectorNoScale(V: FVector): FVector { return this.Rotation.UnrotateVector(V); }
}

function SafeRecip(V: number): number {
  return Math.abs(V) <= UE_SMALL_NUMBER ? 0 : 1 / V;
}

function SrgbToLinear(V: number): number {
  return V <= 0.04045 ? V / 12.92 : Math.pow((V + 0.055) / 1.055, 2.4);
}
function LinearToSrgb(V: number): number {
  V = Math.min(1, Math.max(0, V));
  return V <= 0.0031308 ? V * 12.92 : 1.055 * Math.pow(V, 1 / 2.4) - 0.055;
}

/** A linear-light colour. The HUD's colours are linear too and are gamma-encoded when drawn (see Css). */
export class FLinearColor {
  constructor(
    readonly R: number = 0,
    readonly G: number = 0,
    readonly B: number = 0,
    readonly A: number = 1,
  ) {}
  static readonly White = new FLinearColor(1, 1, 1, 1);
  static readonly Black = new FLinearColor(0, 0, 0, 1);
  static readonly Transparent = new FLinearColor(0, 0, 0, 0);
  /** FLinearColor(FColor(R, G, B)): from 8-bit sRGB. */
  static FromSrgb(R: number, G: number, B: number, A: number = 255): FLinearColor {
    return new FLinearColor(SrgbToLinear(R / 255), SrgbToLinear(G / 255), SrgbToLinear(B / 255), A / 255);
  }
  Mul(S: number): FLinearColor { return new FLinearColor(this.R * S, this.G * S, this.B * S, this.A * S); }
  MulC(B: FLinearColor): FLinearColor { return new FLinearColor(this.R * B.R, this.G * B.G, this.B * B.B, this.A * B.A); }
  Add(B: FLinearColor): FLinearColor { return new FLinearColor(this.R + B.R, this.G + B.G, this.B + B.B, this.A + B.A); }
  WithA(A: number): FLinearColor { return new FLinearColor(this.R, this.G, this.B, A); }
  CopyWithNewOpacity(A: number): FLinearColor { return new FLinearColor(this.R, this.G, this.B, A); }
  Lerp(B: FLinearColor, Alpha: number): FLinearColor {
    return new FLinearColor(this.R + (B.R - this.R) * Alpha, this.G + (B.G - this.G) * Alpha, this.B + (B.B - this.B) * Alpha, this.A + (B.A - this.A) * Alpha);
  }
  /** CSS colour for a 2D canvas (which works in sRGB). */
  Css(): string {
    const R = Math.round(LinearToSrgb(this.R) * 255);
    const G = Math.round(LinearToSrgb(this.G) * 255);
    const B = Math.round(LinearToSrgb(this.B) * 255);
    return this.A >= 1 ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${Math.max(0, this.A).toFixed(4)})`;
  }
}

/** Axis-aligned 2D box, used for click targets. */
export class FBox2D {
  constructor(
    readonly Min: FVector2D,
    readonly Max: FVector2D,
  ) {}
  IsInside(P: FVector2D): boolean { return P.X > this.Min.X && P.X < this.Max.X && P.Y > this.Min.Y && P.Y < this.Max.Y; }
}

interface Lerpable<T> { Lerp(B: T, Alpha: number): T; }

let RandomSource: () => number = Math.random;

export const FMath = {
  Clamp(V: number, Lo: number, Hi: number): number { return V < Lo ? Lo : V > Hi ? Hi : V; },
  Max(A: number, B: number): number { return A > B ? A : B; },
  Min(A: number, B: number): number { return A < B ? A : B; },
  Abs: Math.abs,
  Sin: Math.sin,
  Cos: Math.cos,
  Tan: Math.tan,
  Atan2: Math.atan2,
  Sqrt: Math.sqrt,
  Pow: Math.pow,
  Square(V: number): number { return V * V; },
  Fmod(A: number, B: number): number { return A % B; },
  RoundToFloat(V: number): number { return Math.floor(V + 0.5); },
  RoundToInt(V: number): number { return Math.floor(V + 0.5); },
  CeilToInt: Math.ceil,
  FloorToInt: Math.floor,
  FloorToInt64: Math.floor,
  TruncToInt: Math.trunc,
  DegreesToRadians(V: number): number { return V * DEG; },
  RadiansToDegrees(V: number): number { return V * RAD; },
  IsNearlyEqual(A: number, B: number, Tolerance: number = UE_SMALL_NUMBER): boolean { return Math.abs(A - B) <= Tolerance; },
  IsNearlyZero(A: number, Tolerance: number = UE_SMALL_NUMBER): boolean { return Math.abs(A) <= Tolerance; },
  /** Lerp for numbers and for any of the value types above. */
  Lerp<T extends number | Lerpable<any>>(A: T, B: T, Alpha: number): T {
    if (typeof A === 'number') { return (A + ((B as number) - A) * Alpha) as T; }
    return (A as Lerpable<any>).Lerp(B, Alpha) as T;
  },
  FRand(): number { return RandomSource(); },
  FRandRange(Lo: number, Hi: number): number { return Lo + (Hi - Lo) * RandomSource(); },
  /** Random integer in [Lo, Hi], both ends included. */
  RandRange(Lo: number, Hi: number): number { return Lo + Math.min(Hi - Lo, Math.floor(RandomSource() * (Hi - Lo + 1))); },
  RandBool(): boolean { return RandomSource() < 0.5; },
  FInterpTo(Current: number, Target: number, DeltaTime: number, InterpSpeed: number): number {
    if (InterpSpeed <= 0) { return Target; }
    const Dist = Target - Current;
    if (Dist * Dist < UE_SMALL_NUMBER) { return Target; }
    return Current + Dist * FMath.Clamp(DeltaTime * InterpSpeed, 0, 1);
  },
  FInterpConstantTo(Current: number, Target: number, DeltaTime: number, InterpSpeed: number): number {
    const Dist = Target - Current;
    if (Dist * Dist < UE_SMALL_NUMBER) { return Target; }
    const Step = InterpSpeed * DeltaTime;
    return Current + FMath.Clamp(Dist, -Step, Step);
  },
  VInterpTo(Current: FVector, Target: FVector, DeltaTime: number, InterpSpeed: number): FVector {
    if (InterpSpeed <= 0) { return Target; }
    const Dist = Target.Sub(Current);
    if (Dist.SizeSquared() < UE_KINDA_SMALL_NUMBER) { return Target; }
    return Current.Add(Dist.Mul(FMath.Clamp(DeltaTime * InterpSpeed, 0, 1)));
  },
  /** Shortest signed turn from heading A1 to heading A2. */
  FindDeltaAngleDegrees(A1: number, A2: number): number {
    let Delta = A2 - A1;
    if (Delta > 180) { Delta -= 360; } else if (Delta < -180) { Delta += 360; }
    return Delta;
  },
  /** Replaces the generator behind FRand and friends (scripted test runs pass a seeded one). */
  SetRandomSource(Source: () => number): void { RandomSource = Source; },
};

/** Unreal's seeded generator, bit for bit, so seeded layouts (the crowd) match the desktop game. */
export class FRandomStream {
  private Seed = 0;
  constructor(InSeed: number = 0) { this.Initialize(InSeed); }
  Initialize(InSeed: number): void { this.Seed = InSeed >>> 0; }
  private Mutate(): void { this.Seed = (Math.imul(this.Seed, 196314165) + 907633515) >>> 0; }
  FRand(): number {
    this.Mutate();
    return (this.Seed >>> 9) / 8388608;
  }
  FRandRange(Lo: number, Hi: number): number { return Lo + (Hi - Lo) * this.FRand(); }
  RandRange(Lo: number, Hi: number): number {
    const Range = Hi - Lo + 1;
    return Lo + (Range > 0 ? Math.trunc(this.FRand() * (Range - 0.00001)) : 0);
  }
  /** A random unit vector. */
  VRand(): FVector {
    for (;;) {
      const V = new FVector(this.FRand() * 2 - 1, this.FRand() * 2 - 1, this.FRand() * 2 - 1);
      const L = V.SizeSquared();
      if (L <= 1 && L >= UE_KINDA_SMALL_NUMBER) { return V.Mul(1 / Math.sqrt(L)); }
    }
  }
}

/** A small seeded generator for repeatable test runs (mulberry32). */
export function SeededRandom(Seed: number): () => number {
  let A = Seed >>> 0;
  return () => {
    A = (A + 0x6d2b79f5) >>> 0;
    let T = A;
    T = Math.imul(T ^ (T >>> 15), T | 1);
    T ^= T + Math.imul(T ^ (T >>> 7), T | 61);
    return ((T ^ (T >>> 14)) >>> 0) / 4294967296;
  };
}

/** printf-style %d/%s/%.1f formatting for the handful of FString::Printf calls worth keeping verbatim. */
export function Printf(Format: string, ...Args: unknown[]): string {
  let i = 0;
  return Format.replace(/%(-?0?\d*)(?:\.(\d+))?([dsfi%])/g, (_Match, Width: string, Precision: string | undefined, Kind: string) => {
    if (Kind === '%') { return '%'; }
    const Arg = Args[i++];
    let Text: string;
    if (Kind === 'd' || Kind === 'i') { Text = String(Math.trunc(Number(Arg))); }
    else if (Kind === 'f') { Text = Number(Arg).toFixed(Precision === undefined ? 6 : Number(Precision)); }
    else { Text = String(Arg); }
    if (Width) {
      const Zero = Width.startsWith('0') || Width.startsWith('-0');
      const N = Math.abs(parseInt(Width, 10));
      if (!Number.isNaN(N)) { Text = Width.startsWith('-') ? Text.padEnd(N) : Text.padStart(N, Zero ? '0' : ' '); }
    }
    return Text;
  });
}
