# Clay-Per-View 1.0.0 playtest

**Mac Shipping build · November 18, 2026**  
The tests ran on an Apple M5 Max with macOS 27.3. The app targets Apple silicon and declares macOS 14 as its minimum. The two-controller checks sent simulated controller events through Unreal's input system. Physical controllers, interactive macOS full-screen transitions, a second Mac and older macOS versions still need hands-on coverage.

## What passed

| Test | Observed result |
| --- | --- |
| Starting the release | The archive checksum and app signature verified after extraction. macOS Launch Services displayed the title and accepted Enter to reach the main menu in two runs. A fresh profile opened at 1280×720. A legacy borderless profile opened in a 1440×900 window. The native viewport captures showed the ring, crowd and menu in both. |
| Ring School | The player landed a jab, guarded a strike, performed a body slam and used the signature. The coach confirmed all four moves and returned the player to casting. |
| Ratings Run | An accelerated three-episode run reached the belt and saved a personal best. Rex’s 8/9 and Lola’s 9/9 survived three separate launches and appeared together on the casting screen. |
| Full-health championships | The final app played for 30 minutes as Chef Bruno, completing 36 bouts and 10 championships. Earlier candidates with the same combat and render-graph settings played 36 minutes as Rex (46 bouts, 11 titles) and 30 minutes as Lola (35 bouts, 6 titles). All three ran at normal health against active opponents and included retries after losses. |
| Finishers, pins and replays | All eight Curtain Calls reached the results screen. A three-count ended a bout, a timed defensive input broke a cover and the referee’s three counts played. The same hold and escape inputs also worked at 1080p on Low with a 30 FPS cap and High with a 120 FPS cap. The ringside replay played changing frames, then returned to the scorecard and rematch. |
| Exhibition rules and difficulty | A tie at the bell led to a second round. A health lead at the bell settled the bout. The same full-health Lola–Mystica matchup also reached results against each of the three opponent difficulties in the release. |
| Roster soak | In the editor game, 24 full-health AI exhibitions covered every headliner at each difficulty. All reached a decision. They produced 36 covers, 28 kickouts and 70 perfect guards. |
| Local controls and settings | Both simulated controllers dealt damage. Pausing, changing quality and resuming preserved the match. From Credits, the player returned to the menu, cast an AI exhibition, watched it reach a decision, and separately verified Quit. The casting and options pages accepted clicks at 1024×768, 1440×900 and 1920×800. The final picture menu survived seven mid-match preset changes and fourteen screenshot checks. |
| Sound and language | All 225 imported English voice clips matched their source audio within one 16-bit sample value. Together they contain 11 minutes of speech. The Portuguese catalog resolves every playable voice ID, and the subtitle typeface contains all 70 distinct characters it uses. Music, speech, effects, crowd and menu buses each produced an isolated signal. Master mute produced digital silence, restored the mix and muted again. Brazilian Portuguese subtitles appeared in game, and subtitle language, flash bulbs, camera shake and pin settings persisted. |
| Trailer | The complete 46.5-second 1080p file decoded with stereo 48 kHz audio and two selectable caption tracks. The final mix measured −15.5 LUFS integrated and −1.5 dBTP. |

## Picture quality and frame rate

Two 38-second runs per manual preset used the same 1920×1080 window, camera, wrestlers and active crowd. The wrestlers stayed in place. The game ran without its FPS cap or VSync. The figures are medians of the in-game FPS meter readings after the first nine seconds. Milliseconds per frame are computed from each median. Frame rates during moving bouts and on other machines can differ.

| Preset | Render scale | Median FPS | ms/frame | Samples |
| --- | ---: | ---: | ---: | ---: |
| Low | 60% | 119.9 | 8.3 | 30 |
| Medium | 85% | 120.0 | 8.3 | 29 |
| High | 100% | 99.5 | 10.1 | 29 |
| Ultra | 125% | 50.6 | 19.8 | 30 |

[Compare the captured Low and Ultra frames](Picture-presets.jpg)

A pre-release build crashed during deferred render-graph cleanup on Metal. The Mac build now waits for the pass work to finish before destroying its graph. Ten repeated screenshot-heavy arena tests passed with that change. All three endurance sessions and all eight measured runs completed with the corrected settings active.

## Reproduce

From the ClayPerView project directory on an Apple silicon Mac, run the relevant command. Each extracts the shipped zip, checks the signature and uses an isolated player profile.

```sh
python3 Scripts/verify_broadcast.py
python3 Scripts/verify_broadcast.py --soak-minutes 30 --headliner 1 --report Saved/ReleaseQA-Lola
python3 Scripts/verify_broadcast.py --benchmark --report Saved/ReleaseQA-Graphics
```

The last packaging change updated the external credits text. A byte comparison checked all 75 other ZIP entries, including the executable, libraries, content and signatures. The resulting archive passed a fresh launch, Ring School, both pin outcomes and a three-bout title run. The frame-rate suite also used this archive.

**Tested archive SHA-256**  
`a3c99a283a464009aec9dbf9732efe2ecc564cf511dd3637e95eb5bafa3d1244`

The downloadable bundle has an ad-hoc signature. Gatekeeper rejected it for public distribution. A local rehearsal of the owner’s signing script checked hardened signatures on all 12 code items and verified that the five cooked content containers retained their hashes. Apple’s loader rejected the hardened ad-hoc rehearsal because it lacked a recognized signing identity. A separately signed local copy with the development search paths removed reached the main menu. A real Developer ID signature, notarization and a test of the resulting public archive are still outstanding. [Apple distribution guide](https://developer.apple.com/developer-id/)
