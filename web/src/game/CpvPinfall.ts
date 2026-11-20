// Port of CpvPinfall.cpp: exhibition covers are resolved by the official and a timed shoulder lift from
// the defending player.

import { Log } from '../engine/platform';
import { FMath, FRotator, FVector } from '../engine/ue';
import { ACpvGameMode, ECpvPhase, implement } from './CpvGame';
import { CpvRule, ECpvState, ECpvWeapon } from './CpvTypes';

implement(ACpvGameMode, {
  CanCover(Star) {
    if (!Star || !this.bPins || this.IsRun() || this.IsRehearsing() || this.Phase !== ECpvPhase.Fight || this.bRoundOver || this.PinSlot >= 0 || this.RefDown > 0) { return false; }
    const Rival = Star.GetFoe();
    return Star.Weapon === ECpvWeapon.None && Rival !== null && Rival.GetState() === ECpvState.Down && Rival.Health > 0
      && Rival.GetStateTime() > 0.22 && Star.DistanceTo(Rival) < 135;
  },

  TryCover(Star) {
    if (!this.CanCover(Star)) { return false; }
    const Rival = Star.GetFoe();
    if (!Rival) { return false; }
    const Side = Star.Pos2D().X < Rival.Pos2D().X ? -1 : 1;
    const Limit = this.Arena.RingLimit() - 104;
    const Mark = new FVector(FMath.Clamp(Rival.Pos2D().X, -Limit, Limit), FMath.Clamp(Rival.Pos2D().Y, -Limit, Limit), 0);
    // Keep the pair on the mat and turn the shoulders toward the hard camera.
    Rival.SetActorLocationAndRotation(Mark, new FRotator(0, -74, 0));
    Star.SetActorLocationAndRotation(Mark.Add(new FVector(46 * Side, 15, 0)), new FRotator(0, Side < 0 ? 8 : 172, 0));
    Star.SetScripted(true); Rival.SetScripted(true);
    Star.UpdateMirror(); Rival.UpdateMirror();
    Star.Play('PinCover', 0.20); Rival.Play('PinShoulders', 0.20);
    this.Referee.SetActorLocationAndRotation(Mark.Add(new FVector(-92 * Side, -56, 0)), new FRotator(0, Side < 0 ? 153 : 29, 0));
    this.Referee.Play('RefCount', 0.18);
    this.RefAct = '';
    this.PinSlot = Star.Slot; this.PinCount = 0; this.PinClock = -0.28;
    this.SetEscapeBeat();
    this.StopVoice();
    this.SayCooldown = 4.3;
    this.Arena.CrowdPop(0.52);
    this.PlaySound('Thud', 0.65);
    Log(`CPV_COVER start=${this.PinSlot} health=${Rival.Health.toFixed(1)}`);
    return true;
  },

  EscapeStart() {
    const Health = FMath.Clamp(this.Fighters[1 - this.PinSlot].Health / CpvRule.MaxHealth, 0, 1);
    return 0.63 - (0.075 + 0.19 * Health);
  },
  EscapeEnd() { return 1.26 - this.EscapeStart(); },
  EscapeNeedle() { return FMath.Clamp(this.PinClock - this.PinCount, 0, 1); },

  SetEscapeBeat() {
    this.bPinMiss = false;
    const Health = this.Fighters[1 - this.PinSlot].Health / CpvRule.MaxHealth;
    const Chance = FMath.Clamp(0.14 + Health * 0.67 + 0.075 * this.Difficulty, 0.15, 0.95);
    this.CpuEscapeTime = FMath.FRand() < Chance ? FMath.FRandRange(this.EscapeStart() + 0.025, this.EscapeEnd() - 0.025)
      : FMath.FRandRange(0.1, this.EscapeStart() - 0.04);
  },

  TickCover(Dt) {
    const Defender = 1 - this.PinSlot;
    this.PinClock += Dt;
    if (this.PinCount < 3 && this.PinClock >= this.PinCount + 1) {
      ++this.PinCount;
      this.PlaySound('Stomp', 0.58, 1.4);
      this.PlaySound(`VO_Count${this.PinCount}`);
      this.Arena.CrowdPop(0.25 * this.PinCount);
      Log(`CPV_COVER count=${this.PinCount}`);
      if (this.PinCount < 3) { this.SetEscapeBeat(); }
    }
    if (this.PinCount === 3) {
      this.Referee.SetClipTime(0.76);
      if (this.DuckLeft <= 0) {
        const W = this.PinSlot;
        this.PinSlot = -1;
        this.bWonByPin = true;
        this.EndRound(W);
      }
      return;
    }
    // The referee's hand meets the mat at the same instant the number changes.
    this.Referee.SetClipTime(FMath.Fmod(0.76 + this.EscapeNeedle(), 1));
    const Needle = this.EscapeNeedle();
    const bPress = this.IsHuman(Defender) ? this.ReadPlayer(Defender).bLight : (!this.Dev.bDummy && Needle >= this.CpuEscapeTime);
    if (this.bPinMiss || this.PinClock < 0 || !bPress) { return; }
    if (Needle < this.EscapeStart() || Needle > this.EscapeEnd()) { this.bPinMiss = true; return; }
    this.Fighters[this.PinSlot].RecoverFromCover(false);
    this.Fighters[Defender].RecoverFromCover(true);
    this.PinSlot = -1;
    this.Referee.Play('RefIdle', 0.18);
    this.Fighters[Defender].AddHype(8);
    this.ShowBanner('KICK OUT!', this.Fighters[Defender].Def().Name, 1.1, this.Fighters[Defender].Def().Colour, 0.57);
    this.PlaySound('Cheer', 0.8);
    Log(`CPV_COVER kickout=${Defender} count=${this.PinCount}`);
  },
});
