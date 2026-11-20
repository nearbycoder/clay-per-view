"""Play the extracted Mac release through its ordinary menus. Use --soak-minutes for a full-health endurance run."""
import argparse
import configparser
import csv
import hashlib
import json
from pathlib import Path
import platform
import plistlib
import shutil
from statistics import median
import subprocess
import tempfile
import time
import uuid

TITLE, MENU, OPTIONS, SCHOOL, CAST, VERSUS, INTRO, ROUND_INTRO, FIGHT, ROUND_END, FINISHER, VICTORY, RESULTS, CREDITS = range(14)
ROOT = Path(__file__).resolve().parents[1]


def archive_sha256(archive):
    checksum = hashlib.sha256()
    with archive.open("rb") as package:
        for chunk in iter(lambda: package.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def verify_build(archive, workspace):
    expected = Path(str(archive) + ".sha256").read_text().split()[0]
    actual = archive_sha256(archive)
    if actual != expected:
        raise ValueError("Build checksum mismatch")
    subprocess.run(["ditto", "-x", "-k", archive, workspace], check=True)
    app = workspace / "Clay-Per-View/Clay-Per-View.app"
    subprocess.run(["codesign", "--verify", "--deep", "--strict", app], check=True)
    with (app / "Contents/Info.plist").open("rb") as f:
        info = plistlib.load(f)
    executable = app / "Contents/MacOS" / info["CFBundleExecutable"]
    saved = Path.home() / "Library/Containers" / info["CFBundleIdentifier"] / "Data/Library/Application Support/Epic/ClayPerView/Saved"
    return executable, saved, actual


def play(executable, saved, report, name, seconds, flags, settings, size=(1280, 720), capture=None, desktop_launch=False):
    profile_dir = saved / "ContestQAProfiles"
    profile_dir.mkdir(parents=True, exist_ok=True)
    take = "qa_" + uuid.uuid4().hex[:12]
    config = profile_dir / (take + ".ini")
    # Exercise the old borderless preference when entering through macOS Launch Services.
    old_window = "FullscreenMode=1\nLastConfirmedFullscreenMode=1\n" if desktop_launch else ""
    config.write_text("[/Script/Engine.GameUserSettings]\nVersion=5\n" + old_window + "\n[ClayPerView.Options]\n" + settings + "\n")
    trace = saved / "MatchTests" / (take + ".tsv")
    if desktop_launch:
        args = ["open", "-g", "-W", "-n", executable.parents[2], "--args"]
    else:
        args = [executable, "-windowed", "-CpvWindow", "-nosplash", "-unattended", f"-ResX={size[0]}", f"-ResY={size[1]}"]
    args += [f"-GameUserSettingsINI={config}", f"-CpvAudit={take}", f"-CpvQuit={seconds}", *flags]
    shot = saved / "Shots" / (take + ".png")
    captured = False
    if capture is not None:
        args.append(f"-CpvShots={take}@{capture}")
    start = time.monotonic()
    try:
        with (report / (name + ".log")).open("w") as log, (report / (name + "-memory.tsv")).open("w", buffering=1) as memory:
            memory.write("wall_seconds\trss_MiB\n")
            with subprocess.Popen(args, cwd=report, stdout=log, stderr=subprocess.STDOUT) as game:
                deadline = start + seconds * 1.4 + 90
                while game.poll() is None:
                    if time.monotonic() > deadline:
                        game.terminate()
                        try: game.wait(timeout=5)
                        except subprocess.TimeoutExpired: game.kill()
                        raise TimeoutError(name + " exceeded the playtest limit")
                    if not desktop_launch:
                        rss = subprocess.run(["ps", "-o", "rss=", "-p", str(game.pid)], capture_output=True, text=True).stdout.strip()
                        if rss.isdigit(): memory.write(f"{time.monotonic()-start:.1f}\t{int(rss)/1024:.1f}\n")
                    try: game.wait(timeout=10)
                    except subprocess.TimeoutExpired: pass
                if game.returncode:
                    raise RuntimeError(f"{name} exited with code {game.returncode}")
    finally:
        if trace.exists(): shutil.copyfile(trace, report / (name + ".tsv"))
        if config.exists(): shutil.copyfile(config, report / (name + ".ini"))
        trace.unlink(missing_ok=True)
        config.unlink(missing_ok=True)
        if capture is not None and shot.exists():
            shutil.move(str(shot), str(report / (name + ".png")))
            captured = True
    if capture is not None and not captured:
        raise RuntimeError(name + " did not capture its viewport")
    with (report / (name + ".tsv")).open() as f:
        if f.readline().strip() != "# ParallelExecute=1 ParallelDestruction=0":
            raise RuntimeError("Mac renderer settings did not reach the packaged game")
        rows = list(csv.DictReader(f, delimiter="\t"))
    if not rows: raise ValueError(name + " produced an empty broadcast trace")
    return rows


def phases(rows):
    return {int(row["phase"]) for row in rows}


def smoke(exe, saved, report):
    launch = play(exe, saved, report, "mac-launch", 15, ["-CpvKeys=Enter@5"], "Volume=3", capture=10, desktop_launch=True)
    assert phases(launch) == {TITLE, MENU}, "Mac desktop launch did not reach the main menu"
    assert (report / "mac-launch.png").stat().st_size > 32000, "The desktop launch produced a blank menu"
    print("PASS native Mac launch with a saved borderless mode", flush=True)
    school = play(exe, saved, report, "school", 53, [
        "-CpvClicks=.5:.75@1.4,.18:.635@3", "-CpvKeys=Enter@5,D@7:1.1,J@8.1,J@8.7,J@9.4,J@10.1,J@10.8,"
        "I@12:9,L@23,K@23.6,L@26,K@26.6,L@29,K@29.6,U@33,U@35,U@38,Enter@45"],
        "Volume=4\nPortugueseSubtitles=True")
    assert {TITLE, MENU, SCHOOL, FIGHT, CAST} <= phases(school), "Rehearsal did not return to casting"
    assert max(int(r["lesson"]) for r in school) == 4, "Coach did not confirm all four real moves"
    print("PASS four Ring School cues and return to casting", flush=True)
    for name, keys, expected_victory in [
        ("pin", "", True), ("kickout", ",Comma@9.51,Comma@11.02", False)]:
        bout = play(exe, saved, report, name, 23, ["-CpvStart=fight", "-CpvTwo", "-CpvP1=0", "-CpvP2=3",
            "-CpvKeys=D@5.05:1.1,H@6.45,G@6.95,H@8.6,H@8.94"+keys],
            "RoundsToWin=1\nPins=True\nFrameLimit=1")
        assert any(int(row["pin"]) == 0 for row in bout), "Cover did not start"
        assert (VICTORY in phases(bout)) == expected_victory
        assert (RESULTS in phases(bout)) == expected_victory
        print("PASS", name, flush=True)
    keys = ",".join(f"Enter@{s}" for s in range(1, 88, 2))
    run = play(exe, saved, report, "championship", 91,
               ["-CpvDummy", "-CpvMash", "-CpvFoeHealth=1", "-CpvKeys=" + keys], "Difficulty=1")
    assert {int(r["episode"]) for r in run if int(r["phase"]) == VICTORY and int(r["winner"]) == 0} == {1,2,3}
    config = configparser.ConfigParser(strict=False)
    config.read(report / "championship.ini")
    best = config.getint("ClayPerView.Champions", "Best_1_0")
    assert 3 <= best <= 9
    print(f"PASS three-bout championship and saved personal best {best}/9", flush=True)


def endurance(exe, saved, report, minutes, headliner):
    seconds = minutes * 60
    # Confirmation advances completed cards and retries losses. The match itself uses the
    # novice input driver, ordinary health, the real ring clock and the selected opponent AI.
    keys = ",".join(f"Enter@{s}" for s in range(7, seconds, 3))
    # The roster has two rows of four portrait buttons in the HUD's 1920 x 1080 design.
    x = (646 + 160 * (headliner % 4) + 74) / 1920
    y = (716 + 160 * (headliner // 4) + 74) / 1080
    traces = play(exe, saved, report, "endurance", seconds,
                  ["-CpvMash", f"-CpvClicks=.5:.75@1.3,.18:.267@3,{x:.4f}:{y:.4f}@5", "-CpvKeys=" + keys],
                  "Difficulty=0\nVolume=5\nFrameLimit=1")
    winners = []
    prev = None
    for row in traces:
        phase = int(row["phase"])
        if phase == VICTORY and prev != phase: winners.append((int(row["episode"]), int(row["winner"])))
        prev = phase
    assert winners, "No full-health bout reached a decision"
    assert len(traces) > minutes * 15, "Playtest trace has a long sampling gap"
    print(f"PASS {minutes} minute broadcast, {len(winners)} completed bouts, {winners.count((3,0))} championships", flush=True)


def benchmark(exe, saved, report):
    presets = {"Low": (0, 1, 0), "Medium": (1, 3, 1), "High": (2, 4, 1), "Ultra": (3, 5, 3)}
    groups = ("Shadows", "Lighting", "Textures", "AntiAliasing", "Effects", "PostProcess")
    samples = {preset: [] for preset in presets}
    rounds = {}
    for index, preset in enumerate(("High", "Low", "Ultra", "Medium", "Medium", "Ultra", "Low", "High")):
        tier, scale, feed = presets[preset]
        settings = [f"{group}={tier}" for group in groups]
        settings += [f"RenderScale={scale}", f"FeedRate={feed}", "FrameLimit=5", "VSync=False", "PerformanceHud=True", "Volume=0"]
        name = f"graphics-{index + 1}-{preset}"
        rows = play(exe, saved, report, name, 38,
                    ["-CpvStart=fight", "-CpvDummy", "-CpvP1=0", "-CpvP2=1", "-CpvCam=0,900,290,0,0,85,40"],
                    "\n".join(settings), size=(1920, 1080), capture=19)
        warm = [float(row["fps"]) for row in rows if int(row["phase"]) == FIGHT and float(row["seconds"]) > 9]
        if len(warm) < 12 or min(warm) <= 0:
            raise RuntimeError(f"{name} did not produce enough positive, warmed frame-rate samples")
        samples[preset].extend(warm)
        rounds[name] = warm
        print(f"{name}  {median(warm):.1f} FPS across {len(warm)} readings", flush=True)

    metrics = {preset: {"n": len(values), "fps": round(median(values), 1), "ms": round(1000 / median(values), 1)}
               for preset, values in samples.items()}
    cpu = subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip()
    summary = {"hardware": cpu, "macOS": platform.mac_ver()[0], "resolution": [1920, 1080],
               "build": (report / "tested-build.sha256").read_text().strip(), "presets": metrics, "samples": rounds}
    (report / "final-benchmark.json").write_text(json.dumps(summary, indent=2) + "\n")
    for preset, values in metrics.items():
        print(f"{preset:6}  {values['fps']:5.1f} FPS  {values['ms']:5.1f} ms/frame", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=ROOT.parent / "Release/Clay-Per-View-macOS.zip")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--soak-minutes", type=int, default=0)
    mode.add_argument("--benchmark", action="store_true", help="Measure the four 1080p graphics presets twice")
    parser.add_argument("--headliner", type=int, choices=range(8), default=0, help="Roster slot for the endurance run")
    parser.add_argument("--report", type=Path, default=ROOT / "Saved/ReleaseQA")
    args = parser.parse_args()
    if platform.system() != "Darwin": parser.error("The Mac release needs macOS to run")
    if args.soak_minutes < 0: parser.error("Use a positive endurance duration")
    report = args.report.resolve()
    report.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="unpacked-",dir=report) as temp:
        exe, saved, digest = verify_build(args.archive.resolve(), Path(temp))
        (report / "tested-build.sha256").write_text(digest + "\n")
        if args.benchmark: benchmark(exe, saved, report)
        elif args.soak_minutes: endurance(exe, saved, report, args.soak_minutes, args.headliner)
        else: smoke(exe, saved, report)


if __name__ == "__main__":
    main()
