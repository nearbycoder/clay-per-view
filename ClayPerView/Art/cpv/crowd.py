"""Audience members: low-poly clay spectators with a baked "sit -> stand and cheer" morph.

The exported mesh is the STANDING, arms-up pose (so its bounds cover both poses). Per-vertex data for
the crowd material:
  vertex colour RGB = tint masks (R skin, G shirt, B trousers, none = hair), A = brightness (dark for
                      eyes and shoes)
  UV1 = (dx, 1 - dy)   offset from standing to seated, in Unreal mesh space (cm)
  UV2 = (dz, 1 - wave) wave = how much the vertex follows the arm-waving motion (0 body .. 1 hands)
(V is stored as 1 - value because Unreal flips V on import.)
The figure faces +X and stands on its seat's floor point.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

from .common import Piece, box_uv, export_fbx, log, tri_count

SKIN, SHIRT, PANTS, HAIR = (1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 0, 0)

# Chunky clay proportions: big heads, short thick limbs.
POSE_SIT = dict(pelvis=(0, 0, 50), chest=(4, 0, 90), head=(6, 0, 111), hip=(0, 9, 49), knee=(34, 10, 50), ankle=(36, 10, 12),
                toe=(43, 10, 5), shoulder=(4, 19, 86), elbow_l=(10, 23, 66), hand_l=(27, 14, 61), elbow_r=(10, 23, 66),
                hand_r=(27, 14, 61))
POSE_UP = dict(pelvis=(2, 0, 78), chest=(2, 0, 118), head=(1, 0, 140), hip=(2, 9, 77), knee=(3, 10, 43), ankle=(2, 10, 10),
               toe=(9, 10, 5), shoulder=(2, 19, 114), elbow_l=(5, 35, 132), hand_l=(8, 42, 156), elbow_r=(6, 31, 136),
               hand_r=(10, 34, 161))

VARIANTS = [
    dict(name="A", build=1.0, hair="short", sleeves="short"),
    dict(name="B", build=0.9, hair="long", sleeves="long"),
    dict(name="C", build=1.15, hair="cap", sleeves="short"),
    dict(name="D", build=0.95, hair="bun", sleeves="none"),
]


class MaskPiece(Piece):
    """A raw piece whose parts carry different mask colours (tracked by vertex ranges)."""

    def __init__(self, name):
        super().__init__(name, (0, 0, 0), raw=True, sharp=50.0)
        self.ranges = []
        self.paint = self._paint

    def part(self, colour, bright=1.0, wave=False):
        self._open = (len(self.bm.verts), colour, bright, wave)
        return self

    def done(self):
        start, colour, bright, wave = self._open
        self.ranges.append((start, len(self.bm.verts), colour, bright, wave))

    def _paint(self, co, nrm):
        rgba = np.zeros((len(co), 4), dtype=np.float32)
        for start, end, colour, bright, _ in self.ranges:
            rgba[start:end, :3] = colour
            rgba[start:end, 3] = bright
        return rgba


def person(variant, pose, far):
    v = VARIANTS[variant]
    b = v["build"]
    seg = 5 if far else 7
    p = MaskPiece(f"crowd{v['name']}")
    P = {k: Vector(val) for k, val in pose.items()}

    def side(key, s):
        q = P[key]
        return Vector((q.x, q.y * s, q.z))

    widen = Matrix.Diagonal((1.0, 1.32 * b, 1.0, 1.0))
    # torso
    p.part(SHIRT)
    mid = (P["pelvis"] + P["chest"]) * 0.5
    p.tube([P["pelvis"] + Vector((0, 0, -4)), mid, P["chest"] + Vector((0, 0, 3))], [14.0 * b, 15.0 * b, 12.5 * b], seg=seg + 1, m=widen)
    p.done()
    # head, hair, eyes
    head = P["head"]
    p.part(SKIN)
    p.ball(head, 15.0, seg=8 if far else 10)
    p.done()
    hair = v["hair"]
    if hair in ("short", "long", "bun"):
        p.part(HAIR)
        p.ball(head + Vector((-2.2, 0, 3.2)), 16.0, scale=(1.0, 1.02, 0.92), seg=8 if far else 10)
        if hair == "long":
            p.ball(head + Vector((-8.5, 0, -9)), 15.0, scale=(0.62, 1.08, 1.3), seg=8)
        if hair == "bun" and not far:
            p.ball(head + Vector((-9, 0, 16)), 6.5, seg=6)
        p.done()
    else:  # cap in the shirt colour, with a brim
        p.part(SHIRT)
        p.ball(head + Vector((-1.0, 0, 4.4)), 16.1, scale=(1.0, 1.0, 0.82), seg=8 if far else 10)
        if not far:
            p.box(head + Vector((16, 0, 7.0)), (13, 19, 1.8))
        p.done()
    if not far:
        p.part(HAIR, bright=0.05)
        for s in (-1, 1):
            p.ball(head + Vector((13.6, s * 5.4, 1.5)), 2.2, seg=6)
        p.done()
    # arms
    for s, tag in ((1, "l"), (-1, "r")):
        sh, el, ha = side("shoulder", s), side("elbow_" + tag, s), side("hand_" + tag, s)
        sh = Vector((sh.x, sh.y * b, sh.z))
        upper = SHIRT if v["sleeves"] in ("short", "long") else SKIN
        lower = SHIRT if v["sleeves"] == "long" else SKIN
        p.part(upper, wave=True)
        p.tube([sh, el], [6.2 * b, 5.4 * b], seg=seg)
        p.done()
        p.part(lower, wave=True)
        p.tube([el, ha], [5.4 * b, 4.8 * b], seg=seg)
        p.done()
        if not far:
            p.part(SKIN, wave=True)
            p.ball(ha, 6.0, seg=6)
            p.done()
    # legs and shoes
    for s in (-1, 1):
        hip, knee, ankle, toe = side("hip", s), side("knee", s), side("ankle", s), side("toe", s)
        p.part(PANTS)
        p.tube([hip, knee], [8.8 * b, 7.4 * b], seg=seg)
        p.tube([knee, ankle], [7.4 * b, 6.0 * b], seg=seg)
        p.done()
        if not far:
            p.part(HAIR, bright=0.12)
            p.box(toe, (17, 10, 8))
            p.done()
    return p


def build_person(variant, far):
    up = person(variant, POSE_UP, far)
    sit = person(variant, POSE_SIT, far)
    ranges = up.ranges
    name = "SM_CrowdFar" if far else f"SM_Crowd{VARIANTS[variant]['name']}"
    ob_up = up.build()
    ob_sit = sit.build()
    me, me_sit = ob_up.data, ob_sit.data
    nv = len(me.vertices)
    assert nv == len(me_sit.vertices), "crowd poses must share topology"
    a = np.zeros(nv * 3, dtype=np.float32)
    me.vertices.foreach_get("co", a)
    a = a.reshape(-1, 3)
    c = np.zeros(nv * 3, dtype=np.float32)
    me_sit.vertices.foreach_get("co", c)
    c = c.reshape(-1, 3)
    delta = c - a                                  # standing -> seated (Blender axes)
    wave = np.zeros(nv, dtype=np.float32)
    sh_z, top_z = POSE_UP["shoulder"][2], POSE_UP["hand_r"][2]
    for start, end, _, _, w in ranges:
        if w:
            wave[start:end] = np.clip((a[start:end, 2] - sh_z) / (top_z - sh_z), 0.0, 1.0)
    lv = np.zeros(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", lv)
    box_uv(me, 40.0)
    uv1 = me.uv_layers.new(name="UV1")
    uv1.data.foreach_set("uv", np.stack([delta[lv, 0], 1.0 - (-delta[lv, 1])], axis=1).astype(np.float32).ravel())
    uv2 = me.uv_layers.new(name="UV2")
    uv2.data.foreach_set("uv", np.stack([delta[lv, 2], 1.0 - wave[lv]], axis=1).astype(np.float32).ravel())
    ob_up.name = name
    me.name = name
    return ob_up, ob_sit


def build_sign():
    """A placard on a stick. UV0 maps the front of the board to 0..1 for the slogan atlas."""
    import bmesh
    me = bpy.data.meshes.new("SM_Sign")
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UV0")
    col_layer = bm.verts.layers.float_color.new("ColF")
    W, H, T, Z = 78.0, 52.0, 2.0, 40.0     # board size, thickness, height of its bottom edge above the origin

    def quad(pts, uvs, colour):
        vs = [bm.verts.new(p) for p in pts]
        for v_ in vs:
            v_[col_layer] = colour
        f = bm.faces.new(vs)
        for loop, t in zip(f.loops, uvs):
            loop[uv].uv = t
        return f

    white, wood = (1, 1, 1, 1), (0.45, 0.32, 0.2, 1)
    # Front (+X) carries the slogan; back is plain.
    quad([(T / 2, -W / 2, Z), (T / 2, W / 2, Z), (T / 2, W / 2, Z + H), (T / 2, -W / 2, Z + H)],
         [(0, 0), (1, 0), (1, 1), (0, 1)], white)
    quad([(-T / 2, W / 2, Z), (-T / 2, -W / 2, Z), (-T / 2, -W / 2, Z + H), (-T / 2, W / 2, Z + H)],
         [(0.02, 0.02)] * 4, white)
    for (y0, y1, z0, z1, nx) in ((-W / 2, W / 2, Z + H, Z + H, 0), (-W / 2, W / 2, Z, Z, 1)):
        pts = [(-T / 2, y0, z0), (T / 2, y0, z0), (T / 2, y1, z1), (-T / 2, y1, z1)]
        quad(pts if nx == 0 else list(reversed(pts)), [(0.02, 0.02)] * 4, white)
    for y in (-W / 2, W / 2):
        pts = [(-T / 2, y, Z), (T / 2, y, Z), (T / 2, y, Z + H), (-T / 2, y, Z + H)]
        quad(pts if y > 0 else list(reversed(pts)), [(0.02, 0.02)] * 4, white)
    # Stick: a thin box from the hands up into the board.
    s = 1.6
    stick = [(-s, -s), (s, -s), (s, s), (-s, s)]
    for i in range(4):
        (x0, y0), (x1, y1) = stick[i], stick[(i + 1) % 4]
        quad([(x0 - 1.5, y0, -30), (x1 - 1.5, y1, -30), (x1 - 1.5, y1, Z + 6), (x0 - 1.5, y0, Z + 6)], [(0.98, 0.02)] * 4, wood)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    # Convert the float colour layer to the byte "Col" attribute the exporter expects.
    src = me.attributes["ColF"]
    vals = np.zeros(len(me.vertices) * 4, dtype=np.float32)
    src.data.foreach_get("color", vals)
    attr = me.color_attributes.new(name="Col", type='BYTE_COLOR', domain='POINT')
    attr.data.foreach_set("color_srgb", vals)
    me.attributes.remove(me.attributes["ColF"])
    me.color_attributes.active_color = me.color_attributes["Col"]
    ob = bpy.data.objects.new("SM_Sign", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build_all(preview=False):
    from . import common
    made = []
    sits = []
    for i in range(len(VARIANTS)):
        ob, sit = build_person(i, False)
        made.append(ob)
        sits.append(sit)
        log(ob.name, "tris", tri_count(ob))
    far, far_sit = build_person(0, True)
    log(far.name, "tris", tri_count(far))
    made.append(far)
    sign = build_sign()
    made.append(sign)
    for ob in made:
        export_fbx([ob], ob.name + ".fbx")
    if preview:
        # Mask colours are not pretty; this just checks shapes: standing row in front, seated behind.
        for i, ob in enumerate(made[:4]):
            ob.location = (0, (i - 1.5) * 70, 0)
            sits[i].location = (-90, (i - 1.5) * 70, 0)
        far.location = (0, 190, 0)
        far_sit.location = (-90, 190, 0)
        sign.location = (0, -190, 100)
        common.setup_preview(res=(1400, 800))
        common.render("crowd.png", (430, -260, 190), (-30, 0, 75), lens=50)
    else:
        for o in sits + [far_sit]:
            bpy.data.objects.remove(o)
    return made
