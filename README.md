# Clay-Per-View

**Famous Last Blows** is a local wrestling game about eight fictional stars fighting to stay on television. Win three broadcasts in the Ratings Run, or cast either side of an exhibition with a friend. The desktop game is built with Unreal Engine and Blender; the browser version is a TypeScript port on three.js.

[Play in your browser](https://nearbycoder.github.io/clay-per-view/play/) · [Website](https://nearbycoder.github.io/clay-per-view/) · [Download the macOS build](https://github.com/nearbycoder/clay-per-view/releases/latest) · [Watch the trailer](https://github.com/nearbycoder/clay-per-view/releases/latest/download/Clay-Per-View-Trailer.mp4) · [Contest entry and press materials](Release/ENTRY.md) · [Playtest and measured frame rates](Release/PLAYTEST.md)

For a first bout, choose Ring School. The coach teaches a jab, a block, a body slam and a signature in the ring.

## In this repository

- [`ClayPerView/`](ClayPerView) is the Unreal Engine project: C++ game code, the Blender scripts that sculpt every model, and the audio and import scripts. Run `./build.sh` and `./play.sh` there. The [project guide](ClayPerView/README.md) covers controls, visual quality, sound, asset generation and playtesting.
- [`web/`](web) is the browser version and the website, published with GitHub Pages. Run `npm install` and `npm run dev` there. The [web guide](web/README.md) explains how the port mirrors the C++ and how its assets are made.
- [`Release/`](Release) holds the contest entry text, the playtest report and the press stills. The macOS build, the press kit archive and the full-quality trailer are attached to the [latest release](https://github.com/nearbycoder/clay-per-view/releases/latest).

The macOS build is ad-hoc signed, not notarized: the first time, right-click the app and choose Open, or allow it under System Settings › Privacy & Security.
