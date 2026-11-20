#pragma once

#include "CoreMinimal.h"

class UPoseableMeshComponent;

/** Bones every clay character shares (names in CpvPose.cpp match Art/cpv/charbase.py). */
enum class ECpvBone : uint8
{
	Root, Pelvis, Spine, Chest, Neck, Head,
	ClavL, ArmL, ForeL, HandL, FistL, OpenL,
	ClavR, ArmR, ForeR, HandR, FistR, OpenR,
	ThighL, ShinL, FootL, ThighR, ShinR, FootR,
	LidL, LidR, PupilL, PupilR, BrowL, BrowR,
	MouthClosed, MouthGrit, MouthOpen, MouthOuch, MouthGrin,
	Hair, Tail, Belly, Skirt,
	Count
};

/** Joints a pose can turn. Angles are anatomical and in degrees; see FCpvPose. */
enum class ECpvJoint : uint8
{
	Pelvis, Spine, Chest, Neck, Head,
	ArmL, ElbowL, WristL, ArmR, ElbowR, WristR,
	LegL, KneeL, AnkleL, LegR, KneeR, AnkleR,
	ClavL, ClavR,
	Count
};

enum class ECpvFace : uint8 { Neutral, Angry, Attack, Effort, Hurt, Dazed, Happy, Smug, Shock, KO };
enum class ECpvMouth : uint8 { Closed, Grit, Open, Ouch, Grin };
enum class ECpvEase : uint8 { Linear, In, Out, InOut, Snap, Over };

/**
 * One sculpted pose. Angle conventions (all degrees, the character faces +X, right is +Y):
 *   Pelvis/Spine/Chest/Neck/Head : X = bend forward, Y = turn right, Z = lean right
 *   Arm, Leg                     : X = swing forward, Y = lift out to the side, Z = twist inward
 *   Elbow                        : X = bend, Z = twist inward      Knee: X = bend
 *   Wrist                        : X = curl forward, Y = turn, Z = tilt     Ankle: X = toes up
 *   Clav                         : X = shrug up
 * Zero everywhere is standing straight with the arms hanging at the sides.
 */
struct FCpvPose
{
	FVector3f J[static_cast<int32>(ECpvJoint::Count)];
	FVector3f Root = FVector3f::ZeroVector; // pelvis offset in cm: X forward, Y right, Z up
	float Sink = 0.f;                       // 1 = pelvis lowered to the mat (plus Root.Z), for lying poses
	float Ground = 1.f;                     // 1 = slide the body vertically so the lower foot rests on the mat
	ECpvFace Face = ECpvFace::Angry;
	bool bFistL = true;
	bool bFistR = true;

	FCpvPose() { for (FVector3f& V : J) { V = FVector3f::ZeroVector; } }

	FVector3f& operator[](ECpvJoint Joint) { return J[static_cast<int32>(Joint)]; }
	const FVector3f& operator[](ECpvJoint Joint) const { return J[static_cast<int32>(Joint)]; }

	// --- sculpting helpers (chainable) ---
	FCpvPose& Pelvis(float Fwd, float Turn = 0.f, float Lean = 0.f) { (*this)[ECpvJoint::Pelvis] = FVector3f(Fwd, Turn, Lean); return *this; }
	FCpvPose& Spine(float Fwd, float Turn = 0.f, float Lean = 0.f) { (*this)[ECpvJoint::Spine] = FVector3f(Fwd, Turn, Lean); return *this; }
	FCpvPose& Chest(float Fwd, float Turn = 0.f, float Lean = 0.f) { (*this)[ECpvJoint::Chest] = FVector3f(Fwd, Turn, Lean); return *this; }
	FCpvPose& Neck(float Fwd, float Turn = 0.f, float Lean = 0.f) { (*this)[ECpvJoint::Neck] = FVector3f(Fwd, Turn, Lean); return *this; }
	FCpvPose& Head(float Fwd, float Turn = 0.f, float Lean = 0.f) { (*this)[ECpvJoint::Head] = FVector3f(Fwd, Turn, Lean); return *this; }
	FCpvPose& ArmL(float Fwd, float Out = 0.f, float Twist = 0.f) { (*this)[ECpvJoint::ArmL] = FVector3f(Fwd, Out, Twist); return *this; }
	FCpvPose& ArmR(float Fwd, float Out = 0.f, float Twist = 0.f) { (*this)[ECpvJoint::ArmR] = FVector3f(Fwd, Out, Twist); return *this; }
	FCpvPose& Arms(float Fwd, float Out = 0.f, float Twist = 0.f) { return ArmL(Fwd, Out, Twist).ArmR(Fwd, Out, Twist); }
	FCpvPose& ElbowL(float Bend, float Twist = 0.f) { (*this)[ECpvJoint::ElbowL] = FVector3f(Bend, 0.f, Twist); return *this; }
	FCpvPose& ElbowR(float Bend, float Twist = 0.f) { (*this)[ECpvJoint::ElbowR] = FVector3f(Bend, 0.f, Twist); return *this; }
	FCpvPose& Elbows(float Bend, float Twist = 0.f) { return ElbowL(Bend, Twist).ElbowR(Bend, Twist); }
	FCpvPose& WristL(float Curl, float Turn = 0.f, float Tilt = 0.f) { (*this)[ECpvJoint::WristL] = FVector3f(Curl, Turn, Tilt); return *this; }
	FCpvPose& WristR(float Curl, float Turn = 0.f, float Tilt = 0.f) { (*this)[ECpvJoint::WristR] = FVector3f(Curl, Turn, Tilt); return *this; }
	FCpvPose& LegL(float Fwd, float Out = 0.f, float Twist = 0.f) { (*this)[ECpvJoint::LegL] = FVector3f(Fwd, Out, Twist); return *this; }
	FCpvPose& LegR(float Fwd, float Out = 0.f, float Twist = 0.f) { (*this)[ECpvJoint::LegR] = FVector3f(Fwd, Out, Twist); return *this; }
	FCpvPose& Legs(float Fwd, float Out = 0.f, float Twist = 0.f) { return LegL(Fwd, Out, Twist).LegR(Fwd, Out, Twist); }
	FCpvPose& KneeL(float Bend) { (*this)[ECpvJoint::KneeL] = FVector3f(Bend, 0.f, 0.f); return *this; }
	FCpvPose& KneeR(float Bend) { (*this)[ECpvJoint::KneeR] = FVector3f(Bend, 0.f, 0.f); return *this; }
	FCpvPose& Knees(float Bend) { return KneeL(Bend).KneeR(Bend); }
	FCpvPose& AnkleL(float ToesUp) { (*this)[ECpvJoint::AnkleL] = FVector3f(ToesUp, 0.f, 0.f); return *this; }
	FCpvPose& AnkleR(float ToesUp) { (*this)[ECpvJoint::AnkleR] = FVector3f(ToesUp, 0.f, 0.f); return *this; }
	FCpvPose& Shrug(float Left, float Right) { (*this)[ECpvJoint::ClavL] = FVector3f(Left, 0.f, 0.f); (*this)[ECpvJoint::ClavR] = FVector3f(Right, 0.f, 0.f); return *this; }
	FCpvPose& At(float X, float Y, float Z) { Root = FVector3f(X, Y, Z); return *this; }
	/** Lying / airborne poses: place the pelvis `Height` cm above the mat and stop foot grounding. */
	FCpvPose& Floor(float Height, float X = 0.f, float Y = 0.f) { Sink = 1.f; Ground = 0.f; Root = FVector3f(X, Y, Height); return *this; }
	/** Airborne: pelvis `Up` cm above its standing height, no foot grounding. */
	FCpvPose& Air(float Up, float X = 0.f, float Y = 0.f) { Sink = 0.f; Ground = 0.f; Root = FVector3f(X, Y, Up); return *this; }
	FCpvPose& Expr(ECpvFace InFace) { Face = InFace; return *this; }
	FCpvPose& Hands(bool bLeftFist, bool bRightFist) { bFistL = bLeftFist; bFistR = bRightFist; return *this; }

	FCpvPose Mirrored() const;
	static FCpvPose Blend(const FCpvPose& A, const FCpvPose& B, float Alpha);
};

struct FCpvKey
{
	float Time = 0.f;
	FCpvPose Pose;
	ECpvEase Ease = ECpvEase::InOut; // how the pose is approached from the previous key
};

/** A pose-to-pose animation, like a dope sheet: a handful of sculpted keys with eases between them. */
struct FCpvClip
{
	TArray<FCpvKey> Keys;
	bool bLoop = false;
	float Length = 0.f;

	FCpvClip& Key(float Time, const FCpvPose& Pose, ECpvEase Ease = ECpvEase::InOut);
	FCpvClip& Loop() { bLoop = true; return *this; }
	FCpvClip Mirrored() const;
	FCpvPose Sample(float Time) const;
};

namespace CpvAnim
{
	/** Every clip in the game, by name. Built on first use. */
	const FCpvClip& Get(FName Name);
	bool Has(FName Name);
	void GetNames(TArray<FName>& OutNames);
}

/** Face, hands and secondary-motion inputs that are not part of a sculpted pose. */
struct FCpvRigExtras
{
	ECpvMouth Mouth = ECpvMouth::Closed;
	float LidClose = 0.f;        // 0 open .. 1 shut, negative = wide-eyed
	float BrowAngry = 0.f;       // +1 scowl .. -1 worried
	float BrowRaise = 0.f;       // cm
	FVector2f PupilL = FVector2f::ZeroVector; // cm: X toward the character's right, Y up
	FVector2f PupilR = FVector2f::ZeroVector;
	FVector2f Look = FVector2f::ZeroVector;   // extra head turn (yaw, pitch) in degrees
	FQuat Hair = FQuat::Identity;
	FQuat Tail = FQuat::Identity;
	FQuat Belly = FQuat::Identity;
	FQuat Skirt = FQuat::Identity;
	FVector2f HeadSquash = FVector2f(1.f, 1.f); // X = width, Y = height (for flattened and inflated heads)
	float Scale[static_cast<int32>(ECpvBone::Count)]; // per-bone scale multipliers (1 = normal, ~0 = hidden)

	FCpvRigExtras() { for (float& S : Scale) { S = 1.f; } }
};

/** Turns poses into bone transforms on a UPoseableMeshComponent, whatever the character's proportions. */
struct FCpvRig
{
	void Init(UPoseableMeshComponent* InMesh);
	void Apply(const FCpvPose& Pose, const FCpvRigExtras& Extras);
	bool IsValid() const { return Mesh != nullptr && Index[static_cast<int32>(ECpvBone::Pelvis)] != INDEX_NONE; }
	bool HasBone(ECpvBone Bone) const { return Index[static_cast<int32>(Bone)] != INDEX_NONE; }
	/** Component-space transform from the last Apply. */
	const FTransform& BoneCS(ECpvBone Bone) const { return CS[static_cast<int32>(Bone)]; }
	static FName BoneName(ECpvBone Bone);

	UPoseableMeshComponent* Mesh = nullptr;
	float PelvisHeight = 88.f;   // standing pelvis height
	float AnkleHeight = 9.f;
	float Height = 180.f;        // top of the head when standing
	float HeadHeight = 150.f;    // head pivot when standing

private:
	static constexpr int32 N = static_cast<int32>(ECpvBone::Count);
	int32 Index[N];
	FQuat RestRot[N];
	FVector RestOffset[N];
	FVector RestPos[N];
	FTransform CS[N];
};
