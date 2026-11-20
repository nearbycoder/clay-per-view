#include "CpvPuppet.h"
#include "ClayPerView.h"

#include "Components/PoseableMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/World.h"
#include "Materials/MaterialInstanceDynamic.h"

float ACpvPuppet::StepRate = 12.f;

void FCpvSpring::Step(float Dt, const FVector2f& LocalAccel)
{
	// The attachment's acceleration pushes the tip the other way; a spring pulls it back upright.
	const int32 Sub = FMath::Clamp(FMath::CeilToInt(Dt / 0.012f), 1, 12);
	const float H = Dt / Sub;
	for (int32 i = 0; i < Sub; ++i)
	{
		Vel += (Angle * -Stiffness - Vel * Damping - LocalAccel * Gain) * H;
		Angle += Vel * H;
	}
	Angle.X = FMath::Clamp(Angle.X, -Limit, Limit);
	Angle.Y = FMath::Clamp(Angle.Y, -Limit, Limit);
}

FQuat FCpvSpring::Rotation() const
{
	return FQuat(FVector(0.0, 1.0, 0.0), FMath::DegreesToRadians(Angle.X)) * FQuat(FVector(-1.0, 0.0, 0.0), FMath::DegreesToRadians(Angle.Y));
}

ACpvPuppet::ACpvPuppet()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Mesh = CreateDefaultSubobject<UPoseableMeshComponent>(TEXT("Mesh"));
	Mesh->SetupAttachment(RootComponent);
	Mesh->SetUsingAbsoluteLocation(true);
	Mesh->SetUsingAbsoluteRotation(true);
	Mesh->SetUsingAbsoluteScale(true);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Mesh->SetCastShadow(true);
	Mesh->bCastDynamicShadow = true;
	for (float& S : BoneScale) { S = 1.f; }
	TailSpring.Stiffness = 120.f; TailSpring.Damping = 6.f; TailSpring.Gain = 0.8f; TailSpring.Limit = 55.f;
	BellySpring.Stiffness = 260.f; BellySpring.Damping = 10.f; BellySpring.Gain = 0.25f; BellySpring.Limit = 16.f;
	SkirtSpring.Stiffness = 150.f; SkirtSpring.Damping = 7.f; SkirtSpring.Gain = 0.4f; SkirtSpring.Limit = 22.f;
	Seed = FMath::FRand() * 100.f;
}

void ACpvPuppet::SetCharacter(const FString& Name)
{
	CharacterName = Name;
	const FString Path = FString::Printf(TEXT("/Game/CPV/Characters/SK_%s.SK_%s"), *Name, *Name);
	USkeletalMesh* Asset = LoadObject<USkeletalMesh>(nullptr, *Path);
	if (!Asset)
	{
		UE_LOG(LogCpv, Error, TEXT("Missing character mesh %s"), *Path);
		return;
	}
	Mesh->SetSkinnedAssetAndUpdate(Asset);
	Rig.Init(Mesh);
	// Materials are chosen by slot name here rather than trusted from the asset: "Glow" slots are
	// emissive (LED faces, lit soles), everything else is clay.
	static UMaterialInterface* ClayBase = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/CPV/Materials/M_Clay.M_Clay"));
	static UMaterialInterface* GlowBase = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/CPV/Materials/M_Glow.M_Glow"));
	Materials.Reset();
	const TArray<FName> Slots = Mesh->GetMaterialSlotNames();
	for (int32 i = 0; i < Mesh->GetNumMaterials(); ++i)
	{
		const bool bGlow = Slots.IsValidIndex(i) && Slots[i].ToString().Contains(TEXT("Glow"));
		UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(bGlow ? GlowBase : ClayBase, this);
		if (Mid)
		{
			Mesh->SetMaterial(i, Mid);
			Mid->SetScalarParameterValue(TEXT("Boil"), 0.35f);
			Mid->SetScalarParameterValue(TEXT("BoilRate"), FMath::Max(StepRate, 1.f));
		}
		Materials.Add(Mid);
	}
	bHaveHistory = false;
	bForceStep = true;
	if (!Clip) { Play(TEXT("Idle"), 0.f); }
}

void ACpvPuppet::SetTint(const FLinearColor& Tint)
{
	for (UMaterialInstanceDynamic* Mid : Materials)
	{
		if (Mid) { Mid->SetVectorParameterValue(TEXT("Tint"), Tint); }
	}
}

void ACpvPuppet::Play(FName InClip, float InBlendTime, float Rate, bool bRestart)
{
	if (!bRestart && ClipName == InClip)
	{
		ClipRate = Rate;
		return;
	}
	if (!CpvAnim::Has(InClip))
	{
		UE_LOG(LogCpv, Warning, TEXT("Unknown clip %s"), *InClip.ToString());
		return;
	}
	FromPose = LastPose;
	for (FVector3f& A : FromPose.J)
	{
		// Clips may wind joints past a full turn (rolls, tumbles); blend from the equivalent short angle.
		A.X = FRotator3f::NormalizeAxis(A.X);
		A.Y = FRotator3f::NormalizeAxis(A.Y);
		A.Z = FRotator3f::NormalizeAxis(A.Z);
	}
	BlendTime = InBlendTime;
	BlendLeft = InBlendTime;
	ClipName = InClip;
	Clip = &CpvAnim::Get(InClip);
	ClipTime = 0.f;
	ClipRate = Rate;
}

float ACpvPuppet::GetClipLength() const
{
	return Clip ? Clip->Length : 0.f;
}

bool ACpvPuppet::IsClipDone() const
{
	return !Clip || (!Clip->bLoop && ClipTime >= Clip->Length);
}

void ACpvPuppet::SetFace(ECpvFace Face, float Seconds)
{
	FaceOverride = Face;
	FaceOverrideLeft = Seconds;
}

void ACpvPuppet::HitFlash(float Strength)
{
	Flash = FMath::Max(Flash, Strength);
}

void ACpvPuppet::Jolt(float Back, float Side)
{
	JoltVel += FVector2f(Back, Side) * 14.f;
	JoltAngle += FVector2f(Back, Side) * 0.5f;
}

FTransform ACpvPuppet::GetBoneWorld(ECpvBone Bone) const
{
	return Rig.BoneCS(Bone) * Mesh->GetComponentTransform();
}

FVector ACpvPuppet::GetHeadLocation() const
{
	const FTransform Head = GetBoneWorld(ECpvBone::Head);
	return Head.GetLocation() + Head.GetRotation().RotateVector(FVector(0.0, 14.0, 0.0)); // bone Y runs up the head
}

void ACpvPuppet::AttachProp(UStaticMeshComponent* Prop, ECpvBone Bone, const FTransform& Relative)
{
	if (!Prop) { return; }
	Prop->AttachToComponent(Mesh, FAttachmentTransformRules::KeepRelativeTransform, FCpvRig::BoneName(Bone));
	Prop->SetRelativeTransform(Relative);
}

void ACpvPuppet::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	Age += DeltaTime;

	if (FreezeLeft > 0.f)
	{
		FreezeLeft -= DeltaTime;
	}
	else
	{
		ClipTime += DeltaTime * ClipRate;
		BlendLeft = FMath::Max(0.f, BlendLeft - DeltaTime);
	}
	if (Flash > 0.f)
	{
		Flash = FMath::Max(0.f, Flash - DeltaTime * 7.f);
		for (UMaterialInstanceDynamic* Mid : Materials)
		{
			if (Mid) { Mid->SetScalarParameterValue(TEXT("Flash"), Flash * 0.8f); }
		}
	}

	// The whole cast changes pose on the same clock, a fixed number of times per second.
	StepAccum += DeltaTime;
	bool bStep = bForceStep || StepRate <= 0.f;
	if (!bStep)
	{
		const int64 StepIndex = FMath::FloorToInt64(GetWorld()->GetTimeSeconds() * StepRate);
		bStep = StepIndex != LastStepIndex;
		LastStepIndex = StepIndex;
	}
	if (bStep && Rig.IsValid())
	{
		UpdatePose(FMath::Clamp(StepAccum, 0.001f, 0.25f));
		StepAccum = 0.f;
		bForceStep = false;
	}
	Mesh->SetVisibility(!bHidden);
}

void ACpvPuppet::ApplyFace(ECpvFace Face, FCpvRigExtras& X, float StepDt)
{
	const float T = Age + Seed;
	switch (Face)
	{
	case ECpvFace::Neutral: X.Mouth = ECpvMouth::Closed; X.LidClose = 0.08f; break;
	case ECpvFace::Angry: X.Mouth = ECpvMouth::Grit; X.LidClose = 0.2f; X.BrowAngry = 0.8f; X.BrowRaise = -0.8f; break;
	case ECpvFace::Attack: X.Mouth = ECpvMouth::Open; X.LidClose = 0.05f; X.BrowAngry = 1.f; X.BrowRaise = -0.5f; break;
	case ECpvFace::Effort: X.Mouth = ECpvMouth::Grit; X.LidClose = 0.45f; X.BrowAngry = 1.f; X.BrowRaise = -1.2f; break;
	case ECpvFace::Hurt: X.Mouth = ECpvMouth::Ouch; X.LidClose = 0.95f; X.BrowAngry = -0.9f; X.BrowRaise = 1.2f; break;
	case ECpvFace::Dazed:
		X.Mouth = ECpvMouth::Ouch; X.LidClose = 0.3f; X.BrowAngry = -0.6f; X.BrowRaise = 1.f;
		X.PupilL = FVector2f(FMath::Cos(T * 9.f), FMath::Sin(T * 9.f)) * 1.5f;
		X.PupilR = FVector2f(FMath::Cos(T * 9.f + 2.6f), FMath::Sin(T * 9.f + 2.6f)) * 1.5f;
		break;
	case ECpvFace::Happy: X.Mouth = ECpvMouth::Grin; X.LidClose = 0.1f; X.BrowAngry = -0.2f; X.BrowRaise = 1.4f; break;
	case ECpvFace::Smug: X.Mouth = ECpvMouth::Closed; X.LidClose = 0.4f; X.BrowAngry = 0.3f; X.BrowRaise = 0.6f; break;
	case ECpvFace::Shock: X.Mouth = ECpvMouth::Open; X.LidClose = -1.f; X.BrowAngry = -0.5f; X.BrowRaise = 2.6f; break;
	case ECpvFace::KO:
		X.Mouth = ECpvMouth::Open; X.LidClose = 1.f; X.BrowAngry = -0.7f; X.BrowRaise = 0.6f;
		break;
	}
	// Blinks, unless the eyes are already shut or wide open.
	BlinkIn -= StepDt;
	if (BlinkIn <= 0.f)
	{
		BlinkLeft = 0.13f;
		BlinkIn = FMath::FRandRange(1.6f, 4.5f);
	}
	if (BlinkLeft > 0.f)
	{
		BlinkLeft -= StepDt;
		if (X.LidClose >= 0.f && X.LidClose < 0.9f) { X.LidClose = 1.f; }
	}
}

void ACpvPuppet::UpdatePose(float StepDt)
{
	// --- body pose: current clip, cross-faded from wherever the puppet was ---
	FCpvPose Pose = Clip ? Clip->Sample(ClipTime) : FCpvPose();
	if (BlendLeft > 0.f && BlendTime > 0.f)
	{
		const float A = 1.f - BlendLeft / BlendTime;
		Pose = FCpvPose::Blend(FromPose, Pose, A * A * (3.f - 2.f * A));
	}
	LastPose = Pose;
	MirrorAlpha = FMath::FInterpConstantTo(MirrorAlpha, bMirror ? 1.f : 0.f, StepDt, 8.f);
	if (MirrorAlpha > 0.f)
	{
		Pose = MirrorAlpha >= 1.f ? Pose.Mirrored() : FCpvPose::Blend(Pose, Pose.Mirrored(), MirrorAlpha);
	}

	// --- flinch: a damped spring kicked by Jolt() ---
	{
		const int32 Sub = 4;
		const float H = StepDt / Sub;
		for (int32 i = 0; i < Sub; ++i)
		{
			JoltVel += (JoltAngle * -240.f - JoltVel * 16.f) * H;
			JoltAngle += JoltVel * H;
		}
		JoltAngle.X = FMath::Clamp(JoltAngle.X, -40.f, 40.f);
		JoltAngle.Y = FMath::Clamp(JoltAngle.Y, -40.f, 40.f);
		Pose[ECpvJoint::Spine] += FVector3f(-JoltAngle.X * 0.5f, 0.f, JoltAngle.Y * 0.5f);
		Pose[ECpvJoint::Chest] += FVector3f(-JoltAngle.X * 0.4f, 0.f, JoltAngle.Y * 0.4f);
		Pose[ECpvJoint::Head] += FVector3f(-JoltAngle.X * 0.8f, 0.f, JoltAngle.Y * 0.6f);
	}

	FCpvRigExtras X;
	for (int32 i = 0; i < static_cast<int32>(ECpvBone::Count); ++i) { X.Scale[i] = BoneScale[i]; }
	X.HeadSquash = HeadSquash;

	// --- face ---
	if (FaceOverrideLeft > 0.f) { FaceOverrideLeft -= StepDt; }
	ApplyFace(FaceOverrideLeft > 0.f ? FaceOverride : Pose.Face, X, StepDt);

	// --- look at a point (head turn plus a little eye travel) ---
	const FTransform Actor = GetActorTransform();
	FVector2f LookWant = FVector2f::ZeroVector;
	if (LookWeight > 0.f)
	{
		const FVector Local = Actor.InverseTransformPosition(LookPoint) - FVector(0.0, 0.0, Rig.HeadHeight);
		const float BodyYaw = Pose[ECpvJoint::Pelvis].Y + Pose[ECpvJoint::Spine].Y + Pose[ECpvJoint::Chest].Y + Pose[ECpvJoint::Neck].Y + Pose[ECpvJoint::Head].Y;
		const float Yaw = FMath::RadiansToDegrees(FMath::Atan2(Local.Y, FMath::Max(Local.X, 1.0)));
		const float Pitch = -FMath::RadiansToDegrees(FMath::Atan2(Local.Z, FMath::Max(Local.Size2D(), 1.0)));
		LookWant = FVector2f(FMath::Clamp(Yaw - BodyYaw, -55.f, 55.f), FMath::Clamp(Pitch, -30.f, 30.f)) * LookWeight;
	}
	LookNow = FMath::Lerp(LookNow, LookWant, FMath::Clamp(StepDt * 9.f, 0.f, 1.f));
	X.Look = LookNow;
	const FVector2f Eye(FMath::Clamp(LookNow.X * 0.03f, -1.1f, 1.1f), FMath::Clamp(-LookNow.Y * 0.03f, -0.8f, 0.8f));
	X.PupilL += Eye;
	X.PupilR += Eye;

	// --- secondary motion from how the head and hips moved since the last frame ---
	X.Hair = HairSpring.Rotation();
	X.Tail = TailSpring.Rotation();
	X.Belly = BellySpring.Rotation();
	X.Skirt = SkirtSpring.Rotation();

	Mesh->SetWorldTransform(FTransform(FRotator(0.f, Actor.Rotator().Yaw + VisualYaw, 0.f), Actor.GetLocation() + VisualOffset, VisualScale));
	Rig.Apply(Pose, X);

	const FVector HeadPos = GetBoneLocation(ECpvBone::Head);
	const FVector HipPos = GetBoneLocation(ECpvBone::Pelvis);
	if (bHaveHistory)
	{
		const FVector HeadVel = (HeadPos - LastHeadPos) / StepDt;
		const FVector HipVel = (HipPos - LastHipPos) / StepDt;
		const FVector HeadAcc = Actor.InverseTransformVectorNoScale((HeadVel - LastHeadVel) / StepDt).GetClampedToMaxSize(6000.0);
		const FVector HipAcc = Actor.InverseTransformVectorNoScale((HipVel - LastHipVel) / StepDt).GetClampedToMaxSize(6000.0);
		HairSpring.Step(StepDt, FVector2f(HeadAcc.X, HeadAcc.Y));
		TailSpring.Step(StepDt, FVector2f(HeadAcc.X, HeadAcc.Y));
		BellySpring.Step(StepDt, FVector2f(HipAcc.X + HipAcc.Z * 0.6f, HipAcc.Y));
		SkirtSpring.Step(StepDt, FVector2f(HipAcc.X, HipAcc.Y));
		LastHeadVel = HeadVel;
		LastHipVel = HipVel;
	}
	LastHeadPos = HeadPos;
	LastHipPos = HipPos;
	bHaveHistory = true;
}
