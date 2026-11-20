"""Builds every model for Clay-Per-View and exports FBX + layout data to Art/Export.

    blender -b --factory-startup --python Art/build_art.py -- [textures] [arena] [crowd] [props] [fighters] [name ...] [--preview]

With no group names everything is built. `--preview` also renders check images into Art/Preview.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

from cpv import common  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
preview = "--preview" in args
groups = [a for a in args if not a.startswith("--")]


def want(name):
    return not groups or name in groups


if want("textures"):
    from cpv import textures
    common.reset_scene()
    textures.build_all()

if want("arena"):
    from cpv import arena
    common.reset_scene()
    objs, layout = arena.build_all()
    if preview:
        common.setup_preview(res=(1600, 900), bg=(0.02, 0.02, 0.03))
        common.add_point_light((0, 0, 700), 6e7)
        for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            common.add_point_light((sx * 1500, sy * 1500, 1300), 5e8, (0.7, 0.8, 1.0), 200.0)
        common.add_point_light((-1300, 0, 500), 6e7, (1.0, 0.8, 0.9))
        common.render("arena_hardcam.png", (0, -1120, 255), (0, 60, 40), lens=32)
        common.render("arena_ring_close.png", (430, -620, 260), (0, 0, 20), lens=35)
        common.render("arena_wide.png", (1500, -2300, 1150), (-200, 0, 150), lens=24)
        common.render("arena_stage.png", (-560, -160, 60), (-2000, 0, 330), lens=28)
        common.render("arena_top.png", (0, 0, 1700), (0, 1, 0), lens=22)

if want("crowd"):
    from cpv import crowd
    common.reset_scene()
    crowd.build_all(preview)

if want("props"):
    from cpv import props
    common.reset_scene()
    props.build_all(preview)

GROUPS = ("textures", "arena", "crowd", "props", "fighters")
if want("fighters") or any(g not in GROUPS for g in groups):
    from cpv import characters
    names = [g for g in groups if g not in GROUPS]
    characters.build_all(names or None, preview)

common.log("done")
