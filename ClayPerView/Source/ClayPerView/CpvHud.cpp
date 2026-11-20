#include "CpvHud.h"
#include "CpvFighter.h"
#include "CpvGame.h"

#include "Engine/Canvas.h"
#include "Engine/Texture2D.h"

namespace
{
	const FLinearColor Gold(1.f, 0.8f, 0.14f);
	const FLinearColor Red(0.82f, 0.13f, 0.09f);
	const FLinearColor Blue(0.1f, 0.3f, 0.82f);
	const FLinearColor Ink(0.012f, 0.014f, 0.035f);
	const FLinearColor Panel(0.012f, 0.014f, 0.035f, 0.86f);
	const FLinearColor White(1.f, 1.f, 1.f);
	const FLinearColor Dim(0.7f, 0.74f, 0.84f);

	FLinearColor Fade(const FLinearColor& C, float A) { return FLinearColor(C.R, C.G, C.B, C.A * A); }
	float Pulse(float T, float Speed = 4.f) { return 0.5f + 0.5f * FMath::Sin(T * Speed); }
	FLinearColor SlotColour(int32 Slot) { return Slot == 0 ? Red : Blue; }
}

// ---------------------------------------------------------------------------------------------
// Kit
// ---------------------------------------------------------------------------------------------

namespace
{
	/** How far below the top of its line box each face starts drawing capitals, as a fraction of the size. */
	float TopGap(ECpvFont Face)
	{
		switch (Face)
		{
		case ECpvFont::Title: return 0.06f;
		case ECpvFont::Impact: return 0.1f;
		case ECpvFont::Comic: return 0.08f;
		default: return 0.2f;
		}
	}
}

float ACpvHUD::Txt(const FString& Str, float X, float Y, ECpvFont Face, float Size, const FLinearColor& Colour, ECpvAlign Align, float Shadow, int32 Spacing)
{
	Y -= TopGap(Face) * Size;
	return CpvUi::Text(Canvas, Str, X * S, Y * S, CpvUi::Font(Face, Size * S, Spacing), Colour, Align, Shadow * S) / S;
}

float ACpvHUD::Out(const FString& Str, float X, float Y, ECpvFont Face, float Size, const FLinearColor& Colour, const FLinearColor& Edge, float Thick,
	ECpvAlign Align, int32 Spacing)
{
	Y -= TopGap(Face) * Size;
	return CpvUi::Outlined(Canvas, Str, X * S, Y * S, CpvUi::Font(Face, Size * S, Spacing), Colour, Edge, Thick * S, Align) / S;
}

float ACpvHUD::Width(const FString& Str, ECpvFont Face, float Size, int32 Spacing) const
{
	return CpvUi::Measure(Str, CpvUi::Font(Face, Size * S, Spacing)).X / S;
}

void ACpvHUD::Box(float X, float Y, float BW, float BH, const FLinearColor& Colour)
{
	CpvUi::Fill(Canvas, X * S, Y * S, BW * S, BH * S, Colour);
}

void ACpvHUD::Slant(float X, float Y, float BW, float BH, float Skew, const FLinearColor& Colour)
{
	CpvUi::Slant(Canvas, X * S, Y * S, BW * S, BH * S, Skew * S, Colour);
}

void ACpvHUD::Pic(UTexture2D* Texture, float X, float Y, float BW, float BH, const FLinearColor& Tint, bool bFlip)
{
	CpvUi::Image(Canvas, Texture, X * S, Y * S, BW * S, BH * S, Tint, bFlip);
}

UTexture2D* ACpvHUD::Portrait(const TCHAR* Id)
{
	const FName Key(Id);
	if (TObjectPtr<UTexture2D>* Found = Portraits.Find(Key)) { return *Found; }
	UTexture2D* Texture = LoadObject<UTexture2D>(nullptr, *FString::Printf(TEXT("/Game/CPV/UI/P_%s.P_%s"), Id, Id));
	Portraits.Add(Key, TObjectPtr<UTexture2D>(Texture));
	return Texture;
}

void ACpvHUD::Shade(float Top, float Bottom, float AlphaTop, float AlphaBottom)
{
	CpvUi::Gradient(Canvas, 0.f, Top * S, W * S, (Bottom - Top) * S, FLinearColor(0.f, 0.f, 0.02f, AlphaTop), FLinearColor(0.f, 0.f, 0.02f, AlphaBottom));
}

// ---------------------------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------------------------

void ACpvHUD::DrawHUD()
{
	Super::DrawHUD();
	HitAreas.Reset();
	G = GetWorld() ? GetWorld()->GetAuthGameMode<ACpvGameMode>() : nullptr;
	if (!G || !Canvas || !G->bShowHud || !G->Fighters[0] || !G->Fighters[1]) { return; }
	S = FMath::Min(Canvas->SizeY / 1080.f, Canvas->SizeX / 1760.f);
	W = Canvas->SizeX / S;
	H = Canvas->SizeY / S;
	LastContext = PointerContext();
	if (G->bWatchingReplay) { DrawReplay(); Hit(0, 0, W, H, ECpvClick::Accept); return; }
	if (G->bPauseOptions || G->Phase == ECpvPhase::Options) { DrawOptions(); DrawHover(); return; }

	if (G->Letterbox > 0.f)
	{
		Box(0.f, 0.f, W, 96.f * G->Letterbox, FLinearColor::Black);
		Box(0.f, H - 96.f * G->Letterbox, W, 96.f * G->Letterbox + 2.f, FLinearColor::Black);
	}
	switch (G->Phase)
	{
	case ECpvPhase::Title: DrawTitle(); break;
	case ECpvPhase::Menu: DrawMenu(); break;
	case ECpvPhase::Options: break;
	case ECpvPhase::HowTo: DrawHowTo(); break;
	case ECpvPhase::Credits: DrawCredits(); break;
	case ECpvPhase::Select: DrawSelect(); break;
	case ECpvPhase::Versus: DrawVersus(); break;
	case ECpvPhase::Intro: DrawNameCard(); break;
	case ECpvPhase::RoundIntro:
	case ECpvPhase::Fight:
	case ECpvPhase::RoundEnd: DrawFight(); break;
	case ECpvPhase::Finisher: break;
	case ECpvPhase::MatchEnd: break;
	case ECpvPhase::Results: DrawResults(); break;
	}
	DrawBanner();
	if (G->bSubtitles) { DrawSubtitle(); }

	if (G->bPaused) { HitAreas.Reset(); DrawPause(); }
	DrawHover();
	if (G->FadeOut > 0.f) { Box(0.f, 0.f, W, H, FLinearColor(0.f, 0.f, 0.f, G->FadeOut)); }
}

void ACpvHUD::DrawLogo(float CX, float Y, float Size)
{
	// Wordmark: chunky yellow letters with a dark edge and a red drop, like stacked clay cut-outs.
	const FString Name = TEXT("CLAY-PER-VIEW");
	const float Room = 2.f * FMath::Min(CX, W - CX) - 60.f;
	const float Natural = Width(Name, ECpvFont::Title, Size);
	if (Natural > Room) { Size *= Room / Natural; }
	Out(Name, CX + Size * 0.045f, Y + Size * 0.06f, ECpvFont::Title, Size, Red, Fade(Ink, 0.f), 0.f, ECpvAlign::Center);
	Out(Name, CX, Y, ECpvFont::Title, Size, Gold, Ink, Size * 0.05f, ECpvAlign::Center);
	const float SubW = Width(TEXT("FAMOUS LAST BLOWS"), ECpvFont::Impact, Size * 0.3f, 220);
	Slant(CX - SubW * 0.5f - 34.f, Y + Size * 1.2f, SubW + 68.f, Size * 0.42f, 12.f, Red);
	Txt(TEXT("FAMOUS LAST BLOWS"), CX, Y + Size * 1.225f, ECpvFont::Impact, Size * 0.3f, White, ECpvAlign::Center, 0.f, 220);
}

void ACpvHUD::DrawTitle()
{
	Hit(0, 0, W, H, ECpvClick::Accept);
	Shade(0.f, 560.f, 0.78f, 0.f);
	Shade(760.f, H, 0.f, 0.8f);
	DrawLogo(W * 0.5f, 110.f, 190.f);
	const float A = 0.45f + 0.55f * Pulse(G->RealTime, 5.f);
	Out(TEXT("ENTER THE RING"), W * 0.5f, 900.f, ECpvFont::ExtraItalic, 58.f, Fade(White, A), Fade(Ink, A), 3.f, ECpvAlign::Center, 60);
	Txt(TEXT("ENTER  /  GAMEPAD A"), W * 0.5f, 980.f, ECpvFont::Medium, 28.f, Dim, ECpvAlign::Center, 2.f, 30);
}

void ACpvHUD::DrawMenu()
{
	Shade(0.f, H, 0.5f, 0.62f);
	DrawLogo(480.f, 70.f, 110.f);
	const TCHAR* Items[] = { TEXT("RATINGS RUN"), TEXT("EXHIBITION"), TEXT("TWO PLAYERS"), TEXT("WATCH A BOUT"), TEXT("OPTIONS"), TEXT("RING SCHOOL"), TEXT("CREDITS"), TEXT("QUIT") };
	const TCHAR* Help[] = {
		TEXT("Win three one-take bouts to become the prime-time headliner."), TEXT("Pick both stars for a single-player bout."),
		TEXT("Share a keyboard, connect two pads, or use one of each."), TEXT("Cast a bout and watch two computer-controlled stars fight."),
		TEXT("Set bout rules, adjust the mix and tune picture quality."), TEXT("Practice four moves with a ringside coach."), TEXT("Meet the cast and see how the broadcast was made."), TEXT("Close the game.") };
	for (int32 i = 0; i < UE_ARRAY_COUNT(Items); ++i)
	{
		const float Y = 258.f + i * 79.f;
		Hit(92.f, Y - 6.f, 674.f, 79.f, ECpvClick::Main, i);
		const bool bOn = i == G->MenuIndex;
		if (bOn)
		{
			Slant(110.f, Y - 6.f, 640.f, 80.f, 26.f, Gold);
			Slant(96.f, Y - 6.f, 12.f, 80.f, 26.f, Red);
		}
		Txt(Items[i], 170.f + (bOn ? 14.f : 0.f), Y, ECpvFont::ExtraItalic, 62.f, bOn ? Ink : White, ECpvAlign::Left, bOn ? 0.f : 3.f, 20);
	}
	if (G->MenuIndex == 0)
	{
		const float X = W - 830.f, Y = 252.f, CardW = 730.f;
		Slant(X + 9.f, Y + 12.f, CardW, 492.f, 10.f, Fade(Ink, 0.6f));
		Slant(X, Y, CardW, 492.f, 10.f, Panel);
		Box(X + 23.f, Y + 20.f, CardW - 44.f, 7.f, Gold);
		Txt(TEXT("TONIGHT'S TITLE BOUTS"), X + 32.f, Y + 42.f, ECpvFont::Bold, 29.f, Gold, ECpvAlign::Left, 0.f, 60);
		Pic(Portrait(TEXT("TitleBelt")), X + 18.f, Y + 72.f, CardW - 36.f, 298.f);
		Txt(TEXT("PRIME-TIME CHAMPIONSHIP"), X + CardW * 0.5f, Y + 352.f, ECpvFont::ExtraItalic, 50.f, White, ECpvAlign::Center);
		Txt(TEXT("Win the card. Answer the crowd. Earn up to nine stars."), X + CardW * 0.5f, Y + 422.f, ECpvFont::Semi, 28.f, Dim, ECpvAlign::Center);
	}
	Slant(100.f, 920.f, 900.f, 56.f, 16.f, Panel);
	Txt(Help[G->MenuIndex], 136.f, 930.f, ECpvFont::Semi, 32.f, White);
	Txt(TEXT("W/S or D-pad   Choose       ENTER / A   Select       ESC / B   Back"), 136.f, 1000.f, ECpvFont::Medium, 24.f, Dim, ECpvAlign::Left, 0.f, 20);
}

void ACpvHUD::DrawOptions()
{
	const bool bPicture = G->OptionsPage == ECpvOptionsPage::Picture;
	const bool bSound = G->OptionsPage == ECpvOptionsPage::Sound;
	const float Left = W * 0.055f;
	const float RowW = W * 0.51f;
	const float Right = Left + RowW + W * 0.04f;
	const float CardW = W - Right - Left;
	Shade(0.f, H, 0.45f, 0.38f);
	Txt(G->bPauseOptions ? TEXT("INTERMISSION") : TEXT("MAIN MENU"), Left, 60.f, ECpvFont::Bold, 30.f, Gold, ECpvAlign::Left, 1.f, 70);
	Out(bPicture ? TEXT("PICTURE QUALITY") : bSound ? TEXT("SOUND MIXER") : TEXT("OPTIONS"),
		Left, 101.f, ECpvFont::Title, 74.f, White, Ink, 4.f);
	const float RowH = bPicture ? 55.f : 79.f;
	for (int32 Row = 0; Row < G->OptionCount(); ++Row)
	{
		const float Y = 225.f + Row * RowH;
		const bool bSelected = Row == G->OptionIndex;
		Slant(Left, Y, RowW, RowH - 5.f, 10.f, bSelected ? Gold : Panel);
		const float Size = bPicture ? 34.f : 38.f;
		Txt(FString(G->OptionLabel(Row)).ToUpper(), Left + 28.f, Y + 8.f, ECpvFont::Bold, Size, bSelected ? Ink : White);
		const bool bLink = !bSound && !bPicture && (Row == 4 || Row == 5);
		Hit(Left, Y, RowW, RowH - 3.f, ECpvClick::Option, Row);
		if (bLink) { Txt(G->OptionValue(Row), Left + RowW - 28.f, Y + 8.f, ECpvFont::ExtraItalic, Size, bSelected ? Ink : Gold, ECpvAlign::Right); }
		else
		{
			const float Dec = Left + RowW - 320.f, Inc = Left + RowW - 48.f;
			const FString Value = G->OptionValue(Row);
			const float ValueSize = FMath::Min(Size, Size * (Inc - Dec - 58.f) / FMath::Max(1.f, Width(Value, ECpvFont::ExtraItalic, Size)));
			Txt(TEXT("<"), Dec + 20.f, Y + 8.f, ECpvFont::Bold, Size, bSelected ? Ink : Dim, ECpvAlign::Center);
			Txt(Value, (Dec + Inc) * 0.5f + 18.f, Y + 8.f + (Size - ValueSize) * 0.5f, ECpvFont::ExtraItalic, ValueSize, bSelected ? Ink : Gold, ECpvAlign::Center);
			Txt(TEXT(">"), Inc + 16.f, Y + 8.f, ECpvFont::Bold, Size, bSelected ? Ink : Dim, ECpvAlign::Center);
			Hit(Dec - 10.f, Y, 57.f, RowH - 3.f, ECpvClick::Less, Row);
			Hit(Inc - 8.f, Y, 56.f, RowH - 3.f, ECpvClick::More, Row);
		}
	}
	DrawBack();
	if (bPicture)
	{
		Box(Right, 225.f, CardW, 220.f, Panel);
		Txt(TEXT("PICTURE DETAIL"), Right + 24.f, 245.f, ECpvFont::Bold, 30.f, White);
		const float BW = CardW - 48.f;
		Box(Right + 24.f, 293.f, BW, 14.f, Dim * 0.35f);
		Box(Right + 24.f, 293.f, BW * G->DetailMeter(), 14.f, Gold);
		if (G->MeasuredFPS > 0.f)
		{
			Txt(FString::Printf(TEXT("%.0f FPS"), G->MeasuredFPS), Right + 24.f, 338.f, ECpvFont::ExtraItalic, 58.f, Gold);
			Txt(FString::Printf(TEXT("%.1f ms / frame"), 1000.f / G->MeasuredFPS), Right + CardW - 24.f, 358.f, ECpvFont::Bold, 32.f, White, ECpvAlign::Right);
		}
		const TCHAR* Tips[] = {
			TEXT("Sets render scale, detail levels and arena screen refresh together."), TEXT("Above 100% renders extra pixels for a sharper image."),
			TEXT("Higher levels refine the shadows under fighters and ring lights."), TEXT("Higher levels increase lighting and reflection detail."),
			TEXT("Higher levels retain finer surface detail and use more graphics memory."), TEXT("Higher levels smooth edges on ropes and silhouettes."),
			TEXT("Adjusts the quality of effects during hits and entrances."), TEXT("Adjusts the quality of the final camera effects."),
			TEXT("Higher rates update the arena video screens more often."), TEXT("Limits how many frames the game renders each second."),
			TEXT("Matches presentation to the display refresh to reduce tearing."), TEXT("Switches between a window and full screen."),
			TEXT("Shows measured frame rate and frame time during bouts.") };
		const FString Tip = Tips[G->OptionIndex];
		float TipSize = 29.f;
		while (TipSize > 18.f && Width(Tip, ECpvFont::Semi, TipSize) > W - 2.f * Left - 40.f) { TipSize -= 1.f; }
		Txt(Tip, Left, 957.f, ECpvFont::Semi, TipSize, White, ECpvAlign::Left, 2.f);
	}
	else if (bSound && G->OptionIndex < 6)
	{
		const int32 Volume = G->OptionIndex == 0 ? G->SoundVolume : G->BusVolume[G->OptionIndex - 1];
		Box(Right, 225.f, CardW, 122.f, Panel);
		Txt(FString(G->OptionLabel(G->OptionIndex)).ToUpper(), Right + 24.f, 243.f, ECpvFont::Bold, 32.f, White);
		const float Segment = (CardW - 48.f) / 10.f;
		for (int32 i = 0; i < 10; ++i) { Box(Right + 24.f + i * Segment, 304.f, Segment - 4.f, 17.f, i < Volume ? Gold : Dim * 0.35f); }
	}
	Txt(TEXT("UP / DOWN   Choose      LEFT / RIGHT   Adjust      ENTER / A   Select      ESC / B   Back"), Left, 1010.f,
		ECpvFont::Semi, 27.f, White, ECpvAlign::Left, 2.f);
}

void ACpvHUD::DrawControls(float X, float Y, bool bCompact)
{
	struct FRow { const TCHAR* Action; const TCHAR* One; const TCHAR* TwoA; const TCHAR* TwoB; const TCHAR* Pad; };
	static const FRow Rows[] = {
		{ TEXT("MOVE"), TEXT("W A S D"), TEXT("W A S D"), TEXT("ARROWS"), TEXT("LEFT STICK") },
		{ TEXT("JAB (TAP FOR COMBO)"), TEXT("J"), TEXT("F"), TEXT(","), TEXT("X / SQUARE") },
		{ TEXT("HEAVY HIT"), TEXT("K"), TEXT("G"), TEXT("."), TEXT("Y / TRIANGLE") },
		{ TEXT("GRAB / PICK UP / THROW"), TEXT("L"), TEXT("H"), TEXT("/"), TEXT("B / CIRCLE") },
		{ TEXT("BLOCK (HOLD)"), TEXT("I"), TEXT("R"), TEXT("M"), TEXT("RB") },
		{ TEXT("DODGE"), TEXT("SPACE"), TEXT("SPACE"), TEXT("N"), TEXT("A / CROSS") },
		{ TEXT("RUN (HOLD)"), TEXT("L SHIFT"), TEXT("L SHIFT"), TEXT("R SHIFT"), TEXT("RT") },
		{ TEXT("SIGNATURE / CURTAIN CALL"), TEXT("U"), TEXT("T"), TEXT("L"), TEXT("LB") },
		{ TEXT("TAUNT"), TEXT("O"), TEXT("Y"), TEXT(";"), TEXT("BACK") },
	};
	const float RowH = bCompact ? 40.f : 50.f;
	const float Pt = bCompact ? 26.f : 32.f;
	const float C1 = X + 470.f, C2 = X + 680.f, C3 = X + 890.f, C4 = X + 1100.f;
	Txt(TEXT("ONE PLAYER"), C1, Y, ECpvFont::Bold, Pt * 0.8f, Gold, ECpvAlign::Center);
	Txt(TEXT("2P: LEFT"), C2, Y, ECpvFont::Bold, Pt * 0.8f, Gold, ECpvAlign::Center);
	Txt(TEXT("2P: RIGHT"), C3, Y, ECpvFont::Bold, Pt * 0.8f, Gold, ECpvAlign::Center);
	Txt(TEXT("GAMEPAD"), C4, Y, ECpvFont::Bold, Pt * 0.8f, Gold, ECpvAlign::Center);
	for (int32 i = 0; i < UE_ARRAY_COUNT(Rows); ++i)
	{
		const float RY = Y + 44.f + i * RowH;
		if (i % 2 == 0) { Box(X - 16.f, RY - 4.f, 1260.f, RowH, FLinearColor(1.f, 1.f, 1.f, 0.05f)); }
		Txt(Rows[i].Action, X, RY, ECpvFont::Semi, Pt, White);
		Txt(Rows[i].One, C1, RY, ECpvFont::Bold, Pt, White, ECpvAlign::Center);
		Txt(Rows[i].TwoA, C2, RY, ECpvFont::Bold, Pt, Dim, ECpvAlign::Center);
		Txt(Rows[i].TwoB, C3, RY, ECpvFont::Bold, Pt, Dim, ECpvAlign::Center);
		Txt(Rows[i].Pad, C4, RY, ECpvFont::Bold, Pt, Dim, ECpvAlign::Center);
	}
}

void ACpvHUD::DrawHowTo()
{
	Box(0.f, 0.f, W, H, FLinearColor(0.f, 0.f, 0.03f, 0.84f));
	Out(TEXT("RING SCHOOL"), 110.f, 50.f, ECpvFont::Title, 84.f, Gold, Ink, 5.f);
	DrawControls(126.f, 190.f, false);
	DrawBack();
	Hit(110.f, 993.f, 790.f, 78.f, ECpvClick::Accept);
	const TCHAR* Tips[] = {
		TEXT("Strikes beat grabs. Grabs beat guards. Block just before impact for extra ratings and a counter opening."),
		TEXT("In a grab:  JAB = headbutt,  HEAVY = body slam,  GRAB + direction = whip them into the ropes."),
		TEXT("Run into the ropes to bounce off them; attacks out of a bounce hit harder."),
		TEXT("Hits and taunts fill your RATINGS bar. When it is full, unleash your signature move."),
		TEXT("In exhibition, GRAB a grounded rival to pin. The defender taps JAB in the gold to kick out."),
		TEXT("Win the deciding round by knockout and your rival is left reeling: get close and press SIGNATURE for a CURTAIN CALL."),
	};
	for (int32 i = 0; i < UE_ARRAY_COUNT(Tips); ++i)
	{
		Box(126.f, 728.f + i * 46.f + 12.f, 10.f, 10.f, Gold);
		Txt(Tips[i], 152.f, 728.f + i * 46.f, ECpvFont::Medium, 28.f, White);
	}
	Txt(TEXT("ENTER / A   Rehearse in the ring"), 126.f, 1008.f, ECpvFont::Bold, 33.f, Gold);
	Txt(TEXT("ESC / B   Back"), W - 120.f, 1010.f, ECpvFont::Medium, 24.f, Dim, ECpvAlign::Right, 0.f, 20);
}

void ACpvHUD::DrawCredits()
{
	Box(0, 0, W, H, FLinearColor(0.012f, 0.014f, 0.035f, 0.94f));
	const float X = W * 0.5f - 736.f;
	Txt(TEXT("CLAY-PER-VIEW"), X, 66.f, ECpvFont::Bold, 30.f, Gold, ECpvAlign::Left, 0.f, 70);
	Out(TEXT("END CREDITS"), X, 118.f, ECpvFont::Title, 86.f, White, Ink, 4.f);
	DrawBack();
	Hit(X, 983.f, 600.f, 74.f, ECpvClick::Back);
	const TCHAR* Roles[] = {TEXT("PLAY-BY-PLAY"), TEXT("COLOUR COMMENTARY"), TEXT("RING OFFICIAL")};
	const TCHAR* Ids[] = {TEXT("Dirk"), TEXT("Nigel"), TEXT("Ref")};
	const TCHAR* Names[] = {TEXT("DIRK"), TEXT("NIGEL"), TEXT("THE REFEREE")};
	for (int32 i = 0; i < 3; ++i)
	{
		const float Left = X + i * 492.f;
		Box(Left, 291.f, 464.f, 185.f, FLinearColor(0.06f, 0.07f, 0.11f));
		Pic(Portrait(Ids[i]), Left + 6.f, 295.f, 177.f, 177.f);
		Txt(Roles[i], Left + 184.f, 338.f, ECpvFont::Bold, 22.f, Gold);
		Txt(Names[i], Left + 184.f, 381.f, ECpvFont::ExtraItalic, 39.f, White);
	}
	const TCHAR* Labels[] = {TEXT("ART & ANIMATION"), TEXT("SOUND"), TEXT("GAME & TOOLS"), TEXT("TYPEFACES")};
	const TCHAR* Details[] = {TEXT("Original Blender sculpts, procedural clay surfaces and pose-to-pose animation."),
		TEXT("Original synthesized score and effects. Voices generated with Kokoro-82M."),
		TEXT("Built in Unreal Engine. AI-assisted code, scripts and writing."),
		TEXT("Titan One, Anton, Bangers and Barlow Condensed. SIL Open Font License 1.1.")};
	for (int32 i = 0; i < 4; ++i)
	{
		const float Y = 555.f + i * 89.f;
		Box(X, Y, 1470.f, 2.f, FLinearColor(0.13f, 0.15f, 0.19f));
		Txt(Labels[i], X, Y + 20.f, ECpvFont::Bold, 28.f, Gold);
		Txt(Details[i], X + 308.f, Y + 18.f, ECpvFont::Semi, 29.f, White);
	}
	Txt(TEXT("ENTER / A   Return to menu"), X, 996.f, ECpvFont::Bold, 30.f, White);
}

void ACpvHUD::DrawSelect()
{
	Shade(0.f, 300.f, 0.8f, 0.f);
	Shade(600.f, H, 0.f, 0.9f);
	Out(G->IsRun() ? TEXT("CAST YOUR HEADLINER") : TEXT("CHOOSE YOUR CELEBRITY"), W * 0.5f, 34.f, ECpvFont::Title, 70.f, Gold, Ink, 4.f, ECpvAlign::Center);
	const TArray<FCpvFighterDef>& Roster = CpvData::Roster();
	if (G->IsRun())
	{
		const float CardW = 382.f;
		for (int32 Stage = 0; Stage < 3; ++Stage)
		{
			const float X = W * 0.5f - 1.5f * CardW + Stage * CardW;
			const FCpvFighterDef& Rival = Roster[G->RivalForEpisode(Stage)];
			Slant(X, 140.f, CardW - 8.f, 74.f, 10.f, Panel);
			Pic(Portrait(Rival.Id), X + 6.f, 142.f, 68.f, 68.f);
			Txt(FString::Printf(TEXT("BOUT %d"), Stage + 1), X + 86.f, 149.f, ECpvFont::Bold, 20.f, Gold);
			Txt(Rival.Name, X + 86.f, 180.f, ECpvFont::Bold, 23.f, White);
		}
	}
	DrawBack();
	const float Cell = 148.f, Gap = 12.f;
	const float GridW = 4 * Cell + 3 * Gap;
	const float GX = W * 0.5f - GridW * 0.5f, GY = 716.f;
	for (int32 i = 0; i < Roster.Num(); ++i)
	{
		const float X = GX + (i % 4) * (Cell + Gap), Y = GY + (i / 4) * (Cell + Gap);
		Hit(X, Y, Cell, Cell, ECpvClick::Roster, i);
		Box(X, Y, Cell, Cell, FLinearColor(0.03f, 0.035f, 0.07f, 0.95f));
		Box(X, Y + Cell - 34.f, Cell, 34.f, Fade(Roster[i].Colour, 0.85f));
		Pic(Portrait(Roster[i].Id), X + 4.f, Y + 2.f, Cell - 8.f, Cell - 8.f);
		if (G->IsRun() && G->IsChampion(i))
		{
			Box(X, Y + Cell - 28.f, Cell, 28.f, Gold);
			Txt(G->BestShow[G->Difficulty][i] > 0 ? FString::Printf(TEXT("CHAMP   %d/9"), G->BestShow[G->Difficulty][i]) : TEXT("CHAMPION"), X + Cell * 0.5f, Y + Cell - 28.f, ECpvFont::Bold, 22.f, Ink, ECpvAlign::Center);
		}
		for (int32 Slot = 0; Slot < 2; ++Slot)
		{
			if (G->Cursor[Slot] != i) { continue; }
			const FLinearColor C = SlotColour(Slot);
			const float Inset = Slot == 0 ? 0.f : 7.f;
			const float Blink = G->bLocked[Slot] ? 1.f : 0.55f + 0.45f * Pulse(G->RealTime, 9.f);
			CpvUi::Frame(Canvas, (X - 6.f + Inset) * S, (Y - 6.f + Inset) * S, (Cell + 12.f - Inset * 2.f) * S, (Cell + 12.f - Inset * 2.f) * S, Fade(C, Blink), 7.f * S);
			const FString Tag = Slot == 0 ? TEXT("P1") : (G->Mode == ECpvMode::TwoPlayer ? TEXT("P2") : TEXT("CPU"));
			const float TX = Slot == 0 ? X - 6.f : X + Cell - 58.f;
			Box(TX, Y - 34.f, 64.f, 30.f, C);
			Txt(Tag, TX + 32.f, Y - 35.f, ECpvFont::Bold, 26.f, White, ECpvAlign::Center);
		}
	}
	for (int32 Slot = 0; Slot < 2; ++Slot)
	{
		const FCpvFighterDef& D = Roster[G->Cursor[Slot]];
		const bool bRight = Slot == 1;
		const float PX = bRight ? W - 560.f : 60.f;
		const ECpvAlign Al = bRight ? ECpvAlign::Right : ECpvAlign::Left;
		const float TX = bRight ? W - 80.f : 80.f;
		Slant(PX, 716.f, 500.f, 304.f, bRight ? -18.f : 18.f, Panel);
		Box(bRight ? W - 72.f : 60.f, 716.f, 12.f, 304.f, SlotColour(Slot));
		Out(D.Name, TX, 722.f, ECpvFont::ExtraItalic, Width(D.Name, ECpvFont::ExtraItalic, 60.f) > 450.f ? 46.f : 60.f, White, Ink, 3.f, Al);
		Txt(D.Title, TX, 790.f, ECpvFont::Semi, 27.f, Gold, Al);
		Txt(D.Quote, TX, 826.f, ECpvFont::Medium, 23.f, Dim, Al);
		const TCHAR* StatNames[3] = { TEXT("POWER"), TEXT("SPEED"), TEXT("GUTS") };
		const int32 Stats[3] = { D.Power, D.Speed, D.Guts };
		for (int32 k = 0; k < 3; ++k)
		{
			const float SY = 868.f + k * 30.f;
			Txt(StatNames[k], bRight ? W - 80.f : 80.f, SY, ECpvFont::Bold, 22.f, White, Al);
			for (int32 Pip = 0; Pip < 5; ++Pip)
			{
				const float BX = bRight ? W - 190.f - Pip * 34.f - 28.f : 190.f + Pip * 34.f;
				Slant(BX, SY + 5.f, 28.f, 17.f, 5.f, Pip < Stats[k] ? D.Colour : FLinearColor(1.f, 1.f, 1.f, 0.14f));
			}
		}
		Txt(FString::Printf(TEXT("SIGNATURE: %s"), D.SpecialName), TX, 962.f, ECpvFont::Bold, 23.f, Gold, Al);
		Txt(FString::Printf(TEXT("CURTAIN CALL: %s"), D.FinisherName), TX, 988.f, ECpvFont::Bold, 23.f, FLinearColor(1.f, 0.45f, 0.4f), Al);
		if (G->bLocked[Slot]) { Out(TEXT("LOCKED IN"), bRight ? W - 310.f : 310.f, 660.f, ECpvFont::ExtraItalic, 40.f, Gold, Ink, 3.f, ECpvAlign::Center); }
	}
	const bool bWatch = G->Mode == ECpvMode::Watch;
	const TCHAR* Hint = G->Mode == ECpvMode::TwoPlayer ? TEXT("P1: W A S D + F          P2: ARROWS + ,          ESC  back")
		: (G->bLocked[0] && G->bLocked[1]) ? TEXT("Places, everyone...          ESC  back")
		: G->bLocked[0] ? (bWatch ? TEXT("Now pick their rival          ENTER  lock in          ESC  back") : TEXT("Now pick your opponent          ENTER  lock in          ESC  back"))
		: (bWatch ? TEXT("W A S D  choose the first star          ENTER  lock in          ESC  back") : TEXT("W A S D  choose your star          ENTER  lock in          ESC  back"));
	Txt(G->IsRun() ? TEXT("W A S D or D-pad   Cast your star       ENTER / A   Start the run       ESC / B   Back") : Hint, W * 0.5f, 1040.f, ECpvFont::Medium, 24.f, Dim, ECpvAlign::Center, 0.f, 20);
}

void ACpvHUD::DrawVersus()
{
	const float T = G->PhaseTime;
	const float In = FMath::Clamp(T / 0.35f, 0.f, 1.f);
	const float Slide = (1.f - In * In * (3.f - 2.f * In)) * 900.f;
	const FCpvFighterDef& A = G->Fighters[0]->Def();
	const FCpvFighterDef& B = G->Fighters[1]->Def();
	Box(0.f, 0.f, W, H, FLinearColor(0.f, 0.f, 0.02f, 0.72f));
	Slant(-80.f - Slide, 240.f, W * 0.5f + 60.f, 520.f, 110.f, Fade(A.Colour, 0.92f));
	Slant(W * 0.5f - 80.f + Slide, 320.f, W * 0.5f + 160.f, 520.f, 110.f, Fade(B.Colour, 0.92f));
	Pic(Portrait(A.Id), 140.f - Slide, 250.f, 520.f, 520.f);
	Pic(Portrait(B.Id), W - 660.f + Slide, 330.f, 520.f, 520.f, G->IsMirror() ? ACpvGameMode::TwinTint() : White, true);
	Out(A.Name, 120.f - Slide, 772.f, ECpvFont::ExtraItalic, 78.f, White, Ink, 5.f);
	Out(B.Name, W - 120.f + Slide, 860.f, ECpvFont::ExtraItalic, 78.f, White, Ink, 5.f, ECpvAlign::Right);
	Txt(A.Title, 124.f - Slide, 860.f, ECpvFont::Semi, 32.f, Gold, ECpvAlign::Left, 2.f);
	Txt(B.Title, W - 124.f + Slide, 948.f, ECpvFont::Semi, 32.f, Gold, ECpvAlign::Right, 2.f);
	const float Pop = T < 0.5f ? 0.f : FMath::Min(1.f, (T - 0.5f) / 0.15f);
	if (Pop > 0.f)
	{
		Out(TEXT("VS"), W * 0.5f, 400.f - 30.f * (1.f - Pop), ECpvFont::Title, 210.f * (0.7f + 0.3f * Pop), Gold, Ink, 9.f, ECpvAlign::Center);
	}
	if (G->IsRun())
	{
		Txt(FString::Printf(TEXT("RATINGS RUN   /   BOUT %d OF 3"), G->Episode + 1), W * 0.5f, 42.f, ECpvFont::Bold, 31.f, Gold, ECpvAlign::Center, 1.f, 80);
		Out(G->EpisodeName(), W * 0.5f, 93.f, ECpvFont::Title, 70.f, White, Ink, 4.f, ECpvAlign::Center);
		Txt(G->EpisodeRule(), W * 0.5f, 187.f, ECpvFont::Semi, 32.f, White, ECpvAlign::Center, 2.f);
	}
	else
	{
		DrawLogo(W * 0.5f, 40.f, 70.f);
		Txt(G->bPins ? TEXT("PINFALL OR KNOCKOUT") : TEXT("KNOCKOUT RULES"), W * 0.5f, 180.f, ECpvFont::Bold, 30.f, White, ECpvAlign::Center, 2.f, 36);
	}
}

void ACpvHUD::DrawFighterBar(const ACpvFighter* F, bool bRight)
{
	const FCpvFighterDef& D = F->Def();
	const float Dir = bRight ? -1.f : 1.f;
	const float Edge = bRight ? W - 40.f : 40.f;
	const float BarW = FMath::Min(760.f, W * 0.5f - 150.f);
	// Portrait tile.
	const float PX = bRight ? Edge - 118.f : Edge;
	Box(PX, 30.f, 118.f, 118.f, Ink);
	Box(PX, 30.f, 118.f, 118.f, Fade(D.Colour, 0.55f));
	Pic(Portrait(D.Id), PX + 2.f, 30.f, 114.f, 114.f, bRight && G->IsMirror() ? ACpvGameMode::TwinTint() : White, bRight);
	CpvUi::Frame(Canvas, PX * S, 30.f * S, 118.f * S, 118.f * S, SlotColour(F->Slot), 5.f * S);
	// Health: a slanted bar that empties toward the outside edge, with a white flash trailing the damage.
	const float X0 = bRight ? Edge - 132.f - BarW : Edge + 132.f;
	const float Skew = bRight ? -16.f : 16.f;
	Slant(X0 - 5.f, 37.f, BarW + 10.f, 50.f, Skew, Ink);
	Slant(X0, 42.f, BarW, 40.f, Skew, FLinearColor(0.16f, 0.02f, 0.02f));
	const float Frac = FMath::Clamp(F->Health / CpvRule::MaxHealth, 0.f, 1.f);
	const float Trail = FMath::Clamp(F->ShownHealth / CpvRule::MaxHealth, 0.f, 1.f);
	const FLinearColor Life = Frac > 0.5f ? FLinearColor(0.35f, 0.85f, 0.2f) : (Frac > 0.25f ? Gold : FLinearColor(1.f, 0.22f, 0.12f));
	if (bRight)
	{
		Slant(X0, 42.f, BarW * Trail, 40.f, Skew, FLinearColor(1.f, 1.f, 1.f, 0.9f));
		Slant(X0, 42.f, BarW * Frac, 40.f, Skew, Life);
	}
	else
	{
		Slant(X0 + BarW * (1.f - Trail), 42.f, BarW * Trail, 40.f, Skew, FLinearColor(1.f, 1.f, 1.f, 0.9f));
		Slant(X0 + BarW * (1.f - Frac), 42.f, BarW * Frac, 40.f, Skew, Life);
	}
	Out(D.Name, bRight ? X0 + BarW - 8.f : X0 + 8.f, 86.f, ECpvFont::ExtraItalic, 34.f, White, Ink, 2.5f, bRight ? ECpvAlign::Right : ECpvAlign::Left);
	// Ratings (signature meter).
	const float MW = BarW * 0.56f;
	const float MX = bRight ? X0 + BarW - MW : X0;
	const float Hype = F->Hype / CpvRule::MaxHype;
	const bool bFull = F->HasFullHype();
	Slant(MX - 4.f, 128.f, MW + 8.f, 22.f, Skew * 0.4f, Ink);
	const FLinearColor Meter = bFull ? FMath::Lerp(Gold, White, Pulse(G->RealTime, 12.f)) : D.Colour;
	if (bRight) { Slant(MX + MW * (1.f - Hype), 131.f, MW * Hype, 16.f, Skew * 0.4f, Meter); }
	else { Slant(MX, 131.f, MW * Hype, 16.f, Skew * 0.4f, Meter); }
	Txt(bFull ? TEXT("SIGNATURE READY") : TEXT("RATINGS"), bRight ? MX - 12.f : MX + MW + 12.f, 124.f, ECpvFont::Bold, 22.f, bFull ? Gold : Dim, bRight ? ECpvAlign::Right : ECpvAlign::Left, 2.f);
	// Round wins.
	for (int32 i = 0; i < G->RequiredWins(); ++i)
	{
		const float SX = bRight ? X0 - 6.f + i * 34.f : X0 + BarW - 22.f - i * 34.f;
		Slant(SX, 92.f, 26.f, 26.f, 0.f, Ink);
		Slant(SX + 4.f, 96.f, 18.f, 18.f, 0.f, i < G->Wins[F->Slot] ? Gold : FLinearColor(1.f, 1.f, 1.f, 0.16f));
	}
	// Weapon in hand, combo counter, move call-outs.
	float InfoY = 160.f;
	if (F->Weapon != ECpvWeapon::None)
	{
		Txt(FString::Printf(TEXT("%s  x%d"), CpvData::Weapon(F->Weapon).Name, F->WeaponUses), bRight ? Edge : Edge, InfoY, ECpvFont::Bold, 26.f, Gold,
			bRight ? ECpvAlign::Right : ECpvAlign::Left, 2.f);
		InfoY += 32.f;
	}
	if (F->Combo >= 2)
	{
		Out(FString::Printf(TEXT("%d HITS!"), F->Combo), Edge, InfoY, ECpvFont::ExtraItalic, 52.f + FMath::Min(F->Combo, 8) * 3.f, Gold, Ink, 3.f,
			bRight ? ECpvAlign::Right : ECpvAlign::Left);
		InfoY += 70.f;
	}
	if (G->MoveCalloutLeft[F->Slot] > 0.f && !G->MoveCallout[F->Slot].IsEmpty())
	{
		const float A = FMath::Min(1.f, G->MoveCalloutLeft[F->Slot] / 0.3f);
		Out(G->MoveCallout[F->Slot], Edge, InfoY, ECpvFont::ExtraItalic, 46.f, Fade(White, A), Fade(D.Colour, A), 3.f, bRight ? ECpvAlign::Right : ECpvAlign::Left);
	}
}

void ACpvHUD::DrawFight()
{
	DrawFighterBar(G->Fighters[0], false);
	DrawFighterBar(G->Fighters[1], true);
	if (G->IsRehearsing())
	{
		static const TCHAR* Titles[] = {TEXT("LAND A JAB"), TEXT("CATCH THE PUNCH"), TEXT("BODY SLAM"), TEXT("HIT YOUR SIGNATURE"), TEXT("YOU'RE READY FOR AIR")};
		static const TCHAR* Inputs[] = {TEXT("Walk in with WASD or the stick. Tap J / X to jab."), TEXT("Face your partner. Hold I / RB until you block the jab."),
			TEXT("Up close, tap L / B to grab. Then tap K / Y to slam."), TEXT("Your ratings are full. Tap U / LB to fire your signature."),
			TEXT("ENTER / A   Cast your headliner for the Ratings Run")};
		const int32 Cue = G->Lesson;
		if (Cue == 4) { Hit(W * 0.5f - 495.f, H - 196.f, 990.f, 152.f, ECpvClick::Accept); }
		const float X = W * 0.5f - 495.f;
		const float Y = H - 196.f;
		Slant(X, Y, 990.f, 152.f, 8.f, Panel);
		Box(X + 6.f, Y + 5.f, 7.f, 142.f, Gold);
		Txt(Cue == 4 ? TEXT("RING SCHOOL   /   WRAP") : FString::Printf(TEXT("RING SCHOOL   /   CUE %d OF 4"), Cue + 1),
			X + 36.f, Y + 9.f, ECpvFont::Bold, 23.f, Gold);
		Txt(G->CueHold > 0.f ? TEXT("GOT IT!") : Titles[Cue], X + 36.f, Y + 38.f, ECpvFont::ExtraItalic, 45.f, White);
		Txt(Inputs[Cue], X + 36.f, Y + 102.f, ECpvFont::Semi, 29.f, White);
		return;
	}
	// Clock.
	const FString Clock = (G->IsRun() || G->RoundSeconds > 0) ? FString::Printf(TEXT("%d"), FMath::CeilToInt(G->RoundClock)) : FString(TEXT("--"));
	Slant(W * 0.5f - 62.f, 28.f, 124.f, 84.f, 0.f, Ink);
	Slant(W * 0.5f - 56.f, 34.f, 112.f, 72.f, 0.f, G->RoundClock < 10.f && (G->IsRun() || G->RoundSeconds > 0) ? Red : FLinearColor(0.07f, 0.08f, 0.14f));
	Txt(Clock, W * 0.5f, 30.f, ECpvFont::Impact, 62.f, White, ECpvAlign::Center);
	Txt(FString::Printf(TEXT("TAKE %d"), G->Round), W * 0.5f, 114.f, ECpvFont::Bold, 22.f, Gold, ECpvAlign::Center, 2.f, 40);

	if (G->IsRun() && G->FinisherPrompt <= 0.f)
	{
		const FString Request = G->bCrowdCall ? TEXT("CROWD CALL   /   COMPLETE") : FString(TEXT("CROWD CALL   /   ")) + G->CrowdCall();
		const float BW = Width(Request, ECpvFont::Bold, 24.f) + 46.f;
		Slant(42.f, H - 70.f, BW, 41.f, 8.f, Panel);
		Txt(Request, 63.f, H - 66.f, ECpvFont::Bold, 24.f, G->bCrowdCall ? Gold : White);
	}
	if (G->PinSlot >= 0) { DrawCover(); return; }
	if (G->Phase == ECpvPhase::Fight && !G->IsRun())
	{
		for (int32 Slot = 0; Slot < 2; ++Slot)
		{
			if (!G->IsHuman(Slot) || !G->CanCover(G->Fighters[Slot])) { continue; }
			const TCHAR* Button = G->Mode == ECpvMode::TwoPlayer ? (Slot == 0 ? TEXT("H / B") : TEXT("/  or  B")) : TEXT("L / B");
			const float X = Slot == 0 ? 56.f : W - 386.f;
			Slant(X, 296.f, 332.f, 47.f, 8.f, Panel);
			Txt(FString::Printf(TEXT("PIN   %s"), Button), X + 19.f, 300.f, ECpvFont::Bold, 30.f, Gold);
		}
	}
	// Curtain Call prompt.
	if (G->FinisherPrompt > 0.f && G->FinisherFor >= 0 && G->Phase == ECpvPhase::Fight)
	{
		const float P = Pulse(G->RealTime, 10.f);
		const FCpvFighterDef& D = G->Fighters[G->FinisherFor]->Def();
		Out(TEXT("CURTAIN CALL!"), W * 0.5f, 770.f, ECpvFont::Title, 96.f + 8.f * P, FMath::Lerp(Gold, White, P), Red, 6.f, ECpvAlign::Center);
		const bool bHuman = G->IsHuman(G->FinisherFor);
		const FString How = bHuman ? FString::Printf(TEXT("GET CLOSE AND PRESS SIGNATURE:  %s"), D.FinisherName) : FString::Printf(TEXT("%s IS LINING UP:  %s"), D.Name, D.FinisherName);
		Slant(W * 0.5f - 430.f, 892.f, 860.f, 48.f, 14.f, Panel);
		Txt(How, W * 0.5f, 898.f, ECpvFont::Bold, 30.f, White, ECpvAlign::Center);
		const float Left = FMath::Clamp(G->FinisherPrompt / CpvRule::DazedTime, 0.f, 1.f);
		Slant(W * 0.5f - 300.f, 948.f, 600.f, 14.f, 5.f, Ink);
		Slant(W * 0.5f - 300.f, 948.f, 600.f * Left, 14.f, 5.f, Gold);
	}
	// The optional meter occupies the station badge so it never covers either combo counter.
	if (G->bPerformanceHud && G->MeasuredFPS > 0.f)
	{
		Slant(W - 280.f, H - 70.f, 240.f, 40.f, 10.f, Panel);
		Txt(FString::Printf(TEXT("%.0f FPS  /  %.1f MS"), G->MeasuredFPS, 1000.f / G->MeasuredFPS),
			W - 53.f, H - 65.f, ECpvFont::Bold, 25.f, White, ECpvAlign::Right);
		return;
	}
	Slant(W - 232.f, H - 70.f, 192.f, 40.f, 10.f, Fade(Ink, 0.75f));
	Box(W - 214.f, H - 57.f, 14.f, 14.f, FMath::Lerp(Red, White, 0.2f * Pulse(G->RealTime, 3.f)));
	Txt(TEXT("CPV  LIVE"), W - 190.f, H - 68.f, ECpvFont::Bold, 26.f, White, ECpvAlign::Left, 0.f, 40);
}

void ACpvHUD::DrawCover()
{
	const int32 Defender = 1 - G->PinSlot;
	const float X = W * 0.5f - 380.f, Y = H - 268.f;
	Slant(X, Y, 760.f, 212.f, 8.f, Panel);
	const FString Header = FString::Printf(TEXT("%s   /   COVER"), G->Fighters[G->PinSlot]->Def().Name);
	Txt(Header, X + 39.f, Y + 12.f, ECpvFont::Bold, 27.f, Gold);
	for (int32 i = 0; i < 3; ++i)
	{
		Box(X + 585.f + i * 44.f, Y + 16.f, 36.f, 36.f, i < G->PinCount ? Gold : Ink);
		Txt(FString::FromInt(i+1), X + 603.f + i * 44.f, Y + 15.f, ECpvFont::Bold, 27.f, i < G->PinCount ? Ink : Dim, ECpvAlign::Center);
	}
	if (G->PinCount == 3)
	{
		Txt(TEXT("THREE!  THAT'S THE FALL."), X + 39.f, Y + 72.f, ECpvFont::ExtraItalic, 51.f, Gold);
		return;
	}
	const TCHAR* Key = G->Mode == ECpvMode::TwoPlayer ? (Defender == 0 ? TEXT("F / X") : TEXT("COMMA / X")) : TEXT("J / X");
	const FString Prompt = !G->IsHuman(Defender) ? FString(G->Fighters[Defender]->Def().Name) + TEXT(" IS UNDER THE COUNT")
		: G->bPinMiss ? TEXT("MISSED   /   TRY ON THE NEXT COUNT") : FString::Printf(TEXT("P%d   TAP %s IN THE GOLD TO KICK OUT"), Defender + 1, Key);
	const float PromptSize = FMath::Min(34.f, 34.f * 683.f / FMath::Max(1.f, Width(Prompt, ECpvFont::Bold, 34.f)));
	Txt(Prompt, X + 38.f, Y + 67.f, ECpvFont::Bold, PromptSize, White);
	const float Track = 680.f, Left = X + 39.f, Top = Y + 142.f;
	Box(Left, Top, Track, 28.f, FLinearColor(0.16f,0.18f,0.24f));
	Box(Left + Track * G->EscapeStart(), Top, Track * (G->EscapeEnd() - G->EscapeStart()), 28.f, Gold);
	const float Mark = Left + Track * G->EscapeNeedle();
	Box(Mark - 6.f, Top-8.f, 12.f, 44.f, Ink);
	Box(Mark - 2.5f, Top-6.f, 5.f, 40.f, White);
}

void ACpvHUD::DrawBanner()
{
	const FCpvBanner& B = G->Banner;
	if (B.Life <= 0.f || B.Text.IsEmpty()) { return; }
	if (G->Phase == ECpvPhase::MatchEnd)
	{
		const bool bTitle = G->IsRun() && G->Episode == 2 && G->Winner == 0;
		const FString Name = G->Fighters[G->Winner]->Def().Name;
		const TCHAR* Label = bTitle ? TEXT("PRIME-TIME CHAMPION") : G->bWonByPin ? TEXT("WINNER   /   PINFALL") : TEXT("WINNER   /   THAT'S A WRAP");
		const float X = 64.f, Y = H - 300.f;
		const float WidthName = FMath::Max(440.f, Width(Name, ECpvFont::ExtraItalic, 68.f) + 86.f);
		Slant(X, Y, WidthName, 126.f, 14.f, Panel);
		Box(X + 12.f, Y + 12.f, 6.f, 102.f, Gold);
		Txt(Label, X + 35.f, Y + 10.f, ECpvFont::Bold, 25.f, Gold, ECpvAlign::Left, 0.f, 45);
		Txt(Name, X + 32.f, Y + 38.f, ECpvFont::ExtraItalic, 68.f, White);
		return;
	}
	const float U = B.Age / B.Life;
	const float In = FMath::Clamp(B.Age / 0.14f, 0.f, 1.f);
	const float OutA = U > 0.85f ? (1.f - U) / 0.15f : 1.f;
	const float Scale = B.Scale * (In < 1.f ? FMath::Lerp(1.7f, 1.f, In) : 1.f + 0.03f * FMath::Sin(B.Age * 9.f));
	const float Size = 150.f * Scale;
	float Fit = Size;
	while (Fit > 40.f && Width(B.Text, ECpvFont::Title, Fit) > W - 160.f) { Fit -= 6.f; }
	const bool bSmall = B.Scale < 0.7f;
	const float Y = bSmall ? 236.f : 390.f - Fit * 0.5f;
	const float TW = Width(B.Text, ECpvFont::Title, Fit);
	Slant(W * 0.5f - TW * 0.5f - 60.f, Y + Fit * 0.18f, TW + 120.f, Fit * 0.95f, 30.f, Fade(Ink, 0.72f * OutA));
	Out(B.Text, W * 0.5f, Y, ECpvFont::Title, Fit, Fade(B.Colour, OutA), Fade(Ink, OutA), Fit * 0.055f, ECpvAlign::Center);
	if (!B.Sub.IsEmpty())
	{
		Out(B.Sub, W * 0.5f, Y + Fit * 1.2f, ECpvFont::ExtraItalic, FMath::Max(30.f, Fit * 0.34f), Fade(White, OutA), Fade(Ink, OutA), 3.f, ECpvAlign::Center, 40);
	}
}

void ACpvHUD::DrawSubtitle()
{
	const FCpvSubtitle& Sub = G->Subtitle;
	if (Sub.Left <= 0.f || Sub.Text.IsEmpty() || G->Phase == ECpvPhase::Select || G->Phase == ECpvPhase::Results) { return; }
	const FString& Words = G->bPortugueseSubtitles && !Sub.Portuguese.IsEmpty() ? Sub.Portuguese : Sub.Text;
	const float A = FMath::Min(1.f, Sub.Left / 0.25f);
	const bool bAnnouncer = Sub.Speaker == INDEX_NONE;
	const TCHAR* Who = bAnnouncer ? (G->IsRehearsing() ? TEXT("RING COACH") : TEXT("RING ANNOUNCER")) : (Sub.Speaker == 0 ? TEXT("DIRK BLUSTER") : TEXT("NIGEL QUIBBLE"));
	if (bAnnouncer && G->bPortugueseSubtitles) { Who = G->IsRehearsing() ? TEXT("TREINADOR") : TEXT("LOCUTOR"); }
	const FLinearColor Tag = bAnnouncer ? FLinearColor(0.48f, 0.8f, 0.85f) : (Sub.Speaker == 0 ? FLinearColor(0.79f, 0.58f, 0.17f) : FLinearColor(0.49f, 0.47f, 0.41f));
	float Size = 34.f;
	while (Size > 22.f && Width(Words, ECpvFont::Semi, Size) > W - 520.f) { Size -= 2.f; }
	const float TW = Width(Words, ECpvFont::Semi, Size);
	const float X = W * 0.5f - TW * 0.5f;
	float Y = H - (G->Letterbox > 0.5f ? 80.f : 102.f);
	if (G->IsRehearsing() || G->FinisherPrompt > 0.f) { Y = H - 264.f; }
	if (G->PinSlot >= 0) { Y = H - 355.f; }
	Slant(X - 30.f, Y, TW + 60.f, 52.f, 12.f, Fade(Panel, A));
	Slant(X - 30.f, Y - 30.f, Width(Who, ECpvFont::Bold, 22.f, 30) + 36.f, 30.f, 8.f, Fade(Tag, A));
	Txt(Who, X - 14.f, Y - 29.f, ECpvFont::Bold, 22.f, Fade(Ink, A), ECpvAlign::Left, 0.f, 30);
	Txt(Words, X, Y + 6.f + (34.f - Size) * 0.5f, ECpvFont::Semi, Size, Fade(White, A));
}

void ACpvHUD::DrawNameCard()
{
	if (G->NameCard.IsEmpty()) { return; }
	const float In = FMath::Clamp(G->NameCardAge / 0.3f, 0.f, 1.f);
	const float X = 110.f - (1.f - In * In * (3.f - 2.f * In)) * 900.f;
	const float NW = FMath::Max(Width(G->NameCard, ECpvFont::ExtraItalic, 84.f), Width(G->NameCardSub, ECpvFont::Semi, 34.f)) + 90.f;
	Slant(X - 30.f, 800.f, NW, 96.f, 26.f, Gold);
	Slant(X - 44.f, 800.f, 12.f, 96.f, 26.f, Red);
	Slant(X - 54.f, 896.f, NW - 20.f, 52.f, 14.f, Panel);
	Txt(G->NameCard, X + 10.f, 800.f, ECpvFont::ExtraItalic, 84.f, Ink);
	Txt(G->NameCardSub, X - 16.f, 902.f, ECpvFont::Semi, 34.f, White);
	Txt(TEXT("ENTER  skip"), W - 110.f, 1010.f, ECpvFont::Medium, 24.f, Dim, ECpvAlign::Right, 2.f, 20);
}

void ACpvHUD::DrawResults()
{
	Box(0.f, 0.f, W, H, FLinearColor(0.f, 0.f, 0.03f, 0.62f));
	const int32 Wn = FMath::Max(G->Winner, 0);
	const FCpvFighterDef& D = G->Fighters[Wn]->Def();
	const bool bTitle = G->IsRun() && G->Episode == 2 && Wn == 0;
	const TCHAR* Headline = !G->IsRun() ? TEXT("THAT'S A WRAP!") : bTitle ? TEXT("PRIME-TIME CHAMPION!") : Wn == 0 ? TEXT("RENEWED!") : TEXT("OFF THE AIR!");
	Out(Headline, W * 0.5f, 40.f, ECpvFont::Title, 104.f, Gold, Ink, 5.f, ECpvAlign::Center);
	Slant(W * 0.5f - 430.f, 196.f, 860.f, 70.f, 20.f, D.Colour);
	Out(FString(G->bWonByPin ? TEXT("WIN BY PINFALL   ") : TEXT("WINNER   ")) + D.Name, W * 0.5f, 198.f, ECpvFont::ExtraItalic, 58.f, White, Ink, 3.f, ECpvAlign::Center);

	const float TX = W * 0.5f - 480.f;
	Slant(TX, 300.f, 960.f, 330.f, 24.f, Panel);
	const TCHAR* Rows[4] = { TEXT("DAMAGE DEALT"), TEXT("HITS LANDED"), TEXT("BEST COMBO"), TEXT("TAUNTS") };
	for (int32 Slot = 0; Slot < 2; ++Slot)
	{
		const ACpvFighter* F = G->Fighters[Slot];
		const float CX = Slot == 0 ? TX + 250.f : TX + 730.f;
		Pic(Portrait(F->Def().Id), CX - 46.f, 306.f, 92.f, 92.f, Slot == 1 && G->IsMirror() ? ACpvGameMode::TwinTint() : White, Slot == 1);
		Txt(F->Def().Name, CX, 392.f, ECpvFont::Bold, 26.f, Slot == Wn ? Gold : Dim, ECpvAlign::Center);
		const FString Vals[4] = { FString::FromInt(FMath::RoundToInt(F->DamageDealt)), FString::FromInt(F->HitsLanded), FString::FromInt(F->BestCombo), FString::FromInt(F->Taunts) };
		for (int32 r = 0; r < 4; ++r) { Txt(Vals[r], CX, 436.f + r * 46.f, ECpvFont::Impact, 38.f, White, ECpvAlign::Center); }
	}
	for (int32 r = 0; r < 4; ++r) { Txt(Rows[r], W * 0.5f, 444.f + r * 46.f, ECpvFont::Semi, 26.f, Dim, ECpvAlign::Center, 0.f, 30); }

	if (G->IsRun())
	{
		const FString Record = bTitle ? FString::Printf(TEXT("CHAMPIONS BOARD     PERSONAL BEST   %d / 9"), G->BestShow[G->Difficulty][G->Cursor[0]])
			: Wn == 0 ? FString::Printf(TEXT("NEXT ON AIR     %s"), CpvData::Fighter(G->RivalForEpisode(G->Episode + 1)).Name)
			: FString::Printf(TEXT("RETAKE AVAILABLE     BOUT %d OF 3"), G->Episode + 1);
		const FString Score = FString::Printf(TEXT("SHOW STARS   %d / 9      |      BOUT WIN  %d     HALF HEALTH  %d     CROWD CALL  %d"),
			G->SeasonStars(), Wn == 0, Wn == 0 && G->Fighters[0]->Health >= 50.f, Wn == 0 && G->bCrowdCall);
		Txt(Score, W * 0.5f, 635.f, ECpvFont::Bold, 28.f, White, ECpvAlign::Center, 2.f);
		Txt(Record, W * 0.5f, 679.f, ECpvFont::Bold, 27.f, Gold, ECpvAlign::Center, 2.f);
	}
	const TCHAR* First = !G->IsRun() ? TEXT("REMATCH") : bTitle ? TEXT("DEFEND YOUR TITLE") : Wn == 0 ? TEXT("NEXT BOUT") : TEXT("RETRY THIS BOUT");
	const int32 Count = G->HasReplay() ? 4 : 3;
	const TCHAR* Items[] = { First, G->IsRun() ? TEXT("RECAST THE SHOW") : TEXT("NEW FIGHTERS"), Count == 4 ? TEXT("INSTANT REPLAY") : TEXT("MAIN MENU"), TEXT("MAIN MENU") };
	for (int32 i = 0; i < Count; ++i)
	{
		const float Y = (G->IsRun() ? 734.f : 680.f) + i * 73.f;
		Hit(W * 0.5f - 308.f, Y - 4.f, 616.f, 65.f, ECpvClick::Result, i);
		const bool bOn = i == G->ResultIndex;
		if (bOn) { Slant(W * 0.5f - 300.f, Y - 4.f, 600.f, 59.f, 22.f, Gold); }
		Txt(Items[i], W * 0.5f, Y + 4.f, ECpvFont::ExtraItalic, 45.f, bOn ? Ink : White, ECpvAlign::Center, bOn ? 0.f : 3.f, 20);
	}
}

void ACpvHUD::DrawPause()
{
	Box(0.f, 0.f, W, H, FLinearColor(0.f, 0.f, 0.03f, 0.8f));
	Out(TEXT("INTERMISSION"), W * 0.5f, 50.f, ECpvFont::Title, 96.f, Gold, Ink, 5.f, ECpvAlign::Center);
	const TCHAR* Items[] = { TEXT("RESUME"), G->IsRehearsing() ? TEXT("RESTART REHEARSAL") : TEXT("RESTART BOUT"), TEXT("QUIT TO MENU"), TEXT("SOUND MIXER"), TEXT("PICTURE QUALITY") };
	for (int32 i = 0; i < UE_ARRAY_COUNT(Items); ++i)
	{
		const float Y = 168.f + i * 65.f;
		Hit(W * 0.5f - 310.f, Y - 4.f, 620.f, 65.f, ECpvClick::Pause, i);
		const bool bOn = i == G->PauseIndex;
		if (bOn) { Slant(W * 0.5f - 300.f, Y - 4.f, 600.f, 59.f, 22.f, Gold); }
		Txt(Items[i], W * 0.5f, Y + 4.f, ECpvFont::ExtraItalic, 45.f, bOn ? Ink : White, ECpvAlign::Center, bOn ? 0.f : 3.f, 20);
	}
	DrawControls(W * 0.5f - 610.f, 500.f, true);
	Txt(TEXT("In a grab:  JAB = headbutt     HEAVY = slam     GRAB + direction = whip into the ropes"), W * 0.5f, 936.f, ECpvFont::Medium, 26.f, Dim, ECpvAlign::Center);
	Txt(TEXT("Deciding round: knock them silly, then press SIGNATURE up close for a CURTAIN CALL"), W * 0.5f, 974.f, ECpvFont::Medium, 26.f, Dim, ECpvAlign::Center);
}
