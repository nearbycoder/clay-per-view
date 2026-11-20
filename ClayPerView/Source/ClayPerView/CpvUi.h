#pragma once

#include "CoreMinimal.h"
#include "Fonts/SlateFontInfo.h"

class UCanvas;
class UFont;
class UTexture;

enum class ECpvFont : uint8 { Title, Impact, Comic, Bold, BoldItalic, ExtraItalic, Semi, Medium };
enum class ECpvAlign : uint8 { Left, Center, Right };

/** Small canvas drawing kit shared by the HUD and the in-world screens. */
namespace CpvUi
{
	FSlateFontInfo Font(ECpvFont Face, float Size, int32 Spacing = 0);
	FVector2D Measure(const FString& Text, const FSlateFontInfo& Info);
	/** Draws text and returns its width. */
	float Text(UCanvas* Canvas, const FString& Str, float X, float Y, const FSlateFontInfo& Info, const FLinearColor& Color,
		ECpvAlign Align = ECpvAlign::Left, float Shadow = 0.f, const FLinearColor& ShadowColor = FLinearColor(0.f, 0.f, 0.f, 0.7f));
	/** Text with a chunky outline (drawn as offset copies), the way title cards are lettered. */
	float Outlined(UCanvas* Canvas, const FString& Str, float X, float Y, const FSlateFontInfo& Info, const FLinearColor& Color,
		const FLinearColor& Outline, float Thickness, ECpvAlign Align = ECpvAlign::Left);
	void Fill(UCanvas* Canvas, float X, float Y, float W, float H, const FLinearColor& Color);
	/** Filled rectangle that fades from one colour at the top to another at the bottom. */
	void Gradient(UCanvas* Canvas, float X, float Y, float W, float H, const FLinearColor& Top, const FLinearColor& Bottom);
	void Frame(UCanvas* Canvas, float X, float Y, float W, float H, const FLinearColor& Color, float Thickness);
	/** Filled four-sided shape (points clockwise). */
	void Quad(UCanvas* Canvas, const FVector2D& A, const FVector2D& B, const FVector2D& C, const FVector2D& D, const FLinearColor& Color);
	/** Horizontal bar with slanted ends: Skew is how far the top edge is shifted right. */
	void Slant(UCanvas* Canvas, float X, float Y, float W, float H, float Skew, const FLinearColor& Color);
	void Image(UCanvas* Canvas, UTexture* Texture, float X, float Y, float W, float H, const FLinearColor& Tint = FLinearColor::White, bool bFlipX = false);
}
