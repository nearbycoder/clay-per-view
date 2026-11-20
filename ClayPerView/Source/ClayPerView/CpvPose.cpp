#include "CpvPose.h"
#include "ClayPerView.h"

#include "Components/PoseableMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "ReferenceSkeleton.h"

namespace
{
	using B = ECpvBone;
	using JT = ECpvJoint;

	const TCHAR* GBoneNames[] = {
		TEXT("root"), TEXT("pelvis"), TEXT("spine"), TEXT("chest"), TEXT("neck"), TEXT("head"),
		TEXT("clavicle_l"), TEXT("upperarm_l"), TEXT("forearm_l"), TEXT("hand_l"), TEXT("fist_l"), TEXT("open_l"),
		TEXT("clavicle_r"), TEXT("upperarm_r"), TEXT("forearm_r"), TEXT("hand_r"), TEXT("fist_r"), TEXT("open_r"),
		TEXT("thigh_l"), TEXT("shin_l"), TEXT("foot_l"), TEXT("thigh_r"), TEXT("shin_r"), TEXT("foot_r"),
		TEXT("lid_l"), TEXT("lid_r"), TEXT("pupil_l"), TEXT("pupil_r"), TEXT("brow_l"), TEXT("brow_r"),
		TEXT("mouth_closed"), TEXT("mouth_grit"), TEXT("mouth_open"), TEXT("mouth_ouch"), TEXT("mouth_grin"),
		TEXT("hair"), TEXT("tail"), TEXT("belly"), TEXT("skirt"),
	};
	static_assert(UE_ARRAY_COUNT(GBoneNames) == static_cast<int32>(B::Count), "bone name table out of step");

	// Parent of each bone, in enum order (parents always come first).
	const B GParent[] = {
		B::Count, B::Root, B::Pelvis, B::Spine, B::Chest, B::Neck,
		B::Chest, B::ClavL, B::ArmL, B::ForeL, B::HandL, B::HandL,
		B::Chest, B::ClavR, B::ArmR, B::ForeR, B::HandR, B::HandR,
		B::Pelvis, B::ThighL, B::ShinL, B::Pelvis, B::ThighR, B::ShinR,
		B::Head, B::Head, B::Head, B::Head, B::Head, B::Head,
		B::Head, B::Head, B::Head, B::Head, B::Head,
		B::Head, B::Hair, B::Spine, B::Pelvis,
	};
	static_assert(UE_ARRAY_COUNT(GParent) == static_cast<int32>(B::Count), "bone parent table out of step");

	int32 I(B Bone) { return static_cast<int32>(Bone); }

	FQuat AxisDeg(const FVector& Axis, float Degrees) { return FQuat(Axis, FMath::DegreesToRadians(Degrees)); }

	const FVector AX(1.0, 0.0, 0.0), AY(0.0, 1.0, 0.0), AZ(0.0, 0.0, 1.0);

	/** Spine-type joint: X = bend forward, Y = turn right, Z = lean right. */
	FQuat QCentral(const FVector3f& A) { return AxisDeg(AZ, A.Y) * AxisDeg(AY, A.X) * AxisDeg(-AX, A.Z); }

	/** Arm or leg hanging straight down: X = swing forward, Y = lift outward, Z = twist inward. Side: +1 right, -1 left. */
	FQuat QLimb(const FVector3f& A, float Side) { return AxisDeg(-AY, A.X) * AxisDeg(AX * Side, A.Y) * AxisDeg(-AZ * Side, A.Z); }

	FQuat QElbow(const FVector3f& A, float Side) { return AxisDeg(-AY, A.X) * AxisDeg(-AZ * Side, A.Z); }
	FQuat QKnee(const FVector3f& A) { return AxisDeg(AY, A.X); }
	FQuat QWrist(const FVector3f& A, float Side) { return AxisDeg(-AY, A.X) * AxisDeg(AZ * Side, A.Y) * AxisDeg(AX * Side, A.Z); }
	FQuat QAnkle(const FVector3f& A) { return AxisDeg(-AY, A.X); }
	FQuat QClav(const FVector3f& A, float Side) { return AxisDeg(AX * Side, A.X); }

	float EaseAlpha(float T, ECpvEase Ease)
	{
		T = FMath::Clamp(T, 0.f, 1.f);
		switch (Ease)
		{
		case ECpvEase::Linear: return T;
		case ECpvEase::In: return T * T;
		case ECpvEase::Out: return 1.f - (1.f - T) * (1.f - T);
		case ECpvEase::Snap: return T >= 1.f ? 1.f : 0.f;
		case ECpvEase::Over: { const float S = 1.70158f; const float U = T - 1.f; return 1.f + U * U * ((S + 1.f) * U + S); }
		default: return T * T * (3.f - 2.f * T);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Poses and clips
// ---------------------------------------------------------------------------------------------

FCpvPose FCpvPose::Mirrored() const
{
	FCpvPose M = *this;
	auto Swap = [&](JT L, JT R) { M[L] = (*this)[R]; M[R] = (*this)[L]; };
	Swap(JT::ArmL, JT::ArmR); Swap(JT::ElbowL, JT::ElbowR); Swap(JT::WristL, JT::WristR);
	Swap(JT::LegL, JT::LegR); Swap(JT::KneeL, JT::KneeR); Swap(JT::AnkleL, JT::AnkleR); Swap(JT::ClavL, JT::ClavR);
	for (JT C : { JT::Pelvis, JT::Spine, JT::Chest, JT::Neck, JT::Head })
	{
		M[C].Y = -M[C].Y;
		M[C].Z = -M[C].Z;
	}
	M.Root.Y = -Root.Y;
	M.bFistL = bFistR;
	M.bFistR = bFistL;
	return M;
}

FCpvPose FCpvPose::Blend(const FCpvPose& A, const FCpvPose& Bp, float Alpha)
{
	if (Alpha <= 0.f) { return A; }
	if (Alpha >= 1.f) { return Bp; }
	FCpvPose R;
	for (int32 i = 0; i < static_cast<int32>(JT::Count); ++i)
	{
		R.J[i] = FMath::Lerp(A.J[i], Bp.J[i], Alpha);
	}
	R.Root = FMath::Lerp(A.Root, Bp.Root, Alpha);
	R.Sink = FMath::Lerp(A.Sink, Bp.Sink, Alpha);
	R.Ground = FMath::Lerp(A.Ground, Bp.Ground, Alpha);
	const FCpvPose& Near = Alpha < 0.5f ? A : Bp; // replacement parts switch at the halfway point
	R.Face = Near.Face;
	R.bFistL = Near.bFistL;
	R.bFistR = Near.bFistR;
	return R;
}

FCpvClip& FCpvClip::Key(float Time, const FCpvPose& Pose, ECpvEase Ease)
{
	FCpvKey K;
	K.Time = Time;
	K.Pose = Pose;
	K.Ease = Ease;
	Keys.Add(K);
	Length = FMath::Max(Length, Time);
	return *this;
}

FCpvClip FCpvClip::Mirrored() const
{
	FCpvClip M = *this;
	for (FCpvKey& K : M.Keys) { K.Pose = K.Pose.Mirrored(); }
	return M;
}

FCpvPose FCpvClip::Sample(float Time) const
{
	if (Keys.Num() == 0) { return FCpvPose(); }
	if (bLoop && Length > 0.f) { Time = FMath::Fmod(FMath::Max(Time, 0.f), Length); }
	if (Time <= Keys[0].Time) { return Keys[0].Pose; }
	for (int32 i = 1; i < Keys.Num(); ++i)
	{
		if (Time <= Keys[i].Time)
		{
			const float Span = Keys[i].Time - Keys[i - 1].Time;
			const float T = Span > KINDA_SMALL_NUMBER ? (Time - Keys[i - 1].Time) / Span : 1.f;
			return FCpvPose::Blend(Keys[i - 1].Pose, Keys[i].Pose, EaseAlpha(T, Keys[i].Ease));
		}
	}
	return Keys.Last().Pose;
}

// ---------------------------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------------------------

FName FCpvRig::BoneName(ECpvBone Bone)
{
	return FName(GBoneNames[static_cast<int32>(Bone)]);
}

void FCpvRig::Init(UPoseableMeshComponent* InMesh)
{
	Mesh = InMesh;
	for (int32 i = 0; i < N; ++i)
	{
		Index[i] = INDEX_NONE;
		RestRot[i] = FQuat::Identity;
		RestOffset[i] = FVector::ZeroVector;
		RestPos[i] = FVector::ZeroVector;
		CS[i] = FTransform::Identity;
	}
	const USkinnedAsset* Asset = Mesh ? Mesh->GetSkinnedAsset() : nullptr;
	if (!Asset)
	{
		Mesh = nullptr;
		return;
	}
	const FReferenceSkeleton& Ref = Asset->GetRefSkeleton();
	TArray<FTransform> RefCS;
	RefCS.SetNum(Ref.GetNum());
	for (int32 i = 0; i < Ref.GetNum(); ++i)
	{
		const int32 P = Ref.GetParentIndex(i);
		RefCS[i] = P >= 0 ? Ref.GetRefBonePose()[i] * RefCS[P] : Ref.GetRefBonePose()[i];
	}
	FQuat RefRot[N];
	for (int32 i = 0; i < N; ++i)
	{
		Index[i] = Ref.FindBoneIndex(FName(GBoneNames[i]));
		if (Index[i] != INDEX_NONE)
		{
			RestPos[i] = RefCS[Index[i]].GetLocation();
			RefRot[i] = RefCS[Index[i]].GetRotation();
		}
		else
		{
			RefRot[i] = FQuat::Identity;
		}
	}

	// The bind pose has the arms out at an angle and the legs very slightly splayed. Poses are authored
	// against a rest skeleton whose limbs hang straight down, so each limb chain gets a fixed correction.
	FQuat Fix[N];
	for (FQuat& Q : Fix) { Q = FQuat::Identity; }
	auto FixChain = [&](B Upper, B Lower, std::initializer_list<B> Chain)
	{
		if (Index[I(Upper)] == INDEX_NONE || Index[I(Lower)] == INDEX_NONE) { return; }
		const FVector Dir = (RestPos[I(Lower)] - RestPos[I(Upper)]).GetSafeNormal();
		const FQuat Q = FQuat::FindBetweenNormals(Dir, FVector(0.0, 0.0, -1.0));
		for (B Bone : Chain) { Fix[I(Bone)] = Q; }
	};
	FixChain(B::ArmL, B::ForeL, { B::ArmL, B::ForeL, B::HandL, B::FistL, B::OpenL });
	FixChain(B::ArmR, B::ForeR, { B::ArmR, B::ForeR, B::HandR, B::FistR, B::OpenR });
	FixChain(B::ThighL, B::ShinL, { B::ThighL, B::ShinL });
	FixChain(B::ThighR, B::ShinR, { B::ThighR, B::ShinR });

	for (int32 i = 0; i < N; ++i)
	{
		RestRot[i] = Fix[i] * RefRot[i];
		const B Parent = GParent[i];
		if (Parent != B::Count && Index[i] != INDEX_NONE)
		{
			RestOffset[i] = Fix[I(Parent)].RotateVector(RestPos[i] - RestPos[I(Parent)]);
		}
	}
	PelvisHeight = RestPos[I(B::Pelvis)].Z;
	AnkleHeight = RestPos[I(B::FootL)].Z;
	HeadHeight = RestPos[I(B::Head)].Z;
	Height = Asset->GetBounds().Origin.Z + Asset->GetBounds().BoxExtent.Z;
	Mesh->BoundsScale = 2.5f;
}

void FCpvRig::Apply(const FCpvPose& Pose, const FCpvRigExtras& Extras)
{
	if (!IsValid()) { return; }

	// Accumulated (component-space) authored rotation and position of every bone.
	FQuat Acc[N];
	FVector Pos[N];
	FQuat Local[N];
	for (FQuat& Q : Local) { Q = FQuat::Identity; }

	Local[I(B::Pelvis)] = QCentral(Pose[JT::Pelvis]);
	Local[I(B::Spine)] = QCentral(Pose[JT::Spine]);
	Local[I(B::Chest)] = QCentral(Pose[JT::Chest]);
	Local[I(B::Neck)] = QCentral(Pose[JT::Neck]);
	Local[I(B::Head)] = QCentral(Pose[JT::Head] + FVector3f(Extras.Look.Y, Extras.Look.X, 0.f));
	Local[I(B::ClavL)] = QClav(Pose[JT::ClavL], -1.f);
	Local[I(B::ClavR)] = QClav(Pose[JT::ClavR], 1.f);
	Local[I(B::ArmL)] = QLimb(Pose[JT::ArmL], -1.f);
	Local[I(B::ArmR)] = QLimb(Pose[JT::ArmR], 1.f);
	Local[I(B::ForeL)] = QElbow(Pose[JT::ElbowL], -1.f);
	Local[I(B::ForeR)] = QElbow(Pose[JT::ElbowR], 1.f);
	Local[I(B::HandL)] = QWrist(Pose[JT::WristL], -1.f);
	Local[I(B::HandR)] = QWrist(Pose[JT::WristR], 1.f);
	Local[I(B::ThighL)] = QLimb(Pose[JT::LegL], -1.f);
	Local[I(B::ThighR)] = QLimb(Pose[JT::LegR], 1.f);
	Local[I(B::ShinL)] = QKnee(Pose[JT::KneeL]);
	Local[I(B::ShinR)] = QKnee(Pose[JT::KneeR]);
	Local[I(B::FootL)] = QAnkle(Pose[JT::AnkleL]);
	Local[I(B::FootR)] = QAnkle(Pose[JT::AnkleR]);
	Local[I(B::Hair)] = Extras.Hair;
	Local[I(B::Tail)] = Extras.Tail;
	Local[I(B::Belly)] = Extras.Belly;
	Local[I(B::Skirt)] = Extras.Skirt;
	// Eyelids swing down over the eye; brows tilt about the forward axis.
	const float Lid = Extras.LidClose >= 0.f ? Extras.LidClose * 68.f : Extras.LidClose * 26.f;
	Local[I(B::LidL)] = AxisDeg(AY, Lid);
	Local[I(B::LidR)] = AxisDeg(AY, Lid);
	Local[I(B::BrowL)] = AxisDeg(-AX, Extras.BrowAngry * 24.f);
	Local[I(B::BrowR)] = AxisDeg(AX, Extras.BrowAngry * 24.f);

	Acc[I(B::Root)] = FQuat::Identity;
	Pos[I(B::Root)] = FVector::ZeroVector;
	for (int32 i = 1; i < N; ++i)
	{
		const int32 P = I(GParent[i]);
		Acc[i] = Acc[P] * Local[i];
		Pos[i] = Pos[P] + Acc[P].RotateVector(RestOffset[i]);
		if (i == I(B::Pelvis))
		{
			Pos[i] = FVector(Pose.Root.X, Pose.Root.Y, RestPos[i].Z * (1.f - Pose.Sink) + Pose.Root.Z);
		}
	}

	// Face parts slide a little in the head's frame.
	const FQuat HeadQ = Acc[I(B::Head)];
	Pos[I(B::BrowL)] += HeadQ.RotateVector(FVector(0.0, 0.0, Extras.BrowRaise));
	Pos[I(B::BrowR)] += HeadQ.RotateVector(FVector(0.0, 0.0, Extras.BrowRaise));
	Pos[I(B::PupilL)] += HeadQ.RotateVector(FVector(0.0, Extras.PupilL.X, Extras.PupilL.Y));
	Pos[I(B::PupilR)] += HeadQ.RotateVector(FVector(0.0, Extras.PupilR.X, Extras.PupilR.Y));

	// Keep the lower foot on the mat and flatten feet that are close to it.
	if (Pose.Ground > 0.f)
	{
		const float Lowest = FMath::Min(Pos[I(B::FootL)].Z, Pos[I(B::FootR)].Z);
		const float Shift = (AnkleHeight - Lowest) * Pose.Ground;
		for (int32 i = 1; i < N; ++i) { Pos[i].Z += Shift; }
		for (B Foot : { B::FootL, B::FootR })
		{
			const float Above = Pos[I(Foot)].Z - AnkleHeight;
			const float Flat = Pose.Ground * (1.f - FMath::Clamp(Above / 14.f, 0.f, 1.f));
			if (Flat > 0.f)
			{
				const FRotator R = Acc[I(Foot)].Rotator();
				Acc[I(Foot)] = FQuat::Slerp(Acc[I(Foot)], FRotator(0.f, R.Yaw, 0.f).Quaternion(), Flat);
			}
		}
	}

	// Replacement parts: one mouth and one hand shape per side are shown, the rest shrink to nothing.
	float Scale[N];
	for (int32 i = 0; i < N; ++i) { Scale[i] = Extras.Scale[i]; }
	const float Tiny = 0.001f;
	const B Mouths[] = { B::MouthClosed, B::MouthGrit, B::MouthOpen, B::MouthOuch, B::MouthGrin };
	for (int32 m = 0; m < 5; ++m)
	{
		if (m != static_cast<int32>(Extras.Mouth)) { Scale[I(Mouths[m])] = Tiny; }
	}
	Scale[I(Pose.bFistL ? B::OpenL : B::FistL)] = Tiny;
	Scale[I(Pose.bFistR ? B::OpenR : B::FistR)] = Tiny;

	for (int32 i = 0; i < N; ++i)
	{
		FVector S(Scale[i]);
		if (i == I(B::Head)) { S = FVector(Extras.HeadSquash.X, Extras.HeadSquash.Y, Extras.HeadSquash.X) * Scale[i]; } // bone-local Y runs up the head
		if (i == I(B::PupilL) || i == I(B::PupilR))
		{
			S.Z *= FMath::Lerp(1.f, 0.14f, FMath::Clamp(Extras.LidClose, 0.f, 1.f)); // shut eyes squash the pupils (LED faces rely on this)
		}
		CS[i] = FTransform(Acc[i] * RestRot[i], Pos[i], S);
	}
	// Face parts and hair ride along when the head is squashed or stretched.
	const FVector HeadAxes(Extras.HeadSquash.X, Extras.HeadSquash.X, Extras.HeadSquash.Y);
	for (int32 i = I(B::LidL); i <= I(B::Tail); ++i)
	{
		const FVector Rel = HeadQ.UnrotateVector(Pos[i] - Pos[I(B::Head)]) * HeadAxes;
		CS[i].SetLocation(Pos[I(B::Head)] + HeadQ.RotateVector(Rel));
	}

	TArray<FTransform>& Out = Mesh->BoneSpaceTransforms;
	for (int32 i = 0; i < N; ++i)
	{
		if (Index[i] == INDEX_NONE || !Out.IsValidIndex(Index[i])) { continue; }
		const B Parent = GParent[i];
		Out[Index[i]] = Parent == B::Count ? CS[i] : CS[i].GetRelativeTransform(CS[I(Parent)]);
	}
	Mesh->RefreshBoneTransforms();
}
