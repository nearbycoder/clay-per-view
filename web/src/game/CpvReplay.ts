// Port of the game-mode half of CpvReplay.cpp: play the deciding seconds back from the ringside camera's
// tape. (The tape itself is kept by the arena, CpvArena.ts; the replay screen is drawn by CpvHud.ts.)

import { Log } from '../engine/platform';
import { FMath } from '../engine/ue';
import { ACpvGameMode, implement } from './CpvGame';

implement(ACpvGameMode, {
  HasReplay() { return !!this.Arena && this.Arena.TapeEnd > this.Arena.TapeStart; },
  ReplayPicture() { return this.Arena.TapeFrame(this.ReplayTime); },
  ReplayProgress() {
    return FMath.Clamp((this.ReplayTime - this.Arena.TapeStart) / FMath.Max(0.01, this.Arena.TapeEnd - this.Arena.TapeStart), 0, 1);
  },

  StartReplay() {
    this.bWatchingReplay = true;
    this.ReplayTime = this.Arena.TapeStart;
    this.NextTapeSound = 0;
    while (this.NextTapeSound < this.TapeSounds.length && this.TapeSounds[this.NextTapeSound].At < this.ReplayTime) { ++this.NextTapeSound; }
    this.StopVoice();
    Log(`CPV_REPLAY start duration=${(this.Arena.TapeEnd - this.Arena.TapeStart).toFixed(2)}`);
  },

  TickReplay(Dt, Menu) {
    this.ReplayTime += Dt * 0.8;
    if (Menu.bBack || Menu.bOk || this.ReplayTime > this.Arena.TapeEnd + 0.5) {
      this.bWatchingReplay = false;
      Log('CPV_REPLAY return');
      return;
    }
    while (this.NextTapeSound < this.TapeSounds.length && this.TapeSounds[this.NextTapeSound].At <= this.ReplayTime) {
      const S = this.TapeSounds[this.NextTapeSound++];
      this.PlaySound(S.Name, S.Volume, S.Pitch * 0.9);
    }
  },
});
