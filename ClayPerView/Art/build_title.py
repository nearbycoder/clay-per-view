"""Build the title belt, its in-menu render, and the macOS application icon from the same sculpt."""
import json
from pathlib import Path
import sys

import bpy

art = Path(__file__).resolve().parent
sys.path.insert(0, str(art))
from cpv import common, props

def scene(icon=False):
    common.reset_scene()
    model = props.belt(icon)
    if not icon:
        common.export_fbx([model], "SM_Belt.fbx")
    common.setup_preview(res=(1024, 1024) if icon else (1400, 620), bg=(0.22, 0.23, 0.25), samples=48)
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.render.image_settings.color_mode = 'RGBA'
    return model

scene()
dest = art / "Export" / "Portraits" / "P_TitleBelt.png"
dest.parent.mkdir(parents=True, exist_ok=True)
common.render(str(dest), (155, -15, 23), (0, 0, 1.5), ortho=118)

scene(icon=True)
catalog = art.parent / "Build/Mac/Resources/Assets.xcassets"
icons = catalog / "AppIcon.appiconset"
icons.mkdir(parents=True, exist_ok=True)
master = art / "Preview" / "title_icon.png"
common.render(str(master), (110, -19, 18), (0, 0, 4), ortho=42)
import subprocess
images = []
for size in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        file = f"icon_{size}" + ("@2x" if scale == 2 else "") + ".png"
        subprocess.run(["sips", "-z", str(size * scale), str(size * scale), str(master), "--out", str(icons / file)], check=True,
                       stdout=subprocess.DEVNULL)
        images.append({"idiom":"mac", "size": f"{size}x{size}", "scale": f"{scale}x", "filename": file})
info = {"author":"xcode", "version":1}
(icons/"Contents.json").write_text(json.dumps({"images":images, "info":info}, indent=2)+"\n")
(catalog/"Contents.json").write_text(json.dumps({"info":info}, indent=2)+"\n")
