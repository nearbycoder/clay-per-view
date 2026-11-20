// What happens around the fighters: hit effects, weapons, projectiles, referee, commentary, sound.

#include "CpvGame.h"
#include "ClayPerView.h"
#include "CpvArena.h"
#include "CpvFighter.h"
#include "CpvFx.h"
#include "CpvPuppet.h"
#include "CpvUi.h"

#include "Components/AudioComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/Canvas.h"
#include "Engine/StaticMesh.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetRenderingLibrary.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Sound/SoundBase.h"

// ---------------------------------------------------------------------------------------------
// Combat feedback
// ---------------------------------------------------------------------------------------------

void ACpvGameMode::OnStrike(ACpvFighter* From, ACpvFighter* Victim, float Damage, ECpvReaction Reaction, ECpvWord Word, FName Sound, const FVector& At, bool bBlocked)
{
	PlaySound(Sound, FMath::Clamp(0.55f + Damage * 0.04f, 0.5f, 1.1f), FMath::FRandRange(0.92f, 1.1f));
	if (IsRehearsing() && From && Victim)
	{
		const bool bLandedJab = Lesson == 0 && From->Slot == 0 && From->Move == &CpvData::Jab && !bBlocked;
		const bool bGuarded = Lesson == 1 && Victim->Slot == 0 && bBlocked;
		const bool bSlammed = Lesson == 2 && From->Slot == 0 && From->GetState() == ECpvState::Throwing && Sound == "Slam";
		if (bLandedJab || bGuarded || bSlammed) { PassCue(); }
	}
	if (bBlocked)
	{
		Fx->Puff(At, 0.45f, 2);
		Shake(3.f);
		return;
	}
	if (IsRun() && From && From->Slot == 0 && Phase == ECpvPhase::Fight)
	{
		if ((Episode == 0 && From->Combo >= 3) || (Episode == 1 && (From->Move == &CpvData::WeaponSwing || From->Move == &CpvData::WeaponSmash)))
		{
			FulfillCrowdCall();
		}
	}
	const FVector Push = From ? (Victim->GetActorLocation() - From->GetActorLocation()).GetSafeNormal2D() : FVector(1.0, 0.0, 0.0);
	const FCpvFighterDef& Def = Victim->Def();
	Fx->Impact(At, Word, 0.55f + Damage * 0.055f, Word == ECpvWord::None ? FLinearColor(1.f, 0.95f, 0.7f) : FLinearColor(1.f, 0.85f, 0.2f));
	Fx->Blobs(At, Push, 2 + FMath::RoundToInt(Damage * 0.55f), Def.Clay, Def.Clay2, 250.f + Damage * 15.f);
	if (Damage >= 9.f) { Fx->Stars(At, FMath::Clamp(FMath::RoundToInt(Damage * 0.4f), 3, 8)); }
	if (Damage >= 10.f && At.Z > 100.0 && FMath::FRand() < 0.35f) { Fx->Teeth(At, Push, FMath::RandRange(1, 3)); }
	Shake(Damage * 1.1f);
	Arena->CrowdPop(Damage * 0.02f + (Word != ECpvWord::None ? 0.12f : 0.f));
	if (Damage >= 12.f)
	{
		Arena->Flash(0.3f);
		PlaySound("Cheer", 0.5f, FMath::FRandRange(0.95f, 1.08f));
		if (FMath::FRand() < 0.45f) { CommentatorsReact(FMath::FRand() < 0.5f ? "SitShock" : "SitCheer"); }
	}
	if (From && From->Combo >= 4 && From->Combo % 2 == 0) { Say(TEXT("combo"), 0.7f, From->Def().Name); }
	else if (Damage >= 13.f) { Say(TEXT("bighit"), 0.5f, From ? From->Def().Name : TEXT("")); }
	else if (Victim->Health > 0.f && Victim->Health < 25.f && Victim->Health + Damage >= 25.f) { Say(TEXT("lowhealth"), 1.f, Def.Name); }
}

void ACpvGameMode::OnCleanBlock(ACpvFighter* Who)
{
	MoveCallout[Who->Slot] = TEXT("PERFECT BLOCK!");
	MoveCalloutLeft[Who->Slot] = 1.f;
	Arena->CrowdPop(0.22f);
	Fx->Stars(Who->GetHeadLocation(), 3);
	UE_LOG(LogCpv, Verbose, TEXT("CPV_PERFECT_BLOCK slot=%d"), Who->Slot);
}

void ACpvGameMode::OnSlam(const FVector& At, float Strength, bool bPlayImpact)
{
	if (bPlayImpact) { PlaySound("Slam", FMath::Clamp(Strength, 0.4f, 1.1f), FMath::FRandRange(0.9f, 1.05f)); }
	Shake(Strength * 11.f);
	const FVector Ground(At.X, At.Y, 6.0);
	Fx->Puff(Ground, 1.1f * Strength, 4, FLinearColor(0.92f, 0.9f, 0.84f));
	Fx->Ring(FVector(At.X, At.Y, 2.5), 2.6f * Strength, FLinearColor(0.95f, 0.93f, 0.88f));
	for (int32 S = 0; S < 4; ++S) { Arena->BumpRopes(S, FMath::FRandRange(-0.5f, 0.5f), 70.f * Strength); }
	Arena->CrowdPop(0.1f * Strength);
}

void ACpvGameMode::OnKnockout(ACpvFighter* Victim, ACpvFighter* By)
{
	if (IsDemo())
	{
		SlowLeft = 0.5f;
		return;
	}
	if (Victim->bDazeOnKo)
	{
		// Deciding round: the loser is out on their feet. Curtain Call time.
		SlowLeft = 0.45f;
		PlaySound("Gasp");
		PlaySound("VO_CurtainCall");
		Arena->SetMood(ECpvLightMood::Drama, 0.6f);
		Arena->CrowdPop(0.6f);
		Say(TEXT("dazed"), 1.f, By ? By->Def().Name : TEXT(""));
		CommentatorsReact("SitShock");
	}
	else
	{
		SlowLeft = 1.1f;
		ShowBanner(TEXT("CANCELLED!"), TEXT(""), 1.8f, FLinearColor(1.f, 0.25f, 0.15f), 1.15f);
		PlaySound("VO_Cancelled");
		PlaySound("Cheer", 1.f);
		Arena->Flash(0.8f);
		Arena->CrowdPop(0.8f);
		Say(TEXT("ko"), 1.f, Victim->Def().Name);
		CommentatorsReact("SitCheer");
	}
}

void ACpvGameMode::OnTaunt(ACpvFighter* Who)
{
	Arena->CrowdPop(0.4f);
	PlaySound("Cheer", 0.7f, FMath::FRandRange(0.95f, 1.1f));
	Say(TEXT("taunt"), 0.6f, Who->Def().Name);
	// Playing to the crowd sometimes earns a gift from the cheap seats.
	if (Phase == ECpvPhase::Fight && !IsRehearsing() && Weapons.Num() < 2 && FMath::FRand() < 0.4f)
	{
		TossWeaponIn(static_cast<ECpvWeapon>(FMath::RandRange(1, static_cast<int32>(ECpvWeapon::Count) - 1)));
	}
}

void ACpvGameMode::OnSpecial(ACpvFighter* Who)
{
	if (IsRehearsing() && Lesson == 3 && Who->Slot == 0) { PassCue(); }
	MoveCallout[Who->Slot] = Who->Def().SpecialName;
	MoveCalloutLeft[Who->Slot] = 1.7f;
	PlaySound("Special");
	Arena->Flash(0.35f);
	Arena->CrowdPop(0.45f);
	Say(TEXT("special"), 0.8f, Who->Def().Name);
}

void ACpvGameMode::OnGrab(ACpvFighter* Attacker, ACpvFighter* Victim)
{
	PlaySound("Grab", 0.8f);
	Say(TEXT("grab"), 0.25f, Attacker->Def().Name);
}

void ACpvGameMode::OnRopeBounce(ACpvFighter* Who)
{
	Say(TEXT("ropes"), 0.3f, Who->Def().Name);
}

void ACpvGameMode::OnHypeFull(ACpvFighter* Who)
{
	if (IsDemo()) { return; }
	PlaySound("HypeFull", 0.8f);
	MoveCallout[Who->Slot] = TEXT("SIGNATURE READY!");
	MoveCalloutLeft[Who->Slot] = 1.4f;
}

void ACpvGameMode::StrikeReferee(ACpvFighter* From, const FCpvMove& Move)
{
	if (!Referee || RefDown > 0.f || Referee->bHidden || !Move.bHitsStanding || Move.Damage < 6.f) { return; }
	const FVector2D To = FVector2D(Referee->GetActorLocation()) - From->Pos2D();
	const float Dist = To.Size();
	if (Dist > Move.Range - 12.f || FVector2D::DotProduct(To.GetSafeNormal(), From->Facing2D()) < 0.6) { return; }
	// The official takes one for the team.
	RefDown = 4.2f;
	Referee->Play(TEXT("KnockDown"), 0.04f);
	Referee->HitFlash(1.f);
	Referee->ForceStep();
	const FVector At = Referee->GetActorLocation() + FVector(0.0, 0.0, 120.0);
	Fx->Impact(At, ECpvWord::Oof, 1.3f, FLinearColor(1.f, 0.85f, 0.2f));
	Fx->Blobs(At, FVector(To.X, To.Y, 0.0), 6, FLinearColor(0.9f, 0.9f, 0.88f), FLinearColor(0.02f, 0.02f, 0.02f), 320.f);
	PlaySound("Heavy");
	PlaySound("Gasp", 0.8f);
	Shake(10.f);
	Arena->CrowdPop(0.5f);
	From->AddHype(8.f);
	Say(TEXT("refdown"), 1.f);
	CommentatorsReact("SitShock");
}

// ---------------------------------------------------------------------------------------------
// Props, weapons and projectiles
// ---------------------------------------------------------------------------------------------

UStaticMeshComponent* ACpvGameMode::TakeProp(const TCHAR* MeshPath)
{
	UStaticMeshComponent* Comp = nullptr;
	for (UStaticMeshComponent* C : PropPool)
	{
		if (!C->IsVisible()) { Comp = C; break; }
	}
	if (!Comp)
	{
		// Game modes are hidden "info" actors, so anything they own would not draw: props live on the effects actor.
		Comp = NewObject<UStaticMeshComponent>(Fx);
		Comp->SetMobility(EComponentMobility::Movable);
		Comp->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Comp->SetupAttachment(Fx->GetRootComponent());
		Comp->RegisterComponent();
		PropPool.Add(Comp);
	}
	Comp->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, MeshPath));
	Comp->SetWorldScale3D(FVector(1.0));
	Comp->SetVisibility(true);
	return Comp;
}

void ACpvGameMode::ReturnProp(UStaticMeshComponent* Comp)
{
	if (Comp) { Comp->SetVisibility(false); }
}

bool ACpvGameMode::NearestWeapon(const FVector2D& From, FVector& OutAt) const
{
	float Best = 1e9f;
	for (const FMatWeapon& W : Weapons)
	{
		if (!W.bResting || FMath::Abs(W.Pos.X) > 280.0 || FMath::Abs(W.Pos.Y) > 280.0) { continue; }
		const float D = (FVector2D(W.Pos) - From).Size();
		if (D < Best) { Best = D; OutAt = W.Pos; }
	}
	return Best < 1e8f;
}

bool ACpvGameMode::WeaponNear(const ACpvFighter* Who, float Range) const
{
	FVector At;
	return NearestWeapon(Who->Pos2D(), At) && (FVector2D(At) - Who->Pos2D()).Size() <= Range;
}

bool ACpvGameMode::TryPickup(ACpvFighter* Who)
{
	int32 Best = INDEX_NONE;
	float BestDist = 135.f;
	for (int32 i = 0; i < Weapons.Num(); ++i)
	{
		const float D = (FVector2D(Weapons[i].Pos) - Who->Pos2D()).Size();
		if (Weapons[i].bResting && D < BestDist) { Best = i; BestDist = D; }
	}
	if (Best == INDEX_NONE) { return false; }
	const FMatWeapon W = Weapons[Best];
	ReturnProp(W.Comp);
	Weapons.RemoveAt(Best);
	Who->GiveWeapon(W.Type, W.Uses);
	PlaySound("Pickup");
	Arena->CrowdPop(0.25f);
	Say(TEXT("weapon"), 0.7f, CpvData::Weapon(W.Type).Name);
	return true;
}

void ACpvGameMode::DropWeaponAt(ECpvWeapon Type, int32 Uses, const FVector& At, const FVector2D& Fling)
{
	FMatWeapon W;
	W.Type = Type;
	W.Uses = Uses;
	W.Comp = TakeProp(CpvData::Weapon(Type).Mesh);
	W.Pos = At;
	W.Vel = FVector(Fling.X, Fling.Y, 160.0);
	W.Rot = FRotator(FMath::FRandRange(0.f, 360.f), FMath::FRandRange(0.f, 360.f), 0.f);
	W.Spin = FRotator(FMath::FRandRange(-300.f, 300.f), FMath::FRandRange(-200.f, 200.f), 0.f);
	Weapons.Add(W);
}

void ACpvGameMode::BreakWeapon(ECpvWeapon Type, const FVector& At)
{
	PlaySound("Break");
	Fx->Blobs(At, FVector(0.0, 0.0, 1.0), 12, FLinearColor(0.45f, 0.3f, 0.18f), FLinearColor(0.5f, 0.52f, 0.56f), 380.f, false);
	Fx->Puff(At, 1.2f, 4);
	Fx->Stars(At, 6);
	Say(TEXT("weaponbreak"), 0.6f, CpvData::Weapon(Type).Name);
}

void ACpvGameMode::ThrowWeapon(ACpvFighter* From, ECpvWeapon Type, int32 Uses)
{
	FMatWeapon W;
	W.Type = Type;
	W.Uses = Uses;
	W.Comp = TakeProp(CpvData::Weapon(Type).Mesh);
	W.Pos = From->GetBoneLocation(From->bMirror ? ECpvBone::HandL : ECpvBone::HandR);
	const FVector2D Dir = From->Facing2D();
	W.Vel = FVector(Dir.X * 980.0, Dir.Y * 980.0, 140.0);
	W.Spin = FRotator(900.f, 0.f, 300.f);
	W.bThrown = true;
	W.Owner = From;
	Weapons.Add(W);
	PlaySound("Whoosh", 1.f, 0.8f);
}

void ACpvGameMode::TossWeaponIn(ECpvWeapon Type)
{
	// Sails in from the stands on a random side and lands somewhere near the middle of the ring.
	const float A = FMath::FRandRange(0.f, UE_TWO_PI);
	const FVector From(FMath::Cos(A) * 780.0, FMath::Sin(A) * 780.0, 120.0);
	const FVector To(FMath::FRandRange(-150.f, 150.f), FMath::FRandRange(-150.f, 150.f), 0.0);
	const float T = 1.15f;
	FMatWeapon W;
	W.Type = Type;
	W.Uses = CpvData::Weapon(Type).Uses;
	W.Comp = TakeProp(CpvData::Weapon(Type).Mesh);
	W.Pos = From;
	W.Vel = FVector((To.X - From.X) / T, (To.Y - From.Y) / T, (To.Z - From.Z) / T + 0.5f * 1500.f * T);
	W.Spin = FRotator(FMath::FRandRange(250.f, 500.f), FMath::FRandRange(-200.f, 200.f), FMath::FRandRange(-200.f, 200.f));
	Weapons.Add(W);
	PlaySound("Whoosh", 0.7f, 0.7f);
	PlaySound("Cheer", 0.5f);
	MoveCallout[0] = MoveCallout[1] = FString();
	ShowBanner(FString::Printf(TEXT("INCOMING: %s!"), CpvData::Weapon(Type).Name), TEXT("WALK OVER IT AND PRESS GRAB"), 2.2f, FLinearColor(1.f, 0.85f, 0.2f), 0.5f);
	Say(TEXT("weaponin"), 0.8f, CpvData::Weapon(Type).Name);
}

void ACpvGameMode::TickWeapons(float Dt)
{
	for (int32 i = Weapons.Num() - 1; i >= 0; --i)
	{
		FMatWeapon& W = Weapons[i];
		if (!W.bResting)
		{
			W.Vel.Z -= (W.bThrown ? 500.f : 1500.f) * Dt;
			W.Pos += W.Vel * Dt;
			W.Rot += W.Spin * Dt;
			if (W.bThrown && W.Owner && W.Owner->GetFoe())
			{
				ACpvFighter* Target = W.Owner->GetFoe();
				const FVector2D Flat = FVector2D(W.Pos) - Target->Pos2D();
				if (Target->IsHittable() && Target->IsStanding() && Flat.Size() < 58.f && W.Pos.Z < 190.0)
				{
					// A knockdown can add the defender's dropped prop to this same array.
					const FMatWeapon Hit = W;
					ReturnProp(W.Comp);
					Weapons.RemoveAt(i);
					const FCpvWeaponDef& Def = CpvData::Weapon(Hit.Type);
					if (IsRun() && Episode == 1 && Hit.Owner->Slot == 0) { FulfillCrowdCall(); }
					Target->TakeBlow(Hit.Owner, 11.f + Def.Damage * 0.5f, ECpvReaction::Knockdown, FVector2D(Hit.Vel).GetSafeNormal() * 340.0, 0.f, Def.Word, Def.Sound, 0.13f);
					BreakWeapon(Hit.Type, Hit.Pos);
					continue;
				}
			}
			const bool bOnMat = FMath::Abs(W.Pos.X) < Arena->MatHalf && FMath::Abs(W.Pos.Y) < Arena->MatHalf;
			const float Ground = bOnMat ? 4.f : Arena->FloorZ + 4.f;
			if (W.Pos.Z <= Ground && W.Vel.Z < 0.0)
			{
				W.Pos.Z = Ground;
				if (W.Vel.Z < -260.0)
				{
					W.Vel = FVector(W.Vel.X * 0.4, W.Vel.Y * 0.4, -W.Vel.Z * 0.3);
					W.Spin = W.Spin * 0.5f;
					PlaySound("Thud", 0.7f);
				}
				else
				{
					W.bResting = true;
					W.bThrown = false;
					W.Vel = FVector::ZeroVector;
					W.Rot = FRotator(0.f, W.Rot.Yaw, 90.f); // lying on its side
					W.Pos.Z = Ground + 8.f;
				}
			}
			if (W.Pos.Z < Arena->FloorZ - 50.0 || FMath::Abs(W.Pos.X) > 1500.0 || FMath::Abs(W.Pos.Y) > 1500.0)
			{
				ReturnProp(W.Comp);
				Weapons.RemoveAt(i);
				continue;
			}
		}
		if (W.Comp) { W.Comp->SetWorldLocationAndRotation(W.Pos, W.Rot); }
	}
}

void ACpvGameMode::SpawnProjectile(ACpvFighter* Owner, int32 Kind, const FVector& From, const FVector& Target)
{
	FProjectile P;
	P.Kind = Kind;
	P.Owner = Owner;
	P.Pos = From;
	if (Kind == 0)
	{
		const float T = 0.72f;
		P.Comp = TakeProp(TEXT("/Game/CPV/Props/SM_Bomb.SM_Bomb"));
		P.Vel = FVector((Target.X - From.X) / T, (Target.Y - From.Y) / T, (10.0 - From.Z) / T + 0.5 * 1500.0 * T);
	}
	else
	{
		P.Comp = TakeProp(TEXT("/Game/CPV/Props/SM_CrystalBall.SM_CrystalBall"));
		const FVector2D Dir = (FVector2D(Target) - FVector2D(From)).GetSafeNormal();
		P.Vel = FVector(Dir.X * 780.0, Dir.Y * 780.0, 0.0);
		P.Pos.Z = FMath::Max(From.Z, 90.0);
	}
	Projectiles.Add(P);
	PlaySound("Whoosh", 0.9f, Kind == 0 ? 0.8f : 1.2f);
}

void ACpvGameMode::TickProjectiles(float Dt)
{
	for (int32 i = Projectiles.Num() - 1; i >= 0; --i)
	{
		FProjectile& P = Projectiles[i];
		P.Age += Dt;
		ACpvFighter* Target = P.Owner ? P.Owner->GetFoe() : nullptr;
		bool bDone = false;
		if (P.Kind == 0)
		{
			P.Vel.Z -= 1500.0 * Dt;
			P.Pos += P.Vel * Dt;
			const bool bNear = Target && (FVector2D(P.Pos) - Target->Pos2D()).Size() < 52.f && P.Pos.Z < 170.0 && P.Age > 0.25f;
			if (P.Pos.Z <= 12.0 || bNear)
			{
				bDone = true;
				Fx->Explosion(FVector(P.Pos.X, P.Pos.Y, FMath::Max(P.Pos.Z, 20.0)), 1.f);
				PlaySound("Explosion");
				Arena->Flash(1.f);
				Shake(22.f);
				Arena->CrowdPop(0.5f);
				if (Target && Target->IsHittable())
				{
					const FVector2D Away = Target->Pos2D() - FVector2D(P.Pos);
					if (Away.Size() < 175.f)
					{
						Target->TakeBlow(P.Owner, 22.f, ECpvReaction::Launch, Away.GetSafeNormal() * 380.0, 700.f, ECpvWord::None, "Heavy", 0.16f);
					}
				}
			}
		}
		else
		{
			P.Pos += P.Vel * Dt;
			P.Pos.Z = 92.0 + 10.0 * FMath::Sin(P.Age * 14.f);
			if (FMath::FRand() < 0.5f) { Fx->Stars(P.Pos, 1); }
			if (Target && Target->IsHittable() && Target->IsStanding() && (FVector2D(P.Pos) - Target->Pos2D()).Size() < 56.f)
			{
				bDone = true;
				Target->TakeBlow(P.Owner, 20.f, ECpvReaction::Knockdown, FVector2D(P.Vel).GetSafeNormal() * 430.0, 0.f, ECpvWord::Wham, "Heavy", 0.15f);
				Fx->Puff(P.Pos, 1.5f, 5, FLinearColor(0.6f, 0.45f, 1.f));
				PlaySound("Zap", 0.8f, 1.3f);
			}
			else if (FMath::Abs(P.Pos.X) > Arena->RopeHalf || FMath::Abs(P.Pos.Y) > Arena->RopeHalf || P.Age > 1.6f)
			{
				bDone = true;
				Arena->BumpRopesAt(P.Pos, 240.f);
				Fx->Puff(P.Pos, 1.2f, 4, FLinearColor(0.6f, 0.45f, 1.f));
			}
		}
		if (P.Comp) { P.Comp->SetWorldLocationAndRotation(P.Pos, FRotator(P.Age * 500.f, P.Age * 300.f, 0.f)); }
		if (bDone)
		{
			ReturnProp(P.Comp);
			Projectiles.RemoveAt(i);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Referee and commentators
// ---------------------------------------------------------------------------------------------

void ACpvGameMode::TickReferee(float Dt)
{
	if (!Referee || !Fighters[0] || !Fighters[1]) { return; }
	const bool bInRing = Phase == ECpvPhase::RoundIntro || Phase == ECpvPhase::Fight || Phase == ECpvPhase::RoundEnd || Phase == ECpvPhase::MatchEnd
		|| Phase == ECpvPhase::Results || IsDemo();
	Referee->bHidden = !bInRing;
	if (!bInRing || PinSlot >= 0) { return; }
	const FVector2D A = Fighters[0]->Pos2D(), B = Fighters[1]->Pos2D();
	const FVector2D Mid = (A + B) * 0.5;
	FVector2D Me(Referee->GetActorLocation());
	Referee->SetLookTarget(FVector(Mid.X, Mid.Y, 110.0), 0.8f);
	if (RefDown > 0.f)
	{
		RefDown -= Dt;
		if (RefDown <= 0.9f && Referee->GetClip() != "GetUp") { Referee->Play(TEXT("GetUp"), 0.1f); }
		if (RefDown <= 0.f) { Referee->Play(TEXT("RefIdle"), 0.15f); }
		return;
	}
	// One-off gestures (start signal, calling for the bell).
	if (!RefAct.IsNone())
	{
		if (RefActLeft <= 0.f)
		{
			Referee->Play(RefAct, 0.12f);
			RefActLeft = Referee->GetClipLength();
		}
		RefActLeft -= Dt;
		if (RefActLeft <= 0.f) { RefAct = NAME_None; }
		return;
	}
	// Otherwise hover on the far side of the action, out of arm's reach.
	FVector2D Goal;
	if ((Phase == ECpvPhase::MatchEnd || Phase == ECpvPhase::Results) && Winner >= 0)
	{
		Goal = Fighters[Winner]->Pos2D() + FVector2D(-70.0, -20.0);
	}
	else
	{
		FVector2D Axis = (B - A).GetSafeNormal();
		if (Axis.IsNearlyZero()) { Axis = FVector2D(1.0, 0.0); }
		FVector2D Side(-Axis.Y, Axis.X);
		if (Side.Y > 0.0) { Side = -Side; } // prefer the side away from the broadcast camera
		Goal = Mid + Side * 185.0;
		// Keep the official's silhouette beside a clinch instead of directly behind both faces.
		const double Offset = Mid.X > 0.0 ? -118.0 : 118.0;
		Goal.X += Offset * FMath::Clamp(1.0 - FVector2D::Distance(A, B) / 260.0, 0.0, 1.0);
	}
	const float Limit = Arena->RingLimit() - 6.f;
	Goal.X = FMath::Clamp(Goal.X, -Limit, Limit);
	Goal.Y = FMath::Clamp(Goal.Y, -Limit, Limit);
	// Step away if a fighter is too close.
	for (const FVector2D& F : { A, B })
	{
		const FVector2D Off = Goal - F;
		if (Off.Size() < 125.f) { Goal = F + (Off.IsNearlyZero() ? FVector2D(0.0, -1.0) : Off.GetSafeNormal()) * 125.0; }
	}
	RefGoal = Goal;
	const FVector2D To = RefGoal - Me;
	const float Dist = To.Size();
	const bool bRaise = (Phase == ECpvPhase::MatchEnd || Phase == ECpvPhase::Results) && Winner >= 0 && Dist < 30.f;
	if (Dist > 22.f)
	{
		Me += To / Dist * FMath::Min(Dist, 190.f * Dt);
		Referee->Play(TEXT("Walk"), 0.15f, 1.f, false);
	}
	else if (bRaise) { Referee->Play(TEXT("RefRaise"), 0.2f, 1.f, false); }
	else { Referee->Play(TEXT("RefIdle"), 0.2f, 1.f, false); }
	const FVector2D Face = bRaise ? FVector2D(0.0, 1.0) : (Mid - Me);
	const float Want = FMath::RadiansToDegrees(FMath::Atan2(Face.Y, Face.X));
	const float Now = Referee->GetActorRotation().Yaw;
	Referee->SetActorLocationAndRotation(FVector(Me.X, Me.Y, 0.0), FRotator(0.f, Now + FMath::Clamp(FMath::FindDeltaAngleDegrees(Now, Want), -400.f * Dt, 400.f * Dt), 0.f));
	Referee->bMirror = FMath::Cos(FMath::DegreesToRadians(Referee->GetActorRotation().Yaw)) < -0.2f;
}

void ACpvGameMode::CommentatorsReact(FName Clip)
{
	for (int32 i = 0; i < 2; ++i)
	{
		if (Commentators[i] && (i == 0 || FMath::FRand() < 0.7f)) { Commentators[i]->Play(Clip, 0.08f, FMath::FRandRange(0.9f, 1.15f)); }
	}
}

void ACpvGameMode::TickCommentators(float Dt)
{
	if (!Fighters[0] || !Fighters[1]) { return; }
	const FVector Mid = (Fighters[0]->GetActorLocation() + Fighters[1]->GetActorLocation()) * 0.5 + FVector(0.0, 0.0, 110.0);
	for (int32 i = 0; i < 2; ++i)
	{
		if (!Commentators[i]) { continue; }
		Commentators[i]->SetLookTarget(Mid, 0.9f);
		if (Commentators[i]->IsClipDone() && Commentators[i]->GetClip() != "SitIdle") { Commentators[i]->Play(TEXT("SitIdle"), 0.2f); }
	}
}

// ---------------------------------------------------------------------------------------------
// Commentary
// ---------------------------------------------------------------------------------------------

void ACpvGameMode::LoadCommentary()
{
	auto LoadCaptions = [](const TCHAR* File, const TCHAR* Prefix, TMap<FName, FString>& Out)
	{
		const FString Path = FPaths::ProjectContentDir() / TEXT("CPV/Data") / File;
		FString Text;
		TSharedPtr<FJsonObject> Root;
		if (FFileHelper::LoadFileToString(Text, *Path) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Root) && Root.IsValid())
		{
			for (const auto& Pair : Root->Values) { Out.Add(FName(*(Prefix + FString(Pair.Key))), Pair.Value->AsString()); }
		}
		else { UE_LOG(LogCpv, Warning, TEXT("Missing captions at %s"), *Path); }
	};
	LoadCaptions(TEXT("announcer.json"), TEXT("VO_"), AnnouncerCaptions);
	LoadCaptions(TEXT("captions_pt_BR.json"), TEXT(""), PortugueseCaptions);
	for (const FCpvFighterDef& Def : CpvData::Roster())
	{
		const FString DisplayName(Def.Name);
		const FName Entrance(*FString::Printf(TEXT("VO_Name_%s"), Def.VoiceId));
		const FName WinnerCall(*FString::Printf(TEXT("VO_Win_%s"), Def.VoiceId));
		AnnouncerCaptions.Add(Entrance, DisplayName + TEXT("!"));
		AnnouncerCaptions.Add(WinnerCall, FString(TEXT("Your winner... ")) + DisplayName + TEXT("!"));
		PortugueseCaptions.Add(Entrance, DisplayName + TEXT("!"));
		const FString WinnerTemplate = PortugueseCaptions.FindRef(TEXT("winner"));
		PortugueseCaptions.Add(WinnerCall, WinnerTemplate.Replace(TEXT("{name}"), *DisplayName));
	}
	const FString Path = FPaths::ProjectContentDir() / TEXT("CPV/Data/commentary.json");
	FString Text;
	TSharedPtr<FJsonObject> Root;
	if (!FFileHelper::LoadFileToString(Text, *Path) || !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Root) || !Root.IsValid())
	{
		UE_LOG(LogCpv, Warning, TEXT("No commentary at %s"), *Path);
		return;
	}
	for (const auto& Pair : Root->Values)
	{
		TArray<FLine>& List = Lines.Add(FString(Pair.Key));
		for (const TSharedPtr<FJsonValue>& V : Pair.Value->AsArray())
		{
			const TArray<TSharedPtr<FJsonValue>>& A = V->AsArray();
			if (A.Num() >= 2) { List.Add({ static_cast<int32>(A[0]->AsNumber()), A[1]->AsString() }); }
		}
	}
}

void ACpvGameMode::Say(const TCHAR* Event, float Chance, const FString& Name)
{
	if (IsRehearsing() || PinSlot >= 0) { return; }
	if (IsDemo() || !PendingVoice.IsNone() || SayCooldown > 0.f || FMath::FRand() > Chance) { return; }
	const TArray<FLine>* List = Lines.Find(Event);
	if (!List || List->Num() == 0) { return; }
	const int32 Index = FMath::RandRange(0, List->Num() - 1);
	const FLine& Line = (*List)[Index];
	FString Key = FString::Printf(TEXT("VO_%s_%d"), Event, Index);
	const FString Localized = PortugueseCaptions.FindRef(FName(*Key));
	const FString* Prop = Name.IsEmpty() ? nullptr : PortugueseCaptions.Find(FName(*Name));
	PendingSubtitle.Portuguese = Localized.Replace(TEXT("{name}"), Prop ? **Prop : *Name);
	if (Line.Text.Contains(TEXT("{name}")))
	{
		Key += TEXT("_") + Name.ToUpper().Replace(TEXT(" "), TEXT("_"));
	}
	PendingVoice = FName(*Key);
	PendingSubtitle.Speaker = Line.Speaker;
	PendingSubtitle.Text = Line.Text.Replace(TEXT("{name}"), *Name);
}

// ---------------------------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------------------------

USoundBase* ACpvGameMode::FindSound(FName Name)
{
	if (TObjectPtr<USoundBase>* Found = Sounds.Find(Name)) { return *Found; }
	const FString Path = FString::Printf(TEXT("/Game/CPV/Audio/S_%s.S_%s"), *Name.ToString(), *Name.ToString());
	USoundBase* Sound = LoadObject<USoundBase>(nullptr, *Path, nullptr, LOAD_NoWarn | LOAD_Quiet);
	Sounds.Add(Name, TObjectPtr<USoundBase>(Sound));
	return Sound;
}

void ACpvGameMode::StopVoice()
{
	if (IsValid(VoiceComp)) { VoiceComp->Stop(); }
	VoiceComp = nullptr;
	PendingVoice = NAME_None;
	Subtitle.Left = 0.f;
	SayCooldown = 0.f;
	DuckLeft = 0.f;
}

void ACpvGameMode::PlaySound(FName Name, float Volume, float Pitch)
{
	USoundBase* Sound = FindSound(Name);
	if (!Sound) { return; }
	const FString Key = Name.ToString();
	const bool bVoice = Key.StartsWith(TEXT("VO_"));
	const bool bUi = Name == "Tick" || Name == "Select" || Name == "Back";
	if (Arena && Arena->IsTaping() && !bVoice && !bUi)
	{
		const float At = GetWorld()->GetTimeSeconds();
		TapeSounds.RemoveAll([At](const FTapeSound& S) { return S.At < At - 6.f; });
		TapeSounds.Add({At, Name, Volume, Pitch});
	}
	float Level = Volume;
	if (bVoice)
	{
		// Voices sit on top of the mix, and the music and crowd step back while they speak.
		StopVoice();
		DuckLeft = Sound->GetDuration() + 0.15f;
		if (const FString* Words = AnnouncerCaptions.Find(Name))
		{
			Subtitle.Speaker = INDEX_NONE;
			Subtitle.Text = *Words;
			Subtitle.Portuguese = PortugueseCaptions.FindRef(Name);
			Subtitle.Left = FMath::Max(1.f, DuckLeft);
		}
		UE_LOG(LogCpv, Verbose, TEXT("Voice %s (%.2fs)"), *Key, Sound->GetDuration());
		VoiceLevel = Level * 1.25f;
		const float Gain = VoiceLevel * BusGain(ECpvAudioBus::Voice);
		if (Gain > 0.f) { VoiceComp = UGameplayStatics::SpawnSound2D(this, Sound, Gain, Pitch); }
		return;
	}
	else if (IsDemo() && !bUi)
	{
		Level *= 0.45f;   // the bout behind the menus stays in the background
	}
	const bool bCrowd = Name == "Cheer" || Name == "Gasp";
	ECpvAudioBus Bus = ECpvAudioBus::Effects;
	if (bUi) { Bus = ECpvAudioBus::Interface; }
	else if (bCrowd) { Bus = ECpvAudioBus::Crowd; }
	else if (Name == "Fanfare" || Key.StartsWith(TEXT("Theme_"))) { Bus = ECpvAudioBus::Music; }
	PlayMixedClip(Sound, Bus, Level, Pitch);
}

float ACpvGameMode::BusGain(ECpvAudioBus Bus) const
{
	return MasterGain() * BusVolume[static_cast<int32>(Bus)] / 10.f;
}

UAudioComponent* ACpvGameMode::PlayMixedClip(USoundBase* Sound, ECpvAudioBus Bus, float Level, float Pitch)
{
	PlayingClips.RemoveAllSwap([](const FPlayingClip& Clip) { return !Clip.Component.IsValid() || !Clip.Component->IsPlaying(); });
	const float Gain = Level * BusGain(Bus);
	if (Sound && Gain > 0.f)
	{
		if (UAudioComponent* Comp = UGameplayStatics::SpawnSound2D(this, Sound, Gain, Pitch))
		{
			PlayingClips.Add({Comp, Bus, Level});
			return Comp;
		}
	}
	return nullptr;
}

void ACpvGameMode::StartLoop(TObjectPtr<UAudioComponent>& Comp, FName Name, float Level)
{
	USoundBase* Sound = FindSound(Name);
	if (&Comp == &MusicComp) { MusicLevel = Level; }
	if (!Comp || Comp->Sound != Sound)
	{
		if (Comp) { Comp->Stop(); Comp->DestroyComponent(); }
		Comp = Sound ? UGameplayStatics::CreateSound2D(this, Sound, 1.f, 1.f, 0.f, nullptr, false, false) : nullptr;
	}
	RefreshBeds();
}

void ACpvGameMode::RefreshMix()
{
	for (const FPlayingClip& Clip : PlayingClips)
	{
		if (Clip.Component.IsValid()) { Clip.Component->SetVolumeMultiplier(Clip.Level * BusGain(Clip.Bus)); }
	}
	if (IsValid(VoiceComp)) { VoiceComp->SetVolumeMultiplier(VoiceLevel * BusGain(ECpvAudioBus::Voice)); }
	RefreshBeds();
}

void ACpvGameMode::TickAudio(float Dt)
{
	DuckLeft = FMath::Max(0.f, DuckLeft - Dt);
	// Let the ring announcer finish before the booth responds.
	if (!PendingVoice.IsNone() && DuckLeft <= 0.f && (!IsValid(VoiceComp) || !VoiceComp->IsPlaying()))
	{
		const FName Key = PendingVoice;
		PendingVoice = NAME_None;
		PlaySound(Key, 0.9f);
		Subtitle = PendingSubtitle;
		const float ReadTime = FMath::Clamp(1.6f + (bPortugueseSubtitles ? Subtitle.Portuguese.Len() : Subtitle.Text.Len()) * 0.045f, 2.2f, 4.5f);
		Subtitle.Left = FMath::Max(ReadTime, DuckLeft);
		SayCooldown = Subtitle.Left + 1.2f;
		if (Commentators[Subtitle.Speaker]) { Commentators[Subtitle.Speaker]->Play(TEXT("SitTalk"), 0.1f); }
	}
	TickBeds(Dt);
}

void ACpvGameMode::TickBeds(float Dt)
{
	const bool bSpeech = (!bPaused && DuckLeft > 0.f) || (VoicePreview.IsValid() && VoicePreview->IsPlaying());
	const bool bDuck = bVoiceDucking && bSpeech && BusGain(ECpvAudioBus::Voice) > 0.f;
	Duck = FMath::FInterpTo(Duck, bDuck ? 0.4f : 1.f, Dt, 7.f);
	RefreshBeds();
}

void ACpvGameMode::RefreshBeds()
{
	auto SetLoop = [](UAudioComponent* Comp, float Gain)
	{
		if (!Comp) { return; }
		if (Gain <= 0.f)
		{
			if (Comp->IsPlaying()) { Comp->Stop(); }
			return;
		}
		Comp->SetVolumeMultiplier(Gain);
		if (!Comp->IsPlaying()) { Comp->Play(); }
	};
	if (Arena)
	{
		const float Level = (0.22f + 0.7f * Arena->GetHype()) * (IsDemo() ? 0.7f : 1.f);
		SetLoop(CrowdComp, Level * BusGain(ECpvAudioBus::Crowd) * FMath::Lerp(1.f, Duck, 0.6f));
	}
	SetLoop(MusicComp, MusicLevel * BusGain(ECpvAudioBus::Music) * Duck);
}

void ACpvGameMode::LoadOptions()
{
	const TCHAR* Section = TEXT("ClayPerView.Options");
	GConfig->GetInt(Section, TEXT("Difficulty"), Difficulty, GGameUserSettingsIni);
	GConfig->GetInt(Section, TEXT("RoundsToWin"), RoundsToWin, GGameUserSettingsIni);
	GConfig->GetInt(Section, TEXT("RoundSeconds"), RoundSeconds, GGameUserSettingsIni);
	GConfig->GetInt(Section, TEXT("AnimStyle"), AnimStyle, GGameUserSettingsIni);
	GConfig->GetInt(Section, TEXT("Volume"), SoundVolume, GGameUserSettingsIni);
	LoadAVOptions();
	GConfig->GetBool(Section, TEXT("Fullscreen"), bFullscreen, GGameUserSettingsIni);
	Difficulty = FMath::Clamp(Difficulty, 0, 2);
	RoundsToWin = FMath::Clamp(RoundsToWin, 1, 2);
	RoundSeconds = RoundSeconds == 60 || RoundSeconds == 0 ? RoundSeconds : 99;
	AnimStyle = FMath::Clamp(AnimStyle, 0, 2);
	SoundVolume = FMath::Clamp(SoundVolume, 0, 10);
}

void ACpvGameMode::SaveOptions()
{
	const TCHAR* Section = TEXT("ClayPerView.Options");
	GConfig->SetInt(Section, TEXT("Difficulty"), Difficulty, GGameUserSettingsIni);
	GConfig->SetInt(Section, TEXT("RoundsToWin"), RoundsToWin, GGameUserSettingsIni);
	GConfig->SetInt(Section, TEXT("RoundSeconds"), RoundSeconds, GGameUserSettingsIni);
	GConfig->SetInt(Section, TEXT("AnimStyle"), AnimStyle, GGameUserSettingsIni);
	GConfig->SetInt(Section, TEXT("Volume"), SoundVolume, GGameUserSettingsIni);
	SaveAVOptions();
	if (!Dev.bWindow) { GConfig->SetBool(Section, TEXT("Fullscreen"), bFullscreen, GGameUserSettingsIni); }
	GConfig->Flush(false, GGameUserSettingsIni);
}

// ---------------------------------------------------------------------------------------------
// The big screen on the entrance stage
// ---------------------------------------------------------------------------------------------

void ACpvGameMode::DrawStageScreen(const FString& Top, const FString& Main, const FLinearColor& Colour)
{
	UTextureRenderTarget2D* Target = Arena ? Arena->GetStageScreen() : nullptr;
	if (!Target) { return; }
	UCanvas* Canvas = nullptr;
	FVector2D Size;
	FDrawToRenderTargetContext Context;
	UKismetRenderingLibrary::BeginDrawCanvasToRenderTarget(this, Target, Canvas, Size, Context);
	if (Canvas)
	{
		CpvUi::Fill(Canvas, 0.f, 0.f, Size.X, Size.Y, FLinearColor(0.012f, 0.014f, 0.05f));
		for (int32 i = 0; i < 9; ++i)   // sunburst stripes
		{
			const float X = Size.X * 0.5f, Y = Size.Y * 1.25f;
			const float A0 = -UE_PI + UE_PI * (i * 2) / 18.f, A1 = -UE_PI + UE_PI * (i * 2 + 1) / 18.f;
			CpvUi::Quad(Canvas, FVector2D(X, Y), FVector2D(X + FMath::Cos(A0) * 1400.f, Y + FMath::Sin(A0) * 1400.f),
				FVector2D(X + FMath::Cos(A1) * 1400.f, Y + FMath::Sin(A1) * 1400.f), FVector2D(X, Y), FLinearColor(Colour.R, Colour.G, Colour.B, 0.16f));
		}
		CpvUi::Text(Canvas, Top, Size.X * 0.5f, 110.f, CpvUi::Font(ECpvFont::Impact, 76.f, 40), FLinearColor::White, ECpvAlign::Center);
		float Pt = 190.f;
		while (Pt > 60.f && CpvUi::Measure(Main, CpvUi::Font(ECpvFont::Title, Pt)).X > Size.X - 80.f) { Pt -= 8.f; }
		CpvUi::Outlined(Canvas, Main, Size.X * 0.5f, 215.f + (190.f - Pt) * 0.4f, CpvUi::Font(ECpvFont::Title, Pt), Colour, FLinearColor(0.02f, 0.02f, 0.05f), 7.f, ECpvAlign::Center);
		CpvUi::Fill(Canvas, 0.f, Size.Y - 64.f, Size.X, 64.f, FLinearColor(Colour.R, Colour.G, Colour.B, 0.9f));
		CpvUi::Text(Canvas, TEXT("LIVE  *  FAMOUS LAST BLOWS  *  LIVE"), Size.X * 0.5f, Size.Y - 56.f, CpvUi::Font(ECpvFont::Impact, 40.f, 60), FLinearColor(0.02f, 0.02f, 0.05f), ECpvAlign::Center);
	}
	UKismetRenderingLibrary::EndDrawCanvasToRenderTarget(this, Context);
}
