#!/bin/sh
# Launch Clay-Per-View using the source-built Unreal editor binary. Extra arguments are passed through,
# e.g.  ./play.sh -fullscreen   or   ./play.sh -ResX=2560 -ResY=1440
ENGINE="${UE_ENGINE_DIR:-$HOME/UnrealEngine}"
DIR="$(cd "$(dirname "$0")" && pwd)"
"$DIR/Scripts/dev.sh" sync   # recompiles only if the module is missing or out of step with the engine
# Defaults: a 1920x1080 window. The engine takes the first value it sees, so yours go first.
SIZE="-ResX=1920 -ResY=1080"
case " $* " in *" -ResX="*) SIZE="" ;; esac
# This engine build hangs if it starts in full screen, so -fullscreen is handed to the game instead,
# which opens its window first and then switches (F11 and Options > Display do the same).
FULL=""
for arg in "$@"; do
  shift
  case "$arg" in -fullscreen|-Fullscreen|-FullScreen) FULL="-CpvFullscreen" ;; *) set -- "$@" "$arg" ;; esac
done
open -n "$ENGINE/Engine/Binaries/Mac/UnrealEditor.app" --args "$DIR/ClayPerView.uproject" -game "$@" -windowed $SIZE $FULL
