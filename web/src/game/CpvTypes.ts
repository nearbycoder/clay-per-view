// Port of CpvTypes.h: the shared vocabulary of the fight (states, moves, the roster's shape, rules).

import { FLinearColor, FVector, FVector2D } from '../engine/ue';

/** What a fighter is doing. */
export enum ECpvState {
  Idle, Run, Dodge, Block, Attack, GrabTry, Clinch, Held, Throwing, Thrown, Whipped, Rebound,
  HitStun, Stagger, BlockStun, Airborne, Down, GetUp, Dazed, Taunt, Pickup, Special, Scripted, Dead, Win,
}

export enum ECpvReaction { Light, Gut, Heavy, Knockdown, Launch }
export enum ECpvWord { None, Pow, Bam, Wham, Splat, Crunch, Bonk, Oof, KO, Zap, Boom }

/** One strike: timings in seconds from the start of the clip. */
export interface FCpvMove {
  Clip: string;
  HitTime: number;      // when it connects
  Duration: number;     // total length before control returns
  Chain: number;        // if > 0, a buffered follow-up may start this early
  Damage: number;
  Range: number;        // reach from the attacker's centre
  Arc: number;          // half-angle of the swing in degrees
  Lunge: number;        // distance stepped forward before the hit
  Reaction: ECpvReaction;
  Knockback: number;    // cm/s shove
  Lift: number;         // launch speed upward
  HitStop: number;
  Word: ECpvWord;
  bHitsStanding: boolean;
  bHitsDown: boolean;
  bUnblockable: boolean;
  Sound: string;
}

/** The C++ struct's defaults. Spread it and override: `{ ...DefaultMove, Clip: 'Jab' }`. */
export const DefaultMove: FCpvMove = {
  Clip: '', HitTime: 0.1, Duration: 0.3, Chain: 0, Damage: 5, Range: 110, Arc: 55, Lunge: 30, Reaction: ECpvReaction.Light,
  Knockback: 120, Lift: 0, HitStop: 0.06, Word: ECpvWord.None, bHitsStanding: true, bHitsDown: false, bUnblockable: false, Sound: 'Punch',
};

export enum ECpvSpecial { Bomb, Scream, Flame, Zap, Shockwave, Scepter, Chord, Orb }
export enum ECpvFinisher { Explode, MicDrop, RollingPin, Rocket, Speaker, HeadPop, Encore, Shrink }
export enum ECpvWeapon { None, Chair, Guitar, Trophy, Pan, Mallet, Chicken, Slate, Count }

export interface FCpvWeaponDef {
  Name: string;
  Mesh: string;
  Damage: number;        // added to weapon strikes
  Uses: number;
  Word: ECpvWord;
  Sound: string;
  GripOffset: FVector;   // where on the mesh the hand holds it (mesh space)
  HypeBonus: number;
}

/** A member of the roster. Everyone is an invented showbiz archetype. */
export interface FCpvFighterDef {
  Id: string;            // mesh name: SK_<Id>
  Name: string;
  Title: string;
  Quote: string;
  Power: number;         // 1..5
  Speed: number;
  Guts: number;
  Colour: FLinearColor;  // UI accent
  Clay: FLinearColor;    // colour of the bits that fly off
  Clay2: FLinearColor;
  Taunt: string;
  SpecialName: string;
  Special: ECpvSpecial;
  FinisherName: string;
  Finisher: ECpvFinisher;
  VoiceId: string;       // for announcer clips: VO_Name_<VoiceId>
}

/** A frame of player or AI intent. Presses are true only on the frame they happen. */
export class FCpvInput {
  Move = FVector2D.ZeroVector; // world axes: X = screen right, Y = toward the camera
  bLight = false;
  bHeavy = false;
  bGrab = false;
  bSpecial = false;
  bTaunt = false;
  bDodge = false;
  bBlock = false;
  bRun = false;
  AnyPress(): boolean { return this.bLight || this.bHeavy || this.bGrab || this.bSpecial || this.bTaunt || this.bDodge; }
}

export const CpvRule = {
  MaxHealth: 100,
  MaxHype: 100,
  WalkSpeed: 215,
  RunSpeed: 470,
  BodyRadius: 31,
  GrabRange: 98,
  Gravity: 2300,
  DazedTime: 7,
} as const;
