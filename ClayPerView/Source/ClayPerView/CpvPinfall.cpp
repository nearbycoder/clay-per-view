// Exhibition covers are resolved by the official and a timed shoulder lift from the defending player.
#include "CpvGame.h"
#include "CpvArena.h"
#include "CpvFighter.h"
#include "CpvPuppet.h"
#include "ClayPerView.h"

bool ACpvGameMode::CanCover(const ACpvFighter* Star) const
{
	if (!Star || !bPins || IsRun() || IsRehearsing() || Phase != ECpvPhase::Fight || bRoundOver || PinSlot >= 0 || RefDown > 0.f) { return false; }
	const ACpvFighter* Rival = Star->GetFoe();
	return Star->Weapon == ECpvWeapon::None && Rival && Rival->GetState() == ECpvState::Down && Rival->Health > 0.f
		&& Rival->GetStateTime() > 0.22f && Star->DistanceTo(Rival) < 135.f;
}

bool ACpvGameMode::TryCover(ACpvFighter* Star)
{
	if (!CanCover(Star)) { return false; }
	ACpvFighter* Rival = Star->GetFoe();
	const float Side = Star->Pos2D().X < Rival->Pos2D().X ? -1.f : 1.f;
	const double Limit = Arena->RingLimit() - 104.f;
	const FVector Mark(FMath::Clamp(Rival->Pos2D().X, -Limit, Limit), FMath::Clamp(Rival->Pos2D().Y, -Limit, Limit), 0);
	// Keep the pair on the mat and turn the shoulders toward the hard camera.
	Rival->SetActorLocationAndRotation(Mark, FRotator(0, -74.f, 0));
	Star->SetActorLocationAndRotation(Mark + FVector(46*Side, 15, 0), FRotator(0, Side < 0 ? 8 : 172, 0));
	Star->SetScripted(true); Rival->SetScripted(true);
	Star->UpdateMirror(); Rival->UpdateMirror();
	Star->Play("PinCover", 0.20f); Rival->Play("PinShoulders", 0.20f);
	Referee->SetActorLocationAndRotation(Mark + FVector(-92*Side, -56, 0), FRotator(0, Side < 0 ? 153 : 29, 0));
	Referee->Play("RefCount", 0.18f);
	RefAct = NAME_None;
	PinSlot = Star->Slot; PinCount = 0; PinClock = -0.28f;
	SetEscapeBeat();
	StopVoice();
	SayCooldown = 4.3f;
	Arena->CrowdPop(0.52f);
	PlaySound("Thud", 0.65f);
	UE_LOG(LogCpv, Display, TEXT("CPV_COVER start=%d health=%.1f"), PinSlot, Rival->Health);
	return true;
}

float ACpvGameMode::EscapeStart() const
{
	const float Health = FMath::Clamp(Fighters[1 - PinSlot]->Health / CpvRule::MaxHealth, 0.f, 1.f);
	return 0.63f - (0.075f + 0.19f * Health);
}
float ACpvGameMode::EscapeEnd() const { return 1.26f - EscapeStart(); }
float ACpvGameMode::EscapeNeedle() const { return FMath::Clamp(PinClock - PinCount, 0.f, 1.f); }

void ACpvGameMode::SetEscapeBeat()
{
	bPinMiss = false;
	const float Health = Fighters[1 - PinSlot]->Health / CpvRule::MaxHealth;
	const float Chance = FMath::Clamp(0.14f + Health*0.67f + 0.075f*Difficulty, 0.15f, 0.95f);
	CpuEscapeTime = FMath::FRand() < Chance ? FMath::FRandRange(EscapeStart()+0.025f, EscapeEnd()-0.025f)
		: FMath::FRandRange(0.1f, EscapeStart()-0.04f);
}

void ACpvGameMode::TickCover(float Dt)
{
	const int32 Defender = 1 - PinSlot;
	PinClock += Dt;
	if (PinCount < 3 && PinClock >= PinCount + 1)
	{
		++PinCount;
		PlaySound("Stomp", 0.58f, 1.4f);
		PlaySound(FName(*FString::Printf(TEXT("VO_Count%d"), PinCount)));
		Arena->CrowdPop(0.25f*PinCount);
		UE_LOG(LogCpv, Display, TEXT("CPV_COVER count=%d"), PinCount);
		if (PinCount < 3) { SetEscapeBeat(); }
	}
	if (PinCount == 3)
	{
		Referee->SetClipTime(0.76f);
		if (DuckLeft <= 0.f)
		{
			const int32 W = PinSlot;
			PinSlot = -1;
			bWonByPin = true;
			EndRound(W);
		}
		return;
	}
	// The referee's hand meets the mat at the same instant the number changes.
	Referee->SetClipTime(FMath::Fmod(0.76f + EscapeNeedle(), 1.f));
	const float Needle = EscapeNeedle();
	const bool bPress = IsHuman(Defender) ? ReadPlayer(Defender).bLight : (!Dev.bDummy && Needle >= CpuEscapeTime);
	if (bPinMiss || PinClock < 0.f || !bPress) { return; }
	if (Needle < EscapeStart() || Needle > EscapeEnd()) { bPinMiss = true; return; }
	Fighters[PinSlot]->RecoverFromCover(false);
	Fighters[Defender]->RecoverFromCover(true);
	PinSlot = -1;
	Referee->Play("RefIdle", 0.18f);
	Fighters[Defender]->AddHype(8.f);
	ShowBanner(TEXT("KICK OUT!"), Fighters[Defender]->Def().Name, 1.1f, Fighters[Defender]->Def().Colour, 0.57f);
	PlaySound("Cheer", 0.8f);
	UE_LOG(LogCpv, Display, TEXT("CPV_COVER kickout=%d count=%d"), Defender, PinCount);
}
