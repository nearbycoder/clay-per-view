"""Shared modelling helpers for the Clay-Per-View art pipeline (Blender 5.x, headless).

Everything is authored in centimetres. Characters face +X with their LEFT side at +Y (Blender),
which arrives in Unreal as facing +X with the left side at -Y (Unreal's Y is Blender's -Y).
Colour lives in a point-domain byte colour attribute "Col": RGB = sRGB clay colour, A = roughness.
"""
import json
import math
import os
import time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

ART_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPORT_DIR = os.path.join(ART_DIR, "Export")
PREVIEW_DIR = os.path.join(ART_DIR, "Preview")
FONT_DIR = os.path.join(ART_DIR, "Fonts")

FONT_TITLE = os.path.join(FONT_DIR, "TitanOne-Regular.ttf")
FONT_IMPACT = os.path.join(FONT_DIR, "Anton-Regular.ttf")
FONT_COMIC = os.path.join(FONT_DIR, "Bangers-Regular.ttf")

_T0 = time.time()
_fonts = {}
_materials = {}


def log(*a):
    print("[cpv %6.1fs]" % (time.time() - _T0), *a, flush=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _fonts.clear()          # cached datablocks do not survive a factory reset
    _materials.clear()
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 0.01
    return scene


def col(h):
    """'#rrggbb' -> (r, g, b) sRGB floats."""
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def shade(c, f):
    """Scale an sRGB colour's brightness (f<1 darker, f>1 lighter), clamped."""
    return tuple(max(0.0, min(1.0, v * f)) for v in c)


def mix(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))


def rot(rx=0.0, ry=0.0, rz=0.0):
    """Rotation matrix from XYZ Euler angles in degrees."""
    return (Matrix.Rotation(math.radians(rz), 4, 'Z') @ Matrix.Rotation(math.radians(ry), 4, 'Y')
            @ Matrix.Rotation(math.radians(rx), 4, 'X'))


def track(direction):
    """Matrix rotating +Z onto `direction`."""
    v = Vector(direction)
    if v.length < 1e-9:
        return Matrix.Identity(4)
    return v.to_track_quat('Z', 'Y').to_matrix().to_4x4()


def load_font(path):
    if path not in _fonts:
        _fonts[path] = bpy.data.fonts.load(path)
    return _fonts[path]


def text_mesh(body, font=FONT_TITLE, size=10.0, depth=1.0, bevel=0.0, spacing=1.0, resolution=4, align='CENTER'):
    """Extruded text as a mesh datablock lying in the XY plane (reads left to right along +X, up = +Y),
    centred on the origin, `depth` thick along Z."""
    cu = bpy.data.curves.new("txt", 'FONT')
    cu.body = body
    cu.font = load_font(font)
    cu.size = size
    cu.extrude = depth * 0.5
    cu.bevel_depth = bevel
    cu.bevel_resolution = 1 if bevel > 0 else 0
    cu.resolution_u = resolution
    cu.space_character = spacing
    cu.align_x = align
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new("txt", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    return me


class Shape:
    """Accumulates primitives into one bmesh. Every primitive takes world-space centimetres.

    Each primitive is built in a scratch bmesh and then appended, so nothing here depends on vertex
    index order (bmesh reuses freed slots, which makes "the last N verts" unreliable).
    """

    def __init__(self):
        self.bm = bmesh.new()

    def _absorb(self, tmp, m=None):
        if m is not None:
            bmesh.ops.transform(tmp, matrix=m, verts=tmp.verts[:])
        me = bpy.data.meshes.new("cpv_tmp")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        return self

    # -- primitives --
    def ball(self, c, r, scale=(1, 1, 1), r3=None, seg=20, m=None):
        """Sphere/ellipsoid. r3 is an optional rotation matrix applied before translation."""
        t = bmesh.new()
        mat = Matrix.Translation(c) @ (r3 if r3 is not None else Matrix.Identity(4)) @ Matrix.Diagonal((*scale, 1.0))
        bmesh.ops.create_uvsphere(t, u_segments=seg, v_segments=max(6, seg // 2), radius=r, matrix=mat)
        return self._absorb(t, m)

    def capsule(self, a, b, ra, rb=None, seg=16, m=None):
        """Round-ended tapered limb between a and b."""
        rb = ra if rb is None else rb
        a, b = Vector(a), Vector(b)
        t = bmesh.new()
        axis = b - a
        if axis.length > 1e-6:
            mat = Matrix.Translation((a + b) * 0.5) @ track(axis)
            bmesh.ops.create_cone(t, cap_ends=True, segments=seg, radius1=ra, radius2=rb, depth=axis.length, matrix=mat)
        bmesh.ops.create_uvsphere(t, u_segments=seg, v_segments=max(6, seg // 2), radius=ra, matrix=Matrix.Translation(a))
        bmesh.ops.create_uvsphere(t, u_segments=seg, v_segments=max(6, seg // 2), radius=rb, matrix=Matrix.Translation(b))
        return self._absorb(t, m)

    def cyl(self, a, b, ra, rb=None, seg=20, m=None):
        """Flat-capped cylinder / cone frustum between a and b."""
        rb = ra if rb is None else rb
        a, b = Vector(a), Vector(b)
        t = bmesh.new()
        axis = b - a
        mat = Matrix.Translation((a + b) * 0.5) @ track(axis)
        bmesh.ops.create_cone(t, cap_ends=True, segments=seg, radius1=ra, radius2=rb, depth=axis.length, matrix=mat)
        return self._absorb(t, m)

    def box(self, c, size, r3=None, bevel=0.0, bseg=2, m=None):
        """Box centred at c with full extents `size`; optional rounded edges."""
        t = bmesh.new()
        bmesh.ops.create_cube(t, size=1.0, matrix=Matrix.Diagonal((*size, 1.0)))
        if bevel > 0:
            bmesh.ops.bevel(t, geom=t.edges[:], offset=bevel, offset_type='OFFSET', segments=bseg, profile=0.5,
                            affect='EDGES', clamp_overlap=True)
        place = Matrix.Translation(c) @ (r3 if r3 is not None else Matrix.Identity(4))
        return self._absorb(t, (m @ place) if m is not None else place)

    def tube(self, pts, radius, seg=10, closed=False, caps=True, m=None):
        """Sweep a circle along a polyline. `radius` is a number or one radius per point."""
        pts = [Vector(p) for p in pts]
        n = len(pts)
        radii = [radius] * n if isinstance(radius, (int, float)) else list(radius)
        t = bmesh.new()
        rings = []
        # Parallel-transport frames so the tube does not twist.
        tangents = []
        for i in range(n):
            if closed:
                tg = pts[(i + 1) % n] - pts[i - 1]
            else:
                tg = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            tangents.append(tg.normalized())
        ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
        u = tangents[0].cross(ref).normalized()
        for i in range(n):
            tg = tangents[i]
            u = (u - tg * u.dot(tg))
            u = u.normalized() if u.length > 1e-6 else tg.orthogonal().normalized()
            v = tg.cross(u)
            ring = []
            for k in range(seg):
                a = 2 * math.pi * k / seg
                ring.append(t.verts.new(pts[i] + (u * math.cos(a) + v * math.sin(a)) * radii[i]))
            rings.append(ring)
        count = n if closed else n - 1
        for i in range(count):
            r0, r1 = rings[i], rings[(i + 1) % n]
            for k in range(seg):
                t.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
        if caps and not closed:
            t.faces.new(list(reversed(rings[0])))
            t.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(t, faces=t.faces[:])
        return self._absorb(t, m)

    def torus(self, c, R, r, r3=None, seg=28, rseg=10, squash=1.0, m=None):
        """Torus lying in the local XY plane around c (rotate with r3)."""
        pts = [Vector((R * math.cos(2 * math.pi * i / seg), R * math.sin(2 * math.pi * i / seg) * squash, 0.0)) for i in range(seg)]
        place = Matrix.Translation(c) @ (r3 if r3 is not None else Matrix.Identity(4))
        return self.tube(pts, r, seg=rseg, closed=True, m=(m @ place) if m is not None else place)

    def lathe(self, profile, c=(0, 0, 0), r3=None, seg=24, m=None):
        """Surface of revolution about local Z from (radius, z) pairs, bottom to top."""
        t = bmesh.new()
        rings = []
        for (r, z) in profile:
            if r < 1e-6:
                rings.append([t.verts.new((0, 0, z))])
            else:
                rings.append([t.verts.new((r * math.cos(2 * math.pi * k / seg), r * math.sin(2 * math.pi * k / seg), z)) for k in range(seg)])
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            for k in range(seg):
                k2 = (k + 1) % seg
                if len(a) == 1 and len(b) == 1:
                    continue
                if len(a) == 1:
                    t.faces.new((a[0], b[k2], b[k]))
                elif len(b) == 1:
                    t.faces.new((a[k], a[k2], b[0]))
                else:
                    t.faces.new((a[k], a[k2], b[k2], b[k]))
        if len(rings[0]) > 1:
            t.faces.new(list(reversed(rings[0])))
        if len(rings[-1]) > 1:
            t.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(t, faces=t.faces[:])
        place = Matrix.Translation(c) @ (r3 if r3 is not None else Matrix.Identity(4))
        return self._absorb(t, (m @ place) if m is not None else place)

    def prism(self, pts2d, z0, z1, m=None):
        """Extrude a 2D polygon (XY) from z0 to z1."""
        t = bmesh.new()
        bot = [t.verts.new((x, y, z0)) for (x, y) in pts2d]
        top = [t.verts.new((x, y, z1)) for (x, y) in pts2d]
        n = len(pts2d)
        t.faces.new(list(reversed(bot)))
        t.faces.new(top)
        for i in range(n):
            j = (i + 1) % n
            t.faces.new((bot[i], bot[j], top[j], top[i]))
        bmesh.ops.recalc_face_normals(t, faces=t.faces[:])
        return self._absorb(t, m)

    def hull(self, pts, m=None):
        """Convex hull of a point cloud (handy for wedges and odd blocks)."""
        t = bmesh.new()
        vs = [t.verts.new(p) for p in pts]
        bmesh.ops.convex_hull(t, input=vs)
        bmesh.ops.recalc_face_normals(t, faces=t.faces[:])
        return self._absorb(t, m)

    def mesh(self, me, m=None, free=True):
        """Append an existing mesh datablock (e.g. from text_mesh) with a transform."""
        t = bmesh.new()
        t.from_mesh(me)
        if free:
            bpy.data.meshes.remove(me)
        return self._absorb(t, m)

    def text(self, body, c, size, depth, r3=None, font=FONT_TITLE, bevel=0.0, spacing=1.0, m=None):
        me = text_mesh(body, font=font, size=size, depth=depth, bevel=bevel, spacing=spacing)
        place = Matrix.Translation(c) @ (r3 if r3 is not None else Matrix.Identity(4))
        return self.mesh(me, m=(m @ place) if m is not None else place)


class Piece(Shape):
    """One lump of single-coloured clay.

    raw=False: primitives are fused with a voxel remesh and smoothed (hand-sculpted look).
    raw=True:  primitives are kept as modelled (hard-surface / low-poly), smooth-shaded by angle.
    For skinned characters give `rigid` (one bone) or `bones` (candidates for automatic weights).
    """

    def __init__(self, name, color, rough=0.72, voxel=1.4, smooth=5, smooth_factor=0.7, lumps=0.18, raw=False,
                 sharp=40.0, rigid=None, bones=None, paint=None, slot="Clay", decimate=None):
        super().__init__()
        self.name = name
        self.color = color
        self.rough = rough
        self.voxel = voxel
        self.smooth = smooth
        self.smooth_factor = smooth_factor
        self.lumps = lumps
        self.raw = raw
        self.sharp = sharp
        self.rigid = rigid
        self.bones = bones
        self.paint = paint
        self.slot = slot
        self.decimate = decimate

    def build(self):
        scene = bpy.context.scene
        me = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        if self.raw:
            ang = math.radians(self.sharp)
            for e in self.bm.edges:
                if len(e.link_faces) == 2:
                    e.smooth = e.calc_face_angle(0.0) < ang
            for f in self.bm.faces:
                f.smooth = True
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(self.name, me)
        scene.collection.objects.link(ob)
        if not self.raw:
            rem = ob.modifiers.new("Remesh", 'REMESH')
            rem.mode = 'VOXEL'
            rem.voxel_size = self.voxel
            rem.adaptivity = 0.0
            rem.use_smooth_shade = True
            if self.smooth > 0:
                sm = ob.modifiers.new("Smooth", 'SMOOTH')
                sm.factor = self.smooth_factor
                sm.iterations = self.smooth
            if self.decimate:
                dec = ob.modifiers.new("Decimate", 'DECIMATE')
                dec.ratio = self.decimate
            dg = bpy.context.evaluated_depsgraph_get()
            me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
            ob.modifiers.clear()
            ob.data = me2
            bpy.data.meshes.remove(me)
            me = me2
            for p in me.polygons:
                p.use_smooth = True
        nv = len(me.vertices)
        co = np.zeros(nv * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        nrm = np.zeros(nv * 3, dtype=np.float32)
        me.vertices.foreach_get("normal", nrm)
        nrm = nrm.reshape(-1, 3)
        if not self.raw and self.lumps > 0 and nv:
            # Low-frequency hand-made wobble along the normal.
            seed = (hash(self.name) % 997) * 0.37
            off = np.array([noise.noise(Vector((float(p[0]) * 0.06 + seed, float(p[1]) * 0.06, float(p[2]) * 0.06))) for p in co], dtype=np.float32)
            co = co + nrm * (off * self.lumps)[:, None]
            me.vertices.foreach_set("co", co.ravel())
            me.update()
        rgba = np.empty((nv, 4), dtype=np.float32)
        rgba[:, :3] = self.color
        rgba[:, 3] = self.rough
        if self.paint is not None and nv:
            painted = self.paint(co, nrm)
            if painted is not None:
                rgba[:, :painted.shape[1]] = painted
        attr = me.color_attributes.new(name="Col", type='BYTE_COLOR', domain='POINT')
        attr.data.foreach_set("color_srgb", rgba.ravel())
        me.color_attributes.active_color = attr
        mat = get_material(self.slot)
        me.materials.append(mat)
        ob["cpv_rigid"] = self.rigid or ""
        ob["cpv_bones"] = ",".join(self.bones) if self.bones else ""
        return ob


def get_material(slot):
    """One Blender material per Unreal material slot name (Clay, Glow, Screen, ...)."""
    if slot in _materials and slot in bpy.data.materials:
        return _materials[slot]
    mat = bpy.data.materials.new(slot)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    att = nt.nodes.new("ShaderNodeVertexColor")
    att.layer_name = "Col"
    nt.links.new(att.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(att.outputs["Alpha"], bsdf.inputs["Roughness"])
    if slot in ("Glow", "Screen"):
        nt.links.new(att.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 3.0
    _materials[slot] = mat
    return mat


def box_uv(me, density=40.0):
    """Box-projected UV0 (1 UV unit = `density` cm) for the tiling clay detail maps."""
    if len(me.loops) == 0:
        return
    uv = me.uv_layers.new(name="UV0") if "UV0" not in me.uv_layers else me.uv_layers["UV0"]
    nl = len(me.loops)
    lv = np.zeros(nl, dtype=np.int32)
    me.loops.foreach_get("vertex_index", lv)
    co = np.zeros(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    pn = np.zeros(len(me.polygons) * 3, dtype=np.float32)
    me.polygons.foreach_get("normal", pn)
    pn = pn.reshape(-1, 3)
    counts = np.zeros(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("loop_total", counts)
    ln = np.repeat(pn, counts, axis=0)
    axis = np.argmax(np.abs(ln), axis=1)
    p = co[lv]
    u = np.where(axis == 0, p[:, 1], p[:, 0])
    v = np.where(axis == 2, p[:, 1], p[:, 2])
    uvs = np.stack([u, v], axis=1) / density
    uv.data.foreach_set("uv", uvs.astype(np.float32).ravel())


def join(objs, name):
    """Join built pieces into one object."""
    objs = [o for o in objs if o is not None and len(o.data.vertices) > 0]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def build_static(name, pieces, uv_density=40.0):
    """Build + join pieces into a static mesh object named `name`."""
    ob = join([p.build() for p in pieces], name)
    box_uv(ob.data, uv_density)
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def export_fbx(objs, filename):
    os.makedirs(EXPORT_DIR, exist_ok=True)
    path = os.path.join(EXPORT_DIR, filename)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={'ARMATURE', 'MESH'},
                             mesh_smooth_type='FACE', use_tspace=False, add_leaf_bones=False,
                             primary_bone_axis='Y', secondary_bone_axis='X', bake_anim=False,
                             colors_type='SRGB', apply_scale_options='FBX_SCALE_NONE', apply_unit_scale=True,
                             global_scale=1.0, axis_forward='-Z', axis_up='Y', use_mesh_modifiers=False)
    return path


def write_json(filename, data):
    os.makedirs(EXPORT_DIR, exist_ok=True)
    with open(os.path.join(EXPORT_DIR, filename), "w") as f:
        json.dump(data, f, separators=(",", ":"))


# ---- skinning -------------------------------------------------------------------------------------

def make_armature(name, bones):
    """bones: list of (name, head, tail, parent). Returns the armature object."""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    made = {}
    for (bname, head, tail, parent) in bones:
        b = arm.edit_bones.new(bname)
        b.head, b.tail = Vector(head), Vector(tail)
        if parent:
            b.parent = made[parent]
        made[bname] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def _segment_dist(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(float(ab @ ab), 1e-9), 0.0, 1.0)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def skin_piece(ob, arm_ob, bone_radius=None):
    """Weight one built piece to the armature: rigid (single bone) or automatic among `cpv_bones`.

    Automatic weights use Blender's bone-heat solve restricted to the candidate bones; vertices it
    leaves unweighted fall back to nearest-bone weights so nothing is ever left behind.
    """
    rigid = ob.get("cpv_rigid", "")
    cand = [b for b in ob.get("cpv_bones", "").split(",") if b]
    me = ob.data
    nv = len(me.vertices)
    if rigid or len(cand) == 1:
        g = ob.vertex_groups.new(name=rigid or cand[0])
        g.add(list(range(nv)), 1.0, 'REPLACE')
        mod = ob.modifiers.new("Armature", 'ARMATURE')
        mod.object = arm_ob
        ob.parent = arm_ob
        return
    arm = arm_ob.data
    saved = {b.name: b.use_deform for b in arm.bones}
    for b in arm.bones:
        b.use_deform = b.name in cand
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    arm_ob.select_set(True)
    bpy.context.view_layer.objects.active = arm_ob
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for b in arm.bones:
        b.use_deform = saved[b.name]
    # Fallback for vertices the heat solve missed.
    total = np.zeros(nv, dtype=np.float32)
    for v in me.vertices:
        total[v.index] = sum(g.weight for g in v.groups)
    missing = np.nonzero(total < 1e-4)[0]
    if len(missing):
        co = np.zeros(nv * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)[missing]
        best = np.full(len(missing), 1e9, dtype=np.float32)
        best_bone = np.zeros(len(missing), dtype=np.int32)
        for i, bn in enumerate(cand):
            b = arm.bones[bn]
            d = _segment_dist(co, np.array(b.head_local, dtype=np.float32), np.array(b.tail_local, dtype=np.float32))
            better = d < best
            best[better] = d[better]
            best_bone[better] = i
        for i, bn in enumerate(cand):
            idx = missing[best_bone == i]
            if len(idx):
                g = ob.vertex_groups.get(bn) or ob.vertex_groups.new(name=bn)
                g.add([int(k) for k in idx], 1.0, 'REPLACE')
        log("  skin fallback on", ob.name, len(missing), "verts")


def build_skinned(name, arm_ob, pieces, uv_density=40.0):
    objs = []
    for p in pieces:
        ob = p.build()
        if len(ob.data.vertices) == 0:
            continue
        skin_piece(ob, arm_ob)
        objs.append(ob)
    ob = join(objs, name)
    if not any(m.type == 'ARMATURE' for m in ob.modifiers):
        mod = ob.modifiers.new("Armature", 'ARMATURE')
        mod.object = arm_ob
    ob.parent = arm_ob
    box_uv(ob.data, uv_density)
    return ob


# ---- preview rendering ----------------------------------------------------------------------------

def setup_preview(res=(1280, 720), bg=(0.13, 0.14, 0.17), samples=32):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.image_settings.file_format = 'PNG'
    try:
        scene.eevee.taa_render_samples = samples
        scene.eevee.use_raytracing = True
    except Exception:
        pass
    try:
        scene.view_settings.view_transform = 'Standard'
    except Exception:
        pass
    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (*bg, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world

    def light(kind, energy, rx, rz, colour=(1, 1, 1), size=5.0):
        d = bpy.data.lights.new(kind + "L", kind)
        d.energy = energy
        d.color = colour
        if kind == 'SUN':
            d.angle = math.radians(size)
        o = bpy.data.objects.new(kind + "L", d)
        scene.collection.objects.link(o)
        o.rotation_euler = (math.radians(rx), 0, math.radians(rz))
        return o

    light('SUN', 3.2, 52, 35, (1.0, 0.96, 0.9), 8.0)      # key
    light('SUN', 1.0, 65, -110, (0.75, 0.85, 1.0), 20.0)  # fill
    light('SUN', 1.6, -40, 200, (1.0, 0.9, 0.8), 10.0)    # rim from behind/below


def add_point_light(pos, energy, colour=(1.0, 0.95, 0.88), radius=40.0):
    """Interior light for previews. Units are centimetres, so energies are ~1e4 x the usual watts."""
    d = bpy.data.lights.new("PointL", 'POINT')
    d.energy = energy
    d.color = colour
    d.shadow_soft_size = radius
    o = bpy.data.objects.new("PointL", d)
    bpy.context.scene.collection.objects.link(o)
    o.location = pos
    return o


def render(filename, cam_pos, target, lens=50.0, ortho=None):
    scene = bpy.context.scene
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    cam_d = bpy.data.cameras.new("Cam")
    cam_d.lens = lens
    cam_d.clip_start = 1.0
    cam_d.clip_end = 200000.0
    if ortho:
        cam_d.type = 'ORTHO'
        cam_d.ortho_scale = ortho
    cam = bpy.data.objects.new("Cam", cam_d)
    scene.collection.objects.link(cam)
    cam.location = cam_pos
    look = Vector(target) - Vector(cam_pos)
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.filepath = os.path.join(PREVIEW_DIR, filename)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    log("rendered", filename)
