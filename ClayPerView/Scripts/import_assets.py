"""Builds Clay-Per-View's Unreal content from Art/Export: textures, materials, meshes, characters, audio.

Run headlessly through the editor (see Scripts/dev.sh and build.sh):
    UnrealEditor ClayPerView.uproject -run=pythonscript -script=Scripts/import_assets.py -AllowCommandletRendering
Set CPV_ONLY=materials,arena,crowd,props,characters,ui,audio,data to rebuild just some groups.
"""
import os
import shutil

import unreal

PROJECT = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
EXPORT = os.path.join(PROJECT, "Art", "Export")
ROOT = "/Game/CPV"
ONLY = [s for s in os.environ.get("CPV_ONLY", "").split(",") if s]

tools = unreal.AssetToolsHelpers.get_asset_tools()
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
ME = unreal.MaterialProperty


def want(group):
    return not ONLY or group in ONLY


def log(msg):
    unreal.log("CPV_" + msg)


# ======================================================================================================
# Import helpers
# ======================================================================================================

def import_file(path, dest, name=None, options=None):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", path)
    task.set_editor_property("destination_path", dest)
    if name:
        task.set_editor_property("destination_name", name)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    if options is not None:
        task.set_editor_property("options", options)
    tools.import_asset_tasks([task])
    return [str(p) for p in task.get_editor_property("imported_object_paths")]


def mesh_pipeline(skeletal, full_precision_uvs=False):
    p = unreal.InterchangeGenericAssetsPipeline()
    p.set_editor_property("use_source_name_for_asset", True)
    common = p.get_editor_property("common_meshes_properties")
    common.set_editor_property("force_all_mesh_as_type",
                               unreal.InterchangeForceMeshType.IFMT_SKELETAL_MESH if skeletal else unreal.InterchangeForceMeshType.IFMT_STATIC_MESH)
    common.set_editor_property("vertex_color_import_option", unreal.InterchangeVertexColorImportOption.IVCIO_REPLACE)
    common.set_editor_property("recompute_normals", False)
    common.set_editor_property("recompute_tangents", True)
    common.set_editor_property("use_full_precision_u_vs", full_precision_uvs)
    mesh = p.get_editor_property("mesh_pipeline")
    mesh.set_editor_property("import_static_meshes", not skeletal)
    mesh.set_editor_property("import_skeletal_meshes", skeletal)
    mesh.set_editor_property("combine_static_meshes_behavior", unreal.InterchangeCombineStaticMeshesBehavior.ALL)
    mesh.set_editor_property("generate_lightmap_u_vs", False)
    mesh.set_editor_property("build_nanite", False)
    mesh.set_editor_property("collision", False)
    mesh.set_editor_property("create_physics_asset", False)
    mesh.set_editor_property("import_morph_targets", False)
    p.get_editor_property("material_pipeline").set_editor_property("import_materials", False)
    p.get_editor_property("material_pipeline").get_editor_property("texture_pipeline").set_editor_property("import_textures", False)
    p.get_editor_property("animation_pipeline").set_editor_property("import_animations", False)
    override = unreal.InterchangePipelineStackOverride()
    override.add_pipeline(p)
    return override


def import_texture(filename, dest, srgb=True, compression=None, ui=False):
    paths = import_file(os.path.join(EXPORT, filename), dest)
    name = os.path.splitext(os.path.basename(filename))[0]
    tex = unreal.load_asset(f"{dest}/{name}")
    if not tex:
        log(f"TEXTURE_FAILED {filename} {paths}")
        return None
    tex.set_editor_property("srgb", srgb)
    if compression is not None:
        tex.set_editor_property("compression_settings", compression)
    if ui:
        tex.set_editor_property("lod_group", unreal.TextureGroup.TEXTUREGROUP_UI)
        tex.set_editor_property("mip_gen_settings", unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
        tex.set_editor_property("never_stream", True)
    eal.save_asset(f"{dest}/{name}", only_if_is_dirty=False)
    return tex


# ======================================================================================================
# Material graph helper
# ======================================================================================================

class Graph:
    """Creates (or rebuilds in place, so mesh references survive) a material and wires nodes into it."""

    def __init__(self, name):
        self.full = f"{ROOT}/Materials/{name}"
        if eal.does_asset_exist(self.full):
            self.mat = unreal.load_asset(self.full)
            mel.delete_all_material_expressions(self.mat)
        else:
            self.mat = tools.create_asset(name, f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew())
        self.y = -600

    def node(self, cls, x=-900, **props):
        e = mel.create_material_expression(self.mat, cls, x, self.y)
        self.y += 150
        for k, v in props.items():
            e.set_editor_property(k, v)
        return e

    def scalar(self, name, default):
        return self.node(unreal.MaterialExpressionScalarParameter, x=-1300, parameter_name=name, default_value=default)

    def vector(self, name, rgb):
        return self.node(unreal.MaterialExpressionVectorParameter, x=-1300, parameter_name=name,
                         default_value=unreal.LinearColor(rgb[0], rgb[1], rgb[2], 1.0))

    def instance3(self, index, default=(1.0, 1.0, 1.0)):
        return self.node(unreal.MaterialExpressionPerInstanceCustomData3Vector, x=-1300, data_index=index,
                         const_default_value=unreal.LinearColor(default[0], default[1], default[2], 1.0))

    def instance1(self, index, default=0.0):
        return self.node(unreal.MaterialExpressionPerInstanceCustomData, x=-1300, data_index=index, const_default_value=default)

    def custom(self, code, inputs, out_type, x=-500):
        """HLSL node. inputs: list of (pin name, node) or (pin name, node, output name)."""
        e = mel.create_material_expression(self.mat, unreal.MaterialExpressionCustom, x, self.y)
        self.y += 150
        pins = []
        for item in inputs:
            ci = unreal.CustomInput()
            ci.set_editor_property("input_name", item[0])
            pins.append(ci)
        e.set_editor_property("inputs", pins)
        e.set_editor_property("output_type", out_type)
        e.set_editor_property("code", code)
        for item in inputs:
            ok = mel.connect_material_expressions(item[1], item[2] if len(item) > 2 else "", e, item[0])
            if not ok:
                log(f"LINK_FAILED {self.full} pin {item[0]}")
        return e

    def link(self, src, dst, pin, out=""):
        if not mel.connect_material_expressions(src, out, dst, pin):
            log(f"LINK_FAILED {self.full} pin {pin}")

    def out(self, src, prop, out=""):
        if not mel.connect_material_property(src, out, prop):
            log(f"OUT_FAILED {self.full} {prop}")

    def finish(self):
        mel.recompile_material(self.mat)
        eal.save_asset(self.full, only_if_is_dirty=False)
        log(f"MATERIAL {self.full}")
        return self.mat


F1 = unreal.CustomMaterialOutputType.CMOT_FLOAT1
F2 = unreal.CustomMaterialOutputType.CMOT_FLOAT2
F3 = unreal.CustomMaterialOutputType.CMOT_FLOAT3


def build_materials():
    normal_tex = import_texture("Textures/T_ClayNormal.png", f"{ROOT}/Textures", srgb=False,
                                compression=unreal.TextureCompressionSettings.TC_NORMALMAP)
    detail_tex = import_texture("Textures/T_ClayDetail.png", f"{ROOT}/Textures", srgb=False,
                                compression=unreal.TextureCompressionSettings.TC_MASKS)
    default_tex = unreal.load_asset("/Engine/EngineResources/DefaultTexture")

    # ---- M_Clay: every lump of clay in the game ----------------------------------------------------
    # Vertex colour = clay colour (sRGB) with roughness in alpha; thumbprint normal + mottling from the
    # tiling detail maps; Boil jitters the detail every animation step, like re-touched clay.
    g = Graph("M_Clay")
    g.mat.set_editor_property("used_with_skeletal_mesh", True)
    g.mat.set_editor_property("used_with_instanced_static_meshes", True)
    vc = g.node(unreal.MaterialExpressionVertexColor)
    uv = g.node(unreal.MaterialExpressionTextureCoordinate)
    time = g.node(unreal.MaterialExpressionTime)
    tiling = g.scalar("DetailTiling", 1.0)
    boil = g.scalar("Boil", 0.0)
    boil_rate = g.scalar("BoilRate", 12.0)
    uvn = g.custom("float t = floor(Time * Rate);\n"
                   "float2 o = frac(sin(float2(t * 12.9898, t * 78.233)) * 43758.5453);\n"
                   "return UV * Tiling + o * Boil;",
                   [("UV", uv), ("Time", time), ("Rate", boil_rate), ("Tiling", tiling), ("Boil", boil)], F2)
    ntex = g.node(unreal.MaterialExpressionTextureSample, x=-200, texture=normal_tex,
                  sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
    g.link(uvn, ntex, "UVs")
    uvd = g.custom("return UV * 0.37 + 0.31;", [("UV", uvn)], F2)
    dtex = g.node(unreal.MaterialExpressionTextureSample, x=-200, texture=detail_tex,
                  sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
    g.link(uvd, dtex, "UVs")
    nstr = g.scalar("NormalStrength", 1.0)
    normal = g.custom("return normalize(lerp(float3(0.0, 0.0, 1.0), N, S));", [("N", ntex), ("S", nstr)], F3, x=100)
    tint = g.vector("Tint", (1, 1, 1))
    inst = g.instance3(0)
    mottle = g.scalar("Mottle", 0.22)
    cavity = g.scalar("Cavity", 0.35)
    base = g.custom("float3 c = pow(max(VC, 0.0001), 2.2) * Tint * Inst;\n"
                    "c *= 1.0 + (D.g - 0.5) * 2.0 * Mottle;\n"
                    "c *= lerp(1.0, saturate(D.b * 2.0), Cavity);\n"
                    "return c;",
                    [("VC", vc), ("Tint", tint), ("Inst", inst), ("D", dtex), ("Mottle", mottle), ("Cavity", cavity)], F3, x=100)
    rvar = g.scalar("RoughnessVariation", 0.3)
    rough = g.custom("return saturate(A * (1.0 + (D.r - 0.5) * 2.0 * RV));", [("A", vc, "A"), ("D", dtex), ("RV", rvar)], F1, x=100)
    flash = g.scalar("Flash", 0.0)
    flash_col = g.vector("FlashColor", (1, 1, 1))
    emis = g.custom("return C * F * 450.0;", [("C", flash_col), ("F", flash)], F3, x=100)   # the show is exposed for ~1500 lux, so glows are in the hundreds of nits
    spec = g.node(unreal.MaterialExpressionConstant, x=100, r=0.38)
    g.out(base, ME.MP_BASE_COLOR)
    g.out(normal, ME.MP_NORMAL)
    g.out(rough, ME.MP_ROUGHNESS)
    g.out(emis, ME.MP_EMISSIVE_COLOR)
    g.out(spec, ME.MP_SPECULAR)
    g.finish()

    # ---- M_Glow: lamps, LED strips, LED faces -------------------------------------------------------
    g = Graph("M_Glow")
    g.mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    g.mat.set_editor_property("used_with_skeletal_mesh", True)
    g.mat.set_editor_property("used_with_instanced_static_meshes", True)
    vc = g.node(unreal.MaterialExpressionVertexColor)
    tint = g.vector("Tint", (1, 1, 1))
    inst = g.instance3(0)
    power = g.scalar("Intensity", 1400.0)
    emis = g.custom("return pow(max(VC, 0.0001), 2.2) * Tint * Inst * I;", [("VC", vc), ("Tint", tint), ("Inst", inst), ("I", power)], F3)
    g.out(emis, ME.MP_EMISSIVE_COLOR)
    g.finish()

    # ---- M_Crowd: the audience ----------------------------------------------------------------------
    # Per-instance data: 0-2 shirt, 3-5 trousers, 6 skin tone, 7 hair tone, 8 phase, 9 excitability,
    # 10-11 cos/sin of the instance yaw times its scale (to turn mesh-space offsets into world space).
    g = Graph("M_Crowd")
    g.mat.set_editor_property("used_with_instanced_static_meshes", True)
    vc = g.node(unreal.MaterialExpressionVertexColor)
    shirt = g.instance3(0, (0.5, 0.5, 0.5))
    pants = g.instance3(3, (0.2, 0.2, 0.3))
    m1 = g.instance3(6, (0.3, 0.3, 0.0))
    m2 = g.instance3(9, (0.5, 1.0, 0.0))
    uv1 = g.node(unreal.MaterialExpressionTextureCoordinate, coordinate_index=1)
    uv2 = g.node(unreal.MaterialExpressionTextureCoordinate, coordinate_index=2)
    time = g.node(unreal.MaterialExpressionTime)
    hype = g.scalar("Hype", 0.3)
    step = g.scalar("StepRate", 12.0)
    dim = g.scalar("Brightness", 1.0)
    colour = g.custom("float3 skin = lerp(float3(0.82, 0.56, 0.40), float3(0.20, 0.10, 0.05), M1.x);\n"
                      "float3 dark = float3(0.012, 0.009, 0.007);\n"
                      "float3 brown = float3(0.15, 0.065, 0.028);\n"
                      "float3 fair = float3(0.72, 0.52, 0.2);\n"
                      "float3 hair = M1.y < 0.5 ? lerp(dark, brown, M1.y * 2.0) : lerp(brown, fair, M1.y * 2.0 - 1.0);\n"
                      "float rest = saturate(1.0 - VC.r - VC.g - VC.b);\n"
                      "return (VC.r * skin + VC.g * Shirt + VC.b * Pants + rest * hair) * A * Dim;",
                      [("VC", vc), ("A", vc, "A"), ("Shirt", shirt), ("Pants", pants), ("M1", m1), ("Dim", dim)], F3)
    wpo = g.custom("float t = floor(Time * StepRate) / StepRate;\n"
                   "float phase = M1.z;\n"
                   "float excite = M2.x;\n"
                   "float mood = Hype * 1.25 + 0.10 * sin(t * 0.7 + phase * 40.0);\n"
                   "float stand = smoothstep(excite * 0.9 + 0.06, excite * 0.9 + 0.20, mood);\n"
                   "float3 seated = float3(UV1.x, UV1.y, UV2.x);\n"
                   "float wave = UV2.y;\n"
                   "float upper = saturate(-UV2.x / 30.0);\n"
                   "float3 o = seated * (1.0 - stand);\n"
                   "o.x += (1.0 - stand) * upper * sin(t * 1.3 + phase * 30.0) * 2.0;\n"
                   "o.y += (1.0 - stand) * upper * sin(t * 0.9 + phase * 17.0) * 1.5;\n"
                   "float bob = abs(sin(t * 5.5 + phase * 50.0));\n"
                   "o.z += stand * bob * 6.0;\n"
                   "o.y += stand * wave * sin(t * 6.5 + phase * 21.0) * 10.0;\n"
                   "o.x += stand * wave * cos(t * 6.5 + phase * 21.0) * 4.0;\n"
                   "float c = M2.y;\n"
                   "float s = M2.z;\n"
                   "float k = length(float2(c, s));\n"
                   "return float3(o.x * c - o.y * s, o.x * s + o.y * c, o.z * k);",
                   [("Time", time), ("StepRate", step), ("Hype", hype), ("M1", m1), ("M2", m2), ("UV1", uv1), ("UV2", uv2)], F3)
    rough = g.node(unreal.MaterialExpressionConstant, x=100, r=0.82)
    g.out(colour, ME.MP_BASE_COLOR)
    g.out(rough, ME.MP_ROUGHNESS)
    g.out(wpo, ME.MP_WORLD_POSITION_OFFSET)
    g.finish()

    # ---- M_Flash: camera flashes twinkling in the stands -------------------------------------------
    g = Graph("M_Flash")
    g.mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    g.mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
    g.mat.set_editor_property("used_with_instanced_static_meshes", True)
    time = g.node(unreal.MaterialExpressionTime)
    phase = g.instance1(0, 0.0)
    hype = g.scalar("Hype", 0.3)
    mask = g.custom("float t = floor(Time * 12.0) / 12.0;\n"
                    "float ph = frac(Phase * 91.7 + t * (0.05 + Phase * 0.06));\n"
                    "return ph < (0.004 + 0.035 * Hype) ? 1.0 : 0.0;",
                    [("Time", time), ("Phase", phase), ("Hype", hype)], F1)
    white = g.node(unreal.MaterialExpressionConstant3Vector, x=100, constant=unreal.LinearColor(9000.0, 8700.0, 7800.0, 1.0))
    g.out(white, ME.MP_EMISSIVE_COLOR)
    g.out(mask, ME.MP_OPACITY_MASK)
    g.finish()

    # ---- M_Screen: video walls fed by a render target ----------------------------------------------
    g = Graph("M_Screen")
    g.mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    uv = g.node(unreal.MaterialExpressionTextureCoordinate)
    tex = g.node(unreal.MaterialExpressionTextureSampleParameter2D, x=-500, parameter_name="Screen", texture=default_tex,
                 sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_COLOR)
    power = g.scalar("Intensity", 700.0)
    grid = g.scalar("LedGrid", 140.0)
    emis = g.custom("float2 cell = frac(UV * float2(G, G * 0.5625)) - 0.5;\n"
                    "float led = saturate(1.45 - dot(cell, cell) * 4.5);\n"
                    "return T * I * led;",
                    [("UV", uv), ("T", tex), ("I", power), ("G", grid)], F3, x=100)
    g.out(emis, ME.MP_EMISSIVE_COLOR)
    g.finish()

    # ---- M_Sign: fan placards (slogan atlas, 4x4 cells; per-instance 0 = cell, 1 = phase) -----------
    g = Graph("M_Sign")
    g.mat.set_editor_property("used_with_instanced_static_meshes", True)
    g.mat.set_editor_property("two_sided", True)
    uv = g.node(unreal.MaterialExpressionTextureCoordinate)
    vc = g.node(unreal.MaterialExpressionVertexColor)
    cell = g.instance1(0, 0.0)
    phase = g.instance1(1, 0.0)
    time = g.node(unreal.MaterialExpressionTime)
    hype = g.scalar("Hype", 0.3)
    auv = g.custom("float idx = floor(Cell + 0.5);\n"
                   "float2 c = float2(fmod(idx, 4.0), floor(idx / 4.0));\n"
                   "return (c + saturate(UV)) * 0.25;", [("UV", uv), ("Cell", cell)], F2)
    tex = g.node(unreal.MaterialExpressionTextureSampleParameter2D, x=-200, parameter_name="Atlas", texture=default_tex,
                 sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_COLOR)
    g.link(auv, tex, "UVs")
    colour = g.custom("return T * pow(max(VC, 0.0001), 2.2);", [("T", tex), ("VC", vc)], F3, x=100)
    wpo = g.custom("float t = floor(Time * 12.0) / 12.0;\n"
                   "float lift = 4.0 + 10.0 * Hype;\n"
                   "return float3(0.0, 0.0, abs(sin(t * 5.5 + Phase * 50.0)) * lift);",
                   [("Time", time), ("Phase", phase), ("Hype", hype)], F3, x=100)
    rough = g.node(unreal.MaterialExpressionConstant, x=100, r=0.85)
    g.out(colour, ME.MP_BASE_COLOR)
    g.out(rough, ME.MP_ROUGHNESS)
    g.out(wpo, ME.MP_WORLD_POSITION_OFFSET)
    g.finish()


# ======================================================================================================
# Meshes
# ======================================================================================================

def material(name):
    return unreal.load_asset(f"{ROOT}/Materials/{name}")


def assign_static(path, override=None):
    sm = unreal.load_asset(path)
    if not sm:
        log(f"MESH_MISSING {path}")
        return
    slots = sm.get_editor_property("static_materials")
    names = []
    for i, slot in enumerate(slots):
        slot_name = str(slot.get_editor_property("material_slot_name"))
        names.append(slot_name)
        mat = override or (material("M_Glow") if "Glow" in slot_name else material("M_Clay"))
        sm.set_material(i, mat)
    eal.save_asset(path, only_if_is_dirty=False)
    return names


def import_static_group(prefixes, dest, override=None, full_precision_uvs=False, exclude=()):
    count = 0
    for f in sorted(os.listdir(EXPORT)):
        if not f.endswith(".fbx") or not f.startswith(tuple(prefixes)) or f.startswith(tuple(exclude)):
            continue
        name = os.path.splitext(f)[0]
        import_file(os.path.join(EXPORT, f), dest, options=mesh_pipeline(False, full_precision_uvs))
        slots = assign_static(f"{dest}/{name}", override)
        count += 1
        if count <= 2:
            log(f"SLOTS {name} {slots}")
    log(f"IMPORTED {count} meshes into {dest}")


def import_characters():
    dest = f"{ROOT}/Characters"
    count = 0
    for f in sorted(os.listdir(EXPORT)):
        if not f.startswith("SK_") or not f.endswith(".fbx"):
            continue
        name = os.path.splitext(f)[0]
        import_file(os.path.join(EXPORT, f), dest, options=mesh_pipeline(True))
        sk = unreal.load_asset(f"{dest}/{name}")
        if not sk:
            log(f"CHARACTER_FAILED {name}")
            continue
        mats = sk.get_editor_property("materials")
        for i in range(len(mats)):
            m = mats[i]                                  # array elements come back as copies
            slot = str(m.get_editor_property("material_slot_name"))
            m.set_editor_property("material_interface", material("M_Glow") if "Glow" in slot else material("M_Clay"))
            mats[i] = m
        sk.set_editor_property("materials", mats)
        eal.save_asset(f"{dest}/{name}", only_if_is_dirty=False)
        count += 1
    log(f"IMPORTED {count} characters")


def import_audio(voices_only=False, missing_only=False, prefix=""):
    src = os.path.join(PROJECT, "Art", "Audio")
    if not os.path.isdir(src):
        log("AUDIO none")
        return
    dest = f"{ROOT}/Audio"
    count = 0
    for f in sorted(os.listdir(src)):
        if f.endswith(".wav") and f.startswith(prefix) and (not voices_only or f.startswith("VO_")):
            asset = "S_" + os.path.splitext(f)[0]
            if missing_only and eal.does_asset_exist(f"{dest}/{asset}"):
                continue
            paths = import_file(os.path.join(src, f), dest, name=asset)
            if not paths:
                raise RuntimeError(f"Failed to import {f}")
            count += 1
    for looped in (() if voices_only or prefix else ("Music_Fight", "Music_Menu", "Crowd_Loop")):
        snd = unreal.load_asset(f"{dest}/S_{looped}")
        if snd:
            snd.set_editor_property("looping", True)
            eal.save_asset(f"{dest}/S_{looped}", only_if_is_dirty=False)
    log(f"IMPORTED {count} sounds")


def copy_data():
    for sub, files in (("Data", [os.path.join(EXPORT, "arena_layout.json")]),
                       ("Fonts", [os.path.join(PROJECT, "Art", "Fonts", f) for f in sorted(os.listdir(os.path.join(PROJECT, "Art", "Fonts")))])):
        dest = os.path.join(PROJECT, "Content", "CPV", sub)
        os.makedirs(dest, exist_ok=True)
        for f in files:
            if os.path.isfile(f):
                shutil.copy2(f, dest)
    log("DATA copied")


if want("materials"):
    build_materials()
if want("arena"):
    import_static_group(["SM_Ring.", "SM_Ringside", "SM_Rig", "SM_Stage", "SM_Shell", "SM_Bowl"], f"{ROOT}/Arena")
if want("crowd"):
    import_static_group(["SM_Crowd"], f"{ROOT}/Crowd", override=material("M_Crowd"), full_precision_uvs=True)
    import_static_group(["SM_Sign"], f"{ROOT}/Crowd", override=material("M_Sign"))
if want("props"):
    import_static_group(["SM_"], f"{ROOT}/Props",
                        exclude=["SM_Ring.", "SM_Ringside", "SM_Rig", "SM_Stage", "SM_Shell", "SM_Bowl", "SM_Crowd", "SM_Sign"])
if ONLY and want("slate"):
    import_static_group(["SM_Slate."], f"{ROOT}/Props")
    import_audio(prefix="Clapboard")
if ONLY and want("title"):
    import_static_group(["SM_Belt."], f"{ROOT}/Props")
    if not import_texture("Portraits/P_TitleBelt.png", f"{ROOT}/UI", srgb=True,
                          compression=unreal.TextureCompressionSettings.TC_EDITOR_ICON, ui=True):
        raise RuntimeError("Failed to import the championship belt render")
if want("characters"):
    import_characters()
if want("ui"):
    count = 0
    for f in sorted(os.listdir(os.path.join(EXPORT, "Portraits"))):
        if f.endswith(".png") and import_texture(f"Portraits/{f}", f"{ROOT}/UI", srgb=True,
                                                 compression=unreal.TextureCompressionSettings.TC_EDITOR_ICON, ui=True):
            count += 1
    log(f"IMPORTED {count} portraits")
if want("audio"):
    import_audio()
elif want("themes"):
    import_audio(prefix="Theme_")
elif want("newvoices"):
    import_audio(voices_only=True, missing_only=True)
elif want("voices"):
    import_audio(voices_only=True)
if want("data"):
    copy_data()
log("DONE")
