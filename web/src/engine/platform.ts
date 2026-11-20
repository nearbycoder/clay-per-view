// The odds and ends of Unreal's platform layer that the game calls: saved settings, launch options, the
// clock, time dilation, leaving the game, and full screen.

import { Audio, UAudioComponent, USoundBase } from './audio';
import { APlayerController, Input } from './input';
import { GWorld } from './world';

const Query = new URLSearchParams(location.search);

/**
 * Launch options. The desktop game reads them from its command line (-CpvStart=fight -CpvAI); here they
 * are the page's query string with the same names (?CpvStart=fight&CpvAI).
 */
export const FParse = {
  /** True if the switch is present (FParse::Param). */
  Param(Name: string): boolean {
    const V = Query.get(Name);
    return V !== null && V !== '0' && V !== 'false';
  },
  /** The text after "Name=" or null. Name is given with or without its trailing "=". */
  Value(Name: string): string | null {
    const V = Query.get(Name.replace(/=$/, ''));
    return V === null || V === '' ? null : V;
  },
  Float(Name: string, Default: number): number {
    const V = FParse.Value(Name);
    const N = V === null ? NaN : parseFloat(V);
    return Number.isFinite(N) ? N : Default;
  },
  Int(Name: string, Default: number): number {
    const V = FParse.Value(Name);
    const N = V === null ? NaN : parseInt(V, 10);
    return Number.isFinite(N) ? N : Default;
  },
};

const STORE_PREFIX = 'clay-per-view/';
let Memory: Record<string, string> | null = null; // stands in when the browser refuses storage

function StoreGet(Key: string): string | null {
  if (Memory) { return Memory[Key] ?? null; }
  try {
    return window.localStorage.getItem(STORE_PREFIX + Key);
  } catch {
    Memory = {};
    return null;
  }
}

function StoreSet(Key: string, Value: string): void {
  if (Memory) { Memory[Key] = Value; return; }
  try {
    window.localStorage.setItem(STORE_PREFIX + Key, Value);
  } catch {
    Memory = { [Key]: Value };
  }
}

/** Saved settings and records (the desktop game's GameUserSettings.ini), kept in the browser. */
export const GConfig = {
  /** Returns the saved value, or Default when there is none (C++: the variable is left untouched). */
  GetInt(Section: string, Key: string, Default: number): number {
    const V = StoreGet(`${Section}/${Key}`);
    const N = V === null ? NaN : parseInt(V, 10);
    return Number.isFinite(N) ? N : Default;
  },
  GetBool(Section: string, Key: string, Default: boolean): boolean {
    const V = StoreGet(`${Section}/${Key}`);
    return V === null ? Default : V === '1' || V === 'true';
  },
  GetString(Section: string, Key: string, Default: string): string {
    return StoreGet(`${Section}/${Key}`) ?? Default;
  },
  SetInt(Section: string, Key: string, Value: number): void { StoreSet(`${Section}/${Key}`, String(Math.trunc(Value))); },
  SetBool(Section: string, Key: string, Value: boolean): void { StoreSet(`${Section}/${Key}`, Value ? '1' : '0'); },
  SetString(Section: string, Key: string, Value: string): void { StoreSet(`${Section}/${Key}`, Value); },
  Flush(): void {},
};

export const FPlatformTime = {
  /** Wall-clock seconds. */
  Seconds(): number { return performance.now() / 1000; },
};

export const FApp = {
  /** Real seconds the last frame took (not slowed by time dilation). */
  GetDeltaTime(): number { return GWorld.RealDeltaSeconds; },
};

let ExitHandler: () => void = () => {};

export const FPlatformMisc = {
  /** "Quit" on the desktop. Here main.ts decides what leaving means (back to the website). */
  RequestExit(_bForce: boolean = false): void { ExitHandler(); },
  SetExitHandler(Fn: () => void): void { ExitHandler = Fn; },
};

export const UGameplayStatics = {
  SetGlobalTimeDilation(Dilation: number): void { GWorld.TimeDilation = Dilation; },
  GetPlayerController(Index: number): APlayerController | null { return Input.GetPlayerController(Index); },
  SpawnSound2D(Sound: USoundBase | null, Volume = 1, Pitch = 1): UAudioComponent | null { return Audio.SpawnSound2D(Sound, Volume, Pitch); },
  CreateSound2D(Sound: USoundBase | null, Volume = 1, Pitch = 1): UAudioComponent | null { return Audio.CreateSound2D(Sound, Volume, Pitch); },
};

/** Window / full screen. Browsers only switch in response to a key press or click, so a request can fail quietly. */
export const Display = {
  /** True in full screen, whether the game asked for it or the player pressed the browser's own key (F11). */
  IsFullscreen(): boolean {
    return document.fullscreenElement !== null || (window.innerHeight >= screen.height - 1 && window.innerWidth >= screen.width - 1);
  },
  CanSwitch(): boolean { return document.fullscreenEnabled === true; },
  Toggle(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else if (!Display.IsFullscreen()) {
      void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  },
};

/** Frames per second the main loop may draw (0 = as fast as the display refreshes). Set by the options screen. */
export const FrameCap = { Value: 0 };

/** One line in the browser console; scripted test runs read the lines that start with CPV_. */
export function Log(Message: string): void {
  console.log(Message);
}

const bVerbose = Query.has('CpvVerbose');

/** UE_LOG(..., Verbose, ...): state changes and strikes, printed only with ?CpvVerbose. */
export function LogVerbose(Message: string | (() => string)): void {
  if (bVerbose) { console.log(typeof Message === 'string' ? Message : Message()); }
}
