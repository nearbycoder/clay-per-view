#include "CpvUi.h"

#include "CanvasItem.h"
#include "Engine/Canvas.h"
#include "Engine/Font.h"
#include "Engine/Texture.h"
#include "Fonts/CompositeFont.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "Misc/Paths.h"
#include "Rendering/SlateRenderer.h"

namespace
{
	const TCHAR* GFaceFiles[] = {
		TEXT("TitanOne-Regular.ttf"), TEXT("Anton-Regular.ttf"), TEXT("Bangers-Regular.ttf"), TEXT("BarlowCondensed-Bold.ttf"),
		TEXT("BarlowCondensed-BoldItalic.ttf"), TEXT("BarlowCondensed-ExtraBoldItalic.ttf"), TEXT("BarlowCondensed-SemiBold.ttf"),
		TEXT("BarlowCondensed-Medium.ttf"),
	};
	const TCHAR* GFaceNames[] = { TEXT("Title"), TEXT("Impact"), TEXT("Comic"), TEXT("Bold"), TEXT("BoldItalic"), TEXT("ExtraItalic"), TEXT("Semi"), TEXT("Medium") };

	UFont* GetFont()
	{
		// The canvas draws text from a font object, so the TTFs in Content/CPV/Fonts are wrapped in one
		// runtime font with a typeface entry per face.
		static TWeakObjectPtr<UFont> Cached;
		if (!Cached.IsValid())
		{
			UFont* NewFont = NewObject<UFont>(GetTransientPackage(), TEXT("CpvUiFont"));
			NewFont->FontCacheType = EFontCacheType::Runtime;
			FCompositeFont& Composite = NewFont->GetMutableInternalCompositeFont();
			for (int32 i = 0; i < UE_ARRAY_COUNT(GFaceFiles); ++i)
			{
				const FString Path = FPaths::ConvertRelativePathToFull(FPaths::ProjectContentDir() / TEXT("CPV/Fonts") / GFaceFiles[i]);
				Composite.DefaultTypeface.Fonts.Add(FTypefaceEntry(FName(GFaceNames[i]), Path, EFontHinting::Default, EFontLoadingPolicy::LazyLoad));
			}
			NewFont->AddToRoot();
			Cached = NewFont;
		}
		return Cached.Get();
	}
}

FSlateFontInfo CpvUi::Font(ECpvFont Face, float Size, int32 Spacing)
{
	FSlateFontInfo Info(GetFont(), FMath::Max(1.f, FMath::RoundToFloat(Size)), FName(GFaceNames[static_cast<int32>(Face)]));
	Info.LetterSpacing = Spacing;
	return Info;
}

FVector2D CpvUi::Measure(const FString& Str, const FSlateFontInfo& Info)
{
	if (FSlateApplication::IsInitialized() && FSlateApplication::Get().GetRenderer())
	{
		const auto Size = FSlateApplication::Get().GetRenderer()->GetFontMeasureService()->Measure(Str, Info);
		return FVector2D(Size.X, Size.Y);
	}
	return FVector2D(Str.Len() * Info.Size * 0.55f, Info.Size * 1.2f);
}

float CpvUi::Text(UCanvas* Canvas, const FString& Str, float X, float Y, const FSlateFontInfo& Info, const FLinearColor& Color,
	ECpvAlign Align, float Shadow, const FLinearColor& ShadowColor)
{
	const float Width = Measure(Str, Info).X;
	const float Left = FMath::RoundToFloat(Align == ECpvAlign::Center ? X - Width * 0.5f : (Align == ECpvAlign::Right ? X - Width : X));
	const float Top = FMath::RoundToFloat(Y);
	if (Shadow > 0.f)
	{
		FCanvasTextItem Under(FVector2D(Left + Shadow, Top + Shadow), FText::FromString(Str), Info, FLinearColor(ShadowColor.R, ShadowColor.G, ShadowColor.B, ShadowColor.A * Color.A));
		Under.BlendMode = SE_BLEND_Translucent;
		Canvas->DrawItem(Under);
	}
	FCanvasTextItem Item(FVector2D(Left, Top), FText::FromString(Str), Info, Color);
	Item.BlendMode = SE_BLEND_Translucent;
	Canvas->DrawItem(Item);
	return Width;
}

float CpvUi::Outlined(UCanvas* Canvas, const FString& Str, float X, float Y, const FSlateFontInfo& Info, const FLinearColor& Color,
	const FLinearColor& Outline, float Thickness, ECpvAlign Align)
{
	const float Width = Measure(Str, Info).X;
	const float Left = FMath::RoundToFloat(Align == ECpvAlign::Center ? X - Width * 0.5f : (Align == ECpvAlign::Right ? X - Width : X));
	const float Top = FMath::RoundToFloat(Y);
	const FText Txt = FText::FromString(Str);
	const FLinearColor Edge(Outline.R, Outline.G, Outline.B, Outline.A * Color.A);
	const int32 Copies = Thickness > 3.f ? 16 : 8;
	for (int32 i = 0; i < Copies; ++i)
	{
		const float A = UE_TWO_PI * i / Copies;
		FCanvasTextItem Under(FVector2D(Left + FMath::Cos(A) * Thickness, Top + FMath::Sin(A) * Thickness + Thickness * 0.6f), Txt, Info, Edge);
		Under.BlendMode = SE_BLEND_Translucent;
		Canvas->DrawItem(Under);
	}
	FCanvasTextItem Item(FVector2D(Left, Top), Txt, Info, Color);
	Item.BlendMode = SE_BLEND_Translucent;
	Canvas->DrawItem(Item);
	return Width;
}

void CpvUi::Fill(UCanvas* Canvas, float X, float Y, float W, float H, const FLinearColor& Color)
{
	const float X0 = FMath::RoundToFloat(X), Y0 = FMath::RoundToFloat(Y);
	const float X1 = FMath::RoundToFloat(X + W), Y1 = FMath::RoundToFloat(Y + H);
	if (X1 <= X0 || Y1 <= Y0) { return; }
	FCanvasTileItem Tile(FVector2D(X0, Y0), FVector2D(X1 - X0, Y1 - Y0), Color);
	Tile.BlendMode = SE_BLEND_Translucent;
	Canvas->DrawItem(Tile);
}

void CpvUi::Gradient(UCanvas* Canvas, float X, float Y, float W, float H, const FLinearColor& Top, const FLinearColor& Bottom)
{
	const float X0 = FMath::RoundToFloat(X), Y0 = FMath::RoundToFloat(Y);
	const float X1 = FMath::RoundToFloat(X + W), Y1 = FMath::RoundToFloat(Y + H);
	if (X1 <= X0 || Y1 <= Y0) { return; }
	// One quad with the colours on its corners: no strips, so no seams at any resolution.
	FCanvasUVTri A, B;
	A.V0_Pos = FVector2D(X0, Y0); A.V1_Pos = FVector2D(X1, Y0); A.V2_Pos = FVector2D(X1, Y1);
	A.V0_Color = Top; A.V1_Color = Top; A.V2_Color = Bottom;
	B.V0_Pos = FVector2D(X0, Y0); B.V1_Pos = FVector2D(X1, Y1); B.V2_Pos = FVector2D(X0, Y1);
	B.V0_Color = Top; B.V1_Color = Bottom; B.V2_Color = Bottom;
	TArray<FCanvasUVTri> Tris;
	Tris.Add(A);
	Tris.Add(B);
	FCanvasTriangleItem Item(Tris, GWhiteTexture);
	Item.BlendMode = SE_BLEND_Translucent;
	Canvas->DrawItem(Item);
}

void CpvUi::Frame(UCanvas* Canvas, float X, float Y, float W, float H, const FLinearColor& Color, float Thickness)
{
	const float T = FMath::Max(1.f, FMath::RoundToFloat(Thickness));
	Fill(Canvas, X, Y, W, T, Color);
	Fill(Canvas, X, Y + H - T, W, T, Color);
	Fill(Canvas, X, Y + T, T, H - 2.f * T, Color);
	Fill(Canvas, X + W - T, Y + T, T, H - 2.f * T, Color);
}

void CpvUi::Quad(UCanvas* Canvas, const FVector2D& A, const FVector2D& B, const FVector2D& C, const FVector2D& D, const FLinearColor& Color)
{
	FCanvasTriangleItem T1(A, B, C, GWhiteTexture);
	T1.SetColor(Color);
	T1.BlendMode = SE_BLEND_Translucent;
	Canvas->DrawItem(T1);
	FCanvasTriangleItem T2(A, C, D, GWhiteTexture);
	T2.SetColor(Color);
	T2.BlendMode = SE_BLEND_Translucent;
	Canvas->DrawItem(T2);
}

void CpvUi::Slant(UCanvas* Canvas, float X, float Y, float W, float H, float Skew, const FLinearColor& Color)
{
	Quad(Canvas, FVector2D(X + Skew, Y), FVector2D(X + W + Skew, Y), FVector2D(X + W, Y + H), FVector2D(X, Y + H), Color);
}

void CpvUi::Image(UCanvas* Canvas, UTexture* Texture, float X, float Y, float W, float H, const FLinearColor& Tint, bool bFlipX)
{
	if (!Texture || !Texture->GetResource()) { return; }
	FCanvasTileItem Tile(FVector2D(X, Y), Texture->GetResource(), FVector2D(W, H), bFlipX ? FVector2D(1.f, 0.f) : FVector2D(0.f, 0.f),
		bFlipX ? FVector2D(0.f, 1.f) : FVector2D(1.f, 1.f), Tint);
	Tile.BlendMode = SE_BLEND_Translucent;
	Canvas->DrawItem(Tile);
}
