#pragma once

#include "CoreMinimal.h"
#include "CpvPuppet.h"
#include "CpvTypes.h"
#include "CpvFighter.generated.h"

class ACpvGameMode;
class UStaticMeshComponent;

enum class ECpvThrow : uint8 { None, Headbutt, Slam, Whip, Shove };

/** A playable (or AI-driven) brawler. The game mode steps fighters in a fixed order each frame. */
UCLASS()
class ACpvFighter : public ACpvPuppet
{
	GENERATED_BODY()
public:
	ACpvFighter();

	void Setup(int32 InSlot, int32 InRosterIndex, ACpvGameMode* InGame);
	void ResetForRound(const FVector& Start, float Yaw);
	void Step(float Dt, const FCpvInput& In);

	// --- being hit ---
	/** Returns true if the blow landed (false if blocked or dodged). */
	bool TakeHit(ACpvFighter* From, const FCpvMove& Move, float DamageScale);
	/** Damage with a chosen reaction, for specials, throws and hazards. */
	void TakeBlow(ACpvFighter* From, float Damage, ECpvReaction Reaction, const FVector2D& Push, float Lift, ECpvWord Word, FName Sound, float HitStop = 0.1f);
	bool IsHittable() const;
	bool CanBeGrabbed() const;

	// --- scripted control (intros, finishers, victory) ---
	void SetScripted(bool bOn);
	void EnterState(ECpvState NewState);
	void Kill(bool bFlat);
	void Celebrate();
	void RecoverFromCover(bool bShouldersUp);

	// --- weapons ---
	void GiveWeapon(ECpvWeapon Type, int32 Uses);
	void DropWeapon(bool bBreak);
	/** Show a prop in the weapon hand without it being a usable weapon (signature moves, finishers). Null hides it. */
	void SetHandProp(const TCHAR* MeshPath, const FVector& Grip = FVector(0.0, 0.0, 20.0), const FRotator& Turn = FRotator(-90.f, 0.f, 0.f));
	void UpdateMirror();

	// --- queries ---
	ECpvState GetState() const { return State; }
	float GetStateTime() const { return StateTime; }
	bool IsDown() const { return State == ECpvState::Down || State == ECpvState::Dead; }
	bool IsStanding() const;
	bool IsAttacking() const { return State == ECpvState::Attack || State == ECpvState::GrabTry || State == ECpvState::Special; }
	/** Swung and now recovering: the moment to hit back. */
	bool IsRecovering() const { return State == ECpvState::Attack && bStrikeDone && Move != nullptr; }
	float RecoveryLeft() const { return IsRecovering() ? FMath::Max(0.f, Move->Duration + BlockedPenalty - StateTime) : 0.f; }
	bool IsBusy() const { return State != ECpvState::Idle && State != ECpvState::Run && State != ECpvState::Block; }
	bool HasFullHype() const { return Hype >= CpvRule::MaxHype - 0.01f; }
	FVector2D Pos2D() const { return FVector2D(GetActorLocation().X, GetActorLocation().Y); }
	FVector2D Facing2D() const;
	float DistanceTo(const ACpvFighter* Other) const { return (Pos2D() - Other->Pos2D()).Size(); }
	const FCpvFighterDef& Def() const { return CpvData::Fighter(RosterIndex); }
	void AddHype(float Amount);
	void SetFoe(ACpvFighter* InFoe) { Foe = InFoe; }
	ACpvFighter* GetFoe() const { return Foe; }

	int32 Slot = 0;
	int32 RosterIndex = 0;
	float Health = CpvRule::MaxHealth;
	float ShownHealth = CpvRule::MaxHealth;   // trails Health for the HUD's damage flash
	float Hype = 0.f;
	float Height = 0.f;
	ECpvWeapon Weapon = ECpvWeapon::None;
	int32 WeaponUses = 0;
	bool bArmor = false;
	bool bDazeOnKo = false;        // deciding round: stagger about waiting for a finisher instead of dropping
	const FCpvMove* Move = nullptr;

	// stats for the results screen
	int32 Combo = 0;
	int32 BestCombo = 0;
	float DamageDealt = 0.f;
	int32 HitsLanded = 0;
	int32 Taunts = 0;

private:
	void Buffer(const FCpvInput& In, float Dt);
	bool Consume(float& Timer);
	void FaceToward(const FVector2D& Target, float Dt, float RateDegPerSec);
	void MoveBy(const FVector2D& Delta);
	void ApplyReaction(ECpvReaction Reaction, const FVector2D& Push, float Lift);
	void StartMove(const FCpvMove& InMove);
	void StartLight();
	void StartHeavy(const FCpvInput& In);
	void StartGrab();
	void StartDodge(const FVector2D& Dir);
	bool StartSpecial();
	void StartClinch(ACpvFighter* Victim);
	void StartThrow(ECpvThrow Kind, const FVector2D& Dir);
	void DoStrike(const FCpvMove& InMove);
	void TickSpecial(float Dt);
	void TickThrow(float Dt);
	void TickAir(float Dt);
	void BeginWhipped(const FVector2D& Dir);
	void ReleaseFromThrow(ECpvState NewState, const FVector2D& Push);
	void UpdateWeaponAttachment();
	void HitRopes(float Impulse);
	float SpeedMul() const { return 0.88f + 0.06f * Def().Speed; }
	float PowerMul() const { return 0.82f + 0.07f * Def().Power; }
	float GutsMul() const { return 1.18f - 0.07f * Def().Guts; }
	float RingLimit() const;

	UPROPERTY()
	TObjectPtr<UStaticMeshComponent> WeaponComp;
	UPROPERTY()
	TObjectPtr<ACpvFighter> Foe;
	UPROPERTY()
	TObjectPtr<ACpvGameMode> Game;
	UPROPERTY()
	TObjectPtr<ACpvFighter> Partner;   // the other half of a clinch or throw

	ECpvState State = ECpvState::Idle;
	float StateTime = 0.f;
	FVector2D Vel = FVector2D::ZeroVector;      // knockback / slide velocity
	float VertVel = 0.f;
	bool bBounced = false;
	float InvulnLeft = 0.f;
	float StunLeft = 0.f;
	float DownLeft = 0.f;
	int32 GroundHits = 0;       // blows taken while lying on the mat this knockdown
	float GuardWindow = 0.f;
	bool bGuardHeld = false;
	float BlockedPenalty = 0.f; // extra recovery after a strike bounces off a guard (and no combo follow-up)
	bool bFaceDown = false;
	bool bStrikeDone = false;
	bool bMoveConnected = false;
	int32 ComboStep = 0;
	float ComboClock = 0.f;
	float RunBonus = 0.f;                        // > 0 just after bouncing off the ropes
	FVector2D TravelDir = FVector2D(1.0, 0.0);   // dodge / whip / rebound direction
	ECpvThrow Throw = ECpvThrow::None;
	int32 ThrowStage = 0;
	int32 SpecialStage = 0;
	float SpecialClock = 0.f;
	int32 Escape = 0;
	int32 Juggle = 0;            // hits taken in the current beating
	float JuggleClock = 0.f;
	bool bKoHandled = false;
	bool bWeaponOnLeft = false;
	FVector PropGrip = FVector(0.0, 0.0, 20.0);
	FRotator PropTurn = FRotator(-90.f, 0.f, 0.f);
	float BufLight = 0.f, BufHeavy = 0.f, BufGrab = 0.f, BufSpecial = 0.f, BufTaunt = 0.f, BufDodge = 0.f;
};
