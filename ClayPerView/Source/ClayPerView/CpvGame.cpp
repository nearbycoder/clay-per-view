// Match flow, player input and the camera director.

#include "CpvGame.h"
#include "Components/AudioComponent.h"
#include "ClayPerView.h"
#include "CpvArena.h"
#include "CpvFighter.h"
#include "CpvFx.h"
#include "CpvHud.h"
#include "CpvPuppet.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "AudioMixerBlueprintLibrary.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "Framework/Application/SlateApplication.h"
#include "GameFramework/GameUserSettings.h"
#include "GameFramework/PlayerController.h"
#include "GenericPlatform/GenericPlatformInputDeviceMapper.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformApplicationMisc.h"
#include "InputCoreTypes.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/App.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Sound/SoundBase.h"
#include "UnrealClient.h"

// ---------------------------------------------------------------------------------------------
// Dev options and sequences
// ---------------------------------------------------------------------------------------------

void FCpvDevOptions::Parse()
{
	const TCHAR* Cmd = FCommandLine::Get();
	FString Str;
	if (FParse::Value(Cmd, TEXT("CpvShots="), Str, false))
	{
		TArray<FString> Parts;
		Str.ParseIntoArray(Parts, TEXT(","));
		for (const FString& Part : Parts)
		{
			FString Name, When;
			if (Part.Split(TEXT("@"), &Name, &When)) { Shots.Add({ FCString::Atof(*When), Name }); }
		}
	}
	FParse::Value(Cmd, TEXT("CpvQuit="), QuitAt);
	if (FParse::Value(Cmd, TEXT("CpvCam="), Str, false))
	{
		TArray<FString> N;
		Str.ParseIntoArray(N, TEXT(","));
		if (N.Num() >= 6)
		{
			bHaveCam = true;
			CamPos = FVector(FCString::Atof(*N[0]), FCString::Atof(*N[1]), FCString::Atof(*N[2]));
			CamAim = FVector(FCString::Atof(*N[3]), FCString::Atof(*N[4]), FCString::Atof(*N[5]));
			if (N.Num() >= 7) { CamFov = FCString::Atof(*N[6]); }
		}
	}
	if (FParse::Value(Cmd, TEXT("CpvGallery="), Str, false)) { Str.ParseIntoArray(Gallery, TEXT(",")); }
	FParse::Value(Cmd, TEXT("CpvChar="), GalleryChar);
	FParse::Value(Cmd, TEXT("CpvFrames="), GalleryFrames);
	FParse::Value(Cmd, TEXT("CpvStart="), Start);
	FParse::Value(Cmd, TEXT("CpvP1="), Pick[0]);
	FParse::Value(Cmd, TEXT("CpvP2="), Pick[1]);
	FParse::Value(Cmd, TEXT("CpvFoeHealth="), FoeHealth);
	FParse::Value(Cmd, TEXT("CpvHype="), Hype);
	FParse::Value(Cmd, TEXT("CpvWeapon="), GiveWeapon);
	bHud = !FParse::Param(Cmd, TEXT("CpvNoHud"));
	if (FParse::Value(Cmd, TEXT("CpvPress="), Str, false))
	{
		TArray<FString> Parts;
		Str.ParseIntoArray(Parts, TEXT(","));
		for (const FString& Part : Parts)
		{
			FString Button, When;
			if (Part.Split(TEXT("@"), &Button, &When)) { Presses.Add({ FCString::Atof(*When), Button }); }
		}
	}
	if (FParse::Value(Cmd, TEXT("CpvKeys="), Str, false))
	{
		TArray<FString> Parts;
		Str.ParseIntoArray(Parts, TEXT(","));
		for (const FString& Part : Parts)
		{
			FString Name, When, Down, Hold;
			if (!Part.Split(TEXT("@"), &Name, &When)) { continue; }
			FKeyTap Tap;
			if (When.Split(TEXT(":"), &Down, &Hold)) { Tap.Hold = FCString::Atof(*Hold); } else { Down = When; }
			Tap.Time = FCString::Atof(*Down);
			if (Name.RemoveFromStart(TEXT("p2."))) { Tap.Pad = 1; }
			Tap.Key = FKey(*Name);
			if (Tap.Key.IsValid()) { Keys.Add(Tap); }
			else { UE_LOG(LogCpv, Warning, TEXT("-CpvKeys: unknown key '%s'"), *Name); }
		}
	}
	if (FParse::Value(Cmd, TEXT("CpvClicks="), Str, false))
	{
		TArray<FString> Parts;
		Str.ParseIntoArray(Parts, TEXT(","));
		for (const FString& Part : Parts)
		{
			FString Point, When, X, Y;
			if (Part.Split(TEXT("@"), &Point, &When) && Point.Split(TEXT(":"), &X, &Y))
			{
				Clicks.Add({FCString::Atof(*When), FVector2D(FCString::Atod(*X), FCString::Atod(*Y))});
			}
		}
	}
	FParse::Value(Cmd, TEXT("CpvAudioOut="), AudioOut);
	bDummy = FParse::Param(Cmd, TEXT("CpvDummy"));
	bWindow = FParse::Param(Cmd, TEXT("CpvWindow"));
	bFullscreen = FParse::Param(Cmd, TEXT("CpvFullscreen"));
	bMash = FParse::Param(Cmd, TEXT("CpvMash"));
	bAutoQuit = FParse::Param(Cmd, TEXT("CpvAutoQuit"));
	FParse::Value(Cmd, TEXT("CpvDifficulty="), Difficulty);
	float Step = 0.f;
	if (FParse::Value(Cmd, TEXT("CpvStep="), Step)) { ACpvPuppet::StepRate = Step; }
}

bool FCpvDevOptions::Tick(float Now)
{
	for (FShot& Shot : Shots)
	{
		if (!Shot.bTaken && Now >= Shot.Time)
		{
			Shot.bTaken = true;
			const FString Path = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Shots") / (Shot.Name + TEXT(".png")));
			FScreenshotRequest::RequestScreenshot(Path, true, false);
			UE_LOG(LogCpv, Display, TEXT("Screenshot %s at %.2f"), *Path, Now);
		}
	}
	return QuitAt > 0.f && Now >= QuitAt;
}

bool ACpvGameMode::TickDev()
{
	// Real key events, sent the way the operating system's would arrive: Slate -> viewport -> player controller.
	if (FSlateApplication::IsInitialized())
	{
		for (FCpvDevOptions::FKeyTap& Tap : Dev.Keys)
		{
			const bool bPress = Tap.Stage == 0 && DevClock >= Tap.Time;
			const bool bRelease = Tap.Stage == 1 && DevClock >= Tap.Time + Tap.Hold;
			if (!bPress && !bRelease) { continue; }
			if (Tap.Key == EKeys::F11 && !FPlatformApplicationMisc::IsThisApplicationForeground())
			{
				// A full-screen switch asked for from the background never completes (see TickDisplay).
				UE_LOG(LogCpv, Display, TEXT("Key F11 skipped at %.2f: the game is not the foreground app"), DevClock);
				Tap.Stage = 2;
				continue;
			}
			IPlatformInputDeviceMapper& Mapper = IPlatformInputDeviceMapper::Get();
			FInputDeviceId Device = Mapper.GetDefaultInputDevice();
			if (Tap.Pad > 0)
			{
				// A pretend second gamepad, owned by the second local player.
				Device = FInputDeviceId::CreateFromInternalId(Tap.Pad);
				if (Mapper.GetUserForInputDevice(Device) != FPlatformUserId::CreateFromInternalId(Tap.Pad))
				{
					Mapper.Internal_MapInputDeviceToUser(Device, FPlatformUserId::CreateFromInternalId(Tap.Pad), EInputDeviceConnectionState::Connected);
				}
			}
			const uint32* KeyCode = nullptr;
			const uint32* CharCode = nullptr;
			FInputKeyManager::Get().GetCodesFromKey(Tap.Key, KeyCode, CharCode);
			const FKeyEvent Event(Tap.Key, FModifierKeysState(), Device, false, CharCode ? *CharCode : 0, KeyCode ? *KeyCode : 0);
			const bool bHandled = bPress ? FSlateApplication::Get().ProcessKeyDownEvent(Event) : FSlateApplication::Get().ProcessKeyUpEvent(Event);
			UE_LOG(LogCpv, Display, TEXT("Key %s %s at %.2f (%s)"), *Tap.Key.ToString(), bPress ? TEXT("down") : TEXT("up"), DevClock, bHandled ? TEXT("handled") : TEXT("unhandled"));
			++Tap.Stage;
		}
	}
	for (FCpvDevOptions::FClick& Click : Dev.Clicks)
	{
		if (!Click.bDone && DevClock >= Click.Time) { Click.bDone = true; ClickViewport(Click.Point); }
	}
	// Capture of the final mix, for checking levels without ears.
	if (!Dev.AudioOut.IsEmpty())
	{
		if (Dev.AudioStage == 0 && DevClock > 0.3f)
		{
			Dev.AudioStage = 1;
			// The engine mutes itself when its window is not in front; a test run usually is not.
			if (IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(TEXT("au.DisableAppVolume"))) { Var->Set(1); }
			WriteCaptureTime(FString::Printf(TEXT("audio\t%.6f\n"), FPlatformTime::Seconds() - FilmStart));
			UAudioMixerBlueprintLibrary::StartRecordingOutput(this, FMath::Max(Dev.QuitAt, 10.f));
		}
		else if (Dev.AudioStage == 1 && Dev.QuitAt > 0.f && DevClock >= Dev.QuitAt - 2.f)
		{
			Dev.AudioStage = 2;
			UAudioMixerBlueprintLibrary::StopRecordingOutputToAnyPath(this, EAudioRecordingExportType::WavFile, Dev.AudioOut,
				FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Shots")));
		}
	}
	TickCapture();
	return Dev.Tick(DevClock);
}

void FCpvSequence::Tick(float Dt)
{
	if (!bActive) { return; }
	Clock += Dt;
	while (Next < Steps.Num() && Steps[Next].Time <= Clock)
	{
		const int32 Run = Next++;
		Steps[Run].Fn();          // a step may start a new sequence, so advance first
		if (!bActive || Steps.Num() == 0) { return; }
	}
}

// ---------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------

ACpvGameMode::ACpvGameMode()
{
	PrimaryActorTick.bCanEverTick = true;
	DefaultPawnClass = nullptr;
	HUDClass = ACpvHUD::StaticClass();
}

void ACpvGameMode::BeginPlay()
{
	Super::BeginPlay();
	GAreScreenMessagesEnabled = false;
	Dev.Parse();
	OpenCapture();
	bShowHud = Dev.bHud;
	UWorld* World = GetWorld();

	// Always render at full resolution with top scalability (a stale saved config can drop the
	// internal resolution, which turns the clay to mush).
	if (UGameUserSettings* Settings = GEngine ? GEngine->GetGameUserSettings() : nullptr)
	{
		Settings->SetOverallScalabilityLevel(3);
		Settings->SetGlobalIlluminationQuality(2);
		Settings->SetReflectionQuality(2);
		Settings->SetResolutionScaleNormalized(1.f);
		Settings->ApplyNonResolutionSettings();
	}

	Camera = World->SpawnActor<ACameraActor>(Cam.Pos, FRotator::ZeroRotator);
	Camera->GetCameraComponent()->SetConstraintAspectRatio(false);
	APlayerController* PC = UGameplayStatics::GetPlayerController(World, 0);
	if (PC) { PC->SetViewTarget(Camera); }

	if (Dev.Gallery.Num() > 0)
	{
		BuildGallery();
		return;
	}

	// A second local player so a second gamepad has somewhere to go (no split screen).
	if (UGameViewportClient* Viewport = World->GetGameViewport()) { Viewport->SetForceDisableSplitscreen(true); }
	if (APlayerController* Second = UGameplayStatics::CreatePlayer(World, 1, true)) { Second->SetViewTarget(Camera); }

	PreloadContent();
	Arena = World->SpawnActor<ACpvArena>();
	Arena->Build();
	Arena->bFeedEnabled = !FParse::Param(FCommandLine::Get(), TEXT("CpvNoFeed"));
	Fx = World->SpawnActor<ACpvFx>();
	Fx->Build(Arena->MatHalf, Arena->FloorZ);

	Referee = World->SpawnActor<ACpvPuppet>(FVector(0.0, -160.0, 0.0), FRotator(0.f, 90.f, 0.f));
	Referee->SetCharacter(TEXT("Ref"));
	Referee->Play(TEXT("RefIdle"), 0.f);
	const TCHAR* Booth[2] = { TEXT("Dirk"), TEXT("Nigel") };
	for (int32 i = 0; i < 2; ++i)
	{
		const FTransform Seat = Arena->AnnounceSeats.IsValidIndex(i) ? Arena->AnnounceSeats[i] : FTransform(FRotator(0.f, 90.f, 0.f), FVector(130.0 + 120.0 * i, -512.0, -48.0));
		Commentators[i] = World->SpawnActor<ACpvPuppet>(Seat.GetLocation(), Seat.Rotator());
		Commentators[i]->SetCharacter(Booth[i]);
		Commentators[i]->Play(TEXT("SitIdle"), 0.f);
	}
	LoadCommentary();
	LoadOptions();
	for (int32 Level = 0; Level < UE_ARRAY_COUNT(Champions); ++Level)
	{
		GConfig->GetInt(TEXT("ClayPerView.Champions"), *FString::FromInt(Level), Champions[Level], GGameUserSettingsIni);
		for (int32 Star = 0; Star < UE_ARRAY_COUNT(BestShow[Level]); ++Star)
		{
			GConfig->GetInt(TEXT("ClayPerView.Champions"), *FString::Printf(TEXT("Best_%d_%d"), Level, Star), BestShow[Level][Star], GGameUserSettingsIni);
			BestShow[Level][Star] = FMath::Clamp(BestShow[Level][Star], 0, 9);
		}
	}
	ApplyPicture();
	if (Dev.Difficulty >= 0) { Difficulty = FMath::Clamp(Dev.Difficulty, 0, 2); }
	if (Dev.bFullscreen) { bFullscreen = true; }
	if (Dev.bWindow) { bFullscreen = false; }
	ApplyOptions();
	StartLoop(CrowdComp, "Crowd_Loop", 0.4f);

	if (Dev.Start == TEXT("rehearsal")) { StartRehearsal(); }
	else if (Dev.Start == TEXT("fight") || Dev.Start == TEXT("finisher") || Dev.Start == TEXT("intro") || Dev.Start == TEXT("watch"))
	{
		Mode = Dev.Start == TEXT("watch") || Dev.Start == TEXT("finisher") ? ECpvMode::Watch : ECpvMode::OnePlayer;
		if (FParse::Param(FCommandLine::Get(), TEXT("CpvAI"))) { Mode = ECpvMode::Watch; }
		if (FParse::Param(FCommandLine::Get(), TEXT("CpvTwo"))) { Mode = ECpvMode::TwoPlayer; }
		Cursor[0] = FMath::Clamp(Dev.Pick[0], 0, CpvData::Roster().Num() - 1);
		Cursor[1] = FMath::Clamp(Dev.Pick[1] >= 0 ? Dev.Pick[1] : 1, 0, CpvData::Roster().Num() - 1);
		bSkipIntro = Dev.Start != TEXT("intro");
		if (Dev.Start == TEXT("finisher")) { RoundsToWin = 1; }
		StartMatch();
	}
	else if (Dev.Start == TEXT("select"))
	{
		StartSelect();
	}
	else
	{
		StartDemo();
		if (Dev.Start == TEXT("menu")) { SetPhase(ECpvPhase::Menu); }
		if (Dev.Start == TEXT("howto")) { SetPhase(ECpvPhase::HowTo); }
		if (Dev.Start == TEXT("options")) { SetPhase(ECpvPhase::Options); }
	}
}

bool ACpvGameMode::CanSwitchDisplay() const
{
	return GEngine && GEngine->GameViewport && FPlatformApplicationMisc::IsThisApplicationForeground();
}

bool ACpvGameMode::IsFullscreenNow() const
{
	return GEngine && GEngine->GameViewport && GEngine->GameViewport->Viewport && GEngine->GameViewport->Viewport->IsFullscreen();
}

void ACpvGameMode::TickDisplay()
{
	// This engine build hangs if it is asked to open its window in full screen, so the game always
	// starts in a window and switches a moment later, the same way F11 does.
	if (!bDisplayApplied)
	{
		if (!bFullscreen)
		{
			bDisplayApplied = true;
			return;
		}
		// macOS only moves a window to full screen for the app in front, and the engine waits for that
		// move with no time limit: asked at the wrong moment the game would freeze. So wait until the
		// window has been drawing for a few seconds and the game is the foreground app.
		DisplayWait += FMath::Min(FApp::GetDeltaTime(), 0.05);
		if (DisplayWait < 4.f || !CanSwitchDisplay()) { return; }
		bDisplayApplied = true;
		if (!IsFullscreenNow()) { GEngine->GameViewport->HandleToggleFullscreenCommand(); }
		return;
	}
	// Keep the option in step with F11.
	const bool bNow = IsFullscreenNow();
	if (bNow != bFullscreen && RealTime > 3.f)
	{
		bFullscreen = bNow;
		if (!Dev.bWindow) { SaveOptions(); }
	}
}

void ACpvGameMode::PreloadContent()
{
	// First use of a sound or mesh would otherwise load it from disk in the middle of a punch.
	IAssetRegistry& Registry = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get();
	Registry.ScanPathsSynchronous({ TEXT("/Game/CPV") });
	for (const TCHAR* Path : { TEXT("/Game/CPV/Audio"), TEXT("/Game/CPV/Props"), TEXT("/Game/CPV/Characters"), TEXT("/Game/CPV/UI") })
	{
		TArray<FAssetData> Assets;
		Registry.GetAssetsByPath(FName(Path), Assets, true);
		for (const FAssetData& Asset : Assets)
		{
			if (UObject* Object = Asset.GetAsset())
			{
				Preloaded.Add(Object);
				if (USoundBase* Sound = Cast<USoundBase>(Object))
				{
					FString Key = Asset.AssetName.ToString();
					Key.RemoveFromStart(TEXT("S_"));
					Sounds.Add(FName(*Key), TObjectPtr<USoundBase>(Sound));
				}
			}
		}
	}
	UE_LOG(LogCpv, Display, TEXT("Preloaded %d assets (%d sounds)"), Preloaded.Num(), Sounds.Num());
}

void ACpvGameMode::ApplyOptions()
{
	ACpvPuppet::StepRate = AnimStyle == 0 ? 12.f : (AnimStyle == 1 ? 15.f : 0.f);
	Arena->SetBroadcastFlashes(bArenaFlashes);
	Brains[0].Level = Brains[1].Level = Difficulty;
	if (IsRun() && Episode == 0) { Brains[1].Level = FMath::Max(0, Difficulty - 1); }
}

void ACpvGameMode::SetPhase(ECpvPhase NewPhase)
{
	UE_LOG(LogCpv, Verbose, TEXT("Phase %d -> %d"), static_cast<int32>(Phase), static_cast<int32>(NewPhase));
	Phase = NewPhase;
	PhaseTime = 0.f;
}

void ACpvGameMode::SpawnFighters(int32 A, int32 B)
{
	UWorld* World = GetWorld();
	const int32 Picks[2] = { A, B };
	for (int32 i = 0; i < 2; ++i)
	{
		if (!Fighters[i]) { Fighters[i] = World->SpawnActor<ACpvFighter>(FVector(i == 0 ? -150.0 : 150.0, 0.0, 0.0), FRotator(0.f, i == 0 ? 0.f : 180.f, 0.f)); }
		Fighters[i]->Setup(i, Picks[i], this);
	}
	Fighters[0]->SetFoe(Fighters[1]);
	Fighters[1]->SetFoe(Fighters[0]);
	Brains[0].Reset();
	Brains[1].Reset();
	TintTwin();
}

bool ACpvGameMode::IsMirror() const
{
	return Fighters[0] && Fighters[1] && Fighters[0]->RosterIndex == Fighters[1]->RosterIndex;
}

void ACpvGameMode::TintTwin()
{
	if (Fighters[0] && Fighters[1])
	{
		Fighters[0]->SetTint(FLinearColor::White);
		Fighters[1]->SetTint(IsMirror() ? TwinTint() : FLinearColor::White);
	}
}

void ACpvGameMode::ShowBanner(const FString& Text, const FString& Sub, float Life, const FLinearColor& Colour, float Scale)
{
	Banner.Text = Text;
	Banner.Sub = Sub;
	Banner.Life = Life;
	Banner.Age = 0.f;
	Banner.Colour = Colour;
	Banner.Scale = Scale;
}

void ACpvGameMode::ClearCallouts()
{
	PinSlot = -1;
	bWonByPin = false;
	Banner.Life = 0.f;
	StopVoice();
	SayCooldown = 0.f;
	NameCard.Reset();
	MoveCalloutLeft[0] = MoveCalloutLeft[1] = 0.f;
	FinisherPrompt = 0.f;
	FinisherFor = -1;
	FadeOut = 0.f;
	if (SlowLeft > 0.f)
	{
		SlowLeft = 0.f;
		UGameplayStatics::SetGlobalTimeDilation(this, 1.f);
	}
}

// ---------------------------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------------------------

void ACpvGameMode::StartDemo()
{
	Arena->DiscardTape();
	bWatchingReplay = false;
	// Behind the title and menus two computer-controlled stars slug it out.
	const int32 Count = CpvData::Roster().Num();
	const int32 A = FMath::RandRange(0, Count - 1);
	const int32 B = (A + FMath::RandRange(1, Count - 1)) % Count;
	SpawnFighters(A, B);
	Wins[0] = Wins[1] = 0;
	Round = 1;
	Winner = -1;
	bRoundOver = false;
	bCamScripted = false;
	Seq.bActive = false;
	HideProps();
	ClearCallouts();
	Letterbox = 0.f;
	Fx->Clear(false);
	for (int32 i = 0; i < 2; ++i)
	{
		Fighters[i]->ResetForRound(FVector(i == 0 ? -150.0 : 150.0, 0.0, 0.0), i == 0 ? 0.f : 180.f);
		Fighters[i]->bDazeOnKo = false;
	}
	Arena->SetMood(ECpvLightMood::Show, 1.f);
	if (Phase != ECpvPhase::Menu && Phase != ECpvPhase::Options && Phase != ECpvPhase::HowTo && Phase != ECpvPhase::Credits) { SetPhase(ECpvPhase::Title); }
	StartLoop(MusicComp, "Music_Menu", 0.5f);
	DrawStageScreen(TEXT("TONIGHT"), TEXT("CLAY-PER-VIEW"), FLinearColor(1.f, 0.8f, 0.15f));
}

void ACpvGameMode::StartSelect()
{
	Episode = 0;
	for (int32& Stars : EpisodeStars) { Stars = 0; }
	if (IsRun()) { Cursor[1] = RivalForEpisode(Episode); }
	SetPhase(ECpvPhase::Select);
	bLocked[0] = bLocked[1] = false;
	SelectStep = 0;
	Seq.bActive = false;
	bCamScripted = false;
	HideProps();
	ClearCallouts();
	Letterbox = 0.f;
	Fx->Clear(false);
	SpawnFighters(Cursor[0], Cursor[1]);
	for (int32 i = 0; i < 2; ++i)
	{
		Fighters[i]->ResetForRound(FVector(i == 0 ? -92.0 : 92.0, -150.0, 0.0), i == 0 ? 72.f : 108.f);
		Fighters[i]->SetScripted(true);
		Fighters[i]->Play(TEXT("Stand"), 0.f);
	}
	Arena->SetMood(ECpvLightMood::House, 0.6f);
	StartLoop(MusicComp, "Music_Menu", 0.5f);
}

void ACpvGameMode::StartMatch()
{
	Arena->StopTape();
	bWatchingReplay = false;
	bCrowdCall = false;
	SpawnFighters(Cursor[0], Cursor[1]);
	Wins[0] = Wins[1] = 0;
	Round = 1;
	Winner = -1;
	HideProps();
	ClearCallouts();
	Letterbox = 0.f;
	Seq.bActive = false;
	bCamScripted = false;
	Fx->Clear(false);
	ApplyOptions();
	StartLoop(MusicComp, "Music_Fight", 0.42f);
	const FCpvFighterDef& A = Fighters[0]->Def();
	const FCpvFighterDef& B = Fighters[1]->Def();
	DrawStageScreen(FString(A.Name) + TEXT("  vs"), B.Name, FLinearColor(1.f, 0.3f, 0.25f));
	SetPhase(ECpvPhase::Versus);
	for (int32 i = 0; i < 2; ++i)
	{
		Fighters[i]->ResetForRound(FVector(i == 0 ? -150.0 : 150.0, 0.0, 0.0), i == 0 ? 0.f : 180.f);
		Fighters[i]->SetScripted(true);
		Fighters[i]->Play(TEXT("Idle"), 0.f);
	}
	PlaySound("Swell");
	if (IsRun())
	{
		static const FName EpisodeVoices[] = {"VO_EpisodeOpen", "VO_EpisodeProps", "VO_EpisodePrime"};
		PlaySound(EpisodeVoices[Episode]);
	}
}

void ACpvGameMode::StartRound()
{
	SetPhase(ECpvPhase::RoundIntro);
	PinSlot = -1;
	bWonByPin = false;
	// An entrance can be skipped half way: anything it left running (walks, camera moves, a fade) stops here.
	Tweens.Reset();
	FadeOut = 0.f;
	bRoundOver = false;
	bCamScripted = false;
	Seq.bActive = false;
	RoundClock = static_cast<float>(IsRun() ? 60 : RoundSeconds);
	FinisherPrompt = 0.f;
	FinisherFor = -1;
	Letterbox = 0.f;
	NameCard.Reset();
	for (int32 i = 0; i < 2; ++i)
	{
		Fighters[i]->ResetForRound(FVector(i == 0 ? -150.0 : 150.0, 0.0, 0.0), i == 0 ? 0.f : 180.f);
		// If losing this round would lose the bout, a knockout leaves them reeling for a Curtain Call.
		Fighters[i]->bDazeOnKo = Wins[1 - i] >= RequiredWins() - 1;
		Fighters[i]->SetScripted(true);
		Fighters[i]->Play(TEXT("Idle"), 0.f);
		Brains[i].Reset();
	}
	// Clear loose weapons between rounds; the splats on the mat stay.
	for (FMatWeapon& W : Weapons) { ReturnProp(W.Comp); }
	Weapons.Reset();
	for (FProjectile& P : Projectiles) { ReturnProp(P.Comp); }
	Projectiles.Reset();
	WeaponClock = FMath::FRandRange(12.f, 18.f);
	Arena->SetMood(ECpvLightMood::Show, 0.8f);
	RefAct = "RefSignal";
	RefActLeft = 0.f;
	RefDown = 0.f;
	CutTo(FVector(0.0, 900.0, 290.0), FVector(0.0, 0.0, 85.0), 40.f);
	bCamScripted = false;
	ShowBanner(FString::Printf(TEXT("TAKE %d"), Round), Fighters[0]->bDazeOnKo || Fighters[1]->bDazeOnKo ? TEXT("CURTAIN CALL ON THE LINE") : TEXT(""), 1.25f, FLinearColor(1.f, 0.82f, 0.15f));
	PlaySound(FName(*FString::Printf(TEXT("VO_Take%d"), FMath::Min(Round, 3))));
}

void ACpvGameMode::EndRound(int32 RoundWinner)
{
	if (RoundWinner >= 0)
	{
		++Wins[RoundWinner];
		if (Wins[RoundWinner] >= RequiredWins())
		{
			EndMatch(RoundWinner);
			return;
		}
	}
	SetPhase(ECpvPhase::RoundEnd);
	if (RoundWinner >= 0)
	{
		Fighters[RoundWinner]->Celebrate();
		ShowBanner(FString(Fighters[RoundWinner]->Def().Name), FString::Printf(TEXT("TAKES ROUND %d"), Round), 2.6f, Fighters[RoundWinner]->Def().Colour, 0.8f);
		Say(TEXT("roundwin"), 1.f, Fighters[RoundWinner]->Def().Name);
	}
	else
	{
		ShowBanner(TEXT("DRAW!"), TEXT("NOBODY GETS PAID"), 2.6f, FLinearColor::White, 0.8f);
	}
	PlaySound("Bell");
	Arena->CrowdPop(0.5f);
	++Round;
}

void ACpvGameMode::EndMatch(int32 MatchWinner)
{
	Winner = MatchWinner;
	Arena->StopTape();
	if (IsRun()) { ScoreEpisode(); }
	SetPhase(ECpvPhase::MatchEnd);
	UE_LOG(LogCpv, Display, TEXT("CPV_RESULT winner=%d rounds=%d-%d damage=%.0f-%.0f hits=%d-%d combo=%d-%d at=%.0fs level=%d"), MatchWinner, Wins[0], Wins[1],
		Fighters[0]->DamageDealt, Fighters[1]->DamageDealt, Fighters[0]->HitsLanded, Fighters[1]->HitsLanded, Fighters[0]->BestCombo, Fighters[1]->BestCombo, Age, Difficulty);
	FinisherPrompt = 0.f;
	BuildMatchEnd();
}

void ACpvGameMode::StepFighters(float Dt, bool bAllowInput)
{
	if (!Fighters[0] || !Fighters[1]) { return; }
	FCpvInput In[2];
	for (int32 i = 0; i < 2; ++i)
	{
		if (!bAllowInput) { continue; }
		if (Dev.bMash && i == 0 && !IsDemo()) { In[i] = MashInput(Dt, *Fighters[0], *Fighters[1]); }
		else if (IsRehearsing() && i == 1) { In[i] = TrainerInput(Dt); }
		else if (IsHuman(i) && !IsDemo()) { In[i] = ReadPlayer(i); }
		else if (!Dev.bDummy) { In[i] = Brains[i].Think(Dt, *Fighters[i], *Fighters[1 - i], *this); }
	}
	Fighters[0]->Step(Dt, In[0]);
	Fighters[1]->Step(Dt, In[1]);
	SeparateFighters();
}

FCpvInput ACpvGameMode::MashInput(float Dt, const ACpvFighter& Me, const ACpvFighter& Foe)
{
	// A stand-in for somebody who has never played: walks at the opponent and hammers the buttons,
	// mostly jab, with no reading of what the other fighter is doing.
	FCpvInput In;
	const FVector2D To = Foe.Pos2D() - Me.Pos2D();
	const float Dist = To.Size();
	if (Dist > 105.f) { In.Move = To / Dist; }
	MashClock -= Dt;
	MashBlock -= Dt;
	if (MashBlock > 0.f) { In.bBlock = true; return In; }
	if (MashClock > 0.f) { return In; }
	MashClock = FMath::FRandRange(0.16f, 0.3f);
	const ECpvState State = Me.GetState();
	if (State == ECpvState::Down || State == ECpvState::Held) { In.bLight = true; return In; }
	if (Foe.GetState() == ECpvState::Dazed) { In.bSpecial = Dist < 170.f; return In; }
	if (Me.HasFullHype() && FMath::FRand() < 0.5f) { In.bSpecial = true; return In; }
	if (Dist > 200.f) { return In; }
	const float R = FMath::FRand();
	if (R < 0.56f) { In.bLight = true; }
	else if (R < 0.74f) { In.bHeavy = true; }
	else if (R < 0.84f) { In.bGrab = true; }
	else if (R < 0.93f) { MashBlock = 0.5f; }
	else { In.bDodge = true; }
	return In;
}

void ACpvGameMode::SeparateFighters()
{
	ACpvFighter* A = Fighters[0];
	ACpvFighter* B = Fighters[1];
	auto Solid = [](const ACpvFighter* F)
	{
		switch (F->GetState())
		{
		case ECpvState::Clinch: case ECpvState::Held: case ECpvState::Throwing: case ECpvState::Thrown: case ECpvState::Scripted:
		case ECpvState::Airborne: case ECpvState::Down: case ECpvState::Dead: case ECpvState::Dodge: case ECpvState::GetUp:
			return false;
		default: return F->Height < 1.f;
		}
	};
	if (!Solid(A) || !Solid(B)) { return; }
	FVector2D D = B->Pos2D() - A->Pos2D();
	const float Dist = D.Size();
	const float Min = CpvRule::BodyRadius * 2.f;
	if (Dist >= Min) { return; }
	D = Dist > 0.5f ? D / Dist : FVector2D(1.0, 0.0);
	const float Push = (Min - Dist) * 0.5f;
	const float Limit = Arena->RingLimit();
	FVector2D Pa = A->Pos2D() - D * Push;
	FVector2D Pb = B->Pos2D() + D * Push;
	Pa.X = FMath::Clamp(Pa.X, -Limit, Limit); Pa.Y = FMath::Clamp(Pa.Y, -Limit, Limit);
	Pb.X = FMath::Clamp(Pb.X, -Limit, Limit); Pb.Y = FMath::Clamp(Pb.Y, -Limit, Limit);
	A->SetActorLocation(FVector(Pa.X, Pa.Y, 0.0));
	B->SetActorLocation(FVector(Pb.X, Pb.Y, 0.0));
}

void ACpvGameMode::TickFight(float Dt)
{
	if (PinSlot >= 0) { TickCover(Dt); return; }
	StepFighters(Dt, true);
	if (PinSlot >= 0) { return; }

	if (!bRoundOver)
	{
		if ((IsRun() || RoundSeconds > 0) && FinisherPrompt <= 0.f)
		{
			RoundClock -= Dt;
			if (RoundClock <= 0.f)
			{
				RoundClock = 0.f;
				bRoundOver = true;
				RoundEndClock = 0.4f;
				const float A = Fighters[0]->Health, B = Fighters[1]->Health;
				Winner = FMath::IsNearlyEqual(A, B, 0.5f) ? -1 : (A > B ? 0 : 1);
				ShowBanner(TEXT("TIME!"), TEXT(""), 1.4f, FLinearColor::White);
				PlaySound("Bell");
			}
		}
		for (int32 i = 0; i < 2 && !bRoundOver; ++i)
		{
			if (Fighters[i]->GetState() == ECpvState::Dead)
			{
				bRoundOver = true;
				RoundEndClock = 1.5f;
				Winner = 1 - i;
				RefAct = "RefBell";
				RefActLeft = 0.f;
			}
		}
	}
	else
	{
		RoundEndClock -= Dt;
		if (RoundEndClock <= 0.f)
		{
			const int32 W = Winner;
			Winner = -1;
			EndRound(W);
			return;
		}
	}

	// A helpless opponent: offer the Curtain Call.
	FinisherPrompt = 0.f;
	FinisherFor = -1;
	for (int32 i = 0; i < 2; ++i)
	{
		if (Fighters[i]->GetState() == ECpvState::Dazed)
		{
			FinisherPrompt = FMath::Max(0.01f, CpvRule::DazedTime - Fighters[i]->GetStateTime());
			FinisherFor = 1 - i;
		}
	}

	// The crowd lobs something useful in every so often.
	WeaponClock -= Dt;
	if (WeaponClock <= 0.f && !bRoundOver)
	{
		WeaponClock = FMath::FRandRange(15.f, 24.f);
		const bool bArmed = Fighters[0]->Weapon != ECpvWeapon::None || Fighters[1]->Weapon != ECpvWeapon::None;
		if (Weapons.Num() < 2 && !bArmed) { TossWeaponIn(static_cast<ECpvWeapon>(FMath::RandRange(1, static_cast<int32>(ECpvWeapon::Count) - 1))); }
	}
	// Crowd energy follows how the bout is going.
	const float Low = 1.f - FMath::Min(Fighters[0]->Health, Fighters[1]->Health) / CpvRule::MaxHealth;
	const float Meter = FMath::Max(Fighters[0]->Hype, Fighters[1]->Hype) / CpvRule::MaxHype;
	Arena->SetHype(0.3f + 0.25f * Low + 0.2f * Meter + (FinisherPrompt > 0.f ? 0.25f : 0.f));
}

void ACpvGameMode::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	const double Now = FPlatformTime::Seconds();
	const float FrameSeconds = PreviousFrameTime > 0.0 ? static_cast<float>(Now - PreviousFrameTime) : 0.f;
	PreviousFrameTime = Now;
	if (FrameSeconds > 0.f)
	{
		MeterElapsed += FrameSeconds;
		++MeterFrames;
		if (MeterElapsed >= 0.5f)
		{
			MeasuredFPS = MeterFrames / MeterElapsed;
			MeterElapsed = 0.f;
			MeterFrames = 0;
		}
	}

	const float RealDt = FMath::Min(FApp::GetDeltaTime(), 0.1);
	RealTime += RealDt;
	Age += DeltaTime;
	TickDisplay();
	DevClock += bPaused ? RealDt : DeltaTime;
	if (Dev.Gallery.Num() > 0)
	{
		if (Dev.Tick(Age)) { FPlatformMisc::RequestExit(false); }
		return;
	}

	FCpvMenuInput Menu[2] = { ReadMenu(0), ReadMenu(1) };
	ReadPointer(Menu);
	FCpvMenuInput Any = Menu[0];
	Any.bUp |= Menu[1].bUp; Any.bDown |= Menu[1].bDown; Any.bLeft |= Menu[1].bLeft; Any.bRight |= Menu[1].bRight;
	Any.bOk |= Menu[1].bOk; Any.bBack |= Menu[1].bBack; Any.bPause |= Menu[1].bPause;

	// --- pause ---
	const bool bCanPause = Phase == ECpvPhase::Fight || Phase == ECpvPhase::RoundIntro || Phase == ECpvPhase::RoundEnd || Phase == ECpvPhase::Intro;
	if (bPaused)
	{
		TickBeds(RealDt);
		if (bPauseOptions)
		{
			TickOptions(Any);
			if (TickDev()) { FPlatformMisc::RequestExit(false); }
			return;
		}
		if (Any.bUp) { PauseIndex = (PauseIndex + 4) % 5; PlaySound("Tick"); }
		if (Any.bDown) { PauseIndex = (PauseIndex + 1) % 5; PlaySound("Tick"); }
		if (Any.bPause || Any.bBack || (Any.bOk && PauseIndex == 0)) { bPaused = false; }
		else if (Any.bOk && PauseIndex >= 3)
		{
			bPauseOptions = true;
			OptionsPage = PauseIndex == 3 ? ECpvOptionsPage::Sound : ECpvOptionsPage::Picture;
			OptionIndex = 0;
			PlaySound("Select");
		}
		else if (Any.bOk)
		{
			bPaused = false;
			PlaySound("Select");
			if (PauseIndex == 1 && IsRehearsing()) { StartRehearsal(); }
			else if (PauseIndex == 1) { StartMatch(); bSkipIntro = true; }
			else { StartDemo(); SetPhase(ECpvPhase::Menu); }
		}
		if (!bPaused && IsValid(VoiceComp)) { VoiceComp->SetPaused(false); }
		UGameplayStatics::SetGlobalTimeDilation(this, bPaused ? 0.0001f : 1.f);
		if (TickDev()) { FPlatformMisc::RequestExit(false); }
		return;
	}
	if (bCanPause && Any.bPause)
	{
		bPaused = true;
		if (IsValid(VoiceComp)) { VoiceComp->SetPaused(true); }
		PauseIndex = 0;
		UGameplayStatics::SetGlobalTimeDilation(this, 0.0001f);
		return;
	}

	// --- slow motion on knockouts ---
	if (SlowLeft > 0.f)
	{
		SlowLeft -= RealDt;
		UGameplayStatics::SetGlobalTimeDilation(this, SlowLeft > 0.f ? 0.3f : 1.f);
	}

	PhaseTime += DeltaTime;
	Seq.Tick(DeltaTime);
	TickTweens(DeltaTime);

	switch (Phase)
	{
	case ECpvPhase::Title:
	case ECpvPhase::Menu:
	case ECpvPhase::Options:
	case ECpvPhase::Credits:
	case ECpvPhase::HowTo:
		// The demo bout loops forever behind the menus.
		StepFighters(DeltaTime, true);
		Arena->SetHype(0.35f);
		if (Fighters[0]->GetState() == ECpvState::Dead || Fighters[1]->GetState() == ECpvState::Dead)
		{
			DemoRestart += DeltaTime;
			const int32 W = Fighters[0]->GetState() == ECpvState::Dead ? 1 : 0;
			if (Fighters[W]->GetState() != ECpvState::Win && DemoRestart > 0.8f) { Fighters[W]->Celebrate(); }
			if (DemoRestart > 4.f) { DemoRestart = 0.f; StartDemo(); }
		}
		else { DemoRestart = 0.f; }
		TickMenus(Any);
		break;
	case ECpvPhase::Select:
		TickSelect(Menu);
		break;
	case ECpvPhase::Versus:
		if ((PhaseTime > 2.6f && DuckLeft <= 0.f) || (PhaseTime > 0.5f && Any.bOk))
		{
			if (bSkipIntro) { StartRound(); }
			else { StartIntro(); }
		}
		break;
	case ECpvPhase::Intro:
		if ((PhaseTime > 0.6f && Any.bOk) || Seq.IsDone())
		{
			Seq.bActive = false;
			StartRound();
		}
		break;
	case ECpvPhase::RoundIntro:
		StepFighters(DeltaTime, false);
		if (PhaseTime >= 1.3f && PhaseTime - DeltaTime < 1.3f)
		{
			ShowBanner(TEXT("LIGHTS! CAMERA!"), TEXT(""), 0.85f, FLinearColor::White, 0.8f);
			PlaySound("VO_LightsCamera");
		}
		if (PhaseTime >= 2.2f)
		{
			ShowBanner(TEXT("CLOBBER!"), TEXT(""), 1.f, FLinearColor(1.f, 0.25f, 0.15f), 1.25f);
			PlaySound("Bell");
			Arena->CrowdPop(0.5f);
			for (int32 i = 0; i < 2; ++i) { Fighters[i]->SetScripted(false); }
			SetPhase(ECpvPhase::Fight);
			TapeSounds.Reset();
			Arena->StartTape();
			if (IsRun()) { UE_LOG(LogCpv, Display, TEXT("CPV_EPISODE live=%d lead=%d rival=%d"), Episode + 1, Cursor[0], Cursor[1]); }
			if (Round == 1 && !IsRun()) { Say(TEXT("start"), 1.f); }
			if (IsRun() && Episode == 1)
			{
				Fighters[0]->GiveWeapon(ECpvWeapon::Slate, CpvData::Weapon(ECpvWeapon::Slate).Uses);
				Fighters[1]->GiveWeapon(ECpvWeapon::Guitar, 2);
			}
			if (IsRun() && Episode == 2)
			{
				for (ACpvFighter* Star : Fighters) { Star->AddHype(CpvRule::MaxHype); }
			}
			if (Dev.FoeHealth >= 0.f) { Fighters[1]->Health = Dev.FoeHealth; }
			if (Dev.Hype >= 0.f) { Fighters[0]->Hype = Dev.Hype; Fighters[1]->Hype = Dev.Hype; }
			if (Dev.GiveWeapon > 0) { Fighters[0]->GiveWeapon(static_cast<ECpvWeapon>(FMath::Clamp(Dev.GiveWeapon, 1, static_cast<int32>(ECpvWeapon::Count) - 1)), 3); }
			if (Dev.Start == TEXT("finisher"))
			{
				// Test hook: go straight to the first fighter's Curtain Call.
				Fighters[1]->Health = 0.f;
				Fighters[1]->EnterState(ECpvState::Dazed);
				Fighters[1]->Play(TEXT("Dazed"), 0.f);
				BuildFinisher(Fighters[0], Fighters[1]);
			}
		}
		break;
	case ECpvPhase::Fight:
		if (IsRehearsing()) { TickRehearsal(DeltaTime, Any); }
		else { TickFight(DeltaTime); }
		break;
	case ECpvPhase::RoundEnd:
		StepFighters(DeltaTime, false);
		if (PhaseTime > 3.2f) { StartRound(); }
		break;
	case ECpvPhase::Finisher:
		StepFighters(DeltaTime, false);
		if (Seq.IsDone() && PhaseTime > 1.f)
		{
			if (Winner >= 0) { ++Wins[Winner]; }   // the Curtain Call counts as taking the deciding round
			EndMatch(Winner);
		}
		break;
	case ECpvPhase::MatchEnd:
		StepFighters(DeltaTime, false);
		ConfettiClock -= DeltaTime;
		if (ConfettiClock <= 0.f)
		{
			ConfettiClock = 0.5f;
			Fx->Confetti(26);
		}
		if (PhaseTime > 7.f || (PhaseTime > 2.5f && Any.bOk))
		{
			SetPhase(ECpvPhase::Results);
			Banner.Life = 0.f;
			Subtitle.Left = 0.f;
			ResultIndex = 0;
		}
		break;
	case ECpvPhase::Results:
	{
		if (bWatchingReplay) { TickReplay(RealDt, Any); break; }
		const int32 Choices = HasReplay() ? 4 : 3;
		StepFighters(DeltaTime, false);
		if (Dev.bAutoQuit && PhaseTime > 1.f) { FPlatformMisc::RequestExit(false); }
		if (Any.bUp) { ResultIndex = (ResultIndex + Choices - 1) % Choices; PlaySound("Tick"); }
		if (Any.bDown) { ResultIndex = (ResultIndex + 1) % Choices; PlaySound("Tick"); }
		if (Any.bOk && PhaseTime > 0.4f)
		{
			PlaySound("Select");
			if (ResultIndex == 0 && IsRun() && Winner == 0)
			{
				if (Episode < 2) { ++Episode; Cursor[1] = RivalForEpisode(Episode); bSkipIntro = false; StartMatch(); }
				else { Episode = 0; for (int32& Stars : EpisodeStars) { Stars = 0; } Cursor[1] = RivalForEpisode(Episode); bSkipIntro = false; StartMatch(); }
			}
			else if (ResultIndex == 0) { bSkipIntro = true; StartMatch(); }
			else if (ResultIndex == 1) { bSkipIntro = false; StartSelect(); }
			else if (ResultIndex == 2 && HasReplay()) { StartReplay(); }
			else { StartDemo(); SetPhase(ECpvPhase::Menu); }
		}
		break;
	}
	}

	// --- shared upkeep ---
	if (Banner.Life > 0.f)
	{
		Banner.Age += RealDt;
		if (Banner.Age >= Banner.Life) { Banner.Life = 0.f; }
	}
	Subtitle.Left = FMath::Max(0.f, Subtitle.Left - RealDt);
	SayCooldown = FMath::Max(0.f, SayCooldown - RealDt);
	NameCardAge += DeltaTime;
	for (int32 i = 0; i < 2; ++i) { MoveCalloutLeft[i] = FMath::Max(0.f, MoveCalloutLeft[i] - DeltaTime); }
	TickReferee(DeltaTime);
	TickCommentators(DeltaTime);
	TickWeapons(DeltaTime);
	TickProjectiles(DeltaTime);
	TickCamera(RealDt);
	TickAudio(RealDt);
	// Frame-rate report for tuning (CPV_PERF lines in the log every five seconds).
	if (PerfFrames == 0 && RenderScale == 0) { ApplyRenderScale(); }
	PerfTime += FrameSeconds;
	++PerfFrames;
	PerfWorst = FMath::Max(PerfWorst, FrameSeconds);
	if (PerfTime >= 5.f)
	{
		UE_LOG(LogCpv, Display, TEXT("CPV_PERF %.1f fps average, worst frame %.1f ms"), PerfFrames / PerfTime, PerfWorst * 1000.f);
		PerfTime = 0.f;
		PerfFrames = 0;
		PerfWorst = 0.f;
	}
	if (TickDev()) { FPlatformMisc::RequestExit(false); }
}

// ---------------------------------------------------------------------------------------------
// Menus and character select
// ---------------------------------------------------------------------------------------------

void ACpvGameMode::TickMenus(const FCpvMenuInput& In)
{
	if (Phase == ECpvPhase::Title)
	{
		if (In.bOk && PhaseTime > 0.5f)
		{
			PlaySound("Select");
			SetPhase(ECpvPhase::Menu);
			MenuIndex = 0;
		}
		return;
	}
	if (Phase == ECpvPhase::Menu)
	{
		const int32 Count = 8;
		if (In.bUp) { MenuIndex = (MenuIndex + Count - 1) % Count; PlaySound("Tick"); }
		if (In.bDown) { MenuIndex = (MenuIndex + 1) % Count; PlaySound("Tick"); }
		if (In.bBack) { SetPhase(ECpvPhase::Title); }
		if (In.bOk && PhaseTime > 0.15f)
		{
			PlaySound("Select");
			switch (MenuIndex)
			{
			case 0: Mode = ECpvMode::RatingsRun; bSkipIntro = false; StartSelect(); break;
			case 1: Mode = ECpvMode::OnePlayer; bSkipIntro = false; StartSelect(); break;
			case 2: Mode = ECpvMode::TwoPlayer; bSkipIntro = false; StartSelect(); break;
			case 3: Mode = ECpvMode::Watch; bSkipIntro = false; StartSelect(); break;
			case 4: OptionsPage = ECpvOptionsPage::General; SetPhase(ECpvPhase::Options); OptionIndex = 0; break;
			case 5: SetPhase(ECpvPhase::HowTo); break;
			case 6: SetPhase(ECpvPhase::Credits); break;
			default: FPlatformMisc::RequestExit(false); break;
			}
		}
		return;
	}
	if (Phase == ECpvPhase::Credits)
	{
		if (PhaseTime > 0.2f && (In.bBack || In.bOk)) { PlaySound("Back"); SetPhase(ECpvPhase::Menu); }
		return;
	}
	if (Phase == ECpvPhase::HowTo)
	{
		if (PhaseTime > 0.2f && In.bBack) { PlaySound("Back"); SetPhase(ECpvPhase::Menu); }
		else if (PhaseTime > 0.2f && In.bOk) { StartRehearsal(); }
		return;
	}
	TickOptions(In);
}

void ACpvGameMode::TickSelect(const FCpvMenuInput In[2])
{
	const int32 Count = CpvData::Roster().Num();
	const int32 Cols = 4;
	// With one human, the same player picks both corners in turn; with two, each picks their own.
	const int32 Step = SelectStep;   // fixed for this frame, so one press cannot lock both corners
	for (int32 Slot = 0; Slot < 2; ++Slot)
	{
		const bool bOwnPad = Mode == ECpvMode::TwoPlayer;
		if (!bOwnPad && Slot != Step) { continue; }
		if (bLocked[Slot]) { continue; }
		const FCpvMenuInput& I = bOwnPad ? In[Slot] : In[0];
		int32 C = I.Pick >= 0 ? I.Pick : Cursor[Slot];
		if (I.bLeft) { C = (C / Cols) * Cols + (C % Cols + Cols - 1) % Cols; }
		if (I.bRight) { C = (C / Cols) * Cols + (C % Cols + 1) % Cols; }
		if (I.bUp || I.bDown) { C = (C + Cols) % Count; }
		if (C != Cursor[Slot])
		{
			Cursor[Slot] = C;
			if (IsRun())
			{
				Cursor[1] = RivalForEpisode(Episode);
				Fighters[1]->Setup(1, Cursor[1], this);
				Fighters[1]->SetScripted(true);
				Fighters[1]->Play("Stand", 0.f);
			}
			PlaySound("Tick");
			Fighters[Slot]->Setup(Slot, C, this);
			Fighters[Slot]->SetScripted(true);
			Fighters[Slot]->Play(TEXT("Stand"), 0.f);
			TintTwin();
		}
		if (I.bOk && PhaseTime > 0.3f)
		{
			bLocked[Slot] = true;
			if (IsRun()) { bLocked[1] = true; }
			PlaySound("Select");
			PlaySound(FName(*FString::Printf(TEXT("VO_Name_%s"), Fighters[Slot]->Def().VoiceId)));
			Fighters[Slot]->Play(Fighters[Slot]->Def().Taunt, 0.1f);
			Arena->CrowdPop(0.3f);
			if (!bOwnPad)
			{
				SelectStep = FMath::Min(SelectStep + 1, 2);
				// Start the second cursor on somebody else (a mirror match is still there for the choosing).
				if (Slot == 0 && Cursor[1] == Cursor[0])
				{
					Cursor[1] = (Cursor[0] + 1) % Count;
					Fighters[1]->Setup(1, Cursor[1], this);
					Fighters[1]->SetScripted(true);
					Fighters[1]->Play(TEXT("Stand"), 0.f);
					TintTwin();
				}
			}
			PhaseTime = 0.31f;
		}
	}
	for (int32 Slot = 0; Slot < 2; ++Slot)
	{
		if (Fighters[Slot]->IsClipDone() && Fighters[Slot]->GetClip() != "Stand") { Fighters[Slot]->Play(TEXT("Stand"), 0.2f); }
	}
	const bool bBack = In[0].bBack || In[1].bBack;
	if (bBack)
	{
		PlaySound("Back");
		if (bLocked[1] && Mode != ECpvMode::TwoPlayer && !IsRun()) { bLocked[1] = false; SelectStep = 1; }
		else if (bLocked[0]) { bLocked[0] = false; bLocked[1] = false; SelectStep = 0; }
		else { StartDemo(); SetPhase(ECpvPhase::Menu); }
		return;
	}
	// Finish the second name over the selection pose before clearing its audio for the bout.
	if (bLocked[0] && bLocked[1] && PhaseTime > 1.3f && DuckLeft <= 0.f) { StartMatch(); }
}

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

bool ACpvGameMode::Down(int32 Player, const FKey& Key) const
{
	const APlayerController* PC = UGameplayStatics::GetPlayerController(this, Player);
	return PC && PC->IsInputKeyDown(Key);
}

bool ACpvGameMode::Pressed(int32 Player, const FKey& Key) const
{
	const APlayerController* PC = UGameplayStatics::GetPlayerController(this, Player);
	return PC && PC->WasInputKeyJustPressed(Key);
}

FCpvInput ACpvGameMode::ReadPlayer(int32 Slot)
{
	FCpvInput In;
	const bool bTwo = Mode == ECpvMode::TwoPlayer;
	auto Axis = [&](bool bNeg, bool bPos) { return (bPos ? 1.f : 0.f) - (bNeg ? 1.f : 0.f); };
	// Keyboard always arrives through player 0. Screen-right is +X; "up" on screen is away from the camera (-Y).
	if (Slot == 0)
	{
		In.Move.X += Axis(Down(0, EKeys::A), Down(0, EKeys::D));
		In.Move.Y += Axis(Down(0, EKeys::W), Down(0, EKeys::S));
		In.bLight |= Pressed(0, EKeys::F) || (!bTwo && Pressed(0, EKeys::J));
		In.bHeavy |= Pressed(0, EKeys::G) || (!bTwo && Pressed(0, EKeys::K));
		In.bGrab |= Pressed(0, EKeys::H) || (!bTwo && Pressed(0, EKeys::L));
		In.bSpecial |= Pressed(0, EKeys::T) || (!bTwo && Pressed(0, EKeys::U));
		In.bTaunt |= Pressed(0, EKeys::Y) || (!bTwo && Pressed(0, EKeys::O));
		In.bBlock |= Down(0, EKeys::R) || (!bTwo && Down(0, EKeys::I));
		In.bDodge |= Pressed(0, EKeys::SpaceBar);
		In.bRun |= Down(0, EKeys::LeftShift);
		if (!bTwo)
		{
			In.Move.X += Axis(Down(0, EKeys::Left), Down(0, EKeys::Right));
			In.Move.Y += Axis(Down(0, EKeys::Up), Down(0, EKeys::Down));
		}
	}
	else
	{
		In.Move.X += Axis(Down(0, EKeys::Left), Down(0, EKeys::Right));
		In.Move.Y += Axis(Down(0, EKeys::Up), Down(0, EKeys::Down));
		In.bLight |= Pressed(0, EKeys::Comma) || Pressed(0, EKeys::NumPadOne);
		In.bHeavy |= Pressed(0, EKeys::Period) || Pressed(0, EKeys::NumPadTwo);
		In.bGrab |= Pressed(0, EKeys::Slash) || Pressed(0, EKeys::NumPadThree);
		In.bSpecial |= Pressed(0, EKeys::L) || Pressed(0, EKeys::NumPadFour);
		In.bTaunt |= Pressed(0, EKeys::Semicolon) || Pressed(0, EKeys::NumPadSix);
		In.bBlock |= Down(0, EKeys::M) || Down(0, EKeys::NumPadFive);
		In.bDodge |= Pressed(0, EKeys::RightControl) || Pressed(0, EKeys::N) || Pressed(0, EKeys::NumPadZero);
		In.bRun |= Down(0, EKeys::RightShift);
	}
	// Gamepads: pad 1 for player one, pad 2 for player two.
	if (const APlayerController* PC = UGameplayStatics::GetPlayerController(this, Slot))
	{
		const float X = PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftX);
		const float Y = PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftY);
		if (FMath::Abs(X) > 0.25f || FMath::Abs(Y) > 0.25f) { In.Move += FVector2D(X, -Y); }
		In.Move.X += Axis(PC->IsInputKeyDown(EKeys::Gamepad_DPad_Left), PC->IsInputKeyDown(EKeys::Gamepad_DPad_Right));
		In.Move.Y += Axis(PC->IsInputKeyDown(EKeys::Gamepad_DPad_Up), PC->IsInputKeyDown(EKeys::Gamepad_DPad_Down));
		In.bLight |= PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Left);
		In.bHeavy |= PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Top);
		In.bGrab |= PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Right);
		In.bDodge |= PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Bottom);
		In.bSpecial |= PC->WasInputKeyJustPressed(EKeys::Gamepad_LeftShoulder);
		In.bTaunt |= PC->WasInputKeyJustPressed(EKeys::Gamepad_Special_Left) || PC->WasInputKeyJustPressed(EKeys::Gamepad_RightThumbstick);
		In.bBlock |= PC->IsInputKeyDown(EKeys::Gamepad_RightShoulder);
		In.bRun |= PC->IsInputKeyDown(EKeys::Gamepad_RightTrigger) || PC->GetInputAnalogKeyState(EKeys::Gamepad_RightTriggerAxis) > 0.4f;
	}
	if (In.Move.SizeSquared() > 1.0) { In.Move.Normalize(); }
	return In;
}

FCpvMenuInput ACpvGameMode::ReadMenu(int32 Slot)
{
	FCpvMenuInput In;
	if (Slot == 0)
	{
		In.bUp = Pressed(0, EKeys::W) || Pressed(0, EKeys::Up);
		In.bDown = Pressed(0, EKeys::S) || Pressed(0, EKeys::Down);
		In.bLeft = Pressed(0, EKeys::A) || Pressed(0, EKeys::Left);
		In.bRight = Pressed(0, EKeys::D) || Pressed(0, EKeys::Right);
		In.bOk = Pressed(0, EKeys::Enter) || Pressed(0, EKeys::SpaceBar) || Pressed(0, EKeys::J) || Pressed(0, EKeys::F);
		In.bBack = Pressed(0, EKeys::BackSpace) || Pressed(0, EKeys::Escape);
		In.bPause = Pressed(0, EKeys::Escape) || Pressed(0, EKeys::P);
		if (Mode == ECpvMode::TwoPlayer && Phase == ECpvPhase::Select)
		{
			// On the select screen each keyboard half drives its own cursor.
			In.bUp = Pressed(0, EKeys::W); In.bDown = Pressed(0, EKeys::S); In.bLeft = Pressed(0, EKeys::A); In.bRight = Pressed(0, EKeys::D);
			In.bOk = Pressed(0, EKeys::F) || Pressed(0, EKeys::SpaceBar);
		}
	}
	else if (Mode == ECpvMode::TwoPlayer && Phase == ECpvPhase::Select)
	{
		In.bUp = Pressed(0, EKeys::Up); In.bDown = Pressed(0, EKeys::Down); In.bLeft = Pressed(0, EKeys::Left); In.bRight = Pressed(0, EKeys::Right);
		In.bOk = Pressed(0, EKeys::Comma) || Pressed(0, EKeys::Enter);
	}
	if (Slot == 0)
	{
		// Scripted presses for automated runs.
		for (FCpvDevOptions::FPress& Press : Dev.Presses)
		{
			if (Press.bDone || DevClock < Press.Time) { continue; }
			Press.bDone = true;
			In.bOk |= Press.Button == TEXT("ok");
			In.bBack |= Press.Button == TEXT("back");
			In.bUp |= Press.Button == TEXT("up");
			In.bDown |= Press.Button == TEXT("down");
			In.bLeft |= Press.Button == TEXT("left");
			In.bRight |= Press.Button == TEXT("right");
			In.bPause |= Press.Button == TEXT("pause");
		}
	}
	if (const APlayerController* PC = UGameplayStatics::GetPlayerController(this, Slot))
	{
		In.bUp |= PC->WasInputKeyJustPressed(EKeys::Gamepad_DPad_Up) || PC->WasInputKeyJustPressed(EKeys::Gamepad_LeftStick_Up);
		In.bDown |= PC->WasInputKeyJustPressed(EKeys::Gamepad_DPad_Down) || PC->WasInputKeyJustPressed(EKeys::Gamepad_LeftStick_Down);
		In.bLeft |= PC->WasInputKeyJustPressed(EKeys::Gamepad_DPad_Left) || PC->WasInputKeyJustPressed(EKeys::Gamepad_LeftStick_Left);
		In.bRight |= PC->WasInputKeyJustPressed(EKeys::Gamepad_DPad_Right) || PC->WasInputKeyJustPressed(EKeys::Gamepad_LeftStick_Right);
		In.bOk |= PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Bottom);
		In.bBack |= PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Right);
		In.bPause |= PC->WasInputKeyJustPressed(EKeys::Gamepad_Special_Right);
	}
	return In;
}

// ---------------------------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------------------------

void ACpvGameMode::CutTo(const FVector& Pos, const FVector& Aim, float Fov)
{
	Cam.Pos = CamGoal.Pos = Pos;
	Cam.Aim = CamGoal.Aim = Aim;
	Cam.Fov = CamGoal.Fov = Fov;
	bCamScripted = true;
}

void ACpvGameMode::MoveTo(const FVector& Pos, const FVector& Aim, float Fov, float Speed)
{
	CamGoal.Pos = Pos;
	CamGoal.Aim = Aim;
	CamGoal.Fov = Fov;
	CamSpeed = Speed;
	bCamScripted = true;
}

void ACpvGameMode::FightCamera(FCpvCamShot& Out) const
{
	// A broadcast "hard camera" on the +Y side that slides and zooms to keep both fighters framed.
	const FVector A = Fighters[0]->GetActorLocation();
	const FVector B = Fighters[1]->GetActorLocation();
	const FVector Mid = (A + B) * 0.5;
	const float Spread = FMath::Abs(A.X - B.X) + FMath::Abs(A.Y - B.Y) * 0.6f;
	const float Lift = FMath::Max(Fighters[0]->Height, Fighters[1]->Height);
	Out.Aim = FVector(Mid.X * 0.8, Mid.Y * 0.6, 112.0 + Lift * 0.35);
	const float Dist = FMath::Clamp(600.f + Spread * 0.8f + Lift * 0.5f, 760.f, 1150.f);
	// Never closer than a few metres to whoever is nearest the camera-side ropes.
	const float CamY = FMath::Max(Out.Aim.Y + Dist, FMath::Max(A.Y, B.Y) + 700.0);
	Out.Pos = FVector(Out.Aim.X * 0.85, CamY, 170.0 + Dist * 0.2);
	Out.Fov = 38.f;
	if (PinSlot >= 0)
	{
		Out.Aim = Mid + FVector(0, 0, 48);
		Out.Pos = Out.Aim + FVector(55, 570, 342);
		Out.Fov = 39.f;
	}
}

void ACpvGameMode::TickCamera(float Dt)
{
	if (!Camera) { return; }
	FCpvCamShot Want = CamGoal;
	float Speed = CamSpeed;
	if (Dev.bHaveCam)
	{
		Want.Pos = Dev.CamPos; Want.Aim = Dev.CamAim; Want.Fov = Dev.CamFov;
		Cam = Want;
	}
	else if (!bCamScripted)
	{
		switch (Phase)
		{
		case ECpvPhase::Title:
		case ECpvPhase::Menu:
		case ECpvPhase::Options:
		case ECpvPhase::Credits:
	case ECpvPhase::HowTo:
		{
			// A slow crane shot drifting round the camera side of the arena.
			OrbitAngle += Dt * 5.f;
			const float A = FMath::DegreesToRadians(90.f + 55.f * FMath::Sin(FMath::DegreesToRadians(OrbitAngle)));
			Want.Pos = FVector(FMath::Cos(A) * 980.0, FMath::Sin(A) * 980.0, 300.0 + 60.0 * FMath::Sin(FMath::DegreesToRadians(OrbitAngle * 1.7f)));
			Want.Aim = FVector(0.0, 0.0, 70.0);
			Want.Fov = 44.f;
			Speed = 2.f;
			break;
		}
		case ECpvPhase::Select:
			// Inside the ropes, close on the two contenders.
			Want.Pos = FVector(0.0, 250.0, 135.0);
			Want.Aim = FVector(0.0, -150.0, 116.0);
			Want.Fov = 56.f;
			Speed = 3.f;
			break;
		case ECpvPhase::Versus:
			Want.Pos = FVector(0.0, 1000.0, 300.0);
			Want.Aim = FVector(0.0, 0.0, 80.0);
			Want.Fov = 40.f;
			Speed = 2.f;
			break;
		default:
			if (Fighters[0] && Fighters[1]) { FightCamera(Want); }
			Speed = 4.5f;
			break;
		}
	}
	Cam.Pos = FMath::VInterpTo(Cam.Pos, Want.Pos, Dt, Speed);
	Cam.Aim = FMath::VInterpTo(Cam.Aim, Want.Aim, Dt, Speed * 1.3f);
	Cam.Fov = FMath::FInterpTo(Cam.Fov, Want.Fov, Dt, Speed);

	ShakeLevel = FMath::Max(0.f, ShakeLevel - Dt * 38.f - ShakeLevel * Dt * 6.f);
	const float Amp = bShake ? FMath::Min(ShakeLevel, 26.f) : 0.f;
	const FVector Jitter(FMath::FRandRange(-1.f, 1.f) * Amp * 0.5f, 0.0, FMath::FRandRange(-1.f, 1.f) * Amp);
	const FVector Pos = Cam.Pos + Jitter;
	Camera->SetActorLocationAndRotation(Pos, (Cam.Aim + Jitter * 0.4 - Pos).Rotation());
	UCameraComponent* Lens = Camera->GetCameraComponent();
	Lens->SetFieldOfView(Cam.Fov);
	// Shallow focus on the action sells the miniature-set look.
	FPostProcessSettings& PP = Lens->PostProcessSettings;
	PP.bOverride_DepthOfFieldFocalDistance = true;
	PP.DepthOfFieldFocalDistance = FVector::Dist(Pos, Cam.Aim);
	PP.bOverride_DepthOfFieldFstop = true;
	PP.DepthOfFieldFstop = 3.2f;
	PP.bOverride_DepthOfFieldSensorWidth = true;
	PP.DepthOfFieldSensorWidth = 36.f;
	Lens->PostProcessBlendWeight = 1.f;
	if (Arena) { Arena->SetFeedView(Pos, Camera->GetActorRotation(), Cam.Fov); }
	if (Fx) { Fx->SetCamera(Pos); }
}

// ---------------------------------------------------------------------------------------------
// Animation gallery (dev)
// ---------------------------------------------------------------------------------------------

void ACpvGameMode::BuildGallery()
{
	// Film strips: each row is one clip sampled at evenly spaced times, left to right.
	UWorld* World = GetWorld();
	ADirectionalLight* Key = World->SpawnActor<ADirectionalLight>(FVector::ZeroVector, FRotator(-38.f, -120.f, 0.f));
	Key->GetLightComponent()->SetMobility(EComponentMobility::Movable);
	Key->GetLightComponent()->SetIntensity(34.f);
	ADirectionalLight* FillLight = World->SpawnActor<ADirectionalLight>(FVector::ZeroVector, FRotator(-15.f, 40.f, 0.f));
	FillLight->GetLightComponent()->SetMobility(EComponentMobility::Movable);
	FillLight->GetLightComponent()->SetIntensity(14.f);
	FillLight->GetLightComponent()->SetCastShadows(false);

	const int32 Frames = FMath::Max(Dev.GalleryFrames, 2);
	const float ColW = 165.f, RowH = 240.f;
	for (int32 Row = 0; Row < Dev.Gallery.Num(); ++Row)
	{
		const FName Clip(*Dev.Gallery[Row]);
		const float Length = CpvAnim::Get(Clip).Length;
		for (int32 f = 0; f < Frames; ++f)
		{
			// Rows step back along the view direction so they stack up the screen.
			const FVector Loc((f - (Frames - 1) * 0.5f) * ColW, 0.0, -Row * RowH);
			ACpvPuppet* Puppet = World->SpawnActor<ACpvPuppet>(Loc, FRotator::ZeroRotator);
			Puppet->SetCharacter(Dev.GalleryChar);
			Puppet->Play(Clip, 0.f, 0.f);
			Puppet->SetClipTime(Length * f / (Frames - 1));
			GalleryPuppets.Add(Puppet);
		}
	}
	const float MidZ = -(Dev.Gallery.Num() - 1) * RowH * 0.5f + 92.f;
	const float Fov = 18.f;
	const float HalfW = Frames * ColW * 0.5f + 40.f;
	const float HalfH = Dev.Gallery.Num() * RowH * 0.5f + 10.f;
	const float Dist = 1.25f * FMath::Max(HalfW, HalfH * 1.5f) / FMath::Tan(FMath::DegreesToRadians(Fov * 0.5f));
	const FVector Dir = FRotator(0.f, 68.f, 0.f).Vector();   // three-quarter view from the camera side
	Camera->SetActorLocationAndRotation(FVector(0.0, 0.0, MidZ) + Dir * Dist, (-Dir).Rotation());
	Camera->GetCameraComponent()->SetFieldOfView(Fov);
}
