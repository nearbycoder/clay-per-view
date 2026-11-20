// Developer page for the rendering side: the arena, a few puppets and the effects, with the camera,
// light mood and picture settings taken from the query string. Not part of the published site.
//
//   dev/scene.html?mood=show&cam=0,1120,255,0,0,70,40&chars=Rex,Chip&clips=Idle&fx=1&shadows=3&lighting=3&effects=3
//   plain=1 leaves the arena out (characters on a grey floor under two test lights)

import { DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';

import { Assets } from '../src/engine/assets';
import { InitMaterials } from '../src/engine/materials';
import { FRenderer, SetRenderer } from '../src/engine/render';
import { FLinearColor, FRotator, FTransform, FVector } from '../src/engine/ue';
import { LensSettings, SetWorld, UStaticMeshComponent, UWorld } from '../src/engine/world';
import { CpvAnim } from '../src/game/CpvAnims';
import { CpvUi, ECpvAlign, ECpvFont } from '../src/game/CpvUi';
import { ACpvArena, ECpvLightMood } from '../src/game/CpvArena';
import { ACpvFx } from '../src/game/CpvFx';
import { ACpvPuppet } from '../src/game/CpvPuppet';
import { ECpvWord } from '../src/game/CpvTypes';

const Params = new URLSearchParams(location.search);
const Num = (Name: string, Default: number) => (Params.has(Name) ? parseFloat(Params.get(Name)!) : Default);

const World = new UWorld();
SetWorld(World);
const Canvas = document.getElementById('view') as HTMLCanvasElement;
const Renderer = new FRenderer(Canvas, World.Scene);
SetRenderer(Renderer);
Renderer.Resize(innerWidth, innerHeight);
window.addEventListener('resize', () => Renderer.Resize(innerWidth, innerHeight));
Renderer.Settings.Shadows = Num('shadows', 3);
Renderer.Settings.Lighting = Num('lighting', 3);
Renderer.Settings.Effects = Num('effects', 3);
Renderer.Settings.Antialias = Num('aa', 4);
Renderer.Settings.bPost = Num('post', 1) > 0;
Renderer.Settings.Scale = Num('scale', 1);
Renderer.Settings.FeedHz = Num('feed', 8);
Renderer.Settings.Textures = Num('textures', 3);
Renderer.Settings.bDepthOfField = Num('dof', 1) > 0;
Renderer.Apply();

(async () => {
  await Assets.Load(() => {});
  InitMaterials();
  Renderer.Apply();
  const bPlain = Params.has('plain');
  let Arena: ACpvArena | null = null;
  let Fx: ACpvFx | null = null;
  if (bPlain) {
    const Key = new DirectionalLight(0xffffff, 1500);
    Key.position.set(3, 6, 5);
    Key.castShadow = true;
    Key.shadow.mapSize.set(2048, 2048);
    Key.shadow.camera.left = -8; Key.shadow.camera.right = 8; Key.shadow.camera.top = 8; Key.shadow.camera.bottom = -8;
    World.Scene.add(Key);
    World.Scene.add(new HemisphereLight(0xbfd0ff, 0x302820, 450));
    const Floor = new Mesh(new PlaneGeometry(40, 40), new MeshStandardMaterial({ color: 0x555555, roughness: 0.9 }));
    Floor.rotation.x = -Math.PI / 2;
    Floor.receiveShadow = true;
    World.Scene.add(Floor);
  } else {
    Arena = World.SpawnActor(ACpvArena);
    Arena.Build();
    const Moods: Record<string, ECpvLightMood> = { house: ECpvLightMood.House, show: ECpvLightMood.Show, entrance: ECpvLightMood.Entrance, drama: ECpvLightMood.Drama };
    Arena.SetMood(Moods[Params.get('mood') ?? 'show'] ?? ECpvLightMood.Show, 0);
    Arena.SetHype(Num('hype', 0.35));
    Arena.CrowdDensity = Num('density', 1);
    Fx = World.SpawnActor(ACpvFx);
    Fx.Build(Arena.MatHalf, Arena.FloorZ);
    // Something on the stage screen, the way the game's DrawStageScreen will put it there.
    const Screen = Arena.GetStageScreen();
    if (Screen && !Params.has('noscreen')) {
      const C = Screen.Ctx;
      CpvUi.Gradient(C, 0, 0, 1024, 540, new FLinearColor(0.16, 0.08, 0.3), new FLinearColor(0.05, 0.02, 0.12));
      CpvUi.Text(C, 'NOW ENTERING', 512, 120, CpvUi.Font(ECpvFont.Bold, 54), new FLinearColor(1, 1, 1), ECpvAlign.Center);
      CpvUi.Outlined(C, 'DUCHESS WINNIFRED', 512, 230, CpvUi.Font(ECpvFont.Title, 62), new FLinearColor(0.5, 0.25, 0.75), new FLinearColor(0, 0, 0), 4, ECpvAlign.Center);
      Screen.MarkDirty();
    }
  }

  const Chars = (Params.get('chars') ?? (bPlain ? 'Rex,Lola,Bruno,Chip,Wubz,Duchess,Vince,Mystica,Ref,Dirk,Nigel' : 'Rex,Chip')).split(',').filter(Boolean);
  const Clips = (Params.get('clips') ?? (bPlain ? 'Stand' : 'Idle')).split(',');
  const T = Num('t', 0);
  const Puppets: ACpvPuppet[] = [];
  const Place = (Name: string, Clip: string, Location: FVector, Yaw: number) => {
    const P = World.SpawnActor(ACpvPuppet, Location, new FRotator(0, Yaw, 0));
    P.SetCharacter(Name);
    P.Play(Clip, 0, Params.has('anim') ? 1 : 0);
    P.SetClipTime(CpvAnim.Get(Clip).Length * T);
    Puppets.push(P);
    return P;
  };
  if (bPlain) {
    Chars.forEach((Name, i) => Clips.forEach((Clip, Row) => Place(Name, Clip, new FVector((i - (Chars.length - 1) / 2) * 120, Row * -260, 0), Num('yaw', 90))));
  } else if (Arena) {
    // Two contenders in the ring, the referee, and the commentators at their desk.
    const At = (Params.get('at') ?? '-110,0,0,0;110,0,0,180').split(';').map((S) => S.split(',').map(Number));
    Chars.forEach((Name, i) => {
      const A = At[i % At.length];
      const P = Place(Name, Clips[i % Clips.length], new FVector(A[0], A[1], A[2]), A[3] ?? 0);
      P.bMirror = i % 2 === 1;
    });
    if (!Params.has('nocast')) {
      Place('Ref', 'RefIdle', new FVector(0, -160, 0), 90);
      ['Dirk', 'Nigel'].forEach((Name, i) => {
        const Seat = Arena!.AnnounceSeats[i] ?? new FTransform(new FRotator(0, 90, 0), new FVector(130 + 120 * i, -512, -48));
        Place(Name, 'SitIdle', Seat.GetLocation(), Seat.Rotator().Yaw);
      });
    }
  }
  for (const [i, Name] of (Params.get('props') ?? '').split(',').filter(Boolean).entries()) {
    const C = new UStaticMeshComponent();
    C.SetStaticMesh(Name);
    C.SetWorldTransform(new FTransform(new FRotator(0, 30, 0), new FVector((i - 2) * 90, 120, 0)));
  }

  const Cam = (Params.get('cam') ?? (bPlain ? '0,900,170,0,0,95,40' : '0,1120,255,0,0,70,40')).split(',').map(Number);
  const Pos = new FVector(Cam[0], Cam[1], Cam[2]);
  const Rot = new FVector(Cam[3], Cam[4], Cam[5]).Sub(Pos).Rotation();
  const Orbit = Num('orbit', 0);
  const FxEvery = Num('fx', 0);
  const Bench = Math.max(1, Num('bench', 1));
  const Fire = (Kind: number) => {
    if (!Fx) { return; }
    const Hit = new FVector(-20 + Math.random() * 40, 20, 120);
    const Red = new FLinearColor(0.8, 0.15, 0.1), Tan = new FLinearColor(0.75, 0.5, 0.35);
    switch (Kind % 6) {
      case 0: Fx.Impact(Hit, ECpvWord.Pow, 1.4, new FLinearColor(1, 0.85, 0.2)); Fx.Blobs(Hit, new FVector(1, 0, 0), 12, Red, Tan, 420); break;
      case 1: Fx.Impact(Hit, ECpvWord.Wham, 1.6, new FLinearColor(1, 0.4, 0.2)); Fx.Stars(Hit, 8); Fx.Teeth(Hit, new FVector(1, 0, 0), 4); break;
      case 2: Fx.Explosion(new FVector(60, 60, 20), 1); Arena?.Flash(1); break;
      case 3: Fx.Flames(new FVector(-80, 0, 130), new FVector(1, 0, 0), 14); Fx.Notes(new FVector(80, 0, 150), new FVector(-1, 0, 0.2), 8, new FLinearColor(0.3, 0.9, 1)); break;
      case 4: Fx.Bolt(new FVector(-90, 0, 150), new FVector(110, 0, 130)); Fx.Ring(new FVector(0, 0, 3), 4, new FLinearColor(0.6, 0.3, 1)); Fx.Puff(Hit, 1.5, 5); break;
      default: Fx.Confetti(60); Fx.Splat(new FVector(-60, 40, 0), 1.4, Red); Fx.Halo(0, new FVector(-110, 0, 190)); Arena?.BumpRopes(2, 0.2, 400); break;
    }
  };
  // still=N: run N seconds at a fixed step before the first frame, then hold everything (repeatable screenshots).
  // fxkind=K&fxlead=S fires effect K that many seconds before the hold.
  const Still = Num('still', 0);
  const FxLead = Math.round(Num('fxlead', 0.15) * 60);
  for (let i = 0; i < Math.round(Still * 60); ++i) {
    if (Arena) { Arena.SetFeedView(Pos, Rot, Cam[6]); }
    if (Fx) { Fx.SetCamera(Pos); }
    if (Params.has('fxkind') && i === Math.round(Still * 60) - FxLead) { Fire(Num('fxkind', 0)); }
    World.Tick(1 / 60);
  }
  let FxClock = 0.4;
  // tape=N: record the feed for N seconds as the game does during a bout, then play it back over the picture.
  const TapeFor = Num('tape', 0);
  let Taped = TapeFor > 0 ? -1 : 0;
  let ReplayAt = 0;
  let FxKind = 0;
  let Last = performance.now();
  let Frames = 0, Since = Last, Worst = 0, TickMs = 0, RenderMs = 0;
  // GPU time for the whole frame (the feed capture in the tick included), where the browser offers timer queries.
  const Gl = Renderer.GL.getContext() as WebGL2RenderingContext;
  const Timer = Gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const Pending: WebGLQuery[] = [];
  let GpuNs = 0, GpuFrames = 0;
  const Frame = (Now: number) => {
    const Dt = Still > 0 ? 0 : Math.min((Now - Last) / 1000, 0.1);
    Worst = Math.max(Worst, Now - Last);
    Last = Now;
    let P = Pos, R = Rot;
    if (Orbit > 0) {
      const A = (90 + 55 * Math.sin((World.RealTimeSeconds * Orbit * 5 * Math.PI) / 180)) * (Math.PI / 180);
      P = new FVector(Math.cos(A) * 980, Math.sin(A) * 980, 300);
      R = new FVector(0, 0, 70).Sub(P).Rotation();
    }
    if (Arena) { Arena.SetFeedView(P, R, Cam[6]); }
    if (Fx) { Fx.SetCamera(P); }
    let Query: WebGLQuery | null = null;
    if (Timer && Pending.length < 8) {
      Query = Gl.createQuery();
      if (Query) { Gl.beginQuery(Timer.TIME_ELAPSED_EXT, Query); }
    }
    const T0 = performance.now();
    World.Tick(Dt);
    TickMs += performance.now() - T0;
    if (Fx && FxEvery > 0) {
      FxClock -= Dt;
      if (FxClock <= 0) {
        FxClock = FxEvery;
        Fire(FxKind++);
      }
    }
    if (Arena && TapeFor > 0) {
      if (Taped < 0) { Arena.StartTape(); Taped = 0; }
      if (Taped === 0 && World.TimeSeconds >= TapeFor) {
        Arena.StopTape();
        Taped = 1;
        ReplayAt = Arena.TapeStart;
        console.log(`CPV_TAPE ${Arena.TapeStart.toFixed(2)}..${Arena.TapeEnd.toFixed(2)}`);
      }
      if (Taped === 1) {
        ReplayAt += Dt * 0.8;
        if (ReplayAt > Arena.TapeEnd) { ReplayAt = Arena.TapeStart; }
        Renderer.DrawPicture(Arena.TapeFrame(ReplayAt), 0.52, 0.05, 0.97, 0.5);
      }
    }
    Renderer.SetView(P, R, Cam[6]);
    // As the game's camera director does: focus on what the camera is aimed at.
    LensSettings.DepthOfFieldFocalDistance = Orbit > 0 ? P.Sub(new FVector(0, 0, 70)).Size() : new FVector(Cam[3], Cam[4], Cam[5]).Sub(Pos).Size();
    Renderer.GL.info.autoReset = false;
    Renderer.GL.info.reset();
    // bench=N draws the picture N times a frame: the frame rate with vsync on then shows how much one costs.
    const T1 = performance.now();
    for (let i = 0; i < Bench; ++i) { Renderer.Render(World.TimeSeconds); }
    RenderMs += performance.now() - T1;
    if (Timer && Query) {
      Gl.endQuery(Timer.TIME_ELAPSED_EXT);
      Pending.push(Query);
    }
    while (Timer && Pending.length > 0 && Gl.getQueryParameter(Pending[0], Gl.QUERY_RESULT_AVAILABLE)) {
      const Done = Pending.shift()!;
      if (!Gl.getParameter(Timer.GPU_DISJOINT_EXT)) {
        GpuNs += Gl.getQueryParameter(Done, Gl.QUERY_RESULT) as number;
        ++GpuFrames;
      }
      Gl.deleteQuery(Done);
    }
    const W = window as any;
    W.__frames = (W.__frames ?? 0) + 1;
    ++Frames;
    if (Now - Since >= 2000) {
      const Info = Renderer.GL.info;
      W.__perf = { fps: +((Frames * 1000) / (Now - Since)).toFixed(1), worstMs: +Worst.toFixed(1), tickMs: +(TickMs / Frames).toFixed(2), renderJsMs: +(RenderMs / Frames).toFixed(2),
        gpuMs: GpuFrames > 0 ? +(GpuNs / GpuFrames / 1e6).toFixed(2) : null, calls: Info.render.calls, tris: Info.render.triangles };
      Frames = 0; Since = Now; Worst = 0; TickMs = 0; RenderMs = 0; GpuNs = 0; GpuFrames = 0;
    }
    requestAnimationFrame(Frame);
  };
  requestAnimationFrame(Frame);
  (window as any).__scene = { World, Renderer, Arena, Fx, Puppets };
})().catch((E) => { console.error(E); (window as any).__error = String(E); });
