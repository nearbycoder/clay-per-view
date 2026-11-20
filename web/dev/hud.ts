// Developer page for the HUD: fills an ACpvGameMode with made-up state (no world, no 3D) and
// draws one screen, so it can be compared with screenshots of the desktop game.
//
//   dev/hud.html?screen=menu&set=MenuIndex:4            (see Screens below for the names)
//     &p1=0&p2=1          roster picks
//     &set=Field:value,.. any game-mode field (numbers, true/false, strings); A.B reaches into Banner etc.
//     &f1=Health:40,Hype:100   fields of fighter one (f2 for fighter two)
//     &time=1.25          freeze RealTime (pulsing prompts)
//     &ref=<url>&mode=under|diff|none   show a reference picture beneath (or differenced with) the HUD
//     &scale=2            canvas pixels per CSS pixel

import { Assets } from '../src/engine/assets';
import { FrameCap, GConfig } from '../src/engine/platform';
import { SetRenderer } from '../src/engine/render';
import { FVector2D, INDEX_NONE } from '../src/engine/ue';
import { CpvData } from '../src/game/CpvData';
import type { ACpvFighter } from '../src/game/CpvFighter';
import { ACpvGameMode, ECpvMode, ECpvOptionsPage, ECpvPhase, FCpvMenuInput } from '../src/game/CpvGame';
import { ACpvHUD } from '../src/game/CpvHud';
import '../src/game/CpvOptions';
import { ECpvWeapon } from '../src/game/CpvTypes';

const Query = new URLSearchParams(location.search);
const Canvas = document.getElementById('hud') as HTMLCanvasElement;
const Ref = document.getElementById('ref') as HTMLImageElement;

function Value(Text: string): unknown {
  if (Text === 'true') { return true; }
  if (Text === 'false') { return false; }
  const N = Number(Text);
  return Text !== '' && Number.isFinite(N) ? N : Text;
}

function Assign(Target: any, List: string | null): void {
  for (const Item of (List ?? '').split(',').filter(Boolean)) {
    const Colon = Item.indexOf(':');
    const Path = Item.slice(0, Colon).split('.');
    let Obj = Target;
    for (let i = 0; i < Path.length - 1; ++i) { Obj = Obj[Path[i]]; }
    Obj[Path[Path.length - 1]] = Value(Item.slice(Colon + 1).replace(/_/g, ' '));
  }
}

function Star(Slot: number, RosterIndex: number): ACpvFighter {
  const F = {
    Slot, RosterIndex, Health: 100, ShownHealth: 100, Hype: 0, Weapon: ECpvWeapon.None, WeaponUses: 0,
    Combo: 0, BestCombo: 0, DamageDealt: 0, HitsLanded: 0, Taunts: 0,
    Def: () => CpvData.Fighter(F.RosterIndex),
    HasFullHype: () => F.Hype >= 99.99,
  };
  return F as unknown as ACpvFighter;
}

const Screens: Record<string, (G: ACpvGameMode) => void> = {
  title: (G) => { G.Phase = ECpvPhase.Title; },
  menu: (G) => { G.Phase = ECpvPhase.Menu; },
  options: (G) => { G.Phase = ECpvPhase.Options; G.OptionsPage = ECpvOptionsPage.General; },
  sound: (G) => { G.Phase = ECpvPhase.Options; G.OptionsPage = ECpvOptionsPage.Sound; },
  picture: (G) => { G.Phase = ECpvPhase.Options; G.OptionsPage = ECpvOptionsPage.Picture; G.MeasuredFPS = 117.6; },
  howto: (G) => { G.Phase = ECpvPhase.HowTo; },
  credits: (G) => { G.Phase = ECpvPhase.Credits; },
  select: (G) => { G.Phase = ECpvPhase.Select; },
  selectrun: (G) => { G.Phase = ECpvPhase.Select; G.Mode = ECpvMode.RatingsRun; },
  versus: (G) => { G.Phase = ECpvPhase.Versus; G.PhaseTime = 2; },
  versusrun: (G) => { G.Phase = ECpvPhase.Versus; G.PhaseTime = 2; G.Mode = ECpvMode.RatingsRun; },
  fight: (G) => { G.Phase = ECpvPhase.Fight; G.RoundClock = 87.5; },
  run: (G) => { G.Phase = ECpvPhase.Fight; G.RoundClock = 51.2; G.Mode = ECpvMode.RatingsRun; },
  cover: (G) => { G.Phase = ECpvPhase.Fight; G.RoundClock = 95.5; G.Mode = ECpvMode.TwoPlayer; G.PinSlot = 0; G.PinCount = 2; },
  rehearsal: (G) => { G.Phase = ECpvPhase.Fight; G.Mode = ECpvMode.Rehearsal; },
  finisher: (G) => { G.Phase = ECpvPhase.Fight; G.RoundClock = 41; G.FinisherPrompt = 4.2; G.FinisherFor = 0; },
  banner: (G) => { G.Phase = ECpvPhase.Fight; G.RoundClock = 98.4; G.Banner.Text = 'TAKE 1'; G.Banner.Life = 1.25; G.Banner.Age = 0.6; },
  subtitle: (G) => {
    G.Phase = ECpvPhase.Fight; G.RoundClock = 77;
    G.Subtitle.Text = "That's what we in the business call 'a montage'."; G.Subtitle.Speaker = 1; G.Subtitle.Left = 2;
  },
  namecard: (G) => { G.Phase = ECpvPhase.Intro; G.Letterbox = 1; G.NameCard = 'DUCHESS WINNIFRED'; G.NameCardSub = 'Frostiest Royal in the Tabloids'; G.NameCardAge = 2; },
  matchend: (G) => { G.Phase = ECpvPhase.MatchEnd; G.Winner = 0; G.Banner.Text = 'X'; G.Banner.Life = 5; },
  results: (G) => { G.Phase = ECpvPhase.Results; G.Winner = 0; },
  resultsrun: (G) => { G.Phase = ECpvPhase.Results; G.Winner = 0; G.Mode = ECpvMode.RatingsRun; },
  replay: (G) => { G.Phase = ECpvPhase.Results; G.Winner = 0; G.bWatchingReplay = true; },
  pause: (G) => { G.Phase = ECpvPhase.Fight; G.RoundClock = 60; G.bPaused = true; },
  pausepicture: (G) => { G.Phase = ECpvPhase.Fight; G.bPaused = true; G.bPauseOptions = true; G.OptionsPage = ECpvOptionsPage.Picture; G.MeasuredFPS = 59.9; },
};

async function Boot(): Promise<void> {
  const Faces: Array<[string, string]> = [
    ['CpvTitle', 'TitanOne-Regular'], ['CpvImpact', 'Anton-Regular'], ['CpvComic', 'Bangers-Regular'], ['CpvBold', 'BarlowCondensed-Bold'],
    ['CpvBoldItalic', 'BarlowCondensed-BoldItalic'], ['CpvExtraItalic', 'BarlowCondensed-ExtraBoldItalic'], ['CpvSemi', 'BarlowCondensed-SemiBold'],
    ['CpvMedium', 'BarlowCondensed-Medium'],
  ];
  const Pictures = ['P_Bruno', 'P_Chip', 'P_Dirk', 'P_Duchess', 'P_Lola', 'P_Mystica', 'P_Nigel', 'P_Ref', 'P_Rex', 'P_TitleBelt', 'P_Vince', 'P_Wubz'];
  await Promise.all([
    ...Faces.map(async ([Family, File]) => { document.fonts.add(await new FontFace(Family, `url(/assets/fonts/${File}.woff2)`).load()); }),
    ...Pictures.map(async (Name) => {
      const Img = new Image();
      Img.src = `/assets/images/${Name}.webp`;
      await Img.decode();
      Assets.Images.set(Name, Img);
    }),
  ]);

  const G = new ACpvGameMode();
  G.Fighters = [Star(0, Number(Query.get('p1') ?? 0)), Star(1, Number(Query.get('p2') ?? 1))];
  G.Cursor = [G.Fighters[0].RosterIndex, G.Fighters[1].RosterIndex];
  // Stand-ins for the parts of the game mode other files supply (same answers as the C++ gives).
  G.IsMirror = () => G.Fighters[0].RosterIndex === G.Fighters[1].RosterIndex;
  G.RivalForEpisode = (Stage) => [[3, 2, 6], [7, 4, 5], [0, 5, 1], [5, 4, 0], [6, 3, 1], [1, 2, 7], [4, 0, 3], [2, 6, 5]][G.Cursor[0]][Stage % 3];
  G.EpisodeName = () => ['COLD OPEN', 'PROP DEPARTMENT', 'PRIME TIME'][G.Episode];
  G.EpisodeRule = () => ['One take. Win it to stay on air.', 'Both corners start armed. Grab to throw your prop.', 'Both stars start with a full signature meter.'][G.Episode];
  G.CrowdCall = () => ['LAND A THREE-HIT COMBO', 'LAND A PROP HIT', 'FINISH WITH A CURTAIN CALL'][G.Episode];
  const Harness = { bCanCover: false, EscapeStart: 0.41, EscapeEnd: 0.82, EscapeNeedle: 0.505, bReplay: false, ReplayProgress: 0.35 };
  G.CanCover = () => Harness.bCanCover;
  G.EscapeStart = () => Harness.EscapeStart;
  G.EscapeEnd = () => Harness.EscapeEnd;
  G.EscapeNeedle = () => Harness.EscapeNeedle;
  G.HasReplay = () => Harness.bReplay;
  G.ReplayProgress = () => Harness.ReplayProgress;
  G.ReplayPicture = () => null;

  const Name = Query.get('screen') ?? 'title';
  (Screens[Name] ?? Screens.title)(G);
  Assign(G, Query.get('set'));
  Assign(G.Fighters[0], Query.get('f1'));
  Assign(G.Fighters[1], Query.get('f2'));
  Assign(Harness, Query.get('h'));
  if (Query.get('set')?.includes('Cursor')) { /* explicit */ } else { G.Cursor = [G.Fighters[0].RosterIndex, G.Fighters[1].RosterIndex]; }

  const Hud = new ACpvHUD();
  Hud.G = G;
  const Ctx = Canvas.getContext('2d')!;
  Hud.Canvas = Ctx;

  const RefUrl = Query.get('ref');
  const Mode = Query.get('mode') ?? (RefUrl ? 'under' : 'none');
  if (RefUrl && Mode !== 'none') {
    Ref.src = RefUrl;
    Ref.hidden = false;
    await Ref.decode().catch(() => {});
    if (Mode === 'diff') { Canvas.style.mixBlendMode = 'difference'; }
  }

  const Fixed = Query.get('time');
  const Hover = Query.get('hover');
  const Start = performance.now();
  const Frame = () => {
    const Scale = Number(Query.get('scale') ?? 1);
    const W = Math.round(innerWidth * Scale), H = Math.round(innerHeight * Scale);
    if (Canvas.width !== W || Canvas.height !== H) {
      Canvas.width = W;
      Canvas.height = H;
    }
    G.RealTime = Fixed !== null ? Number(Fixed) : (performance.now() - Start) / 1000;
    Hud.SizeX = W;
    Hud.SizeY = H;
    Ctx.setTransform(1, 0, 0, 1, 0, 0);
    Ctx.clearRect(0, 0, W, H);
    if (Hover) {
      const [X, Y] = Hover.split(':').map(Number);
      Hud.SetHover(new FVector2D(X * W, Y * H));
    }
    Hud.DrawHUD();
    (window as any).__frames = ((window as any).__frames ?? 0) + 1;
    requestAnimationFrame(Frame);
  };
  requestAnimationFrame(Frame);
  // For scripted checks: what is under a point, and the text metrics the kit reports.
  (window as any).__hud = {
    G, Hud, HitAt: (X: number, Y: number) => Hud.HitAt(new FVector2D(X * Canvas.width, Y * Canvas.height)), INDEX_NONE,
    // For exercising the options code without the rest of the game.
    FCpvMenuInput, FrameCap, GConfig, SetRenderer,
  };
}

Boot().catch((Err) => {
  console.error(Err);
  (window as any).__error = String(Err);
});
