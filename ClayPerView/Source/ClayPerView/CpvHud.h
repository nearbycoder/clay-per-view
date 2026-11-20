#pragma once

#include "CoreMinimal.h"
#include "CpvUi.h"
#include "GameFramework/HUD.h"
#include "CpvHud.generated.h"

class ACpvFighter;
class ACpvGameMode;
class UTexture2D;

/** Every screen in the game, drawn on the canvas in a TV-broadcast style. Authored at 1080p and scaled. */
enum class ECpvClick : uint8 { Accept, Back, Main, Roster, Option, Less, More, Pause, Result };
struct FCpvHitArea
{
	FBox2D Box;
	ECpvClick Action;
	int32 Index;
};

UCLASS()
class ACpvHUD : public AHUD
{
	GENERATED_BODY()
public:
	virtual void DrawHUD() override;
	const FCpvHitArea* HitAt(const FVector2D& Pixel) const;
	int32 PointerContext() const;
	void SetHover(FVector2D Pixel) { HoverPixel = Pixel; HoverContext = G ? PointerContext() : INDEX_NONE; }
	void ClearHover() { HoverContext = INDEX_NONE; }

private:
	void DrawHover();
	FVector2D HoverPixel = FVector2D::ZeroVector;
	int32 HoverContext = INDEX_NONE;
	// --- kit (coordinates in 1080p units; W is the canvas width in those units) ---
	float Txt(const FString& Str, float X, float Y, ECpvFont Face, float Size, const FLinearColor& Colour, ECpvAlign Align = ECpvAlign::Left,
		float Shadow = 0.f, int32 Spacing = 0);
	float Out(const FString& Str, float X, float Y, ECpvFont Face, float Size, const FLinearColor& Colour, const FLinearColor& Edge, float Thick,
		ECpvAlign Align = ECpvAlign::Left, int32 Spacing = 0);
	float Width(const FString& Str, ECpvFont Face, float Size, int32 Spacing = 0) const;
	void Box(float X, float Y, float BW, float BH, const FLinearColor& Colour);
	void Slant(float X, float Y, float BW, float BH, float Skew, const FLinearColor& Colour);
	void Pic(UTexture2D* Texture, float X, float Y, float BW, float BH, const FLinearColor& Tint = FLinearColor::White, bool bFlip = false);
	UTexture2D* Portrait(const TCHAR* Id);
	void Shade(float Top, float Bottom, float AlphaTop, float AlphaBottom);

	// --- screens ---
	void DrawLogo(float CX, float Y, float Size);
	TArray<FCpvHitArea> HitAreas;
	int32 LastContext = -1;
	void Hit(float X, float Y, float BW, float BH, ECpvClick Action, int32 Index = 0);
	void DrawBack();
	void DrawTitle();
	void DrawMenu();
	void DrawOptions();
	void DrawHowTo();
	void DrawCredits();
	void DrawSelect();
	void DrawVersus();
	void DrawFight();
	void DrawCover();
	void DrawFighterBar(const ACpvFighter* F, bool bRight);
	void DrawBanner();
	void DrawSubtitle();
	void DrawNameCard();
	void DrawResults();
	void DrawReplay();
	void DrawPause();
	void DrawControls(float X, float Y, bool bCompact);

	UPROPERTY()
	TMap<FName, TObjectPtr<UTexture2D>> Portraits;

	ACpvGameMode* G = nullptr;
	float S = 1.f;
	float W = 1920.f;
	float H = 1080.f;
};
