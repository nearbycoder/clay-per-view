// Port of CpvRatingsRun.cpp: three episodes make one broadcast. Each headliner has a hand-cast card.

import { GConfig, Log } from '../engine/platform';
import { FMath } from '../engine/ue';
import { ACpvGameMode, implement } from './CpvGame';
import { CpvRule } from './CpvTypes';

// The card is cast around the lead. Each rival appears once, and the lead never fights a double.
const Cards = [[3, 2, 6], [7, 4, 5], [0, 5, 1], [5, 4, 0],
  [6, 3, 1], [1, 2, 7], [4, 0, 3], [2, 6, 5]];
const Names = ['COLD OPEN', 'PROP DEPARTMENT', 'PRIME TIME'];
const Rules = ['One take. Win it to stay on air.', 'Both corners start armed. Grab to throw your prop.',
  'Both stars start with a full signature meter.'];
const Calls = ['LAND A THREE-HIT COMBO', 'LAND A PROP HIT', 'FINISH WITH A CURTAIN CALL'];

implement(ACpvGameMode, {
  RivalForEpisode(Stage) {
    return Cards[this.Cursor[0]][Stage];
  },

  EpisodeName() {
    return Names[this.Episode];
  },

  EpisodeRule() {
    return Rules[this.Episode];
  },

  CrowdCall() {
    return Calls[this.Episode];
  },

  FulfillCrowdCall() {
    if (!this.IsRun() || this.bCrowdCall) { return; }
    this.bCrowdCall = true;
    this.Arena.CrowdPop(0.65);
    this.PlaySound('Cheer', 0.65);
    Log(`CPV_CROWD_CALL episode=${this.Episode + 1}`);
  },

  ScoreEpisode() {
    if (this.Winner !== 0) { return; }
    this.EpisodeStars[this.Episode] = 1 + (this.Fighters[0].Health >= CpvRule.MaxHealth * 0.5 ? 1 : 0) + (this.bCrowdCall ? 1 : 0);
    Log(`CPV_SCORE episode=${this.Episode + 1} stars=${this.EpisodeStars[this.Episode]} season=${this.SeasonStars()}`);
    if (this.Episode !== 2) { return; }
    const Star = this.Cursor[0];
    this.Champions[this.Difficulty] |= 1 << Star;
    const Record = FMath.Max(this.BestShow[this.Difficulty][Star], this.SeasonStars());
    this.BestShow[this.Difficulty][Star] = Record;
    const Section = 'ClayPerView.Champions';
    GConfig.SetInt(Section, String(this.Difficulty), this.Champions[this.Difficulty]);
    GConfig.SetInt(Section, `Best_${this.Difficulty}_${Star}`, Record);
    GConfig.Flush();
  },
});
