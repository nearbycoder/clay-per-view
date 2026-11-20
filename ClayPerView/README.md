# Clay-Per-View: Famous Last Blows

An over-the-top clay wrestling brawler: eight fictional celebrities settle their feuds in a packed arena,
animated pose-to-pose in stepped "stop-motion" frames. Built in C++ on Unreal Engine 5.9, with every
model sculpted by Blender scripts.

Eric Fogel developed MTV’s *Celebrity Deathmatch* around feuding public figures in a clay wrestling ring. His accounts of staging the matches and bringing in the referee informed this game’s broadcast format. Clay-Per-View casts eight fictional headliners, steps their poses by default at 12 frames per second, gives each a prop-driven finish and lets its two commentators call the result. [Fogel on the original ring concept](https://www.awn.com/blog/battle-celebrity-deathmatch-part-1) · [Fogel on the broadcast cast](https://www.awn.com/blog/battle-celebrity-deathmatch-part-3)

A browser version of the game lives in [`../web`](../web): a TypeScript port of this code on three.js, using the models, animation and audio made here. [Play it](https://nearbycoder.github.io/clay-per-view/play/) · [How the port works](../web/README.md)

## Build and launch

    ./build.sh            # compile; also builds all assets the first time
    ./build.sh --assets   # force-rebuild models, audio and Unreal content
    ./package.sh          # cook, sign, verify and zip the standalone Mac app
    ./play.sh             # launch (extra args pass through, e.g. ./play.sh -fullscreen)

Requires the source-built engine at `~/UnrealEngine` (override with `UE_ENGINE_DIR`) and Blender 5.x at
`/Applications/Blender.app` (override with `BLENDER`; only needed for `--assets`).

### Public Mac distribution

`package.sh` builds a locally signed archive. To publish it, use a Mac with your **Developer ID Application** identity and a Keychain profile for Apple's notary service. The following command signs the bundled libraries and app, sends the signed app to Apple for notarization, staples the accepted ticket and checks Gatekeeper. It writes a separate public archive alongside the tested input.

```sh
python3 Scripts/distribute_mac.py --identity "Developer ID Application: YOUR NAME (TEAMID)" --notary-profile YOUR_KEYCHAIN_PROFILE
python3 Scripts/verify_broadcast.py --archive ../Release/Clay-Per-View-public-macOS.zip --report Saved/PublicReleaseQA
```

The script reads the signing identity and notary credentials from your Mac keychain. [Apple's Developer ID guide](https://developer.apple.com/developer-id/) · [Apple's notarization guide](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

## Controls

| Action                    | One player | 2P: left side | 2P: right side | Gamepad        |
|---------------------------|------------|---------------|----------------|----------------|
| Move                      | W A S D    | W A S D       | Arrows         | Left stick     |
| Jab (tap for a combo)     | J          | F             | ,              | X / Square     |
| Heavy hit                 | K          | G             | .              | Y / Triangle   |
| Grab / pick up / throw    | L          | H             | /              | B / Circle     |
| Block (hold)              | I          | R             | M              | RB             |
| Dodge                     | Space      | Space         | N              | A / Cross      |
| Run (hold)                | Left Shift | Left Shift    | Right Shift    | RT             |
| Signature / Curtain Call  | U          | T             | L              | LB             |
| Taunt                     | O          | Y             | ;              | Back           |
| Pause                     | Esc or P   |               |                | Start          |

Click menus and roster portraits, or navigate with W/S or arrows, Enter to select and Esc to go back. F11, or Options > Picture Quality > Display, switches
between a window and full screen.

The first gamepad is player one and a second gamepad is player two. With a single pad in a two-player
bout, the pad plays the left side and the arrow-key half of the keyboard plays the right.

### Picture and sound

Open **Options** from the main menu, or pause a bout and choose **Sound Mixer** or **Picture Quality**.
Use up/down to choose a row and left/right to adjust it. Changes apply immediately and carry over to the next session.

- **Picture Quality** offers Low (60% render scale), Medium (85%), High (100%), and Ultra (125%).
  Auto uses High detail and scales large windows toward 1,200 rendered lines, down to a minimum of 60%. You can set the scale
  manually up to 150%, tune shadows, lighting and reflections, textures, anti-aliasing, effects,
  post-processing, and the refresh rate of the arena video screens. Individual adjustments show as Custom
  unless the combination matches a preset.
- The **Picture Detail** bar summarizes the selected rendering settings. The **FPS and ms/frame**
  readout measures the running game over half-second intervals. Enable **In-match FPS Meter** to see it
  during a bout. Impact camera shake and arena flash bulbs can be adjusted from general Options. The frame limit, VSync, and window/full-screen settings are independent of the preset.
  Animation style still controls the clay puppets’ pose rate separately.
- **Sound Mixer** has independent master, music, voice, effects, crowd, and menu levels. At 0% the
  channel is muted. You can also toggle music/crowd ducking during speech and dialogue subtitles for the booth, announcer and ring coach. Captions are available in English and Brazilian Portuguese.

## Broadcasts

**Ratings Run** gives each headliner a three-bout card. The Cold Open asks for a three-hit combo. The Prop Department puts a studio clapperboard in your hands. Prime Time gives both finalists a full signature meter. Win each episode to advance. A win, at least half health left, and the episode’s crowd challenge each earn a star. The game saves the champion and personal best out of nine for each headliner and difficulty.

**Ring School** teaches four actions against a live partner before sending you to casting. **Exhibition**, **Two Players** and **Watch a Bout** let you choose both corners and the match rules. Results include the closing seconds from the arena camera under **Instant Replay**.

## How it plays

- **Strikes beat grabs, grabs beat blocks, blocks beat strikes.** Three jabs chain into a cross and a
  launching uppercut. Heavy + toward your opponent is a big boot; heavy on its own is a haymaker.
- **A blocked strike recoils**: the combo stops and the attacker is open for a moment, so block, then
  hit back or grab. Catch a strike in the first 130 milliseconds of your guard for a clean block and extra ratings. Hammering jab into a guard gets you punished (the computer does it to you on the
  two higher difficulties).
- **In a grab:** jab = headbutt, heavy = body slam, grab + a direction = whip them into the ropes. Catch
  someone coming back off the ropes with a grab and you go straight into the slam. Mash to escape a hold.
- **The ropes are springy.** Run into them to rebound; attacks out of a rebound hit harder
  (jab = clothesline, heavy = dropkick).
- **Opponent on the mat:** jab = stomp, heavy = a flying splash. In exhibitions with pinfalls enabled, press grab beside a downed opponent with empty hands to cover. The defender taps jab in the gold zone to kick out before the referee counts three. Each count gives one attempt.
- **On the mat yourself?** Tap any button to get up sooner. You can only be hit twice while you are down.
- **Ratings** (the bar under your health) fill as you land hits, take hits and taunt. Full ratings buy your
  **signature move**.
- **The crowd throws things in**: folding chair, guitar, gold star award, frying pan, mallet, rubber
  chicken, and a studio clapperboard. Walk over one and press grab; press grab again to throw it. Taunting can earn you one.
- **Curtain Call:** lose the deciding round by knockout and you are left reeling on your feet. Your rival
  has a few seconds to get close and press signature for their finishing move.
- The referee can be flattened by a stray shot. The commentators, Dirk Bluster and Nigel Quibble, have opinions.
- Pick the same celebrity for both corners and the one on the right turns up as a slightly green stunt double.

## The cast

| Fighter             | Who                                  | Signature          | Curtain Call      |
|---------------------|--------------------------------------|--------------------|-------------------|
| Rex Granite         | Straight-to-streaming action hero    | Box Office Bomb    | Director's Cut    |
| Lola Glitz          | Chart-topping pop diva               | High Note          | Mic Drop          |
| Chef Bruno Flambe   | Volcanic TV chef                     | Flambe             | Order Up!         |
| Chip Sterling       | Tech billionaire, allegedly human    | Push Notification  | Launch Day        |
| DJ Wubz             | Festival headliner, face unknown     | Bass Drop          | Wall of Sound     |
| Duchess Winnifred   | Frostiest royal in the tabloids      | Royal Decree       | Off With the Head |
| Vince Voltage       | Stadium rock survivor                | Power Chord        | Encore            |
| Madame Mystica      | Late-night TV psychic                | Crystal Ball       | Tiny Fate         |

## Layout

**Game code** (`Source/ClayPerView/`)
- `CpvPose.*`, `CpvAnims.cpp` - the animation system. Every clip is a handful of hand-sculpted poses
  (joint angles) with eases between them; `FCpvRig` turns a pose into bone transforms for any character's
  proportions, plants the feet, and swaps "replacement" mouths and hands the way stop-motion animators do.
- `CpvPuppet.*` - a clay character: plays clips on a shared stepped clock (12 fps by default), faces,
  blinks, flinches, and hair / hat / belly wobble.
- `CpvFighter.*` - the brawler: movement, strikes, combos, blocking, grapples, whips, knockdowns,
  signature moves, weapons. `CpvAI.*` is the computer opponent; `CpvData.cpp` holds moves and the roster.
- `CpvGame.*` - match flow, input and the camera director. `CpvGameEvents.cpp` - hit feedback, weapons,
  projectiles, referee, commentary, sound. `CpvGameScenes.cpp` - entrances, victory, the eight finishers.
- `CpvArena.*` - assembles the venue from the exported pieces: ropes that bend, 6,700 instanced
  spectators animated in the material, light moods, video screens with a live feed.
- `CpvFx.*` - effects as lumps of clay (bursts, comic words, chunks that stick to the mat).
- `CpvHud.*`, `CpvUi.*` - every screen, drawn on the canvas in a TV-broadcast style.

**Art** (`Art/`)
- `cpv/common.py` - the modelling kit: primitives fused by voxel remesh into smooth "clay", vertex-colour
  painting, automatic skinning, FBX export.
- `cpv/charbase.py`, `cpv/characters.py` - the shared skeleton and the eleven characters.
- `cpv/arena.py`, `cpv/crowd.py`, `cpv/props.py`, `cpv/textures.py` - ring and arena, the audience (with a
  baked sit-to-stand morph), weapons / finisher props / effect shapes, and the thumbprint detail maps.
- `build_art.py` - builds everything into `Art/Export/` (add `--preview` for check renders in `Art/Preview/`).
- `Fonts/` - Titan One, Anton, Barlow Condensed and Bangers, under the SIL Open Font License (texts included).

**Scripts**
- `Scripts/import_assets.py` - editor Python: builds the materials and imports meshes, portraits and audio.
  `CPV_ONLY=materials,arena,crowd,props,characters,ui,audio,data` limits it to some groups.
- `Scripts/make_audio.py` - synthesizes the effects, crowd and music, and speaks the announcer and
  commentary lines through `Scripts/voices.sh`. Speech is rendered ahead of time using the
  [Kokoro-82M v1.0 model](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) and
  [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx). The PA uses Onyx with a short arena
  echo, Dirk uses Puck, and Nigel uses George with British pronunciation. Named commentary is
  synthesized as whole sentences for each fighter or prop in `Content/CPV/Data/commentary.json`.
  The game plays local Unreal SoundWaves. Playback works offline.

  To regenerate only dialogue, install `uv` and `ffmpeg`, then run from the project directory:

      Scripts/voices.sh
      CPV_ONLY=voices Scripts/dev.sh py "$PWD/Scripts/import_assets.py"

  To check every imported voice against its source, run
  `Scripts/dev.sh py "$PWD/Scripts/verify_voices.py"` and look for `CPV_VERIFIED`.

  The first render downloads verified model and voice files into `Saved/Kokoro/` and installs the
  Python dependencies through uv. The same steps run as part of a full asset rebuild.
- `Scripts/export_web.py` - editor Python: writes every mesh as GLB to `Saved/WebExport/` for the browser
  version (`Scripts/dev.sh py "$PWD/Scripts/export_web.py"`, then `npm run assets` in `../web`).
- `Scripts/dev.sh` - `build`, `sync`, `py <script>`, `game [args]` (runs the game and waits; log in
  `Saved/Logs/game.log`, or `Saved/Logs/<name>.log` with `CPV_LOG=<name>` so several can run at once).

## Test flags

From the project directory on an Apple silicon Mac (with `Clay-Per-View-macOS.zip` from the [latest release](https://github.com/nearbycoder/clay-per-view/releases/latest) saved in `../Release/`), `python3 Scripts/verify_broadcast.py` checks the release checksum, extracts an independent copy, verifies its signature and plays Ring School, a pin, a kickout and a three-episode championship. The short championship uses reduced opponent health to exercise progression. For full-health matches, retries and repeat championships, run `python3 Scripts/verify_broadcast.py --soak-minutes 30 --headliner 1 --report Saved/ReleaseQA-Lola`.

To measure the four picture presets on your Mac, close other games and run `python3 Scripts/verify_broadcast.py --benchmark --report Saved/ReleaseQA-Graphics`. The runner plays the same fixed 1080p arena shot twice per preset with the frame cap and VSync disabled, then writes the screenshots and median warmed readings to the report directory. Each test uses its own temporary player profile. These checks run on the packaged game and use Python's standard library.

Pass to `play.sh` or `Scripts/dev.sh game`:

- `-CpvStart=watch|fight|select|menu|intro|finisher` - skip straight to a part of the game
  (`finisher` plays player one's Curtain Call immediately). `-CpvAI` lets the computer play both sides.
- `-CpvP1=<0-7> -CpvP2=<0-7>` - pick fighters. `-CpvFoeHealth=<n>`, `-CpvHype=<n>`, `-CpvWeapon=<1-7>`.
- `-CpvShots=name@seconds,...` saves screenshots to `Saved/Shots/`; `-CpvQuit=<seconds>` exits.
- `-CpvCam=x,y,z,aimx,aimy,aimz[,fov]` fixes the camera; `-CpvNoHud` hides the HUD.
- `-CpvGallery=Clip1,Clip2,... [-CpvChar=Rex] [-CpvFrames=9]` draws film strips of animation clips.
- `-CpvPress=ok@3,down@4,right@5,back@6,pause@20` presses menu buttons at the given times.
- `-CpvKeys=Enter@3,D@10:1.5,J@12,p2.Gamepad_FaceButton_Left@14` sends real key events through the engine's
  input path (`name@seconds[:hold]`; the `p2.` prefix is a pretend second gamepad). `-CpvDummy` makes
  computer-controlled fighters stand still and `-CpvTwo` starts a two-player bout, for testing the controls.
- `-CpvClicks=x:y@seconds,...` simulates viewport-relative menu clicks with values from 0 to 1.
- `-CpvFilm=<name>` saves timed raw viewport frames under `Saved/Shots/<name>/`. Combine them with the captured mix using `Scripts/encode_take.py`.
- `-CpvAudioOut=<name>` records the final sound mix to `Saved/Shots/<name>.wav` (needs `-CpvQuit`).
- `-CpvMash` hands player one to a button-masher that walks forward and hammers jab; with
  `-CpvDifficulty=<0-2>` and `-CpvAutoQuit` (exit at the results screen) it gives a rough read on the
  difficulty levels. Each bout logs a `CPV_RESULT` line (winner, rounds, damage, hits).
- `-LogCmds="LogCpv Verbose"` logs every fighter state change and strike.
- `-CpvStep=<fps>` sets the stop-motion rate (0 = smooth); `-CpvNoCrowd`, `-CpvNoFeed` for profiling.

The log prints a `CPV_PERF` line (average frame rate, worst frame) every five seconds.

The engine's developer shortcuts are switched off in `Config/` (the `~` console, the F1-F5 view modes, the
`;` free camera and the `'` debugger overlay) because they sit on or beside keys the game uses.

On Mac the packaged app opens in a window, including when an older Unreal profile last used borderless mode. The initial window for a new player is 1280×720. After the window is drawing and the app is in front, the game applies the saved full-screen preference. This avoids a black first frame and a macOS display transition that can stall in the background. The packaged app and `./play.sh -fullscreen` both support a delayed full-screen start. F11 and **Options → Picture Quality → Display** switch during play. `Scripts/dev.sh game` supplies `-CpvWindow` to keep tests independent of the player's display setting.
