"""Exports every mesh the game uses as GLB for the web version (web/ at the repository root).

Run headlessly through the editor:
    Scripts/dev.sh py "$PWD/Scripts/export_web.py"

Unreal's own glTF exporter writes the render data exactly as the game draws it: positions in metres
with Y up, the sRGB vertex colours (roughness in alpha), every UV channel (the crowd keeps its seated
pose in channels 1 and 2), skin weights and the reference skeleton. Materials are not baked: the web
build has its own clay shaders and picks one from the slot names listed in manifest.json.

Output: Saved/WebExport/<Mesh>.glb and Saved/WebExport/manifest.json. web/tools/build-assets.mjs then
compresses them into web/public/assets/models/.
"""
import json
import os

import unreal

PROJECT = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
OUT = os.path.join(PROJECT, "Saved", "WebExport")
ROOT = "/Game/CPV"
GROUPS = ("Arena", "Crowd", "Props", "Characters")

eal = unreal.EditorAssetLibrary


def log(msg):
    unreal.log("CPV_" + msg)


def options():
    o = unreal.GLTFExportOptions()
    for key, value in (
        ("export_uniform_scale", 0.01),
        ("export_preview_mesh", False),
        ("skip_near_default_values", False),
        ("export_proxy_materials", False),
        ("use_importer_material_mapping", False),
        ("bake_material_inputs", unreal.GLTFMaterialBakeMode.DISABLED),
        ("texture_image_format", unreal.GLTFTextureImageFormat.NONE),
        ("default_level_of_detail", 0),
        ("export_source_model", False),
        ("export_vertex_colors", True),
        ("export_vertex_skin_weights", True),
        ("make_skinned_meshes_root", True),
        ("use_mesh_quantization", False),
        ("export_morph_targets", False),
        ("export_level_sequences", False),
        ("export_animation_sequences", False),
        ("export_lights", False),
        ("export_cameras", False),
        ("export_material_variants", unreal.GLTFMaterialVariantMode.NONE),
    ):
        o.set_editor_property(key, value)
    return o


def vec(v):
    return [round(v.x, 4), round(v.y, 4), round(v.z, 4)]


def describe(asset):
    skeletal = isinstance(asset, unreal.SkeletalMesh)
    slots = asset.get_editor_property("materials" if skeletal else "static_materials")
    bounds = asset.get_bounds()
    return {
        "skeletal": skeletal,
        "slots": [str(s.get_editor_property("material_slot_name")) for s in slots],
        "materials": [s.get_editor_property("material_interface").get_name() if s.get_editor_property("material_interface") else ""
                      for s in slots],
        "origin": vec(bounds.origin),
        "extent": vec(bounds.box_extent),
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    opts = options()
    manifest = {}
    failed = []
    for group in GROUPS:
        for path in sorted(eal.list_assets(f"{ROOT}/{group}", recursive=False, include_folder=False)):
            asset = unreal.load_asset(path.split(".")[0])
            if not isinstance(asset, (unreal.StaticMesh, unreal.SkeletalMesh)):
                continue
            name = asset.get_name()
            target = os.path.join(OUT, name + ".glb")
            ok = unreal.GLTFExporter.export_to_gltf(asset, target, opts, set())
            if ok is None or ok is False or not os.path.isfile(target):
                failed.append(name)
                log(f"WEB_FAILED {name}")
                continue
            info = describe(asset)
            info["group"] = group
            manifest[name] = info
            log(f"WEB_EXPORTED {name} {os.path.getsize(target)} bytes slots={info['slots']} materials={info['materials']}")
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    log(f"WEB_DONE {len(manifest)} meshes, {len(failed)} failed {failed}")
    if failed:
        raise RuntimeError(f"glTF export failed for {failed}")


main()
