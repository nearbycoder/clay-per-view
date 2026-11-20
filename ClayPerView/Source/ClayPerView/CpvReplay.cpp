// Store the existing ringside camera feed on a short loop, then play the deciding seconds back.
#include "CpvArena.h"
#include "CpvGame.h"
#include "CpvHud.h"
#include "ClayPerView.h"
#include "Components/SceneCaptureComponent2D.h"
#include "Engine/Canvas.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Kismet/KismetRenderingLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"

void ACpvArena::StartTape()
{
	TapeCount = TapeNext = 0;
	TapeStart = TapeEnd = NextTapeSample = 0.f;
	bTaping = bFeedEnabled && FeedCapture;
}

void ACpvArena::StopTape()
{
	bTaping = false;
	if (TapeCount < 2) { TapeStart = TapeEnd = 0.f; return; }
	const float Oldest = TapeTimes[TapeCount == TapeCapacity ? TapeNext : 0];
	TapeEnd = TapeTimes[(TapeNext + TapeCapacity - 1) % TapeCapacity];
	TapeStart = FMath::Max(Oldest, TapeEnd - 4.5f);
}

void ACpvArena::DiscardTape()
{
	bTaping = false;
	TapeCount = TapeNext = 0;
	TapeStart = TapeEnd = 0.f;
	if (FeedCapture) { FeedCapture->TextureTarget = FeedTarget; }
	for (UMaterialInstanceDynamic* Screen : LiveScreens) { Screen->SetTextureParameterValue(TEXT("Screen"), FeedTarget); }
	TapeFrames.Reset();
}

void ACpvArena::CaptureFeed()
{
	const float Now = GetWorld()->GetTimeSeconds();
	UTextureRenderTarget2D* Target = FeedTarget;
	if (bTaping && Now >= NextTapeSample)
	{
		if (TapeNext == TapeFrames.Num())
		{
			TapeFrames.Add(UKismetRenderingLibrary::CreateRenderTarget2D(this, 640, 360, RTF_RGBA8_SRGB, FLinearColor::Black));
		}
		if (TapeFrames[TapeNext])
		{
			Target = TapeFrames[TapeNext];
			TapeTimes[TapeNext] = Now;
			TapeCount = FMath::Min(TapeCount + 1, TapeCapacity);
			TapeNext = (TapeNext + 1) % TapeCapacity;
			NextTapeSample = Now + 0.095f;
		}
	}
	if (FeedCapture->TextureTarget != Target)
	{
		FeedCapture->TextureTarget = Target;
		for (UMaterialInstanceDynamic* Screen : LiveScreens) { Screen->SetTextureParameterValue(TEXT("Screen"), Target); }
	}
	FeedCapture->CaptureScene();
}

UTextureRenderTarget2D* ACpvArena::TapeFrame(float At) const
{
	int32 Index = TapeCount == TapeCapacity ? TapeNext : 0;
	for (int32 i = 1; i < TapeCount; ++i)
	{
		const int32 Next = (Index + 1) % TapeCapacity;
		if (TapeTimes[Next] > At) { break; }
		Index = Next;
	}
	return TapeCount ? TapeFrames[Index].Get() : nullptr;
}

bool ACpvGameMode::HasReplay() const { return Arena && Arena->TapeEnd > Arena->TapeStart; }
UTexture* ACpvGameMode::ReplayPicture() const { return Arena->TapeFrame(ReplayTime); }
float ACpvGameMode::ReplayProgress() const
{
	return FMath::Clamp((ReplayTime - Arena->TapeStart) / FMath::Max(0.01f, Arena->TapeEnd - Arena->TapeStart), 0.f, 1.f);
}

void ACpvGameMode::StartReplay()
{
	bWatchingReplay = true;
	ReplayTime = Arena->TapeStart;
	NextTapeSound = 0;
	while (NextTapeSound < TapeSounds.Num() && TapeSounds[NextTapeSound].At < ReplayTime) { ++NextTapeSound; }
	StopVoice();
	UE_LOG(LogCpv, Display, TEXT("CPV_REPLAY start duration=%.2f"), Arena->TapeEnd - Arena->TapeStart);
}

void ACpvGameMode::TickReplay(float Dt, const FCpvMenuInput& Menu)
{
	ReplayTime += Dt * 0.8f;
	if (Menu.bBack || Menu.bOk || ReplayTime > Arena->TapeEnd + 0.5f)
	{
		bWatchingReplay = false;
		UE_LOG(LogCpv, Display, TEXT("CPV_REPLAY return"));
		return;
	}
	while (NextTapeSound < TapeSounds.Num() && TapeSounds[NextTapeSound].At <= ReplayTime)
	{
		const FTapeSound& S = TapeSounds[NextTapeSound++];
		PlaySound(S.Name, S.Volume, S.Pitch * 0.9f);
	}
}

void ACpvHUD::DrawReplay()
{
	const FLinearColor Gold(1.f, 0.8f, 0.14f), Panel(0.012f, 0.014f, 0.035f);
	Box(0, 0, W, H, Panel);
	const float FilmW = FMath::Min(W - 96.f, (H - 176.f) * 16.f / 9.f);
	const float FilmH = FilmW * 9.f / 16.f, X = (W - FilmW) * 0.5f, Y = (H - FilmH) * 0.5f;
	// The scene-capture buffer's alpha is scene depth. The recorded picture is fully opaque.
	if (UTexture* Frame = G->ReplayPicture())
	{
		Canvas->K2_DrawTexture(Frame, FVector2D(X*S,Y*S), FVector2D(FilmW*S,FilmH*S), FVector2D::ZeroVector,
			FVector2D(1,1), FLinearColor::White, BLEND_Opaque);
	}
	Txt(TEXT("CPV   /   INSTANT REPLAY"), X, Y - 57.f, ECpvFont::ExtraItalic, 42.f, Gold);
	Txt(TEXT("RINGSIDE CAMERA"), X + FilmW, Y - 49.f, ECpvFont::Bold, 28.f, FLinearColor::White, ECpvAlign::Right);
	Box(X, Y + FilmH, FilmW, 7.f, FLinearColor(0.17f,0.18f,0.2f));
	Box(X, Y + FilmH, FilmW * G->ReplayProgress(), 7.f, Gold);
	Txt(TEXT("ENTER / A   Return to results"), X + FilmW, Y + FilmH + 22.f, ECpvFont::Semi, 30.f, FLinearColor::White, ECpvAlign::Right);
}
