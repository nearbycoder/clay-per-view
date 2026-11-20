// The world the game lives in: actors that tick, a clock that can be slowed or paused, and the
// components the game code places in the scene. Class and method names follow Unreal's so the code in
// src/game reads like the C++ it was ported from; underneath it is three.js.

import {
  Bone,
  BufferGeometry,
  DetachedBindMode,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  Scene,
  Skeleton,
  SkinnedMesh,
} from 'three';

import { Assets, FSkeletalMeshAsset, FStaticMeshAsset } from './assets';
import { ToMatrix4, WriteMatrix } from './convert';
import { DefaultMaterial, Shared, UMaterialInstanceDynamic } from './materials';
import { FRotator, FTransform, FVector, INDEX_NONE } from './ue';

export class AActor {
  World!: UWorld;
  private Location = FVector.ZeroVector;
  private Rotation = FRotator.ZeroRotator;
  bDestroyed = false;

  GetWorld(): UWorld { return this.World; }
  GetActorLocation(): FVector { return this.Location; }
  GetActorRotation(): FRotator { return this.Rotation; }
  GetActorTransform(): FTransform { return new FTransform(this.Rotation, this.Location); }
  SetActorLocation(Location: FVector): void { this.Location = Location; }
  // Unreal keeps an actor's rotation as a quaternion, so what comes back is always wrapped to +-180 degrees.
  SetActorRotation(Rotation: FRotator): void { this.Rotation = Rotation.GetNormalized(); }
  SetActorLocationAndRotation(Location: FVector, Rotation: FRotator): void {
    this.Location = Location;
    this.Rotation = Rotation.GetNormalized();
  }
  /** Called once, after the actor has its world and starting transform. */
  BeginPlay(): void {}
  Tick(_DeltaTime: number): void {}
  Destroy(): void { this.bDestroyed = true; }
}

export class UWorld {
  readonly Scene = new Scene();
  readonly Actors: AActor[] = [];
  /** Game time: slowed by TimeDilation, stopped while that is near zero. */
  TimeSeconds = 0;
  RealTimeSeconds = 0;
  DeltaSeconds = 0;
  RealDeltaSeconds = 0;
  TimeDilation = 1;

  GetTimeSeconds(): number { return this.TimeSeconds; }

  SpawnActor<T extends AActor>(Class: new () => T, Location: FVector = FVector.ZeroVector, Rotation: FRotator = FRotator.ZeroRotator): T {
    const Actor = new Class();
    Actor.World = this;
    Actor.SetActorLocationAndRotation(Location, Rotation);
    this.Actors.push(Actor);
    Actor.BeginPlay();
    return Actor;
  }

  /** Advances the clocks and ticks every actor, in the order they were spawned. */
  Tick(RealDeltaTime: number): void {
    this.RealDeltaSeconds = RealDeltaTime;
    this.DeltaSeconds = RealDeltaTime * this.TimeDilation;
    this.RealTimeSeconds += RealDeltaTime;
    this.TimeSeconds += this.DeltaSeconds;
    Shared.uTime.value = this.TimeSeconds;
    for (let i = 0; i < this.Actors.length; ++i) {
      const Actor = this.Actors[i];
      if (!Actor.bDestroyed) { Actor.Tick(this.DeltaSeconds); }
    }
    for (let i = this.Actors.length - 1; i >= 0; --i) {
      if (this.Actors[i].bDestroyed) { this.Actors.splice(i, 1); }
    }
  }
}

/**
 * The camera's focus, named as in Unreal's post-process settings: a focal distance in cm (0 = everything
 * sharp), an f-stop and a sensor width in mm. There is one camera, so there is one of these; the renderer
 * reads it every frame.
 */
export const LensSettings = {
  bOverride_DepthOfFieldFocalDistance: false,
  DepthOfFieldFocalDistance: 0,
  bOverride_DepthOfFieldFstop: false,
  DepthOfFieldFstop: 3.2,
  bOverride_DepthOfFieldSensorWidth: false,
  DepthOfFieldSensorWidth: 36,
};

/** The broadcast camera: the game moves it like any actor and main.ts hands its view to the renderer. */
export class ACameraActor extends AActor {
  /** Horizontal field of view in degrees. */
  FieldOfView = 40;
  /** The lens: set DepthOfFieldFocalDistance (cm) to the distance of what should be sharp. */
  PostProcessSettings = LensSettings;
  PostProcessBlendWeight = 1;
  SetFieldOfView(Fov: number): void { this.FieldOfView = Fov; }
  GetCameraComponent(): ACameraActor { return this; }
}

/** The one world. Set by main.ts before anything is spawned. */
export let GWorld: UWorld;
export function SetWorld(World: UWorld): void { GWorld = World; }

export function IsValid<T extends { bDestroyed?: boolean }>(Thing: T | null | undefined): Thing is T {
  return Thing != null && !Thing.bDestroyed;
}

function MaterialsFor(Asset: FStaticMeshAsset, Overrides: Array<UMaterialInstanceDynamic | null>, bInstanced: boolean): Material | Material[] {
  const List = Asset.Materials.map((Name, i) => (Overrides[i] ?? DefaultMaterial(Name, bInstanced)).Material);
  return List.length === 1 ? List[0] : List;
}

// ----------------------------------------------------------------------------------------------------

/** A single mesh: props, weapons, arena pieces, comic words. */
export class UStaticMeshComponent {
  Mesh: Mesh | null = null;
  bDestroyed = false;
  private Asset: FStaticMeshAsset | null = null;
  private Overrides: Array<UMaterialInstanceDynamic | null> = [];
  private World = FTransform.Identity;
  private Relative = FTransform.Identity;
  private Parent: UPoseableMeshComponent | null = null;
  private ParentBone = INDEX_NONE;
  private bVisible = true;
  private bShadow = true;

  /** Name is an asset name ("SM_Chair") or an Unreal path; null shows nothing. */
  SetStaticMesh(Name: string | null): void {
    const Asset = Name ? Assets.StaticMesh(Name) : null;
    if (Asset === this.Asset) { return; }
    this.Asset = Asset;
    if (this.Mesh) {
      GWorld.Scene.remove(this.Mesh);
      this.Mesh = null;
    }
    if (!Asset) {
      if (Name) { console.warn(`Missing mesh ${Name}`); }
      return;
    }
    this.Mesh = new Mesh(Asset.Geometry, MaterialsFor(Asset, this.Overrides, false));
    this.Mesh.matrixAutoUpdate = false;
    this.Mesh.castShadow = this.bShadow;
    this.Mesh.receiveShadow = true;
    this.Mesh.visible = this.bVisible;
    GWorld.Scene.add(this.Mesh);
    this.Push();
  }
  GetStaticMeshName(): string { return this.Asset?.Name ?? ''; }
  SetMaterial(Index: number, Mid: UMaterialInstanceDynamic | null): void {
    this.Overrides[Index] = Mid;
    if (this.Mesh && this.Asset) { this.Mesh.material = MaterialsFor(this.Asset, this.Overrides, false); }
  }
  SetVisibility(bVisible: boolean): void {
    this.bVisible = bVisible;
    if (this.Mesh) { this.Mesh.visible = bVisible; }
  }
  IsVisible(): boolean { return this.bVisible; }
  SetCastShadow(bCast: boolean): void {
    this.bShadow = bCast;
    if (this.Mesh) { this.Mesh.castShadow = bCast; }
  }
  SetWorldTransform(T: FTransform): void {
    this.World = T;
    this.Push();
  }
  SetWorldLocation(Location: FVector): void { this.SetWorldTransform(this.World.WithLocation(Location)); }
  SetWorldRotation(Rotation: FRotator): void { this.SetWorldTransform(this.World.WithRotation(Rotation.Quaternion())); }
  SetWorldLocationAndRotation(Location: FVector, Rotation: FRotator): void {
    this.SetWorldTransform(new FTransform(Rotation, Location, this.World.Scale3D));
  }
  SetWorldScale3D(Scale: FVector): void { this.SetWorldTransform(this.World.WithScale3D(Scale)); }
  GetComponentTransform(): FTransform { return this.World; }
  GetComponentLocation(): FVector { return this.World.Translation; }

  /** Rides a bone of a puppet from now on (BoneName as in the skeleton, e.g. "hand_r"). */
  AttachToComponent(Parent: UPoseableMeshComponent, BoneName: string): void {
    this.DetachFromComponent();
    this.Parent = Parent;
    this.ParentBone = Parent.FindBoneIndex(BoneName);
    Parent.Attached.add(this);
    this.UpdateAttachment();
  }
  DetachFromComponent(): void {
    this.Parent?.Attached.delete(this);
    this.Parent = null;
  }
  SetRelativeTransform(T: FTransform): void {
    this.Relative = T;
    this.UpdateAttachment();
  }
  UpdateAttachment(): void {
    if (!this.Parent) { return; }
    const Bone = this.ParentBone !== INDEX_NONE ? this.Parent.GetBoneCS(this.ParentBone) : FTransform.Identity;
    this.World = this.Relative.Mul(Bone).Mul(this.Parent.GetComponentTransform());
    this.Push();
  }
  DestroyComponent(): void {
    this.DetachFromComponent();
    if (this.Mesh) { GWorld.Scene.remove(this.Mesh); }
    this.Mesh = null;
    this.bDestroyed = true;
  }
  private Push(): void {
    if (!this.Mesh) { return; }
    ToMatrix4(this.World, this.Mesh.matrix);
    this.Mesh.matrixWorldNeedsUpdate = true;
  }
}

// ----------------------------------------------------------------------------------------------------

/** Many copies of one mesh with per-instance data: the crowd, the ropes, every effect particle. */
export class UInstancedStaticMeshComponent {
  Mesh: InstancedMesh | null = null;
  private Asset: FStaticMeshAsset | null = null;
  private Overrides: Array<UMaterialInstanceDynamic | null> = [];
  private NumCustom = 0;
  private Count = 0;
  private bVisible = true;
  private bShadow = false;
  /** Effects and ropes move every frame and are never worth culling as a group. */
  bFrustumCull = false;

  SetStaticMesh(Name: string): void {
    this.Asset = Assets.StaticMesh(Name);
    if (!this.Asset) { console.warn(`Missing mesh ${Name}`); }
  }
  IsValid(): boolean { return this.Asset !== null; }
  SetMaterial(Index: number, Mid: UMaterialInstanceDynamic | null): void {
    this.Overrides[Index] = Mid;
    if (this.Mesh && this.Asset) { this.Mesh.material = MaterialsFor(this.Asset, this.Overrides, true); }
  }
  SetNumCustomDataFloats(Num: number): void { this.NumCustom = Num; }
  SetCastShadow(bCast: boolean): void {
    this.bShadow = bCast;
    if (this.Mesh) { this.Mesh.castShadow = bCast; }
  }
  SetVisibility(bVisible: boolean): void {
    this.bVisible = bVisible;
    if (this.Mesh) { this.Mesh.visible = bVisible; }
  }
  GetInstanceCount(): number { return this.Count; }
  /** Draws only the first Num instances (thinning the crowd without rebuilding it). */
  SetDrawCount(Num: number): void {
    if (this.Mesh) { this.Mesh.count = Math.max(0, Math.min(this.Count, Math.floor(Num))); }
  }

  /** Creates the instances (call once per component). */
  AddInstances(Transforms: FTransform[]): void {
    if (!this.Asset || Transforms.length === 0) { return; }
    if (this.Mesh) { throw new Error('AddInstances may only be called once per component'); }
    this.Count = Transforms.length;
    // A geometry of its own that shares the vertex buffers, so it can carry per-instance attributes.
    const Source = this.Asset.Geometry;
    const Geometry = new BufferGeometry();
    for (const Name of Object.keys(Source.attributes)) { Geometry.setAttribute(Name, Source.getAttribute(Name)); }
    Geometry.setIndex(Source.index);
    for (const Group of Source.groups) { Geometry.addGroup(Group.start, Group.count, Group.materialIndex); }
    Geometry.boundingBox = Source.boundingBox;
    Geometry.boundingSphere = Source.boundingSphere;
    const Vec4s = Math.ceil(this.NumCustom / 4);
    for (let k = 0; k < Vec4s; ++k) {
      const Slice = new Float32Array(this.Count * 4).fill(1);
      Geometry.setAttribute(`aCustom${k}`, new InstancedBufferAttribute(Slice, 4));
    }
    this.Mesh = new InstancedMesh(Geometry, MaterialsFor(this.Asset, this.Overrides, true), this.Count);
    this.Mesh.matrixAutoUpdate = false;
    this.Mesh.castShadow = this.bShadow;
    this.Mesh.receiveShadow = true;
    this.Mesh.frustumCulled = this.bFrustumCull;
    this.Mesh.visible = this.bVisible;
    GWorld.Scene.add(this.Mesh);
    this.BatchUpdateInstancesTransforms(0, Transforms);
    if (this.bFrustumCull) { this.Mesh.computeBoundingSphere(); }
  }
  /** Row holds this component's custom floats for one instance. */
  SetCustomData(Index: number, Row: ArrayLike<number>): void {
    if (!this.Mesh || Index < 0 || Index >= this.Count) { return; }
    for (let i = 0; i < Row.length && i < this.NumCustom; ++i) {
      const Attr = this.Mesh.geometry.getAttribute(`aCustom${i >> 2}`) as InstancedBufferAttribute;
      (Attr.array as Float32Array)[Index * 4 + (i & 3)] = Row[i];
      Attr.needsUpdate = true;
    }
  }
  /** Num limits how many of Transforms are written (all of them when omitted). */
  BatchUpdateInstancesTransforms(Start: number, Transforms: FTransform[], Num: number = Transforms.length): void {
    if (!this.Mesh) { return; }
    const Array = this.Mesh.instanceMatrix.array as Float32Array;
    const End = Math.min(this.Count, Start + Math.min(Num, Transforms.length));
    for (let i = Start; i < End; ++i) { WriteMatrix(Transforms[i - Start], Array, i * 16); }
    this.Mesh.instanceMatrix.needsUpdate = true;
  }
  MarkRenderStateDirty(): void {}
}

// ----------------------------------------------------------------------------------------------------

/** A skinned character whose bones are placed directly by code (CpvPose.ts), not by animation assets. */
export class UPoseableMeshComponent {
  Mesh: SkinnedMesh | null = null;
  Asset: FSkeletalMeshAsset | null = null;
  readonly Attached = new Set<UStaticMeshComponent>();
  /** Mirrors Unreal's bounds scale; unused here (puppets are never culled). */
  BoundsScale = 1;
  private Bones: Bone[] = [];
  private BoneCS: FTransform[] = [];
  private Overrides: Array<UMaterialInstanceDynamic | null> = [];
  private World = FTransform.Identity;
  private bVisible = true;

  GetSkinnedAsset(): FSkeletalMeshAsset | null { return this.Asset; }

  /** Name is "SK_Rex" or an Unreal path. Returns false if there is no such character. */
  SetSkinnedAssetAndUpdate(Name: string): boolean {
    const Asset = Assets.SkeletalMesh(Name);
    if (!Asset) { return false; }
    if (this.Mesh) { GWorld.Scene.remove(this.Mesh); }
    this.Asset = Asset;
    this.Overrides = [];
    this.Bones = Asset.BoneNames.map((BoneName) => {
      const B = new Bone();
      B.name = BoneName;
      B.matrixAutoUpdate = false;
      return B;
    });
    this.BoneCS = Asset.BoneNames.map((BoneName) => {
      const Ref = Asset.RefPose.get(BoneName);
      return Ref ? new FTransform(Ref.Rot, Ref.Pos) : FTransform.Identity;
    });
    this.Mesh = new SkinnedMesh(Asset.Geometry, MaterialsFor(Asset, this.Overrides, false));
    // Detached: the bones below are not scene objects; their matrices are written in the mesh's own space.
    this.Mesh.bindMode = DetachedBindMode;
    this.Mesh.bind(new Skeleton(this.Bones, Asset.BoneInverses), new Matrix4());
    this.Mesh.matrixAutoUpdate = false;
    this.Mesh.frustumCulled = false;
    this.Mesh.castShadow = true;
    this.Mesh.receiveShadow = true;
    this.Mesh.visible = this.bVisible;
    GWorld.Scene.add(this.Mesh);
    for (let i = 0; i < this.Bones.length; ++i) { ToMatrix4(this.BoneCS[i], this.Bones[i].matrixWorld); }
    this.PushWorld();
    return true;
  }
  /** Slot names as the game tests them: a slot whose name contains "Glow" is emissive. */
  GetMaterialSlotNames(): string[] { return this.Asset ? this.Asset.Materials.map((M) => (M === 'M_Glow' ? 'Glow' : 'Clay')) : []; }
  GetNumMaterials(): number { return this.Asset ? this.Asset.Materials.length : 0; }
  SetMaterial(Index: number, Mid: UMaterialInstanceDynamic | null): void {
    this.Overrides[Index] = Mid;
    if (this.Mesh && this.Asset) { this.Mesh.material = MaterialsFor(this.Asset, this.Overrides, false); }
  }
  FindBoneIndex(BoneName: string): number { return this.Asset ? this.Asset.BoneNames.indexOf(BoneName) : INDEX_NONE; }
  /** Reference pose of a bone in component space. */
  GetRefBoneCS(Index: number): FTransform {
    const Ref = this.Asset?.RefPose.get(this.Asset.BoneNames[Index]);
    return Ref ? new FTransform(Ref.Rot, Ref.Pos) : FTransform.Identity;
  }
  GetBoneCS(Index: number): FTransform { return this.BoneCS[Index] ?? FTransform.Identity; }
  /** Places a bone in component space. Call RefreshBoneTransforms after the last one. */
  SetBoneCS(Index: number, T: FTransform): void {
    if (Index < 0 || Index >= this.Bones.length) { return; }
    this.BoneCS[Index] = T;
    ToMatrix4(T, this.Bones[Index].matrixWorld);
  }
  RefreshBoneTransforms(): void {
    for (const Prop of this.Attached) { Prop.UpdateAttachment(); }
  }
  SetWorldTransform(T: FTransform): void {
    this.World = T;
    this.PushWorld();
    for (const Prop of this.Attached) { Prop.UpdateAttachment(); }
  }
  GetComponentTransform(): FTransform { return this.World; }
  SetVisibility(bVisible: boolean): void {
    this.bVisible = bVisible;
    if (this.Mesh) { this.Mesh.visible = bVisible; }
  }
  IsVisible(): boolean { return this.bVisible; }
  SetCastShadow(bCast: boolean): void {
    if (this.Mesh) { this.Mesh.castShadow = bCast; }
  }
  DestroyComponent(): void {
    if (this.Mesh) { GWorld.Scene.remove(this.Mesh); }
    this.Mesh = null;
  }
  private PushWorld(): void {
    if (!this.Mesh) { return; }
    ToMatrix4(this.World, this.Mesh.matrix);
    this.Mesh.matrixWorldNeedsUpdate = true;
  }
}

/** Adds a plain three.js object (lights, helpers) to the scene. */
export function AddToScene<T extends Object3D>(Obj: T): T {
  GWorld.Scene.add(Obj);
  return Obj;
}
