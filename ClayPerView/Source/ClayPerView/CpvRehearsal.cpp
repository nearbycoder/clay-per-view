// The coaching partner uses the same input, hit detection and grapple rules as a live opponent.
#include "CpvGame.h"
#include "ClayPerView.h"
#include "CpvArena.h"
#include "CpvFighter.h"
#include "CpvFx.h"

void ACpvGameMode::StartRehearsal()
{
	Mode = ECpvMode::Rehearsal;
	Cursor[0] = 0;
	Cursor[1] = 3;
	SpawnFighters(Cursor[0], Cursor[1]);
	Wins[0] = Wins[1] = 0;
	Winner = -1;
	Round = 1;
	HideProps();
	ClearCallouts();
	Fx->Clear(false);
	Seq.bActive = false;
	Tweens.Reset();
	Letterbox = 0.f;
	bRoundOver = false;
	bCamScripted = false;
	StartLoop(MusicComp, "Music_Fight", 0.26f);
	SetPhase(ECpvPhase::Fight);
	Arena->SetMood(ECpvLightMood::Show, 0.7f);
	DrawStageScreen(TEXT("RING SCHOOL"), TEXT("REHEARSAL"), FLinearColor(0.1f, 0.85f, 0.76f));
	SetLesson(0);
}

void ACpvGameMode::SetLesson(int32 Index)
{
	Lesson = Index;
	CueHold = 0.f;
	TrainerClock = 1.8f;
	UE_LOG(LogCpv, Display, TEXT("CPV_REHEARSAL cue=%d"), Index);
	static const FName Voices[] = {"VO_CoachJab", "VO_CoachGuard", "VO_CoachSlam", "VO_CoachSpecial", "VO_CoachWrap"};
	PlaySound(Voices[Index]);
	if (Index == 4)
	{
		Fighters[0]->Celebrate();
		Arena->CrowdPop(0.9f);
		Fx->Confetti(50);
		return;
	}
	const double StartX = Index == 0 ? 115.0 : 45.0;
	for (int32 Slot = 0; Slot < 2; ++Slot)
	{
		Fighters[Slot]->ResetForRound(FVector(Slot == 0 ? -StartX : StartX, 0, 0), Slot == 0 ? 0.f : 180.f);
		Fighters[Slot]->bDazeOnKo = false;
	}
	if (Index == 3) { Fighters[0]->Hype = CpvRule::MaxHype; }
}

void ACpvGameMode::PassCue()
{
	if (CueHold > 0.f) { return; }
	// Let the player see the slam land or the signature fire before the actors take their marks.
	CueHold = Lesson == 3 ? 2.0f : 1.15f;
	PlaySound("Select", 0.75f);
}

FCpvInput ACpvGameMode::TrainerInput(float Dt)
{
	FCpvInput In;
	if (Lesson != 1 || CueHold > 0.f) { return In; }
	const FVector2D To = Fighters[0]->Pos2D() - Fighters[1]->Pos2D();
	if (To.SizeSquared() > FMath::Square(87.0)) { In.Move = To.GetSafeNormal(); }
	else
	{
		TrainerClock -= Dt;
		if (TrainerClock <= 0.f) { In.bLight = true; TrainerClock = 1.9f; }
	}
	return In;
}

void ACpvGameMode::TickRehearsal(float Dt, const FCpvMenuInput& Menu)
{
	if (Lesson == 4)
	{
		StepFighters(Dt, false);
		if (Menu.bOk) { Mode = ECpvMode::RatingsRun; bSkipIntro = false; StartSelect(); }
		return;
	}
	for (ACpvFighter* Star : Fighters) { Star->Health = FMath::Max(Star->Health, 65.f); }
	if (CueHold > 0.f)
	{
		StepFighters(Dt, false);
		CueHold -= Dt;
		if (CueHold <= 0.f) { SetLesson(Lesson + 1); }
	}
	else { StepFighters(Dt, true); }
}
