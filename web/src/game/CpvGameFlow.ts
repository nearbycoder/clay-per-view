// Port of CpvGame.cpp: match flow, player input and the camera director.

import { DirectionalLight } from 'three';

import { Assets } from '../engine/assets';
import { Audio } from '../engine/audio';
import { ToVector3 } from '../engine/convert';
import { EKeys, Input, type FKey } from '../engine/input';
import { Display, FApp, FParse, FPlatformMisc, FPlatformTime, GConfig, Log, LogVerbose, UGameplayStatics } from '../engine/platform';
import { FLinearColor, FMath, FRotator, FTransform, FVector, FVector2D } from '../engine/ue';
import { ACameraActor, AddToScene, IsValid } from '../engine/world';
import { CpvAnim } from './CpvAnims';
import { ACpvArena, ECpvLightMood } from './CpvArena';
import { CpvData } from './CpvData';
import { ACpvFighter } from './CpvFighter';
import { ACpvFx } from './CpvFx';
import { ACpvGameMode, ECpvMode, ECpvOptionsPage, ECpvPhase, FCpvCamShot, FCpvDevOptions, FCpvMenuInput, implement } from './CpvGame';
import { ACpvPuppet } from './CpvPuppet';
import { CpvRule, ECpvState, ECpvWeapon, FCpvInput } from './CpvTypes';

// ---------------------------------------------------------------------------------------------
// Dev options and sequences
// ---------------------------------------------------------------------------------------------

/** FCString::Atof: 0 for anything that is not a number. */
function Atof(Text: string): number {
  const N = parseFloat(Text);
  return Number.isFinite(N) ? N : 0;
}

/** FString::Split: the text either side of the first separator, or null if it is not there. */
function Split(Text: string, At: string): [string, string] | null {
  const i = Text.indexOf(At);
  return i < 0 ? null : [Text.slice(0, i), Text.slice(i + At.length)];
}

/** FString::ParseIntoArray on commas (empty parts are dropped). */
function ParseList(Text: string): string[] {
  return Text.split(',').filter((Part) => Part.length > 0);
}

// CpvKeys accepts a key by its code ("KeyD", "Space", "Gamepad_FaceButton_Left") or by Unreal's name for it
// ("D", "SpaceBar"), so a key list written for the desktop game works here unchanged.
const GKeyNames = EKeys as Record<string, FKey>;
const GKeyCodes = new Set<FKey>(Object.values(EKeys));

implement(FCpvDevOptions, {
  Parse() {
    // (CpvShots is not ported: on the web the test harness takes the screenshots.)
    this.QuitAt = FParse.Float('CpvQuit=', this.QuitAt);
    let Str = FParse.Value('CpvCam=');
    if (Str !== null) {
      const N = ParseList(Str);
      if (N.length >= 6) {
        this.bHaveCam = true;
        this.CamPos = new FVector(Atof(N[0]), Atof(N[1]), Atof(N[2]));
        this.CamAim = new FVector(Atof(N[3]), Atof(N[4]), Atof(N[5]));
        if (N.length >= 7) { this.CamFov = Atof(N[6]); }
      }
    }
    Str = FParse.Value('CpvGallery=');
    if (Str !== null) { this.Gallery = ParseList(Str); }
    this.GalleryChar = FParse.Value('CpvChar=') ?? this.GalleryChar;
    this.GalleryFrames = FParse.Int('CpvFrames=', this.GalleryFrames);
    // Unreal compares these strings without regard to case.
    this.Start = (FParse.Value('CpvStart=') ?? this.Start).toLowerCase();
    this.Pick[0] = FParse.Int('CpvP1=', this.Pick[0]);
    this.Pick[1] = FParse.Int('CpvP2=', this.Pick[1]);
    this.FoeHealth = FParse.Float('CpvFoeHealth=', this.FoeHealth);
    this.Hype = FParse.Float('CpvHype=', this.Hype);
    this.GiveWeapon = FParse.Int('CpvWeapon=', this.GiveWeapon);
    this.bHud = !FParse.Param('CpvNoHud');
    Str = FParse.Value('CpvPress=');
    if (Str !== null) {
      for (const Part of ParseList(Str)) {
        const Pair = Split(Part, '@');
        if (Pair) { this.Presses.push({ Time: Atof(Pair[1]), Button: Pair[0].toLowerCase(), bDone: false }); }
      }
    }
    Str = FParse.Value('CpvKeys=');
    if (Str !== null) {
      for (const Part of ParseList(Str)) {
        const Pair = Split(Part, '@');
        if (!Pair) { continue; }
        let Name = Pair[0];
        const When = Pair[1];
        const Tap = { Time: 0, Hold: 0.08, Key: '' as FKey, Pad: 0, Stage: 0 };
        const Times = Split(When, ':');
        let Down = When;
        if (Times) { Down = Times[0]; Tap.Hold = Atof(Times[1]); }
        Tap.Time = Atof(Down);
        if (Name.startsWith('p2.')) { Name = Name.slice(3); Tap.Pad = 1; }
        Tap.Key = GKeyNames[Name] ?? Name;
        if (GKeyCodes.has(Tap.Key)) { this.Keys.push(Tap); }
        else { console.warn(`CpvKeys: unknown key '${Name}'`); }
      }
    }
    Str = FParse.Value('CpvClicks=');
    if (Str !== null) {
      for (const Part of ParseList(Str)) {
        const Pair = Split(Part, '@');
        const Point = Pair ? Split(Pair[0], ':') : null;
        if (Pair && Point) {
          this.Clicks.push({ Time: Atof(Pair[1]), Point: new FVector2D(Atof(Point[0]), Atof(Point[1])), bDone: false });
        }
      }
    }
    // (Audio capture, the window / full-screen switches and the film capture are desktop tools.)
    this.bDummy = FParse.Param('CpvDummy');
    this.bMash = FParse.Param('CpvMash');
    this.bAutoQuit = FParse.Param('CpvAutoQuit');
    this.Difficulty = FParse.Int('CpvDifficulty=', this.Difficulty);
    const Step = FParse.Value('CpvStep=');
    if (Step !== null) { ACpvPuppet.StepRate = Atof(Step); }
  },

  Tick(Now) {
    return this.QuitAt > 0 && Now >= this.QuitAt;
  },
});

// FCpvSequence::Tick lives with the class in CpvGame.ts.

implement(ACpvGameMode, {
  TickDev() {
    // Scripted key events, sent the way real ones arrive: through the input layer, read on the next frame.
    for (const Tap of this.Dev.Keys) {
      const bPress = Tap.Stage === 0 && this.DevClock >= Tap.Time;
      const bRelease = Tap.Stage === 1 && this.DevClock >= Tap.Time + Tap.Hold;
      if (!bPress && !bRelease) { continue; }
      // A pretend second gamepad (Pad 1) is owned by the second local player.
      Input.InjectKey(Tap.Key, bPress, Tap.Pad);
      Log(`Key ${Tap.Key} ${bPress ? 'down' : 'up'} at ${this.DevClock.toFixed(2)} (injected)`);
      ++Tap.Stage;
    }
    for (const Click of this.Dev.Clicks) {
      if (!Click.bDone && this.DevClock >= Click.Time) { Click.bDone = true; this.ClickViewport(Click.Point); }
    }
    return this.Dev.Tick(this.DevClock);
  },

  // ---------------------------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------------------------

  BeginGame() {
    this.Dev.Parse();
    this.bShowHud = this.Dev.bHud;
    const World = this.GetWorld();

    this.Camera = World.SpawnActor(ACameraActor, this.Cam.Pos, FRotator.ZeroRotator);

    if (this.Dev.Gallery.length > 0) {
      this.BuildGallery();
      return;
    }

    this.PreloadContent();
    this.Arena = World.SpawnActor(ACpvArena);
    this.Arena.Build();
    this.Arena.bFeedEnabled = !FParse.Param('CpvNoFeed');
    this.Fx = World.SpawnActor(ACpvFx);
    this.Fx.Build(this.Arena.MatHalf, this.Arena.FloorZ);

    this.Referee = World.SpawnActor(ACpvPuppet, new FVector(0, -160, 0), new FRotator(0, 90, 0));
    this.Referee.SetCharacter('Ref');
    this.Referee.Play('RefIdle', 0);
    const Booth = ['Dirk', 'Nigel'];
    for (let i = 0; i < 2; ++i) {
      const Seat = i < this.Arena.AnnounceSeats.length ? this.Arena.AnnounceSeats[i] : new FTransform(new FRotator(0, 90, 0), new FVector(130 + 120 * i, -512, -48));
      this.Commentators[i] = World.SpawnActor(ACpvPuppet, Seat.GetLocation(), Seat.Rotator());
      this.Commentators[i].SetCharacter(Booth[i]);
      this.Commentators[i].Play('SitIdle', 0);
    }
    this.LoadCommentary();
    this.LoadOptions();
    for (let Level = 0; Level < this.Champions.length; ++Level) {
      this.Champions[Level] = GConfig.GetInt('ClayPerView.Champions', String(Level), this.Champions[Level]);
      for (let Star = 0; Star < this.BestShow[Level].length; ++Star) {
        this.BestShow[Level][Star] = FMath.Clamp(GConfig.GetInt('ClayPerView.Champions', `Best_${Level}_${Star}`, this.BestShow[Level][Star]), 0, 9);
      }
    }
    this.ApplyPicture();
    if (this.Dev.Difficulty >= 0) { this.Difficulty = FMath.Clamp(this.Dev.Difficulty, 0, 2); }
    // A page always opens in a window, whatever was saved last time (see TickDisplay).
    this.bFullscreen = this.IsFullscreenNow();
    this.ApplyOptions();
    this.StartLoop('Crowd', 'Crowd_Loop', 0.4);

    const Start = this.Dev.Start;
    if (Start === 'rehearsal') { this.StartRehearsal(); }
    else if (Start === 'fight' || Start === 'finisher' || Start === 'intro' || Start === 'watch') {
      this.Mode = Start === 'watch' || Start === 'finisher' ? ECpvMode.Watch : ECpvMode.OnePlayer;
      if (FParse.Param('CpvAI')) { this.Mode = ECpvMode.Watch; }
      if (FParse.Param('CpvTwo')) { this.Mode = ECpvMode.TwoPlayer; }
      this.Cursor[0] = FMath.Clamp(this.Dev.Pick[0], 0, CpvData.Roster().length - 1);
      this.Cursor[1] = FMath.Clamp(this.Dev.Pick[1] >= 0 ? this.Dev.Pick[1] : 1, 0, CpvData.Roster().length - 1);
      this.bSkipIntro = Start !== 'intro';
      if (Start === 'finisher') { this.RoundsToWin = 1; }
      this.StartMatch();
    }
    else if (Start === 'select') {
      this.StartSelect();
    }
    else {
      this.StartDemo();
      if (Start === 'menu') { this.SetPhase(ECpvPhase.Menu); }
      if (Start === 'howto') { this.SetPhase(ECpvPhase.HowTo); }
      if (Start === 'options') { this.SetPhase(ECpvPhase.Options); }
    }
  },

  CanSwitchDisplay() {
    return Display.CanSwitch();
  },

  IsFullscreenNow() {
    return Display.IsFullscreen();
  },

  TickDisplay() {
    // A browser only goes full screen in answer to a key press or click, so there is nothing to switch at
    // start-up here. This keeps the option in step with F11, Esc and the browser's own controls. A switch
    // takes the browser a moment (and may be refused), so only a settled difference is taken over.
    this.bDisplayApplied = true;
    const bNow = this.IsFullscreenNow();
    if (bNow === this.bFullscreen) {
      this.DisplayWait = 0;
      return;
    }
    this.DisplayWait += FMath.Min(FApp.GetDeltaTime(), 0.05);
    if (this.DisplayWait < 0.5 || this.RealTime <= 3) { return; }
    this.DisplayWait = 0;
    this.bFullscreen = bNow;
    this.SaveOptions();
  },

  PreloadContent() {
    // First use of a sound would otherwise be decoded in the middle of a punch. (Meshes, characters and
    // portraits are all loaded before the title screen; the voices are decoded as they are called for.)
    const Names = Object.keys(Assets.AudioIndex.clips);
    for (const Name of Names) { this.Sounds.set(Name, Audio.FindSound(Name)); }
    Audio.Preload(Names.filter((Name) => !Name.startsWith('VO_')));
    Log(`Preloaded ${this.Sounds.size} sounds`);
  },

  ApplyOptions() {
    ACpvPuppet.StepRate = this.AnimStyle === 0 ? 12 : (this.AnimStyle === 1 ? 15 : 0);
    this.Arena.SetBroadcastFlashes(this.bArenaFlashes);
    this.Brains[0].Level = this.Brains[1].Level = this.Difficulty;
    if (this.IsRun() && this.Episode === 0) { this.Brains[1].Level = FMath.Max(0, this.Difficulty - 1); }
  },

  SetPhase(NewPhase) {
    LogVerbose(() => `Phase ${this.Phase} -> ${NewPhase}`);
    this.Phase = NewPhase;
    this.PhaseTime = 0;
  },

  SpawnFighters(A, B) {
    const World = this.GetWorld();
    const Picks = [A, B];
    for (let i = 0; i < 2; ++i) {
      if (!this.Fighters[i]) { this.Fighters[i] = World.SpawnActor(ACpvFighter, new FVector(i === 0 ? -150 : 150, 0, 0), new FRotator(0, i === 0 ? 0 : 180, 0)); }
      this.Fighters[i].Setup(i, Picks[i], this);
    }
    this.Fighters[0].SetFoe(this.Fighters[1]);
    this.Fighters[1].SetFoe(this.Fighters[0]);
    this.Brains[0].Reset();
    this.Brains[1].Reset();
    this.TintTwin();
  },

  IsMirror() {
    return !!this.Fighters[0] && !!this.Fighters[1] && this.Fighters[0].RosterIndex === this.Fighters[1].RosterIndex;
  },

  TintTwin() {
    if (this.Fighters[0] && this.Fighters[1]) {
      this.Fighters[0].SetTint(FLinearColor.White);
      this.Fighters[1].SetTint(this.IsMirror() ? ACpvGameMode.TwinTint() : FLinearColor.White);
    }
  },

  ShowBanner(Text, Sub, Life, Colour, Scale = 1) {
    this.Banner.Text = Text;
    this.Banner.Sub = Sub;
    this.Banner.Life = Life;
    this.Banner.Age = 0;
    this.Banner.Colour = Colour;
    this.Banner.Scale = Scale;
  },

  ClearCallouts() {
    this.PinSlot = -1;
    this.bWonByPin = false;
    this.Banner.Life = 0;
    this.StopVoice();
    this.SayCooldown = 0;
    this.NameCard = '';
    this.MoveCalloutLeft[0] = this.MoveCalloutLeft[1] = 0;
    this.FinisherPrompt = 0;
    this.FinisherFor = -1;
    this.FadeOut = 0;
    if (this.SlowLeft > 0) {
      this.SlowLeft = 0;
      UGameplayStatics.SetGlobalTimeDilation(1);
    }
  },

  // ---------------------------------------------------------------------------------------------
  // Flow
  // ---------------------------------------------------------------------------------------------

  StartDemo() {
    this.Arena.DiscardTape();
    this.bWatchingReplay = false;
    // Behind the title and menus two computer-controlled stars slug it out.
    const Count = CpvData.Roster().length;
    const A = FMath.RandRange(0, Count - 1);
    const B = (A + FMath.RandRange(1, Count - 1)) % Count;
    this.SpawnFighters(A, B);
    this.Wins[0] = this.Wins[1] = 0;
    this.Round = 1;
    this.Winner = -1;
    this.bRoundOver = false;
    this.bCamScripted = false;
    this.Seq.bActive = false;
    this.HideProps();
    this.ClearCallouts();
    this.Letterbox = 0;
    this.Fx.Clear(false);
    for (let i = 0; i < 2; ++i) {
      this.Fighters[i].ResetForRound(new FVector(i === 0 ? -150 : 150, 0, 0), i === 0 ? 0 : 180);
      this.Fighters[i].bDazeOnKo = false;
    }
    this.Arena.SetMood(ECpvLightMood.Show, 1);
    if (this.Phase !== ECpvPhase.Menu && this.Phase !== ECpvPhase.Options && this.Phase !== ECpvPhase.HowTo && this.Phase !== ECpvPhase.Credits) { this.SetPhase(ECpvPhase.Title); }
    this.StartLoop('Music', 'Music_Menu', 0.5);
    this.DrawStageScreen('TONIGHT', 'CLAY-PER-VIEW', new FLinearColor(1, 0.8, 0.15));
  },

  StartSelect() {
    this.Episode = 0;
    this.EpisodeStars.fill(0);
    if (this.IsRun()) { this.Cursor[1] = this.RivalForEpisode(this.Episode); }
    this.SetPhase(ECpvPhase.Select);
    this.bLocked[0] = this.bLocked[1] = false;
    this.SelectStep = 0;
    this.Seq.bActive = false;
    this.bCamScripted = false;
    this.HideProps();
    this.ClearCallouts();
    this.Letterbox = 0;
    this.Fx.Clear(false);
    this.SpawnFighters(this.Cursor[0], this.Cursor[1]);
    for (let i = 0; i < 2; ++i) {
      this.Fighters[i].ResetForRound(new FVector(i === 0 ? -92 : 92, -150, 0), i === 0 ? 72 : 108);
      this.Fighters[i].SetScripted(true);
      this.Fighters[i].Play('Stand', 0);
    }
    this.Arena.SetMood(ECpvLightMood.House, 0.6);
    this.StartLoop('Music', 'Music_Menu', 0.5);
  },

  StartMatch() {
    this.Arena.StopTape();
    this.bWatchingReplay = false;
    this.bCrowdCall = false;
    this.SpawnFighters(this.Cursor[0], this.Cursor[1]);
    this.Wins[0] = this.Wins[1] = 0;
    this.Round = 1;
    this.Winner = -1;
    this.HideProps();
    this.ClearCallouts();
    this.Letterbox = 0;
    this.Seq.bActive = false;
    this.bCamScripted = false;
    this.Fx.Clear(false);
    this.ApplyOptions();
    this.StartLoop('Music', 'Music_Fight', 0.42);
    const A = this.Fighters[0].Def();
    const B = this.Fighters[1].Def();
    this.DrawStageScreen(`${A.Name}  vs`, B.Name, new FLinearColor(1, 0.3, 0.25));
    this.SetPhase(ECpvPhase.Versus);
    for (let i = 0; i < 2; ++i) {
      this.Fighters[i].ResetForRound(new FVector(i === 0 ? -150 : 150, 0, 0), i === 0 ? 0 : 180);
      this.Fighters[i].SetScripted(true);
      this.Fighters[i].Play('Idle', 0);
    }
    this.PlaySound('Swell');
    if (this.IsRun()) {
      const EpisodeVoices = ['VO_EpisodeOpen', 'VO_EpisodeProps', 'VO_EpisodePrime'];
      this.PlaySound(EpisodeVoices[this.Episode]);
    }
  },

  StartRound() {
    this.SetPhase(ECpvPhase.RoundIntro);
    this.PinSlot = -1;
    this.bWonByPin = false;
    // An entrance can be skipped half way: anything it left running (walks, camera moves, a fade) stops here.
    this.Tweens.length = 0;
    this.FadeOut = 0;
    this.bRoundOver = false;
    this.bCamScripted = false;
    this.Seq.bActive = false;
    this.RoundClock = this.IsRun() ? 60 : this.RoundSeconds;
    this.FinisherPrompt = 0;
    this.FinisherFor = -1;
    this.Letterbox = 0;
    this.NameCard = '';
    for (let i = 0; i < 2; ++i) {
      this.Fighters[i].ResetForRound(new FVector(i === 0 ? -150 : 150, 0, 0), i === 0 ? 0 : 180);
      // If losing this round would lose the bout, a knockout leaves them reeling for a Curtain Call.
      this.Fighters[i].bDazeOnKo = this.Wins[1 - i] >= this.RequiredWins() - 1;
      this.Fighters[i].SetScripted(true);
      this.Fighters[i].Play('Idle', 0);
      this.Brains[i].Reset();
    }
    // Clear loose weapons between rounds; the splats on the mat stay.
    for (const W of this.Weapons) { this.ReturnProp(W.Comp); }
    this.Weapons.length = 0;
    for (const P of this.Projectiles) { this.ReturnProp(P.Comp); }
    this.Projectiles.length = 0;
    this.WeaponClock = FMath.FRandRange(12, 18);
    this.Arena.SetMood(ECpvLightMood.Show, 0.8);
    this.RefAct = 'RefSignal';
    this.RefActLeft = 0;
    this.RefDown = 0;
    this.CutTo(new FVector(0, 900, 290), new FVector(0, 0, 85), 40);
    this.bCamScripted = false;
    this.ShowBanner(`TAKE ${this.Round}`, this.Fighters[0].bDazeOnKo || this.Fighters[1].bDazeOnKo ? 'CURTAIN CALL ON THE LINE' : '', 1.25, new FLinearColor(1, 0.82, 0.15));
    this.PlaySound(`VO_Take${FMath.Min(this.Round, 3)}`);
  },

  EndRound(RoundWinner) {
    if (RoundWinner >= 0) {
      ++this.Wins[RoundWinner];
      if (this.Wins[RoundWinner] >= this.RequiredWins()) {
        this.EndMatch(RoundWinner);
        return;
      }
    }
    this.SetPhase(ECpvPhase.RoundEnd);
    if (RoundWinner >= 0) {
      this.Fighters[RoundWinner].Celebrate();
      this.ShowBanner(this.Fighters[RoundWinner].Def().Name, `TAKES ROUND ${this.Round}`, 2.6, this.Fighters[RoundWinner].Def().Colour, 0.8);
      this.Say('roundwin', 1, this.Fighters[RoundWinner].Def().Name);
    }
    else {
      this.ShowBanner('DRAW!', 'NOBODY GETS PAID', 2.6, FLinearColor.White, 0.8);
    }
    this.PlaySound('Bell');
    this.Arena.CrowdPop(0.5);
    ++this.Round;
  },

  EndMatch(MatchWinner) {
    this.Winner = MatchWinner;
    this.Arena.StopTape();
    if (this.IsRun()) { this.ScoreEpisode(); }
    this.SetPhase(ECpvPhase.MatchEnd);
    const F0 = this.Fighters[0], F1 = this.Fighters[1];
    Log(`CPV_RESULT winner=${MatchWinner} rounds=${this.Wins[0]}-${this.Wins[1]} damage=${F0.DamageDealt.toFixed(0)}-${F1.DamageDealt.toFixed(0)}`
      + ` hits=${F0.HitsLanded}-${F1.HitsLanded} combo=${F0.BestCombo}-${F1.BestCombo} at=${this.Age.toFixed(0)}s level=${this.Difficulty}`);
    this.FinisherPrompt = 0;
    this.BuildMatchEnd();
  },

  StepFighters(Dt, bAllowInput) {
    if (!this.Fighters[0] || !this.Fighters[1]) { return; }
    const In = [new FCpvInput(), new FCpvInput()];
    for (let i = 0; i < 2; ++i) {
      if (!bAllowInput) { continue; }
      if (this.Dev.bMash && i === 0 && !this.IsDemo()) { In[i] = this.MashInput(Dt, this.Fighters[0], this.Fighters[1]); }
      else if (this.IsRehearsing() && i === 1) { In[i] = this.TrainerInput(Dt); }
      else if (this.IsHuman(i) && !this.IsDemo()) { In[i] = this.ReadPlayer(i); }
      else if (!this.Dev.bDummy) { In[i] = this.Brains[i].Think(Dt, this.Fighters[i], this.Fighters[1 - i], this); }
    }
    this.Fighters[0].Step(Dt, In[0]);
    this.Fighters[1].Step(Dt, In[1]);
    this.SeparateFighters();
  },

  MashInput(Dt, Me, Foe) {
    // A stand-in for somebody who has never played: walks at the opponent and hammers the buttons,
    // mostly jab, with no reading of what the other fighter is doing.
    const In = new FCpvInput();
    const To = Foe.Pos2D().Sub(Me.Pos2D());
    const Dist = To.Size();
    if (Dist > 105) { In.Move = To.Div(Dist); }
    this.MashClock -= Dt;
    this.MashBlock -= Dt;
    if (this.MashBlock > 0) { In.bBlock = true; return In; }
    if (this.MashClock > 0) { return In; }
    this.MashClock = FMath.FRandRange(0.16, 0.3);
    const State = Me.GetState();
    if (State === ECpvState.Down || State === ECpvState.Held) { In.bLight = true; return In; }
    if (Foe.GetState() === ECpvState.Dazed) { In.bSpecial = Dist < 170; return In; }
    if (Me.HasFullHype() && FMath.FRand() < 0.5) { In.bSpecial = true; return In; }
    if (Dist > 200) { return In; }
    const R = FMath.FRand();
    if (R < 0.56) { In.bLight = true; }
    else if (R < 0.74) { In.bHeavy = true; }
    else if (R < 0.84) { In.bGrab = true; }
    else if (R < 0.93) { this.MashBlock = 0.5; }
    else { In.bDodge = true; }
    return In;
  },

  SeparateFighters() {
    const A = this.Fighters[0];
    const B = this.Fighters[1];
    const Solid = (F: ACpvFighter): boolean => {
      switch (F.GetState()) {
        case ECpvState.Clinch: case ECpvState.Held: case ECpvState.Throwing: case ECpvState.Thrown: case ECpvState.Scripted:
        case ECpvState.Airborne: case ECpvState.Down: case ECpvState.Dead: case ECpvState.Dodge: case ECpvState.GetUp:
          return false;
        default: return F.Height < 1;
      }
    };
    if (!Solid(A) || !Solid(B)) { return; }
    let D = B.Pos2D().Sub(A.Pos2D());
    const Dist = D.Size();
    const Min = CpvRule.BodyRadius * 2;
    if (Dist >= Min) { return; }
    D = Dist > 0.5 ? D.Div(Dist) : new FVector2D(1, 0);
    const Push = (Min - Dist) * 0.5;
    const Limit = this.Arena.RingLimit();
    const Pa = A.Pos2D().Sub(D.Mul(Push));
    const Pb = B.Pos2D().Add(D.Mul(Push));
    A.SetActorLocation(new FVector(FMath.Clamp(Pa.X, -Limit, Limit), FMath.Clamp(Pa.Y, -Limit, Limit), 0));
    B.SetActorLocation(new FVector(FMath.Clamp(Pb.X, -Limit, Limit), FMath.Clamp(Pb.Y, -Limit, Limit), 0));
  },

  TickFight(Dt) {
    if (this.PinSlot >= 0) { this.TickCover(Dt); return; }
    this.StepFighters(Dt, true);
    if (this.PinSlot >= 0) { return; }

    if (!this.bRoundOver) {
      if ((this.IsRun() || this.RoundSeconds > 0) && this.FinisherPrompt <= 0) {
        this.RoundClock -= Dt;
        if (this.RoundClock <= 0) {
          this.RoundClock = 0;
          this.bRoundOver = true;
          this.RoundEndClock = 0.4;
          const A = this.Fighters[0].Health, B = this.Fighters[1].Health;
          this.Winner = FMath.IsNearlyEqual(A, B, 0.5) ? -1 : (A > B ? 0 : 1);
          this.ShowBanner('TIME!', '', 1.4, FLinearColor.White);
          this.PlaySound('Bell');
        }
      }
      for (let i = 0; i < 2 && !this.bRoundOver; ++i) {
        if (this.Fighters[i].GetState() === ECpvState.Dead) {
          this.bRoundOver = true;
          this.RoundEndClock = 1.5;
          this.Winner = 1 - i;
          this.RefAct = 'RefBell';
          this.RefActLeft = 0;
        }
      }
    }
    else {
      this.RoundEndClock -= Dt;
      if (this.RoundEndClock <= 0) {
        const W = this.Winner;
        this.Winner = -1;
        this.EndRound(W);
        return;
      }
    }

    // A helpless opponent: offer the Curtain Call.
    this.FinisherPrompt = 0;
    this.FinisherFor = -1;
    for (let i = 0; i < 2; ++i) {
      if (this.Fighters[i].GetState() === ECpvState.Dazed) {
        this.FinisherPrompt = FMath.Max(0.01, CpvRule.DazedTime - this.Fighters[i].GetStateTime());
        this.FinisherFor = 1 - i;
      }
    }

    // The crowd lobs something useful in every so often.
    this.WeaponClock -= Dt;
    if (this.WeaponClock <= 0 && !this.bRoundOver) {
      this.WeaponClock = FMath.FRandRange(15, 24);
      const bArmed = this.Fighters[0].Weapon !== ECpvWeapon.None || this.Fighters[1].Weapon !== ECpvWeapon.None;
      if (this.Weapons.length < 2 && !bArmed) { this.TossWeaponIn(FMath.RandRange(1, ECpvWeapon.Count - 1) as ECpvWeapon); }
    }
    // Crowd energy follows how the bout is going.
    const Low = 1 - FMath.Min(this.Fighters[0].Health, this.Fighters[1].Health) / CpvRule.MaxHealth;
    const Meter = FMath.Max(this.Fighters[0].Hype, this.Fighters[1].Hype) / CpvRule.MaxHype;
    this.Arena.SetHype(0.3 + 0.25 * Low + 0.2 * Meter + (this.FinisherPrompt > 0 ? 0.25 : 0));
  },

  TickGame(DeltaTime) {
    const Now = FPlatformTime.Seconds();
    const FrameSeconds = this.PreviousFrameTime > 0 ? Now - this.PreviousFrameTime : 0;
    this.PreviousFrameTime = Now;
    if (FrameSeconds > 0) {
      this.MeterElapsed += FrameSeconds;
      ++this.MeterFrames;
      if (this.MeterElapsed >= 0.5) {
        this.MeasuredFPS = this.MeterFrames / this.MeterElapsed;
        this.MeterElapsed = 0;
        this.MeterFrames = 0;
      }
    }

    const RealDt = FMath.Min(FApp.GetDeltaTime(), 0.1);
    this.RealTime += RealDt;
    this.Age += DeltaTime;
    this.TickDisplay();
    this.DevClock += this.bPaused ? RealDt : DeltaTime;
    if (this.Dev.Gallery.length > 0) {
      if (this.Dev.Tick(this.Age)) { FPlatformMisc.RequestExit(false); }
      return;
    }

    const Menu = [this.ReadMenu(0), this.ReadMenu(1)];
    this.ReadPointer(Menu);
    const Any = Menu[0].Clone();
    Any.bUp = Any.bUp || Menu[1].bUp; Any.bDown = Any.bDown || Menu[1].bDown; Any.bLeft = Any.bLeft || Menu[1].bLeft; Any.bRight = Any.bRight || Menu[1].bRight;
    Any.bOk = Any.bOk || Menu[1].bOk; Any.bBack = Any.bBack || Menu[1].bBack; Any.bPause = Any.bPause || Menu[1].bPause;

    // --- pause ---
    const bCanPause = this.Phase === ECpvPhase.Fight || this.Phase === ECpvPhase.RoundIntro || this.Phase === ECpvPhase.RoundEnd || this.Phase === ECpvPhase.Intro;
    if (this.bPaused) {
      this.TickBeds(RealDt);
      if (this.bPauseOptions) {
        this.TickOptions(Any);
        if (this.TickDev()) { FPlatformMisc.RequestExit(false); }
        return;
      }
      if (Any.bUp) { this.PauseIndex = (this.PauseIndex + 4) % 5; this.PlaySound('Tick'); }
      if (Any.bDown) { this.PauseIndex = (this.PauseIndex + 1) % 5; this.PlaySound('Tick'); }
      if (Any.bPause || Any.bBack || (Any.bOk && this.PauseIndex === 0)) { this.bPaused = false; }
      else if (Any.bOk && this.PauseIndex >= 3) {
        this.bPauseOptions = true;
        this.OptionsPage = this.PauseIndex === 3 ? ECpvOptionsPage.Sound : ECpvOptionsPage.Picture;
        this.OptionIndex = 0;
        this.PlaySound('Select');
      }
      else if (Any.bOk) {
        this.bPaused = false;
        this.PlaySound('Select');
        if (this.PauseIndex === 1 && this.IsRehearsing()) { this.StartRehearsal(); }
        else if (this.PauseIndex === 1) { this.StartMatch(); this.bSkipIntro = true; }
        else { this.StartDemo(); this.SetPhase(ECpvPhase.Menu); }
      }
      if (!this.bPaused && IsValid(this.VoiceComp)) { this.VoiceComp.SetPaused(false); }
      UGameplayStatics.SetGlobalTimeDilation(this.bPaused ? 0.0001 : 1);
      if (this.TickDev()) { FPlatformMisc.RequestExit(false); }
      return;
    }
    if (bCanPause && Any.bPause) {
      this.bPaused = true;
      if (IsValid(this.VoiceComp)) { this.VoiceComp.SetPaused(true); }
      this.PauseIndex = 0;
      UGameplayStatics.SetGlobalTimeDilation(0.0001);
      return;
    }

    // --- slow motion on knockouts ---
    if (this.SlowLeft > 0) {
      this.SlowLeft -= RealDt;
      UGameplayStatics.SetGlobalTimeDilation(this.SlowLeft > 0 ? 0.3 : 1);
    }

    this.PhaseTime += DeltaTime;
    this.Seq.Tick(DeltaTime);
    this.TickTweens(DeltaTime);

    switch (this.Phase) {
      case ECpvPhase.Title:
      case ECpvPhase.Menu:
      case ECpvPhase.Options:
      case ECpvPhase.Credits:
      case ECpvPhase.HowTo:
        // The demo bout loops forever behind the menus.
        this.StepFighters(DeltaTime, true);
        this.Arena.SetHype(0.35);
        if (this.Fighters[0].GetState() === ECpvState.Dead || this.Fighters[1].GetState() === ECpvState.Dead) {
          this.DemoRestart += DeltaTime;
          const W = this.Fighters[0].GetState() === ECpvState.Dead ? 1 : 0;
          if (this.Fighters[W].GetState() !== ECpvState.Win && this.DemoRestart > 0.8) { this.Fighters[W].Celebrate(); }
          if (this.DemoRestart > 4) { this.DemoRestart = 0; this.StartDemo(); }
        }
        else { this.DemoRestart = 0; }
        this.TickMenus(Any);
        break;
      case ECpvPhase.Select:
        this.TickSelect(Menu);
        break;
      case ECpvPhase.Versus:
        if ((this.PhaseTime > 2.6 && this.DuckLeft <= 0) || (this.PhaseTime > 0.5 && Any.bOk)) {
          if (this.bSkipIntro) { this.StartRound(); }
          else { this.StartIntro(); }
        }
        break;
      case ECpvPhase.Intro:
        if ((this.PhaseTime > 0.6 && Any.bOk) || this.Seq.IsDone()) {
          this.Seq.bActive = false;
          this.StartRound();
        }
        break;
      case ECpvPhase.RoundIntro:
        this.StepFighters(DeltaTime, false);
        if (this.PhaseTime >= 1.3 && this.PhaseTime - DeltaTime < 1.3) {
          this.ShowBanner('LIGHTS! CAMERA!', '', 0.85, FLinearColor.White, 0.8);
          this.PlaySound('VO_LightsCamera');
        }
        if (this.PhaseTime >= 2.2) {
          this.ShowBanner('CLOBBER!', '', 1, new FLinearColor(1, 0.25, 0.15), 1.25);
          this.PlaySound('Bell');
          this.Arena.CrowdPop(0.5);
          for (let i = 0; i < 2; ++i) { this.Fighters[i].SetScripted(false); }
          this.SetPhase(ECpvPhase.Fight);
          this.TapeSounds.length = 0;
          this.Arena.StartTape();
          if (this.IsRun()) { Log(`CPV_EPISODE live=${this.Episode + 1} lead=${this.Cursor[0]} rival=${this.Cursor[1]}`); }
          if (this.Round === 1 && !this.IsRun()) { this.Say('start', 1); }
          if (this.IsRun() && this.Episode === 1) {
            this.Fighters[0].GiveWeapon(ECpvWeapon.Slate, CpvData.Weapon(ECpvWeapon.Slate).Uses);
            this.Fighters[1].GiveWeapon(ECpvWeapon.Guitar, 2);
          }
          if (this.IsRun() && this.Episode === 2) {
            for (const Star of this.Fighters) { Star.AddHype(CpvRule.MaxHype); }
          }
          if (this.Dev.FoeHealth >= 0) { this.Fighters[1].Health = this.Dev.FoeHealth; }
          if (this.Dev.Hype >= 0) { this.Fighters[0].Hype = this.Dev.Hype; this.Fighters[1].Hype = this.Dev.Hype; }
          if (this.Dev.GiveWeapon > 0) { this.Fighters[0].GiveWeapon(FMath.Clamp(this.Dev.GiveWeapon, 1, ECpvWeapon.Count - 1) as ECpvWeapon, 3); }
          if (this.Dev.Start === 'finisher') {
            // Test hook: go straight to the first fighter's Curtain Call.
            this.Fighters[1].Health = 0;
            this.Fighters[1].EnterState(ECpvState.Dazed);
            this.Fighters[1].Play('Dazed', 0);
            this.BuildFinisher(this.Fighters[0], this.Fighters[1]);
          }
        }
        break;
      case ECpvPhase.Fight:
        if (this.IsRehearsing()) { this.TickRehearsal(DeltaTime, Any); }
        else { this.TickFight(DeltaTime); }
        break;
      case ECpvPhase.RoundEnd:
        this.StepFighters(DeltaTime, false);
        if (this.PhaseTime > 3.2) { this.StartRound(); }
        break;
      case ECpvPhase.Finisher:
        this.StepFighters(DeltaTime, false);
        if (this.Seq.IsDone() && this.PhaseTime > 1) {
          if (this.Winner >= 0) { ++this.Wins[this.Winner]; }   // the Curtain Call counts as taking the deciding round
          this.EndMatch(this.Winner);
        }
        break;
      case ECpvPhase.MatchEnd:
        this.StepFighters(DeltaTime, false);
        this.ConfettiClock -= DeltaTime;
        if (this.ConfettiClock <= 0) {
          this.ConfettiClock = 0.5;
          this.Fx.Confetti(26);
        }
        if (this.PhaseTime > 7 || (this.PhaseTime > 2.5 && Any.bOk)) {
          this.SetPhase(ECpvPhase.Results);
          this.Banner.Life = 0;
          this.Subtitle.Left = 0;
          this.ResultIndex = 0;
        }
        break;
      case ECpvPhase.Results: {
        if (this.bWatchingReplay) { this.TickReplay(RealDt, Any); break; }
        const Choices = this.HasReplay() ? 4 : 3;
        this.StepFighters(DeltaTime, false);
        if (this.Dev.bAutoQuit && this.PhaseTime > 1) { FPlatformMisc.RequestExit(false); }
        if (Any.bUp) { this.ResultIndex = (this.ResultIndex + Choices - 1) % Choices; this.PlaySound('Tick'); }
        if (Any.bDown) { this.ResultIndex = (this.ResultIndex + 1) % Choices; this.PlaySound('Tick'); }
        if (Any.bOk && this.PhaseTime > 0.4) {
          this.PlaySound('Select');
          if (this.ResultIndex === 0 && this.IsRun() && this.Winner === 0) {
            if (this.Episode < 2) { ++this.Episode; this.Cursor[1] = this.RivalForEpisode(this.Episode); this.bSkipIntro = false; this.StartMatch(); }
            else { this.Episode = 0; this.EpisodeStars.fill(0); this.Cursor[1] = this.RivalForEpisode(this.Episode); this.bSkipIntro = false; this.StartMatch(); }
          }
          else if (this.ResultIndex === 0) { this.bSkipIntro = true; this.StartMatch(); }
          else if (this.ResultIndex === 1) { this.bSkipIntro = false; this.StartSelect(); }
          else if (this.ResultIndex === 2 && this.HasReplay()) { this.StartReplay(); }
          else { this.StartDemo(); this.SetPhase(ECpvPhase.Menu); }
        }
        break;
      }
    }

    // --- shared upkeep ---
    if (this.Banner.Life > 0) {
      this.Banner.Age += RealDt;
      if (this.Banner.Age >= this.Banner.Life) { this.Banner.Life = 0; }
    }
    this.Subtitle.Left = FMath.Max(0, this.Subtitle.Left - RealDt);
    this.SayCooldown = FMath.Max(0, this.SayCooldown - RealDt);
    this.NameCardAge += DeltaTime;
    for (let i = 0; i < 2; ++i) { this.MoveCalloutLeft[i] = FMath.Max(0, this.MoveCalloutLeft[i] - DeltaTime); }
    this.TickReferee(DeltaTime);
    this.TickCommentators(DeltaTime);
    this.TickWeapons(DeltaTime);
    this.TickProjectiles(DeltaTime);
    this.TickCamera(RealDt);
    this.TickAudio(RealDt);
    // Frame-rate report for tuning (CPV_PERF lines in the log every five seconds).
    if (this.PerfFrames === 0 && this.RenderScale === 0) { this.ApplyRenderScale(); }
    this.PerfTime += FrameSeconds;
    ++this.PerfFrames;
    this.PerfWorst = FMath.Max(this.PerfWorst, FrameSeconds);
    if (this.PerfTime >= 5) {
      Log(`CPV_PERF ${(this.PerfFrames / this.PerfTime).toFixed(1)} fps average, worst frame ${(this.PerfWorst * 1000).toFixed(1)} ms`);
      this.PerfTime = 0;
      this.PerfFrames = 0;
      this.PerfWorst = 0;
    }
    if (!this.Dev.bHaveCam && this.Dev.QuitAt < 0) { this.TickAutoTune(RealDt); }
    if (this.TickDev()) { FPlatformMisc.RequestExit(false); }
  },

  // ---------------------------------------------------------------------------------------------
  // Menus and character select
  // ---------------------------------------------------------------------------------------------

  TickMenus(In) {
    if (this.Phase === ECpvPhase.Title) {
      if (In.bOk && this.PhaseTime > 0.5) {
        this.PlaySound('Select');
        this.SetPhase(ECpvPhase.Menu);
        this.MenuIndex = 0;
      }
      return;
    }
    if (this.Phase === ECpvPhase.Menu) {
      const Count = 8;
      if (In.bUp) { this.MenuIndex = (this.MenuIndex + Count - 1) % Count; this.PlaySound('Tick'); }
      if (In.bDown) { this.MenuIndex = (this.MenuIndex + 1) % Count; this.PlaySound('Tick'); }
      if (In.bBack) { this.SetPhase(ECpvPhase.Title); }
      if (In.bOk && this.PhaseTime > 0.15) {
        this.PlaySound('Select');
        switch (this.MenuIndex) {
          case 0: this.Mode = ECpvMode.RatingsRun; this.bSkipIntro = false; this.StartSelect(); break;
          case 1: this.Mode = ECpvMode.OnePlayer; this.bSkipIntro = false; this.StartSelect(); break;
          case 2: this.Mode = ECpvMode.TwoPlayer; this.bSkipIntro = false; this.StartSelect(); break;
          case 3: this.Mode = ECpvMode.Watch; this.bSkipIntro = false; this.StartSelect(); break;
          case 4: this.OptionsPage = ECpvOptionsPage.General; this.SetPhase(ECpvPhase.Options); this.OptionIndex = 0; break;
          case 5: this.SetPhase(ECpvPhase.HowTo); break;
          case 6: this.SetPhase(ECpvPhase.Credits); break;
          default: FPlatformMisc.RequestExit(false); break;
        }
      }
      return;
    }
    if (this.Phase === ECpvPhase.Credits) {
      if (this.PhaseTime > 0.2 && (In.bBack || In.bOk)) { this.PlaySound('Back'); this.SetPhase(ECpvPhase.Menu); }
      return;
    }
    if (this.Phase === ECpvPhase.HowTo) {
      if (this.PhaseTime > 0.2 && In.bBack) { this.PlaySound('Back'); this.SetPhase(ECpvPhase.Menu); }
      else if (this.PhaseTime > 0.2 && In.bOk) { this.StartRehearsal(); }
      return;
    }
    this.TickOptions(In);
  },

  TickSelect(In) {
    const Count = CpvData.Roster().length;
    const Cols = 4;
    // With one human, the same player picks both corners in turn; with two, each picks their own.
    const Step = this.SelectStep;   // fixed for this frame, so one press cannot lock both corners
    for (let Slot = 0; Slot < 2; ++Slot) {
      const bOwnPad = this.Mode === ECpvMode.TwoPlayer;
      if (!bOwnPad && Slot !== Step) { continue; }
      if (this.bLocked[Slot]) { continue; }
      const I = bOwnPad ? In[Slot] : In[0];
      let C = I.Pick >= 0 ? I.Pick : this.Cursor[Slot];
      if (I.bLeft) { C = Math.trunc(C / Cols) * Cols + (C % Cols + Cols - 1) % Cols; }
      if (I.bRight) { C = Math.trunc(C / Cols) * Cols + (C % Cols + 1) % Cols; }
      if (I.bUp || I.bDown) { C = (C + Cols) % Count; }
      if (C !== this.Cursor[Slot]) {
        this.Cursor[Slot] = C;
        if (this.IsRun()) {
          this.Cursor[1] = this.RivalForEpisode(this.Episode);
          this.Fighters[1].Setup(1, this.Cursor[1], this);
          this.Fighters[1].SetScripted(true);
          this.Fighters[1].Play('Stand', 0);
        }
        this.PlaySound('Tick');
        this.Fighters[Slot].Setup(Slot, C, this);
        this.Fighters[Slot].SetScripted(true);
        this.Fighters[Slot].Play('Stand', 0);
        this.TintTwin();
      }
      if (I.bOk && this.PhaseTime > 0.3) {
        this.bLocked[Slot] = true;
        if (this.IsRun()) { this.bLocked[1] = true; }
        this.PlaySound('Select');
        this.PlaySound(`VO_Name_${this.Fighters[Slot].Def().VoiceId}`);
        this.Fighters[Slot].Play(this.Fighters[Slot].Def().Taunt, 0.1);
        this.Arena.CrowdPop(0.3);
        if (!bOwnPad) {
          this.SelectStep = FMath.Min(this.SelectStep + 1, 2);
          // Start the second cursor on somebody else (a mirror match is still there for the choosing).
          if (Slot === 0 && this.Cursor[1] === this.Cursor[0]) {
            this.Cursor[1] = (this.Cursor[0] + 1) % Count;
            this.Fighters[1].Setup(1, this.Cursor[1], this);
            this.Fighters[1].SetScripted(true);
            this.Fighters[1].Play('Stand', 0);
            this.TintTwin();
          }
        }
        this.PhaseTime = 0.31;
      }
    }
    for (let Slot = 0; Slot < 2; ++Slot) {
      if (this.Fighters[Slot].IsClipDone() && this.Fighters[Slot].GetClip() !== 'Stand') { this.Fighters[Slot].Play('Stand', 0.2); }
    }
    const bBack = In[0].bBack || In[1].bBack;
    if (bBack) {
      this.PlaySound('Back');
      if (this.bLocked[1] && this.Mode !== ECpvMode.TwoPlayer && !this.IsRun()) { this.bLocked[1] = false; this.SelectStep = 1; }
      else if (this.bLocked[0]) { this.bLocked[0] = false; this.bLocked[1] = false; this.SelectStep = 0; }
      else { this.StartDemo(); this.SetPhase(ECpvPhase.Menu); }
      return;
    }
    // Finish the second name over the selection pose before clearing its audio for the bout.
    if (this.bLocked[0] && this.bLocked[1] && this.PhaseTime > 1.3 && this.DuckLeft <= 0) { this.StartMatch(); }
  },

  // ---------------------------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------------------------

  Down(Player, Key) {
    const PC = UGameplayStatics.GetPlayerController(Player);
    return PC !== null && PC.IsInputKeyDown(Key);
  },

  Pressed(Player, Key) {
    const PC = UGameplayStatics.GetPlayerController(Player);
    return PC !== null && PC.WasInputKeyJustPressed(Key);
  },

  ReadPlayer(Slot) {
    const In = new FCpvInput();
    const bTwo = this.Mode === ECpvMode.TwoPlayer;
    const Axis = (bNeg: boolean, bPos: boolean) => (bPos ? 1 : 0) - (bNeg ? 1 : 0);
    let MoveX = 0, MoveY = 0;
    // Keyboard always arrives through player 0. Screen-right is +X; "up" on screen is away from the camera (-Y).
    if (Slot === 0) {
      MoveX += Axis(this.Down(0, EKeys.A), this.Down(0, EKeys.D));
      MoveY += Axis(this.Down(0, EKeys.W), this.Down(0, EKeys.S));
      In.bLight = In.bLight || this.Pressed(0, EKeys.F) || (!bTwo && this.Pressed(0, EKeys.J));
      In.bHeavy = In.bHeavy || this.Pressed(0, EKeys.G) || (!bTwo && this.Pressed(0, EKeys.K));
      In.bGrab = In.bGrab || this.Pressed(0, EKeys.H) || (!bTwo && this.Pressed(0, EKeys.L));
      In.bSpecial = In.bSpecial || this.Pressed(0, EKeys.T) || (!bTwo && this.Pressed(0, EKeys.U));
      In.bTaunt = In.bTaunt || this.Pressed(0, EKeys.Y) || (!bTwo && this.Pressed(0, EKeys.O));
      In.bBlock = In.bBlock || this.Down(0, EKeys.R) || (!bTwo && this.Down(0, EKeys.I));
      In.bDodge = In.bDodge || this.Pressed(0, EKeys.SpaceBar);
      In.bRun = In.bRun || this.Down(0, EKeys.LeftShift);
      if (!bTwo) {
        MoveX += Axis(this.Down(0, EKeys.Left), this.Down(0, EKeys.Right));
        MoveY += Axis(this.Down(0, EKeys.Up), this.Down(0, EKeys.Down));
      }
    }
    else {
      MoveX += Axis(this.Down(0, EKeys.Left), this.Down(0, EKeys.Right));
      MoveY += Axis(this.Down(0, EKeys.Up), this.Down(0, EKeys.Down));
      In.bLight = In.bLight || this.Pressed(0, EKeys.Comma) || this.Pressed(0, EKeys.NumPadOne);
      In.bHeavy = In.bHeavy || this.Pressed(0, EKeys.Period) || this.Pressed(0, EKeys.NumPadTwo);
      In.bGrab = In.bGrab || this.Pressed(0, EKeys.Slash) || this.Pressed(0, EKeys.NumPadThree);
      In.bSpecial = In.bSpecial || this.Pressed(0, EKeys.L) || this.Pressed(0, EKeys.NumPadFour);
      In.bTaunt = In.bTaunt || this.Pressed(0, EKeys.Semicolon) || this.Pressed(0, EKeys.NumPadSix);
      In.bBlock = In.bBlock || this.Down(0, EKeys.M) || this.Down(0, EKeys.NumPadFive);
      In.bDodge = In.bDodge || this.Pressed(0, EKeys.RightControl) || this.Pressed(0, EKeys.N) || this.Pressed(0, EKeys.NumPadZero);
      In.bRun = In.bRun || this.Down(0, EKeys.RightShift);
    }
    // Gamepads: pad 1 for player one, pad 2 for player two.
    const PC = UGameplayStatics.GetPlayerController(Slot);
    if (PC) {
      const X = PC.GetInputAnalogKeyState(EKeys.Gamepad_LeftX);
      const Y = PC.GetInputAnalogKeyState(EKeys.Gamepad_LeftY);
      if (FMath.Abs(X) > 0.25 || FMath.Abs(Y) > 0.25) { MoveX += X; MoveY += -Y; }
      MoveX += Axis(PC.IsInputKeyDown(EKeys.Gamepad_DPad_Left), PC.IsInputKeyDown(EKeys.Gamepad_DPad_Right));
      MoveY += Axis(PC.IsInputKeyDown(EKeys.Gamepad_DPad_Up), PC.IsInputKeyDown(EKeys.Gamepad_DPad_Down));
      In.bLight = In.bLight || PC.WasInputKeyJustPressed(EKeys.Gamepad_FaceButton_Left);
      In.bHeavy = In.bHeavy || PC.WasInputKeyJustPressed(EKeys.Gamepad_FaceButton_Top);
      In.bGrab = In.bGrab || PC.WasInputKeyJustPressed(EKeys.Gamepad_FaceButton_Right);
      In.bDodge = In.bDodge || PC.WasInputKeyJustPressed(EKeys.Gamepad_FaceButton_Bottom);
      In.bSpecial = In.bSpecial || PC.WasInputKeyJustPressed(EKeys.Gamepad_LeftShoulder);
      In.bTaunt = In.bTaunt || PC.WasInputKeyJustPressed(EKeys.Gamepad_Special_Left) || PC.WasInputKeyJustPressed(EKeys.Gamepad_RightThumbstick);
      In.bBlock = In.bBlock || PC.IsInputKeyDown(EKeys.Gamepad_RightShoulder);
      In.bRun = In.bRun || PC.IsInputKeyDown(EKeys.Gamepad_RightTrigger) || PC.GetInputAnalogKeyState(EKeys.Gamepad_RightTriggerAxis) > 0.4;
    }
    In.Move = new FVector2D(MoveX, MoveY);
    if (In.Move.SizeSquared() > 1) { In.Move = In.Move.GetSafeNormal(); }
    return In;
  },

  ReadMenu(Slot) {
    const In = new FCpvMenuInput();
    if (Slot === 0) {
      In.bUp = this.Pressed(0, EKeys.W) || this.Pressed(0, EKeys.Up);
      In.bDown = this.Pressed(0, EKeys.S) || this.Pressed(0, EKeys.Down);
      In.bLeft = this.Pressed(0, EKeys.A) || this.Pressed(0, EKeys.Left);
      In.bRight = this.Pressed(0, EKeys.D) || this.Pressed(0, EKeys.Right);
      In.bOk = this.Pressed(0, EKeys.Enter) || this.Pressed(0, EKeys.SpaceBar) || this.Pressed(0, EKeys.J) || this.Pressed(0, EKeys.F);
      In.bBack = this.Pressed(0, EKeys.BackSpace) || this.Pressed(0, EKeys.Escape);
      In.bPause = this.Pressed(0, EKeys.Escape) || this.Pressed(0, EKeys.P);
      if (this.Mode === ECpvMode.TwoPlayer && this.Phase === ECpvPhase.Select) {
        // On the select screen each keyboard half drives its own cursor.
        In.bUp = this.Pressed(0, EKeys.W); In.bDown = this.Pressed(0, EKeys.S); In.bLeft = this.Pressed(0, EKeys.A); In.bRight = this.Pressed(0, EKeys.D);
        In.bOk = this.Pressed(0, EKeys.F) || this.Pressed(0, EKeys.SpaceBar);
      }
    }
    else if (this.Mode === ECpvMode.TwoPlayer && this.Phase === ECpvPhase.Select) {
      In.bUp = this.Pressed(0, EKeys.Up); In.bDown = this.Pressed(0, EKeys.Down); In.bLeft = this.Pressed(0, EKeys.Left); In.bRight = this.Pressed(0, EKeys.Right);
      In.bOk = this.Pressed(0, EKeys.Comma) || this.Pressed(0, EKeys.Enter);
    }
    if (Slot === 0) {
      // Scripted presses for automated runs.
      for (const Press of this.Dev.Presses) {
        if (Press.bDone || this.DevClock < Press.Time) { continue; }
        Press.bDone = true;
        In.bOk = In.bOk || Press.Button === 'ok';
        In.bBack = In.bBack || Press.Button === 'back';
        In.bUp = In.bUp || Press.Button === 'up';
        In.bDown = In.bDown || Press.Button === 'down';
        In.bLeft = In.bLeft || Press.Button === 'left';
        In.bRight = In.bRight || Press.Button === 'right';
        In.bPause = In.bPause || Press.Button === 'pause';
      }
    }
    const PC = UGameplayStatics.GetPlayerController(Slot);
    if (PC) {
      In.bUp = In.bUp || PC.WasInputKeyJustPressed(EKeys.Gamepad_DPad_Up) || PC.WasInputKeyJustPressed(EKeys.Gamepad_LeftStick_Up);
      In.bDown = In.bDown || PC.WasInputKeyJustPressed(EKeys.Gamepad_DPad_Down) || PC.WasInputKeyJustPressed(EKeys.Gamepad_LeftStick_Down);
      In.bLeft = In.bLeft || PC.WasInputKeyJustPressed(EKeys.Gamepad_DPad_Left) || PC.WasInputKeyJustPressed(EKeys.Gamepad_LeftStick_Left);
      In.bRight = In.bRight || PC.WasInputKeyJustPressed(EKeys.Gamepad_DPad_Right) || PC.WasInputKeyJustPressed(EKeys.Gamepad_LeftStick_Right);
      In.bOk = In.bOk || PC.WasInputKeyJustPressed(EKeys.Gamepad_FaceButton_Bottom);
      In.bBack = In.bBack || PC.WasInputKeyJustPressed(EKeys.Gamepad_FaceButton_Right);
      In.bPause = In.bPause || PC.WasInputKeyJustPressed(EKeys.Gamepad_Special_Right);
    }
    return In;
  },

  // ---------------------------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------------------------

  CutTo(Pos, Aim, Fov) {
    this.Cam.Pos = this.CamGoal.Pos = Pos;
    this.Cam.Aim = this.CamGoal.Aim = Aim;
    this.Cam.Fov = this.CamGoal.Fov = Fov;
    this.bCamScripted = true;
  },

  MoveTo(Pos, Aim, Fov, Speed = 3) {
    this.CamGoal.Pos = Pos;
    this.CamGoal.Aim = Aim;
    this.CamGoal.Fov = Fov;
    this.CamSpeed = Speed;
    this.bCamScripted = true;
  },

  FightCamera(Out) {
    // A broadcast "hard camera" on the +Y side that slides and zooms to keep both fighters framed.
    const A = this.Fighters[0].GetActorLocation();
    const B = this.Fighters[1].GetActorLocation();
    const Mid = A.Add(B).Mul(0.5);
    const Spread = FMath.Abs(A.X - B.X) + FMath.Abs(A.Y - B.Y) * 0.6;
    const Lift = FMath.Max(this.Fighters[0].Height, this.Fighters[1].Height);
    Out.Aim = new FVector(Mid.X * 0.8, Mid.Y * 0.6, 112 + Lift * 0.35);
    const Dist = FMath.Clamp(600 + Spread * 0.8 + Lift * 0.5, 760, 1150);
    // Never closer than a few metres to whoever is nearest the camera-side ropes.
    const CamY = FMath.Max(Out.Aim.Y + Dist, FMath.Max(A.Y, B.Y) + 700);
    Out.Pos = new FVector(Out.Aim.X * 0.85, CamY, 170 + Dist * 0.2);
    Out.Fov = 38;
    if (this.PinSlot >= 0) {
      Out.Aim = Mid.Add(new FVector(0, 0, 48));
      Out.Pos = Out.Aim.Add(new FVector(55, 570, 342));
      Out.Fov = 39;
    }
  },

  TickCamera(Dt) {
    if (!this.Camera) { return; }
    const Want: FCpvCamShot = this.CamGoal.Clone();
    let Speed = this.CamSpeed;
    if (this.Dev.bHaveCam) {
      Want.Pos = this.Dev.CamPos; Want.Aim = this.Dev.CamAim; Want.Fov = this.Dev.CamFov;
      this.Cam = Want.Clone();
    }
    else if (!this.bCamScripted) {
      switch (this.Phase) {
        case ECpvPhase.Title:
        case ECpvPhase.Menu:
        case ECpvPhase.Options:
        case ECpvPhase.Credits:
        case ECpvPhase.HowTo: {
          // A slow crane shot drifting round the camera side of the arena.
          this.OrbitAngle += Dt * 5;
          const A = FMath.DegreesToRadians(90 + 55 * FMath.Sin(FMath.DegreesToRadians(this.OrbitAngle)));
          Want.Pos = new FVector(FMath.Cos(A) * 980, FMath.Sin(A) * 980, 300 + 60 * FMath.Sin(FMath.DegreesToRadians(this.OrbitAngle * 1.7)));
          Want.Aim = new FVector(0, 0, 70);
          Want.Fov = 44;
          Speed = 2;
          break;
        }
        case ECpvPhase.Select:
          // Inside the ropes, close on the two contenders.
          Want.Pos = new FVector(0, 250, 135);
          Want.Aim = new FVector(0, -150, 116);
          Want.Fov = 56;
          Speed = 3;
          break;
        case ECpvPhase.Versus:
          Want.Pos = new FVector(0, 1000, 300);
          Want.Aim = new FVector(0, 0, 80);
          Want.Fov = 40;
          Speed = 2;
          break;
        default:
          if (this.Fighters[0] && this.Fighters[1]) { this.FightCamera(Want); }
          Speed = 4.5;
          break;
      }
    }
    this.Cam.Pos = FMath.VInterpTo(this.Cam.Pos, Want.Pos, Dt, Speed);
    this.Cam.Aim = FMath.VInterpTo(this.Cam.Aim, Want.Aim, Dt, Speed * 1.3);
    this.Cam.Fov = FMath.FInterpTo(this.Cam.Fov, Want.Fov, Dt, Speed);

    this.ShakeLevel = FMath.Max(0, this.ShakeLevel - Dt * 38 - this.ShakeLevel * Dt * 6);
    const Amp = this.bShake ? FMath.Min(this.ShakeLevel, 26) : 0;
    const Jitter = new FVector(FMath.FRandRange(-1, 1) * Amp * 0.5, 0, FMath.FRandRange(-1, 1) * Amp);
    const Pos = this.Cam.Pos.Add(Jitter);
    this.Camera.SetActorLocationAndRotation(Pos, this.Cam.Aim.Add(Jitter.Mul(0.4)).Sub(Pos).Rotation());
    this.Camera.GetCameraComponent().SetFieldOfView(this.Cam.Fov);
    // Shallow focus on the action sells the miniature-set look.
    const PP = this.Camera.PostProcessSettings;
    PP.bOverride_DepthOfFieldFocalDistance = true;
    PP.DepthOfFieldFocalDistance = FVector.Dist(Pos, this.Cam.Aim);
    PP.bOverride_DepthOfFieldFstop = true;
    PP.DepthOfFieldFstop = 3.2;
    PP.bOverride_DepthOfFieldSensorWidth = true;
    PP.DepthOfFieldSensorWidth = 36;
    if (this.Arena) { this.Arena.SetFeedView(Pos, this.Camera.GetActorRotation(), this.Cam.Fov); }
    if (this.Fx) { this.Fx.SetCamera(Pos); }
  },

  // ---------------------------------------------------------------------------------------------
  // Animation gallery (dev)
  // ---------------------------------------------------------------------------------------------

  BuildGallery() {
    // Film strips: each row is one clip sampled at evenly spaced times, left to right.
    const World = this.GetWorld();
    const Frames = FMath.Max(this.Dev.GalleryFrames, 2);
    const ColW = 165, RowH = 240;
    const MidZ = -(this.Dev.Gallery.length - 1) * RowH * 0.5 + 92;
    const Fov = 18;
    const HalfW = Frames * ColW * 0.5 + 40;
    const HalfH = this.Dev.Gallery.length * RowH * 0.5 + 10;

    // The desktop game lights the strips with two directional lights of 34 and 14 lux under automatic
    // exposure. This renderer is always exposed for the show (EV100 8.6), so they are scaled up to suit.
    const LuxScale = 44;
    const Centre = new FVector(0, 0, MidZ);
    const Sun = (Rotation: FRotator, Lux: number, bShadows: boolean) => {
      const L = new DirectionalLight(0xffffff, Lux * LuxScale);
      ToVector3(Centre.Sub(Rotation.Vector().Mul(3000)), L.position);
      ToVector3(Centre, L.target.position);
      if (bShadows) {
        const Reach = Math.hypot(HalfW, HalfH) / 100 + 2;
        L.castShadow = true;
        L.shadow.mapSize.set(2048, 2048);
        L.shadow.camera.left = -Reach; L.shadow.camera.right = Reach;
        L.shadow.camera.top = Reach; L.shadow.camera.bottom = -Reach;
        L.shadow.camera.near = 1;
        L.shadow.camera.far = 30 + Reach * 2;
        L.shadow.bias = -0.0004;
        L.shadow.normalBias = 0.02;
      }
      AddToScene(L.target);
      AddToScene(L);
    };
    Sun(new FRotator(-38, -120, 0), 34, true);
    Sun(new FRotator(-15, 40, 0), 14, false);

    for (let Row = 0; Row < this.Dev.Gallery.length; ++Row) {
      const Clip = this.Dev.Gallery[Row];
      const Length = CpvAnim.Get(Clip).Length;
      for (let f = 0; f < Frames; ++f) {
        // Rows step back along the view direction so they stack up the screen.
        const Loc = new FVector((f - (Frames - 1) * 0.5) * ColW, 0, -Row * RowH);
        const Puppet = World.SpawnActor(ACpvPuppet, Loc, FRotator.ZeroRotator);
        Puppet.SetCharacter(this.Dev.GalleryChar);
        Puppet.Play(Clip, 0, 0);
        Puppet.SetClipTime(Length * f / (Frames - 1));
        this.GalleryPuppets.push(Puppet);
      }
    }
    const Dist = 1.25 * FMath.Max(HalfW, HalfH * 1.5) / FMath.Tan(FMath.DegreesToRadians(Fov * 0.5));
    const Dir = new FRotator(0, 68, 0).Vector();   // three-quarter view from the camera side
    this.Camera.SetActorLocationAndRotation(Centre.Add(Dir.Mul(Dist)), Dir.Neg().Rotation());
    this.Camera.GetCameraComponent().SetFieldOfView(Fov);
  },
});
