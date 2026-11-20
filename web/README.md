# Clay-Per-View in the browser

The browser version of Clay-Per-View and the website that hosts it. The game is a TypeScript port of the
Unreal project in [`../ClayPerView`](../ClayPerView), drawn with [three.js](https://threejs.org) from the
same models, animation and audio. Both pages are static files, published by GitHub Pages.

- **Website:** `index.html` with `site/`
- **Game:** `play/index.html` with `src/`

## Run it

    npm install
    npm run dev        # http://localhost:5199/ is the website, http://localhost:5199/play/ the game
    npm run build      # type-checks, then writes the site to dist/
    npm run preview    # serves dist/ on http://localhost:5198/

Node 22 or newer. Nothing else is needed to work on the code: the models, sounds and fonts the game loads
are already in `public/assets`.

## How the port is organised

The game code keeps Unreal's world: left-handed, Z up, centimetres, rotators in degrees. Every tuned number
in the C++ therefore carries over unchanged, and a transform only becomes a three.js matrix at the last
moment (`src/engine/convert.ts`).

| Folder | What is in it |
| --- | --- |
| `src/engine/` | A thin layer shaped like the parts of Unreal the game uses. `ue.ts` is the maths (vectors, rotators, quaternions, the seeded random stream; all immutable values). `world.ts` has actors, the clock and the mesh components. `materials.ts` holds the clay, glow, crowd, sign and screen shaders, ported from the Unreal material graphs. `render.ts` is the camera and the post chain. `audio.ts`, `input.ts` and `platform.ts` cover sound, controls, saved options and launch options. |
| `src/game/` | The game, file for file: `CpvFighter.ts` is `CpvFighter.cpp`, `CpvAI.ts` is `CpvAI.cpp`, and so on. Names, order and numbers match the C++ so the two can be read side by side. |
| `src/main.ts`, `src/touch.ts` | Start-up, the frame loop and the on-screen controls for phones and tablets. |
| `site/` | Styles and script of the website, and `build-media.mjs`, which prepares its pictures and trailer. |
| `dev/` | Two developer pages that are not published: `scene.html` (the arena, puppets and effects with any camera, light mood and quality setting) and `hud.html` (any HUD screen from made-up state). |
| `tools/` | `build-assets.mjs` (models, pictures, fonts and sound for the browser), `shot.mjs` (scripted runs with screenshots in headless Chrome) and `bench.mjs` (frame times). |

The Unreal game mode is one class spread over ten source files. Here `src/game/CpvGame.ts` plays the part
of the header: it holds the fields and declares the methods, and each of the other files supplies its
bodies through `implement(ACpvGameMode, { ... })`.

### What differs from the desktop game

- Launch options are the page's query string (see below) and options and records are saved in the
  browser's local storage.
- The lighting rig is split to suit a forward renderer: the ring's key lights, one stage light and the
  flash are real lights with shadows; stage, wash and fill lights are evaluated in the clay shader without
  specular; each spectator is lit once on the CPU. Bounce light is approximated. There is no volumetric fog.
- Picture options map onto the web renderer, with no vertical-sync switch. Until a picture setting is
  chosen by hand, a machine that stays below a smooth frame rate is moved down a preset automatically.
- Touch controls, and "Exit to website" in place of "Quit".
- The desktop film-capture and audio-capture test tools are not ported.

## Assets

    cd ../ClayPerView && Scripts/dev.sh py "$PWD/Scripts/export_web.py"   # Unreal: every mesh to Saved/WebExport/*.glb
    cd ../web && npm run assets                                           # compress and convert into public/assets

`export_web.py` uses Unreal's glTF exporter, so the browser gets exactly the vertex data the desktop game
draws: sRGB vertex colours with roughness in alpha, skin weights, the reference skeleton and the crowd's
seated pose in extra UV channels. `build-assets.mjs` then trims and meshopt-compresses the models, converts
portraits and textures to WebP and fonts to WOFF2, and encodes the sound to MP3 in two pack files (effects
and music; voices) with a byte-range index. It needs `ffmpeg`. `npm run assets -- models` (or `images`,
`fonts`, `audio`, `data`) rebuilds one group.

## Scripted runs

The desktop game's test flags work as query parameters, for example
`play/?CpvStart=watch&CpvAI&CpvP1=2&CpvP2=7&CpvSeed=11`:

- `CpvStart=watch|fight|select|menu|intro|finisher|rehearsal|options|howto` skips to a part of the game;
  `CpvAI` lets the computer play both sides and `CpvTwo` starts a two-player bout.
- `CpvP1=<0-7>`, `CpvP2=<0-7>`, `CpvFoeHealth=<n>`, `CpvHype=<n>`, `CpvWeapon=<1-7>`, `CpvDifficulty=<0-2>`.
- `CpvKeys=Enter@3,KeyD@10:1.5,KeyJ@12,p2.Gamepad_FaceButton_Left@14` sends key events
  (`name@seconds[:hold]`), `CpvPress=ok@3,down@4` presses menu buttons and `CpvClicks=0.5:0.4@6` clicks.
- `CpvCam=x,y,z,aimx,aimy,aimz[,fov]` fixes the camera; `CpvNoHud`, `CpvNoCrowd` and `CpvNoFeed` switch
  parts off; `CpvGallery=Jab,Cross&CpvChar=Rex` draws film strips of animation clips.
- `CpvMash`, `CpvDummy`, `CpvAutoQuit` and `CpvQuit=<seconds>` as on the desktop. `CpvSeed=<n>` makes a run
  repeatable, `CpvSpeed=<n>` fast-forwards it and `CpvVerbose` logs every state change and strike.

The console prints the same `CPV_RESULT`, `CPV_EPISODE` and `CPV_PERF` lines as the desktop log. With the
dev server running:

    node tools/shot.mjs "play/?CpvStart=watch&CpvAI&CpvAutoQuit&CpvSpeed=6" out.png --done=90
    node tools/bench.mjs "dev/scene.html?mood=show&chars=Rex,Chip" --size=1920x1080

Both drive the Google Chrome installed on the machine through `playwright-core`.

## Browsers

Checked in Chrome and in WebKit (the engine behind Safari) on an Apple silicon Mac, including an emulated
phone with touch input. It needs WebGL 2. Firefox, Windows, Linux and real phones have not been tested.

## Licences of what ships

three.js and the meshoptimizer decoder are MIT licensed; the typefaces are under the SIL Open Font License;
the voices were rendered with the Kokoro-82M model (Apache-2.0). The full notices are in
[`public/THIRD-PARTY-NOTICES.txt`](public/THIRD-PARTY-NOTICES.txt) and are published with the site.
