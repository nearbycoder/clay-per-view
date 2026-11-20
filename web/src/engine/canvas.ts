// A 2D canvas the game draws on that also serves as a texture in the scene (the stage screen, the fans'
// placards). Stands in for Unreal's "draw canvas to render target".

import { CanvasTexture, SRGBColorSpace } from 'three';

export class FCanvasTarget {
  readonly Canvas: HTMLCanvasElement;
  readonly Ctx: CanvasRenderingContext2D;
  readonly Texture: CanvasTexture;

  constructor(readonly Width: number, readonly Height: number, Clear: string = '#000') {
    this.Canvas = document.createElement('canvas');
    this.Canvas.width = Width;
    this.Canvas.height = Height;
    this.Ctx = this.Canvas.getContext('2d')!;
    this.Ctx.fillStyle = Clear;
    this.Ctx.fillRect(0, 0, Width, Height);
    this.Texture = new CanvasTexture(this.Canvas);
    this.Texture.colorSpace = SRGBColorSpace;
    this.Texture.flipY = false; // row 0 is the top of the picture, as the meshes' UVs expect
    this.Texture.generateMipmaps = true;
    this.Texture.anisotropy = 4;
  }

  /** Call after drawing: uploads the canvas to the GPU on the next frame. */
  MarkDirty(): void { this.Texture.needsUpdate = true; }
}
