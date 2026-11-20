// Port of CpvData.cpp: the standard strikes, the roster and the weapons.

import { FLinearColor, FVector } from '../engine/ue';
import { DefaultMove, ECpvFinisher, ECpvReaction, ECpvSpecial, ECpvWeapon, ECpvWord, FCpvFighterDef, FCpvMove, FCpvWeaponDef } from './CpvTypes';

function C(R: number, G: number, B: number): FLinearColor { return FLinearColor.FromSrgb(R, G, B); }

function Make(Clip: string, HitTime: number, Duration: number, Damage: number, Range: number, Lunge: number, Reaction: ECpvReaction, Knockback: number,
  HitStop: number, Word: ECpvWord, Sound: string, Chain = 0, Lift = 0, Arc = 55): FCpvMove {
  return { ...DefaultMove, Clip, HitTime, Duration, Damage, Range, Lunge, Reaction, Knockback, HitStop, Word, Sound, Chain, Lift, Arc };
}

function Ground(M: FCpvMove): FCpvMove {
  return { ...M, bHitsStanding: false, bHitsDown: true };
}

const R = ECpvReaction;
const W = ECpvWord;

//                      clip           hit   dur   dmg range lunge reaction     push  stop  word     sound    chain lift
const Jab = Make('Jab', 0.10, 0.30, 4, 118, 26, R.Light, 150, 0.05, W.None, 'Punch', 0.19);
const Cross = Make('Cross', 0.16, 0.42, 6, 124, 34, R.Light, 200, 0.07, W.None, 'Punch', 0.27);
const Uppercut = Make('Uppercut', 0.22, 0.56, 10, 118, 30, R.Launch, 190, 0.13, W.Pow, 'Heavy', 0, 640);
const Haymaker = Make('Haymaker', 0.46, 0.95, 15, 132, 52, R.Knockdown, 420, 0.15, W.Bam, 'Heavy');
const Boot = Make('Boot', 0.24, 0.68, 11, 150, 40, R.Heavy, 520, 0.11, W.Wham, 'Kick');
const Clothesline = Make('Clothesline', 0.15, 0.6, 13, 120, 150, R.Knockdown, 380, 0.13, W.Wham, 'Heavy', 0, 0, 75);
const Dropkick = Make('Dropkick', 0.26, 1.45, 17, 170, 190, R.Launch, 560, 0.15, W.Bam, 'Kick', 0, 420);
const Stomp = Ground(Make('Stomp', 0.26, 0.55, 6, 115, 30, R.Light, 0, 0.08, W.None, 'Stomp'));
const Splash = Ground(Make('Splash', 0.60, 1.6, 14, 150, 0, R.Light, 0, 0.14, W.Splat, 'Slam'));
const WeaponSwing = Make('WeaponSwing', 0.24, 0.62, 9, 165, 34, R.Heavy, 360, 0.12, W.Bonk, 'Weapon');
const WeaponSmash = Make('WeaponSmash', 0.36, 0.86, 13, 160, 40, R.Knockdown, 300, 0.16, W.Crunch, 'Weapon');

function Star(Id: string, Name: string, Title: string, Quote: string, Power: number, Speed: number, Guts: number, Colour: FLinearColor, Clay: FLinearColor,
  Clay2: FLinearColor, Taunt: string, SpecialName: string, Special: ECpvSpecial, FinisherName: string, Finisher: ECpvFinisher, VoiceId: string): FCpvFighterDef {
  return { Id, Name, Title, Quote, Power, Speed, Guts, Colour, Clay, Clay2, Taunt, SpecialName, Special, FinisherName, Finisher, VoiceId };
}

const RosterList: FCpvFighterDef[] = [
  Star('Rex', 'REX GRANITE', 'Straight-to-Streaming Action Hero', '"I do my own stunts. And yours."',
    5, 2, 4, C(214, 60, 44), C(201, 138, 94), C(86, 104, 58), 'TauntFlex', 'BOX OFFICE BOMB', ECpvSpecial.Bomb, "DIRECTOR'S CUT", ECpvFinisher.Explode, 'Rex'),
  Star('Lola', 'LOLA GLITZ', 'Chart-Topping Pop Diva', '"You may clap now."',
    2, 5, 2, C(255, 45, 149), C(242, 196, 164), C(255, 45, 149), 'TauntDance', 'HIGH NOTE', ECpvSpecial.Scream, 'MIC DROP', ECpvFinisher.MicDrop, 'Lola'),
  Star('Bruno', 'CHEF BRUNO FLAMBE', 'Volcanic TV Chef', '"It\'s raw! Like you!"',
    4, 2, 5, C(240, 236, 226), C(219, 162, 124), C(241, 238, 230), 'TauntKiss', 'FLAMBE', ECpvSpecial.Flame, 'ORDER UP!', ECpvFinisher.RollingPin, 'Bruno'),
  Star('Chip', 'CHIP STERLING', 'Tech Billionaire, Allegedly Human', '"Your face is my next acquisition."',
    2, 4, 2, C(142, 149, 159), C(239, 208, 184), C(142, 149, 159), 'TauntPhone', 'PUSH NOTIFICATION', ECpvSpecial.Zap, 'LAUNCH DAY', ECpvFinisher.Rocket, 'Chip'),
  Star('Wubz', 'DJ WUBZ', 'Festival Headliner, Face Unknown', '"..."  (the visor shows a thumbs-up)',
    3, 4, 3, C(57, 231, 95), C(57, 231, 95), C(123, 47, 247), 'TauntDance', 'BASS DROP', ECpvSpecial.Shockwave, 'WALL OF SOUND', ECpvFinisher.Speaker, 'Wubz'),
  Star('Duchess', 'DUCHESS WINNIFRED', 'Frostiest Royal in the Tabloids', '"One does not sweat. One glistens."',
    3, 3, 3, C(126, 87, 194), C(243, 215, 198), C(94, 42, 150), 'TauntWave', 'ROYAL DECREE', ECpvSpecial.Scepter, 'OFF WITH THE HEAD', ECpvFinisher.HeadPop, 'Duchess'),
  Star('Vince', 'VINCE VOLTAGE', 'Stadium Rock Survivor', '"This one goes out to your dentist."',
    3, 3, 3, C(179, 32, 42), C(230, 195, 173), C(179, 32, 42), 'TauntRock', 'POWER CHORD', ECpvSpecial.Chord, 'ENCORE', ECpvFinisher.Encore, 'Vince'),
  Star('Mystica', 'MADAME MYSTICA', 'Late-Night TV Psychic', '"I foresee a lot of pain in your future."',
    3, 2, 4, C(21, 127, 134), C(169, 113, 78), C(21, 127, 134), 'TauntMystic', 'CRYSTAL BALL', ECpvSpecial.Orb, 'TINY FATE', ECpvFinisher.Shrink, 'Mystica'),
];

function Arm(Name: string, Mesh: string, Damage: number, Uses: number, Word: ECpvWord, Sound: string, GripOffset: FVector, HypeBonus: number): FCpvWeaponDef {
  return { Name, Mesh, Damage, Uses, Word, Sound, GripOffset, HypeBonus };
}

const WeaponDefs: FCpvWeaponDef[] = [
  Arm('NOTHING', '', 0, 0, W.None, 'Punch', FVector.ZeroVector, 0),
  Arm('FOLDING CHAIR', '/Game/CPV/Props/SM_Chair.SM_Chair', 8, 3, W.Crunch, 'Chair', new FVector(-18, 0, 84), 6),
  Arm('GUITAR', '/Game/CPV/Props/SM_Guitar.SM_Guitar', 10, 2, W.Bam, 'Guitar', new FVector(0, 0, 6), 8),
  Arm('GOLD STAR AWARD', '/Game/CPV/Props/SM_Trophy.SM_Trophy', 7, 4, W.Bonk, 'Bonk', new FVector(0, 0, 18), 7),
  Arm('FRYING PAN', '/Game/CPV/Props/SM_Pan.SM_Pan', 7, 5, W.Bonk, 'Pan', new FVector(0, 0, 8), 5),
  Arm('MALLET', '/Game/CPV/Props/SM_Mallet.SM_Mallet', 11, 3, W.Wham, 'Bonk', new FVector(0, 0, 10), 6),
  Arm('RUBBER CHICKEN', '/Game/CPV/Props/SM_Chicken.SM_Chicken', 2, 6, W.Oof, 'Squeak', new FVector(0, 0, 2), 12),
  Arm('STUDIO CLAPPERBOARD', '/Game/CPV/Props/SM_Slate.SM_Slate', 6, 4, W.Bam, 'Clapboard', new FVector(0, -21, 40), 9),
];

export const CpvData = {
  Jab, Cross, Uppercut, Haymaker, Boot, Clothesline, Dropkick, Stomp, Splash, WeaponSwing, WeaponSmash,
  Roster(): FCpvFighterDef[] { return RosterList; },
  Fighter(Index: number): FCpvFighterDef {
    const Count = RosterList.length;
    return RosterList[((Index % Count) + Count) % Count];
  },
  Weapon(Type: ECpvWeapon): FCpvWeaponDef { return WeaponDefs[Type < WeaponDefs.length ? Type : 0]; },
};
