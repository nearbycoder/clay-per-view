// Sound through the Web Audio API, behind the three Unreal calls the game uses: find a sound, spawn it
// (one-shot) or create it (loops), and adjust the component afterwards. Mixing between the buses is done
// by the game itself, as in the C++ (it sets each component's volume multiplier).
//
// Clips live in two pack files (effects and music; voices). A clip is decoded the first time it is
// wanted; a voice line asked for before the voice pack has arrived is skipped rather than played late.

import { Assets } from './assets';

let Context: AudioContext | null = null;
let Master: GainNode | null = null;
const Decoded = new Map<string, Promise<AudioBuffer | null>>();
const Sounds = new Map<string, USoundBase | null>();
const Active = new Set<UAudioComponent>();

export class USoundBase {
  constructor(
    readonly Name: string,
    readonly Duration: number,
    readonly bLooping: boolean,
    private readonly Pack: number,
    private readonly Offset: number,
    private readonly Length: number,
  ) {}
  GetDuration(): number { return this.Duration; }
  IsVoice(): boolean { return this.Pack === 1; }

  /** The decoded samples, or null if the pack is not here in time (MaxWaitSeconds) or cannot be decoded. */
  Buffer(MaxWaitSeconds: number): Promise<AudioBuffer | null> {
    let Pending = Decoded.get(this.Name);
    if (!Pending) {
      const Ready = Assets.AudioPacks[this.Pack];
      const Wait = Ready
        ? Promise.resolve<ArrayBuffer | null>(Ready)
        : Promise.race<ArrayBuffer | null>([Assets.AudioPackReady[this.Pack], new Promise<null>((Done) => setTimeout(() => Done(null), MaxWaitSeconds * 1000))]);
      Pending = Wait.then((Pack) => {
        if (!Pack || !Context) {
          Decoded.delete(this.Name); // try again next time
          return null;
        }
        return Context.decodeAudioData(Pack.slice(this.Offset, this.Offset + this.Length));
      }).catch((Err) => {
        console.warn(`Could not decode ${this.Name}`, Err);
        return null;
      });
      Decoded.set(this.Name, Pending);
    }
    return Pending;
  }
}

/** A playing (or ready to play) sound. */
export class UAudioComponent {
  bDestroyed = false;
  private Source: AudioBufferSourceNode | null = null;
  private Gain: GainNode | null = null;
  private Volume = 1;
  private bWantPlay = false;
  private bPaused = false;
  private StartedAt = 0;   // context time the current source started
  private Offset = 0;      // position within the clip when it started
  private Token = 0;

  constructor(readonly Sound: USoundBase, private Level: number, private Pitch: number, private readonly bAutoDestroy: boolean) {}

  /** True from Play until the clip has finished or been stopped (including while it is still decoding). */
  IsPlaying(): boolean { return this.bWantPlay && !this.bPaused; }

  Play(StartTime = 0): void {
    this.StopSource();
    this.bWantPlay = true;
    this.bPaused = false;
    this.Offset = StartTime;
    Active.add(this);
    this.Begin();
  }

  Stop(): void {
    this.bWantPlay = false;
    this.StopSource();
    Active.delete(this);
    if (this.bAutoDestroy) { this.bDestroyed = true; }
  }

  /** Replaces the volume the component was spawned with (it does not multiply it), as in Unreal. */
  SetVolumeMultiplier(Volume: number): void {
    this.Level = 1;
    this.Volume = Volume;
    if (this.Gain && Context) { this.Gain.gain.setTargetAtTime(Math.max(0, Volume), Context.currentTime, 0.015); }
  }

  SetPaused(bPause: boolean): void {
    if (bPause === this.bPaused || !this.bWantPlay) { return; }
    this.bPaused = bPause;
    if (bPause) {
      if (Context && this.Source) { this.Offset += (Context.currentTime - this.StartedAt) * this.Pitch; }
      this.StopSource();
    } else {
      this.Begin();
    }
  }

  private Begin(): void {
    const Token = ++this.Token;
    // An effect is worth a short wait; a commentary line that would arrive late is not.
    void this.Sound.Buffer(this.Sound.IsVoice() ? 0.6 : 3).then((Buffer) => {
      if (Token !== this.Token || !this.bWantPlay || this.bPaused) { return; }
      if (!Buffer || !Context || !Master) {
        this.Finish(Token);
        return;
      }
      const Source = Context.createBufferSource();
      Source.buffer = Buffer;
      Source.playbackRate.value = this.Pitch;
      let From = this.Offset;
      if (this.Sound.bLooping) {
        // The file is the loop with a wrapped copy of its tail in front and its head behind (see
        // tools/build-assets.mjs), so the loop window can sit anywhere near the middle and stay seamless.
        const Pad = Assets.AudioIndex.loopPad;
        Source.loop = true;
        Source.loopStart = Pad * 0.5;
        Source.loopEnd = Pad * 0.5 + this.Sound.Duration;
        From = Pad + (this.Offset % this.Sound.Duration);
        if (From >= Source.loopEnd) { From -= this.Sound.Duration; }
      }
      const Gain = Context.createGain();
      Gain.gain.value = Math.max(0, this.Level * this.Volume);
      Source.connect(Gain).connect(Master);
      Source.onended = () => this.Finish(Token);
      Source.start(0, Math.max(0, From));
      this.Source = Source;
      this.Gain = Gain;
      this.StartedAt = Context.currentTime;
    });
  }

  private Finish(Token: number): void {
    if (Token !== this.Token) { return; }
    this.bWantPlay = false;
    this.Source = null;
    this.Gain = null;
    Active.delete(this);
    if (this.bAutoDestroy) { this.bDestroyed = true; }
  }

  private StopSource(): void {
    ++this.Token;
    if (this.Source) {
      this.Source.onended = null;
      try { this.Source.stop(); } catch { /* not started yet */ }
      this.Source.disconnect();
      this.Gain?.disconnect();
    }
    this.Source = null;
    this.Gain = null;
  }
}

export const Audio = {
  /** Creates the context. Browsers keep it silent until Resume() is called from a key press or click. */
  Init(): void {
    if (Context) { return; }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) { return; }
    Context = new Ctor({ latencyHint: 'interactive' });
    // The game's own master level already tops out above 1, so leave headroom and catch peaks.
    const Limiter = Context.createDynamicsCompressor();
    Limiter.threshold.value = -6;
    Limiter.knee.value = 6;
    Limiter.ratio.value = 12;
    Limiter.attack.value = 0.003;
    Limiter.release.value = 0.12;
    Master = Context.createGain();
    Master.gain.value = 0.7;
    Master.connect(Limiter).connect(Context.destination);
  },
  Resume(): void {
    if (Context && Context.state !== 'running') { void Context.resume(); }
  },
  IsRunning(): boolean { return Context !== null && Context.state === 'running'; },
  /** Name as the game uses it ("Punch", "VO_Take1"); null if there is no such clip. */
  FindSound(Name: string): USoundBase | null {
    if (Sounds.has(Name)) { return Sounds.get(Name) ?? null; }
    const Clip = Assets.AudioIndex?.clips[Name];
    const Sound = Clip ? new USoundBase(Name, Clip[3], Assets.AudioIndex.loops.includes(Name), Clip[0], Clip[1], Clip[2]) : null;
    Sounds.set(Name, Sound);
    return Sound;
  },
  /** Decodes the short effects ahead of time so the first punch is not late. */
  Preload(Names: string[]): void {
    for (const Name of Names) { void Audio.FindSound(Name)?.Buffer(10); }
  },
  /** Plays a one-shot now. Returns null when there is nothing to play. */
  SpawnSound2D(Sound: USoundBase | null, Volume = 1, Pitch = 1): UAudioComponent | null {
    if (!Sound || !Context) { return null; }
    const Comp = new UAudioComponent(Sound, Volume, Pitch, true);
    Comp.Play();
    return Comp;
  },
  /** Makes a component without starting it (music and crowd beds). */
  CreateSound2D(Sound: USoundBase | null, Volume = 1, Pitch = 1): UAudioComponent | null {
    return Sound && Context ? new UAudioComponent(Sound, Volume, Pitch, false) : null;
  },
  StopAll(): void {
    for (const Comp of [...Active]) { Comp.Stop(); }
  },
};
