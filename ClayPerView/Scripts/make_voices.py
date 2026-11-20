"""Render the English voice bank offline. Run through Scripts/voices.sh."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / "Art/Audio"
CACHE = ROOT / "Saved/Kokoro"
# Display name (also forms the commentary asset suffix), spoken pronunciation.
FIGHTERS = {
    "Rex": ("Rex Granite", "Rex Granite"),
    "Lola": ("Lola Glitz", "Lola Glitz"),
    "Bruno": ("Chef Bruno Flambe", "Chef Bruno flambé"),
    "Chip": ("Chip Sterling", "Chip Sterling"),
    "Wubz": ("DJ Wubz", "Deejay Wubs"),
    "Duchess": ("Duchess Winnifred", "Duchess Winnifred"),
    "Vince": ("Vince Voltage", "Vince Voltage"),
    "Mystica": ("Madame Mystica", "Madame Mystica"),
}
PROPS = ("folding chair", "guitar", "gold star award", "frying pan", "mallet", "rubber chicken", "studio clapperboard")
ANNOUNCER = ("am_onyx", "en-us", 1.06)
BOOTH = (("am_puck", "en-us", 1.08), ("bm_george", "en-gb", 1.02))


def lines():
    calls = json.loads((ROOT / "Content/CPV/Data/announcer.json").read_text())
    for key, text in calls.items():
        yield "VO_" + key, text, ANNOUNCER
    for key, (_, name) in FIGHTERS.items():
        yield "VO_Name_" + key, name + "!", ANNOUNCER
        yield "VO_Win_" + key, "Your winner... " + name + "!", ANNOUNCER
    commentary = json.loads((ROOT / "Content/CPV/Data/commentary.json").read_text())
    for event, entries in commentary.items():
        for index, (speaker, text) in enumerate(entries):
            key = f"VO_{event}_{index}"
            text = text.replace("Clay-Per-View", "Clay per view").replace("OHHH", "Oh").replace("KABLOOEY", "Kablooey")
            if "{name}" in text:
                names = [(p, p) for p in PROPS] if event == "weapon" else FIGHTERS.values()
                for display, spoken in names:
                    suffix = display.upper().replace(" ", "_")
                    yield f"{key}_{suffix}", text.replace("{name}", spoken), BOOTH[speaker]
            else:
                yield key, text, BOOTH[speaker]


def main():
    import numpy as np
    import onnxruntime as ort
    from kokoro_onnx import Kokoro

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--missing", action="store_true", help="Render only clips absent from Art/Audio")
    args = parser.parse_args()
    bank = [line for line in lines() if not args.missing or not (AUDIO / (line[0] + ".wav")).exists()]
    if not bank:
        print("Voice bank is up to date")
        return

    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(CACHE / "kokoro-v1.0.onnx"), options, providers=["CPUExecutionProvider"])
    model = Kokoro.from_session(session, str(CACHE / "voices-v1.0.bin"))
    AUDIO.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=AUDIO) as staging:
        for number, (key, text, role) in enumerate(bank, 1):
            voice, language, speed = role
            samples, rate = model.create(text, voice=voice, lang=language, speed=speed)
            if len(samples) < rate * 0.15 or not np.isfinite(samples).all() or np.max(np.abs(samples)) < 0.01:
                raise ValueError(f"Invalid speech for {key}")
            filters = "highpass=f=100,acompressor=threshold=-18dB:ratio=3,loudnorm=I=-16:TP=-1.5"
            if role == ANNOUNCER:
                filters = "highpass=f=150,lowpass=f=6200,aecho=0.85:0.8:65|125:0.20|0.09," + filters
            subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-f", "f32le", "-ar", str(rate),
                            "-ac", "1", "-i", "pipe:0", "-af", filters, "-ar", "44100", "-c:a", "pcm_s16le",
                            str(Path(staging) / (key + ".wav"))], input=samples.astype("<f4").tobytes(), check=True)
            if number % 10 == 0:
                print(f"Rendered {number} ({key})", flush=True)
        for wav in Path(staging).glob("*.wav"):
            os.replace(wav, AUDIO / wav.name)
    print(f"Rendered {number} voice clips")


if __name__ == "__main__":
    main()
