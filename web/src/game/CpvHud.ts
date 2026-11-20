// Port of CpvHud.h / CpvHud.cpp, with the HUD's share of CpvPointer.cpp (click targets, hover, the BACK
// button) and of CpvReplay.cpp (the instant-replay screen): every screen in the game, drawn on a 2D canvas
// in a TV-broadcast style. Authored at 1080p and scaled.
//
// The canvas lies over the 3D picture. main.ts hands the HUD the game, the canvas context and its size
// before each DrawHUD().

import { Assets } from '../engine/assets';
import { GRenderer } from '../engine/render';
import { FBox2D, FLinearColor, FMath, FVector2D, INDEX_NONE } from '../engine/ue';
import { CpvData } from './CpvData';
import type { ACpvFighter } from './CpvFighter';
import { ACpvGameMode, ECpvMode, ECpvOptionsPage, ECpvPhase } from './CpvGame';
import { CpvRule, ECpvWeapon } from './CpvTypes';
import { CpvUi, ECpvAlign, ECpvFont, UCanvas } from './CpvUi';

export enum ECpvClick { Accept, Back, Main, Roster, Option, Less, More, Pause, Result }

export interface FCpvHitArea {
  Box: FBox2D;
  Action: ECpvClick;
  Index: number;
}

/** A portrait picture and the name it is cached under. */
interface FPortrait {
  Image: HTMLImageElement;
  Id: string;
}

const Gold = new FLinearColor(1, 0.8, 0.14);
const Red = new FLinearColor(0.82, 0.13, 0.09);
const Blue = new FLinearColor(0.1, 0.3, 0.82);
const Ink = new FLinearColor(0.012, 0.014, 0.035);
const Panel = new FLinearColor(0.012, 0.014, 0.035, 0.86);
const White = new FLinearColor(1, 1, 1);
const Dim = new FLinearColor(0.7, 0.74, 0.84);

function Fade(C: FLinearColor, A: number): FLinearColor { return new FLinearColor(C.R, C.G, C.B, C.A * A); }
function Pulse(T: number, Speed = 4): number { return 0.5 + 0.5 * FMath.Sin(T * Speed); }
function SlotColour(Slot: number): FLinearColor { return Slot === 0 ? Red : Blue; }

// ---------------------------------------------------------------------------------------------
// Kit
// ---------------------------------------------------------------------------------------------

/** How far below the top of its line box each face starts drawing capitals, as a fraction of the size. */
function TopGap(Face: ECpvFont): number {
  switch (Face) {
    case ECpvFont.Title: return 0.06;
    case ECpvFont.Impact: return 0.1;
    case ECpvFont.Comic: return 0.08;
    default: return 0.2;
  }
}

function IsInsideOrOn(Box: FBox2D, P: FVector2D): boolean {
  return P.X >= Box.Min.X && P.X <= Box.Max.X && P.Y >= Box.Min.Y && P.Y <= Box.Max.Y;
}

export class ACpvHUD {
  /** Set by main.ts: the game, the canvas to draw on and its size in canvas pixels. */
  G!: ACpvGameMode;
  Canvas!: UCanvas;
  SizeX = 1920;
  SizeY = 1080;

  private HoverPixel = FVector2D.ZeroVector;
  private HoverContext = INDEX_NONE;
  private HitAreas: FCpvHitArea[] = [];
  private LastContext = -1;
  private Portraits = new Map<string, FPortrait | null>();
  // Coordinates below are in 1080p units; W and H are the canvas size in those units.
  private S = 1;
  private W = 1920;
  private H = 1080;

  SetHover(Pixel: FVector2D): void {
    this.HoverPixel = Pixel;
    this.HoverContext = this.G ? this.PointerContext() : INDEX_NONE;
  }
  ClearHover(): void { this.HoverContext = INDEX_NONE; }

  private Txt(Str: string, X: number, Y: number, Face: ECpvFont, Size: number, Colour: FLinearColor, Align: ECpvAlign = ECpvAlign.Left,
    Shadow = 0, Spacing = 0): number {
    const S = this.S;
    Y -= TopGap(Face) * Size;
    return CpvUi.Text(this.Canvas, Str, X * S, Y * S, CpvUi.Font(Face, Size * S, Spacing), Colour, Align, Shadow * S) / S;
  }

  private Out(Str: string, X: number, Y: number, Face: ECpvFont, Size: number, Colour: FLinearColor, Edge: FLinearColor, Thick: number,
    Align: ECpvAlign = ECpvAlign.Left, Spacing = 0): number {
    const S = this.S;
    Y -= TopGap(Face) * Size;
    return CpvUi.Outlined(this.Canvas, Str, X * S, Y * S, CpvUi.Font(Face, Size * S, Spacing), Colour, Edge, Thick * S, Align) / S;
  }

  private Width(Str: string, Face: ECpvFont, Size: number, Spacing = 0): number {
    return CpvUi.Measure(Str, CpvUi.Font(Face, Size * this.S, Spacing)).X / this.S;
  }

  private Box(X: number, Y: number, BW: number, BH: number, Colour: FLinearColor): void {
    const S = this.S;
    CpvUi.Fill(this.Canvas, X * S, Y * S, BW * S, BH * S, Colour);
  }

  private Slant(X: number, Y: number, BW: number, BH: number, Skew: number, Colour: FLinearColor): void {
    const S = this.S;
    CpvUi.Slant(this.Canvas, X * S, Y * S, BW * S, BH * S, Skew * S, Colour);
  }

  private Pic(Texture: FPortrait | null, X: number, Y: number, BW: number, BH: number, Tint: FLinearColor = FLinearColor.White, bFlip = false): void {
    if (!Texture) { return; }
    const S = this.S;
    CpvUi.Image(this.Canvas, Texture.Image, X * S, Y * S, BW * S, BH * S, Tint, bFlip, Texture.Id);
  }

  private Portrait(Id: string): FPortrait | null {
    const Found = this.Portraits.get(Id);
    if (Found !== undefined) { return Found; }
    const Image = Assets.Image(`P_${Id}`);
    const Texture = Image ? { Image, Id: `P_${Id}` } : null;
    this.Portraits.set(Id, Texture);
    return Texture;
  }

  private Shade(Top: number, Bottom: number, AlphaTop: number, AlphaBottom: number): void {
    const S = this.S;
    CpvUi.Gradient(this.Canvas, 0, Top * S, this.W * S, (Bottom - Top) * S, new FLinearColor(0, 0, 0.02, AlphaTop), new FLinearColor(0, 0, 0.02, AlphaBottom));
  }

  // ---------------------------------------------------------------------------------------------
  // Click targets (CpvPointer.cpp)
  // ---------------------------------------------------------------------------------------------

  /** Identifies the current screen, so stale click targets are not used after it changes. */
  PointerContext(): number {
    const G = this.G;
    return (G.Phase as number) | ((G.OptionsPage as number) << 5) | ((G.bPaused ? 1 : 0) << 8) | ((G.bPauseOptions ? 1 : 0) << 9) | ((G.bWatchingReplay ? 1 : 0) << 10);
  }

  private Hit(X: number, Y: number, BW: number, BH: number, Action: ECpvClick, Index = 0): void {
    const S = this.S;
    this.HitAreas.push({ Box: new FBox2D(new FVector2D(X * S, Y * S), new FVector2D((X + BW) * S, (Y + BH) * S)), Action, Index });
  }

  /** The click target under a point given in canvas pixels, if any. */
  HitAt(Pixel: FVector2D): FCpvHitArea | null {
    if (!this.G || this.LastContext !== this.PointerContext()) { return null; }
    // Narrow controls (for example the two adjustment arrows) sit on top of their row.
    for (let i = this.HitAreas.length - 1; i >= 0; --i) {
      if (IsInsideOrOn(this.HitAreas[i].Box, Pixel)) { return this.HitAreas[i]; }
    }
    return null;
  }

  private DrawHover(): void {
    if (this.HoverContext !== this.PointerContext()) { return; }
    const Area = this.HitAt(this.HoverPixel);
    if (!Area || Area.Action === ECpvClick.Accept) { return; }
    const Min = Area.Box.Min.Div(this.S), Max = Area.Box.Max.Div(this.S);
    const Length = FMath.Min(55, Max.X - Min.X - 6);
    this.Box(Min.X + 3, Max.Y - 4, Length, 3, new FLinearColor(0.92, 0.97, 1));
  }

  private DrawBack(): void {
    const X = this.W - 206;
    this.Slant(X, 44, 150, 52, 8, new FLinearColor(0.015, 0.018, 0.04, 0.94));
    this.Txt('<  BACK', X + 74, 50, ECpvFont.Bold, 29, FLinearColor.White, ECpvAlign.Center);
    this.Hit(X, 44, 154, 52, ECpvClick.Back);
  }

  // ---------------------------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------------------------

  DrawHUD(): void {
    this.HitAreas.length = 0;
    const G = this.G;
    if (!G || !this.Canvas || !G.bShowHud || !G.Fighters[0] || !G.Fighters[1]) { return; }
    this.S = FMath.Min(this.SizeY / 1080, this.SizeX / 1760);
    this.W = this.SizeX / this.S;
    this.H = this.SizeY / this.S;
    const W = this.W, H = this.H;
    this.LastContext = this.PointerContext();
    if (G.bWatchingReplay) { this.DrawReplay(); this.Hit(0, 0, W, H, ECpvClick.Accept); return; }
    if (G.bPauseOptions || G.Phase === ECpvPhase.Options) { this.DrawOptions(); this.DrawHover(); return; }

    if (G.Letterbox > 0) {
      this.Box(0, 0, W, 96 * G.Letterbox, FLinearColor.Black);
      this.Box(0, H - 96 * G.Letterbox, W, 96 * G.Letterbox + 2, FLinearColor.Black);
    }
    switch (G.Phase as ECpvPhase) {
      case ECpvPhase.Title: this.DrawTitle(); break;
      case ECpvPhase.Menu: this.DrawMenu(); break;
      case ECpvPhase.Options: break;
      case ECpvPhase.HowTo: this.DrawHowTo(); break;
      case ECpvPhase.Credits: this.DrawCredits(); break;
      case ECpvPhase.Select: this.DrawSelect(); break;
      case ECpvPhase.Versus: this.DrawVersus(); break;
      case ECpvPhase.Intro: this.DrawNameCard(); break;
      case ECpvPhase.RoundIntro:
      case ECpvPhase.Fight:
      case ECpvPhase.RoundEnd: this.DrawFight(); break;
      case ECpvPhase.Finisher: break;
      case ECpvPhase.MatchEnd: break;
      case ECpvPhase.Results: this.DrawResults(); break;
    }
    this.DrawBanner();
    if (G.bSubtitles) { this.DrawSubtitle(); }

    if (G.bPaused) { this.HitAreas.length = 0; this.DrawPause(); }
    this.DrawHover();
    if (G.FadeOut > 0) { this.Box(0, 0, W, H, new FLinearColor(0, 0, 0, G.FadeOut)); }
  }

  private DrawLogo(CX: number, Y: number, Size: number): void {
    // Wordmark: chunky yellow letters with a dark edge and a red drop, like stacked clay cut-outs.
    const Name = 'CLAY-PER-VIEW';
    const Room = 2 * FMath.Min(CX, this.W - CX) - 60;
    const Natural = this.Width(Name, ECpvFont.Title, Size);
    if (Natural > Room) { Size *= Room / Natural; }
    this.Out(Name, CX + Size * 0.045, Y + Size * 0.06, ECpvFont.Title, Size, Red, Fade(Ink, 0), 0, ECpvAlign.Center);
    this.Out(Name, CX, Y, ECpvFont.Title, Size, Gold, Ink, Size * 0.05, ECpvAlign.Center);
    const SubW = this.Width('FAMOUS LAST BLOWS', ECpvFont.Impact, Size * 0.3, 220);
    this.Slant(CX - SubW * 0.5 - 34, Y + Size * 1.2, SubW + 68, Size * 0.42, 12, Red);
    this.Txt('FAMOUS LAST BLOWS', CX, Y + Size * 1.225, ECpvFont.Impact, Size * 0.3, White, ECpvAlign.Center, 0, 220);
  }

  private DrawTitle(): void {
    const G = this.G, W = this.W, H = this.H;
    this.Hit(0, 0, W, H, ECpvClick.Accept);
    this.Shade(0, 560, 0.78, 0);
    this.Shade(760, H, 0, 0.8);
    this.DrawLogo(W * 0.5, 110, 190);
    const A = 0.45 + 0.55 * Pulse(G.RealTime, 5);
    this.Out('ENTER THE RING', W * 0.5, 900, ECpvFont.ExtraItalic, 58, Fade(White, A), Fade(Ink, A), 3, ECpvAlign.Center, 60);
    this.Txt('ENTER  /  GAMEPAD A', W * 0.5, 980, ECpvFont.Medium, 28, Dim, ECpvAlign.Center, 2, 30);
  }

  private DrawMenu(): void {
    const G = this.G, W = this.W, H = this.H;
    this.Shade(0, H, 0.5, 0.62);
    this.DrawLogo(480, 70, 110);
    // The last entry closes the desktop game; in a browser it leads back to the website.
    const Items = ['RATINGS RUN', 'EXHIBITION', 'TWO PLAYERS', 'WATCH A BOUT', 'OPTIONS', 'RING SCHOOL', 'CREDITS', 'EXIT TO WEBSITE'];
    const Help = [
      'Win three one-take bouts to become the prime-time headliner.', 'Pick both stars for a single-player bout.',
      'Share a keyboard, connect two pads, or use one of each.', 'Cast a bout and watch two computer-controlled stars fight.',
      'Set bout rules, adjust the mix and tune picture quality.', 'Practice four moves with a ringside coach.', 'Meet the cast and see how the broadcast was made.',
      'Leave the ring and return to the website.'];
    for (let i = 0; i < Items.length; ++i) {
      const Y = 258 + i * 79;
      this.Hit(92, Y - 6, 674, 79, ECpvClick.Main, i);
      const bOn = i === G.MenuIndex;
      if (bOn) {
        this.Slant(110, Y - 6, 640, 80, 26, Gold);
        this.Slant(96, Y - 6, 12, 80, 26, Red);
      }
      this.Txt(Items[i], 170 + (bOn ? 14 : 0), Y, ECpvFont.ExtraItalic, 62, bOn ? Ink : White, ECpvAlign.Left, bOn ? 0 : 3, 20);
    }
    if (G.MenuIndex === 0) {
      const X = W - 830, Y = 252, CardW = 730;
      this.Slant(X + 9, Y + 12, CardW, 492, 10, Fade(Ink, 0.6));
      this.Slant(X, Y, CardW, 492, 10, Panel);
      this.Box(X + 23, Y + 20, CardW - 44, 7, Gold);
      this.Txt("TONIGHT'S TITLE BOUTS", X + 32, Y + 42, ECpvFont.Bold, 29, Gold, ECpvAlign.Left, 0, 60);
      this.Pic(this.Portrait('TitleBelt'), X + 18, Y + 72, CardW - 36, 298);
      this.Txt('PRIME-TIME CHAMPIONSHIP', X + CardW * 0.5, Y + 352, ECpvFont.ExtraItalic, 50, White, ECpvAlign.Center);
      this.Txt('Win the card. Answer the crowd. Earn up to nine stars.', X + CardW * 0.5, Y + 422, ECpvFont.Semi, 28, Dim, ECpvAlign.Center);
    }
    this.Slant(100, 920, 900, 56, 16, Panel);
    this.Txt(Help[G.MenuIndex], 136, 930, ECpvFont.Semi, 32, White);
    this.Txt('W/S or D-pad   Choose       ENTER / A   Select       ESC / B   Back', 136, 1000, ECpvFont.Medium, 24, Dim, ECpvAlign.Left, 0, 20);
  }

  private DrawOptions(): void {
    const G = this.G, W = this.W, H = this.H;
    const bPicture = G.OptionsPage === ECpvOptionsPage.Picture;
    const bSound = G.OptionsPage === ECpvOptionsPage.Sound;
    const Left = W * 0.055;
    const RowW = W * 0.51;
    const Right = Left + RowW + W * 0.04;
    const CardW = W - Right - Left;
    this.Shade(0, H, 0.45, 0.38);
    this.Txt(G.bPauseOptions ? 'INTERMISSION' : 'MAIN MENU', Left, 60, ECpvFont.Bold, 30, Gold, ECpvAlign.Left, 1, 70);
    this.Out(bPicture ? 'PICTURE QUALITY' : bSound ? 'SOUND MIXER' : 'OPTIONS', Left, 101, ECpvFont.Title, 74, White, Ink, 4);
    const RowH = bPicture ? 55 : 79;
    for (let Row = 0; Row < G.OptionCount(); ++Row) {
      const Y = 225 + Row * RowH;
      const bSelected = Row === G.OptionIndex;
      this.Slant(Left, Y, RowW, RowH - 5, 10, bSelected ? Gold : Panel);
      const Size = bPicture ? 34 : 38;
      this.Txt(G.OptionLabel(Row).toUpperCase(), Left + 28, Y + 8, ECpvFont.Bold, Size, bSelected ? Ink : White);
      const bLink = !bSound && !bPicture && (Row === 4 || Row === 5);
      this.Hit(Left, Y, RowW, RowH - 3, ECpvClick.Option, Row);
      if (bLink) {
        this.Txt(G.OptionValue(Row), Left + RowW - 28, Y + 8, ECpvFont.ExtraItalic, Size, bSelected ? Ink : Gold, ECpvAlign.Right);
      } else {
        const Dec = Left + RowW - 320, Inc = Left + RowW - 48;
        const Value = G.OptionValue(Row);
        const ValueSize = FMath.Min(Size, Size * (Inc - Dec - 58) / FMath.Max(1, this.Width(Value, ECpvFont.ExtraItalic, Size)));
        this.Txt('<', Dec + 20, Y + 8, ECpvFont.Bold, Size, bSelected ? Ink : Dim, ECpvAlign.Center);
        this.Txt(Value, (Dec + Inc) * 0.5 + 18, Y + 8 + (Size - ValueSize) * 0.5, ECpvFont.ExtraItalic, ValueSize, bSelected ? Ink : Gold, ECpvAlign.Center);
        this.Txt('>', Inc + 16, Y + 8, ECpvFont.Bold, Size, bSelected ? Ink : Dim, ECpvAlign.Center);
        this.Hit(Dec - 10, Y, 57, RowH - 3, ECpvClick.Less, Row);
        this.Hit(Inc - 8, Y, 56, RowH - 3, ECpvClick.More, Row);
      }
    }
    this.DrawBack();
    if (bPicture) {
      this.Box(Right, 225, CardW, 220, Panel);
      this.Txt('PICTURE DETAIL', Right + 24, 245, ECpvFont.Bold, 30, White);
      const BW = CardW - 48;
      this.Box(Right + 24, 293, BW, 14, Dim.Mul(0.35));
      this.Box(Right + 24, 293, BW * G.DetailMeter(), 14, Gold);
      if (G.MeasuredFPS > 0) {
        this.Txt(`${G.MeasuredFPS.toFixed(0)} FPS`, Right + 24, 338, ECpvFont.ExtraItalic, 58, Gold);
        this.Txt(`${(1000 / G.MeasuredFPS).toFixed(1)} ms / frame`, Right + CardW - 24, 358, ECpvFont.Bold, 32, White, ECpvAlign.Right);
      }
      // One line per row of the picture page (see CpvOptions.ts; a browser has no VSync switch).
      const Tips = [
        'Sets render scale, detail levels and arena screen refresh together.', 'Above 100% renders extra pixels for a sharper image.',
        'Higher levels refine the shadows under fighters and ring lights.', 'Higher levels increase lighting and reflection detail.',
        'Higher levels retain finer surface detail and use more graphics memory.', 'Higher levels smooth edges on ropes and silhouettes.',
        'Adjusts the quality of effects during hits and entrances.', 'Adjusts the quality of the final camera effects.',
        'Higher rates update the arena video screens more often.', 'Limits how many frames the game renders each second.',
        'Switches between a window and full screen.',
        'Shows measured frame rate and frame time during bouts.'];
      const Tip = Tips[G.OptionIndex] ?? '';
      let TipSize = 29;
      while (TipSize > 18 && this.Width(Tip, ECpvFont.Semi, TipSize) > W - 2 * Left - 40) { TipSize -= 1; }
      this.Txt(Tip, Left, 957, ECpvFont.Semi, TipSize, White, ECpvAlign.Left, 2);
    } else if (bSound && G.OptionIndex < 6) {
      const Volume = G.OptionIndex === 0 ? G.SoundVolume : G.BusVolume[G.OptionIndex - 1];
      this.Box(Right, 225, CardW, 122, Panel);
      this.Txt(G.OptionLabel(G.OptionIndex).toUpperCase(), Right + 24, 243, ECpvFont.Bold, 32, White);
      const Segment = (CardW - 48) / 10;
      for (let i = 0; i < 10; ++i) { this.Box(Right + 24 + i * Segment, 304, Segment - 4, 17, i < Volume ? Gold : Dim.Mul(0.35)); }
    }
    this.Txt('UP / DOWN   Choose      LEFT / RIGHT   Adjust      ENTER / A   Select      ESC / B   Back', Left, 1010,
      ECpvFont.Semi, 27, White, ECpvAlign.Left, 2);
  }

  private DrawControls(X: number, Y: number, bCompact: boolean): void {
    // Action, one player, two players (left side, right side), gamepad.
    const Rows: Array<[string, string, string, string, string]> = [
      ['MOVE', 'W A S D', 'W A S D', 'ARROWS', 'LEFT STICK'],
      ['JAB (TAP FOR COMBO)', 'J', 'F', ',', 'X / SQUARE'],
      ['HEAVY HIT', 'K', 'G', '.', 'Y / TRIANGLE'],
      ['GRAB / PICK UP / THROW', 'L', 'H', '/', 'B / CIRCLE'],
      ['BLOCK (HOLD)', 'I', 'R', 'M', 'RB'],
      ['DODGE', 'SPACE', 'SPACE', 'N', 'A / CROSS'],
      ['RUN (HOLD)', 'L SHIFT', 'L SHIFT', 'R SHIFT', 'RT'],
      ['SIGNATURE / CURTAIN CALL', 'U', 'T', 'L', 'LB'],
      ['TAUNT', 'O', 'Y', ';', 'BACK'],
    ];
    const RowH = bCompact ? 40 : 50;
    const Pt = bCompact ? 26 : 32;
    const C1 = X + 470, C2 = X + 680, C3 = X + 890, C4 = X + 1100;
    this.Txt('ONE PLAYER', C1, Y, ECpvFont.Bold, Pt * 0.8, Gold, ECpvAlign.Center);
    this.Txt('2P: LEFT', C2, Y, ECpvFont.Bold, Pt * 0.8, Gold, ECpvAlign.Center);
    this.Txt('2P: RIGHT', C3, Y, ECpvFont.Bold, Pt * 0.8, Gold, ECpvAlign.Center);
    this.Txt('GAMEPAD', C4, Y, ECpvFont.Bold, Pt * 0.8, Gold, ECpvAlign.Center);
    for (let i = 0; i < Rows.length; ++i) {
      const RY = Y + 44 + i * RowH;
      if (i % 2 === 0) { this.Box(X - 16, RY - 4, 1260, RowH, new FLinearColor(1, 1, 1, 0.05)); }
      this.Txt(Rows[i][0], X, RY, ECpvFont.Semi, Pt, White);
      this.Txt(Rows[i][1], C1, RY, ECpvFont.Bold, Pt, White, ECpvAlign.Center);
      this.Txt(Rows[i][2], C2, RY, ECpvFont.Bold, Pt, Dim, ECpvAlign.Center);
      this.Txt(Rows[i][3], C3, RY, ECpvFont.Bold, Pt, Dim, ECpvAlign.Center);
      this.Txt(Rows[i][4], C4, RY, ECpvFont.Bold, Pt, Dim, ECpvAlign.Center);
    }
  }

  private DrawHowTo(): void {
    const W = this.W, H = this.H;
    this.Box(0, 0, W, H, new FLinearColor(0, 0, 0.03, 0.84));
    this.Out('RING SCHOOL', 110, 50, ECpvFont.Title, 84, Gold, Ink, 5);
    this.DrawControls(126, 190, false);
    this.DrawBack();
    this.Hit(110, 993, 790, 78, ECpvClick.Accept);
    const Tips = [
      'Strikes beat grabs. Grabs beat guards. Block just before impact for extra ratings and a counter opening.',
      'In a grab:  JAB = headbutt,  HEAVY = body slam,  GRAB + direction = whip them into the ropes.',
      'Run into the ropes to bounce off them; attacks out of a bounce hit harder.',
      'Hits and taunts fill your RATINGS bar. When it is full, unleash your signature move.',
      'In exhibition, GRAB a grounded rival to pin. The defender taps JAB in the gold to kick out.',
      'Win the deciding round by knockout and your rival is left reeling: get close and press SIGNATURE for a CURTAIN CALL.',
    ];
    for (let i = 0; i < Tips.length; ++i) {
      this.Box(126, 728 + i * 46 + 12, 10, 10, Gold);
      this.Txt(Tips[i], 152, 728 + i * 46, ECpvFont.Medium, 28, White);
    }
    this.Txt('ENTER / A   Rehearse in the ring', 126, 1008, ECpvFont.Bold, 33, Gold);
    this.Txt('ESC / B   Back', W - 120, 1010, ECpvFont.Medium, 24, Dim, ECpvAlign.Right, 0, 20);
  }

  private DrawCredits(): void {
    const W = this.W, H = this.H;
    this.Box(0, 0, W, H, new FLinearColor(0.012, 0.014, 0.035, 0.94));
    const X = W * 0.5 - 736;
    this.Txt('CLAY-PER-VIEW', X, 66, ECpvFont.Bold, 30, Gold, ECpvAlign.Left, 0, 70);
    this.Out('END CREDITS', X, 118, ECpvFont.Title, 86, White, Ink, 4);
    this.DrawBack();
    this.Hit(X, 983, 600, 74, ECpvClick.Back);
    const Roles = ['PLAY-BY-PLAY', 'COLOUR COMMENTARY', 'RING OFFICIAL'];
    const Ids = ['Dirk', 'Nigel', 'Ref'];
    const Names = ['DIRK', 'NIGEL', 'THE REFEREE'];
    for (let i = 0; i < 3; ++i) {
      const Left = X + i * 492;
      this.Box(Left, 291, 464, 185, new FLinearColor(0.06, 0.07, 0.11));
      this.Pic(this.Portrait(Ids[i]), Left + 6, 295, 177, 177);
      this.Txt(Roles[i], Left + 184, 338, ECpvFont.Bold, 22, Gold);
      this.Txt(Names[i], Left + 184, 381, ECpvFont.ExtraItalic, 39, White);
    }
    const Labels = ['ART & ANIMATION', 'SOUND', 'GAME & TOOLS', 'TYPEFACES'];
    // The third line also names the library this browser edition draws with.
    const Details = ['Original Blender sculpts, procedural clay surfaces and pose-to-pose animation.',
      'Original synthesized score and effects. Voices generated with Kokoro-82M.',
      'Built in Unreal Engine and three.js. AI-assisted code, scripts and writing.',
      'Titan One, Anton, Bangers and Barlow Condensed. SIL Open Font License 1.1.'];
    for (let i = 0; i < 4; ++i) {
      const Y = 555 + i * 89;
      this.Box(X, Y, 1470, 2, new FLinearColor(0.13, 0.15, 0.19));
      this.Txt(Labels[i], X, Y + 20, ECpvFont.Bold, 28, Gold);
      this.Txt(Details[i], X + 308, Y + 18, ECpvFont.Semi, 29, White);
    }
    this.Txt('ENTER / A   Return to menu', X, 996, ECpvFont.Bold, 30, White);
  }

  private DrawSelect(): void {
    const G = this.G, W = this.W, H = this.H, S = this.S;
    this.Shade(0, 300, 0.8, 0);
    this.Shade(600, H, 0, 0.9);
    this.Out(G.IsRun() ? 'CAST YOUR HEADLINER' : 'CHOOSE YOUR CELEBRITY', W * 0.5, 34, ECpvFont.Title, 70, Gold, Ink, 4, ECpvAlign.Center);
    const Roster = CpvData.Roster();
    if (G.IsRun()) {
      const CardW = 382;
      for (let Stage = 0; Stage < 3; ++Stage) {
        const X = W * 0.5 - 1.5 * CardW + Stage * CardW;
        const Rival = Roster[G.RivalForEpisode(Stage)];
        this.Slant(X, 140, CardW - 8, 74, 10, Panel);
        this.Pic(this.Portrait(Rival.Id), X + 6, 142, 68, 68);
        this.Txt(`BOUT ${Stage + 1}`, X + 86, 149, ECpvFont.Bold, 20, Gold);
        this.Txt(Rival.Name, X + 86, 180, ECpvFont.Bold, 23, White);
      }
    }
    this.DrawBack();
    const Cell = 148, Gap = 12;
    const GridW = 4 * Cell + 3 * Gap;
    const GX = W * 0.5 - GridW * 0.5, GY = 716;
    for (let i = 0; i < Roster.length; ++i) {
      const X = GX + (i % 4) * (Cell + Gap), Y = GY + Math.floor(i / 4) * (Cell + Gap);
      this.Hit(X, Y, Cell, Cell, ECpvClick.Roster, i);
      this.Box(X, Y, Cell, Cell, new FLinearColor(0.03, 0.035, 0.07, 0.95));
      this.Box(X, Y + Cell - 34, Cell, 34, Fade(Roster[i].Colour, 0.85));
      this.Pic(this.Portrait(Roster[i].Id), X + 4, Y + 2, Cell - 8, Cell - 8);
      if (G.IsRun() && G.IsChampion(i)) {
        this.Box(X, Y + Cell - 28, Cell, 28, Gold);
        this.Txt(G.BestShow[G.Difficulty][i] > 0 ? `CHAMP   ${G.BestShow[G.Difficulty][i]}/9` : 'CHAMPION', X + Cell * 0.5, Y + Cell - 28, ECpvFont.Bold, 22, Ink, ECpvAlign.Center);
      }
      for (let Slot = 0; Slot < 2; ++Slot) {
        if (G.Cursor[Slot] !== i) { continue; }
        const C = SlotColour(Slot);
        const Inset = Slot === 0 ? 0 : 7;
        const Blink = G.bLocked[Slot] ? 1 : 0.55 + 0.45 * Pulse(G.RealTime, 9);
        CpvUi.Frame(this.Canvas, (X - 6 + Inset) * S, (Y - 6 + Inset) * S, (Cell + 12 - Inset * 2) * S, (Cell + 12 - Inset * 2) * S, Fade(C, Blink), 7 * S);
        const Tag = Slot === 0 ? 'P1' : (G.Mode === ECpvMode.TwoPlayer ? 'P2' : 'CPU');
        const TX = Slot === 0 ? X - 6 : X + Cell - 58;
        this.Box(TX, Y - 34, 64, 30, C);
        this.Txt(Tag, TX + 32, Y - 35, ECpvFont.Bold, 26, White, ECpvAlign.Center);
      }
    }
    for (let Slot = 0; Slot < 2; ++Slot) {
      const D = Roster[G.Cursor[Slot]];
      const bRight = Slot === 1;
      const PX = bRight ? W - 560 : 60;
      const Al = bRight ? ECpvAlign.Right : ECpvAlign.Left;
      const TX = bRight ? W - 80 : 80;
      this.Slant(PX, 716, 500, 304, bRight ? -18 : 18, Panel);
      this.Box(bRight ? W - 72 : 60, 716, 12, 304, SlotColour(Slot));
      this.Out(D.Name, TX, 722, ECpvFont.ExtraItalic, this.Width(D.Name, ECpvFont.ExtraItalic, 60) > 450 ? 46 : 60, White, Ink, 3, Al);
      this.Txt(D.Title, TX, 790, ECpvFont.Semi, 27, Gold, Al);
      this.Txt(D.Quote, TX, 826, ECpvFont.Medium, 23, Dim, Al);
      const StatNames = ['POWER', 'SPEED', 'GUTS'];
      const Stats = [D.Power, D.Speed, D.Guts];
      for (let k = 0; k < 3; ++k) {
        const SY = 868 + k * 30;
        this.Txt(StatNames[k], bRight ? W - 80 : 80, SY, ECpvFont.Bold, 22, White, Al);
        for (let Pip = 0; Pip < 5; ++Pip) {
          const BX = bRight ? W - 190 - Pip * 34 - 28 : 190 + Pip * 34;
          this.Slant(BX, SY + 5, 28, 17, 5, Pip < Stats[k] ? D.Colour : new FLinearColor(1, 1, 1, 0.14));
        }
      }
      this.Txt(`SIGNATURE: ${D.SpecialName}`, TX, 962, ECpvFont.Bold, 23, Gold, Al);
      this.Txt(`CURTAIN CALL: ${D.FinisherName}`, TX, 988, ECpvFont.Bold, 23, new FLinearColor(1, 0.45, 0.4), Al);
      if (G.bLocked[Slot]) { this.Out('LOCKED IN', bRight ? W - 310 : 310, 660, ECpvFont.ExtraItalic, 40, Gold, Ink, 3, ECpvAlign.Center); }
    }
    const bWatch = G.Mode === ECpvMode.Watch;
    const Hint = G.Mode === ECpvMode.TwoPlayer ? 'P1: W A S D + F          P2: ARROWS + ,          ESC  back'
      : (G.bLocked[0] && G.bLocked[1]) ? 'Places, everyone...          ESC  back'
      : G.bLocked[0] ? (bWatch ? 'Now pick their rival          ENTER  lock in          ESC  back' : 'Now pick your opponent          ENTER  lock in          ESC  back')
      : (bWatch ? 'W A S D  choose the first star          ENTER  lock in          ESC  back' : 'W A S D  choose your star          ENTER  lock in          ESC  back');
    this.Txt(G.IsRun() ? 'W A S D or D-pad   Cast your star       ENTER / A   Start the run       ESC / B   Back' : Hint, W * 0.5, 1040, ECpvFont.Medium, 24, Dim, ECpvAlign.Center, 0, 20);
  }

  private DrawVersus(): void {
    const G = this.G, W = this.W, H = this.H;
    const T = G.PhaseTime;
    const In = FMath.Clamp(T / 0.35, 0, 1);
    const Slide = (1 - In * In * (3 - 2 * In)) * 900;
    const A = G.Fighters[0].Def();
    const B = G.Fighters[1].Def();
    this.Box(0, 0, W, H, new FLinearColor(0, 0, 0.02, 0.72));
    this.Slant(-80 - Slide, 240, W * 0.5 + 60, 520, 110, Fade(A.Colour, 0.92));
    this.Slant(W * 0.5 - 80 + Slide, 320, W * 0.5 + 160, 520, 110, Fade(B.Colour, 0.92));
    this.Pic(this.Portrait(A.Id), 140 - Slide, 250, 520, 520);
    this.Pic(this.Portrait(B.Id), W - 660 + Slide, 330, 520, 520, G.IsMirror() ? ACpvGameMode.TwinTint() : White, true);
    this.Out(A.Name, 120 - Slide, 772, ECpvFont.ExtraItalic, 78, White, Ink, 5);
    this.Out(B.Name, W - 120 + Slide, 860, ECpvFont.ExtraItalic, 78, White, Ink, 5, ECpvAlign.Right);
    this.Txt(A.Title, 124 - Slide, 860, ECpvFont.Semi, 32, Gold, ECpvAlign.Left, 2);
    this.Txt(B.Title, W - 124 + Slide, 948, ECpvFont.Semi, 32, Gold, ECpvAlign.Right, 2);
    const Pop = T < 0.5 ? 0 : FMath.Min(1, (T - 0.5) / 0.15);
    if (Pop > 0) {
      this.Out('VS', W * 0.5, 400 - 30 * (1 - Pop), ECpvFont.Title, 210 * (0.7 + 0.3 * Pop), Gold, Ink, 9, ECpvAlign.Center);
    }
    if (G.IsRun()) {
      this.Txt(`RATINGS RUN   /   BOUT ${G.Episode + 1} OF 3`, W * 0.5, 42, ECpvFont.Bold, 31, Gold, ECpvAlign.Center, 1, 80);
      this.Out(G.EpisodeName(), W * 0.5, 93, ECpvFont.Title, 70, White, Ink, 4, ECpvAlign.Center);
      this.Txt(G.EpisodeRule(), W * 0.5, 187, ECpvFont.Semi, 32, White, ECpvAlign.Center, 2);
    } else {
      this.DrawLogo(W * 0.5, 40, 70);
      this.Txt(G.bPins ? 'PINFALL OR KNOCKOUT' : 'KNOCKOUT RULES', W * 0.5, 180, ECpvFont.Bold, 30, White, ECpvAlign.Center, 2, 36);
    }
  }

  private DrawFighterBar(F: ACpvFighter, bRight: boolean): void {
    const G = this.G, W = this.W, S = this.S;
    const D = F.Def();
    const Edge = bRight ? W - 40 : 40;
    const BarW = FMath.Min(760, W * 0.5 - 150);
    // Portrait tile.
    const PX = bRight ? Edge - 118 : Edge;
    this.Box(PX, 30, 118, 118, Ink);
    this.Box(PX, 30, 118, 118, Fade(D.Colour, 0.55));
    this.Pic(this.Portrait(D.Id), PX + 2, 30, 114, 114, bRight && G.IsMirror() ? ACpvGameMode.TwinTint() : White, bRight);
    CpvUi.Frame(this.Canvas, PX * S, 30 * S, 118 * S, 118 * S, SlotColour(F.Slot), 5 * S);
    // Health: a slanted bar that empties toward the outside edge, with a white flash trailing the damage.
    const X0 = bRight ? Edge - 132 - BarW : Edge + 132;
    const Skew = bRight ? -16 : 16;
    this.Slant(X0 - 5, 37, BarW + 10, 50, Skew, Ink);
    this.Slant(X0, 42, BarW, 40, Skew, new FLinearColor(0.16, 0.02, 0.02));
    const Frac = FMath.Clamp(F.Health / CpvRule.MaxHealth, 0, 1);
    const Trail = FMath.Clamp(F.ShownHealth / CpvRule.MaxHealth, 0, 1);
    const Life = Frac > 0.5 ? new FLinearColor(0.35, 0.85, 0.2) : (Frac > 0.25 ? Gold : new FLinearColor(1, 0.22, 0.12));
    if (bRight) {
      this.Slant(X0, 42, BarW * Trail, 40, Skew, new FLinearColor(1, 1, 1, 0.9));
      this.Slant(X0, 42, BarW * Frac, 40, Skew, Life);
    } else {
      this.Slant(X0 + BarW * (1 - Trail), 42, BarW * Trail, 40, Skew, new FLinearColor(1, 1, 1, 0.9));
      this.Slant(X0 + BarW * (1 - Frac), 42, BarW * Frac, 40, Skew, Life);
    }
    this.Out(D.Name, bRight ? X0 + BarW - 8 : X0 + 8, 86, ECpvFont.ExtraItalic, 34, White, Ink, 2.5, bRight ? ECpvAlign.Right : ECpvAlign.Left);
    // Ratings (signature meter).
    const MW = BarW * 0.56;
    const MX = bRight ? X0 + BarW - MW : X0;
    const Hype = F.Hype / CpvRule.MaxHype;
    const bFull = F.HasFullHype();
    this.Slant(MX - 4, 128, MW + 8, 22, Skew * 0.4, Ink);
    const Meter = bFull ? FMath.Lerp(Gold, White, Pulse(G.RealTime, 12)) : D.Colour;
    if (bRight) { this.Slant(MX + MW * (1 - Hype), 131, MW * Hype, 16, Skew * 0.4, Meter); }
    else { this.Slant(MX, 131, MW * Hype, 16, Skew * 0.4, Meter); }
    this.Txt(bFull ? 'SIGNATURE READY' : 'RATINGS', bRight ? MX - 12 : MX + MW + 12, 124, ECpvFont.Bold, 22, bFull ? Gold : Dim, bRight ? ECpvAlign.Right : ECpvAlign.Left, 2);
    // Round wins.
    for (let i = 0; i < G.RequiredWins(); ++i) {
      const SX = bRight ? X0 - 6 + i * 34 : X0 + BarW - 22 - i * 34;
      this.Slant(SX, 92, 26, 26, 0, Ink);
      this.Slant(SX + 4, 96, 18, 18, 0, i < G.Wins[F.Slot] ? Gold : new FLinearColor(1, 1, 1, 0.16));
    }
    // Weapon in hand, combo counter, move call-outs.
    let InfoY = 160;
    if (F.Weapon !== ECpvWeapon.None) {
      this.Txt(`${CpvData.Weapon(F.Weapon).Name}  x${F.WeaponUses}`, Edge, InfoY, ECpvFont.Bold, 26, Gold, bRight ? ECpvAlign.Right : ECpvAlign.Left, 2);
      InfoY += 32;
    }
    if (F.Combo >= 2) {
      this.Out(`${F.Combo} HITS!`, Edge, InfoY, ECpvFont.ExtraItalic, 52 + FMath.Min(F.Combo, 8) * 3, Gold, Ink, 3, bRight ? ECpvAlign.Right : ECpvAlign.Left);
      InfoY += 70;
    }
    if (G.MoveCalloutLeft[F.Slot] > 0 && G.MoveCallout[F.Slot] !== '') {
      const A = FMath.Min(1, G.MoveCalloutLeft[F.Slot] / 0.3);
      this.Out(G.MoveCallout[F.Slot], Edge, InfoY, ECpvFont.ExtraItalic, 46, Fade(White, A), Fade(D.Colour, A), 3, bRight ? ECpvAlign.Right : ECpvAlign.Left);
    }
  }

  private DrawFight(): void {
    const G = this.G, W = this.W, H = this.H;
    this.DrawFighterBar(G.Fighters[0], false);
    this.DrawFighterBar(G.Fighters[1], true);
    if (G.IsRehearsing()) {
      const Titles = ['LAND A JAB', 'CATCH THE PUNCH', 'BODY SLAM', 'HIT YOUR SIGNATURE', "YOU'RE READY FOR AIR"];
      const Inputs = ['Walk in with WASD or the stick. Tap J / X to jab.', 'Face your partner. Hold I / RB until you block the jab.',
        'Up close, tap L / B to grab. Then tap K / Y to slam.', 'Your ratings are full. Tap U / LB to fire your signature.',
        'ENTER / A   Cast your headliner for the Ratings Run'];
      const Cue = G.Lesson;
      if (Cue === 4) { this.Hit(W * 0.5 - 495, H - 196, 990, 152, ECpvClick.Accept); }
      const X = W * 0.5 - 495;
      const Y = H - 196;
      this.Slant(X, Y, 990, 152, 8, Panel);
      this.Box(X + 6, Y + 5, 7, 142, Gold);
      this.Txt(Cue === 4 ? 'RING SCHOOL   /   WRAP' : `RING SCHOOL   /   CUE ${Cue + 1} OF 4`, X + 36, Y + 9, ECpvFont.Bold, 23, Gold);
      this.Txt(G.CueHold > 0 ? 'GOT IT!' : Titles[Cue], X + 36, Y + 38, ECpvFont.ExtraItalic, 45, White);
      this.Txt(Inputs[Cue], X + 36, Y + 102, ECpvFont.Semi, 29, White);
      return;
    }
    // Clock.
    const Clock = (G.IsRun() || G.RoundSeconds > 0) ? `${FMath.CeilToInt(G.RoundClock)}` : '--';
    this.Slant(W * 0.5 - 62, 28, 124, 84, 0, Ink);
    this.Slant(W * 0.5 - 56, 34, 112, 72, 0, G.RoundClock < 10 && (G.IsRun() || G.RoundSeconds > 0) ? Red : new FLinearColor(0.07, 0.08, 0.14));
    this.Txt(Clock, W * 0.5, 30, ECpvFont.Impact, 62, White, ECpvAlign.Center);
    this.Txt(`TAKE ${G.Round}`, W * 0.5, 114, ECpvFont.Bold, 22, Gold, ECpvAlign.Center, 2, 40);

    if (G.IsRun() && G.FinisherPrompt <= 0) {
      const Request = G.bCrowdCall ? 'CROWD CALL   /   COMPLETE' : `CROWD CALL   /   ${G.CrowdCall()}`;
      const BW = this.Width(Request, ECpvFont.Bold, 24) + 46;
      this.Slant(42, H - 70, BW, 41, 8, Panel);
      this.Txt(Request, 63, H - 66, ECpvFont.Bold, 24, G.bCrowdCall ? Gold : White);
    }
    if (G.PinSlot >= 0) { this.DrawCover(); return; }
    if (G.Phase === ECpvPhase.Fight && !G.IsRun()) {
      for (let Slot = 0; Slot < 2; ++Slot) {
        if (!G.IsHuman(Slot) || !G.CanCover(G.Fighters[Slot])) { continue; }
        const Button = G.Mode === ECpvMode.TwoPlayer ? (Slot === 0 ? 'H / B' : '/  or  B') : 'L / B';
        const X = Slot === 0 ? 56 : W - 386;
        this.Slant(X, 296, 332, 47, 8, Panel);
        this.Txt(`PIN   ${Button}`, X + 19, 300, ECpvFont.Bold, 30, Gold);
      }
    }
    // Curtain Call prompt.
    if (G.FinisherPrompt > 0 && G.FinisherFor >= 0 && G.Phase === ECpvPhase.Fight) {
      const P = Pulse(G.RealTime, 10);
      const D = G.Fighters[G.FinisherFor].Def();
      this.Out('CURTAIN CALL!', W * 0.5, 770, ECpvFont.Title, 96 + 8 * P, FMath.Lerp(Gold, White, P), Red, 6, ECpvAlign.Center);
      const bHuman = G.IsHuman(G.FinisherFor);
      const How = bHuman ? `GET CLOSE AND PRESS SIGNATURE:  ${D.FinisherName}` : `${D.Name} IS LINING UP:  ${D.FinisherName}`;
      this.Slant(W * 0.5 - 430, 892, 860, 48, 14, Panel);
      this.Txt(How, W * 0.5, 898, ECpvFont.Bold, 30, White, ECpvAlign.Center);
      const Left = FMath.Clamp(G.FinisherPrompt / CpvRule.DazedTime, 0, 1);
      this.Slant(W * 0.5 - 300, 948, 600, 14, 5, Ink);
      this.Slant(W * 0.5 - 300, 948, 600 * Left, 14, 5, Gold);
    }
    // The optional meter occupies the station badge so it never covers either combo counter.
    if (G.bPerformanceHud && G.MeasuredFPS > 0) {
      this.Slant(W - 280, H - 70, 240, 40, 10, Panel);
      this.Txt(`${G.MeasuredFPS.toFixed(0)} FPS  /  ${(1000 / G.MeasuredFPS).toFixed(1)} MS`, W - 53, H - 65, ECpvFont.Bold, 25, White, ECpvAlign.Right);
      return;
    }
    this.Slant(W - 232, H - 70, 192, 40, 10, Fade(Ink, 0.75));
    this.Box(W - 214, H - 57, 14, 14, FMath.Lerp(Red, White, 0.2 * Pulse(G.RealTime, 3)));
    this.Txt('CPV  LIVE', W - 190, H - 68, ECpvFont.Bold, 26, White, ECpvAlign.Left, 0, 40);
  }

  private DrawCover(): void {
    const G = this.G, W = this.W, H = this.H;
    const Defender = 1 - G.PinSlot;
    const X = W * 0.5 - 380, Y = H - 268;
    this.Slant(X, Y, 760, 212, 8, Panel);
    const Header = `${G.Fighters[G.PinSlot].Def().Name}   /   COVER`;
    this.Txt(Header, X + 39, Y + 12, ECpvFont.Bold, 27, Gold);
    for (let i = 0; i < 3; ++i) {
      this.Box(X + 585 + i * 44, Y + 16, 36, 36, i < G.PinCount ? Gold : Ink);
      this.Txt(`${i + 1}`, X + 603 + i * 44, Y + 15, ECpvFont.Bold, 27, i < G.PinCount ? Ink : Dim, ECpvAlign.Center);
    }
    if (G.PinCount === 3) {
      this.Txt("THREE!  THAT'S THE FALL.", X + 39, Y + 72, ECpvFont.ExtraItalic, 51, Gold);
      return;
    }
    const Key = G.Mode === ECpvMode.TwoPlayer ? (Defender === 0 ? 'F / X' : 'COMMA / X') : 'J / X';
    const Prompt = !G.IsHuman(Defender) ? `${G.Fighters[Defender].Def().Name} IS UNDER THE COUNT`
      : G.bPinMiss ? 'MISSED   /   TRY ON THE NEXT COUNT' : `P${Defender + 1}   TAP ${Key} IN THE GOLD TO KICK OUT`;
    const PromptSize = FMath.Min(34, 34 * 683 / FMath.Max(1, this.Width(Prompt, ECpvFont.Bold, 34)));
    this.Txt(Prompt, X + 38, Y + 67, ECpvFont.Bold, PromptSize, White);
    const Track = 680, Left = X + 39, Top = Y + 142;
    this.Box(Left, Top, Track, 28, new FLinearColor(0.16, 0.18, 0.24));
    this.Box(Left + Track * G.EscapeStart(), Top, Track * (G.EscapeEnd() - G.EscapeStart()), 28, Gold);
    const Mark = Left + Track * G.EscapeNeedle();
    this.Box(Mark - 6, Top - 8, 12, 44, Ink);
    this.Box(Mark - 2.5, Top - 6, 5, 40, White);
  }

  private DrawBanner(): void {
    const G = this.G, W = this.W, H = this.H;
    const B = G.Banner;
    if (B.Life <= 0 || B.Text === '') { return; }
    if (G.Phase === ECpvPhase.MatchEnd) {
      if (!G.Fighters[G.Winner]) { return; }   // a bout always ends with a winner; this only keeps a stray -1 from stopping the show
      const bTitle = G.IsRun() && G.Episode === 2 && G.Winner === 0;
      const Name = G.Fighters[G.Winner].Def().Name;
      const Label = bTitle ? 'PRIME-TIME CHAMPION' : G.bWonByPin ? 'WINNER   /   PINFALL' : "WINNER   /   THAT'S A WRAP";
      const X = 64, Y = H - 300;
      const WidthName = FMath.Max(440, this.Width(Name, ECpvFont.ExtraItalic, 68) + 86);
      this.Slant(X, Y, WidthName, 126, 14, Panel);
      this.Box(X + 12, Y + 12, 6, 102, Gold);
      this.Txt(Label, X + 35, Y + 10, ECpvFont.Bold, 25, Gold, ECpvAlign.Left, 0, 45);
      this.Txt(Name, X + 32, Y + 38, ECpvFont.ExtraItalic, 68, White);
      return;
    }
    const U = B.Age / B.Life;
    const In = FMath.Clamp(B.Age / 0.14, 0, 1);
    const OutA = U > 0.85 ? (1 - U) / 0.15 : 1;
    const Scale = B.Scale * (In < 1 ? FMath.Lerp(1.7, 1, In) : 1 + 0.03 * FMath.Sin(B.Age * 9));
    const Size = 150 * Scale;
    let Fit = Size;
    while (Fit > 40 && this.Width(B.Text, ECpvFont.Title, Fit) > W - 160) { Fit -= 6; }
    const bSmall = B.Scale < 0.7;
    const Y = bSmall ? 236 : 390 - Fit * 0.5;
    const TW = this.Width(B.Text, ECpvFont.Title, Fit);
    this.Slant(W * 0.5 - TW * 0.5 - 60, Y + Fit * 0.18, TW + 120, Fit * 0.95, 30, Fade(Ink, 0.72 * OutA));
    this.Out(B.Text, W * 0.5, Y, ECpvFont.Title, Fit, Fade(B.Colour, OutA), Fade(Ink, OutA), Fit * 0.055, ECpvAlign.Center);
    if (B.Sub !== '') {
      this.Out(B.Sub, W * 0.5, Y + Fit * 1.2, ECpvFont.ExtraItalic, FMath.Max(30, Fit * 0.34), Fade(White, OutA), Fade(Ink, OutA), 3, ECpvAlign.Center, 40);
    }
  }

  private DrawSubtitle(): void {
    const G = this.G, W = this.W, H = this.H;
    const Sub = G.Subtitle;
    if (Sub.Left <= 0 || Sub.Text === '' || G.Phase === ECpvPhase.Select || G.Phase === ECpvPhase.Results) { return; }
    const Words = G.bPortugueseSubtitles && Sub.Portuguese !== '' ? Sub.Portuguese : Sub.Text;
    const A = FMath.Min(1, Sub.Left / 0.25);
    const bAnnouncer = Sub.Speaker === INDEX_NONE;
    let Who = bAnnouncer ? (G.IsRehearsing() ? 'RING COACH' : 'RING ANNOUNCER') : (Sub.Speaker === 0 ? 'DIRK BLUSTER' : 'NIGEL QUIBBLE');
    if (bAnnouncer && G.bPortugueseSubtitles) { Who = G.IsRehearsing() ? 'TREINADOR' : 'LOCUTOR'; }
    const Tag = bAnnouncer ? new FLinearColor(0.48, 0.8, 0.85) : (Sub.Speaker === 0 ? new FLinearColor(0.79, 0.58, 0.17) : new FLinearColor(0.49, 0.47, 0.41));
    let Size = 34;
    while (Size > 22 && this.Width(Words, ECpvFont.Semi, Size) > W - 520) { Size -= 2; }
    const TW = this.Width(Words, ECpvFont.Semi, Size);
    const X = W * 0.5 - TW * 0.5;
    let Y = H - (G.Letterbox > 0.5 ? 80 : 102);
    if (G.IsRehearsing() || G.FinisherPrompt > 0) { Y = H - 264; }
    if (G.PinSlot >= 0) { Y = H - 355; }
    this.Slant(X - 30, Y, TW + 60, 52, 12, Fade(Panel, A));
    this.Slant(X - 30, Y - 30, this.Width(Who, ECpvFont.Bold, 22, 30) + 36, 30, 8, Fade(Tag, A));
    this.Txt(Who, X - 14, Y - 29, ECpvFont.Bold, 22, Fade(Ink, A), ECpvAlign.Left, 0, 30);
    this.Txt(Words, X, Y + 6 + (34 - Size) * 0.5, ECpvFont.Semi, Size, Fade(White, A));
  }

  private DrawNameCard(): void {
    const G = this.G, W = this.W;
    if (G.NameCard === '') { return; }
    const In = FMath.Clamp(G.NameCardAge / 0.3, 0, 1);
    const X = 110 - (1 - In * In * (3 - 2 * In)) * 900;
    const NW = FMath.Max(this.Width(G.NameCard, ECpvFont.ExtraItalic, 84), this.Width(G.NameCardSub, ECpvFont.Semi, 34)) + 90;
    this.Slant(X - 30, 800, NW, 96, 26, Gold);
    this.Slant(X - 44, 800, 12, 96, 26, Red);
    this.Slant(X - 54, 896, NW - 20, 52, 14, Panel);
    this.Txt(G.NameCard, X + 10, 800, ECpvFont.ExtraItalic, 84, Ink);
    this.Txt(G.NameCardSub, X - 16, 902, ECpvFont.Semi, 34, White);
    this.Txt('ENTER  skip', W - 110, 1010, ECpvFont.Medium, 24, Dim, ECpvAlign.Right, 2, 20);
  }

  private DrawResults(): void {
    const G = this.G, W = this.W, H = this.H;
    this.Box(0, 0, W, H, new FLinearColor(0, 0, 0.03, 0.62));
    const Wn = FMath.Max(G.Winner, 0);
    const D = G.Fighters[Wn].Def();
    const bTitle = G.IsRun() && G.Episode === 2 && Wn === 0;
    const Headline = !G.IsRun() ? "THAT'S A WRAP!" : bTitle ? 'PRIME-TIME CHAMPION!' : Wn === 0 ? 'RENEWED!' : 'OFF THE AIR!';
    this.Out(Headline, W * 0.5, 40, ECpvFont.Title, 104, Gold, Ink, 5, ECpvAlign.Center);
    this.Slant(W * 0.5 - 430, 196, 860, 70, 20, D.Colour);
    this.Out((G.bWonByPin ? 'WIN BY PINFALL   ' : 'WINNER   ') + D.Name, W * 0.5, 198, ECpvFont.ExtraItalic, 58, White, Ink, 3, ECpvAlign.Center);

    const TX = W * 0.5 - 480;
    this.Slant(TX, 300, 960, 330, 24, Panel);
    const Rows = ['DAMAGE DEALT', 'HITS LANDED', 'BEST COMBO', 'TAUNTS'];
    for (let Slot = 0; Slot < 2; ++Slot) {
      const F = G.Fighters[Slot];
      const CX = Slot === 0 ? TX + 250 : TX + 730;
      this.Pic(this.Portrait(F.Def().Id), CX - 46, 306, 92, 92, Slot === 1 && G.IsMirror() ? ACpvGameMode.TwinTint() : White, Slot === 1);
      this.Txt(F.Def().Name, CX, 392, ECpvFont.Bold, 26, Slot === Wn ? Gold : Dim, ECpvAlign.Center);
      const Vals = [`${FMath.RoundToInt(F.DamageDealt)}`, `${F.HitsLanded}`, `${F.BestCombo}`, `${F.Taunts}`];
      for (let r = 0; r < 4; ++r) { this.Txt(Vals[r], CX, 436 + r * 46, ECpvFont.Impact, 38, White, ECpvAlign.Center); }
    }
    for (let r = 0; r < 4; ++r) { this.Txt(Rows[r], W * 0.5, 444 + r * 46, ECpvFont.Semi, 26, Dim, ECpvAlign.Center, 0, 30); }

    if (G.IsRun()) {
      const Record = bTitle ? `CHAMPIONS BOARD     PERSONAL BEST   ${G.BestShow[G.Difficulty][G.Cursor[0]]} / 9`
        : Wn === 0 ? `NEXT ON AIR     ${CpvData.Fighter(G.RivalForEpisode(G.Episode + 1)).Name}`
        : `RETAKE AVAILABLE     BOUT ${G.Episode + 1} OF 3`;
      const Score = `SHOW STARS   ${G.SeasonStars()} / 9      |      BOUT WIN  ${Wn === 0 ? 1 : 0}     HALF HEALTH  ${Wn === 0 && G.Fighters[0].Health >= 50 ? 1 : 0}     CROWD CALL  ${Wn === 0 && G.bCrowdCall ? 1 : 0}`;
      this.Txt(Score, W * 0.5, 635, ECpvFont.Bold, 28, White, ECpvAlign.Center, 2);
      this.Txt(Record, W * 0.5, 679, ECpvFont.Bold, 27, Gold, ECpvAlign.Center, 2);
    }
    const First = !G.IsRun() ? 'REMATCH' : bTitle ? 'DEFEND YOUR TITLE' : Wn === 0 ? 'NEXT BOUT' : 'RETRY THIS BOUT';
    const Count = G.HasReplay() ? 4 : 3;
    const Items = [First, G.IsRun() ? 'RECAST THE SHOW' : 'NEW FIGHTERS', Count === 4 ? 'INSTANT REPLAY' : 'MAIN MENU', 'MAIN MENU'];
    for (let i = 0; i < Count; ++i) {
      const Y = (G.IsRun() ? 734 : 680) + i * 73;
      this.Hit(W * 0.5 - 308, Y - 4, 616, 65, ECpvClick.Result, i);
      const bOn = i === G.ResultIndex;
      if (bOn) { this.Slant(W * 0.5 - 300, Y - 4, 600, 59, 22, Gold); }
      this.Txt(Items[i], W * 0.5, Y + 4, ECpvFont.ExtraItalic, 45, bOn ? Ink : White, ECpvAlign.Center, bOn ? 0 : 3, 20);
    }
  }

  /** The instant-replay screen (CpvReplay.cpp). */
  private DrawReplay(): void {
    const G = this.G, W = this.W, H = this.H, S = this.S;
    const ReplayGold = new FLinearColor(1, 0.8, 0.14), ReplayPanel = new FLinearColor(0.012, 0.014, 0.035);
    this.Box(0, 0, W, H, ReplayPanel);
    const FilmW = FMath.Min(W - 96, (H - 176) * 16 / 9);
    const FilmH = FilmW * 9 / 16, X = (W - FilmW) * 0.5, Y = (H - FilmH) * 0.5;
    // The taped frame is a texture on the graphics card, not a 2D image: the 3D canvas underneath draws it,
    // and this canvas leaves a window for it.
    const Frame = G.ReplayPicture();
    if (Frame && GRenderer) {
      const X0 = Math.round(X * S), Y0 = Math.round(Y * S), X1 = Math.round((X + FilmW) * S), Y1 = Math.round((Y + FilmH) * S);
      this.Canvas.clearRect(X0, Y0, X1 - X0, Y1 - Y0);
      GRenderer.DrawPicture(Frame, X0 / this.SizeX, Y0 / this.SizeY, X1 / this.SizeX, Y1 / this.SizeY);
    }
    this.Txt('CPV   /   INSTANT REPLAY', X, Y - 57, ECpvFont.ExtraItalic, 42, ReplayGold);
    this.Txt('RINGSIDE CAMERA', X + FilmW, Y - 49, ECpvFont.Bold, 28, FLinearColor.White, ECpvAlign.Right);
    this.Box(X, Y + FilmH, FilmW, 7, new FLinearColor(0.17, 0.18, 0.2));
    this.Box(X, Y + FilmH, FilmW * G.ReplayProgress(), 7, ReplayGold);
    this.Txt('ENTER / A   Return to results', X + FilmW, Y + FilmH + 22, ECpvFont.Semi, 30, FLinearColor.White, ECpvAlign.Right);
  }

  private DrawPause(): void {
    const G = this.G, W = this.W, H = this.H;
    this.Box(0, 0, W, H, new FLinearColor(0, 0, 0.03, 0.8));
    this.Out('INTERMISSION', W * 0.5, 50, ECpvFont.Title, 96, Gold, Ink, 5, ECpvAlign.Center);
    const Items = ['RESUME', G.IsRehearsing() ? 'RESTART REHEARSAL' : 'RESTART BOUT', 'QUIT TO MENU', 'SOUND MIXER', 'PICTURE QUALITY'];
    for (let i = 0; i < Items.length; ++i) {
      const Y = 168 + i * 65;
      this.Hit(W * 0.5 - 310, Y - 4, 620, 65, ECpvClick.Pause, i);
      const bOn = i === G.PauseIndex;
      if (bOn) { this.Slant(W * 0.5 - 300, Y - 4, 600, 59, 22, Gold); }
      this.Txt(Items[i], W * 0.5, Y + 4, ECpvFont.ExtraItalic, 45, bOn ? Ink : White, ECpvAlign.Center, bOn ? 0 : 3, 20);
    }
    this.DrawControls(W * 0.5 - 610, 500, true);
    this.Txt('In a grab:  JAB = headbutt     HEAVY = slam     GRAB + direction = whip into the ropes', W * 0.5, 936, ECpvFont.Medium, 26, Dim, ECpvAlign.Center);
    this.Txt('Deciding round: knock them silly, then press SIGNATURE up close for a CURTAIN CALL', W * 0.5, 974, ECpvFont.Medium, 26, Dim, ECpvAlign.Center);
  }
}
