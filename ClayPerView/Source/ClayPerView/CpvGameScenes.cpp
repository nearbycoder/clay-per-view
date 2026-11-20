// Scripted set pieces: entrances, Curtain Call finishers and the victory scene.

#include "CpvGame.h"
#include "ClayPerView.h"
#include "CpvArena.h"
#include "CpvFighter.h"
#include "CpvFx.h"
#include "CpvPuppet.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"

namespace
{
	float YawOf2D(const FVector2D& D) { return FMath::RadiansToDegrees(FMath::Atan2(D.Y, D.X)); }
	float EaseIn(float U) { return U * U; }
	float EaseOut(float U) { return 1.f - (1.f - U) * (1.f - U); }
}

void ACpvGameMode::Tween(float Duration, TFunction<void(float)> Fn)
{
	FCpvTween T;
	T.Life = FMath::Max(Duration, 0.001f);
	T.Fn = MoveTemp(Fn);
	Tweens.Add(MoveTemp(T));
}

void ACpvGameMode::TickTweens(float Dt)
{
	for (int32 i = 0; i < Tweens.Num(); ++i)
	{
		Tweens[i].Age += Dt;
		const float U = FMath::Clamp(Tweens[i].Age / Tweens[i].Life, 0.f, 1.f);
		Tweens[i].Fn(U);
	}
	Tweens.RemoveAll([](const FCpvTween& T) { return T.Age >= T.Life; });
}

void ACpvGameMode::HideProps()
{
	for (UStaticMeshComponent* Comp : PropPool) { Comp->SetVisibility(false); }
	Weapons.Reset();
	Projectiles.Reset();
	Tweens.Reset();
	if (LooseHead) { LooseHead->bHidden = true; }
}

// ---------------------------------------------------------------------------------------------
// Entrances
// ---------------------------------------------------------------------------------------------

void ACpvGameMode::StartIntro()
{
	SetPhase(ECpvPhase::Intro);
	BuildIntro();
}

void ACpvGameMode::BuildIntro()
{
	Seq.Reset();
	Arena->SetMood(ECpvLightMood::Entrance, 0.8f);
	Letterbox = 1.f;
	for (int32 i = 0; i < 2; ++i) { Fighters[i]->bHidden = true; }
	const FVector Door = Arena->StageDoor + FVector(40.0, 0.0, 0.0);
	const FVector Lip = Arena->StageFront;
	const FVector Down = FMath::Lerp(Arena->StageFront, Arena->RampBottom, 0.3f);
	const FVector Foot = Arena->RampBottom;

	for (int32 i = 0; i < 2; ++i)
	{
		const float T0 = i * 4.2f;
		ACpvFighter* F = Fighters[i];
		Seq.At(T0, [this, F, Door, Lip, Down, Foot, i]()
		{
			const FCpvFighterDef& Def = F->Def();
			Fighters[1 - i]->bHidden = true;
			F->bHidden = false;
			F->SetActorLocationAndRotation(Door, FRotator::ZeroRotator);
			F->UpdateMirror();
			F->Play(TEXT("Strut"), 0.f);
			F->ForceStep();
			NameCard = Def.Name;
			NameCardSub = Def.Title;
			NameCardAge = 0.f;
			DrawStageScreen(TEXT("NOW ENTERING"), Def.Name, Def.Colour);
			PlaySound(FName(*FString::Printf(TEXT("Theme_%s"), Def.VoiceId)), 0.58f);
			PlaySound(FName(*FString::Printf(TEXT("VO_Name_%s"), Def.VoiceId)));
			PlaySound("Pyro");
			PlaySound("Cheer", 0.9f);
			Arena->CrowdPop(0.7f);
			Arena->Flash(0.5f);
			for (const FVector& Pot : Arena->PyroPoints) { Fx->Flames(Pot, FVector(0.0, 0.0, 1.0), 6, 700.f); }
			// Open on the whole arena, then pick the first star up on the ramp.
			if (i == 0)
			{
				CutTo(FVector(1160, 1650, 910), FVector(-440, -100, 105), 62.f);
				MoveTo(FVector(1050, 1520, 840), FVector(-470, -90, 115), 58.f, 1.3f);
			}
			else
			{
				CutTo(Foot + FVector(-40, -135, 92), Door + FVector(120, 0, 130), 36.f);
				MoveTo(Foot + FVector(80, -48, 72), Down + FVector(0, 0, 112), 39.f, 0.8f);
			}
			// Walk out of the tunnel, across the stage and a little way down the ramp.
			Tween(2.5f, [F, Door, Lip, Down](float U)
			{
				const FVector P = U < 0.62f ? FMath::Lerp(Door, Lip, U / 0.62f) : FMath::Lerp(Lip, Down, (U - 0.62f) / 0.38f);
				F->SetActorLocation(P);
			});
		});
		if (i == 0)
		{
			Seq.At(1.05f, [this, Foot, Down]()
			{
				CutTo(Foot + FVector(70, 180, 110), Down + FVector(-175, 0, 116), 39.f);
				MoveTo(Foot + FVector(90, 40, 78), Down + FVector(0, 0, 112), 40.f, 1.1f);
			});
		}
		Seq.At(T0 + 0.5f, [this]() { for (const FVector& Pot : Arena->PyroPoints) { Fx->Flames(Pot, FVector(0.0, 0.0, 1.0), 5, 760.f); } });
		Seq.At(T0 + 1.0f, [this]() { for (const FVector& Pot : Arena->PyroPoints) { Fx->Flames(Pot, FVector(0.0, 0.0, 1.0), 5, 820.f); Fx->Stars(Pot + FVector(0.0, 0.0, 120.0), 4); } });
		Seq.At(T0 + 2.5f, [this, F]()
		{
			F->Play(F->Def().Taunt, 0.12f);
			Arena->CrowdPop(0.5f);
		});
	}
	Seq.At(8.4f, [this]() { FadeOut = 1.f; });
	Seq.At(8.6f, [this]()
	{
		FadeOut = 0.f;
		NameCard.Reset();
	});
}

// ---------------------------------------------------------------------------------------------
// Victory
// ---------------------------------------------------------------------------------------------

void ACpvGameMode::BuildMatchEnd()
{
	Seq.Reset();
	ACpvFighter* W = Fighters[Winner];
	ACpvFighter* L = Fighters[1 - Winner];
	if (bWonByPin) { L->SetScripted(true); L->Play(TEXT("DownBack"), 0.16f); }
	else if (L->GetState() != ECpvState::Dead) { L->Kill(true); }
	W->SetScripted(false);
	W->Celebrate();
	W->SetActorRotation(FRotator(0.f, 90.f, 0.f)); // face the broadcast camera
	W->UpdateMirror();
	Letterbox = 0.f;
	FinisherPrompt = 0.f;
	Arena->SetMood(ECpvLightMood::Show, 1.f);
	Arena->SetHype(1.f);
	Arena->CrowdPop(1.f);
	Arena->Flash(0.6f);
	Fx->Confetti(140);
	ConfettiClock = 0.4f;
	PlaySound("Bell");
	PlaySound("Fanfare");
	PlaySound("Cheer", 1.f);
	const bool bChampion = IsRun() && Episode == 2 && Winner == 0;
	if (bChampion)
	{
		W->SetHandProp(nullptr, FVector::ZeroVector);
		if (UStaticMeshComponent* Title = TakeProp(TEXT("/Game/CPV/Props/SM_Belt.SM_Belt")))
		{
			// Two hands support the strap while the face of the medal stays level for the camera.
			Tween(7.2f, [W, Title](float)
			{
				const FVector Left = W->GetBoneLocation(ECpvBone::HandL);
				const FVector Right = W->GetBoneLocation(ECpvBone::HandR);
				Title->SetWorldLocationAndRotation((Left + Right) * 0.5 + FVector(0, 5, 9), FRotator(0, 90, 0));
			});
		}
	}
	PlaySound(bChampion ? "VO_Champ" : "VO_Wrap");
	ShowBanner(bChampion ? TEXT("CHAMPION!") : TEXT("THAT'S A WRAP!"), FString(W->Def().Name) + TEXT(" WINS"), 4.5f, W->Def().Colour, 1.1f);
	DrawStageScreen(bChampion ? TEXT("PRIME TIME CHAMPION") : TEXT("YOUR WINNER"), W->Def().Name, W->Def().Colour);
	const FVector At = W->GetActorLocation();
	CutTo(At + FVector(-300.0, 760.0, 260.0), At + FVector(0.0, 0.0, 108.0), 38.f);
	MoveTo(At + FVector(300.0, 700.0, 280.0), At + FVector(0.0, 0.0, 110.0), 36.f, 0.3f);
	if (bChampion)
	{
		const FVector Aim = At + FVector(0,0,164);
		Seq.At(1.1f, [this, At, Aim]()
		{
			CutTo(At + FVector(-95,500,205), Aim, 35.f);
			MoveTo(At + FVector(45,460,210), Aim, 33.f, 0.6f);
		});
	}
	const float NameCue = FMath::Max(1.7f, DuckLeft);
	Seq.At(NameCue, [this, W]() { PlaySound(FName(*FString::Printf(TEXT("VO_Win_%s"), W->Def().VoiceId))); });
	Seq.At(NameCue + 0.3f, [this, W]() { Say(TEXT("win"), 1.f, W->Def().Name); });
	Seq.At(6.5f, []() {});
}

// ---------------------------------------------------------------------------------------------
// Curtain Calls
// ---------------------------------------------------------------------------------------------

bool ACpvGameMode::TryStartFinisher(ACpvFighter* Attacker)
{
	ACpvFighter* Victim = Attacker->GetFoe();
	if (Phase != ECpvPhase::Fight || !Victim || Victim->GetState() != ECpvState::Dazed) { return false; }
	if (Attacker->DistanceTo(Victim) > 280.f) { return false; }
	BuildFinisher(Attacker, Victim);
	return true;
}

void ACpvGameMode::FinisherBoom(ACpvFighter* Victim, int32 Chunks, float Size)
{
	const FVector At = Victim->GetActorLocation() + Victim->VisualOffset + FVector(0.0, 0.0, 95.0);
	const FCpvFighterDef& Def = Victim->Def();
	for (int32 i = 0; i < 6; ++i)
	{
		Fx->Blobs(At, FVector(FMath::Cos(i * 1.05f), FMath::Sin(i * 1.05f), 0.4), Chunks / 6, Def.Clay, Def.Clay2, 620.f * Size);
	}
	Fx->Teeth(At + FVector(0.0, 0.0, 50.0), FVector(0.0, 0.0, 1.0), 5);
	Fx->Puff(At, 2.4f * Size, 8);
	Fx->Stars(At, 10);
	for (int32 i = 0; i < 9; ++i)
	{
		Fx->Splat(Victim->GetActorLocation() + FVector(FMath::FRandRange(-130.f, 130.f), FMath::FRandRange(-130.f, 130.f), 0.0), FMath::FRandRange(0.9f, 1.8f),
			FMath::FRand() < 0.6f ? Def.Clay : Def.Clay2);
	}
	Arena->Flash(1.f);
	Arena->CrowdPop(1.f);
	Shake(32.f * Size);
	PlaySound("Splat");
	PlaySound("Cheer", 1.f);
	SlowLeft = 0.7f;
	CommentatorsReact("SitShock");
}

void ACpvGameMode::BuildFinisher(ACpvFighter* A, ACpvFighter* V)
{
	if (IsRun() && Episode == 2 && A->Slot == 0) { FulfillCrowdCall(); }
	SetPhase(ECpvPhase::Finisher);
	Winner = A->Slot;
	Seq.Reset();
	Tweens.Reset();
	FinisherPrompt = 0.f;
	FinisherFor = -1;
	SlowLeft = 0.f;
	Letterbox = 1.f;
	for (FMatWeapon& W : Weapons) { ReturnProp(W.Comp); }
	Weapons.Reset();
	A->DropWeapon(false);
	A->SetScripted(true);
	V->SetScripted(true);
	V->Play(TEXT("Dazed"), 0.1f);

	// Stand the attacker a pace in front of the victim, inside the ropes.
	FVector2D Dir = (V->Pos2D() - A->Pos2D()).GetSafeNormal();
	if (Dir.IsNearlyZero()) { Dir = FVector2D(1.0, 0.0); }
	const float Limit = Arena->RingLimit() - 20.f;
	FVector2D Vp = V->Pos2D();
	Vp.X = FMath::Clamp(Vp.X, -Limit + 60.f, Limit - 60.f);
	Vp.Y = FMath::Clamp(Vp.Y, -Limit + 80.f, Limit - 80.f);
	FVector2D Ap = Vp - Dir * 125.0;
	Ap.X = FMath::Clamp(Ap.X, -Limit, Limit);
	Ap.Y = FMath::Clamp(Ap.Y, -Limit, Limit);
	Dir = (Vp - Ap).GetSafeNormal();
	V->SetActorLocationAndRotation(FVector(Vp.X, Vp.Y, 0.0), FRotator(0.f, YawOf2D(-Dir), 0.f));
	A->SetActorLocationAndRotation(FVector(Ap.X, Ap.Y, 0.0), FRotator(0.f, YawOf2D(Dir), 0.f));
	A->UpdateMirror();
	V->UpdateMirror();
	A->Play(TEXT("Idle"), 0.1f);
	const FVector Av(Ap.X, Ap.Y, 0.0), Vv(Vp.X, Vp.Y, 0.0), Mid = (Av + Vv) * 0.5;
	const FVector D3(Dir.X, Dir.Y, 0.0);

	const FCpvFighterDef& Def = A->Def();
	ShowBanner(Def.FinisherName, TEXT("CURTAIN CALL"), 2.2f, Def.Colour, 1.f);
	MoveCallout[0].Reset();
	MoveCallout[1].Reset();
	Arena->SetMood(ECpvLightMood::Drama, 0.4f);
	Arena->CrowdPop(0.8f);
	PlaySound("Swell");
	Say(TEXT("finisher"), 1.f, Def.Name);
	CutTo(Mid + FVector(0.0, 860.0, 280.0), Mid + FVector(0.0, 0.0, 100.0), 40.f);
	MoveTo(Mid + FVector(0.0, 760.0, 260.0), Mid + FVector(0.0, 0.0, 102.0), 38.f, 1.0f);
	V->SetFace(ECpvFace::Dazed, 30.f);
	float End = 4.4f;

	switch (Def.Finisher)
	{
	case ECpvFinisher::Explode:
	{
		// Feed them the bomb, stroll away, do not look back.
		UStaticMeshComponent* Bomb = TakeProp(TEXT("/Game/CPV/Props/SM_Bomb.SM_Bomb"));
		Bomb->SetVisibility(false);
		Seq.At(0.5f, [A]() { A->Play(TEXT("Throw"), 0.08f, 1.1f); });
		Seq.At(0.82f, [this, V, Bomb, D3]()
		{
			Bomb->SetVisibility(true);
			Bomb->SetWorldLocation(V->GetHeadLocation() - D3 * 17.0 + FVector(0.0, 0.0, -8.0));
			V->SetFace(ECpvFace::Shock, 30.f);
			PlaySound("Pop");
		});
		Seq.At(1.25f, [this, A, Dir, Av, Vv, D3]()
		{
			A->SetActorRotation(FRotator(0.f, YawOf2D(-Dir), 0.f));
			A->UpdateMirror();
			A->Play(TEXT("Strut"), 0.12f);
			A->SetFace(ECpvFace::Smug, 6.f);
			const FVector To = Av - D3 * 150.0;
			Tween(1.9f, [A, Av, To](float U) { A->SetActorLocation(FMath::Lerp(Av, To, U)); });
			CutTo(To - D3 * 620.0 + FVector(0.0, 90.0, 250.0), Vv + FVector(0.0, 0.0, 100.0), 34.f);
		});
		for (int32 k = 0; k < 4; ++k)
		{
			Seq.At(1.5f + 0.32f * k, [this, k, Bomb]() { PlaySound("Tick", 1.f, 1.f + 0.18f * k); Fx->Stars(Bomb->GetComponentLocation() + FVector(0.0, 0.0, 30.0), 2); });
		}
		Seq.At(2.9f, [this, V, Bomb]()
		{
			Fx->Explosion(V->GetActorLocation() + FVector(0.0, 0.0, 110.0), 1.7f);
			PlaySound("Explosion");
			FinisherBoom(V, 66, 1.2f);
			V->bHidden = true;
			ReturnProp(Bomb);
		});
		Seq.At(3.7f, [A]() { A->Play(TEXT("TauntFlex"), 0.15f); });
		End = 5.0f;
		break;
	}
	case ECpvFinisher::MicDrop:
	{
		UStaticMeshComponent* Mic = TakeProp(TEXT("/Game/CPV/Props/SM_GiantMic.SM_GiantMic"));
		Mic->SetVisibility(false);
		Seq.At(0.45f, [this, A, Mid]()
		{
			A->Play(TEXT("TauntPoint"), 0.1f);
			MoveTo(Mid + FVector(0.0, 1050.0, 60.0), Mid + FVector(0.0, 0.0, 300.0), 50.f, 2.5f);
		});
		Seq.At(1.3f, [this, V, Mic, Vv]()
		{
			Mic->SetVisibility(true);
			PlaySound("Whoosh", 1.f, 0.5f);
			V->SetFace(ECpvFace::Shock, 30.f);
			Tween(0.5f, [Mic, Vv](float U) { Mic->SetWorldLocationAndRotation(Vv + FVector(0.0, 0.0, FMath::Lerp(1000.0, 0.0, EaseIn(U))), FRotator::ZeroRotator); });
		});
		Seq.At(1.8f, [this, V, Mic, Vv]()
		{
			V->VisualScale = FVector(2.0, 2.0, 0.045);
			V->Play(TEXT("DownBack"), 0.f);
			V->ForceStep();
			OnSlam(Vv, 2.2f);
			PlaySound("Explosion", 0.8f, 0.7f);
			FinisherBoom(V, 42, 1.f);
			Fx->Impact(Vv + FVector(0.0, 60.0, 150.0), ECpvWord::Splat, 3.f, FLinearColor(1.f, 0.85f, 0.2f));
			Tween(0.5f, [Mic, Vv](float U) { Mic->SetWorldLocationAndRotation(Vv + FVector(0.0, 0.0, 6.0 * FMath::Sin(U * 9.f) * (1.f - U)), FRotator(0.f, 0.f, 9.f * EaseOut(U))); });
		});
		Seq.At(2.6f, [this, A, Av]()
		{
			A->Play(TEXT("TauntDance"), 0.12f);
			MoveTo(Av + FVector(80.0, 720.0, 260.0), Av + FVector(40.0, 0.0, 106.0), 38.f, 2.f);
		});
		End = 4.4f;
		break;
	}
	case ECpvFinisher::RollingPin:
	{
		Seq.At(0.4f, [A]()
		{
			A->SetHandProp(TEXT("/Game/CPV/Props/SM_RollingPin.SM_RollingPin"), FVector(0.0, -58.0, 0.0), FRotator(0.f, -90.f, 0.f));
		});
		for (int32 k = 0; k < 2; ++k)
		{
			const float T0 = 0.6f + k * 0.95f;
			Seq.At(T0, [A]() { A->Play(TEXT("WeaponSmash"), 0.08f); });
			Seq.At(T0 + 0.37f, [this, V, Vv, k]()
			{
				V->VisualScale = k == 0 ? FVector(1.5, 1.5, 0.4) : FVector(2.2, 2.2, 0.04);
				V->Play(TEXT("DownBack"), 0.f);
				V->ForceStep();
				OnSlam(Vv, 1.5f + k * 0.6f);
				PlaySound("Bonk", 1.f, 0.8f);
				Fx->Impact(Vv + FVector(0.0, 40.0, 130.0), k == 0 ? ECpvWord::Crunch : ECpvWord::Splat, 2.4f, FLinearColor(1.f, 0.85f, 0.2f));
				if (k == 1) { FinisherBoom(V, 30, 0.9f); }
			});
		}
		Seq.At(2.6f, [this, A, V]()
		{
			A->SetHandProp(nullptr);
			A->Play(TEXT("TauntKiss"), 0.12f);
			// Toss the "pizza".
			Tween(1.1f, [V](float U)
			{
				V->VisualOffset.Z = 230.f * FMath::Sin(U * UE_PI);
				V->VisualYaw = 900.f * U;
			});
			PlaySound("Whoosh", 0.9f, 0.9f);
		});
		Seq.At(3.7f, [this, Vv]() { OnSlam(Vv, 0.7f); });
		End = 4.8f;
		break;
	}
	case ECpvFinisher::Rocket:
	{
		UStaticMeshComponent* Rocket = TakeProp(TEXT("/Game/CPV/Props/SM_Rocket.SM_Rocket"));
		Rocket->SetVisibility(false);
		const FVector Pad = Vv + D3 * 34.0;
		Seq.At(0.45f, [A]() { A->Play(TEXT("TauntPhone"), 0.1f); });
		Seq.At(1.2f, [this, V, Rocket, Pad, Dir]()
		{
			Rocket->SetVisibility(true);
			Rocket->SetWorldLocationAndRotation(Pad, FRotator::ZeroRotator);
			Fx->Puff(Pad + FVector(0.0, 0.0, 60.0), 2.2f, 7);
			PlaySound("Pop");
			V->SetFace(ECpvFace::Shock, 30.f);
			V->Play(TEXT("ClinchV"), 0.1f);   // hanging on for dear life
			V->VisualOffset.Z = 46.f;
		});
		for (int32 k = 0; k < 3; ++k)
		{
			Seq.At(1.75f + 0.34f * k, [this, k, Pad]()
			{
				PlaySound("Tick", 1.f, 0.9f + 0.2f * k);
				Fx->Flames(Pad + FVector(0.0, 0.0, 12.0), FVector(0.0, 0.0, -1.0), 3, 240.f);
				Fx->Puff(Pad, 1.2f, 2);
			});
		}
		Seq.At(2.8f, [this, V, Rocket, Pad, Mid]()
		{
			PlaySound("Rocket");
			Shake(18.f);
			MoveTo(Mid + FVector(0.0, 1200.0, 80.0), Pad + FVector(0.0, 0.0, 650.0), 56.f, 2.2f);
			Tween(1.05f, [this, V, Rocket, Pad](float U)
			{
				const float Z = 1500.f * EaseIn(U);
				Rocket->SetWorldLocation(Pad + FVector(0.0, 0.0, Z));
				V->VisualOffset.Z = 46.f + Z;
				Fx->Flames(Pad + FVector(0.0, 0.0, Z + 8.0), FVector(0.0, 0.0, -1.0), 2, 420.f);
				Shake(6.f);
			});
		});
		Seq.At(3.9f, [this, V, Rocket, Pad]()
		{
			const FVector Sky = Pad + FVector(0.0, 0.0, 1480.0);
			Fx->Explosion(Sky, 2.6f);
			for (int32 i = 0; i < 5; ++i)
			{
				Fx->Blobs(Sky, FVector(FMath::Cos(i * 1.26f), FMath::Sin(i * 1.26f), 0.2), 12, V->Def().Clay, V->Def().Clay2, 700.f, false);
			}
			Fx->Stars(Sky, 16);
			PlaySound("Explosion");
			Arena->Flash(1.f);
			Arena->CrowdPop(1.f);
			Shake(20.f);
			PlaySound("Cheer", 1.f);
			V->bHidden = true;
			ReturnProp(Rocket);
			SlowLeft = 0.6f;
		});
		Seq.At(4.5f, [this, A, Av]()
		{
			A->Play(TEXT("TauntPhone"), 0.15f);
			MoveTo(Av + FVector(60.0, 720.0, 260.0), Av + FVector(20.0, 0.0, 106.0), 38.f, 3.f);
		});
		End = 5.8f;
		break;
	}
	case ECpvFinisher::Speaker:
	{
		UStaticMeshComponent* Stack = TakeProp(TEXT("/Game/CPV/Props/SM_GiantSpeaker.SM_GiantSpeaker"));
		Stack->SetVisibility(false);
		const FVector Spot = Av - D3 * 150.0;
		const FRotator Face(0.f, YawOf2D(Dir), 0.f);
		Seq.At(0.45f, [A]() { A->Play(TEXT("TauntDance"), 0.1f); });
		Seq.At(0.9f, [this, Stack, Spot, Face]()
		{
			Stack->SetVisibility(true);
			Tween(0.4f, [Stack, Spot, Face](float U) { Stack->SetWorldLocationAndRotation(Spot + FVector(0.0, 0.0, 800.0 * (1.f - EaseIn(U))), Face); });
		});
		Seq.At(1.3f, [this, Spot]() { OnSlam(Spot, 2.f); });
		Seq.At(1.6f, [this, A, V, Av, Vv, D3]()
		{
			A->Play(TEXT("SpecSlam"), 0.1f, 0.9f);
			V->SetFace(ECpvFace::Shock, 30.f);
		});
		Seq.At(2.2f, [this, V, Vv, Av, D3]()
		{
			PlaySound("BassDrop");
			Tween(1.3f, [this, V, Vv, Av, D3](float U)
			{
				// The victim rattles apart.
				const float Rattle = 4.f + 14.f * U;
				V->VisualOffset = FVector(FMath::FRandRange(-Rattle, Rattle), FMath::FRandRange(-Rattle, Rattle), 0.0);
				V->VisualScale = FVector(1.0 + 0.12 * FMath::Sin(U * 80.f), 1.0 + 0.12 * FMath::Cos(U * 70.f), 1.0 - 0.1 * FMath::Sin(U * 90.f));
				Shake(7.f + 10.f * U);
				if (FMath::FRand() < 0.4f) { Fx->Ring(Av + D3 * (40.0 + 160.0 * FMath::FRand()) + FVector(0.0, 0.0, 100.0), 1.6f, FLinearColor(0.5f, 0.2f, 1.f)); }
				if (FMath::FRand() < 0.3f) { Fx->Blobs(Vv + FVector(0.0, 0.0, 110.0), D3, 2, V->Def().Clay, V->Def().Clay2, 300.f); }
			});
		});
		Seq.At(2.85f, [this]() { PlaySound("BassDrop", 1.f, 1.2f); });
		Seq.At(3.5f, [this, V]()
		{
			FinisherBoom(V, 72, 1.3f);
			PlaySound("Explosion", 0.9f, 1.2f);
			V->bHidden = true;
		});
		Seq.At(4.1f, [A]() { A->Play(TEXT("TauntDance"), 0.15f); });
		End = 5.4f;
		break;
	}
	case ECpvFinisher::HeadPop:
	{
		Seq.At(0.4f, [A]()
		{
			A->SetHandProp(TEXT("/Game/CPV/Props/SM_Scepter.SM_Scepter"), FVector(0.0, 0.0, 12.0));
			A->Play(TEXT("WeaponSwing"), 0.1f, 0.5f);
		});
		Seq.At(0.9f, [this, A, V, Vv, D3, Mid]()
		{
			// The head leaves; the body has not noticed yet.
			const FVector HeadAt = V->GetHeadLocation();
			PlaySound("Pop");
			PlaySound("Heavy");
			Fx->Impact(HeadAt, ECpvWord::Bonk, 2.2f, FLinearColor(1.f, 0.85f, 0.2f));
			Fx->Blobs(HeadAt - FVector(0.0, 0.0, 20.0), FVector(0.0, 0.0, 1.0), 16, V->Def().Clay, V->Def().Clay2, 420.f);
			Fx->Stars(HeadAt, 8);
			Shake(22.f);
			Arena->Flash(0.8f);
			Arena->CrowdPop(1.f);
			SlowLeft = 0.5f;
			for (ECpvBone B : { ECpvBone::Head, ECpvBone::LidL, ECpvBone::LidR, ECpvBone::PupilL, ECpvBone::PupilR, ECpvBone::BrowL, ECpvBone::BrowR,
				ECpvBone::MouthClosed, ECpvBone::MouthGrit, ECpvBone::MouthOpen, ECpvBone::MouthOuch, ECpvBone::MouthGrin, ECpvBone::Hair, ECpvBone::Tail })
			{
				V->BoneScale[static_cast<int32>(B)] = 0.001f;
			}
			if (!LooseHead) { LooseHead = GetWorld()->SpawnActor<ACpvPuppet>(); }
			LooseHead->SetCharacter(V->GetCharacterName());
			for (int32 i = 0; i < static_cast<int32>(ECpvBone::Count); ++i) { LooseHead->BoneScale[i] = 0.001f; }
			for (ECpvBone B : { ECpvBone::Head, ECpvBone::LidL, ECpvBone::LidR, ECpvBone::PupilL, ECpvBone::PupilR, ECpvBone::BrowL, ECpvBone::BrowR,
				ECpvBone::MouthOpen, ECpvBone::Hair, ECpvBone::Tail })
			{
				LooseHead->BoneScale[static_cast<int32>(B)] = 1.f;
			}
			LooseHead->bHidden = false;
			LooseHead->Play(TEXT("Stand"), 0.f);
			LooseHead->SetFace(ECpvFace::Shock, 30.f);
			LooseHead->SetActorLocationAndRotation(Vv, V->GetActorRotation());
			ACpvPuppet* Head = LooseHead;
			const FVector Land = Vv + D3 * 900.0 + FVector(0.0, -500.0, -60.0);   // somewhere up in the far stands
			Tween(1.5f, [Head, Vv, Land](float U)
			{
				Head->SetActorLocation(FMath::Lerp(Vv, Land, U) + FVector(0.0, 0.0, 520.0 * FMath::Sin(U * UE_PI)));
				Head->VisualYaw = 1300.f * U;
				Head->ForceStep();
			});
			MoveTo(Mid + FVector(0.0, 1000.0, 260.0), Land + FVector(0.0, 0.0, 200.0), 50.f, 1.6f);
		});
		Seq.At(1.9f, [V]() { V->Play(TEXT("Collapse"), 0.1f); });
		Seq.At(2.4f, [this, Vv]()
		{
			PlaySound("Cheer", 1.f);
			Arena->CrowdPop(1.f);
			OnSlam(Vv, 0.8f);
			if (LooseHead) { LooseHead->bHidden = true; }
		});
		Seq.At(2.7f, [this, A, Av]()
		{
			A->SetHandProp(nullptr);
			A->Play(TEXT("TauntWave"), 0.15f);
			MoveTo(Av + FVector(50.0, 720.0, 260.0), Av + FVector(10.0, 0.0, 108.0), 38.f, 2.4f);
		});
		End = 4.6f;
		break;
	}
	case ECpvFinisher::Encore:
	{
		const float Bury = V->GetHeight() - 46.f;
		Seq.At(0.35f, [A]() { A->GiveWeapon(ECpvWeapon::Guitar, 99); });
		for (int32 k = 0; k < 3; ++k)
		{
			const float T0 = 0.55f + k * 0.8f;
			Seq.At(T0, [A]() { A->Play(TEXT("WeaponSmash"), 0.06f, 1.1f); });
			Seq.At(T0 + 0.33f, [this, A, V, Vv, k, Bury]()
			{
				// Each chord drives them further into the canvas, like a nail.
				V->VisualOffset.Z = -Bury * (k + 1) / 3.f;
				V->HeadSquash = FVector2f(1.18f, 0.8f);
				V->SetFace(ECpvFace::Hurt, 0.5f);
				V->ForceStep();
				OnSlam(Vv, 1.3f + 0.3f * k);
				PlaySound("Guitar", 1.f, 1.f + 0.1f * k);
				Fx->Impact(Vv + FVector(0.0, 40.0, 180.0 - 40.0 * k), k == 2 ? ECpvWord::Crunch : ECpvWord::Bam, 2.2f, FLinearColor(1.f, 0.85f, 0.2f));
				Fx->Blobs(Vv + FVector(0.0, 0.0, 30.0), FVector(0.0, 0.0, 1.0), 10, V->Def().Clay, FLinearColor(0.9f, 0.88f, 0.82f), 420.f);
				if (k == 2)
				{
					A->DropWeapon(true);
					Arena->Flash(1.f);
					Arena->CrowdPop(1.f);
					PlaySound("Cheer", 1.f);
					SlowLeft = 0.6f;
				}
			});
			Seq.At(T0 + 0.6f, [V]() { V->HeadSquash = FVector2f(1.f, 1.f); });
		}
		Seq.At(3.1f, [this, A, V, Vv]()
		{
			A->Play(TEXT("TauntRock"), 0.12f);
			V->SetFace(ECpvFace::Dazed, 30.f);
			MoveTo(Vv + FVector(40.0, 470.0, 230.0), Vv + FVector(-20.0, 0.0, 60.0), 36.f, 2.f);
		});
		End = 4.8f;
		break;
	}
	case ECpvFinisher::Shrink:
	{
		Seq.At(0.4f, [A]() { A->Play(TEXT("SpecCast"), 0.1f); });
		Seq.At(0.95f, [this, V, Vv]()
		{
			PlaySound("Zap", 1.f, 1.4f);
			Fx->Puff(Vv + FVector(0.0, 0.0, 100.0), 2.2f, 7, FLinearColor(0.6f, 0.45f, 1.f));
			Fx->Stars(Vv + FVector(0.0, 0.0, 120.0), 10);
			Arena->Flash(0.6f);
			V->SetFace(ECpvFace::Shock, 30.f);
			Tween(0.55f, [V](float U)
			{
				const float S = FMath::Lerp(1.f, 0.17f, EaseOut(U)) * (1.f + 0.2f * FMath::Sin(U * 30.f) * (1.f - U));
				V->VisualScale = FVector(S);
			});
		});
		Seq.At(1.6f, [this, V]()
		{
			PlaySound("Squeak", 1.f, 1.5f);
			V->Play(TEXT("WhipRun"), 0.1f, 1.6f);
		});
		Seq.At(1.9f, [this, A, Av, Vv, D3]()
		{
			A->Play(TEXT("Strut"), 0.12f);
			const FVector To = Vv - D3 * 44.0;
			Tween(0.75f, [A, Av, To](float U) { A->SetActorLocation(FMath::Lerp(Av, To, U)); });
			MoveTo(Vv + FVector(0.0, 500.0, 240.0), Vv + FVector(0.0, 0.0, 55.0), 36.f, 2.4f);
		});
		Seq.At(2.7f, [A]() { A->Play(TEXT("Stomp"), 0.08f); });
		Seq.At(2.97f, [this, V, Vv]()
		{
			V->bHidden = true;
			Fx->Impact(Vv + FVector(0.0, 30.0, 70.0), ECpvWord::Splat, 2.4f, FLinearColor(1.f, 0.85f, 0.2f));
			Fx->Splat(Vv, 2.6f, V->Def().Clay);
			Fx->Blobs(Vv + FVector(0.0, 0.0, 10.0), FVector(0.0, 0.0, 1.0), 18, V->Def().Clay, V->Def().Clay2, 380.f);
			PlaySound("Splat");
			PlaySound("Cheer", 1.f);
			Shake(16.f);
			Arena->Flash(0.8f);
			Arena->CrowdPop(1.f);
			SlowLeft = 0.5f;
			CommentatorsReact("SitShock");
		});
		Seq.At(3.6f, [A]() { A->Play(TEXT("TauntMystic"), 0.15f); });
		End = 5.0f;
		break;
	}
	}
	Seq.At(End, [V]() { V->Kill(true); });
}
