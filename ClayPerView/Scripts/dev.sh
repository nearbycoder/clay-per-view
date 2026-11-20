#!/bin/sh
# Developer helper. Usage:
#   Scripts/dev.sh build                 compile the game module
#   Scripts/dev.sh sync                  compile only if the module is missing or out of step with the engine
#   Scripts/dev.sh py <script.py> [...]  run an editor-Python script headlessly (asset building)
#   Scripts/dev.sh game [args...]        run the game and wait for it to exit (log: Saved/Logs/game.log;
#                                        set CPV_LOG=name to write Saved/Logs/name.log instead)
#
# Other projects may share this source-built engine. When one of them relinks an engine module the
# engine's build id changes and every project's module manifest goes stale ("module could not be
# found"), so `sync` runs before anything that launches the editor binary.
set -e
ENGINE="${UE_ENGINE_DIR:-$HOME/UnrealEngine}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$DIR/ClayPerView.uproject"
EDITOR="$ENGINE/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"

build() {
  "$ENGINE/Engine/Build/BatchFiles/Mac/Build.sh" ClayPerViewEditor Mac Development -Project="$PROJECT" -WaitMutex
}

build_id() { sed -n 's/.*"BuildId": "\(.*\)".*/\1/p' "$1" 2>/dev/null; }

in_sync() {
  [ -f "$DIR/Binaries/Mac/libUnrealEditor-ClayPerView.dylib" ] || return 1
  [ "$(build_id "$DIR/Binaries/Mac/UnrealEditor.modules")" = "$(build_id "$ENGINE/Engine/Binaries/Mac/UnrealEditor.modules")" ] || return 1
  # Any source file newer than the compiled module means a rebuild is due.
  [ -z "$(find "$DIR/Source" -newer "$DIR/Binaries/Mac/libUnrealEditor-ClayPerView.dylib" -type f | head -1)" ]
}

sync() { in_sync || build >"$DIR/Saved/build.log" 2>&1 || { tail -40 "$DIR/Saved/build.log"; exit 1; }; }

mkdir -p "$DIR/Saved/Logs"
CMD="$1"; [ $# -gt 0 ] && shift
case "$CMD" in
  build) build ;;
  sync) sync ;;
  py)
    sync
    SCRIPT="$1"; shift
    rc=0
    "$EDITOR" "$PROJECT" -run=pythonscript -script="$SCRIPT" -unattended -nopause -nosplash -AllowCommandletRendering -stdout -FullStdOutLogOutput "$@" >"$DIR/Saved/Logs/py.log" 2>&1 || rc=$?
    grep -E "CPV_|PROBE_|Traceback|LogPython: Error|could not be found" "$DIR/Saved/Logs/py.log" | cut -c1-400 || true
    [ "$rc" -eq 0 ] || exit "$rc"
    if grep -q "LogPython: Error:" "$DIR/Saved/Logs/py.log"; then exit 1; fi
    ;;
  game)
    sync
    "$EDITOR" "$PROJECT" -game -windowed -CpvWindow -nosplash -unattended -stdout -FullStdOutLogOutput "$@" >"$DIR/Saved/Logs/${CPV_LOG:-game}.log" 2>&1 || true
    ;;
  *) echo "usage: dev.sh build|sync|py <script>|game [args]"; exit 2 ;;
esac
