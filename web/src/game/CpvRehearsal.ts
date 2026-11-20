// Port of CpvRehearsal.cpp: Ring School. The coaching partner uses the same input, hit detection and
// grapple rules as a live opponent.

import { Log } from '../engine/platform';
import { FLinearColor, FMath, FVector } from '../engine/ue';
import { ECpvLightMood } from './CpvArena';
import { ACpvGameMode, ECpvMode, ECpvPhase, implement } from './CpvGame';
import { CpvRule, FCpvInput } from './CpvTypes';

const Voices = ['VO_CoachJab', 'VO_CoachGuard', 'VO_CoachSlam', 'VO_CoachSpecial', 'VO_CoachWrap'];

implement(ACpvGameMode, {
  StartRehearsal() {
    this.Mode = ECpvMode.Rehearsal;
    this.Cursor[0] = 0;
    this.Cursor[1] = 3;
    this.SpawnFighters(this.Cursor[0], this.Cursor[1]);
    this.Wins[0] = this.Wins[1] = 0;
    this.Winner = -1;
    this.Round = 1;
    this.HideProps();
    this.ClearCallouts();
    this.Fx.Clear(false);
    this.Seq.bActive = false;
    this.Tweens.length = 0;
    this.Letterbox = 0;
    this.bRoundOver = false;
    this.bCamScripted = false;
    this.StartLoop('Music', 'Music_Fight', 0.26);
    this.SetPhase(ECpvPhase.Fight);
    this.Arena.SetMood(ECpvLightMood.Show, 0.7);
    this.DrawStageScreen('RING SCHOOL', 'REHEARSAL', new FLinearColor(0.1, 0.85, 0.76));
    this.SetLesson(0);
  },

  SetLesson(Index) {
    this.Lesson = Index;
    this.CueHold = 0;
    this.TrainerClock = 1.8;
    Log(`CPV_REHEARSAL cue=${Index}`);
    this.PlaySound(Voices[Index]);
    if (Index === 4) {
      this.Fighters[0].Celebrate();
      this.Arena.CrowdPop(0.9);
      this.Fx.Confetti(50);
      return;
    }
    const StartX = Index === 0 ? 115 : 45;
    for (let Slot = 0; Slot < 2; ++Slot) {
      this.Fighters[Slot].ResetForRound(new FVector(Slot === 0 ? -StartX : StartX, 0, 0), Slot === 0 ? 0 : 180);
      this.Fighters[Slot].bDazeOnKo = false;
    }
    if (Index === 3) { this.Fighters[0].Hype = CpvRule.MaxHype; }
  },

  PassCue() {
    if (this.CueHold > 0) { return; }
    // Let the player see the slam land or the signature fire before the actors take their marks.
    this.CueHold = this.Lesson === 3 ? 2.0 : 1.15;
    this.PlaySound('Select', 0.75);
  },

  TrainerInput(Dt) {
    const In = new FCpvInput();
    if (this.Lesson !== 1 || this.CueHold > 0) { return In; }
    const To = this.Fighters[0].Pos2D().Sub(this.Fighters[1].Pos2D());
    if (To.SizeSquared() > FMath.Square(87)) { In.Move = To.GetSafeNormal(); }
    else {
      this.TrainerClock -= Dt;
      if (this.TrainerClock <= 0) { In.bLight = true; this.TrainerClock = 1.9; }
    }
    return In;
  },

  TickRehearsal(Dt, Menu) {
    if (this.Lesson === 4) {
      this.StepFighters(Dt, false);
      if (Menu.bOk) { this.Mode = ECpvMode.RatingsRun; this.bSkipIntro = false; this.StartSelect(); }
      return;
    }
    for (const Star of this.Fighters) { Star.Health = FMath.Max(Star.Health, 65); }
    if (this.CueHold > 0) {
      this.StepFighters(Dt, false);
      this.CueHold -= Dt;
      if (this.CueHold <= 0) { this.SetLesson(this.Lesson + 1); }
    }
    else { this.StepFighters(Dt, true); }
  },
});
