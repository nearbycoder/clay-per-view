#include "CpvGame.h"
#include "CpvHud.h"
#include "ClayPerView.h"
#include "Framework/Application/SlateApplication.h"
#include "Widgets/SLeafWidget.h"
#include "UnrealClient.h"
#include "Engine/GameViewportClient.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"

namespace
{
	DECLARE_DELEGATE_TwoParams(FMenuPoint, FVector2D, bool);
	class SCpvPointerLayer : public SLeafWidget
	{
	public:
		SLATE_BEGIN_ARGS(SCpvPointerLayer) {}
			SLATE_EVENT(FMenuPoint, OnPoint)
		SLATE_END_ARGS()
		void Construct(const FArguments& Args) { Handler = Args._OnPoint; }
		virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(1,1); }
		virtual int32 OnPaint(const FPaintArgs&, const FGeometry&, const FSlateRect&, FSlateWindowElementList&, int32 Layer, const FWidgetStyle&, bool) const override { return Layer; }
		virtual FReply OnMouseMove(const FGeometry& Geo, const FPointerEvent& Event) override
		{
			if (!Event.GetCursorDelta().IsNearlyZero()) { Send(Geo, Event, false); }
			return FReply::Unhandled();
		}
		virtual FReply OnMouseButtonDown(const FGeometry& Geo, const FPointerEvent& Event) override
		{
			if (Event.GetEffectingButton() != EKeys::LeftMouseButton) { return FReply::Unhandled(); }
			Send(Geo, Event, true);
			return FReply::Handled();
		}
	private:
		FMenuPoint Handler;
		void Send(const FGeometry& Geo, const FPointerEvent& Event, bool Click)
		{
			const FVector2D Size(Geo.GetLocalSize());
			if (Size.X <= 0 || Size.Y <= 0) { return; }
			Handler.ExecuteIfBound(FVector2D(Geo.AbsoluteToLocal(Event.GetScreenSpacePosition())) / Size, Click);
		}
	};
}

void ACpvGameMode::QueuePointer(FVector2D Normalized, bool bClick)
{
	// Preserve the click if a mouse move arrives during the same engine frame.
	if (!bPointerClick || bClick) { PointerPoint = Normalized; }
	bHavePointer = true;
	bPointerClick |= bClick;
}

void ACpvGameMode::ClosePointer()
{
	if (PointerLayer && GetWorld() && GetWorld()->GetGameViewport()) { GetWorld()->GetGameViewport()->RemoveViewportWidgetContent(PointerLayer.ToSharedRef()); }
	PointerLayer.Reset();
}

void ACpvGameMode::ClickViewport(const FVector2D& At)
{
	if (!PointerLayer || !bPointerVisible || !FSlateApplication::IsInitialized()) { return; }
	const FGeometry& Geo = PointerLayer->GetCachedGeometry();
	const FVector2D Pixel = Geo.LocalToAbsolute(FVector2D(Geo.GetLocalSize()) * At);
	const TSet<FKey> DownKeys{EKeys::LeftMouseButton};
	const FPointerEvent DownEvent(0, Pixel, Pixel, DownKeys, EKeys::LeftMouseButton, 0.f, FModifierKeysState());
	// This is a simulated click inside this viewport. An unattended Mac has no active native window.
	PointerLayer->OnMouseButtonDown(Geo, DownEvent);
}

int32 ACpvHUD::PointerContext() const
{
	return static_cast<int32>(G->Phase) | (static_cast<int32>(G->OptionsPage) << 5) |
		(G->bPaused << 8) | (G->bPauseOptions << 9) | (G->bWatchingReplay << 10);
}

void ACpvHUD::Hit(float X, float Y, float BW, float BH, ECpvClick Action, int32 Index)
{
	HitAreas.Add({FBox2D(FVector2D(X*S, Y*S), FVector2D((X+BW)*S, (Y+BH)*S)), Action, Index});
}

const FCpvHitArea* ACpvHUD::HitAt(const FVector2D& Pixel) const
{
	if (!G || LastContext != PointerContext()) { return nullptr; }
	// Narrow controls (for example the two adjustment arrows) sit on top of their row.
	for (int32 i = HitAreas.Num() - 1; i >= 0; --i)
	{
		if (HitAreas[i].Box.IsInsideOrOn(Pixel)) { return &HitAreas[i]; }
	}
	return nullptr;
}

void ACpvHUD::DrawHover()
{
	if (HoverContext != PointerContext()) { return; }
	const FCpvHitArea* Area = HitAt(HoverPixel);
	if (!Area || Area->Action == ECpvClick::Accept) { return; }
	const FVector2D Min = Area->Box.Min / S, Max = Area->Box.Max / S;
	const float Length = FMath::Min(55.f, static_cast<float>(Max.X - Min.X) - 6.f);
	Box(Min.X + 3.f, Max.Y - 4.f, Length, 3.f, FLinearColor(0.92f,0.97f,1.f));
}

void ACpvHUD::DrawBack()
{
	const float X = W - 206.f;
	Slant(X, 44.f, 150.f, 52.f, 8.f, FLinearColor(0.015f,0.018f,0.04f,0.94f));
	Txt(TEXT("<  BACK"), X + 74.f, 50.f, ECpvFont::Bold, 29.f, FLinearColor::White, ECpvAlign::Center);
	Hit(X, 44.f, 154.f, 52.f, ECpvClick::Back);
}

void ACpvGameMode::ReadPointer(FCpvMenuInput (&Menu)[2])
{
	APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
	UGameViewportClient* View = GetWorld()->GetGameViewport();
	if (!PC || !View || !View->Viewport) { return; }
	ACpvHUD* Hud = Cast<ACpvHUD>(PC->GetHUD());
	for (const FCpvMenuInput& In : Menu)
	{
		if (Hud && (In.bUp || In.bDown || In.bLeft || In.bRight || In.bOk || In.bBack || In.bPause)) { Hud->ClearHover(); }
	}
	if (!PointerLayer)
	{
		PointerLayer = SNew(SCpvPointerLayer).OnPoint(FMenuPoint::CreateUObject(this, &ACpvGameMode::QueuePointer));
		PointerLayer->SetVisibility(EVisibility::Collapsed);
		View->AddViewportWidgetContent(PointerLayer.ToSharedRef(), 10);
	}
	const bool bShow = IsDemo() || Phase == ECpvPhase::Select || Phase == ECpvPhase::Results || bPaused || (IsRehearsing() && Lesson == 4);
	if (bPointerVisible != bShow)
	{
		bPointerVisible = bShow;
		if (Hud) { Hud->ClearHover(); }
		PointerLayer->SetVisibility(bShow ? EVisibility::Visible : EVisibility::Collapsed);
		bHavePointer = bPointerClick = false;
		PC->SetShowMouseCursor(bShow);
		if (bShow)
		{
			FInputModeGameAndUI ModeUI;
			ModeUI.SetHideCursorDuringCapture(false);
			ModeUI.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
			PC->SetInputMode(ModeUI);
		}
		else { PC->SetInputMode(FInputModeGameOnly()); }
	}
	if (!bShow || !bHavePointer) { return; }
	const FVector2D Pixel = PointerPoint * FVector2D(View->Viewport->GetSizeXY());
	const bool bClick = bPointerClick;
	bHavePointer = bPointerClick = false;
	if (!Hud) { return; }
	Hud->SetHover(Pixel);
	// Hover is visual. Restoring the OS cursor on a new screen must not choose a keyboard row.
	if (!bClick) { return; }
	const FCpvHitArea* Area = Hud->HitAt(Pixel);
	if (!Area) { return; }
	UE_LOG(LogCpv, Verbose, TEXT("CPV_POINTER action=%d row=%d"), static_cast<int32>(Area->Action), Area->Index);
	FCpvMenuInput& Input = Menu[0];
	switch (Area->Action)
	{
	case ECpvClick::Main: MenuIndex = Area->Index; break;
	case ECpvClick::Pause: PauseIndex = Area->Index; break;
	case ECpvClick::Result: ResultIndex = Area->Index; break;
	case ECpvClick::Option:
		OptionIndex = Area->Index;
		Input.bOk |= OptionsPage == ECpvOptionsPage::General && (OptionIndex == 4 || OptionIndex == 5);
		return;
	case ECpvClick::Less: case ECpvClick::More:
		OptionIndex = Area->Index;
		Input.bLeft |= Area->Action == ECpvClick::Less;
		Input.bRight |= Area->Action == ECpvClick::More;
		return;
	case ECpvClick::Roster:
	{
		const int32 Device = Mode == ECpvMode::TwoPlayer && bLocked[0] ? 1 : 0;
		Menu[Device].Pick = Area->Index;
		Menu[Device].bOk = true;
		return;
	}
	case ECpvClick::Back: Input.bBack = true; return;
	case ECpvClick::Accept: break;
	}
	Input.bOk = true;
}
