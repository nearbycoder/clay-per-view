#include "CpvFighter.h"
#include "ClayPerView.h"
#include "CpvArena.h"
#include "CpvFx.h"
#include "CpvGame.h"

#include "Components/PoseableMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"

namespace
{
	// Throwing whatever is in your hand. Handled as a strike whose "hit" launches a projectile.
	FCpvMove MakeThrowMove()
	{
		FCpvMove M;
		M.Clip = "Throw"; M.HitTime = 0.32f; M.Duration = 0.78f; M.Damage = 0.f; M.Range = 0.f; M.Lunge = 0.f; M.Sound = "Whoosh";
		return M;
	}
	const FCpvMove GThrowMove = MakeThrowMove();

	float YawOf(const FVector2D& Dir) { return FMath::RadiansToDegrees(FMath::Atan2(Dir.Y, Dir.X)); }
}

ACpvFighter::ACpvFighter()
{
	WeaponComp = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Weapon"));
	WeaponComp->SetupAttachment(RootComponent);
	WeaponComp->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	WeaponComp->SetVisibility(false);
}

void ACpvFighter::Setup(int32 InSlot, int32 InRosterIndex, ACpvGameMode* InGame)
{
	Slot = InSlot;
	RosterIndex = InRosterIndex;
	Game = InGame;
	SetCharacter(Def().Id);
	Hype = 0.f;
	Combo = BestCombo = HitsLanded = Taunts = 0;
	DamageDealt = 0.f;
}

void ACpvFighter::ResetForRound(const FVector& Start, float Yaw)
{
	SetActorLocationAndRotation(Start, FRotator(0.f, Yaw, 0.f));
	Health = ShownHealth = CpvRule::MaxHealth;
	Height = VertVel = 0.f;
	Vel = FVector2D::ZeroVector;
	VisualOffset = FVector::ZeroVector;
	VisualScale = FVector(1.0);
	VisualYaw = 0.f;
	HeadSquash = FVector2f(1.f, 1.f);
	for (float& S : BoneScale) { S = 1.f; }
	bHidden = false;
	Partner = nullptr;
	Move = nullptr;
	bArmor = bKoHandled = bStrikeDone = bBounced = false;
	InvulnLeft = StunLeft = DownLeft = RunBonus = JuggleClock = 0.f;
	Juggle = 0;
	GuardWindow = 0.f;
	bGuardHeld = false;
	BufLight = BufHeavy = BufGrab = BufSpecial = BufTaunt = BufDodge = 0.f;
	Combo = 0;
	Weapon = ECpvWeapon::None;
	WeaponComp->SetVisibility(false);
	State = ECpvState::Idle;
	StateTime = 0.f;
	UpdateMirror();
	MirrorAlpha = bMirror ? 1.f : 0.f;
	Play(TEXT("Idle"), 0.f);
	ForceStep();
}

FVector2D ACpvFighter::Facing2D() const
{
	const float Yaw = FMath::DegreesToRadians(GetActorRotation().Yaw);
	return FVector2D(FMath::Cos(Yaw), FMath::Sin(Yaw));
}

float ACpvFighter::RingLimit() const
{
	return Game && Game->GetArena() ? Game->GetArena()->RingLimit() : 236.f;
}

bool ACpvFighter::IsStanding() const
{
	switch (State)
	{
	case ECpvState::Down: case ECpvState::Dead: case ECpvState::Airborne: case ECpvState::GetUp: case ECpvState::Thrown: return false;
	default: return true;
	}
}

bool ACpvFighter::IsHittable() const
{
	return State != ECpvState::Dead && State != ECpvState::Scripted && State != ECpvState::Win && State != ECpvState::Thrown
		&& State != ECpvState::Held && InvulnLeft <= 0.f;
}

bool ACpvFighter::CanBeGrabbed() const
{
	if (InvulnLeft > 0.f || Height > 1.f) { return false; }
	switch (State)
	{
	case ECpvState::Idle: case ECpvState::Run: case ECpvState::Block: case ECpvState::BlockStun: case ECpvState::HitStun: case ECpvState::Stagger:
	case ECpvState::Attack: case ECpvState::GrabTry: case ECpvState::Taunt: case ECpvState::Pickup: case ECpvState::Whipped: case ECpvState::Rebound:
		return true;
	default: return false;
	}
}

void ACpvFighter::AddHype(float Amount)
{
	const bool bWasFull = HasFullHype();
	Hype = FMath::Clamp(Hype + Amount, 0.f, CpvRule::MaxHype);
	if (!bWasFull && HasFullHype() && Game) { Game->OnHypeFull(this); }
}

void ACpvFighter::SetScripted(bool bOn)
{
	if (bOn)
	{
		Partner = nullptr;
		Move = nullptr;
		Vel = FVector2D::ZeroVector;
		Height = 0.f;
		bArmor = false;
		State = ECpvState::Scripted;
		StateTime = 0.f;
	}
	else if (State == ECpvState::Scripted)
	{
		EnterState(ECpvState::Idle);
	}
}

void ACpvFighter::EnterState(ECpvState NewState)
{
	UE_LOG(LogCpv, Verbose, TEXT("state %s slot=%d %d->%d"), Def().Id, Slot, static_cast<int32>(State), static_cast<int32>(NewState));
	State = NewState;
	StateTime = 0.f;
	bStrikeDone = false;
	BlockedPenalty = 0.f;
	if (NewState == ECpvState::Down) { GroundHits = 0; }
	if (NewState == ECpvState::Idle)
	{
		Move = nullptr;
		bArmor = false;
		Throw = ECpvThrow::None;
		ComboStep = 0;
		if (WeaponComp->IsVisible() && Weapon == ECpvWeapon::None) { WeaponComp->SetVisibility(false); } // signature props
	}
}

void ACpvFighter::Kill(bool bFlat)
{
	if (State == ECpvState::Dead) { return; }
	DropWeapon(false);
	if (!bFlat && IsStanding()) { Play(TEXT("Collapse"), 0.08f); }
	State = ECpvState::Dead;
	StateTime = 0.f;
	Vel = FVector2D::ZeroVector;
	Health = 0.f;
}

void ACpvFighter::RecoverFromCover(bool bShouldersUp)
{
	Vel = FVector2D::ZeroVector;
	BufLight = BufHeavy = BufGrab = BufSpecial = BufTaunt = BufDodge = 0.f;
	if (bShouldersUp)
	{
		EnterState(ECpvState::GetUp);
		InvulnLeft = 0.75f;
		Play(TEXT("GetUp"), 0.12f);
	}
	else
	{
		EnterState(ECpvState::Stagger);
		StunLeft = 0.46f;
		Play(TEXT("Stagger"), 0.12f);
	}
}

void ACpvFighter::Celebrate()
{
	DropWeapon(false);
	Partner = nullptr;
	State = ECpvState::Win;
	StateTime = 0.f;
	Vel = FVector2D::ZeroVector;
	Play(TEXT("Victory"), 0.25f);
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

void ACpvFighter::Buffer(const FCpvInput& In, float Dt)
{
	const float Keep = 0.2f;
	auto Track = [&](float& Timer, bool bPressed) { Timer = bPressed ? Keep : FMath::Max(0.f, Timer - Dt); };
	Track(BufLight, In.bLight);
	Track(BufHeavy, In.bHeavy);
	Track(BufGrab, In.bGrab);
	Track(BufSpecial, In.bSpecial);
	Track(BufTaunt, In.bTaunt);
	Track(BufDodge, In.bDodge);
}

bool ACpvFighter::Consume(float& Timer)
{
	if (Timer > 0.f)
	{
		Timer = 0.f;
		return true;
	}
	return false;
}

void ACpvFighter::FaceToward(const FVector2D& Target, float Dt, float Rate)
{
	const FVector2D To = Target - Pos2D();
	if (To.SizeSquared() < 1.0) { return; }
	const float Want = YawOf(To);
	const float Now = GetActorRotation().Yaw;
	const float Delta = FMath::FindDeltaAngleDegrees(Now, Want);
	const float StepYaw = FMath::Clamp(Delta, -Rate * Dt, Rate * Dt);
	SetActorRotation(FRotator(0.f, Now + StepYaw, 0.f));
}

/** Moves within the ropes. Returns the ring side that was hit (0..3), or -1. */
static int32 ClampToRing(FVector2D& P, float Limit)
{
	int32 Side = -1;
	if (P.X > Limit) { P.X = Limit; Side = 0; }
	else if (P.X < -Limit) { P.X = -Limit; Side = 1; }
	if (P.Y > Limit) { P.Y = Limit; Side = 2; }
	else if (P.Y < -Limit) { P.Y = -Limit; Side = 3; }
	return Side;
}

void ACpvFighter::MoveBy(const FVector2D& Delta)
{
	FVector2D P = Pos2D() + Delta;
	ClampToRing(P, RingLimit());
	SetActorLocation(FVector(P.X, P.Y, 0.0));
}

void ACpvFighter::HitRopes(float Impulse)
{
	if (Game && Game->GetArena())
	{
		Game->GetArena()->BumpRopesAt(GetActorLocation(), Impulse);
		Game->PlaySound("Ropes", FMath::Clamp(Impulse / 500.f, 0.3f, 1.f));
	}
}

void ACpvFighter::UpdateMirror()
{
	const float X = Facing2D().X;
	const bool bWant = X < -0.2f ? true : (X > 0.2f ? false : bMirror);
	if (bWant != bMirror)
	{
		bMirror = bWant;
		UpdateWeaponAttachment();
	}
}

void ACpvFighter::UpdateWeaponAttachment()
{
	if (!WeaponComp->IsVisible()) { return; }
	// Bone space: X = thumb side, Y = down the arm. By default the prop's +Z (business end) lies along the thumb.
	const FQuat R = (Weapon != ECpvWeapon::None ? FRotator(-90.f, 0.f, 0.f) : PropTurn).Quaternion();
	const FVector Grip = Weapon != ECpvWeapon::None ? CpvData::Weapon(Weapon).GripOffset : PropGrip;
	const FVector Loc = FVector(0.0, 7.0, 0.0) - R.RotateVector(Grip);
	AttachProp(WeaponComp, bMirror ? ECpvBone::HandL : ECpvBone::HandR, FTransform(R, Loc));
	bWeaponOnLeft = bMirror;
}

void ACpvFighter::GiveWeapon(ECpvWeapon Type, int32 Uses)
{
	if (Type == ECpvWeapon::None) { return; }
	Weapon = Type;
	WeaponUses = Uses;
	WeaponComp->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, CpvData::Weapon(Type).Mesh));
	WeaponComp->SetVisibility(true);
	UpdateWeaponAttachment();
}

void ACpvFighter::SetHandProp(const TCHAR* MeshPath, const FVector& Grip, const FRotator& Turn)
{
	Weapon = ECpvWeapon::None;
	if (!MeshPath)
	{
		WeaponComp->SetVisibility(false);
		return;
	}
	PropGrip = Grip;
	PropTurn = Turn;
	WeaponComp->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, MeshPath));
	WeaponComp->SetVisibility(true);
	UpdateWeaponAttachment();
}

void ACpvFighter::DropWeapon(bool bBreak)
{
	if (Weapon == ECpvWeapon::None) { return; }
	const FVector At = GetBoneLocation(bWeaponOnLeft ? ECpvBone::HandL : ECpvBone::HandR);
	if (Game)
	{
		if (bBreak) { Game->BreakWeapon(Weapon, At); }
		else { Game->DropWeaponAt(Weapon, WeaponUses, At, Facing2D() * -120.0 + FVector2D(FMath::FRandRange(-80.f, 80.f), FMath::FRandRange(-80.f, 80.f))); }
	}
	Weapon = ECpvWeapon::None;
	WeaponComp->SetVisibility(false);
}

// ---------------------------------------------------------------------------------------------
// Starting things
// ---------------------------------------------------------------------------------------------

void ACpvFighter::StartMove(const FCpvMove& InMove)
{
	Move = &InMove;
	bMoveConnected = false;
	EnterState(ECpvState::Attack);
	Play(InMove.Clip, 0.05f);
	if (Game) { Game->PlaySound("Whoosh", 0.5f, FMath::FRandRange(0.9f, 1.15f)); }
}

void ACpvFighter::StartLight()
{
	const bool bFoeDown = Foe && Foe->State == ECpvState::Down && DistanceTo(Foe) < 165.f;
	if (bFoeDown) { StartMove(CpvData::Stomp); }
	else if (Weapon != ECpvWeapon::None) { StartMove(CpvData::WeaponSwing); }
	else
	{
		ComboStep = 1;
		StartMove(CpvData::Jab);
	}
}

void ACpvFighter::StartHeavy(const FCpvInput& In)
{
	const bool bFoeDown = Foe && Foe->State == ECpvState::Down && DistanceTo(Foe) < 190.f;
	if (bFoeDown) { StartMove(CpvData::Splash); return; }
	if (Weapon != ECpvWeapon::None) { StartMove(CpvData::WeaponSmash); return; }
	const FVector2D ToFoe = Foe ? (Foe->Pos2D() - Pos2D()).GetSafeNormal() : Facing2D();
	const bool bForward = In.Move.SizeSquared() > 0.2 && FVector2D::DotProduct(In.Move.GetSafeNormal(), ToFoe) > 0.5;
	StartMove(bForward ? CpvData::Boot : CpvData::Haymaker);
}

void ACpvFighter::StartGrab()
{
	if (Weapon != ECpvWeapon::None)
	{
		StartMove(GThrowMove);
		return;
	}
	if (Game && Game->TryCover(this)) { return; }
	const float Dist = Foe ? DistanceTo(Foe) : 1000.f;
	if (Game && Game->WeaponNear(this, 125.f) && (Dist > 135.f || (Foe && !Foe->IsStanding())))
	{
		EnterState(ECpvState::Pickup);
		Play(TEXT("Pickup"), 0.06f);
		return;
	}
	EnterState(ECpvState::GrabTry);
	Play(TEXT("GrabTry"), 0.06f);
}

void ACpvFighter::StartDodge(const FVector2D& Dir)
{
	TravelDir = Dir.GetSafeNormal();
	if (TravelDir.IsNearlyZero()) { TravelDir = -Facing2D(); }
	EnterState(ECpvState::Dodge);
	InvulnLeft = 0.27f;
	const bool bForward = FVector2D::DotProduct(TravelDir, Facing2D()) > 0.6;
	Play(bForward ? TEXT("Roll") : TEXT("Dodge"), 0.04f, bForward ? 1.4f : 1.f);
	if (Game) { Game->PlaySound("Whoosh", 0.4f, 1.3f); }
}

bool ACpvFighter::StartSpecial()
{
	if (!Foe || !Game) { return false; }
	if (Game->TryStartFinisher(this)) { return true; }
	if (!HasFullHype()) { return false; }
	Hype = 0.f;
	EnterState(ECpvState::Special);
	SpecialStage = 0;
	SpecialClock = 0.f;
	bArmor = true;
	SetActorRotation(FRotator(0.f, YawOf(Foe->Pos2D() - Pos2D()), 0.f));
	switch (Def().Special)
	{
	case ECpvSpecial::Bomb: case ECpvSpecial::Orb: Play(TEXT("Throw"), 0.08f, 0.85f); break;
	case ECpvSpecial::Scream: case ECpvSpecial::Flame: Play(TEXT("SpecScream"), 0.08f); break;
	case ECpvSpecial::Zap: Play(TEXT("SpecZap"), 0.08f); break;
	case ECpvSpecial::Chord: Play(TEXT("SpecStrum"), 0.08f); break;
	case ECpvSpecial::Shockwave: Play(TEXT("SpecSlam"), 0.08f); break;
	case ECpvSpecial::Scepter:
		DropWeapon(false);
		SetHandProp(TEXT("/Game/CPV/Props/SM_Scepter.SM_Scepter"), FVector(0.0, 0.0, 12.0));
		Play(TEXT("WeaponSwing"), 0.08f, 0.62f);
		break;
	}
	Game->OnSpecial(this);
	return true;
}

void ACpvFighter::StartClinch(ACpvFighter* Victim)
{
	FVector2D Dir = (Victim->Pos2D() - Pos2D()).GetSafeNormal();
	if (Dir.IsNearlyZero()) { Dir = Facing2D(); }
	Partner = Victim;
	Victim->Partner = this;
	SetActorRotation(FRotator(0.f, YawOf(Dir), 0.f));
	FVector2D Spot = Pos2D() + Dir * 62.0;
	ClampToRing(Spot, RingLimit());
	Victim->SetActorLocationAndRotation(FVector(Spot.X, Spot.Y, 0.0), FRotator(0.f, YawOf(-Dir), 0.f));
	Victim->Vel = FVector2D::ZeroVector;
	Victim->Move = nullptr;
	Victim->bArmor = false;
	Victim->Escape = 0;
	Victim->EnterState(ECpvState::Held);
	Victim->Play(TEXT("ClinchV"), 0.08f);
	Victim->UpdateMirror();
	EnterState(ECpvState::Clinch);
	Play(TEXT("ClinchA"), 0.08f);
	if (Game) { Game->OnGrab(this, Victim); }
}

void ACpvFighter::StartThrow(ECpvThrow Kind, const FVector2D& Dir)
{
	if (!Partner)
	{
		EnterState(ECpvState::Idle);
		return;
	}
	Throw = Kind;
	ThrowStage = 0;
	TravelDir = Dir.IsNearlyZero() ? Facing2D() : Dir.GetSafeNormal();
	EnterState(ECpvState::Throwing);
	Partner->EnterState(ECpvState::Thrown);
	switch (Kind)
	{
	case ECpvThrow::Headbutt: Play(TEXT("Headbutt"), 0.05f); Partner->Play(TEXT("HeadbuttV"), 0.05f); break;
	case ECpvThrow::Slam: Play(TEXT("SlamA"), 0.06f); Partner->Play(TEXT("SlamV"), 0.06f); break;
	case ECpvThrow::Whip: Play(TEXT("WhipA"), 0.06f); break;
	case ECpvThrow::Shove: Play(TEXT("ShoveA"), 0.05f); Partner->Play(TEXT("ShoveV"), 0.05f); break;
	default: break;
	}
}

// ---------------------------------------------------------------------------------------------
// Hitting and being hit
// ---------------------------------------------------------------------------------------------

void ACpvFighter::DoStrike(const FCpvMove& InMove)
{
	if (&InMove == &GThrowMove)
	{
		if (Weapon != ECpvWeapon::None && Game)
		{
			Game->ThrowWeapon(this, Weapon, WeaponUses);
			Weapon = ECpvWeapon::None;
			WeaponComp->SetVisibility(false);
		}
		return;
	}
	const bool bWeaponMove = &InMove == &CpvData::WeaponSwing || &InMove == &CpvData::WeaponSmash;
	FCpvMove M = InMove;
	if (bWeaponMove && Weapon != ECpvWeapon::None)
	{
		const FCpvWeaponDef& W = CpvData::Weapon(Weapon);
		M.Damage += W.Damage;
		M.Word = W.Word;
		M.Sound = W.Sound;
	}
	float Scale = PowerMul();
	if (RunBonus > 0.f) { Scale *= 1.25f; }
	bool bLanded = false;
	if (Foe && Foe->IsHittable())
	{
		const bool bDownTarget = Foe->State == ECpvState::Down;
		const bool bAllowed = bDownTarget ? M.bHitsDown : (M.bHitsStanding && Foe->Height < 150.f);
		const FVector2D To = Foe->Pos2D() - Pos2D();
		const float Dist = To.Size();
		const float Dot = Dist > 1.f ? FVector2D::DotProduct(To / Dist, Facing2D()) : 1.f;
		if (bAllowed && Dist <= M.Range && (Dist < 48.f || Dot >= FMath::Cos(FMath::DegreesToRadians(M.Arc))))
		{
			bLanded = Foe->TakeHit(this, M, Scale);
			if (bLanded && bWeaponMove && Weapon != ECpvWeapon::None)
			{
				AddHype(CpvData::Weapon(Weapon).HypeBonus);
				if (--WeaponUses <= 0) { DropWeapon(true); }
			}
		}
	}
	if (Game) { Game->StrikeReferee(this, M); }
	UE_LOG(LogCpv, Verbose, TEXT("strike %s %s landed=%d dist=%.0f foeState=%d foeInv=%.2f"), Def().Id, *M.Clip.ToString(), bLanded ? 1 : 0,
		Foe ? DistanceTo(Foe) : -1.f, Foe ? static_cast<int32>(Foe->State) : -1, Foe ? Foe->InvulnLeft : 0.f);
}

bool ACpvFighter::TakeHit(ACpvFighter* From, const FCpvMove& InMove, float DamageScale)
{
	const FVector2D Dir = From ? (Pos2D() - From->Pos2D()).GetSafeNormal() : -Facing2D();
	if (State == ECpvState::Block && !InMove.bUnblockable && FVector2D::DotProduct(Facing2D(), -Dir) > 0.2)
	{
		const bool bClean = GuardWindow > 0.f;
		GuardWindow = 0.f;
		if (!bClean) { Health = FMath::Max(1.f, Health - InMove.Damage * DamageScale * 0.12f); }
		StunLeft = bClean ? 0.08f : 0.2f;
		EnterState(ECpvState::BlockStun);
		Play(TEXT("BlockHit"), 0.02f);
		Vel = Dir * InMove.Knockback * 0.6;
		Jolt(6.f, 0.f);
		Freeze(0.04f);
		if (From)
		{
			From->Freeze(0.04f);
			From->AddHype(1.f);
			// Blocks beat strikes: the attacker recoils, cannot continue the combo and can be hit back.
			From->BlockedPenalty = bClean ? 0.3f : 0.16f;
			From->Jolt(-7.f, 0.f);
		}
		AddHype(bClean ? 8.f : 2.f);
		if (bClean && Game) { Game->OnCleanBlock(this); }
		if (Game) { Game->OnStrike(From, this, 0.f, ECpvReaction::Light, ECpvWord::None, "Block", GetActorLocation() + FVector(Dir.X * -20.0, Dir.Y * -20.0, 120.0), true); }
		ForceStep();
		return false;
	}
	TakeBlow(From, InMove.Damage * DamageScale, InMove.Reaction, Dir * InMove.Knockback, InMove.Lift, InMove.Word, InMove.Sound, InMove.HitStop);
	return true;
}

void ACpvFighter::TakeBlow(ACpvFighter* From, float Damage, ECpvReaction Reaction, const FVector2D& Push, float Lift, ECpvWord Word, FName Sound, float HitStop)
{
	if (State == ECpvState::Dead || State == ECpvState::Scripted || State == ECpvState::Win) { return; }
	// A long beating does less per hit, and the fifth blow in a row always sends them flying so
	// nobody gets jabbed to death in a corner.
	Juggle = JuggleClock > 0.f ? Juggle + 1 : 1;
	JuggleClock = 1.3f;
	float Dmg = Damage * GutsMul() * 0.85f * FMath::Max(0.5f, 1.f - 0.1f * (Juggle - 1));
	if (Juggle >= 5 && Reaction < ECpvReaction::Knockdown && State != ECpvState::Down)
	{
		Reaction = ECpvReaction::Knockdown;
		Juggle = 0;
	}
	const bool bCounter = State == ECpvState::Whipped || State == ECpvState::Rebound || (State == ECpvState::Attack && !bStrikeDone);
	if (bCounter) { Dmg *= 1.3f; }
	if (State == ECpvState::Down) { Dmg *= 0.75f; }
	if (bArmor) { Dmg *= 0.5f; }
	const bool bWasDazed = State == ECpvState::Dazed;
	Health = FMath::Max(0.f, Health - Dmg);
	UE_LOG(LogCpv, Verbose, TEXT("blow %s slot=%d dmg=%.1f by=%s"), Def().Id, Slot, Dmg,
		!From ? TEXT("none") : (From->State == ECpvState::Special ? TEXT("special") : (From->State == ECpvState::Throwing || From->State == ECpvState::Clinch ? TEXT("grapple") : (From->Move ? *From->Move->Clip.ToString() : TEXT("other")))));
	AddHype(Dmg * 0.4f);
	if (From)
	{
		From->DamageDealt += Dmg;
		From->HitsLanded++;
		From->Combo++;
		From->BestCombo = FMath::Max(From->BestCombo, From->Combo);
		From->ComboClock = 1.7f;
		From->bMoveConnected = true;
		From->AddHype(Dmg * 0.95f + (Word != ECpvWord::None ? 3.f : 0.f) + (bCounter ? 5.f : 0.f));
		From->Freeze(HitStop);
	}
	HitFlash(1.f);
	const FVector2D PushDir = Push.GetSafeNormal();
	const float Strength = Reaction == ECpvReaction::Light ? 9.f : (Reaction == ECpvReaction::Gut ? 6.f : 18.f);
	Jolt(-FVector2D::DotProduct(PushDir, Facing2D()) * Strength, FVector2D::CrossProduct(Facing2D(), PushDir) * Strength);
	Freeze(HitStop);
	const bool bLow = !IsStanding();
	const FVector At = GetActorLocation() + FVector(-PushDir.X * 18.0, -PushDir.Y * 18.0, bLow ? 24.0 + Height : (Reaction == ECpvReaction::Gut ? 92.0 : 128.0));
	if (Game) { Game->OnStrike(From, this, Dmg, Reaction, Word, Sound, At, false); }

	if (Health <= 0.f && !bKoHandled)
	{
		bKoHandled = true;
		if (Game) { Game->OnKnockout(this, From); }
	}
	if (bArmor && Health > 0.f)
	{
		ForceStep();
		return; // signature moves shrug hits off
	}
	if (Reaction >= ECpvReaction::Heavy) { DropWeapon(false); }

	if (Health <= 0.f)
	{
		DropWeapon(false);
		if (bDazeOnKo && !bWasDazed)
		{
			// Deciding round: whatever happens, they end up on their feet and helpless.
			if (State == ECpvState::Down)
			{
				DownLeft = FMath::Min(DownLeft, 0.8f);
				ForceStep();
				return;
			}
			ApplyReaction(Reaction <= ECpvReaction::Gut ? ECpvReaction::Heavy : Reaction, Push, Lift);
		}
		else
		{
			bDazeOnKo = false;
			ApplyReaction(ECpvReaction::Launch, Push.IsNearlyZero() ? -Facing2D() * 380.0 : Push * 1.25 + PushDir * 220.0, FMath::Max(Lift, 560.f));
		}
		return;
	}

	// Still in it: pick the reaction, upgraded when caught helpless.
	ECpvReaction R = Reaction;
	if ((State == ECpvState::Whipped || State == ECpvState::Rebound || State == ECpvState::Airborne) && R >= ECpvReaction::Heavy) { R = ECpvReaction::Launch; }
	if (State == ECpvState::Down || State == ECpvState::GetUp)
	{
		if (R == ECpvReaction::Launch && Lift > 0.f)
		{
			ApplyReaction(R, Push, Lift * 0.6f);
		}
		else
		{
			// One free shot at somebody on the mat; the second one gets them scrambling back up.
			++GroundHits;
			DownLeft = GroundHits >= 2 ? FMath::Min(DownLeft, 0.25f) : FMath::Min(DownLeft + 0.22f, 1.5f);
			ForceStep();
		}
		return;
	}
	ApplyReaction(R, Push, Lift);
}

void ACpvFighter::ApplyReaction(ECpvReaction Reaction, const FVector2D& Push, float Lift)
{
	if (Partner)
	{
		// Being knocked about ends any hold.
		ACpvFighter* Other = Partner;
		Partner = nullptr;
		Other->Partner = nullptr;
		if (Other->State == ECpvState::Clinch || Other->State == ECpvState::Held || Other->State == ECpvState::Throwing || Other->State == ECpvState::Thrown)
		{
			Other->EnterState(ECpvState::Idle);
		}
	}
	Move = nullptr;
	bArmor = false;
	Vel = Push;
	switch (Reaction)
	{
	case ECpvReaction::Light:
		StunLeft = 0.24f;
		EnterState(ECpvState::HitStun);
		Play(TEXT("HitHigh"), 0.03f);
		break;
	case ECpvReaction::Gut:
		StunLeft = 0.36f;
		EnterState(ECpvState::HitStun);
		Play(TEXT("HitGut"), 0.03f);
		break;
	case ECpvReaction::Heavy:
		StunLeft = 0.62f;
		EnterState(ECpvState::Stagger);
		Play(TEXT("Stagger"), 0.04f);
		break;
	case ECpvReaction::Knockdown:
		EnterState(ECpvState::Down);
		Play(TEXT("KnockDown"), 0.04f);
		DownLeft = 0.62f + 1.f + 0.9f * (1.f - Health / CpvRule::MaxHealth);
		bFaceDown = false;
		bBounced = false; // reused: mat thump not played yet
		break;
	case ECpvReaction::Launch:
		EnterState(ECpvState::Airborne);
		Height = FMath::Max(Height, 2.f);
		VertVel = FMath::Max(Lift, 380.f);
		bBounced = false;
		Play(TEXT("AirFlail"), 0.05f);
		break;
	}
	ForceStep();
}

void ACpvFighter::ReleaseFromThrow(ECpvState NewState, const FVector2D& Push)
{
	if (Partner)
	{
		Partner->Partner = nullptr;
		Partner = nullptr;
	}
	if (Health <= 0.f && NewState != ECpvState::Down)
	{
		// Thrown out with nothing left: drop (or reel, in a deciding round).
		ApplyReaction(bDazeOnKo ? ECpvReaction::Heavy : ECpvReaction::Launch, Push, 520.f);
		return;
	}
	if (NewState == ECpvState::Stagger) { ApplyReaction(ECpvReaction::Heavy, Push, 0.f); }
	else if (NewState == ECpvState::HitStun) { ApplyReaction(ECpvReaction::Light, Push, 0.f); }
	else
	{
		Vel = Push;
		EnterState(NewState);
	}
}

void ACpvFighter::BeginWhipped(const FVector2D& Dir)
{
	if (Partner)
	{
		Partner->Partner = nullptr;
		Partner = nullptr;
	}
	TravelDir = Dir.GetSafeNormal();
	SetActorRotation(FRotator(0.f, YawOf(TravelDir), 0.f));
	Vel = FVector2D::ZeroVector;
	EnterState(ECpvState::Whipped);
	Play(TEXT("WhipRun"), 0.08f);
}

// ---------------------------------------------------------------------------------------------
// Per-frame logic
// ---------------------------------------------------------------------------------------------

void ACpvFighter::TickThrow(float Dt)
{
	ACpvFighter* V = Partner;
	if (!V)
	{
		if (StateTime > 0.25f) { EnterState(ECpvState::Idle); }
		return;
	}
	const FVector2D Fwd = Facing2D();
	switch (Throw)
	{
	case ECpvThrow::Headbutt:
		if (ThrowStage == 0 && StateTime >= 0.22f)
		{
			ThrowStage = 1;
			V->Health = FMath::Max(0.f, V->Health - 9.f * PowerMul() * V->GutsMul());
			DamageDealt += 9.f; HitsLanded++; Combo++; BestCombo = FMath::Max(BestCombo, Combo); ComboClock = 1.7f;
			AddHype(10.f);
			V->AddHype(4.f);
			V->HitFlash(1.f);
			V->Freeze(0.09f);
			Freeze(0.09f);
			if (Game) { Game->OnStrike(this, V, 9.f, ECpvReaction::Light, ECpvWord::Bonk, "Bonk", V->GetHeadLocation(), false); }
			if (V->Health <= 0.f && !V->bKoHandled) { V->bKoHandled = true; if (Game) { Game->OnKnockout(V, this); } }
		}
		if (ThrowStage == 1 && StateTime >= 0.46f)
		{
			ThrowStage = 2;
			V->ReleaseFromThrow(ECpvState::Stagger, Fwd * 260.0);
		}
		break;
	case ECpvThrow::Slam:
		if (ThrowStage == 0 && StateTime >= 0.8f)
		{
			ThrowStage = 1;
			const float Dmg = 20.f * PowerMul() * V->GutsMul();
			V->Health = FMath::Max(0.f, V->Health - Dmg);
			DamageDealt += Dmg; HitsLanded++; Combo++; BestCombo = FMath::Max(BestCombo, Combo); ComboClock = 1.7f;
			AddHype(22.f);
			V->AddHype(8.f);
			V->HitFlash(1.f);
			V->Freeze(0.14f);
			Freeze(0.14f);
			const FVector At = V->GetActorLocation() + FVector(Fwd.X * -50.0, Fwd.Y * -50.0, 20.0);
			if (Game)
			{
				Game->OnStrike(this, V, Dmg, ECpvReaction::Knockdown, ECpvWord::Splat, "Slam", At, false);
				Game->OnSlam(At, 1.1f, false);
			}
			if (V->Health <= 0.f && !V->bKoHandled) { V->bKoHandled = true; if (Game) { Game->OnKnockout(V, this); } }
		}
		if (ThrowStage == 1 && StateTime >= 1.06f)
		{
			ThrowStage = 2;
			// The victim's clip ends lying 12 cm toward the thrower; make that their real position.
			const FVector2D Spot = V->Pos2D() + V->Facing2D() * 12.0;
			V->SetActorLocation(FVector(Spot.X, Spot.Y, 0.0));
			V->Partner = nullptr;
			Partner = nullptr;
			V->Vel = FVector2D::ZeroVector;
			V->EnterState(ECpvState::Down);
			V->Play(TEXT("DownBack"), 0.f);
			V->bFaceDown = false;
			V->bBounced = true;
			V->DownLeft = 0.9f + 0.9f * (1.f - V->Health / CpvRule::MaxHealth);
			V->ForceStep();
		}
		break;
	case ECpvThrow::Whip:
		if (ThrowStage == 0 && StateTime >= 0.3f)
		{
			ThrowStage = 1;
			V->BeginWhipped(TravelDir);
			AddHype(5.f);
			if (Game) { Game->PlaySound("Whoosh", 0.8f, 0.8f); }
		}
		break;
	case ECpvThrow::Shove:
		if (ThrowStage == 0 && StateTime >= 0.1f)
		{
			ThrowStage = 1;
			V->ReleaseFromThrow(ECpvState::HitStun, Fwd * 330.0);
		}
		break;
	default: break;
	}
	const float End = Throw == ECpvThrow::Slam ? 1.25f : (Throw == ECpvThrow::Shove ? 0.4f : 0.6f);
	if (StateTime >= End) { EnterState(ECpvState::Idle); }
}

void ACpvFighter::TickSpecial(float Dt)
{
	ACpvFx* Fx = Game->GetFx();
	const FVector2D Fwd = Facing2D();
	const FVector Hand = GetBoneLocation(bMirror ? ECpvBone::HandL : ECpvBone::HandR);
	const FVector Mouth = GetHeadLocation() + FVector(Fwd.X * 18.0, Fwd.Y * 18.0, -8.0);
	const FVector2D To = Foe->Pos2D() - Pos2D();
	const float Dist = To.Size();
	const float Dot = Dist > 1.f ? FVector2D::DotProduct(To / Dist, Fwd) : 1.f;
	float End = 1.f;
	switch (Def().Special)
	{
	case ECpvSpecial::Bomb:
	case ECpvSpecial::Orb:
		End = 0.92f;
		if (SpecialStage == 0 && StateTime >= 0.38f)
		{
			SpecialStage = 1;
			Game->SpawnProjectile(this, Def().Special == ECpvSpecial::Bomb ? 0 : 1, Hand, Foe->GetActorLocation());
		}
		break;
	case ECpvSpecial::Scream:
	case ECpvSpecial::Flame:
	{
		End = 1.3f;
		const bool bFlame = Def().Special == ECpvSpecial::Flame;
		if (StateTime >= 0.4f && StateTime <= 1.02f)
		{
			SpecialClock -= Dt;
			const FVector Dir3(Fwd.X, Fwd.Y, -0.05);
			if (bFlame) { Fx->Flames(Mouth, Dir3, 2, 520.f); }
			else if (FMath::FRand() < 0.6f) { Fx->Notes(Mouth, Dir3, 1, FLinearColor(1.f, 0.3f, 0.7f)); }
			if (SpecialClock <= 0.f)
			{
				SpecialClock = 0.15f;
				++SpecialStage;
				Game->PlaySound(bFlame ? "Flame" : "Scream", 0.9f, 1.f + SpecialStage * 0.03f);
				const float Range = bFlame ? 330.f : 430.f;
				if (Foe->IsHittable() && Dist < Range && Dot > 0.78f)
				{
					const bool bLast = SpecialStage >= 4;
					Foe->TakeBlow(this, bFlame ? 6.f : 5.f, bLast ? ECpvReaction::Knockdown : ECpvReaction::Light, Fwd * (bFlame ? 240.0 : 380.0), 0.f,
						bLast ? (bFlame ? ECpvWord::Boom : ECpvWord::Wham) : ECpvWord::None, bFlame ? "Sizzle" : "Punch", 0.03f);
				}
			}
		}
		break;
	}
	case ECpvSpecial::Zap:
		End = 1.15f;
		if (SpecialStage == 0 && StateTime >= 0.35f)
		{
			SpecialStage = 1;
			Game->PlaySound("Zap");
			const bool bHit = Foe->IsHittable() && Dist < 680.f && Dot > 0.8f;
			const FVector Target = bHit ? Foe->GetActorLocation() + FVector(0.0, 0.0, 110.0) : Hand + FVector(Fwd.X, Fwd.Y, 0.0) * 600.0;
			Fx->Bolt(Hand, Target);
			if (bHit) { Foe->TakeBlow(this, 18.f, ECpvReaction::Heavy, Fwd * 160.0, 0.f, ECpvWord::Zap, "Zap", 0.22f); }
		}
		break;
	case ECpvSpecial::Chord:
		End = 1.25f;
		for (int32 k = 0; k < 3; ++k)
		{
			if (SpecialStage == k && StateTime >= 0.32f + 0.26f * k)
			{
				++SpecialStage;
				Game->PlaySound("Chord", 1.f, 1.f + 0.12f * k);
				const FVector Top = Foe->GetActorLocation() + FVector(FMath::FRandRange(-60.f, 60.f), FMath::FRandRange(-60.f, 60.f), 620.0);
				Fx->Bolt(Top, Foe->GetActorLocation() + FVector(0.0, 0.0, 120.0));
				Game->GetArena()->Flash(0.5f);
				if (Foe->IsHittable() && Dist < 760.f)
				{
					Foe->TakeBlow(this, 7.f, k == 2 ? ECpvReaction::Knockdown : ECpvReaction::Light, Fwd * 140.0, 0.f, k == 2 ? ECpvWord::Zap : ECpvWord::None, "Zap", 0.1f);
				}
			}
		}
		break;
	case ECpvSpecial::Shockwave:
		End = 1.2f;
		if (SpecialStage == 0 && StateTime >= 0.66f)
		{
			SpecialStage = 1;
			Game->PlaySound("BassDrop");
			Game->OnSlam(GetActorLocation(), 1.6f);
			Fx->Ring(GetActorLocation() + FVector(0.0, 0.0, 3.0), 7.f, FLinearColor(0.3f, 1.f, 0.45f));
			Fx->Ring(GetActorLocation() + FVector(0.0, 0.0, 3.0), 4.2f, FLinearColor(0.5f, 0.2f, 1.f));
			for (int32 S = 0; S < 4; ++S) { Game->GetArena()->BumpRopes(S, 0.f, 260.f); }
			if (Foe->IsHittable() && Dist < 340.f && Foe->Height < 60.f)
			{
				Foe->TakeBlow(this, 20.f, ECpvReaction::Launch, (Dist > 1.f ? To / Dist : Fwd) * 300.0, 720.f, ECpvWord::Boom, "Heavy", 0.14f);
			}
		}
		break;
	case ECpvSpecial::Scepter:
		End = 1.0f;
		if (SpecialStage == 0 && StateTime >= 0.39f)
		{
			SpecialStage = 1;
			Fx->Stars(Hand, 10);
			if (Foe->IsHittable() && Dist < 205.f && Dot > 0.2f)
			{
				Foe->TakeBlow(this, 24.f, ECpvReaction::Launch, Fwd * 720.0, 540.f, ECpvWord::Wham, "Heavy", 0.16f);
			}
			else { Game->PlaySound("Whoosh", 1.f, 0.7f); }
		}
		break;
	}
	if (StateTime >= End) { EnterState(ECpvState::Idle); }
}

void ACpvFighter::TickAir(float Dt)
{
	VertVel -= CpvRule::Gravity * Dt;
	Height += VertVel * Dt;
	FVector2D P = Pos2D() + Vel * Dt;
	if (ClampToRing(P, RingLimit()) >= 0 && Vel.Size() > 150.f)
	{
		HitRopes(Vel.Size() * 0.7f);
		Vel *= -0.35;
	}
	SetActorLocation(FVector(P.X, P.Y, 0.0));
	if (Height <= 0.f && VertVel < 0.f)
	{
		Height = 0.f;
		if (Game) { Game->OnSlam(GetActorLocation(), FMath::Clamp(-VertVel / 900.f, 0.4f, 1.3f)); }
		if (!bBounced && VertVel < -620.f)
		{
			bBounced = true;
			VertVel = -VertVel * 0.32f;
			Vel *= 0.6;
			Height = 1.f;
		}
		else
		{
			Vel *= 0.4;
			EnterState(ECpvState::Down);
			Play(TEXT("Land"), 0.04f);
			bFaceDown = false;
			bBounced = true;
			DownLeft = 0.3f + 1.f + 0.9f * (1.f - Health / CpvRule::MaxHealth);
			ForceStep();
		}
	}
}

void ACpvFighter::Step(float Dt, const FCpvInput& In)
{
	if (ShownHealth < Health) { ShownHealth = Health; }
	ShownHealth = FMath::FInterpConstantTo(ShownHealth, Health, Dt, 24.f);
	if (ComboClock > 0.f)
	{
		ComboClock -= Dt;
		if (ComboClock <= 0.f) { Combo = 0; }
	}
	if (!Foe || !Game) { return; }
	// A tap on an impact frame still belongs to the player. Hold its buffer through hit stop.
	const bool bHitStop = IsFrozen();
	Buffer(In, bHitStop ? 0.f : Dt);
	GuardWindow = FMath::Max(0.f, GuardWindow - Dt);
	if (In.bBlock && !bGuardHeld) { GuardWindow = 0.13f; }
	bGuardHeld = In.bBlock;
	if (bHitStop) { return; }
	StateTime += Dt;
	InvulnLeft = FMath::Max(0.f, InvulnLeft - Dt);
	RunBonus = FMath::Max(0.f, RunBonus - Dt);
	JuggleClock = FMath::Max(0.f, JuggleClock - Dt);

	const FVector2D Me = Pos2D();
	const FVector2D FoePos = Foe->Pos2D();
	const FVector2D ToFoe = FoePos - Me;
	const float Dist = ToFoe.Size();
	FVector2D Stick = In.Move;
	if (Stick.SizeSquared() > 1.0) { Stick.Normalize(); }
	const bool bMoving = Stick.SizeSquared() > 0.04;
	bool bGroundSlide = true;

	switch (State)
	{
	case ECpvState::Idle:
	{
		FaceToward(FoePos, Dt, 900.f);
		if (In.bRun && bMoving) { EnterState(ECpvState::Run); break; }
		if (Consume(BufDodge)) { StartDodge(bMoving ? Stick : -Facing2D()); break; }
		if (Consume(BufSpecial) && StartSpecial()) { break; }
		if (Consume(BufGrab)) { StartGrab(); break; }
		if (Consume(BufLight)) { StartLight(); break; }
		if (Consume(BufHeavy)) { StartHeavy(In); break; }
		if (Consume(BufTaunt))
		{
			EnterState(ECpvState::Taunt);
			Play(Def().Taunt, 0.1f);
			break;
		}
		if (In.bBlock)
		{
			EnterState(ECpvState::Block);
			Play(TEXT("Block"), 0.06f);
			break;
		}
		if (bMoving) { MoveBy(Stick * CpvRule::WalkSpeed * SpeedMul() * Dt); }
		Play(bMoving ? TEXT("Walk") : TEXT("Idle"), 0.12f, bMoving ? SpeedMul() * 1.1f : 1.f, false);
		break;
	}
	case ECpvState::Run:
	{
		if (!In.bRun || !bMoving) { EnterState(ECpvState::Idle); break; }
		FaceToward(Me + Stick * 100.0, Dt, 720.f);
		FVector2D P = Me + Facing2D() * CpvRule::RunSpeed * SpeedMul() * Dt;
		const int32 Side = ClampToRing(P, RingLimit());
		SetActorLocation(FVector(P.X, P.Y, 0.0));
		if (Side >= 0)
		{
			// Hit the ropes at a run: bounce back out with interest.
			HitRopes(420.f);
			const FVector2D N = Side == 0 ? FVector2D(-1, 0) : (Side == 1 ? FVector2D(1, 0) : (Side == 2 ? FVector2D(0, -1) : FVector2D(0, 1)));
			TravelDir = (Facing2D() - N * 2.0 * FVector2D::DotProduct(Facing2D(), N)).GetSafeNormal();
			TravelDir = (TravelDir + N * 0.6).GetSafeNormal();
			SetActorRotation(FRotator(0.f, YawOf(TravelDir), 0.f));
			EnterState(ECpvState::Rebound);
			Throw = ECpvThrow::None; // marks a voluntary rebound (not a whip victim)
			RunBonus = 1.1f;
			Play(TEXT("RopeBounce"), 0.04f);
			AddHype(3.f);
			break;
		}
		if (Consume(BufLight)) { RunBonus = FMath::Max(RunBonus, 0.01f); StartMove(CpvData::Clothesline); break; }
		if (Consume(BufHeavy)) { StartMove(CpvData::Dropkick); break; }
		if (Consume(BufGrab)) { StartGrab(); break; }
		if (Consume(BufDodge)) { StartDodge(Facing2D()); break; }
		Play(TEXT("Run"), 0.1f, SpeedMul(), false);
		break;
	}
	case ECpvState::Rebound:
	{
		const bool bVictim = Throw == ECpvThrow::Whip;
		if (StateTime >= 0.18f)
		{
			MoveBy(TravelDir * (bVictim ? 560.0 : CpvRule::RunSpeed * 1.2) * Dt);
			if (IsClipDone() || GetClip() == "RopeBounce") { Play(bVictim ? TEXT("WhipRun") : TEXT("Run"), 0.06f, 1.1f, false); }
			if (!bVictim)
			{
				if (Consume(BufLight)) { StartMove(CpvData::Clothesline); break; }
				if (Consume(BufHeavy)) { StartMove(CpvData::Dropkick); break; }
				if (Consume(BufGrab)) { StartGrab(); break; }
			}
		}
		if (StateTime >= (bVictim ? 0.95f : 0.7f) || (StateTime > 0.3f && Dist < 70.f))
		{
			Throw = ECpvThrow::None;
			EnterState(ECpvState::Idle);
		}
		break;
	}
	case ECpvState::Whipped:
	{
		FVector2D P = Me + TravelDir * 620.0 * Dt;
		const int32 Side = ClampToRing(P, RingLimit());
		SetActorLocation(FVector(P.X, P.Y, 0.0));
		if (Side >= 0)
		{
			HitRopes(480.f);
			TravelDir = -TravelDir;
			SetActorRotation(FRotator(0.f, YawOf(TravelDir), 0.f));
			EnterState(ECpvState::Rebound);
			Throw = ECpvThrow::Whip;
			Play(TEXT("RopeBounce"), 0.04f);
			if (Game) { Game->OnRopeBounce(this); }
		}
		else if (StateTime > 1.6f) { EnterState(ECpvState::Idle); }
		break;
	}
	case ECpvState::Dodge:
	{
		const float Total = 0.34f;
		const float U = FMath::Clamp(StateTime / Total, 0.f, 1.f);
		MoveBy(TravelDir * (180.0 / Total) * 2.0 * (1.0 - U) * Dt);
		if (StateTime >= Total) { EnterState(ECpvState::Idle); }
		break;
	}
	case ECpvState::Block:
		FaceToward(FoePos, Dt, 600.f);
		if (!In.bBlock) { EnterState(ECpvState::Idle); }
		else if (Consume(BufDodge)) { StartDodge(bMoving ? Stick : -Facing2D()); }
		break;
	case ECpvState::BlockStun:
		StunLeft -= Dt;
		if (StunLeft <= 0.f)
		{
			if (In.bBlock) { EnterState(ECpvState::Block); Play(TEXT("Block"), 0.05f); }
			else { EnterState(ECpvState::Idle); }
		}
		break;
	case ECpvState::HitStun:
	case ECpvState::Stagger:
		StunLeft -= Dt;
		if (StunLeft <= 0.f)
		{
			if (Health <= 0.f)
			{
				EnterState(ECpvState::Dazed);
				Play(TEXT("Dazed"), 0.15f);
			}
			else { EnterState(ECpvState::Idle); }
		}
		break;
	case ECpvState::Attack:
	{
		if (!Move) { EnterState(ECpvState::Idle); break; }
		const FCpvMove& M = *Move;
		if (StateTime < M.HitTime)
		{
			if (StateTime < M.HitTime * 0.6f && &M != &CpvData::Clothesline && &M != &CpvData::Dropkick) { FaceToward(FoePos, Dt, 420.f); }
			if (M.Lunge > 0.f && (Dist > 74.f || M.Lunge > 100.f)) { MoveBy(Facing2D() * (M.Lunge / M.HitTime) * Dt); }
		}
		else if (!bStrikeDone)
		{
			bStrikeDone = true;
			DoStrike(M);
			if (State != ECpvState::Attack) { break; }
		}
		if (M.Chain > 0.f && StateTime >= M.Chain && ComboStep > 0 && ComboStep < 3 && BufLight > 0.f && BlockedPenalty <= 0.f)
		{
			BufLight = 0.f;
			++ComboStep;
			StartMove(ComboStep == 2 ? CpvData::Cross : CpvData::Uppercut);
			break;
		}
		if (StateTime >= M.Duration + BlockedPenalty) { EnterState(ECpvState::Idle); }
		break;
	}
	case ECpvState::GrabTry:
	{
		if (StateTime < 0.12f && Dist > 70.f) { MoveBy(Facing2D() * 330.0 * Dt); }
		if (!bStrikeDone && StateTime >= 0.1f && StateTime <= 0.25f && Dist <= CpvRule::GrabRange
			&& FVector2D::DotProduct(ToFoe.GetSafeNormal(), Facing2D()) > 0.45 && Foe->CanBeGrabbed())
		{
			bStrikeDone = true;
			const bool bCatch = Foe->State == ECpvState::Rebound || Foe->State == ECpvState::Whipped;
			StartClinch(Foe);
			if (bCatch) { StartThrow(ECpvThrow::Slam, Facing2D()); } // caught on the rebound: straight into the slam
			break;
		}
		if (StateTime >= 0.42f) { EnterState(ECpvState::Idle); }
		break;
	}
	case ECpvState::Clinch:
		if (!Partner) { EnterState(ECpvState::Idle); break; }
		if (StateTime > 0.14f)
		{
			if (Consume(BufLight)) { StartThrow(ECpvThrow::Headbutt, Facing2D()); break; }
			if (Consume(BufHeavy)) { StartThrow(ECpvThrow::Slam, Facing2D()); break; }
			if (Consume(BufGrab)) { StartThrow(ECpvThrow::Whip, bMoving ? Stick : Facing2D()); break; }
		}
		if (StateTime > 1.4f) { StartThrow(ECpvThrow::Shove, Facing2D()); }
		break;
	case ECpvState::Held:
		if (!Partner) { EnterState(ECpvState::Idle); break; }
		if (In.AnyPress()) { ++Escape; }
		if (Escape >= 6 && Partner->State == ECpvState::Clinch)
		{
			// Wriggled free: shove the grabber off.
			ACpvFighter* Other = Partner;
			Other->ApplyReaction(ECpvReaction::Heavy, Facing2D() * 260.0, 0.f);
			EnterState(ECpvState::Idle);
			Play(TEXT("ShoveA"), 0.05f);
			AddHype(6.f);
		}
		break;
	case ECpvState::Throwing:
		TickThrow(Dt);
		break;
	case ECpvState::Thrown:
		if (!Partner && StateTime > 0.2f) { EnterState(ECpvState::Idle); }
		break;
	case ECpvState::Airborne:
		TickAir(Dt);
		bGroundSlide = false;
		break;
	case ECpvState::Down:
		if (!bBounced && GetClip() == "KnockDown" && StateTime >= 0.36f)
		{
			bBounced = true;
			Game->OnSlam(GetActorLocation(), 0.7f);
		}
		if (IsClipDone() && (GetClip() == "KnockDown" || GetClip() == "Land")) { Play(bFaceDown ? TEXT("DownFront") : TEXT("DownBack"), 0.05f); }
		if (Health <= 0.f && !bDazeOnKo)
		{
			if (StateTime > 0.5f) { Kill(true); }
			break;
		}
		DownLeft -= Dt + (In.AnyPress() ? 0.12f : 0.f);   // every button press shaves a little off the time on the mat
		if (DownLeft <= 0.f)
		{
			EnterState(ECpvState::GetUp);
			InvulnLeft = 0.6f;
			Play(bFaceDown ? TEXT("GetUpFront") : TEXT("GetUp"), 0.08f);
		}
		break;
	case ECpvState::GetUp:
		if (StateTime >= 0.8f)
		{
			if (Health <= 0.f)
			{
				EnterState(ECpvState::Dazed);
				Play(TEXT("Dazed"), 0.15f);
			}
			else { EnterState(ECpvState::Idle); }
		}
		break;
	case ECpvState::Dazed:
		Game->GetFx()->Halo(Slot, GetHeadLocation() + FVector(0.0, 0.0, 22.0));
		if (StateTime >= CpvRule::DazedTime)
		{
			Kill(false);
			Game->OnSlam(GetActorLocation(), 0.6f);
		}
		break;
	case ECpvState::Taunt:
		if (!bStrikeDone && StateTime >= GetClipLength() * 0.7f)
		{
			bStrikeDone = true;
			++Taunts;
			AddHype(18.f);
			Game->OnTaunt(this);
		}
		if (StateTime >= GetClipLength()) { EnterState(ECpvState::Idle); }
		break;
	case ECpvState::Pickup:
		if (!bStrikeDone && StateTime >= 0.16f)
		{
			bStrikeDone = true;
			Game->TryPickup(this);
		}
		if (StateTime >= 0.5f) { EnterState(ECpvState::Idle); }
		break;
	case ECpvState::Special:
		TickSpecial(Dt);
		break;
	case ECpvState::Scripted:
	case ECpvState::Dead:
	case ECpvState::Win:
		bGroundSlide = false;
		break;
	}

	// Knockback slides to a stop; hard shoves into the ropes make them twang.
	if (bGroundSlide && !Vel.IsNearlyZero(1.0))
	{
		FVector2D P = Pos2D() + Vel * Dt;
		if (ClampToRing(P, RingLimit()) >= 0 && Vel.Size() > 240.f)
		{
			HitRopes(Vel.Size() * 0.8f);
			Vel *= -0.3;
		}
		SetActorLocation(FVector(P.X, P.Y, 0.0));
		Vel *= FMath::Max(0.f, 1.f - 5.5f * Dt);
		if (Vel.Size() < 14.f) { Vel = FVector2D::ZeroVector; }
	}
	if (State != ECpvState::Scripted && State != ECpvState::Dead)
	{
		VisualOffset.Z = Height; // scripted scenes own the visual offset (buried, launched, flattened...)
		UpdateMirror();
	}
	if (WeaponComp->IsVisible() && bWeaponOnLeft != bMirror) { UpdateWeaponAttachment(); }
}
