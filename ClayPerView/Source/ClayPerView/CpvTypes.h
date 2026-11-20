#pragma once

#include "CoreMinimal.h"

/** What a fighter is doing. */
enum class ECpvState : uint8
{
	Idle, Run, Dodge, Block, Attack, GrabTry, Clinch, Held, Throwing, Thrown, Whipped, Rebound,
	HitStun, Stagger, BlockStun, Airborne, Down, GetUp, Dazed, Taunt, Pickup, Special, Scripted, Dead, Win,
};

enum class ECpvReaction : uint8 { Light, Gut, Heavy, Knockdown, Launch };
enum class ECpvWord : uint8 { None, Pow, Bam, Wham, Splat, Crunch, Bonk, Oof, KO, Zap, Boom };

/** One strike: timings in seconds from the start of the clip. */
struct FCpvMove
{
	FName Clip;
	float HitTime = 0.1f;      // when it connects
	float Duration = 0.3f;     // total length before control returns
	float Chain = 0.f;         // if > 0, a buffered follow-up may start this early
	float Damage = 5.f;
	float Range = 110.f;       // reach from the attacker's centre
	float Arc = 55.f;          // half-angle of the swing in degrees
	float Lunge = 30.f;        // distance stepped forward before the hit
	ECpvReaction Reaction = ECpvReaction::Light;
	float Knockback = 120.f;   // cm/s shove
	float Lift = 0.f;          // launch speed upward
	float HitStop = 0.06f;
	ECpvWord Word = ECpvWord::None;
	bool bHitsStanding = true;
	bool bHitsDown = false;
	bool bUnblockable = false;
	FName Sound = "Punch";
};

enum class ECpvSpecial : uint8 { Bomb, Scream, Flame, Zap, Shockwave, Scepter, Chord, Orb };
enum class ECpvFinisher : uint8 { Explode, MicDrop, RollingPin, Rocket, Speaker, HeadPop, Encore, Shrink };
enum class ECpvWeapon : uint8 { None, Chair, Guitar, Trophy, Pan, Mallet, Chicken, Slate, Count };

struct FCpvWeaponDef
{
	const TCHAR* Name;
	const TCHAR* Mesh;
	float Damage;        // added to weapon strikes
	int32 Uses;
	ECpvWord Word;
	FName Sound;
	FVector GripOffset;  // where on the mesh the hand holds it (mesh space)
	float HypeBonus;
};

/** A member of the roster. Everyone is an invented showbiz archetype. */
struct FCpvFighterDef
{
	const TCHAR* Id;          // mesh name: SK_<Id>
	const TCHAR* Name;
	const TCHAR* Title;
	const TCHAR* Quote;
	int32 Power, Speed, Guts; // 1..5
	FLinearColor Colour;      // UI accent
	FLinearColor Clay;        // colour of the bits that fly off
	FLinearColor Clay2;
	FName Taunt;
	const TCHAR* SpecialName;
	ECpvSpecial Special;
	const TCHAR* FinisherName;
	ECpvFinisher Finisher;
	const TCHAR* VoiceId;     // for announcer clips: VO_Name_<VoiceId>
};

namespace CpvData
{
	const TArray<FCpvFighterDef>& Roster();
	const FCpvFighterDef& Fighter(int32 Index);
	const FCpvWeaponDef& Weapon(ECpvWeapon Type);

	// Standard strikes.
	extern const FCpvMove Jab, Cross, Uppercut, Haymaker, Boot, Clothesline, Dropkick, Stomp, Splash, WeaponSwing, WeaponSmash;
}

/** A frame of player or AI intent. Presses are true only on the frame they happen. */
struct FCpvInput
{
	FVector2D Move = FVector2D::ZeroVector; // world axes: X = screen right, Y = toward the camera
	bool bLight = false, bHeavy = false, bGrab = false, bSpecial = false, bTaunt = false, bDodge = false;
	bool bBlock = false, bRun = false;
	bool AnyPress() const { return bLight || bHeavy || bGrab || bSpecial || bTaunt || bDodge; }
};

namespace CpvRule
{
	const float MaxHealth = 100.f;
	const float MaxHype = 100.f;
	const float WalkSpeed = 215.f;
	const float RunSpeed = 470.f;
	const float BodyRadius = 31.f;
	const float GrabRange = 98.f;
	const float Gravity = 2300.f;
	const float DazedTime = 7.f;
}
