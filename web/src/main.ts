// Start-up and the frame loop.

import { Assets } from './engine/assets';
import { Audio } from './engine/audio';
import { Input } from './engine/input';
import { InitMaterials } from './engine/materials';
import { FParse, FPlatformMisc, FrameCap } from './engine/platform';
import { FRenderer, SetRenderer } from './engine/render';
import { FMath, SeededRandom } from './engine/ue';
import { SetWorld, UWorld } from './engine/world';
import { ACpvGameMode, ACpvHUD } from './game';
import { ECpvPhase } from './game/CpvGame';
import { InitTouch } from './touch';

declare global {
  interface Window {
    /** For scripted test runs: the live game, a frame counter, and flags for "finished" and "failed". */
    __cpv?: { Game: ACpvGameMode; World: UWorld; Renderer: FRenderer };
    __frames?: number;
    __cpvDone?: boolean;
    __error?: string;
  }
}

const Stage = document.getElementById('stage') as HTMLElement;
const View = document.getElementById('view') as HTMLCanvasElement;
const HudCanvas = document.getElementById('hud') as HTMLCanvasElement;
const Loading = document.getElementById('loading') as HTMLElement;
const LoadingBar = document.getElementById('loading-bar') as HTMLElement;
const LoadingNote = document.getElementById('loading-note') as HTMLElement;

function Fail(Message: string, Detail?: unknown): void {
  console.error(Message, Detail);
  window.__error = `${Message} ${Detail ?? ''}`;
  Loading.classList.remove('done');
  Loading.classList.add('failed');
  LoadingNote.textContent = Message;
}

async function Boot(): Promise<void> {
  const bScripted = [...new URLSearchParams(location.search).keys()].some((Key) => Key.startsWith('Cpv'));
  const Seed = FParse.Value('CpvSeed');
  if (Seed !== null) { FMath.SetRandomSource(SeededRandom(parseInt(Seed, 10) || 1)); }

  const Probe = document.createElement('canvas').getContext('webgl2');
  if (!Probe) {
    Fail('This game needs WebGL 2. Please try a current version of Chrome, Edge, Firefox or Safari.');
    return;
  }

  const World = new UWorld();
  SetWorld(World);
  const Renderer = new FRenderer(View, World.Scene);
  SetRenderer(Renderer);
  const Hud2D = HudCanvas.getContext('2d')!;

  const Resize = () => {
    const W = Stage.clientWidth, H = Stage.clientHeight;
    Renderer.Resize(W, H);
    // The HUD is drawn in device pixels, capped: nobody needs 4K lettering redrawn sixty times a second.
    const Scale = Math.min(window.devicePixelRatio || 1, 2, 1440 / Math.max(1, H));
    HudCanvas.width = Math.max(1, Math.round(W * Scale));
    HudCanvas.height = Math.max(1, Math.round(H * Scale));
  };
  window.addEventListener('resize', Resize);
  Resize();

  Audio.Init();
  Input.Attach(Stage);
  Input.OnFirstGesture(() => Audio.Resume());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { Audio.Resume(); } });
  // The touch pad shows while player one is in a bout (menus and results are tapped directly).
  InitTouch(Stage, () => {
    const G = window.__cpv?.Game;
    return !!G && !G.bPaused && G.IsHuman(0) && (G.Phase === ECpvPhase.RoundIntro || G.Phase === ECpvPhase.Fight || G.Phase === ECpvPhase.RoundEnd);
  });

  await Assets.Load((Fraction, What) => {
    LoadingBar.style.width = `${Math.round(Fraction * 100)}%`;
    LoadingNote.textContent = `Unpacking the ${What}...`;
  });
  InitMaterials();
  Renderer.Apply();

  // On the desktop "Quit" closes the game; here it leads back to the website (scripted runs just stop).
  FPlatformMisc.SetExitHandler(() => {
    window.__cpvDone = true;
    if (!bScripted) { location.href = '../'; }
  });

  const Game = World.SpawnActor(ACpvGameMode);
  const Hud = new ACpvHUD();
  Hud.G = Game;
  Hud.Canvas = Hud2D;
  Game.Hud = Hud;
  Game.BeginGame();
  window.__cpv = { Game, World, Renderer };

  // Scripted runs can fast-forward: CpvSpeed=4 advances the game four frames for every one drawn.
  const Speed = Math.max(1, Math.round(FParse.Float('CpvSpeed', 1)));
  let Last = performance.now();
  let Owed = 0;
  const Frame = (Now: number) => {
    requestAnimationFrame(Frame);
    const Elapsed = (Now - Last) / 1000;
    if (FrameCap.Value > 0) {
      // Draw only when a capped frame's worth of time has gone by (with a little slack for timer jitter).
      Owed += Elapsed;
      Last = Now;
      if (Owed < 1 / FrameCap.Value - 0.002) { return; }
    } else {
      Owed = Elapsed;
      Last = Now;
    }
    const RealDt = FMath.Clamp(Owed, 0, 0.1);
    Owed = 0;
    try {
      for (let i = 0; i < Speed; ++i) {
        Input.BeginFrame();
        World.Tick(Speed > 1 ? 1 / 60 : RealDt);
      }
      Renderer.SetView(Game.Camera.GetActorLocation(), Game.Camera.GetActorRotation(), Game.Camera.FieldOfView);
      Hud.SizeX = HudCanvas.width;
      Hud.SizeY = HudCanvas.height;
      Hud2D.setTransform(1, 0, 0, 1, 0, 0);
      Hud2D.clearRect(0, 0, HudCanvas.width, HudCanvas.height);
      Hud.DrawHUD();
      Renderer.Render(World.TimeSeconds);
      window.__frames = (window.__frames ?? 0) + 1;
    } catch (Err) {
      if (!window.__error) { Fail('Something went wrong. Reloading the page usually helps.', Err); }
      throw Err;
    }
  };
  requestAnimationFrame(Frame);
  Loading.classList.add('done');
}

Boot().catch((Err) => Fail('The game could not start. Please check your connection and reload.', Err));
