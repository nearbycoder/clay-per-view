#!/bin/sh
# Compile the game. With --assets (or when the content is missing) also rebuild every asset:
# Blender sculpts the models, a synthesizer writes the audio, then the Unreal editor imports it all.
set -e
ENGINE="${UE_ENGINE_DIR:-$HOME/UnrealEngine}"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
DIR="$(cd "$(dirname "$0")" && pwd)"
"$ENGINE/Engine/Build/BatchFiles/Mac/Build.sh" ClayPerViewEditor Mac Development -Project="$DIR/ClayPerView.uproject" -WaitMutex
if [ "$1" = "--assets" ] || [ ! -f "$DIR/Content/CPV/Characters/SK_Rex.uasset" ]; then
  "$BLENDER" -b --factory-startup --python-exit-code 1 --python "$DIR/Art/build_art.py"
  "$BLENDER" -b --factory-startup --python-exit-code 1 --python "$DIR/Art/build_title.py"
  if [ "$1" = "--assets" ] || [ ! -f "$DIR/Art/Audio/Punch.wav" ]; then
    # Blender ships a Python with numpy, which is all the synthesizer needs.
    PYTHON="$(ls "$(dirname "$BLENDER")"/../Resources/*/python/bin/python3* | head -1)"
    "$PYTHON" "$DIR/Scripts/make_audio.py"
  fi
  "$ENGINE/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor" "$DIR/ClayPerView.uproject" \
    -run=pythonscript -script="$DIR/Scripts/import_assets.py" -unattended -nopause -nosplash -AllowCommandletRendering
fi
