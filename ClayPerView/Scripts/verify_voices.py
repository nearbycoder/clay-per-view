"""Run in Unreal editor Python to compare every expected SoundWave to its generated PCM."""
from array import array
from pathlib import Path
import sys
import tempfile
import wave

import unreal

root = Path(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir()))
sys.path.insert(0, str(root / "Scripts"))
from make_voices import lines

count = 0
with tempfile.TemporaryDirectory(dir=root / "Saved") as staging:
    for key, _, _ in lines():
        source = root / "Art/Audio" / (key + ".wav")
        sound = unreal.load_asset("/Game/CPV/Audio/S_" + key)
        if not isinstance(sound, unreal.SoundWave):
            raise ValueError(f"Missing SoundWave for {key}")
        output = Path(staging) / (key + ".wav")
        task = unreal.AssetExportTask()
        task.object = sound
        task.automated = True
        task.prompt = False
        task.filename = str(output)
        if not unreal.Exporter.run_asset_export_task(task):
            raise ValueError(f"Failed to export {key}")
        with wave.open(str(source)) as a, wave.open(str(output)) as b:
            if a.getparams() != b.getparams() or (a.getframerate(), a.getsampwidth(), a.getnchannels()) != (44100, 2, 1):
                raise ValueError(f"Unexpected format or duration for {key}")
            src = array("h", a.readframes(a.getnframes()))
            dst = array("h", b.readframes(b.getnframes()))
        # Unreal's import/export conversion can round by one least-significant bit.
        if not src or max(abs(v) for v in src) < 320 or max(abs(x - y) for x, y in zip(src, dst)) > 1:
            raise ValueError(f"Silent or mismatched samples for {key}")
        count += 1
unreal.log(f"CPV_VERIFIED {count} Unreal voice assets")
