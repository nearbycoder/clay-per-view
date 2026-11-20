#!/bin/sh
# Set up the build-time synthesizer and regenerate the voice sources.
set -eu
cd "$(dirname "$0")/.."
cache=Saved/Kokoro
mkdir -p "$cache"
fetch() {
  file="$cache/$1"
  if ! echo "$2  $file" | shasum -a 256 -c --status; then
    tmp=$(mktemp "$cache/download.XXXXXX")
    trap 'rm -f "$tmp"' EXIT
    curl -fL --retry 3 -o "$tmp" "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/$1"
    echo "$2  $tmp" | shasum -a 256 -c
    mv "$tmp" "$file"
  fi
}
fetch kokoro-v1.0.onnx 7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5
fetch voices-v1.0.bin bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d
uv run --python 3.12 --no-project --with kokoro-onnx==0.4.9 python Scripts/make_voices.py
