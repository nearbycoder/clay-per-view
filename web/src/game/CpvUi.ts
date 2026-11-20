// Port of CpvUi.h / CpvUi.cpp: the small drawing kit shared by the HUD and the in-world screens. Unreal's
// canvas becomes a 2D canvas context.
//
// The aim is the same picture the desktop game draws, so three habits of Unreal's canvas are kept:
//  - Colours are linear in the game code and are encoded with a plain 2.2 gamma on their way to the screen.
//  - A font size is in Slate points: the glyphs are rendered at round(size * 96 / 72) pixels, and a text's Y
//    is the top of its line box, with the baseline one rounded ascent below it.
//  - Text is set glyph by glyph without kerning, and Slate's letter spacing has no effect on canvas text
//    (it is neither drawn nor measured), so the spacing argument is carried but not applied.

import { FLinearColor, FMath, FVector2D, UE_TWO_PI } from '../engine/ue';

export enum ECpvFont { Title, Impact, Comic, Bold, BoldItalic, ExtraItalic, Semi, Medium }
export enum ECpvAlign { Left, Center, Right }

export type UCanvas = CanvasRenderingContext2D;

export interface FSlateFontInfo {
  Face: ECpvFont;
  /** Point size, as Slate counts it (96 dpi: one point is 4/3 of a pixel). */
  Size: number;
  /** Slate's tracking value in thousandths of the font size. Unreal's canvas ignores it; so does this kit. */
  LetterSpacing: number;
}

// Loaded as separate families by engine/assets.ts (the italic cuts are their own files, as in the C++).
const GFaceFamilies = ['CpvTitle', 'CpvImpact', 'CpvComic', 'CpvBold', 'CpvBoldItalic', 'CpvExtraItalic', 'CpvSemi', 'CpvMedium'];
// Ascender and descender of each face as fractions of the em (from the fonts' hhea tables; none has a line gap).
const GFaceMetrics: Array<[number, number]> = [
  [0.97, -0.175],                // Titan One
  [2409 / 2048, -674 / 2048],    // Anton
  [0.883, -0.181],               // Bangers
  [1, -0.2], [1, -0.2], [1, -0.2], [1, -0.2], [1, -0.2],   // Barlow Condensed
];
const POINT = 96 / 72;
const DefaultShadow = new FLinearColor(0, 0, 0, 0.7);

let Measurer: CanvasRenderingContext2D | null = null;
const Tinted = new Map<string, HTMLCanvasElement>();
const CssCache = new Map<number, string>();

function Encode(V: number): number {
  return Math.round(Math.pow(V <= 0 ? 0 : V >= 1 ? 1 : V, 1 / 2.2) * 255);
}

/** The CSS colour Unreal's canvas would put on screen for a linear colour. */
function Css(C: FLinearColor): string {
  const R = Encode(C.R), G = Encode(C.G), B = Encode(C.B);
  const A = Math.round(FMath.Clamp(C.A, 0, 1) * 1000);
  const Key = ((R * 256 + G) * 256 + B) * 1001 + A;
  let Found = CssCache.get(Key);
  if (Found === undefined) {
    Found = A >= 1000 ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${A / 1000})`;
    if (CssCache.size > 4096) { CssCache.clear(); }
    CssCache.set(Key, Found);
  }
  return Found;
}

/** Pixel size Slate renders a point size at. */
function Pixels(Info: FSlateFontInfo): number { return FMath.Max(1, Math.floor(Info.Size * POINT + 0.5)); }

/** Selects the font on a context (only touching it when it changes) and returns the baseline's offset below the top of the line. */
function Use(Ctx: CanvasRenderingContext2D, Info: FSlateFontInfo): number {
  const Px = Pixels(Info);
  const Spec = `${Px}px ${GFaceFamilies[Info.Face]}`;
  // Asking the context (rather than remembering) also catches a canvas that was resized, which resets it.
  if (Ctx.font !== Spec) {
    Ctx.font = Spec;
    Ctx.fontKerning = 'none';
    Ctx.textBaseline = 'alphabetic';
    Ctx.textAlign = 'left';
  }
  const [Ascender, Descender] = GFaceMetrics[Info.Face];
  // Slate: baseline = top + round(line height) + round(descender).
  return Math.floor((Ascender - Descender) * Px + 0.5) + Math.floor(Descender * Px + 0.5);
}

function MeasureContext(): CanvasRenderingContext2D {
  if (!Measurer) { Measurer = document.createElement('canvas').getContext('2d')!; }
  return Measurer;
}

/** An image multiplied by a colour (portraits of the stunt double). Cached. */
function Tint(Image: CanvasImageSource & { width: number; height: number }, Colour: FLinearColor, Id: string): CanvasImageSource {
  const Paint = Css(new FLinearColor(Colour.R, Colour.G, Colour.B, 1));
  const Key = `${Id}/${Paint}`;
  let Made = Tinted.get(Key);
  if (!Made) {
    Made = document.createElement('canvas');
    Made.width = Image.width;
    Made.height = Image.height;
    const C = Made.getContext('2d')!;
    C.drawImage(Image, 0, 0);
    C.globalCompositeOperation = 'multiply';
    C.fillStyle = Paint;
    C.fillRect(0, 0, Made.width, Made.height);
    C.globalCompositeOperation = 'destination-in'; // keep the picture's own transparency
    C.drawImage(Image, 0, 0);
    Tinted.set(Key, Made);
  }
  return Made;
}

export const CpvUi = {
  Font(Face: ECpvFont, Size: number, Spacing = 0): FSlateFontInfo {
    return { Face, Size: FMath.Max(1, FMath.RoundToFloat(Size)), LetterSpacing: Spacing };
  },

  /** Width of a line of text and the height of its line box, in pixels. */
  Measure(Str: string, Info: FSlateFontInfo): FVector2D {
    const Ctx = MeasureContext();
    Use(Ctx, Info);
    const [Ascender, Descender] = GFaceMetrics[Info.Face];
    return new FVector2D(Ctx.measureText(Str).width, Math.floor((Ascender - Descender) * Pixels(Info) + 0.5));
  },

  /** The CSS colour for a linear colour, encoded as the desktop game's canvas encodes it. */
  Css,

  /** Draws text and returns its width. */
  Text(Canvas: UCanvas, Str: string, X: number, Y: number, Info: FSlateFontInfo, Color: FLinearColor, Align: ECpvAlign = ECpvAlign.Left,
    Shadow = 0, ShadowColor: FLinearColor = DefaultShadow): number {
    const Baseline = Use(Canvas, Info);
    const Width = Canvas.measureText(Str).width;
    const Left = FMath.RoundToFloat(Align === ECpvAlign.Center ? X - Width * 0.5 : Align === ECpvAlign.Right ? X - Width : X);
    const Top = FMath.RoundToFloat(Y);
    if (Color.A <= 0) { return Width; }
    if (Shadow > 0) {
      Canvas.fillStyle = Css(new FLinearColor(ShadowColor.R, ShadowColor.G, ShadowColor.B, ShadowColor.A * Color.A));
      Canvas.fillText(Str, Left + Shadow, Top + Shadow + Baseline);
    }
    Canvas.fillStyle = Css(Color);
    Canvas.fillText(Str, Left, Top + Baseline);
    return Width;
  },

  /** Text with a chunky outline (drawn as offset copies), the way title cards are lettered. */
  Outlined(Canvas: UCanvas, Str: string, X: number, Y: number, Info: FSlateFontInfo, Color: FLinearColor, Outline: FLinearColor, Thickness: number,
    Align: ECpvAlign = ECpvAlign.Left): number {
    const Baseline = Use(Canvas, Info);
    const Width = Canvas.measureText(Str).width;
    const Left = FMath.RoundToFloat(Align === ECpvAlign.Center ? X - Width * 0.5 : Align === ECpvAlign.Right ? X - Width : X);
    const Top = FMath.RoundToFloat(Y);
    const EdgeAlpha = Outline.A * Color.A;
    if (EdgeAlpha > 0 && Thickness > 0) {
      Canvas.fillStyle = Css(new FLinearColor(Outline.R, Outline.G, Outline.B, EdgeAlpha));
      const Copies = Thickness > 3 ? 16 : 8;
      for (let i = 0; i < Copies; ++i) {
        const A = (UE_TWO_PI * i) / Copies;
        Canvas.fillText(Str, Left + FMath.Cos(A) * Thickness, Top + FMath.Sin(A) * Thickness + Thickness * 0.6 + Baseline);
      }
    }
    if (Color.A <= 0) { return Width; }
    Canvas.fillStyle = Css(Color);
    Canvas.fillText(Str, Left, Top + Baseline);
    return Width;
  },

  Fill(Canvas: UCanvas, X: number, Y: number, W: number, H: number, Color: FLinearColor): void {
    const X0 = FMath.RoundToFloat(X), Y0 = FMath.RoundToFloat(Y);
    const X1 = FMath.RoundToFloat(X + W), Y1 = FMath.RoundToFloat(Y + H);
    if (X1 <= X0 || Y1 <= Y0 || Color.A <= 0) { return; }
    Canvas.fillStyle = Css(Color);
    Canvas.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
  },

  /** Filled rectangle that fades from one colour at the top to another at the bottom. */
  Gradient(Canvas: UCanvas, X: number, Y: number, W: number, H: number, Top: FLinearColor, Bottom: FLinearColor): void {
    const X0 = FMath.RoundToFloat(X), Y0 = FMath.RoundToFloat(Y);
    const X1 = FMath.RoundToFloat(X + W), Y1 = FMath.RoundToFloat(Y + H);
    if (X1 <= X0 || Y1 <= Y0) { return; }
    const Ramp = Canvas.createLinearGradient(0, Y0, 0, Y1);
    Ramp.addColorStop(0, Css(Top));
    Ramp.addColorStop(1, Css(Bottom));
    Canvas.fillStyle = Ramp;
    Canvas.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
  },

  Frame(Canvas: UCanvas, X: number, Y: number, W: number, H: number, Color: FLinearColor, Thickness: number): void {
    const T = FMath.Max(1, FMath.RoundToFloat(Thickness));
    CpvUi.Fill(Canvas, X, Y, W, T, Color);
    CpvUi.Fill(Canvas, X, Y + H - T, W, T, Color);
    CpvUi.Fill(Canvas, X, Y + T, T, H - 2 * T, Color);
    CpvUi.Fill(Canvas, X + W - T, Y + T, T, H - 2 * T, Color);
  },

  /** Filled four-sided shape (points clockwise). */
  Quad(Canvas: UCanvas, A: FVector2D, B: FVector2D, C: FVector2D, D: FVector2D, Color: FLinearColor): void {
    if (Color.A <= 0) { return; }
    Canvas.fillStyle = Css(Color);
    Canvas.beginPath();
    Canvas.moveTo(A.X, A.Y);
    Canvas.lineTo(B.X, B.Y);
    Canvas.lineTo(C.X, C.Y);
    Canvas.lineTo(D.X, D.Y);
    Canvas.closePath();
    Canvas.fill();
  },

  /** Horizontal bar with slanted ends: Skew is how far the top edge is shifted right. */
  Slant(Canvas: UCanvas, X: number, Y: number, W: number, H: number, Skew: number, Color: FLinearColor): void {
    CpvUi.Quad(Canvas, new FVector2D(X + Skew, Y), new FVector2D(X + W + Skew, Y), new FVector2D(X + W, Y + H), new FVector2D(X, Y + H), Color);
  },

  /** Draws a picture. Texture is anything a 2D canvas can draw; Id names it for the tint cache. */
  Image(Canvas: UCanvas, Texture: (CanvasImageSource & { width: number; height: number }) | null, X: number, Y: number, W: number, H: number,
    TintColor: FLinearColor = FLinearColor.White, bFlipX = false, Id = ''): void {
    if (!Texture || TintColor.A <= 0 || W <= 0 || H <= 0) { return; }
    const bTinted = TintColor.R < 0.999 || TintColor.G < 0.999 || TintColor.B < 0.999;
    const Source = bTinted && Id ? Tint(Texture, TintColor, Id) : Texture;
    const Alpha = Canvas.globalAlpha;
    Canvas.globalAlpha = Alpha * FMath.Min(1, TintColor.A);
    Canvas.imageSmoothingQuality = 'high';
    if (bFlipX) {
      Canvas.save();
      Canvas.translate(X + W, Y);
      Canvas.scale(-1, 1);
      Canvas.drawImage(Source, 0, 0, W, H);
      Canvas.restore();
    } else {
      Canvas.drawImage(Source, X, Y, W, H);
    }
    Canvas.globalAlpha = Alpha;
  },
};
