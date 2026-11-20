// Port of CpvOptions.cpp: live picture and sound controls shared by the main menu and intermission.
//
// The pages and rows are the desktop game's. Where that sets Unreal's scalability levels and console
// variables, this sets the web renderer's own switches (GRenderer.Settings); the arena and the effects
// read those themselves. A browser decides vertical sync on its own, so that row is gone.

import { Display, FrameCap, GConfig, Log } from '../engine/platform';
import { GRenderer } from '../engine/render';
import { FMath } from '../engine/ue';
import { IsValid } from '../engine/world';
import { ACpvGameMode, ECpvAudioBus, ECpvOptionsPage, ECpvPhase, implement } from './CpvGame';

const Section = 'ClayPerView.Options';
const GeneralRows = ['Difficulty', 'Bout length', 'Round timer', 'Animation', 'Sound mixer', 'Picture quality', 'Impact camera shake', 'Arena flash bulbs', 'Exhibition pinfalls'];
const SoundRows = ['Master volume', 'Music', 'Voices', 'Effects', 'Crowd', 'Menu sounds', 'Lower mix during speech', 'Dialogue subtitles', 'Subtitle language'];
const BusKeys = ['MusicVolume', 'VoiceVolume', 'EffectsVolume', 'CrowdVolume', 'MenuVolume'];
const PictureRows = ['Preset', 'Render scale', 'Shadows', 'Lighting & reflections', 'Textures', 'Anti-aliasing', 'Effects', 'Post-processing', 'Arena screen feed', 'Frame limit', 'Display', 'In-match FPS meter'];
const DetailKeys = ['Shadows', 'Lighting', 'Textures', 'AntiAliasing', 'Effects', 'PostProcess'];
const Levels = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];
const Scales = [0, 60, 75, 85, 100, 125, 150];
const FeedRates = [4, 8, 12, 20];
const Caps = [30, 60, 90, 120, 144, 0];
const PresetScale = [1, 3, 4, 5];
const PresetFeed = [0, 1, 1, 3];
/** Multisample counts for the four anti-aliasing levels (the graphics card may offer fewer). */
const Samples = [0, 2, 4, 8];
/** Frame limit a first-time visitor gets: the display's own rate (an index into Caps). */
const DefaultFrameLimit = 5;

function Cycle(Value: number, Step: number, Count: number): number { return (Value + Step + Count) % Count; }
function Toggle(Enabled: boolean): string { return Enabled ? 'ON' : 'OFF'; }
function ReadIndex(Key: string, Value: number, Max: number): number {
  return FMath.Clamp(GConfig.GetInt(Section, Key, Value), 0, Max);
}

/** The render scale in use, in percent (Unreal: r.ScreenPercentage). */
function ScreenPercentage(): number {
  return GRenderer ? GRenderer.Settings.Scale * 100 : 100;
}

// The automatic step-down's bookkeeping (see TickAutoTune).
const Tune = { Clock: 0, Slow: 0, Before: 0, Trial: null as null | { Detail: number[]; RenderScale: number; FeedRate: number; Fps: number } };

implement(ACpvGameMode, {
  TickAutoTune(RealDt) {
    // The desktop game ships to known hardware; a web page does not. Until the player chooses a picture
    // setting, a machine that stays well under a smooth frame rate is moved down a preset. If that
    // does not help (a display or power mode that caps the rate), the step is taken back and tuning stops.
    if (!this.bAutoTune || !GRenderer || document.hidden || this.bPaused || this.RealTime < 5) { return; }
    Tune.Clock += RealDt;
    if (Tune.Clock < 1) { return; }
    Tune.Clock = 0;
    const Fps = this.MeasuredFPS;
    if (Fps <= 1) { return; }
    if (Tune.Trial) {
      // Give the new settings three seconds, then judge them.
      if (++Tune.Slow < 3) { return; }
      Tune.Slow = 0;
      if (Fps < Tune.Trial.Fps * 1.12) {
        this.Detail = Tune.Trial.Detail;
        this.RenderScale = Tune.Trial.RenderScale;
        this.FeedRate = Tune.Trial.FeedRate;
        this.bAutoTune = false;
        Log(`CPV_AUTOTUNE no gain (${Fps.toFixed(0)} fps), settings restored`);
        this.ApplyPicture();
        this.SaveOptions();
      } else {
        Log(`CPV_AUTOTUNE kept (${Tune.Trial.Fps.toFixed(0)} -> ${Fps.toFixed(0)} fps)`);
      }
      Tune.Trial = null;
      return;
    }
    Tune.Slow = Fps < 44 ? Tune.Slow + 1 : 0;
    if (Tune.Slow < 3) { return; }
    Tune.Slow = 0;
    const Tier = Math.max(...this.Detail);
    if (Tier <= 0 && this.RenderScale === PresetScale[0]) {
      this.bAutoTune = false;   // already on the lowest preset
      return;
    }
    Tune.Trial = { Detail: this.Detail.slice(), RenderScale: this.RenderScale, FeedRate: this.FeedRate, Fps };
    const Next = FMath.Max(0, FMath.Min(Tier, 2) - 1);
    this.Detail.fill(Next);
    this.RenderScale = PresetScale[Next];
    this.FeedRate = PresetFeed[Next];
    Log(`CPV_AUTOTUNE ${Fps.toFixed(0)} fps, trying ${Levels[Next]}`);
    this.ApplyPicture();
    this.SaveOptions();
  },

  OptionCount() {
    switch (this.OptionsPage) {
      case ECpvOptionsPage.Sound: return SoundRows.length;
      case ECpvOptionsPage.Picture: return PictureRows.length;
      default: return GeneralRows.length;
    }
  },

  OptionLabel(Row) {
    switch (this.OptionsPage) {
      case ECpvOptionsPage.Sound: return SoundRows[Row];
      case ECpvOptionsPage.Picture: return PictureRows[Row];
      default: return GeneralRows[Row];
    }
  },

  MatchedPreset() {
    const Tier = this.Detail[0];
    for (const Value of this.Detail) { if (Value !== Tier) { return -1; } }
    if (Tier === 2 && this.RenderScale === 0 && this.FeedRate === 1) { return 4; } // original adaptive resolution
    return this.RenderScale === PresetScale[Tier] && this.FeedRate === PresetFeed[Tier] ? Tier : -1;
  },

  DetailMeter() {
    // A relative measure of the selected detail settings, independent of the frame limiter.
    let Sum = 0;
    for (const Value of this.Detail) { Sum += Value / 3; }
    const Pixels = this.RenderScale ? Scales[this.RenderScale] : ScreenPercentage();
    return (Sum + FMath.Clamp((Pixels - 60) / 90, 0, 1) + this.FeedRate / 3) / 8;
  },

  OptionValue(Row) {
    if (this.OptionsPage === ECpvOptionsPage.General) {
      const Diff = ['UNDERSTUDY', 'HEADLINER', 'DIVA'];
      const Anim = ['CLAY / 12 FPS', 'CLAY / 15 FPS', 'SMOOTH'];
      switch (Row) {
        case 0: return Diff[this.Difficulty];
        case 1: return this.RoundsToWin === 1 ? 'ONE TAKE' : 'BEST OF THREE';
        case 2: return this.RoundSeconds ? `${this.RoundSeconds} SEC` : 'NO LIMIT';
        case 3: return Anim[this.AnimStyle];
        case 6: return Toggle(this.bShake);
        case 7: return Toggle(this.bArenaFlashes);
        case 8: return Toggle(this.bPins);
        default: return 'OPEN  >';
      }
    }
    if (this.OptionsPage === ECpvOptionsPage.Sound) {
      if (Row === 8) { return this.bPortugueseSubtitles ? 'PORTUGUÊS (BR)' : 'ENGLISH'; }
      if (Row >= 6) { return Toggle(Row === 6 ? this.bVoiceDucking : this.bSubtitles); }
      const Value = Row === 0 ? this.SoundVolume : this.BusVolume[Row - 1];
      return Value ? `${Value * 10}%` : 'MUTED';
    }
    if (Row >= 2 && Row <= 7) { return Levels[this.Detail[Row - 2]]; }
    switch (Row) {
      case 0: { const Tier = this.MatchedPreset(); return Tier < 0 ? 'CUSTOM' : Tier === 4 ? 'AUTO' : Levels[Tier]; }
      case 1: return this.RenderScale ? `${Scales[this.RenderScale]}%` : 'AUTO';
      case 8: return `${FeedRates[this.FeedRate]} FPS`;
      // A browser never draws faster than the display refreshes, so "no cap" means the display's rate.
      case 9: return Caps[this.FrameLimit] ? `${Caps[this.FrameLimit]} FPS` : 'DISPLAY RATE';
      case 10: return this.bFullscreen ? 'FULL SCREEN' : 'WINDOW';
      default: return Toggle(this.bPerformanceHud);
    }
  },

  ApplyRenderScale() {
    if (!GRenderer) { return; }
    const Settings = GRenderer.Settings;
    // Lines the picture has at 100% (the renderer already holds very large canvases to a sensible size).
    const ViewY = (GRenderer.Height * GRenderer.PixelRatio()) / FMath.Max(0.01, Settings.Scale);
    const AutoScale = FMath.Clamp(1200 / FMath.Max(1, ViewY), 0.6, 1) * 100;
    const Scale = this.RenderScale ? Scales[this.RenderScale] : AutoScale;
    if (!FMath.IsNearlyEqual(ScreenPercentage(), Scale, 0.1)) {
      Settings.Scale = Scale / 100;
      GRenderer.Apply();
    }
  },

  ApplyPicture() {
    if (GRenderer) {
      const Q = GRenderer.Settings;
      Q.Shadows = this.Detail[0];
      Q.Lighting = this.Detail[1];
      Q.Textures = this.Detail[2];
      Q.Antialias = Samples[this.Detail[3]];
      Q.Effects = this.Detail[4];
      Q.bPost = this.Detail[5] > 0;   // LOW leaves the camera effects (bloom, vignette, grain) out altogether
      Q.FeedHz = FeedRates[this.FeedRate];
      GRenderer.Apply();
    }
    this.ApplyRenderScale();
    if (this.Arena) { this.Arena.FeedInterval = 1 / FeedRates[this.FeedRate]; }
    FrameCap.Value = Caps[this.FrameLimit];
    Log(`CPV_PICTURE render=${ScreenPercentage().toFixed(0)} shadows=${this.Detail[0]} lighting=${this.Detail[1]} textures=${this.Detail[2]} AA=${this.Detail[3]}`
      + ` effects=${this.Detail[4]} post=${this.Detail[5]} feed=${FeedRates[this.FeedRate]} cap=${Caps[this.FrameLimit]}`);
  },

  TickOptions(In) {
    if (In.bBack) {
      if (IsValid(this.VoicePreview)) { this.VoicePreview.Stop(); }
      this.PlaySound('Back');
      this.SaveOptions();
      if (this.bPauseOptions) { this.bPauseOptions = false; }
      else if (this.OptionsPage === ECpvOptionsPage.General) { this.SetPhase(ECpvPhase.Menu); }
      else { this.OptionIndex = this.OptionsPage === ECpvOptionsPage.Sound ? 4 : 5; this.OptionsPage = ECpvOptionsPage.General; }
      return;
    }
    if (In.bUp || In.bDown) {
      this.OptionIndex = Cycle(this.OptionIndex, In.bUp ? -1 : 1, this.OptionCount());
      this.PlaySound('Tick');
    }
    const Step = In.bRight || In.bOk ? 1 : (In.bLeft ? -1 : 0);
    if (!Step) { return; }
    const Row = this.OptionIndex;
    if (this.OptionsPage === ECpvOptionsPage.General) {
      switch (Row) {
        case 0: this.Difficulty = Cycle(this.Difficulty, Step, 3); break;
        case 1: this.RoundsToWin = 3 - this.RoundsToWin; break;
        case 2: {
          const Times = [99, 60, 0];
          this.RoundSeconds = Times[Cycle(this.RoundSeconds === 99 ? 0 : this.RoundSeconds === 60 ? 1 : 2, Step, 3)];
          break;
        }
        case 3: this.AnimStyle = Cycle(this.AnimStyle, Step, 3); break;
        case 6: this.bShake = !this.bShake; break;
        case 7: this.bArenaFlashes = !this.bArenaFlashes; break;
        case 8: this.bPins = !this.bPins; break;
        default:
          this.OptionsPage = Row === 4 ? ECpvOptionsPage.Sound : ECpvOptionsPage.Picture;
          this.OptionIndex = 0;
          this.PlaySound('Select');
          return;
      }
      this.ApplyOptions();
    } else if (this.OptionsPage === ECpvOptionsPage.Sound) {
      if (Row < 6) {
        const Value = Row === 0 ? this.SoundVolume : this.BusVolume[Row - 1];
        const Next = In.bOk ? Cycle(Value, 1, 11) : FMath.Clamp(Value + Step, 0, 10);
        if (Row === 0) { this.SoundVolume = Next; } else { this.BusVolume[Row - 1] = Next; }
      }
      else if (Row === 6) { this.bVoiceDucking = !this.bVoiceDucking; }
      else if (Row === 7) { this.bSubtitles = !this.bSubtitles; }
      else { this.bPortugueseSubtitles = !this.bPortugueseSubtitles; }
      this.RefreshMix();
      if (Row === 2) {
        if (IsValid(this.VoicePreview)) { this.VoicePreview.Stop(); }
        this.VoicePreview = this.PlayMixedClip(this.FindSound('VO_Take1'), ECpvAudioBus.Voice, 1.25);
      }
      else if (Row === 3) { this.PlaySound('Punch'); }
      else if (Row === 4) { this.PlaySound('Cheer', 0.5); }
    } else {
      if (Row >= 2 && Row <= 7) { this.Detail[Row - 2] = Cycle(this.Detail[Row - 2], Step, 4); }
      else {
        switch (Row) {
          case 0: {
            const Current = this.MatchedPreset();
            const Preset = Cycle(Current < 0 ? this.Detail[0] : Current, Step, 5);
            const Tier = Preset === 4 ? 2 : Preset;
            this.Detail.fill(Tier);
            this.RenderScale = Preset === 4 ? 0 : PresetScale[Tier];
            this.FeedRate = PresetFeed[Tier];
            break;
          }
          case 1: this.RenderScale = Cycle(this.RenderScale, Step, Scales.length); break;
          case 8: this.FeedRate = Cycle(this.FeedRate, Step, FeedRates.length); break;
          case 9: this.FrameLimit = Cycle(this.FrameLimit, Step, Caps.length); break;
          case 10:
            if (this.CanSwitchDisplay()) {
              this.bFullscreen = !this.IsFullscreenNow();
              Display.Toggle();
              Log(`Display requested: ${this.bFullscreen ? 'fullscreen' : 'window'}`);
            }
            break;
          case 11: this.bPerformanceHud = !this.bPerformanceHud; break;
        }
      }
      this.bAutoTune = false;   // the player has chosen: no more automatic changes
      this.ApplyPicture();
    }
    this.PlaySound('Tick');
    this.SaveOptions();
  },

  LoadAVOptions() {
    const LegacyMusic = GConfig.GetBool(Section, 'Music', true);
    this.BusVolume[0] = LegacyMusic ? 10 : 0;
    for (let i = 0; i < BusKeys.length; ++i) { this.BusVolume[i] = ReadIndex(BusKeys[i], this.BusVolume[i], 10); }
    // A first visit starts on Auto; phones and tablets start one preset lower. Nobody starts with a frame
    // limit: the browser already paces frames to the display.
    const bFirstVisit = GConfig.GetInt(Section, DetailKeys[0], -1) < 0;
    if (bFirstVisit) {
      this.FrameLimit = DefaultFrameLimit;
      if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) {
        this.Detail.fill(1);
        this.RenderScale = PresetScale[1];
        this.FeedRate = PresetFeed[1];
      }
    }
    for (let i = 0; i < DetailKeys.length; ++i) { this.Detail[i] = ReadIndex(DetailKeys[i], this.Detail[i], 3); }
    this.RenderScale = ReadIndex('RenderScale', this.RenderScale, Scales.length - 1);
    this.FeedRate = ReadIndex('FeedRate', this.FeedRate, FeedRates.length - 1);
    this.FrameLimit = ReadIndex('FrameLimit', this.FrameLimit, Caps.length - 1);
    this.bPerformanceHud = GConfig.GetBool(Section, 'PerformanceHud', this.bPerformanceHud);
    this.bAutoTune = GConfig.GetBool(Section, 'AutoTune', this.bAutoTune);
    this.bVoiceDucking = GConfig.GetBool(Section, 'VoiceDucking', this.bVoiceDucking);
    this.bSubtitles = GConfig.GetBool(Section, 'Subtitles', this.bSubtitles);
    this.bPortugueseSubtitles = GConfig.GetBool(Section, 'PortugueseSubtitles', this.bPortugueseSubtitles);
    this.bShake = GConfig.GetBool(Section, 'Shake', this.bShake);
    this.bArenaFlashes = GConfig.GetBool(Section, 'ArenaFlashes', this.bArenaFlashes);
    this.bPins = GConfig.GetBool(Section, 'Pins', this.bPins);
  },

  SaveAVOptions() {
    for (let i = 0; i < BusKeys.length; ++i) { GConfig.SetInt(Section, BusKeys[i], this.BusVolume[i]); }
    for (let i = 0; i < DetailKeys.length; ++i) { GConfig.SetInt(Section, DetailKeys[i], this.Detail[i]); }
    GConfig.SetInt(Section, 'RenderScale', this.RenderScale);
    GConfig.SetInt(Section, 'FeedRate', this.FeedRate);
    GConfig.SetInt(Section, 'FrameLimit', this.FrameLimit);
    GConfig.SetBool(Section, 'PerformanceHud', this.bPerformanceHud);
    GConfig.SetBool(Section, 'AutoTune', this.bAutoTune);
    GConfig.SetBool(Section, 'VoiceDucking', this.bVoiceDucking);
    GConfig.SetBool(Section, 'Subtitles', this.bSubtitles);
    GConfig.SetBool(Section, 'PortugueseSubtitles', this.bPortugueseSubtitles);
    GConfig.SetBool(Section, 'Shake', this.bShake);
    GConfig.SetBool(Section, 'ArenaFlashes', this.bArenaFlashes);
    GConfig.SetBool(Section, 'Pins', this.bPins);
  },
});
