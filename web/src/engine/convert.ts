// Unreal -> three.js. Unreal is left-handed with Z up and works in centimetres; three.js is right-handed
// with Y up and the scene here is in metres. Swapping Y and Z maps one onto the other (it is the same
// mapping Unreal's glTF exporter used for the models), so a game-side transform T becomes P * T * P.

import { Matrix4, Quaternion, Vector3 } from 'three';

import { FQuat, FRotator, FTransform, FVector } from './ue';

export const CM = 0.01;

export function ToVector3(V: FVector, Out: Vector3 = new Vector3()): Vector3 {
  return Out.set(V.X * CM, V.Z * CM, V.Y * CM);
}

/** A direction (no unit change). */
export function ToDirection3(V: FVector, Out: Vector3 = new Vector3()): Vector3 {
  return Out.set(V.X, V.Z, V.Y);
}

export function FromVector3(V: Vector3): FVector {
  return new FVector(V.x / CM, V.z / CM, V.y / CM);
}

export function ToQuaternion(Q: FQuat, Out: Quaternion = new Quaternion()): Quaternion {
  return Out.set(-Q.X, -Q.Z, -Q.Y, Q.W);
}

const TmpQ = new Quaternion();
const TmpP = new Vector3();
const TmpS = new Vector3();

/** Writes the three.js matrix for an Unreal transform (rotation, translation in cm, scale). */
export function ToMatrix4(T: FTransform, Out: Matrix4 = new Matrix4()): Matrix4 {
  const Q = T.Rotation;
  const S = T.Scale3D;
  const P = T.Translation;
  return Out.compose(TmpP.set(P.X * CM, P.Z * CM, P.Y * CM), TmpQ.set(-Q.X, -Q.Z, -Q.Y, Q.W), TmpS.set(S.X, S.Z, S.Y));
}

/** Same, straight into a flat array of 4x4 matrices (instance buffers). */
export function WriteMatrix(T: FTransform, Array: Float32Array, Offset: number): void {
  const Q = T.Rotation;
  const S = T.Scale3D;
  const P = T.Translation;
  const x = -Q.X, y = -Q.Z, z = -Q.Y, w = Q.W;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = S.X, sy = S.Z, sz = S.Y;
  Array[Offset] = (1 - (yy + zz)) * sx;
  Array[Offset + 1] = (xy + wz) * sx;
  Array[Offset + 2] = (xz - wy) * sx;
  Array[Offset + 3] = 0;
  Array[Offset + 4] = (xy - wz) * sy;
  Array[Offset + 5] = (1 - (xx + zz)) * sy;
  Array[Offset + 6] = (yz + wx) * sy;
  Array[Offset + 7] = 0;
  Array[Offset + 8] = (xz + wy) * sz;
  Array[Offset + 9] = (yz - wx) * sz;
  Array[Offset + 10] = (1 - (xx + yy)) * sz;
  Array[Offset + 11] = 0;
  Array[Offset + 12] = P.X * CM;
  Array[Offset + 13] = P.Z * CM;
  Array[Offset + 14] = P.Y * CM;
  Array[Offset + 15] = 1;
}

/**
 * Camera matrix. An Unreal camera looks along its +X with +Z up; a three.js camera looks along its -Z
 * with +Y up.
 */
export function ToCameraMatrix(Location: FVector, Rotation: FRotator, Out: Matrix4 = new Matrix4()): Matrix4 {
  const Q = Rotation.Quaternion();
  const F = Q.RotateVector(FVector.ForwardVector);
  const R = Q.RotateVector(FVector.RightVector);
  const U = Q.RotateVector(FVector.UpVector);
  Out.set(
    R.X, U.X, -F.X, Location.X * CM,
    R.Z, U.Z, -F.Z, Location.Z * CM,
    R.Y, U.Y, -F.Y, Location.Y * CM,
    0, 0, 0, 1,
  );
  return Out;
}

/** Unreal fixes the horizontal field of view; three.js wants the vertical one. */
export function VerticalFov(HorizontalDeg: number, Aspect: number): number {
  return (2 * Math.atan(Math.tan((HorizontalDeg * Math.PI) / 360) / Aspect) * 180) / Math.PI;
}
