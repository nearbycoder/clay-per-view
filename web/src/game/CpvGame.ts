// Port of CpvGame.h: the game mode's state and the list of everything it can do.
//
// In the C++ one class is spread over ten .cpp files. Here the class below holds the fields, like the
// header, and each `declare`d method is supplied by the file named beside it through implement():
//
//     implement(ACpvGameMode, {
//       OnTaunt(Who) { ...this.Arena.CrowdPop(0.2)... },
//     });
//
// main.ts imports every one of those files before the game mode is spawned.

import type { Texture } from 'three';

import type { UAudioComponent, USoundBase } from '../engine/audio';
import type { FKey } from '../engine/input';
import { FParse } from '../engine/platform';
import { FLinearColor, FRotator, FVector, FVector2D } from '../engine/ue';
import { AActor, ACameraActor, UStaticMeshComponent } from '../engine/world';
import { FCpvAI } from './CpvAI';
import type { ACpvArena } from './CpvArena';
import type { ACpvFighter } from './CpvFighter';
import type { ACpvFx } from './CpvFx';
import type { ACpvHUD } from './CpvHud';
import type { ACpvPuppet } from './CpvPuppet';
import { CpvRule, ECpvReaction, ECpvWeapon, ECpvWord, FCpvInput, FCpvMove } from './CpvTypes';

export enum ECpvPhase { Title, Menu, Options, HowTo, Select, Versus, Intro, RoundIntro, Fight, RoundEnd, Finisher, MatchEnd, Results, Credits }
export enum ECpvOptionsPage { General, Sound, Picture }
export enum ECpvAudioBus { Music, Voice, Effects, Crowd, Interface }
export enum ECpvMode { OnePlayer, TwoPlayer, Watch, RatingsRun, Rehearsal }

/** Supplies method bodies for a class whose methods are declared elsewhere (see the note at the top). */
export function implement<T>(Class: { prototype: T }, Methods: Partial<T> & ThisType<T>): void {
  Object.assign(Class.prototype as object, Methods);
}

/** Scripted-run options read from the page's query string (see the README: "Test flags"). */
export class FCpvDevOptions {
  QuitAt = -1;
  bHaveCam = false;
  CamPos = FVector.ZeroVector;
  CamAim = FVector.ZeroVector;
  CamFov = 40;
  Gallery: string[] = [];
  GalleryChar = 'Rex';
  GalleryFrames = 9;
  Start = '';             // "fight", "select", "finisher", ...
  Pick: number[] = [-1, -1];
  bHud = true;
  FoeHealth = -1;
  Hype = -1;
  GiveWeapon = 0;
  Presses: Array<{ Time: number; Button: string; bDone: boolean }> = [];   // scripted menu presses: CpvPress=ok@3,down@4,...
  Keys: Array<{ Time: number; Hold: number; Key: FKey; Pad: number; Stage: number }> = [];   // CpvKeys=Enter@3,KeyD@10:1.5,p2.Gamepad_FaceButton_Left@12
  Clicks: Array<{ Time: number; Point: FVector2D; bDone: boolean }> = [];  // CpvClicks=x:y@seconds (0..1 of the picture)
  bDummy = false;         // CpvDummy: computer-controlled fighters stand still (for testing the controls)
  bMash = false;          // CpvMash: player one is played by a button-masher (for judging the difficulty levels)
  bAutoQuit = false;      // CpvAutoQuit: finish the run when the results screen comes up
  Difficulty = -1;        // CpvDifficulty=0..2

  /** Implemented in CpvGameFlow.ts. */
  declare Parse: () => void;
  /** True when it is time to end a scripted run. */
  declare Tick: (Now: number) => boolean;
}

/** A list of timed steps: intros and finishers are little scripts built from these. */
export class FCpvSequence {
  Steps: Array<{ Time: number; Fn: () => void }> = [];
  Clock = 0;
  Next = 0;
  bActive = false;

  Reset(): void { this.Steps = []; this.Clock = 0; this.Next = 0; this.bActive = true; }
  At(Time: number, Fn: () => void): void { this.Steps.push({ Time, Fn }); }
  Tick(Dt: number): void {
    if (!this.bActive) { return; }
    this.Clock += Dt;
    while (this.Next < this.Steps.length && this.Steps[this.Next].Time <= this.Clock) {
      const Run = this.Next++;
      this.Steps[Run].Fn();          // a step may start a new sequence, so advance first
      if (!this.bActive || this.Steps.length === 0) { return; }
    }
  }
  IsDone(): boolean { return !this.bActive || this.Next >= this.Steps.length; }
}

/** Calls Fn(0..1) every frame for Life seconds (scripted motion: falling props, shrinking victims). */
export interface FCpvTween {
  Age: number;
  Life: number;
  Fn: (Alpha: number) => void;
}

export class FCpvCamShot {
  Pos = new FVector(0, 1120, 255);
  Aim = new FVector(0, 0, 70);
  Fov = 40;
  Clone(): FCpvCamShot {
    const C = new FCpvCamShot();
    C.Pos = this.Pos; C.Aim = this.Aim; C.Fov = this.Fov;
    return C;
  }
}

export class FCpvBanner {
  Text = '';
  Sub = '';
  Colour = FLinearColor.White;
  Age = 0;
  Life = 0;
  Scale = 1;
}

export class FCpvSubtitle {
  Speaker = 0;
  Text = '';
  Portuguese = '';
  Left = 0;
  Clone(): FCpvSubtitle {
    const S = new FCpvSubtitle();
    S.Speaker = this.Speaker; S.Text = this.Text; S.Portuguese = this.Portuguese; S.Left = this.Left;
    return S;
  }
}

export class FCpvMenuInput {
  Pick = -1;
  bUp = false;
  bDown = false;
  bLeft = false;
  bRight = false;
  bOk = false;
  bBack = false;
  bPause = false;
  Clone(): FCpvMenuInput { return Object.assign(new FCpvMenuInput(), this); }
}

/** A weapon lying on (or flying over) the mat. */
export class FMatWeapon {
  Type = ECpvWeapon.None;
  Uses = 0;
  Comp: UStaticMeshComponent | null = null;
  Pos = FVector.ZeroVector;
  Vel = FVector.ZeroVector;
  Rot = FRotator.ZeroRotator;
  Spin = FRotator.ZeroRotator;
  bResting = false;
  bThrown = false;    // flying at someone
  Owner: ACpvFighter | null = null;
}

export class FProjectile {
  Kind = 0;          // 0 bomb (lobbed), 1 crystal ball (straight)
  Owner: ACpvFighter | null = null;
  Comp: UStaticMeshComponent | null = null;
  Pos = FVector.ZeroVector;
  Vel = FVector.ZeroVector;
  Age = 0;
}

export interface FLine { Speaker: number; Text: string }
export interface FTapeSound { At: number; Name: string; Volume: number; Pitch: number }
export interface FPlayingClip { Component: UAudioComponent; Bus: ECpvAudioBus; Level: number }

export class ACpvGameMode extends AActor {
  // ---------------------------------------------------------------------------------------------
  // For fighters
  // ---------------------------------------------------------------------------------------------
  GetArena(): ACpvArena { return this.Arena; }
  GetFx(): ACpvFx { return this.Fx; }
  // CpvGameEvents.ts
  declare OnStrike: (From: ACpvFighter | null, Victim: ACpvFighter, Damage: number, Reaction: ECpvReaction, Word: ECpvWord, Sound: string, At: FVector, bBlocked: boolean) => void;
  declare OnCleanBlock: (Who: ACpvFighter) => void;
  declare OnSlam: (At: FVector, Strength: number, bPlayImpact?: boolean) => void;
  declare OnKnockout: (Victim: ACpvFighter, By: ACpvFighter | null) => void;
  declare OnTaunt: (Who: ACpvFighter) => void;
  declare OnSpecial: (Who: ACpvFighter) => void;
  declare OnGrab: (Attacker: ACpvFighter, Victim: ACpvFighter) => void;
  declare OnRopeBounce: (Who: ACpvFighter) => void;
  declare OnHypeFull: (Who: ACpvFighter) => void;
  declare StrikeReferee: (From: ACpvFighter, Move: FCpvMove) => void;
  // CpvGameScenes.ts
  declare TryStartFinisher: (Attacker: ACpvFighter) => boolean;
  // CpvPinfall.ts
  declare CanCover: (Attacker: ACpvFighter) => boolean;
  declare TryCover: (Attacker: ACpvFighter) => boolean;
  bPins = true;
  PinSlot = -1;
  PinCount = 0;
  PinClock = 0;
  bPinMiss = false;
  bWonByPin = false;
  declare EscapeStart: () => number;
  declare EscapeEnd: () => number;
  declare EscapeNeedle: () => number;
  // CpvGameEvents.ts
  declare PlaySound: (Name: string, Volume?: number, Pitch?: number) => void;
  Shake(Amount: number): void { this.ShakeLevel = Math.max(this.ShakeLevel, Amount); }

  // weapons and projectiles (CpvGameEvents.ts)
  declare WeaponNear: (Who: ACpvFighter, Range: number) => boolean;
  /** Returns where the nearest loose weapon lies, or null if there is none (C++: bool + out parameter). */
  declare NearestWeapon: (From: FVector2D) => FVector | null;
  declare TryPickup: (Who: ACpvFighter) => boolean;
  declare DropWeaponAt: (Type: ECpvWeapon, Uses: number, At: FVector, Fling: FVector2D) => void;
  declare BreakWeapon: (Type: ECpvWeapon, At: FVector) => void;
  declare ThrowWeapon: (From: ACpvFighter, Type: ECpvWeapon, Uses: number) => void;
  declare SpawnProjectile: (Owner: ACpvFighter, Kind: number, From: FVector, Target: FVector) => void;

  // ---------------------------------------------------------------------------------------------
  // For the HUD
  // ---------------------------------------------------------------------------------------------
  Phase = ECpvPhase.Title;
  PhaseTime = 0;
  Mode = ECpvMode.OnePlayer;
  /** Empty until the first SpawnFighters; the C++ null checks become `if (!this.Fighters[0])`. */
  Fighters: ACpvFighter[] = [];
  Wins: number[] = [0, 0];
  Round = 1;
  RoundClock = 99;
  Winner = -1;
  bPaused = false;
  PauseIndex = 0;
  MenuIndex = 0;
  OptionIndex = 0;
  Cursor: number[] = [0, 1];
  bLocked: boolean[] = [false, false];
  ResultIndex = 0;
  bWatchingReplay = false;
  ReplayTime = 0;
  // CpvReplay.ts
  declare HasReplay: () => boolean;
  declare ReplayProgress: () => number;
  /** The taped frame to show now (a linear scene capture; draw it with GRenderer.DrawPicture). */
  declare ReplayPicture: () => Texture | null;
  Banner = new FCpvBanner();
  Subtitle = new FCpvSubtitle();
  NameCard = '';          // lower-third during entrances
  NameCardSub = '';
  NameCardAge = 0;
  FinisherPrompt = 0;     // > 0 while a Curtain Call is on offer
  FinisherFor = -1;
  MoveCallout: string[] = ['', ''];    // signature move name flash
  MoveCalloutLeft: number[] = [0, 0];
  Letterbox = 0;
  FadeOut = 0;            // 1 = black
  bShowHud = true;
  RealTime = 0;

  // options
  Difficulty = 1;         // 0..2
  RoundsToWin = 2;        // 1 or 2 (best of 1 / 3)
  RoundSeconds = 99;      // 0 = no limit
  AnimStyle = 0;          // 0 = stop-motion 12 fps, 1 = 15 fps, 2 = smooth
  OptionsPage = ECpvOptionsPage.General;
  bPauseOptions = false;
  BusVolume: number[] = [10, 10, 10, 10, 10];
  bVoiceDucking = true;
  bSubtitles = true;
  bPortugueseSubtitles = false;
  bShake = true;
  bArenaFlashes = true;
  Detail: number[] = [2, 2, 2, 2, 2, 2];
  RenderScale = 0;        // 0 keeps the automatic scale for large windows
  FeedRate = 1;
  FrameLimit = 3;
  bVSync = false;
  bPerformanceHud = false;
  MeasuredFPS = 0;
  // CpvOptions.ts
  declare OptionCount: () => number;
  declare OptionLabel: (Row: number) => string;
  declare OptionValue: (Row: number) => string;
  declare DetailMeter: () => number;
  declare MatchedPreset: () => number;
  SoundVolume = 8;        // 0..10, master level
  bFullscreen = false;    // remembered; see TickDisplay
  Episode = 0;
  Champions: number[] = [0, 0, 0];
  BestShow: number[][] = [new Array<number>(8).fill(0), new Array<number>(8).fill(0), new Array<number>(8).fill(0)];
  EpisodeStars: number[] = [0, 0, 0];
  bCrowdCall = false;
  // CpvRatingsRun.ts
  declare CrowdCall: () => string;
  SeasonStars(): number { return this.EpisodeStars[0] + this.EpisodeStars[1] + this.EpisodeStars[2]; }
  Lesson = 0;
  CueHold = 0;
  IsRehearsing(): boolean { return this.Mode === ECpvMode.Rehearsal && this.Phase === ECpvPhase.Fight; }
  IsRun(): boolean { return this.Mode === ECpvMode.RatingsRun; }
  RequiredWins(): number { return this.IsRun() ? 1 : this.RoundsToWin; }
  declare RivalForEpisode: (Stage: number) => number;
  declare EpisodeName: () => string;
  declare EpisodeRule: () => string;
  IsChampion(Star: number): boolean { return (this.Champions[this.Difficulty] & (1 << Star)) !== 0; }
  IsHuman(Slot: number): boolean {
    return this.Mode === ECpvMode.TwoPlayer || ((this.Mode === ECpvMode.OnePlayer || this.IsRun() || this.IsRehearsing()) && Slot === 0);
  }
  // CpvGameFlow.ts
  declare IsMirror: () => boolean;      // the same celebrity in both corners
  static TwinTint(): FLinearColor { return new FLinearColor(0.4, 0.8, 1); }
  IsDemo(): boolean {
    return this.Phase === ECpvPhase.Title || this.Phase === ECpvPhase.Menu || this.Phase === ECpvPhase.Options || this.Phase === ECpvPhase.HowTo
      || this.Phase === ECpvPhase.Credits;
  }

  // ---------------------------------------------------------------------------------------------
  // Flow (CpvGameFlow.ts unless noted)
  // ---------------------------------------------------------------------------------------------
  /** C++ BeginPlay. main.ts calls it once the HUD and world are wired up. */
  declare BeginGame: () => void;
  /** C++ Tick (AActor's own Tick below forwards to it). */
  declare TickGame: (DeltaTime: number) => void;
  override Tick(DeltaTime: number): void { this.TickGame(DeltaTime); }
  declare SetPhase: (NewPhase: ECpvPhase) => void;
  declare StartDemo: () => void;
  declare StartSelect: () => void;
  declare StartMatch: () => void;
  declare StartIntro: () => void;                    // CpvGameScenes.ts
  declare StartRound: () => void;
  declare EndRound: (RoundWinner: number) => void;
  declare EndMatch: (MatchWinner: number) => void;
  declare FulfillCrowdCall: () => void;              // CpvRatingsRun.ts
  declare ScoreEpisode: () => void;                  // CpvRatingsRun.ts
  declare TickFight: (Dt: number) => void;
  declare TickCover: (Dt: number) => void;           // CpvPinfall.ts
  declare SetEscapeBeat: () => void;                 // CpvPinfall.ts
  CpuEscapeTime = 0;
  declare StartRehearsal: () => void;                // CpvRehearsal.ts
  declare SetLesson: (Index: number) => void;        // CpvRehearsal.ts
  declare PassCue: () => void;                       // CpvRehearsal.ts
  declare TickRehearsal: (Dt: number, Menu: FCpvMenuInput) => void;   // CpvRehearsal.ts
  declare TrainerInput: (Dt: number) => FCpvInput;   // CpvRehearsal.ts
  TrainerClock = 0;
  declare TickMenus: (In: FCpvMenuInput) => void;
  declare TickSelect: (In: FCpvMenuInput[]) => void;
  declare ApplyOptions: () => void;
  // CpvOptions.ts
  declare TickOptions: (In: FCpvMenuInput) => void;
  declare ApplyPicture: () => void;
  declare ApplyRenderScale: () => void;
  declare LoadAVOptions: () => void;
  declare SaveAVOptions: () => void;
  /** Web only: lowers the picture preset by itself on a machine that cannot keep up (until the player sets one). */
  declare TickAutoTune: (RealDt: number) => void;
  bAutoTune = true;
  // CpvGameEvents.ts
  declare RefreshMix: () => void;
  declare RefreshBeds: () => void;
  declare TickBeds: (Dt: number) => void;
  VoicePreview: UAudioComponent | null = null;
  declare BusGain: (Bus: ECpvAudioBus) => number;
  declare PlayMixedClip: (Sound: USoundBase | null, Bus: ECpvAudioBus, Level: number, Pitch?: number) => UAudioComponent | null;
  PlayingClips: FPlayingClip[] = [];
  VoiceLevel = 1;
  MeterElapsed = 0;
  MeterFrames = 0;
  PreviousFrameTime = 0;
  declare SpawnFighters: (A: number, B: number) => void;
  declare TintTwin: () => void;            // in a mirror match the right-hand fighter gets a cool cast
  declare ShowBanner: (Text: string, Sub: string, Life: number, Colour: FLinearColor, Scale?: number) => void;
  declare ClearCallouts: () => void;       // drop any banner, subtitle or prompt left over from the previous scene
  // CpvGameScenes.ts
  declare BuildIntro: () => void;
  declare BuildFinisher: (Attacker: ACpvFighter, Victim: ACpvFighter) => void;
  declare BuildMatchEnd: () => void;
  // CpvReplay.ts
  declare StartReplay: () => void;
  declare TickReplay: (Dt: number, Menu: FCpvMenuInput) => void;
  TapeSounds: FTapeSound[] = [];
  NextTapeSound = 0;
  // CpvGameScenes.ts
  declare Tween: (Duration: number, Fn: (Alpha: number) => void) => void;
  declare TickTweens: (Dt: number) => void;
  declare HideProps: () => void;
  declare FinisherBoom: (Victim: ACpvFighter, Chunks: number, Size: number) => void;
  declare StepFighters: (Dt: number, bAllowInput: boolean) => void;
  declare SeparateFighters: () => void;
  declare DrawStageScreen: (Top: string, Main: string, Colour: FLinearColor) => void;   // CpvGameEvents.ts

  // ---------------------------------------------------------------------------------------------
  // Input (CpvGameFlow.ts; the pointer in CpvPointer.ts)
  // ---------------------------------------------------------------------------------------------
  declare ReadPlayer: (Slot: number) => FCpvInput;
  declare ReadMenu: (Slot: number) => FCpvMenuInput;
  /** Folds mouse and touch into the menu input for this frame. */
  declare ReadPointer: (Menu: FCpvMenuInput[]) => void;
  PointerPoint = FVector2D.ZeroVector;
  bHavePointer = false;
  bPointerClick = false;
  bPointerVisible = false;
  declare QueuePointer: (Normalized: FVector2D, bClick: boolean) => void;
  declare ClickViewport: (At: FVector2D) => void;
  declare ClosePointer: () => void;
  /** Scripted keys and clicks, and the end of a scripted run; true when it is time to stop. */
  declare TickDev: () => boolean;
  declare MashInput: (Dt: number, Me: ACpvFighter, Foe: ACpvFighter) => FCpvInput;
  MashClock = 0;
  MashBlock = 0;
  declare Down: (Player: number, Key: FKey) => boolean;
  declare Pressed: (Player: number, Key: FKey) => boolean;

  // camera (CpvGameFlow.ts)
  declare TickCamera: (Dt: number) => void;
  declare CutTo: (Pos: FVector, Aim: FVector, Fov: number) => void;
  declare MoveTo: (Pos: FVector, Aim: FVector, Fov: number, Speed?: number) => void;
  /** Fills Out with the broadcast camera's framing of the two fighters. */
  declare FightCamera: (Out: FCpvCamShot) => void;

  // supporting cast (CpvGameEvents.ts)
  declare TickReferee: (Dt: number) => void;
  declare TickCommentators: (Dt: number) => void;
  declare Say: (Event: string, Chance?: number, Name?: string) => void;
  declare LoadCommentary: () => void;
  declare CommentatorsReact: (Clip: string) => void;

  // hazards (CpvGameEvents.ts)
  declare TickWeapons: (Dt: number) => void;
  declare TickProjectiles: (Dt: number) => void;
  declare TossWeaponIn: (Type: ECpvWeapon) => void;
  declare BuildGallery: () => void;        // CpvGameFlow.ts
  declare PreloadContent: () => void;      // CpvGameFlow.ts

  // audio (CpvGameEvents.ts)
  declare FindSound: (Name: string) => USoundBase | null;
  /** Starts (or re-levels) a looping bed. Which is 'Music' or 'Crowd' (C++ passes the component by reference). */
  declare StartLoop: (Which: 'Music' | 'Crowd', Name: string, Level: number) => void;
  declare TickAudio: (Dt: number) => void;
  MasterGain(): number { return 0.2 * this.SoundVolume; }   // the default 8 gives 1.6: the raw mix is quiet
  declare LoadOptions: () => void;
  declare SaveOptions: () => void;
  // CpvGameFlow.ts
  declare TickDisplay: () => void;         // keeps the Display option in step with the browser's full-screen state
  declare IsFullscreenNow: () => boolean;
  declare CanSwitchDisplay: () => boolean;
  bDisplayApplied = false;
  DisplayWait = 0;

  Arena!: ACpvArena;
  Fx!: ACpvFx;
  Hud!: ACpvHUD;
  Camera!: ACameraActor;
  Referee!: ACpvPuppet;
  Commentators: ACpvPuppet[] = [];
  GalleryPuppets: ACpvPuppet[] = [];
  LooseHead: ACpvPuppet | null = null;     // the flying head for one particular Curtain Call
  Sounds = new Map<string, USoundBase | null>();
  MusicComp: UAudioComponent | null = null;
  CrowdComp: UAudioComponent | null = null;
  VoiceComp: UAudioComponent | null = null;
  PropPool: UStaticMeshComponent[] = [];

  Weapons: FMatWeapon[] = [];
  Projectiles: FProjectile[] = [];
  /** Borrows a prop component showing the given mesh (CpvGameEvents.ts). */
  declare TakeProp: (MeshPath: string) => UStaticMeshComponent | null;
  declare ReturnProp: (Comp: UStaticMeshComponent | null) => void;

  Lines = new Map<string, FLine[]>();
  AnnouncerCaptions = new Map<string, string>();
  PortugueseCaptions = new Map<string, string>();
  PendingSubtitle = new FCpvSubtitle();
  PendingVoice = '';
  declare StopVoice: () => void;
  SayCooldown = 0;
  MusicLevel = 0;         // level of the music loop before master volume and ducking
  DuckLeft = 0;           // while a voice line plays, music and crowd drop back
  Duck = 1;

  Brains: FCpvAI[] = [new FCpvAI(), new FCpvAI()];
  Seq = new FCpvSequence();
  Tweens: FCpvTween[] = [];
  Dev = new FCpvDevOptions();

  // camera state
  Cam = new FCpvCamShot();
  CamGoal = new FCpvCamShot();
  CamSpeed = 4;
  bCamScripted = false;
  ShakeLevel = 0;
  OrbitAngle = 0;

  // referee
  RefDown = 0;
  RefAct = '';
  RefActLeft = 0;
  RefGoal = new FVector2D(0, -160);

  SlowLeft = 0;
  WeaponClock = 14;
  HypeBase = 0.3;
  RoundEndClock = 0;
  bRoundOver = false;
  DemoRestart = 0;
  Age = 0;
  SelectStep = 0;
  bSkipIntro = false;
  ConfettiClock = 0;
  DevClock = 0;           // like Age, but keeps running while paused so scripted runs always finish
  PerfTime = 0;
  PerfWorst = 0;
  PerfFrames = 0;
}

// Re-exported so a file that implements part of the game mode can get the usual names from one place.
export { CpvRule, FParse };
