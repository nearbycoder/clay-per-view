"""Encode a -CpvFilm take with its -CpvAudioOut WAV, preserving measured frame and audio timing."""
import argparse
import bisect
import mmap
from pathlib import Path
import subprocess

def encode(folder, wav, output):
    frames = []
    audio_stamp = None
    for line in (folder / "timing.tsv").read_text().splitlines():
        kind, timestamp, *size = line.split("\t")
        if kind == "audio":
            audio_stamp = float(timestamp)
        elif kind == "frame":
            frames.append((float(timestamp), int(size[0]), int(size[1])))
    if len(frames) < 2 or audio_stamp is None:
        raise ValueError("Take requires captured frames and a recorded submix")
    times = [row[0] for row in frames]
    width, height = frames[0][1:]
    frame_bytes = width * height * 4
    raw = folder / "frames.bgra"
    if raw.stat().st_size != len(frames) * frame_bytes:
        raise ValueError("Incomplete frame capture")
    duration = times[-1] - times[0] + 1/30
    output.parent.mkdir(parents=True, exist_ok=True)
    command = ["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y","-f","rawvideo","-pix_fmt","bgra",
               "-video_size", f"{width}x{height}", "-framerate","30","-i","pipe:0","-itsoffset",str(audio_stamp-times[0]),
               "-i",str(wav),"-map","0:v","-map","1:a","-c:v","libx264","-crf","17","-preset","veryfast",
               "-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-af","apad","-t",f"{duration:.4f}","-movflags","+faststart",str(output)]
    with raw.open("rb") as handle, mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as pixels:
        with subprocess.Popen(command, stdin=subprocess.PIPE) as proc:
            for i in range(round(duration * 30)):
                frame = max(0, bisect.bisect_right(times, times[0] + i/30) - 1)
                proc.stdin.write(pixels[frame*frame_bytes:(frame+1)*frame_bytes])
            proc.stdin.close()
            if proc.wait(): raise RuntimeError("ffmpeg failed to encode the take")
    print(f"{output.name}: {len(frames)} captured frames, {duration:.2f}s, {width}x{height}", flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("take","wav","output"):
        parser.add_argument(name,type=Path)
    args = parser.parse_args()
    encode(args.take,args.wav,args.output)
