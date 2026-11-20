#pragma once

#include "CoreMinimal.h"
#include "InputCoreTypes.h"
#include "CpvAI.h"
#include "CpvTypes.h"
#include "GameFramework/GameModeBase.h"
#include "CpvGame.generated.h"

class ACameraActor;
class ACpvArena;
class ACpvFighter;
class ACpvFx;
class ACpvPuppet;
class APlayerController;
class UAudioComponent;
class USoundBase;
class UStaticMeshComponent;
class SWidget;

enum class ECpvPhase : uint8 { Title, Menu, Options, HowTo, Select, Versus, Intro, RoundIntro, Fight, RoundEnd, Finisher, MatchEnd, Results, Credits };
enum class ECpvOptionsPage { General, Sound, Picture };
enum class ECpvAudioBus { Music, Voice, Effects, Crowd, Interface };
enum class ECpvMode : uint8 { OnePlayer, TwoPlayer, Watch, RatingsRun, Rehearsal };

/** Screenshot / scripted-run options read from the command line (see README: "Test flags"). */
struct FCpvDevOptions
{
	struct FShot { float Time; FString Name; bool bTaken = false; };
	TArray<FShot> Shots;
	float QuitAt = -1.f;
	bool bHaveCam = false;
	FVector CamPos = FVector::ZeroVector;
	FVector CamAim = FVector::ZeroVector;
	float CamFov = 40.f;
	TArray<FString> Gallery;
	FString GalleryChar = TEXT("Rex");
	int32 GalleryFrames = 9;
	FString Start;             // "fight", "select", "finisher", ...
	int32 Pick[2] = { -1, -1 };
	bool bHud = true;
	float FoeHealth = -1.f;
	float Hype = -1.f;
	int32 GiveWeapon = 0;
	struct FPress { float Time; FString Button; bool bDone = false; };
	TArray<FPress> Presses;     // scripted menu presses: -CpvPress=ok@3,down@4,...
	struct FKeyTap { float Time = 0.f; float Hold = 0.08f; FKey Key; int32 Pad = 0; int32 Stage = 0; };
	struct FClick { float Time; FVector2D Point; bool bDone = false; };
	TArray<FClick> Clicks;
	TArray<FKeyTap> Keys;       // real key events sent through Slate: -CpvKeys=Enter@3,D@10:1.5,p2.Gamepad_FaceButton_Left@12
	FString AudioOut;           // -CpvAudioOut=<name>: record the final mix to Saved/Shots/<name>.wav
	bool bDummy = false;        // -CpvDummy: computer-controlled fighters stand still (for testing the controls)
	bool bWindow = false;       // -CpvWindow: stay in a window whatever the saved display option says (test runs)
	bool bFullscreen = false;   // -CpvFullscreen: go full screen for this session
	bool bMash = false;         // -CpvMash: player one is played by a button-masher (for judging the difficulty levels)
	bool bAutoQuit = false;     // -CpvAutoQuit: exit when the results screen comes up
	int32 Difficulty = -1;      // -CpvDifficulty=0..2
	int32 AudioStage = 0;

	void Parse();
	bool Tick(float Now);
};

/** A list of timed steps: intros and finishers are little scripts built from these. */
struct FCpvSequence
{
	struct FStep { float Time; TFunction<void()> Fn; };
	TArray<FStep> Steps;
	float Clock = 0.f;
	int32 Next = 0;
	bool bActive = false;

	void Reset() { Steps.Reset(); Clock = 0.f; Next = 0; bActive = true; }
	void At(float Time, TFunction<void()> Fn) { Steps.Add({ Time, MoveTemp(Fn) }); }
	void Tick(float Dt);
	bool IsDone() const { return !bActive || Next >= Steps.Num(); }
};

/** Calls Fn(0..1) every frame for Life seconds (scripted motion: falling props, shrinking victims). */
struct FCpvTween
{
	float Age = 0.f;
	float Life = 1.f;
	TFunction<void(float)> Fn;
};

struct FCpvCamShot
{
	FVector Pos = FVector(0.0, 1120.0, 255.0);
	FVector Aim = FVector(0.0, 0.0, 70.0);
	float Fov = 40.f;
};

struct FCpvBanner
{
	FString Text;
	FString Sub;
	FLinearColor Colour = FLinearColor::White;
	float Age = 0.f;
	float Life = 0.f;
	float Scale = 1.f;
};

struct FCpvSubtitle
{
	int32 Speaker = 0;
	FString Text, Portuguese;
	float Left = 0.f;
};

struct FCpvMenuInput
{
	int32 Pick = -1;
	bool bUp = false, bDown = false, bLeft = false, bRight = false, bOk = false, bBack = false, bPause = false;
};

UCLASS()
class ACpvGameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	ACpvGameMode();
	virtual void RestartPlayer(AController* NewPlayer) override {}
	virtual bool AllowCheats(APlayerController* P) override { return false; }   // no engine cheat commands or debug camera
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	virtual void Tick(float DeltaTime) override;

	// --- for fighters ---
	ACpvArena* GetArena() const { return Arena; }
	ACpvFx* GetFx() const { return Fx; }
	void OnStrike(ACpvFighter* From, ACpvFighter* Victim, float Damage, ECpvReaction Reaction, ECpvWord Word, FName Sound, const FVector& At, bool bBlocked);
	void OnCleanBlock(ACpvFighter* Who);
	void OnSlam(const FVector& At, float Strength, bool bPlayImpact = true);
	void OnKnockout(ACpvFighter* Victim, ACpvFighter* By);
	void OnTaunt(ACpvFighter* Who);
	void OnSpecial(ACpvFighter* Who);
	void OnGrab(ACpvFighter* Attacker, ACpvFighter* Victim);
	void OnRopeBounce(ACpvFighter* Who);
	void OnHypeFull(ACpvFighter* Who);
	void StrikeReferee(ACpvFighter* From, const FCpvMove& Move);
	bool TryStartFinisher(ACpvFighter* Attacker);
	bool CanCover(const ACpvFighter* Attacker) const;
	bool TryCover(ACpvFighter* Attacker);
	bool bPins = true;
	int32 PinSlot = -1;
	int32 PinCount = 0;
	float PinClock = 0.f;
	bool bPinMiss = false;
	bool bWonByPin = false;
	float EscapeStart() const;
	float EscapeEnd() const;
	float EscapeNeedle() const;
	void PlaySound(FName Name, float Volume = 1.f, float Pitch = 1.f);
	void Shake(float Amount) { ShakeLevel = FMath::Max(ShakeLevel, Amount); }

	// weapons and projectiles
	bool WeaponNear(const ACpvFighter* Who, float Range) const;
	bool NearestWeapon(const FVector2D& From, FVector& OutAt) const;
	bool TryPickup(ACpvFighter* Who);
	void DropWeaponAt(ECpvWeapon Type, int32 Uses, const FVector& At, const FVector2D& Fling);
	void BreakWeapon(ECpvWeapon Type, const FVector& At);
	void ThrowWeapon(ACpvFighter* From, ECpvWeapon Type, int32 Uses);
	void SpawnProjectile(ACpvFighter* Owner, int32 Kind, const FVector& From, const FVector& Target);

	// --- for the HUD ---
	ECpvPhase Phase = ECpvPhase::Title;
	float PhaseTime = 0.f;
	ECpvMode Mode = ECpvMode::OnePlayer;
	UPROPERTY()
	TObjectPtr<ACpvFighter> Fighters[2];
	int32 Wins[2] = { 0, 0 };
	int32 Round = 1;
	float RoundClock = 99.f;
	int32 Winner = -1;
	bool bPaused = false;
	int32 PauseIndex = 0;
	int32 MenuIndex = 0;
	int32 OptionIndex = 0;
	int32 Cursor[2] = { 0, 1 };
	bool bLocked[2] = { false, false };
	int32 ResultIndex = 0;
	bool bWatchingReplay = false;
	float ReplayTime = 0.f;
	bool HasReplay() const;
	float ReplayProgress() const;
	UTexture* ReplayPicture() const;
	FCpvBanner Banner;
	FCpvSubtitle Subtitle;
	FString NameCard;          // lower-third during entrances
	FString NameCardSub;
	float NameCardAge = 0.f;
	float FinisherPrompt = 0.f; // > 0 while a Curtain Call is on offer
	int32 FinisherFor = -1;
	FString MoveCallout[2];    // signature move name flash
	float MoveCalloutLeft[2] = { 0.f, 0.f };
	float Letterbox = 0.f;
	float FadeOut = 0.f;        // 1 = black
	bool bShowHud = true;
	float RealTime = 0.f;

	// options
	int32 Difficulty = 1;      // 0..2
	int32 RoundsToWin = 2;     // 1 or 2 (best of 1 / 3)
	int32 RoundSeconds = 99;   // 0 = no limit
	int32 AnimStyle = 0;       // 0 = stop-motion 12 fps, 1 = 15 fps, 2 = smooth
	ECpvOptionsPage OptionsPage = ECpvOptionsPage::General;
	bool bPauseOptions = false;
	int32 BusVolume[5] = {10, 10, 10, 10, 10};
	bool bVoiceDucking = true;
	bool bSubtitles = true;
	bool bPortugueseSubtitles = false;
	bool bShake = true;
	bool bArenaFlashes = true;
	int32 Detail[6] = {2, 2, 2, 2, 2, 2};
	int32 RenderScale = 0; // 0 keeps the original automatic scale for large windows
	int32 FeedRate = 1;
	int32 FrameLimit = 3;
	bool bVSync = false;
	bool bPerformanceHud = false;
	float MeasuredFPS = 0.f;
	int32 OptionCount() const;
	const TCHAR* OptionLabel(int32 Row) const;
	FString OptionValue(int32 Row) const;
	float DetailMeter() const;
	int32 MatchedPreset() const;
	int32 SoundVolume = 8;     // 0..10, master level
	bool bFullscreen = false;  // remembered; applied a moment after start-up (see TickDisplay)
	int32 Episode = 0;
	int32 Champions[3] = {};
	int32 BestShow[3][8] = {};
	int32 EpisodeStars[3] = {};
	bool bCrowdCall = false;
	const TCHAR* CrowdCall() const;
	int32 SeasonStars() const { return EpisodeStars[0] + EpisodeStars[1] + EpisodeStars[2]; }
	int32 Lesson = 0;
	float CueHold = 0.f;
	bool IsRehearsing() const { return Mode == ECpvMode::Rehearsal && Phase == ECpvPhase::Fight; }
	bool IsRun() const { return Mode == ECpvMode::RatingsRun; }
	int32 RequiredWins() const { return IsRun() ? 1 : RoundsToWin; }
	int32 RivalForEpisode(int32 Stage) const;
	const TCHAR* EpisodeName() const;
	const TCHAR* EpisodeRule() const;
	bool IsChampion(int32 Star) const { return (Champions[Difficulty] & (1 << Star)) != 0; }
	bool IsHuman(int32 Slot) const { return Mode == ECpvMode::TwoPlayer || ((Mode == ECpvMode::OnePlayer || IsRun() || IsRehearsing()) && Slot == 0); }
	bool IsMirror() const;      // the same celebrity in both corners
	static FLinearColor TwinTint() { return FLinearColor(0.4f, 0.8f, 1.f); }
	bool IsDemo() const { return Phase == ECpvPhase::Title || Phase == ECpvPhase::Menu || Phase == ECpvPhase::Options || Phase == ECpvPhase::HowTo || Phase == ECpvPhase::Credits; }

private:
	// flow
	void SetPhase(ECpvPhase NewPhase);
	void StartDemo();
	void StartSelect();
	void StartMatch();
	void StartIntro();
	void StartRound();
	void EndRound(int32 RoundWinner);
	void EndMatch(int32 MatchWinner);
	void FulfillCrowdCall();
	void ScoreEpisode();
	void TickFight(float Dt);
	void TickCover(float Dt);
	void SetEscapeBeat();
	float CpuEscapeTime = 0.f;
	void StartRehearsal();
	void SetLesson(int32 Index);
	void PassCue();
	void TickRehearsal(float Dt, const FCpvMenuInput& Menu);
	FCpvInput TrainerInput(float Dt);
	float TrainerClock = 0.f;
	void TickMenus(const FCpvMenuInput& In);
	void TickSelect(const FCpvMenuInput In[2]);
	void ApplyOptions();
	void TickOptions(const FCpvMenuInput& In);
	void ApplyPicture();
	void ApplyRenderScale();
	void LoadAVOptions();
	void SaveAVOptions();
	void RefreshMix();
	void RefreshBeds();
	void TickBeds(float Dt);
	TWeakObjectPtr<UAudioComponent> VoicePreview;
	float BusGain(ECpvAudioBus Bus) const;
	UAudioComponent* PlayMixedClip(USoundBase* Sound, ECpvAudioBus Bus, float Level, float Pitch = 1.f);
	struct FPlayingClip { TWeakObjectPtr<UAudioComponent> Component; ECpvAudioBus Bus; float Level; };
	TArray<FPlayingClip> PlayingClips;
	float VoiceLevel = 1.f;
	float MeterElapsed = 0.f;
	int32 MeterFrames = 0;
	double PreviousFrameTime = 0.0;
	void SpawnFighters(int32 A, int32 B);
	void TintTwin();            // in a mirror match the right-hand fighter gets a cool cast
	void ShowBanner(const FString& Text, const FString& Sub, float Life, const FLinearColor& Colour, float Scale = 1.f);
	void ClearCallouts();       // drop any banner, subtitle or prompt left over from the previous scene
	void BuildIntro();
	void BuildFinisher(ACpvFighter* Attacker, ACpvFighter* Victim);
	void BuildMatchEnd();
	void StartReplay();
	void TickReplay(float Dt, const FCpvMenuInput& Menu);
	struct FTapeSound { float At; FName Name; float Volume, Pitch; };
	TArray<FTapeSound> TapeSounds;
	int32 NextTapeSound = 0;
	void Tween(float Duration, TFunction<void(float)> Fn);
	void TickTweens(float Dt);
	void HideProps();
	void FinisherBoom(ACpvFighter* Victim, int32 Chunks, float Size);
	void StepFighters(float Dt, bool bAllowInput);
	void SeparateFighters();
	void DrawStageScreen(const FString& Top, const FString& Main, const FLinearColor& Colour);

	// input
	FCpvInput ReadPlayer(int32 Slot);
	FCpvMenuInput ReadMenu(int32 Slot);
	void ReadPointer(FCpvMenuInput (&Menu)[2]);
	FVector2D PointerPoint = FVector2D::ZeroVector;
	bool bHavePointer = false, bPointerClick = false;
	TSharedPtr<SWidget> PointerLayer;
	void QueuePointer(FVector2D Normalized, bool bClick);
	void ClickViewport(const FVector2D& At);
	void ClosePointer();
	bool bPointerVisible = false;
	void OpenCapture();
	void TickCapture();
	void AuditSample();
	void WriteCapture(int32 Width, int32 Height, const TArray<FColor>& Pixels);
	void WriteCaptureTime(const FString& Line);
	TUniquePtr<FArchive> FilmPixels, FilmTimings;
	FString AuditPath;
	double AuditStart = 0.0, NextAudit = 0.0;
	int32 LastAuditPhase = INDEX_NONE;
	FIntPoint FilmSize = FIntPoint::ZeroValue;
	double FilmStart = 0.0, NextFilmFrame = 0.0;
	bool TickDev();             // scripted keys, screenshots, audio capture; true when it is time to quit
	FCpvInput MashInput(float Dt, const ACpvFighter& Me, const ACpvFighter& Foe);
	float MashClock = 0.f;
	float MashBlock = 0.f;
	bool Down(int32 Player, const FKey& Key) const;
	bool Pressed(int32 Player, const FKey& Key) const;

	// camera
	void TickCamera(float Dt);
	void CutTo(const FVector& Pos, const FVector& Aim, float Fov);
	void MoveTo(const FVector& Pos, const FVector& Aim, float Fov, float Speed = 3.f);
	void FightCamera(FCpvCamShot& Out) const;

	// supporting cast
	void TickReferee(float Dt);
	void TickCommentators(float Dt);
	void Say(const TCHAR* Event, float Chance = 1.f, const FString& Name = FString());
	void LoadCommentary();
	void CommentatorsReact(FName Clip);

	// hazards
	void TickWeapons(float Dt);
	void TickProjectiles(float Dt);
	void TossWeaponIn(ECpvWeapon Type);
	void BuildGallery();
	void PreloadContent();

	// audio
	USoundBase* FindSound(FName Name);
	void StartLoop(TObjectPtr<UAudioComponent>& Comp, FName Name, float Level);
	void TickAudio(float Dt);
	float MasterGain() const { return 0.2f * SoundVolume; }   // the default 8 gives 1.6: the raw mix is quiet
	void LoadOptions();
	void SaveOptions();
	void TickDisplay();         // window / full screen, switched once the window is up
	bool IsFullscreenNow() const;
	bool CanSwitchDisplay() const;   // only while the game is the foreground app
	bool bDisplayApplied = false;
	float DisplayWait = 0.f;

	UPROPERTY()
	TObjectPtr<ACpvArena> Arena;
	UPROPERTY()
	TObjectPtr<ACpvFx> Fx;
	UPROPERTY()
	TObjectPtr<ACameraActor> Camera;
	UPROPERTY()
	TObjectPtr<ACpvPuppet> Referee;
	UPROPERTY()
	TObjectPtr<ACpvPuppet> Commentators[2];
	UPROPERTY()
	TArray<TObjectPtr<ACpvPuppet>> GalleryPuppets;
	UPROPERTY()
	TObjectPtr<ACpvPuppet> LooseHead;     // the flying head for one particular Curtain Call
	UPROPERTY()
	TMap<FName, TObjectPtr<USoundBase>> Sounds;
	UPROPERTY()
	TObjectPtr<UAudioComponent> MusicComp;
	UPROPERTY()
	TObjectPtr<UAudioComponent> CrowdComp;
	UPROPERTY()
	TObjectPtr<UAudioComponent> VoiceComp;
	UPROPERTY()
	TArray<TObjectPtr<UStaticMeshComponent>> PropPool;
	UPROPERTY()
	TArray<TObjectPtr<UObject>> Preloaded;   // every sound, prop and character, loaded up front so nothing hitches mid-bout

	struct FMatWeapon
	{
		ECpvWeapon Type = ECpvWeapon::None;
		int32 Uses = 0;
		UStaticMeshComponent* Comp = nullptr;
		FVector Pos = FVector::ZeroVector;
		FVector Vel = FVector::ZeroVector;
		FRotator Rot = FRotator::ZeroRotator;
		FRotator Spin = FRotator::ZeroRotator;
		bool bResting = false;
		bool bThrown = false;    // flying at someone
		ACpvFighter* Owner = nullptr;
	};
	TArray<FMatWeapon> Weapons;

	struct FProjectile
	{
		int32 Kind = 0;          // 0 bomb (lobbed), 1 crystal ball (straight)
		ACpvFighter* Owner = nullptr;
		UStaticMeshComponent* Comp = nullptr;
		FVector Pos = FVector::ZeroVector;
		FVector Vel = FVector::ZeroVector;
		float Age = 0.f;
	};
	TArray<FProjectile> Projectiles;
	UStaticMeshComponent* TakeProp(const TCHAR* MeshPath);
	void ReturnProp(UStaticMeshComponent* Comp);

	struct FLine { int32 Speaker; FString Text; };
	TMap<FString, TArray<FLine>> Lines;
	TMap<FName, FString> AnnouncerCaptions, PortugueseCaptions;
	FCpvSubtitle PendingSubtitle;
	FName PendingVoice;
	void StopVoice();
	float SayCooldown = 0.f;
	float MusicLevel = 0.f;     // level of the music loop before master volume and ducking
	float DuckLeft = 0.f;       // while a voice line plays, music and crowd drop back
	float Duck = 1.f;

	FCpvAI Brains[2];
	FCpvSequence Seq;
	TArray<FCpvTween> Tweens;
	FCpvDevOptions Dev;

	// camera state
	FCpvCamShot Cam;
	FCpvCamShot CamGoal;
	float CamSpeed = 4.f;
	bool bCamScripted = false;
	float ShakeLevel = 0.f;
	float OrbitAngle = 0.f;

	// referee
	float RefDown = 0.f;
	FName RefAct;
	float RefActLeft = 0.f;
	FVector2D RefGoal = FVector2D(0.0, -160.0);

	float SlowLeft = 0.f;
	float WeaponClock = 14.f;
	float HypeBase = 0.3f;
	float RoundEndClock = 0.f;
	bool bRoundOver = false;
	float DemoRestart = 0.f;
	float Age = 0.f;
	int32 SelectStep = 0;
	bool bSkipIntro = false;
	float ConfettiClock = 0.f;
	float DevClock = 0.f;       // like Age, but keeps running while paused so scripted runs always finish
	float PerfTime = 0.f;
	float PerfWorst = 0.f;
	int32 PerfFrames = 0;
};
