// Port of CpvAI.h / CpvAI.cpp: the computer opponent. It produces the same input frames a player would.

import { FMath, FVector2D } from '../engine/ue';
import type { ACpvFighter } from './CpvFighter';
import type { ACpvGameMode } from './CpvGame';
import { ECpvSpecial, ECpvState, ECpvWeapon, FCpvInput } from './CpvTypes';

/** Computer opponent: produces the same input frames a player would. */
export class FCpvAI {
  Level = 1; // 0 easy, 1 normal, 2 hard

  private Skill(): number { return this.Level === 0 ? 0.3 : (this.Level === 1 ? 0.58 : 0.86); }
  private React(): number { return this.Level === 0 ? 0.18 : (this.Level === 1 ? 0.5 : 0.8); }    // chance to defend against an attack it sees coming
  private Punish(): number { return this.Level === 0 ? 0.1 : (this.Level === 1 ? 0.5 : 0.85); }   // chance to hit back at somebody recovering from a swing

  private Clock = 0;          // time until the next decision
  private BlockLeft = 0;
  private RunLeft = 0;
  private StrafeLeft = 0;
  private StrafeSign = 1;
  private BackOffLeft = 0;
  private ComboLeft = 0;
  private ComboGap = 0;
  private DownPlan = -1;      // what to do about a floored opponent (chosen once per knockdown)
  private SeenAttack: object | null = null;
  private bPunishRolled = false; // one decision per opening
  private bWantWeapon = false;
  private ClinchDelay = 0;

  Reset(): void {
    this.Clock = this.BlockLeft = this.RunLeft = this.StrafeLeft = this.BackOffLeft = this.ComboGap = this.ClinchDelay = 0;
    this.ComboLeft = 0;
    this.DownPlan = -1;
    this.SeenAttack = null;
    this.bWantWeapon = false;
    this.bPunishRolled = false;
  }

  Think(Dt: number, Me: ACpvFighter, Foe: ACpvFighter, Game: ACpvGameMode): FCpvInput {
    const In = new FCpvInput();
    const S = this.Skill();
    // Quick stars build strings. Power stars take bigger risks in the clinch.
    const Style = (Me.Def().Power - Me.Def().Speed) / 5;
    const To = Foe.Pos2D().Sub(Me.Pos2D());
    const Dist = To.Size();
    const Dir = Dist > 1 ? To.Div(Dist) : Me.Facing2D();
    const Side = new FVector2D(-Dir.Y, Dir.X);
    this.Clock -= Dt;
    this.BlockLeft -= Dt;
    this.RunLeft -= Dt;
    this.StrafeLeft -= Dt;
    this.BackOffLeft -= Dt;
    this.ComboGap -= Dt;
    const State = Me.GetState();
    const FoeState = Foe.GetState();
    const Chance = (PerSecond: number, Step: number): boolean => FMath.FRand() < PerSecond * Step;

    // --- things that happen to us ---
    if (State === ECpvState.Held) {
      In.bLight = Chance(3 + 7 * S, Dt); // mash to wriggle free
      return In;
    }
    if (State === ECpvState.Down) {
      In.bLight = Chance(2 + 5 * S, Dt);
      return In;
    }
    if (State === ECpvState.Clinch) {
      if (Me.GetStateTime() < 0.01) { this.ClinchDelay = FMath.FRandRange(0.2, 0.7) * (1.3 - S * 0.6); }
      if (Me.GetStateTime() >= this.ClinchDelay) {
        const R = FMath.FRand();
        if (R < 0.45 + 0.22 * Style) { In.bHeavy = true; }
        else if (R < 0.72) { In.bLight = true; }
        else {
          In.bGrab = true;
          // Whip toward whichever ropes are further away, for a longer run-up.
          const P = Me.Pos2D();
          In.Move = FMath.Abs(P.X) > FMath.Abs(P.Y) ? new FVector2D(P.X > 0 ? -1 : 1, 0) : new FVector2D(0, P.Y > 0 ? -1 : 1);
        }
      }
      return In;
    }
    if (State === ECpvState.Attack) {
      // Keep a combo going.
      if (this.ComboLeft > 0 && Me.Move && Me.Move.Chain > 0 && Me.GetStateTime() >= Me.Move.Chain - 0.05 && this.ComboGap <= 0) {
        In.bLight = true;
        --this.ComboLeft;
        this.ComboGap = 0.12;
      }
      return In;
    }
    if (State === ECpvState.Rebound) {
      if (Dist < 210 && FVector2D.DotProduct(Dir, Me.Facing2D()) > 0.5 && Foe.IsStanding()) {
        if (FMath.FRand() < 0.6) { In.bLight = true; } else { In.bHeavy = true; }
      }
      return In;
    }
    if (State === ECpvState.BlockStun) {
      // Something just bounced off the guard, and more of the string may follow: stay covered.
      this.BlockLeft = FMath.Max(this.BlockLeft, 0.28);
      In.bBlock = true;
      return In;
    }
    if (State !== ECpvState.Idle && State !== ECpvState.Run && State !== ECpvState.Block) { return In; }

    // --- the kill ---
    if (FoeState === ECpvState.Dazed) {
      In.Move = Dist > 120 ? Dir : FVector2D.ZeroVector;
      if (Dist < 170 && Chance(4, Dt)) { In.bSpecial = true; }
      return In;
    }

    // --- defence: react once to each attack we see coming ---
    if (Foe.IsAttacking() && Dist < 210) {
      // The C++ tags an attack by the address of the move (or of the fighter, for grabs and specials).
      const Tag: object = Foe.Move ? Foe.Move : Foe;
      if (this.SeenAttack !== Tag) {
        this.SeenAttack = Tag;   // one reaction roll per attack, not one per frame
        if (FMath.FRand() < this.React()) {
          if (FoeState === ECpvState.GrabTry) {
            // Strikes beat grabs, but only from outside their reach: up close, get out of the way.
            if (Dist > 112) { In.bLight = true; }
            else { In.bDodge = true; In.Move = Dir.Neg().Add(Side.Mul(FMath.FRand() < 0.5 ? 0.6 : -0.6)); this.BlockLeft = 0; }
          }
          else if (FMath.FRand() < 0.28) { In.bDodge = true; In.Move = Dir.Neg().Add(Side.Mul(FMath.FRand() < 0.5 ? 0.8 : -0.8)); }
          else { this.BlockLeft = FMath.FRandRange(0.35, 0.6); }
        }
      }
    }
    else if (!Foe.IsAttacking()) { this.SeenAttack = null; }

    // --- punish: they swung, it was blocked or it missed, and they are still recovering ---
    if (Foe.IsRecovering() && Dist < 122) {
      if (!this.bPunishRolled && Foe.RecoveryLeft() > 0.12) {
        this.bPunishRolled = true;
        if (FMath.FRand() < this.Punish()) {
          this.BlockLeft = 0;
          if (Me.Weapon === ECpvWeapon.None && Foe.RecoveryLeft() > 0.3 && FMath.FRand() < 0.4) { In.bGrab = true; }
          else {
            In.bLight = true;
            this.ComboLeft = 2;
          }
          return In;
        }
      }
    }
    else { this.bPunishRolled = false; }

    if (this.BlockLeft > 0) {
      In.bBlock = true;
      return In;
    }

    // --- signature move ---
    if (Me.HasFullHype() && Foe.IsStanding() && FoeState !== ECpvState.Dodge) {
      let Min = 0, Max = 600;
      switch (Me.Def().Special) {
        case ECpvSpecial.Scream: Max = 380; break;
        case ECpvSpecial.Flame: Max = 280; break;
        case ECpvSpecial.Shockwave: Max = 300; break;
        case ECpvSpecial.Scepter: Max = 175; break;
        case ECpvSpecial.Bomb: Min = 170; break;
        default: Min = 120; break;
      }
      if (Dist >= Min && Dist <= Max && Chance(1.5 + 3 * S, Dt)) {
        In.bSpecial = true;
        return In;
      }
      // Too close for it: hop back now and then to make room, but keep fighting rather than
      // walking backwards under fire with a full meter.
      if (Dist < Min && Chance(0.9, Dt)) {
        In.bDodge = true;
        In.Move = Dir.Neg();
        return In;
      }
    }

    // --- opponent on the mat ---
    if (FoeState === ECpvState.Down || FoeState === ECpvState.GetUp) {
      if (this.DownPlan < 0) {
        const R = FMath.FRand();
        this.DownPlan = R < 0.4 ? 0 : (R < 0.6 ? 1 : (R < 0.82 ? 2 : 3)); // stomp, splash, taunt, wait
        if (Me.HasFullHype() && this.DownPlan === 2) { this.DownPlan = 0; }
        if (Game.bPins && !Game.IsRun() && !Game.IsDemo() && Me.Weapon === ECpvWeapon.None &&
          Foe.Health < 66 && FMath.FRand() < 0.25 + (66 - Foe.Health) * 0.009) { this.DownPlan = 4; }
      }
      if (this.DownPlan === 4) {
        if (Game.CanCover(Me)) { In.bGrab = true; }
        else { In.Move = Dir; }
      }
      else if (this.DownPlan === 2) {
        if (Dist < 200) { In.Move = Dir.Neg(); }
        else if (FoeState === ECpvState.Down && Chance(5, Dt)) { In.bTaunt = true; this.DownPlan = 3; }
      }
      else if (this.DownPlan === 0 || this.DownPlan === 1) {
        if (Dist > 120) { In.Move = Dir; }
        else if (FoeState === ECpvState.Down && Chance(6, Dt)) {
          if (this.DownPlan === 0) { In.bLight = true; } else { In.bHeavy = true; }
          if (FMath.FRand() < 0.5) { this.DownPlan = 3; }
        }
      }
      else if (Dist < 150) { In.Move = Dir.Neg(); }
      return In;
    }
    this.DownPlan = -1;

    // --- weapons lying around ---
    const WeaponAt = Game.NearestWeapon(Me.Pos2D());
    if (Me.Weapon === ECpvWeapon.None && WeaponAt) {
      if (this.Clock <= 0 && !this.bWantWeapon) { this.bWantWeapon = FMath.FRand() < 0.35 + 0.3 * S; }
      const ToWeapon = new FVector2D(WeaponAt.X, WeaponAt.Y).Sub(Me.Pos2D());
      if (this.bWantWeapon && ToWeapon.Size() < Dist + 60) {
        if (ToWeapon.Size() > 85) { In.Move = ToWeapon.GetSafeNormal(); }
        else if (Chance(8, Dt)) { In.bGrab = true; this.bWantWeapon = false; }
        return In;
      }
    }
    else { this.bWantWeapon = false; }

    // --- spacing and offence ---
    if (this.BackOffLeft > 0) {
      In.Move = Dir.Mul(-0.9).Add(Side.Mul(this.StrafeSign * 0.4));
      return In;
    }
    if (Me.Weapon !== ECpvWeapon.None && Dist > 190 && Dist < 345 && Foe.IsStanding() && Chance(0.5 + S, Dt)) {
      // The prop travels straight ahead. Turn toward the rival before letting it go.
      if (FVector2D.DotProduct(Me.Facing2D(), Dir) > 0.96) { In.bGrab = true; return In; }
    }
    if (Dist > 300) {
      In.Move = Dir;
      if (this.Clock <= 0) {
        this.Clock = FMath.FRandRange(0.4, 0.9);
        if (FMath.FRand() < 0.3 + 0.2 * S) { this.RunLeft = 0.9; }
        else if (!Me.HasFullHype() && FMath.FRand() < 0.12) { In.bTaunt = true; }
      }
      In.bRun = this.RunLeft > 0;
      return In;
    }
    if (State === ECpvState.Run) {
      // Arriving at a sprint: turn it into a running attack.
      In.Move = Dir;
      In.bRun = true;
      if (Dist < 215) {
        if (FMath.FRand() < 0.55) { In.bLight = true; } else { In.bHeavy = true; }
      }
      return In;
    }
    if (Dist > 128) {
      if (this.StrafeLeft <= 0 && this.Clock <= 0) {
        this.Clock = FMath.FRandRange(0.3, 0.7);
        if (FMath.FRand() < 0.3) {
          this.StrafeLeft = FMath.FRandRange(0.3, 0.7);
          this.StrafeSign = FMath.FRand() < 0.5 ? 1 : -1;
        }
      }
      In.Move = this.StrafeLeft > 0 ? Side.Mul(this.StrafeSign).Add(Dir.Mul(0.35)).GetSafeNormal() : Dir;
      if (Me.Weapon !== ECpvWeapon.None && Dist < 175 && Chance(3 + 3 * S, Dt)) { In.bLight = true; }
      return In;
    }

    // Toe to toe. A turtling opponent gets grabbed.
    if (FoeState === ECpvState.Block && Dist < 104 && Me.Weapon === ECpvWeapon.None && Chance(2 + 5 * S, Dt)) {
      In.bGrab = true;
      return In;
    }
    if (this.Clock <= 0) {
      this.Clock = FMath.FRandRange(0.32, 0.75) * (1.4 - S * 0.6);
      const R = FMath.FRand();
      if (Me.Weapon !== ECpvWeapon.None) {
        if (R < 0.6) { In.bLight = true; }
        else if (R < 0.88) { In.bHeavy = true; }
        else { this.BackOffLeft = 0.4; }
      }
      else if (R < 0.44 - 0.18 * Style) {
        In.bLight = true;
        this.ComboLeft = FMath.RandRange(0, 2) + (S > 0.5 ? 1 : 0);
        this.ComboLeft = FMath.Min(this.ComboLeft, 2);
      }
      else if (R < 0.58) { In.bHeavy = true; }
      else if (R < 0.66 - 0.1 * Style) { In.bHeavy = true; In.Move = Dir; }
      else if (R < 0.86) { In.bGrab = true; }
      else if (R < 0.93) { this.BlockLeft = 0.45; }
      else {
        this.BackOffLeft = FMath.FRandRange(0.3, 0.6);
        this.StrafeSign = FMath.FRand() < 0.5 ? 1 : -1;
      }
    }
    return In;
  }
}
