#pragma once

#include "CoreMinimal.h"
#include "CpvPose.h"
#include "GameFramework/Actor.h"
#include "CpvPuppet.generated.h"

class UPoseableMeshComponent;
class UMaterialInstanceDynamic;
class UStaticMeshComponent;

/** A damped two-axis wobble for hair, hats, bellies and skirts. */
struct FCpvSpring
{
	FVector2f Angle = FVector2f::ZeroVector; // degrees: X = tip forward, Y = tip to the right
	FVector2f Vel = FVector2f::ZeroVector;
	float Stiffness = 190.f;
	float Damping = 9.f;
	float Gain = 0.5f;    // how hard acceleration of the attachment point kicks the tip
	float Limit = 38.f;

	void Step(float Dt, const FVector2f& LocalAccel);
	FQuat Rotation() const;
};

/**
 * A clay character on the shared skeleton, animated pose-to-pose and shown in stepped "frames" like
 * stop-motion. Fighters, the referee and the commentators are all puppets.
 */
UCLASS()
class ACpvPuppet : public AActor
{
	GENERATED_BODY()
public:
	ACpvPuppet();
	virtual void Tick(float DeltaTime) override;

	/** Loads /Game/CPV/Characters/SK_<Name>. */
	void SetCharacter(const FString& Name);
	/** Multiplies the clay colours (used to tell twins apart in a mirror match). */
	void SetTint(const FLinearColor& Tint);
	const FString& GetCharacterName() const { return CharacterName; }

	void Play(FName Clip, float BlendTime = 0.1f, float Rate = 1.f, bool bRestart = true);
	FName GetClip() const { return ClipName; }
	float GetClipTime() const { return ClipTime; }
	float GetClipLength() const;
	bool IsClipDone() const;
	void SetClipTime(float NewTime) { ClipTime = NewTime; }
	void SetRate(float NewRate) { ClipRate = NewRate; }
	/** Hit-stop: hold the current frame. */
	void Freeze(float Seconds) { FreezeLeft = FMath::Max(FreezeLeft, Seconds); }
	bool IsFrozen() const { return FreezeLeft > 0.f; }

	void SetFace(ECpvFace Face, float Seconds);
	void HitFlash(float Strength = 1.f);
	/** Additive flinch in local axes (X = knocked backward, Y = knocked to the right). */
	void Jolt(float Back, float Side);
	void SetLookTarget(const FVector& WorldPoint, float Weight) { LookPoint = WorldPoint; LookWeight = Weight; }
	/** Show the next frame immediately instead of waiting for the stop-motion step. */
	void ForceStep() { bForceStep = true; }

	FTransform GetBoneWorld(ECpvBone Bone) const;
	FVector GetBoneLocation(ECpvBone Bone) const { return GetBoneWorld(Bone).GetLocation(); }
	FVector GetHeadLocation() const;
	UPoseableMeshComponent* GetMesh() const { return Mesh; }
	const FCpvRig& GetRig() const { return Rig; }
	float GetHeight() const { return Rig.Height; }

	/** Attach a prop to a bone (it then follows the stepped animation). */
	void AttachProp(UStaticMeshComponent* Prop, ECpvBone Bone, const FTransform& Relative);

	/** Visual-only adjustments (the actor itself stays where gameplay put it). */
	FVector VisualOffset = FVector::ZeroVector;
	FVector VisualScale = FVector(1.0, 1.0, 1.0);
	float VisualYaw = 0.f;
	FVector2f HeadSquash = FVector2f(1.f, 1.f);
	float BoneScale[static_cast<int32>(ECpvBone::Count)];
	bool bHidden = false;
	/** Play everything left-right swapped (fighters facing screen-left do, so both open up toward the camera). */
	bool bMirror = false;

	/** Frames per second the whole cast is animated at; 0 = smooth. */
	static float StepRate;

protected:
	virtual void UpdatePose(float StepDt);
	void ApplyFace(ECpvFace Face, FCpvRigExtras& Extras, float StepDt);

	UPROPERTY()
	TObjectPtr<UPoseableMeshComponent> Mesh;
	UPROPERTY()
	TArray<TObjectPtr<UMaterialInstanceDynamic>> Materials;

	FCpvRig Rig;
	FString CharacterName;

	FName ClipName;
	const FCpvClip* Clip = nullptr;
	float ClipTime = 0.f;
	float ClipRate = 1.f;
	FCpvPose FromPose;
	FCpvPose LastPose;
	float BlendTime = 0.f;
	float BlendLeft = 0.f;
	float FreezeLeft = 0.f;
	float MirrorAlpha = 0.f;

	ECpvFace FaceOverride = ECpvFace::Neutral;
	float FaceOverrideLeft = 0.f;
	float BlinkIn = 2.f;
	float BlinkLeft = 0.f;
	float Flash = 0.f;
	FVector2f JoltAngle = FVector2f::ZeroVector;
	FVector2f JoltVel = FVector2f::ZeroVector;
	FVector LookPoint = FVector::ZeroVector;
	float LookWeight = 0.f;
	FVector2f LookNow = FVector2f::ZeroVector;
	float Age = 0.f;
	float Seed = 0.f;

	FCpvSpring HairSpring, TailSpring, BellySpring, SkirtSpring;
	FVector LastHeadPos = FVector::ZeroVector;
	FVector LastHeadVel = FVector::ZeroVector;
	FVector LastHipPos = FVector::ZeroVector;
	FVector LastHipVel = FVector::ZeroVector;
	bool bHaveHistory = false;

	int64 LastStepIndex = -1;
	float StepAccum = 0.f;
	bool bForceStep = true;
};
