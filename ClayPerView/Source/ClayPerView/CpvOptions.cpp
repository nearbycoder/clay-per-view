// Live picture and sound controls shared by the main menu and intermission.
#include "CpvGame.h"
#include "CpvArena.h"
#include "Components/AudioComponent.h"
#include "ClayPerView.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "GameFramework/GameUserSettings.h"
#include "HAL/IConsoleManager.h"
#include "Misc/ConfigCacheIni.h"
#include "Scalability.h"

namespace
{
	const TCHAR* Section = TEXT("ClayPerView.Options");
	const TCHAR* GeneralRows[] = {TEXT("Difficulty"), TEXT("Bout length"), TEXT("Round timer"), TEXT("Animation"), TEXT("Sound mixer"), TEXT("Picture quality"), TEXT("Impact camera shake"), TEXT("Arena flash bulbs"), TEXT("Exhibition pinfalls")};
	const TCHAR* SoundRows[] = {TEXT("Master volume"), TEXT("Music"), TEXT("Voices"), TEXT("Effects"), TEXT("Crowd"), TEXT("Menu sounds"), TEXT("Lower mix during speech"), TEXT("Dialogue subtitles"), TEXT("Subtitle language")};
	const TCHAR* BusKeys[] = {TEXT("MusicVolume"), TEXT("VoiceVolume"), TEXT("EffectsVolume"), TEXT("CrowdVolume"), TEXT("MenuVolume")};
	const TCHAR* PictureRows[] = {TEXT("Preset"), TEXT("Render scale"), TEXT("Shadows"), TEXT("Lighting & reflections"), TEXT("Textures"), TEXT("Anti-aliasing"), TEXT("Effects"), TEXT("Post-processing"), TEXT("Arena screen feed"), TEXT("Frame limit"), TEXT("VSync"), TEXT("Display"), TEXT("In-match FPS meter")};
	const TCHAR* DetailKeys[] = {TEXT("Shadows"), TEXT("Lighting"), TEXT("Textures"), TEXT("AntiAliasing"), TEXT("Effects"), TEXT("PostProcess")};
	const TCHAR* Levels[] = {TEXT("LOW"), TEXT("MEDIUM"), TEXT("HIGH"), TEXT("ULTRA")};
	const int32 Scales[] = {0, 60, 75, 85, 100, 125, 150};
	const int32 FeedRates[] = {4, 8, 12, 20};
	const int32 Caps[] = {30, 60, 90, 120, 144, 0};
	const int32 PresetScale[] = {1, 3, 4, 5};
	const int32 PresetFeed[] = {0, 1, 1, 3};

	int32 Cycle(int32 Value, int32 Step, int32 Count) { return (Value + Step + Count) % Count; }
	const TCHAR* Toggle(bool Enabled) { return Enabled ? TEXT("ON") : TEXT("OFF"); }
	void ReadIndex(const TCHAR* Key, int32& Value, int32 Max)
	{
		GConfig->GetInt(Section, Key, Value, GGameUserSettingsIni);
		Value = FMath::Clamp(Value, 0, Max);
	}
}

int32 ACpvGameMode::OptionCount() const
{
	switch (OptionsPage)
	{
	case ECpvOptionsPage::Sound: return UE_ARRAY_COUNT(SoundRows);
	case ECpvOptionsPage::Picture: return UE_ARRAY_COUNT(PictureRows);
	default: return UE_ARRAY_COUNT(GeneralRows);
	}
}

const TCHAR* ACpvGameMode::OptionLabel(int32 Row) const
{
	switch (OptionsPage)
	{
	case ECpvOptionsPage::Sound: return SoundRows[Row];
	case ECpvOptionsPage::Picture: return PictureRows[Row];
	default: return GeneralRows[Row];
	}
}

int32 ACpvGameMode::MatchedPreset() const
{
	const int32 Tier = Detail[0];
	for (int32 Value : Detail) { if (Value != Tier) { return -1; } }
	if (Tier == 2 && RenderScale == 0 && FeedRate == 1) { return 4; } // original adaptive resolution
	return RenderScale == PresetScale[Tier] && FeedRate == PresetFeed[Tier] ? Tier : -1;
}

float ACpvGameMode::DetailMeter() const
{
	// A relative measure of the selected detail settings, independent of the frame limiter.
	float Sum = 0.f;
	for (int32 Value : Detail) { Sum += Value / 3.f; }
	const float Pixels = RenderScale ? Scales[RenderScale] : IConsoleManager::Get().FindConsoleVariable(TEXT("r.ScreenPercentage"))->GetFloat();
	return (Sum + FMath::Clamp((Pixels - 60.f) / 90.f, 0.f, 1.f) + FeedRate / 3.f) / 8.f;
}

FString ACpvGameMode::OptionValue(int32 Row) const
{
	if (OptionsPage == ECpvOptionsPage::General)
	{
		const TCHAR* Diff[] = {TEXT("UNDERSTUDY"), TEXT("HEADLINER"), TEXT("DIVA")};
		const TCHAR* Anim[] = {TEXT("CLAY / 12 FPS"), TEXT("CLAY / 15 FPS"), TEXT("SMOOTH")};
		switch (Row)
		{
		case 0: return Diff[Difficulty];
		case 1: return RoundsToWin == 1 ? TEXT("ONE TAKE") : TEXT("BEST OF THREE");
		case 2: return RoundSeconds ? FString::Printf(TEXT("%d SEC"), RoundSeconds) : TEXT("NO LIMIT");
		case 3: return Anim[AnimStyle];
		case 6: return Toggle(bShake);
		case 7: return Toggle(bArenaFlashes);
		case 8: return Toggle(bPins);
		default: return TEXT("OPEN  >");
		}
	}
	if (OptionsPage == ECpvOptionsPage::Sound)
	{
		if (Row == 8) { return bPortugueseSubtitles ? TEXT("PORTUGUÊS (BR)") : TEXT("ENGLISH"); }
		if (Row >= 6) { return Toggle(Row == 6 ? bVoiceDucking : bSubtitles); }
		const int32 Value = Row == 0 ? SoundVolume : BusVolume[Row - 1];
		return Value ? FString::Printf(TEXT("%d%%"), Value * 10) : TEXT("MUTED");
	}
	if (Row >= 2 && Row <= 7) { return Levels[Detail[Row - 2]]; }
	switch (Row)
	{
	case 0: { const int32 Tier = MatchedPreset(); return Tier < 0 ? TEXT("CUSTOM") : Tier == 4 ? TEXT("AUTO") : Levels[Tier]; }
	case 1: return RenderScale ? FString::Printf(TEXT("%d%%"), Scales[RenderScale]) : TEXT("AUTO");
	case 8: return FString::Printf(TEXT("%d FPS"), FeedRates[FeedRate]);
	case 9: return Caps[FrameLimit] ? FString::Printf(TEXT("%d FPS"), Caps[FrameLimit]) : TEXT("UNCAPPED");
	case 10: return Toggle(bVSync);
	case 11: return bFullscreen ? TEXT("FULL SCREEN") : TEXT("WINDOW");
	default: return Toggle(bPerformanceHud);
	}
}

void ACpvGameMode::ApplyRenderScale()
{
	FVector2D View(1920.0, 1080.0);
	if (GEngine && GEngine->GameViewport) { GEngine->GameViewport->GetViewportSize(View); }
	const float AutoScale = FMath::Clamp(1200.f / FMath::Max(1.f, static_cast<float>(View.Y)), 0.6f, 1.f) * 100.f;
	const float Scale = RenderScale ? Scales[RenderScale] : AutoScale;
	IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(TEXT("r.ScreenPercentage"));
	if (!FMath::IsNearlyEqual(Var->GetFloat(), Scale, 0.1f)) { Var->Set(Scale, ECVF_SetByGameSetting); }
}

void ACpvGameMode::ApplyPicture()
{
	Scalability::FQualityLevels Q = Scalability::GetQualityLevels();
	Q.ShadowQuality = Detail[0];
	Q.GlobalIlluminationQuality = Q.ReflectionQuality = Detail[1];
	Q.TextureQuality = Detail[2];
	Q.AntiAliasingQuality = Detail[3];
	Q.EffectsQuality = Detail[4];
	Q.PostProcessQuality = Detail[5];
	Q.ShadingQuality = Detail[1];
	// Native fullscreen toggles reapply Unreal's cached settings, including scalability.
	if (UGameUserSettings* Settings = GEngine->GetGameUserSettings())
	{
		Settings->ScalabilityQuality = Q;
		Settings->SetFrameRateLimit(Caps[FrameLimit]);
		Settings->SetVSyncEnabled(bVSync);
	}
	Scalability::SetQualityLevels(Q);
	ApplyRenderScale();
	Arena->FeedInterval = 1.f / FeedRates[FeedRate];
	GEngine->SetMaxFPS(Caps[FrameLimit]);
	IConsoleManager::Get().FindConsoleVariable(TEXT("r.VSync"))->Set(static_cast<int32>(bVSync), ECVF_SetByGameSetting);
	UE_LOG(LogCpv, Display, TEXT("CPV_PICTURE render=%.0f shadows=%d lighting=%d textures=%d AA=%d effects=%d post=%d feed=%d cap=%.0f vsync=%d"),
		IConsoleManager::Get().FindConsoleVariable(TEXT("r.ScreenPercentage"))->GetFloat(), Scalability::GetQualityLevels().ShadowQuality,
		Q.GlobalIlluminationQuality, Q.TextureQuality, Q.AntiAliasingQuality, Q.EffectsQuality, Q.PostProcessQuality, FeedRates[FeedRate],
		GEngine->GetMaxFPS(), IConsoleManager::Get().FindConsoleVariable(TEXT("r.VSync"))->GetInt());
}

void ACpvGameMode::TickOptions(const FCpvMenuInput& In)
{
	if (In.bBack)
	{
		if (VoicePreview.IsValid()) { VoicePreview->Stop(); }
		PlaySound("Back");
		SaveOptions();
		if (bPauseOptions) { bPauseOptions = false; }
		else if (OptionsPage == ECpvOptionsPage::General) { SetPhase(ECpvPhase::Menu); }
		else { OptionIndex = OptionsPage == ECpvOptionsPage::Sound ? 4 : 5; OptionsPage = ECpvOptionsPage::General; }
		return;
	}
	if (In.bUp || In.bDown)
	{
		OptionIndex = Cycle(OptionIndex, In.bUp ? -1 : 1, OptionCount());
		PlaySound("Tick");
	}
	const int32 Step = In.bRight || In.bOk ? 1 : (In.bLeft ? -1 : 0);
	if (!Step) { return; }
	const int32 Row = OptionIndex;
	if (OptionsPage == ECpvOptionsPage::General)
	{
		switch (Row)
		{
		case 0: Difficulty = Cycle(Difficulty, Step, 3); break;
		case 1: RoundsToWin = 3 - RoundsToWin; break;
		case 2: {
			const int32 Times[] = {99, 60, 0};
			RoundSeconds = Times[Cycle(RoundSeconds == 99 ? 0 : RoundSeconds == 60 ? 1 : 2, Step, 3)];
			break;
		}
		case 3: AnimStyle = Cycle(AnimStyle, Step, 3); break;
		case 6: bShake = !bShake; break;
		case 7: bArenaFlashes = !bArenaFlashes; break;
		case 8: bPins = !bPins; break;
		default:
			OptionsPage = Row == 4 ? ECpvOptionsPage::Sound : ECpvOptionsPage::Picture;
			OptionIndex = 0;
			PlaySound("Select");
			return;
		}
		ApplyOptions();
	}
	else if (OptionsPage == ECpvOptionsPage::Sound)
	{
		if (Row < 6)
		{
			int32& Value = Row == 0 ? SoundVolume : BusVolume[Row - 1];
			Value = In.bOk ? Cycle(Value, 1, 11) : FMath::Clamp(Value + Step, 0, 10);
		}
		else if (Row == 6) { bVoiceDucking = !bVoiceDucking; }
		else if (Row == 7) { bSubtitles = !bSubtitles; }
		else { bPortugueseSubtitles = !bPortugueseSubtitles; }
		RefreshMix();
		if (Row == 2)
		{
			if (VoicePreview.IsValid()) { VoicePreview->Stop(); }
			VoicePreview = PlayMixedClip(FindSound("VO_Take1"), ECpvAudioBus::Voice, 1.25f);
		}
		else if (Row == 3) { PlaySound("Punch"); }
		else if (Row == 4) { PlaySound("Cheer", 0.5f); }
	}
	else
	{
		if (Row >= 2 && Row <= 7) { Detail[Row - 2] = Cycle(Detail[Row - 2], Step, 4); }
		else switch (Row)
		{
		case 0: {
			const int32 Current = MatchedPreset();
			const int32 Preset = Cycle(Current < 0 ? Detail[0] : Current, Step, 5);
			const int32 Tier = Preset == 4 ? 2 : Preset;
			for (int32& Value : Detail) { Value = Tier; }
			RenderScale = Preset == 4 ? 0 : PresetScale[Tier];
			FeedRate = PresetFeed[Tier];
			break;
		}
		case 1: RenderScale = Cycle(RenderScale, Step, UE_ARRAY_COUNT(Scales)); break;
		case 8: FeedRate = Cycle(FeedRate, Step, UE_ARRAY_COUNT(FeedRates)); break;
		case 9: FrameLimit = Cycle(FrameLimit, Step, UE_ARRAY_COUNT(Caps)); break;
		case 10: bVSync = !bVSync; break;
		case 11:
			if (CanSwitchDisplay())
			{
				bFullscreen = !IsFullscreenNow();
				GEngine->GameViewport->HandleToggleFullscreenCommand();
				UE_LOG(LogCpv, Display, TEXT("Display requested: %s"), bFullscreen ? TEXT("fullscreen") : TEXT("window"));
			}
			break;
		case 12: bPerformanceHud = !bPerformanceHud; break;
		}
		ApplyPicture();
	}
	PlaySound("Tick");
	SaveOptions();
}

void ACpvGameMode::LoadAVOptions()
{
	bool LegacyMusic = true;
	GConfig->GetBool(Section, TEXT("Music"), LegacyMusic, GGameUserSettingsIni);
	BusVolume[0] = LegacyMusic ? 10 : 0;
	for (int32 i = 0; i < UE_ARRAY_COUNT(BusKeys); ++i) { ReadIndex(BusKeys[i], BusVolume[i], 10); }
	for (int32 i = 0; i < UE_ARRAY_COUNT(DetailKeys); ++i) { ReadIndex(DetailKeys[i], Detail[i], 3); }
	ReadIndex(TEXT("RenderScale"), RenderScale, UE_ARRAY_COUNT(Scales) - 1);
	ReadIndex(TEXT("FeedRate"), FeedRate, UE_ARRAY_COUNT(FeedRates) - 1);
	ReadIndex(TEXT("FrameLimit"), FrameLimit, UE_ARRAY_COUNT(Caps) - 1);
	GConfig->GetBool(Section, TEXT("VSync"), bVSync, GGameUserSettingsIni);
	GConfig->GetBool(Section, TEXT("PerformanceHud"), bPerformanceHud, GGameUserSettingsIni);
	GConfig->GetBool(Section, TEXT("VoiceDucking"), bVoiceDucking, GGameUserSettingsIni);
	GConfig->GetBool(Section, TEXT("Subtitles"), bSubtitles, GGameUserSettingsIni);
	GConfig->GetBool(Section, TEXT("PortugueseSubtitles"), bPortugueseSubtitles, GGameUserSettingsIni);
	GConfig->GetBool(Section, TEXT("Shake"), bShake, GGameUserSettingsIni);
	GConfig->GetBool(Section, TEXT("ArenaFlashes"), bArenaFlashes, GGameUserSettingsIni);
	GConfig->GetBool(Section, TEXT("Pins"), bPins, GGameUserSettingsIni);
}

void ACpvGameMode::SaveAVOptions()
{
	for (int32 i = 0; i < UE_ARRAY_COUNT(BusKeys); ++i) { GConfig->SetInt(Section, BusKeys[i], BusVolume[i], GGameUserSettingsIni); }
	for (int32 i = 0; i < UE_ARRAY_COUNT(DetailKeys); ++i) { GConfig->SetInt(Section, DetailKeys[i], Detail[i], GGameUserSettingsIni); }
	GConfig->SetInt(Section, TEXT("RenderScale"), RenderScale, GGameUserSettingsIni);
	GConfig->SetInt(Section, TEXT("FeedRate"), FeedRate, GGameUserSettingsIni);
	GConfig->SetInt(Section, TEXT("FrameLimit"), FrameLimit, GGameUserSettingsIni);
	GConfig->SetBool(Section, TEXT("VSync"), bVSync, GGameUserSettingsIni);
	GConfig->SetBool(Section, TEXT("PerformanceHud"), bPerformanceHud, GGameUserSettingsIni);
	GConfig->SetBool(Section, TEXT("VoiceDucking"), bVoiceDucking, GGameUserSettingsIni);
	GConfig->SetBool(Section, TEXT("Subtitles"), bSubtitles, GGameUserSettingsIni);
	GConfig->SetBool(Section, TEXT("PortugueseSubtitles"), bPortugueseSubtitles, GGameUserSettingsIni);
	GConfig->SetBool(Section, TEXT("Shake"), bShake, GGameUserSettingsIni);
	GConfig->SetBool(Section, TEXT("ArenaFlashes"), bArenaFlashes, GGameUserSettingsIni);
	GConfig->SetBool(Section, TEXT("Pins"), bPins, GGameUserSettingsIni);
}
