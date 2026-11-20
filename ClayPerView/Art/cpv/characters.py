"""The cast: eight fictional celebrities, the referee and two commentators.

All of them are invented characters (stock showbiz archetypes), not likenesses of real people.
"""
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import common
from .charbase import (BLACK, GOLD, SILVER, TEETH, WHITE, Char, clear_pose, fight_pose, paint_blotch, paint_checker, paint_region,
                       paint_speckle, paint_stripes_y, pose_rotate, set_expression)
from .common import EXPORT_DIR, FONT_TITLE, col, export_fbx, log, mix, rot, shade, text_mesh


# ---- shared costume helpers --------------------------------------------------------------------------

def loop_around(c, rx, ry, z_fn, n=28):
    """Closed loop of points around the body: an ellipse in XY whose height follows z_fn(angle)."""
    return [(c[0] + rx * math.cos(2 * math.pi * i / n), c[1] + ry * math.sin(2 * math.pi * i / n), z_fn(2 * math.pi * i / n)) for i in range(n)]


def belt(c, colour, buckle=GOLD, drop=7.0, r=2.0, name="belt"):
    hw, hd = c.hip
    p = c.P(name, colour, raw=True, rough=0.45, bones=["pelvis", "spine"])
    z = c.pelvis_z + drop
    p.tube(loop_around((0.3 + c.belly * 4.0, 0, 0), hd + 1.3 + c.belly * 5.0, hw + 1.2 + c.belly * 2.0, lambda a: z), [r] * 28, seg=10, closed=True)
    if buckle is not None:
        b = c.P(name + "_buckle", buckle, raw=True, rough=0.3, rigid="pelvis")
        b.box((hd + 2.2 + c.belly * 9.0, 0, z), (2.0, 8.5, 6.5), bevel=0.8)
    return p


def sash(c, colour, r=2.3, drop=15.0, high=-1, name="sash", rough=0.6, flat=1.0):
    """Diagonal loop over one shoulder (high = -1: right shoulder) down to the opposite hip."""
    cw, cd = c.chest
    zc = c.chest_z + 6.0
    p = c.P(name, colour, raw=True, rough=rough, bones=["spine", "chest"])
    path = loop_around((1.5, 0, 0), cd + 2.0, cw + 0.5, lambda a: zc + high * drop * math.sin(a), n=32)
    p.tube(path, [r] * 32, seg=10, closed=True, m=Matrix.Diagonal((1.0, 1.0, flat, 1.0)) if flat != 1.0 else None)
    return p, path


def hair_cap(c, colour, grow=1.1, shift=(-2.5, 0, 3.0), zscale=0.95, rigid="head", name="hair", rough=0.8, voxel=1.2):
    """Hair as a cap of clay slightly larger than the skull, shifted up and back to leave the face clear."""
    p = c.P(name, colour, voxel=voxel, smooth=3, rigid=rigid, rough=rough)
    p.ball(c.skull_c + Vector(shift) * c.hs, 1.0, scale=(c.skull_r.x + grow, c.skull_r.y + grow, (c.skull_r.z + grow) * zscale))
    return p


def headset(c, colour=BLACK):
    """Broadcast headset: band over the crown, ear cups, a microphone boom to the mouth."""
    hs, C = c.hs, c.head_c
    ry, rz = c.skull_r.y, c.skull_r.z
    p = c.P("headset", colour, raw=True, rough=0.4, rigid="head")
    band = [(c.skull_c.x - 1.0, (ry + 1.3) * math.cos(math.pi * i / 14), c.skull_c.z + (rz + 1.3) * math.sin(math.pi * i / 14)) for i in range(15)]
    p.tube(band, 1.4, seg=8)
    for s in (1, -1):
        ear = Vector((c.skull_c.x - 1.0, s * (ry + 0.8), C.z + 0.5 * hs))
        p.cyl(ear - Vector((0, s * 1.5, 0)), ear + Vector((0, s * 3.0, 0)), 5.8 * hs, seg=18)
    ear = Vector((c.skull_c.x + 1.0, ry + 2.4, C.z - 2.0 * hs))
    tip = Vector((c.mouth_c.x + 3.5, 8.0 * hs, c.mouth_c.z - 1.0))
    mid = Vector(((ear.x + tip.x) * 0.5 + 3.0, ry + 0.5, (ear.z + tip.z) * 0.5 - 2.5))
    p.tube([ear, mid, tip], 0.85, seg=8)
    p.ball(tip, 2.3, seg=12)
    return p


def glasses(c, colour=BLACK, round_=False, r=0.9, size=1.0, name="glasses"):
    hs = c.hs * c.eye_size
    p = c.P(name, colour, raw=True, rough=0.35, rigid="head")
    half_w, half_h = 6.3 * hs * size, (6.3 if round_ else 5.0) * hs * size
    power = 1.0 if round_ else 0.45
    cx = max(c.eye_c[1].x, c.eye_c[-1].x) + 5.4 * hs
    for s in (1, -1):
        e = c.eye_c[s]
        ring = []
        for i in range(28):
            a = 2 * math.pi * i / 28
            cy, sy = math.cos(a), math.sin(a)
            ring.append((cx, e.y + half_w * math.copysign(abs(cy) ** power, cy), e.z + 0.4 * hs + half_h * math.copysign(abs(sy) ** power, sy)))
        p.tube(ring, r, seg=8, closed=True)
        p.tube([(cx, e.y + s * half_w, e.z + 1.0), (c.skull_c.x - 3.0, s * (c.skull_r.y + 0.7), e.z + 1.5)], r * 0.9, seg=6)
    inner = abs(c.eye_c[1].y) - half_w
    p.tube([(cx, inner, c.eye_c[1].z + 1.0), (cx + 0.5, 0, c.eye_c[1].z + 1.8), (cx, -inner, c.eye_c[1].z + 1.0)], r, seg=8)
    return p


def hoops(c, colour=GOLD, radius=5.0, thick=0.8, drop=6.5):
    p = c.P("earrings", colour, raw=True, rough=0.28, rigid="head")
    for s in (1, -1):
        centre = c.head_c + Vector((-1.5 * c.hs, s * (c.skull_r.y + 0.8), (0.5 - drop) * c.hs))
        p.torus(centre, radius, thick, r3=rot(90, 0, 0), seg=20, rseg=8)
    return p


def buttons(c, colour, ys, zs, r=1.5, name="buttons", bones=("spine", "chest")):
    p = c.P(name, colour, raw=True, rough=0.3, bones=list(bones))
    for z in zs:
        for y in ys:
            p.ball((c.torso_x(y, z) - 0.2, y, z), r, scale=(0.6, 1.0, 1.0), seg=10)
    return p


# =====================================================================================================
# 1. Rex Granite - washed-up action-movie hero
# =====================================================================================================

def rex():
    skin = col("#c98a5e")
    c = Char("Rex", skin, leg=1.0, torso=1.05, arm=1.05, shoulders=27.0, hips=11.5, head=0.98,
             chest=(26.0, 17.5), waist=(18.5, 13.5), hip=(18.5, 14.0), arm_r=(10.2, 8.4, 6.7), leg_r=(11.5, 8.6, 6.6),
             neck_r=9.6, hand=1.14, skull=(18.5, 18.0, 19.0), jaw=(16.5, 17.6, 13.5), jaw_drop=9.5, hair=col("#3b2a1c"),
             eye_size=0.88, mouth_scale=1.05, mouth_z=-12.0)
    C, hs = c.head_c, c.hs
    c.torso(col("#1b1b1f"), sleeves="none", pecs=1.0, yoke=False, rough=0.8)
    c.yoke(skin, traps=1.0)
    c.arms(skin)
    c.hands(col("#1c1c20"), rough=0.6)
    c.neck(skin)
    c.bottom(col("#56683a"), kind="pants", paint=paint_blotch(col("#56683a"), col("#2f3d22")), cuff=1.0)
    c.boots(col("#17171a"), shaft=0.42, rough=0.4, sole=col("#3a3a3f"))
    belt(c, col("#2a2118"))

    stubble = mix(skin, col("#3b2a1c"), 0.42)
    c.head(nose=("wide", 5.0), chin=1.25, brow_ridge=1.0,
           paint=paint_region(skin, stubble, lambda co: (co[:, 2] < C.z - 5.5 * hs) & (co[:, 0] > C.x - 1.0) & (co[:, 2] > C.z - 26 * hs)))
    c.eyes(iris=col("#4a6fa5"), brow_r=2.4)
    c.mouths()

    hair = c.P("hair", c.hair_col, voxel=1.2, smooth=3, rigid="head", rough=0.8)      # flat-top
    hair.ball(C + Vector((-2.0, 0, 14.5)) * hs, 1.0, scale=(16.5 * hs, 16.0 * hs, 7.0 * hs))
    hair.box(C + Vector((-2.0, 0, 18.0)) * hs, (27 * hs, 27 * hs, 7 * hs), bevel=2.5)
    hair.ball(C + Vector((-12.0, 0, 4.0)) * hs, 1.0, scale=(8.5 * hs, 16.5 * hs, 13.0 * hs))
    red = col("#c62828")
    band = c.P("bandana", red, raw=True, rough=0.8, rigid="head")
    ring = c.skull_ring(9.0, grow=0.6, wobble=1.2)
    band.tube(ring, [2.5] * len(ring), seg=12, closed=True)
    knot = c.P("bandana_tails", red, voxel=1.0, smooth=3, rigid="tail", rough=0.8)
    kb = Vector(ring[len(ring) // 2]) + Vector((-1.5, 0, -1.0))
    knot.ball(kb, 3.6)
    knot.capsule(kb, kb + Vector((-7, 5, -13)), 2.3, 1.5)
    knot.capsule(kb, kb + Vector((-9, -4, -10)), 2.3, 1.5)

    strap, path = sash(c, col("#5a3c22"), name="bandolier")
    shells = c.P("bandolier_shells", GOLD, raw=True, rough=0.3, bones=["spine", "chest"])
    for i in (29, 30, 31, 0, 1, 2, 3):
        x, y, z = path[i % 32]
        shells.cyl((x + 1.8, y, z - 3.2), (x + 1.8, y, z + 3.2), 1.25, seg=8)
    return c


# =====================================================================================================
# 2. Lola Glitz - chart-topping pop diva
# =====================================================================================================

def lola():
    skin = col("#f2c4a4")
    pink = col("#ff2d95")
    c = Char("Lola", skin, leg=1.06, torso=0.94, arm=0.96, shoulders=18.5, hips=11.5, head=1.05,
             chest=(17.0, 12.5), waist=(12.5, 10.0), hip=(18.0, 13.0), arm_r=(5.2, 4.6, 4.0), leg_r=(9.0, 6.4, 4.8),
             neck_r=5.2, hand=0.86, foot=0.86, skull=(18.5, 18.0, 19.5), jaw=(13.5, 14.2, 12.0), jaw_drop=8.5,
             hair=col("#f6e58d"), eye_size=1.2, mouth_scale=0.9, lip=col("#d81b60"), skirt_bone=True)
    C, hs = c.head_c, c.hs
    sparkle = paint_speckle(pink, col("#ffd1ec"), amount=0.16, scale=0.9)
    c.torso(pink, sleeves="none", yoke=False, rough=0.5, paint=sparkle)
    c.yoke(skin)
    c.arms(skin)
    c.gauntlets(WHITE, rough=0.4)
    c.hands(WHITE, rough=0.4)
    c.neck(skin)
    c.bottom(pink, kind="trunks", rough=0.5, paint=sparkle)
    c.skirt(pink, 12.5, 27.0, c.pelvis_z + 10.0, c.pelvis_z - 11.0, rough=0.5, paint=sparkle)
    c.legs(skin)
    c.boots(WHITE, shaft=0.85, rough=0.35, heel=2.0)
    belt(c, col("#ffe14d"), buckle=None, drop=9.5, r=1.6)

    blush = mix(skin, col("#ff6f91"), 0.5)
    cheek = [c.face_pt(s * 9.5, -5.0) for s in (1, -1)]
    c.head(nose=("button", 3.3), cheeks=0.55,
           paint=paint_region(skin, blush, lambda co: (np.linalg.norm(co - np.array(cheek[0]), axis=1) < 4.6 * hs) | (np.linalg.norm(co - np.array(cheek[1]), axis=1) < 4.6 * hs)))
    c.eyes(iris=col("#1fb5a3"), lid=col("#6ecbff"), lash=True, brow=col("#b08a2e"), brow_r=1.15)
    c.mouths()

    hair = hair_cap(c, c.hair_col, grow=1.6, shift=(-2.8, 0, 3.2))
    for s in (1, -1):                                                            # swooping fringe + side locks
        hair.capsule(c.face_pt(s * 1.0, 13.5, 0.5), c.face_pt(s * 14.0, 6.5, 0.2), 4.2 * hs, 3.0 * hs)
        hair.capsule(C + Vector((2.0, s * 17.5, 4.0)) * hs, C + Vector((3.0, s * 17.0, -14.0)) * hs, 3.4 * hs, 2.0 * hs)
    tail = c.P("ponytail", c.hair_col, voxel=1.3, smooth=3, rigid="tail", rough=0.8)
    pts = [(-11, 0, 17), (-21, 0, 25), (-30, 0, 19), (-34, 0, 4), (-33, 0, -12), (-29, 0, -25)]
    rad = [6.5, 9.0, 9.5, 8.0, 6.0, 3.2]
    for i in range(len(pts) - 1):
        tail.capsule(C + Vector(pts[i]) * hs, C + Vector(pts[i + 1]) * hs, rad[i] * hs, rad[i + 1] * hs)
    tie = c.P("hair_tie", pink, raw=True, rough=0.5, rigid="tail")
    tie.torus(C + Vector((-13.5, 0, 19)) * hs, 6.2 * hs, 1.8 * hs, r3=rot(0, 50, 0), seg=20, rseg=8)
    stars = c.P("earrings", col("#ffe14d"), raw=True, rough=0.3, rigid="head")
    for s in (1, -1):
        stars.ball(C + Vector((-1.5, s * 19.2, -7.5)) * hs, 2.6 * hs, scale=(1.0, 0.5, 1.0), seg=10)
    mic = c.P("headset", BLACK, raw=True, rough=0.4, rigid="head")
    ear = C + Vector((0.0, 19.0, -1.0)) * hs
    tip = Vector((c.mouth_c.x + 3.0, 8.5 * hs, c.mouth_c.z - 1.0))
    mic.tube([ear, (ear + tip) * 0.5 + Vector((3.0, 2.0, -2.5)), tip], 0.7, seg=8)
    mic.ball(tip, 2.0, seg=12)
    return c


# =====================================================================================================
# 3. Chef Bruno Flambe - volcanic TV chef
# =====================================================================================================

def bruno():
    skin = col("#dba27c")
    c = Char("Bruno", skin, leg=0.86, torso=1.0, arm=0.95, shoulders=25.0, hips=13.0, head=1.06,
             chest=(24.0, 18.0), waist=(23.0, 19.0), hip=(23.5, 18.0), belly=1.0, arm_r=(8.6, 7.4, 6.2), leg_r=(11.5, 8.5, 6.5),
             neck_r=9.5, hand=1.08, skull=(19.5, 19.0, 19.0), jaw=(18.0, 19.5, 14.5), jaw_drop=9.0, hair=col("#1c1612"),
             eye_size=0.95, belly_bone=True)
    C, hs = c.head_c, c.hs
    white = col("#f1eee6")
    c.torso(white, sleeves="long", rough=0.8, sleeve_r=2.0)
    buttons(c, col("#22252e"), (-6.5, 6.5), [c.waist_z + k * 8.5 for k in range(0, 4)], r=1.7, bones=("spine", "chest", "belly"))
    c.hands(skin)
    c.neck(skin)
    c.bottom(WHITE, kind="pants", paint=paint_checker(col("#f1eee6"), col("#23252b"), 4.2))
    c.boots(col("#1a1a1d"), shaft=0.0, rough=0.4, sole=col("#3b3b40"))
    scarf = c.P("neckerchief", col("#d32f2f"), voxel=1.2, smooth=3, rough=0.8, bones=["chest", "neck"])
    scarf.torus((0.5, 0, c.neck_z + 0.5), c.neck_r + 2.2, 3.2, seg=20, rseg=10)
    scarf.ball((c.neck_r + 3.5, 0, c.neck_z - 2.0), 3.6)
    scarf.capsule((c.neck_r + 3.5, 0, c.neck_z - 2.0), (c.neck_r + 6.5, 3.5, c.neck_z - 10.5), 2.6, 1.4)

    rosy = mix(skin, col("#e2574c"), 0.5)
    nose_tip = c.face_pt(0, 0.0, 4.0)
    cheek = [c.face_pt(s * 11.0, -5.5) for s in (1, -1)]
    c.head(nose=("ball", 6.2), chin=1.3, cheeks=1.0,
           paint=paint_region(skin, rosy, lambda co: (np.linalg.norm(co - np.array(nose_tip), axis=1) < 6.0 * hs)
                              | (np.linalg.norm(co - np.array(cheek[0]), axis=1) < 5.0 * hs) | (np.linalg.norm(co - np.array(cheek[1]), axis=1) < 5.0 * hs)))
    c.eyes(iris=col("#5a3a22"), brow_r=2.3)
    c.mouths()
    stache = c.P("moustache", c.hair_col, raw=True, rough=0.7, rigid="head")
    for s in (1, -1):
        base = c.face_pt(s * 1.0, -7.2, 1.0)
        pts = [base, c.face_pt(s * 6.5, -8.6, 1.2), c.face_pt(s * 11.5, -8.0, 1.4), c.face_pt(s * 14.5, -5.0, 2.0), c.face_pt(s * 13.5, -2.2, 2.6)]
        stache.tube(pts, [2.7 * hs, 2.6 * hs, 2.0 * hs, 1.3 * hs, 0.7 * hs], seg=10)
        stache.ball(pts[0], 2.7 * hs, seg=10)
        stache.ball(pts[-1], 0.7 * hs, seg=8)
    sides = c.P("hair", c.hair_col, voxel=1.2, smooth=3, rigid="head", rough=0.8)
    for s in (1, -1):
        sides.ball(C + Vector((-3.0, s * 16.5, 4.0)) * hs, 1.0, scale=(8.5 * hs, 4.5 * hs, 8.0 * hs))
    sides.ball(C + Vector((-13.0, 0, 3.0)) * hs, 1.0, scale=(7.0 * hs, 15.0 * hs, 9.0 * hs))
    toque = c.P("toque", white, voxel=1.4, smooth=4, rigid="hair", rough=0.85)       # tall chef's hat, wobbles on the hair bone
    top = C + Vector((-1.5, 0, 12.0)) * hs
    toque.cyl(top, top + Vector((0, 0, 9)), 17.5 * hs, 17.0 * hs, seg=28)
    toque.cyl(top + Vector((0, 0, 8)), top + Vector((0, 0, 27)), 15.5 * hs, 18.5 * hs, seg=28)
    toque.ball(top + Vector((0, 0, 28)), 1.0, scale=(20.5 * hs, 20.5 * hs, 9.5 * hs))
    for k in range(7):
        a = 2 * math.pi * k / 7
        toque.ball(top + Vector((15.5 * hs * math.cos(a), 15.5 * hs * math.sin(a), 30)), 7.0 * hs)
    return c


# =====================================================================================================
# 4. Chip Sterling - smug tech billionaire
# =====================================================================================================

def chip():
    skin = col("#efd0b8")
    grey = col("#8e959f")
    c = Char("Chip", skin, leg=1.02, torso=0.98, arm=1.0, shoulders=19.5, hips=10.0, head=1.12,
             chest=(17.5, 12.0), waist=(15.0, 11.0), hip=(15.5, 11.5), arm_r=(5.6, 5.0, 4.3), leg_r=(7.6, 6.0, 4.8),
             neck_r=5.6, hand=0.92, skull=(19.5, 18.5, 20.5), jaw=(13.5, 14.0, 12.0), jaw_drop=9.5, hair=col("#6b4a2f"),
             mouth_scale=0.85)
    C, hs = c.head_c, c.hs
    body = c.torso(grey, sleeves="long", rough=0.9, sleeve_r=2.4)
    body.ball((-9.5, 0, c.neck_z + 1.0), 1.0, scale=(8.0, 13.5, 9.0))                 # hood bunched behind the neck
    body.ball((c.torso_x(0, c.waist_z + 5) - 3.0, 0, c.waist_z + 5.0), 1.0, scale=(5.0, 11.5, 7.0))   # kangaroo pocket
    cords = c.P("drawstrings", WHITE, raw=True, rough=0.7, rigid="chest")
    for s in (1, -1):
        top = Vector((c.torso_x(s * 3.5, c.neck_z - 9) + 0.6, s * 3.5, c.neck_z - 8.0))
        cords.capsule(top, top + Vector((1.2, s * 0.8, -12.0)), 0.8, seg=8)
    logo = c.P("logo", col("#ff7a1a"), raw=True, rough=0.5, rigid="chest")
    lz = c.chest_z + 12.0
    logo.ball((c.torso_x(8.0, lz) - 0.6, 8.0, lz), 3.0, scale=(0.4, 1.0, 1.0), seg=14)
    c.hands(skin)
    c.neck(skin)
    c.bottom(col("#3d5f96"), kind="pants", cuff=0.8)
    c.boots(WHITE, shaft=0.0, rough=0.5, sole=col("#19b3a6"))
    watch = c.P("watch", BLACK, raw=True, rough=0.3, rigid="forearm_l")
    w = c._arm(1, c.upper_len + c.fore_len * 0.86)
    watch.torus(w, c.arm_r[2] + 2.6, 1.3, r3=common.track(c.armdir(1)), seg=18, rseg=8)

    c.head(nose=("long", 3.3))
    c.eyes(iris=col("#4f8a5b"), brow_r=1.2)
    c.mouths()
    glasses(c, BLACK, round_=False, r=1.0)
    hair = hair_cap(c, c.hair_col, grow=1.0, shift=(-2.6, 0, 3.2))
    hair.capsule(c.face_pt(-9.0, 14.0, 0.4), c.face_pt(11.0, 11.5, 0.6), 3.8 * hs, 2.8 * hs)     # neat side parting
    return c


# =====================================================================================================
# 5. DJ Wubz - festival DJ in an LED-visor helmet
# =====================================================================================================

def wubz():
    teal = col("#19b3a6")
    neon = col("#39e75f")
    purple = col("#7b2ff7")
    led = col("#5cf2ff")
    c = Char("Wubz", teal, leg=1.0, torso=0.96, arm=1.0, shoulders=21.0, hips=10.5, head=1.1,
             chest=(19.5, 13.5), waist=(15.5, 11.5), hip=(16.5, 12.5), arm_r=(6.4, 5.6, 4.8), leg_r=(8.6, 6.6, 5.2),
             neck_r=6.0, skull=(20.0, 20.0, 19.5), jaw=(17.5, 18.8, 13.5), jaw_drop=8.5, mouth_scale=1.0)
    C, hs = c.head_c, c.hs
    # The "face" is a dark visor; LED features sit on its surface.
    visor_c = C + Vector((5.5, 0, 0.5)) * hs
    visor_r = Vector((18.4, 18.4, 12.5)) * hs

    def visor_x(y, z):
        u = 1.0 - (y / visor_r.y) ** 2 - ((z - visor_c.z) / visor_r.z) ** 2
        return visor_c.x + visor_r.x * math.sqrt(max(u, 0.01))

    for s in (1, -1):
        y, z = s * 7.6 * hs, C.z + 1.6 * hs
        c.eye_c[s] = Vector((visor_x(y, z) - 4.2 * hs, y, z))      # bones() puts the pupil 4.4*hs in front of this
    mz = C.z - 6.0 * hs
    c.mouth_c = Vector((visor_x(0, mz) + 0.2, 0, mz))

    c.torso(neon, sleeves="long", rough=0.45, sleeve_r=2.0,
            paint=paint_region(neon, purple, lambda co: (np.abs(co[:, 1]) > c.shoulders + 3.0) & (co[:, 0] > -3.0) & (co[:, 0] < 3.0)))
    c.hands(teal, rough=0.5)
    c.neck(BLACK, rough=0.5)
    c.bottom(col("#16161a"), kind="pants", rough=0.6,
             paint=paint_region(col("#16161a"), neon, lambda co: (np.abs(co[:, 1]) > c.hips + c.leg_r[1] * 0.55) & (np.abs(co[:, 0]) < 2.2) & (co[:, 2] < c.hip_z)))
    c.boots(WHITE, shaft=0.15, rough=0.4)
    for s, t in ((1, "l"), (-1, "r")):
        sole = c.P("sole_" + t, purple, raw=True, rough=0.4, rigid="foot_" + t, slot="Glow")
        sole.box((3.6, c.ankle(s).y, 1.6), (24.5, 13.2, 3.2), bevel=1.4, bseg=3)
    chain = c.P("chain", GOLD, raw=True, rough=0.25, bones=["chest", "spine"])
    path = loop_around((2.0, 0, 0), c.chest[1] * 0.78, c.chest[0] * 0.5, lambda a: c.neck_z - 6.0 - 8.0 * max(0.0, math.cos(a)), n=24)
    chain.tube(path, [1.3] * 24, seg=8, closed=True)
    pend = c.P("pendant", GOLD, raw=True, rough=0.25, rigid="chest")
    pz = c.neck_z - 17.0
    pend.mesh(text_mesh("W", font=FONT_TITLE, size=11.0, depth=2.0, bevel=0.05),
              m=Matrix.Translation((c.torso_x(0, pz) + 1.2, 0, pz)) @ rot(0, 0, 90) @ rot(90, 0, 0))

    helmet = c.P("helmet", col("#f3f3f6"), voxel=1.1, smooth=4, lumps=0.08, rigid="head", rough=0.3)
    helmet.ball(c.skull_c, 1.0, scale=tuple(c.skull_r))
    helmet.ball(c.jaw_c, 1.0, scale=tuple(c.jaw_r))
    visor = c.P("visor", col("#0b0b12"), raw=True, rough=0.12, rigid="head")
    visor.ball(visor_c, 1.0, scale=tuple(visor_r), seg=36)
    stripe = c.P("helmet_stripe", purple, raw=True, rough=0.4, rigid="head")
    crest = [(c.skull_c.x + (c.skull_r.x + 0.5) * math.cos(a), 0, c.skull_c.z + (c.skull_r.z + 0.5) * math.sin(a)) for a in [math.radians(40 + 10 * i) for i in range(15)]]
    stripe.tube(crest, 2.6, seg=10, m=Matrix.Diagonal((1.0, 1.6, 1.0, 1.0)))
    cans = c.P("headphones", purple, raw=True, rough=0.4, rigid="head")
    band = [(c.skull_c.x - 3.0, (c.skull_r.y + 2.2) * math.cos(math.pi * i / 14), c.skull_c.z + (c.skull_r.z + 2.2) * math.sin(math.pi * i / 14)) for i in range(15)]
    cans.tube(band, 2.2, seg=8)
    cups = c.P("headphone_cups", col("#16161a"), raw=True, rough=0.4, rigid="head")
    for s in (1, -1):
        ear = Vector((c.skull_c.x - 3.0, s * (c.skull_r.y + 0.5), C.z - 1.0 * hs))
        cups.cyl(ear, ear + Vector((0, s * 6.5, 0)), 9.5 * hs, 8.5 * hs, seg=24)
        cans.cyl(ear + Vector((0, s * 6.5, 0)), ear + Vector((0, s * 7.5, 0)), 5.0 * hs, seg=20)

    # LED face: eyes on the pupil bones, brow bars on the brow bones, one glowing mouth per mouth bone.
    def led_piece(name, bone):
        return c.P(name, led, raw=True, rough=0.4, rigid=bone, slot="Glow")

    for s, t in ((1, "l"), (-1, "r")):
        e = c.eye_c[s] + Vector((4.4 * hs, 0, 0))
        led_piece("led_eye_" + t, "pupil_" + t).box(e, (1.2, 5.6 * hs, 5.6 * hs), bevel=0.5)
        b = c.eye_c[s] + Vector((3.9, 0, 7.6)) * hs
        led_piece("led_brow_" + t, "brow_" + t).box(b + Vector((0.4, 0, 0)), (1.0, 7.0 * hs, 1.5 * hs), r3=rot(s * 12, 0, 0), bevel=0.3)
    M = Matrix.Translation(c.mouth_c) @ Matrix.Scale(hs, 4)
    led_piece("led_closed", "mouth_closed").box((0.5, 0, 0), (1.0, 11.0, 1.5), bevel=0.3, m=M)
    zig = [(0.5, -7.5 + 2.5 * i, 1.6 if i % 2 else -1.6) for i in range(7)]
    led_piece("led_grit", "mouth_grit").tube(zig, 0.75, seg=6, m=M)
    led_piece("led_open", "mouth_open").torus((0.5, 0, 0), 4.2, 0.9, r3=rot(0, 90, 0), squash=1.35, seg=24, rseg=6, m=M)
    led_piece("led_ouch", "mouth_ouch").torus((0.5, 0, 0), 2.3, 0.8, r3=rot(0, 90, 0), seg=18, rseg=6, m=M)
    smile = [(0.5, y, 3.0 * (y / 7.5) ** 2 - 1.6) for y in (-7.5, -5.0, -2.5, 0.0, 2.5, 5.0, 7.5)]
    led_piece("led_grin", "mouth_grin").tube(smile, 0.85, seg=6, m=M)
    return c


# =====================================================================================================
# 6. Duchess Winnifred - frosty society royal
# =====================================================================================================

def duchess():
    skin = col("#f3d7c6")
    royal = col("#5e2a96")
    c = Char("Duchess", skin, leg=1.05, torso=1.06, arm=1.0, shoulders=19.0, hips=11.0, head=1.0,
             chest=(17.5, 12.5), waist=(12.0, 9.5), hip=(17.0, 12.5), arm_r=(5.0, 4.4, 3.8), leg_r=(8.2, 6.0, 4.6),
             neck_r=5.0, hand=0.85, foot=0.82, skull=(18.0, 17.5, 20.0), jaw=(12.8, 13.2, 12.5), jaw_drop=10.0,
             hair=col("#d9d5e3"), mouth_scale=0.72, lip=col("#b3123a"), skirt_bone=True)
    C, hs = c.head_c, c.hs
    body = c.torso(royal, sleeves="short", rough=0.6, sleeve_r=1.2)
    for s in (1, -1):
        body.ball(c.shoulder(s) + Vector((0, s * 2.5, 0.5)), 10.5)                      # puffed sleeves
    c.arms(skin, upper=False)
    c.gauntlets(WHITE, rough=0.45, start=-0.2)
    c.hands(WHITE, rough=0.45)
    c.neck(skin)
    c.bottom(royal, kind="trunks", rough=0.6)
    legs_b = ["pelvis", "thigh_l", "thigh_r", "shin_l", "shin_r"]
    c.skirt(royal, 12.5, 34.0, c.pelvis_z + 9.0, c.knee_z - 5.0, rough=0.6, bones=legs_b)
    hem = c.P("hem", GOLD, raw=True, rough=0.3, bones=legs_b)
    hem.torus((0, 0, c.knee_z - 5.0), 33.5, 1.8, seg=40, rseg=8, m=Matrix.Diagonal((0.86, 1.0, 1.0, 1.0)))
    c.legs(col("#f4f0ea"), upper=False)
    c.boots(GOLD, shaft=0.0, rough=0.3, heel=3.0)
    strap, path = sash(c, col("#c62828"), r=2.6, drop=16.0, high=1, flat=1.0, name="sash")
    medal = c.P("medal", GOLD, raw=True, rough=0.25, rigid="chest")
    mz = c.chest_z + 9.0
    medal.prism([(3.8 * math.cos(math.pi * i / 5 + math.pi / 2) * (1.0 if i % 2 == 0 else 0.45),
                  3.8 * math.sin(math.pi * i / 5 + math.pi / 2) * (1.0 if i % 2 == 0 else 0.45)) for i in range(10)], -0.6, 0.9,
                m=Matrix.Translation((c.torso_x(-7.0, mz) + 0.6, -7.0, mz)) @ rot(0, 0, 90) @ rot(90, 0, 0))
    pearls = c.P("pearls", col("#fbf7ee"), raw=True, rough=0.2, bones=["chest", "neck"])
    for (x, y, z) in loop_around((1.0, 0, 0), c.neck_r + 4.5, c.neck_r + 5.5, lambda a: c.neck_z - 1.5 - 3.5 * max(0.0, math.cos(a)), n=20):
        pearls.ball((x, y, z), 1.55, seg=10)

    c.head(nose=("long", 3.0), chin=0.6)
    c.eyes(iris=col("#7e57c2"), lid=shade(skin, 0.86), lash=True, brow=col("#9a96a6"), brow_r=1.0, lid_drop=2.7)
    c.mouths()
    hair = hair_cap(c, c.hair_col, grow=1.2, shift=(-2.8, 0, 3.0))
    hive = c.P("beehive", c.hair_col, voxel=1.3, smooth=3, rigid="hair", rough=0.8)      # towering updo, wobbles
    base = C + Vector((-3.0, 0, 15.0)) * hs
    for k, (r, z) in enumerate(((14.5, 4.0), (13.0, 13.0), (10.5, 21.5), (7.5, 28.5), (4.5, 33.5))):
        hive.ball(base + Vector((-k * 0.8, 0, z)) * hs, r * hs, scale=(1.0, 1.0, 0.8))
    tiara = c.P("tiara", GOLD, raw=True, rough=0.25, rigid="head")
    ring = c.skull_ring(12.5, grow=1.4)
    front = [ring[i % len(ring)] for i in range(-7, 8)]
    tiara.tube(front, 1.2, seg=8)
    gems = c.P("tiara_gems", col("#e53935"), raw=True, rough=0.15, rigid="head")
    for k, i in enumerate((-5, -3, 0, 3, 5)):
        x, y, z = ring[i % len(ring)]
        h = 7.5 if i == 0 else (5.5 if abs(i) == 3 else 4.0)
        tiara.cyl((x, y, z), (x + 0.6, y, z + h), 1.5, 0.3, seg=8)
        gems.ball((x + 0.7, y, z + h + 0.6), 1.5 if i == 0 else 1.1, seg=10)
    drops = c.P("earrings", col("#fbf7ee"), raw=True, rough=0.2, rigid="head")
    for s in (1, -1):
        drops.ball(C + Vector((-1.5, s * 18.5, -7.5)) * hs, 2.0 * hs, scale=(1.0, 1.0, 1.35), seg=10)
    return c


# =====================================================================================================
# 7. Vince Voltage - stadium rock survivor
# =====================================================================================================

def vince():
    skin = col("#e6c3ad")
    leather = col("#17161a")
    c = Char("Vince", skin, leg=1.1, torso=0.98, arm=1.04, shoulders=20.5, hips=9.8, head=0.98,
             chest=(18.5, 12.0), waist=(13.5, 10.0), hip=(14.5, 11.0), arm_r=(5.6, 5.0, 4.3), leg_r=(7.4, 5.8, 4.6),
             neck_r=5.6, hand=0.98, skull=(18.0, 17.5, 19.5), jaw=(13.5, 14.5, 13.5), jaw_drop=10.5, hair=col("#18141a"),
             eye_size=0.95, lip=col("#7a2a35"))
    C, hs = c.head_c, c.hs
    c.torso(leather, sleeves="none", yoke=False, rough=0.32)
    c.yoke(skin)
    ink = mix(skin, col("#27445e"), 0.6)
    c.arms(skin, paint=paint_blotch(skin, ink, scale=0.16, threshold=0.22))
    c.hands(skin)
    c.neck(skin)
    zipper = c.P("zipper", SILVER, raw=True, rough=0.25, bones=["spine", "chest"])
    zs = [c.waist_z + 1.0 + 4.0 * i for i in range(9)]
    zipper.tube([(c.torso_x(0, z) + 0.3, 0, z) for z in zs], 0.75, seg=6)
    studs = c.P("studs", SILVER, raw=True, rough=0.2, bones=["chest", "clavicle_l", "clavicle_r"])
    for s in (1, -1):
        for k in range(3):
            base = Vector((1.5 - k * 3.0 + 2.0, s * (c.shoulders - 5.5), c.shoulder_z + 9.0))
            studs.cyl(base, base + Vector((0, s * 0.8, 3.6)), 1.7, 0.2, seg=8)
    bands = c.P("wristbands", leather, raw=True, rough=0.35, bones=["forearm_l", "forearm_r"])
    spikes = c.P("wrist_spikes", SILVER, raw=True, rough=0.2, bones=["forearm_l", "forearm_r"])
    for s in (1, -1):
        w = c._arm(s, c.upper_len + c.fore_len * 0.8)
        d = c.armdir(s)
        bands.cyl(w - d * 3.2, w + d * 3.2, c.arm_r[2] + 1.9, seg=18)
        for k in range(6):
            a = 2 * math.pi * k / 6
            n = (Vector((1, 0, 0)) * math.cos(a) + d.cross(Vector((1, 0, 0))).normalized() * math.sin(a))
            spikes.cyl(w + n * (c.arm_r[2] + 1.6), w + n * (c.arm_r[2] + 4.6), 1.2, 0.15, seg=6)
    red = col("#b3202a")
    c.bottom(red, kind="pants", rough=0.4)
    c.boots(col("#efeae0"), shaft=0.5, rough=0.4, heel=2.2)
    belt(c, leather, buckle=SILVER, drop=6.5, r=2.2)

    c.head(nose=("hook", 3.6), chin=0.8)
    c.eyes(iris=col("#8fd3ff"), lid=col("#3a3340"), brow_r=1.25)
    c.mouths()
    hair = hair_cap(c, c.hair_col, grow=2.0, shift=(-2.6, 0, 3.4))
    for s in (1, -1):                                                              # shaggy fringe and side curtains
        hair.capsule(c.face_pt(s * 2.0, 15.0, 0.6), c.face_pt(s * 13.5, 4.0, 0.6), 4.6 * hs, 2.6 * hs)
        hair.capsule(C + Vector((4.0, s * 17.5, 6.0)) * hs, C + Vector((6.0, s * 16.5, -19.0)) * hs, 4.2 * hs, 2.2 * hs)
    mane = c.P("mane", c.hair_col, voxel=1.3, smooth=3, rigid="tail", rough=0.8)       # long back hair, swings
    for y in (-10.0, -3.5, 3.5, 10.0):
        mane.capsule(C + Vector((-13.0, y, 6.0)) * hs, C + Vector((-15.0 - abs(y) * 0.2, y * 1.25, -30.0 + abs(y) * 0.6)) * hs, 6.5 * hs, 3.0 * hs)
    bolt = c.P("earring", GOLD, raw=True, rough=0.25, rigid="head")
    e = C + Vector((-1.5, -18.6, -6.0)) * hs
    bolt.prism([(0, 4), (2.2, 0.6), (0.6, 0.6), (2.2, -4), (-1.4, -0.4), (0.2, -0.4)], -0.5, 0.5, m=Matrix.Translation(e) @ rot(90, 0, 0))
    return c


# =====================================================================================================
# 8. Madame Mystica - late-night TV psychic
# =====================================================================================================

def mystica():
    skin = col("#a9714e")
    teal = col("#157f86")
    plum = col("#6a1b9a")
    c = Char("Mystica", skin, leg=0.92, torso=1.0, arm=0.98, shoulders=21.0, hips=12.5, head=1.05,
             chest=(20.5, 15.0), waist=(18.5, 14.5), hip=(21.0, 15.5), belly=0.25, arm_r=(6.6, 5.8, 4.8), leg_r=(9.5, 7.0, 5.4),
             neck_r=6.4, hand=0.95, skull=(19.0, 18.5, 19.5), jaw=(15.0, 16.0, 13.0), jaw_drop=9.0, hair=col("#1d1420"),
             eye_size=1.1, lip=col("#7b1fa2"), skirt_bone=True)
    C, hs = c.head_c, c.hs
    starry = paint_speckle(teal, col("#f2c94c"), amount=0.1, scale=0.7)
    body = c.torso(teal, sleeves="long", rough=0.7, sleeve_r=3.0, paint=starry)
    for s in (1, -1):                                                              # bell cuffs
        body.cyl(c._arm(s, c.upper_len + c.fore_len * 0.6), c._arm(s, c.upper_len + c.fore_len * 0.98), c.arm_r[2] + 3.0, c.arm_r[2] + 8.5, seg=20)
    c.hands(skin)
    c.neck(skin)
    c.bottom(teal, kind="trunks", paint=starry)
    c.skirt(teal, 19.5, 31.0, c.pelvis_z + 9.0, c.ankle_z + 13.0, paint=starry, squash=0.9,
            bones=["pelvis", "thigh_l", "thigh_r", "shin_l", "shin_r"])
    c.legs(skin, upper=False)
    c.boots(GOLD, shaft=0.0, rough=0.3)
    for s, t in ((1, "l"), (-1, "r")):
        curl = c.P("slipper_curl_" + t, GOLD, raw=True, rough=0.3, rigid="foot_" + t)
        y = c.ankle(s).y
        curl.tube([(14, y, 4), (19, y, 6), (20.5, y, 10.5), (17.5, y, 12.5)], [2.6, 2.0, 1.4, 0.9], seg=8)
        curl.ball((17.5, y, 12.5), 1.5, seg=8)
    wrap = belt(c, plum, buckle=None, drop=9.0, r=3.0, name="sash_belt")
    bangles = c.P("bangles", GOLD, raw=True, rough=0.25, bones=["forearm_l", "forearm_r"])
    for s in (1, -1):
        for f in (0.5, 0.58):
            bangles.torus(c._arm(s, c.upper_len + c.fore_len * f), c.arm_r[2] + 4.2, 1.0, r3=common.track(c.armdir(s)), seg=18, rseg=6)
    beads = c.P("beads", col("#e53935"), raw=True, rough=0.3, bones=["chest", "spine"])
    for (x, y, z) in loop_around((2.0, 0, 0), c.chest[1] * 0.8, c.chest[0] * 0.55, lambda a: c.neck_z - 5.0 - 11.0 * max(0.0, math.cos(a)), n=22):
        beads.ball((x, y, z), 1.9, seg=10)

    mole = c.face_pt(8.5, -7.5, -0.2)
    c.head(nose=("wide", 4.3), cheeks=0.5,
           paint=paint_region(skin, shade(skin, 0.4), lambda co: np.linalg.norm(co - np.array(mole), axis=1) < 1.25))
    c.eyes(iris=col("#d99a2b"), lid=plum, lash=True, brow_r=1.3)
    c.mouths()
    hoops(c, GOLD, radius=6.0, thick=0.9, drop=8.0)
    turban = c.P("turban", plum, voxel=1.3, smooth=3, rigid="head", rough=0.75)
    turban.ball(c.skull_c + Vector((-2.0, 0, 6.5)) * hs, 1.0, scale=((c.skull_r.x + 2.5), (c.skull_r.y + 2.5), (c.skull_r.z + 0.5) * 0.86))
    for k, tilt in enumerate((-22, 0, 22)):                                             # wrapped folds
        turban.torus(c.skull_c + Vector((-2.0, 0, 9.0 + k * 1.0)) * hs, 18.5 * hs, 4.2 * hs, r3=rot(tilt, 8, 0), seg=28, rseg=10)
    turban.ball(c.skull_c + Vector((-2.0, 0, 21.0)) * hs, 9.0 * hs, scale=(1.0, 1.0, 0.7))
    gem_pos = Vector((c.face_x(0, C.z + 13.0 * hs) + 2.6, 0, C.z + 14.0 * hs))
    setting = c.P("gem_setting", GOLD, raw=True, rough=0.25, rigid="head")
    setting.ball(gem_pos, 4.4 * hs, scale=(0.5, 1.0, 1.2), seg=14)
    gem = c.P("gem", col("#e53935"), raw=True, rough=0.1, rigid="head")
    gem.ball(gem_pos + Vector((1.2, 0, 0)), 3.1 * hs, scale=(0.6, 1.0, 1.2), seg=14)
    plume = c.P("plume", col("#f4f1ea"), voxel=1.0, smooth=3, rigid="hair", rough=0.85)
    f0 = gem_pos + Vector((-1.0, 0, 3.0))
    plume.capsule(f0, f0 + Vector((-2.0, 0, 13.0)), 2.6, 3.4)
    plume.capsule(f0 + Vector((-2.0, 0, 13.0)), f0 + Vector((-8.0, 0, 23.0)), 3.4, 1.4)
    return c


# =====================================================================================================
# Referee and commentators
# =====================================================================================================

def ref():
    skin = col("#e2b393")
    grey = col("#8c8c8c")
    c = Char("Ref", skin, leg=0.98, torso=1.0, arm=1.0, shoulders=21.5, hips=11.0, head=1.0,
             chest=(20.0, 14.0), waist=(18.5, 14.0), hip=(18.0, 13.5), belly=0.35, arm_r=(6.4, 5.6, 4.8), leg_r=(9.0, 6.8, 5.4),
             neck_r=6.8, skull=(18.5, 18.0, 19.0), jaw=(15.0, 16.0, 13.0), hair=grey)
    C, hs = c.head_c, c.hs
    c.torso(WHITE, sleeves="short", rough=0.8, paint=paint_stripes_y(col("#f1eee6"), col("#1a1a1e"), 5.6))
    c.arms(skin, upper=False)
    c.hands(skin)
    c.neck(skin)
    c.bottom(col("#1a1a1e"), kind="pants")
    c.boots(col("#111114"), shaft=0.0, rough=0.35, sole=col("#2c2c30"))
    belt(c, col("#111114"), buckle=SILVER, drop=7.0, r=1.8)
    bow = c.P("bowtie", col("#111114"), voxel=0.9, smooth=3, rough=0.6, rigid="chest")
    bz = c.neck_z - 4.0
    bx = c.torso_x(0, bz) + 1.0
    bow.ball((bx, 0, bz), 2.2)
    for s in (1, -1):
        bow.cyl((bx, s * 1.0, bz), (bx, s * 7.0, bz), 1.2, 3.6, seg=12)
    whistle = c.P("whistle", SILVER, raw=True, rough=0.2, rigid="chest")
    wz = c.chest_z + 6.0
    wx = c.torso_x(0, wz) + 1.6
    whistle.capsule((wx, -2.0, wz), (wx, 2.5, wz), 1.8, seg=10)
    whistle.ball((wx, -2.8, wz + 0.4), 2.4, seg=10)
    cord = c.P("whistle_cord", col("#c62828"), raw=True, rough=0.7, bones=["chest", "neck"])
    cord.tube(loop_around((1.5, 0, 0), c.neck_r + 5.5, c.neck_r + 6.5, lambda a: c.neck_z - 2.0 - (c.neck_z - 2.0 - wz) * max(0.0, math.cos(a)) ** 3, n=24),
              [0.6] * 24, seg=6, closed=True)

    c.head(nose=("ball", 5.2), chin=0.7)
    c.eyes(iris=col("#5b6b7a"), brow=grey, brow_r=2.0, lid_drop=3.2)
    c.mouths()
    fringe = c.P("hair", grey, voxel=1.2, smooth=3, rigid="head", rough=0.85)           # bald on top, fringe round the sides
    ring = c.skull_ring(2.0, grow=0.2)
    side = [ring[i % len(ring)] for i in range(5, 28)]
    for i in range(len(side) - 1):
        fringe.capsule(side[i], side[i + 1], 4.4 * hs)
    stache = c.P("moustache", grey, voxel=0.9, smooth=3, rigid="head", rough=0.85)
    for s in (1, -1):
        stache.capsule(c.face_pt(s * 1.0, -6.6, 0.8), c.face_pt(s * 9.5, -8.6, 0.6), 2.8 * hs, 1.5 * hs)
    return c


def dirk():
    skin = col("#e0a988")
    mustard = col("#c9952b")
    c = Char("Dirk", skin, leg=0.98, torso=1.04, arm=1.0, shoulders=25.0, hips=12.5, head=1.06,
             chest=(24.0, 16.5), waist=(21.0, 15.5), hip=(20.5, 15.0), belly=0.45, arm_r=(7.8, 6.8, 5.6), leg_r=(10.5, 7.8, 6.0),
             neck_r=8.6, hand=1.05, skull=(19.0, 18.5, 19.0), jaw=(17.0, 18.0, 14.0), jaw_drop=9.0, hair=col("#15110f"),
             mouth_scale=1.1)
    C, hs = c.head_c, c.hs

    def plaid(co, nrm):
        line = ((np.mod(co[:, 1], 7.0) < 0.9) | (np.mod(co[:, 2], 7.0) < 0.9))[:, None]
        return np.where(line, np.array(col("#7a4a12"), dtype=np.float32), np.array(mustard, dtype=np.float32))

    c.torso(mustard, sleeves="long", rough=0.85, sleeve_r=2.2, paint=plaid)
    shirt = c.P("shirt_front", WHITE, voxel=1.2, smooth=3, rough=0.8, bones=["spine", "chest"])
    for k in range(6):
        z = c.chest_z - 2.0 + k * 4.6
        w = 2.0 + k * 1.15
        shirt.ball((c.torso_x(0, z) - 2.2, 0, z), 3.4, scale=(1.0, w / 3.4 + 0.4, 1.0))
    tie = c.P("tie", col("#c62828"), voxel=1.0, smooth=3, rough=0.6, bones=["spine", "chest"])
    tz = c.neck_z - 5.0
    tie.ball((c.torso_x(0, tz) + 0.4, 0, tz), 2.6)
    tie.capsule((c.torso_x(0, tz) + 0.4, 0, tz), (c.torso_x(0, c.chest_z + 1) + 0.6, 0, c.chest_z + 1.0), 2.0, 3.2)
    c.hands(skin)
    c.neck(skin)
    c.bottom(col("#5d4027"), kind="pants")
    c.boots(col("#16130f"), shaft=0.0, rough=0.35, sole=col("#2c2c30"))
    c.head(nose=("ball", 5.0), chin=1.1, cheeks=0.6)
    c.eyes(iris=col("#3f6f8f"), brow_r=2.1)
    c.mouths()
    hair = hair_cap(c, c.hair_col, grow=1.2, shift=(-2.8, 0, 3.0), rough=0.4)
    pomp = c.P("pompadour", c.hair_col, voxel=1.2, smooth=3, rigid="hair", rough=0.4)     # big glossy quiff, wobbles
    pomp.ball(c.face_pt(0, 15.5, -3.0) + Vector((0, 0, 3.0)), 1.0, scale=(11.0 * hs, 13.0 * hs, 8.5 * hs))
    pomp.ball(c.face_pt(0, 17.0, 3.0) + Vector((0, 0, 7.0)), 1.0, scale=(8.0 * hs, 10.0 * hs, 6.5 * hs))
    stache = c.P("moustache", c.hair_col, voxel=0.9, smooth=3, rigid="head", rough=0.7)
    for s in (1, -1):
        stache.capsule(c.face_pt(s * 0.8, -6.8, 0.8), c.face_pt(s * 8.5, -8.0, 0.6), 2.4 * hs, 1.3 * hs)
    headset(c)
    return c


def nigel():
    skin = col("#edd3c2")
    tweed = col("#7d7868")
    c = Char("Nigel", skin, leg=1.04, torso=1.0, arm=1.02, shoulders=19.0, hips=10.0, head=1.0,
             chest=(17.0, 12.0), waist=(14.5, 11.0), hip=(15.0, 11.5), arm_r=(5.2, 4.6, 4.0), leg_r=(7.4, 5.8, 4.6),
             neck_r=5.2, hand=0.92, skull=(17.5, 16.5, 20.0), jaw=(12.5, 13.0, 14.5), jaw_drop=11.5, hair=col("#b9b1a3"),
             mouth_scale=0.8, mouth_z=-14.0)
    C, hs = c.head_c, c.hs
    fleck = paint_speckle(tweed, col("#55503f"), amount=0.22, scale=1.1)
    c.torso(tweed, sleeves="long", rough=0.92, sleeve_r=1.8, paint=fleck)
    patches = c.P("elbow_patches", col("#6b4a2e"), voxel=1.0, smooth=3, rough=0.7, bones=["upperarm_l", "upperarm_r", "forearm_l", "forearm_r"])
    for s in (1, -1):
        patches.ball(c.elbow(s) + Vector((-3.6, s * 1.0, 0)), 4.2, scale=(0.7, 1.0, 1.25))
    shirt = c.P("shirt_front", WHITE, voxel=1.2, smooth=3, rough=0.8, bones=["spine", "chest"])
    for k in range(5):
        z = c.chest_z + 0.0 + k * 4.6
        shirt.ball((c.torso_x(0, z) - 2.0, 0, z), 3.0, scale=(1.0, 0.75 + k * 0.3, 1.0))
    bow = c.P("bowtie", col("#7b1e3a"), voxel=0.9, smooth=3, rough=0.6, rigid="chest")
    bz = c.neck_z - 4.5
    bx = c.torso_x(0, bz) + 0.8
    bow.ball((bx, 0, bz), 2.0)
    for s in (1, -1):
        bow.cyl((bx, s * 1.0, bz), (bx, s * 6.5, bz), 1.1, 3.3, seg=12)
    c.hands(skin)
    c.neck(skin)
    c.bottom(tweed, kind="pants", rough=0.92, paint=fleck)
    c.boots(col("#4a2f1c"), shaft=0.0, rough=0.4, sole=col("#2c2c30"))
    c.head(nose=("long", 3.6), chin=0.5)
    c.eyes(iris=col("#6d7f8c"), brow_r=1.1, lid_drop=3.0)
    c.mouths()
    glasses(c, GOLD, round_=True, r=0.6, size=1.05)
    side = c.P("hair", c.hair_col, voxel=1.1, smooth=3, rigid="head", rough=0.85)
    ring = c.skull_ring(3.0, grow=0.2)
    for i in range(6, 27):
        side.capsule(ring[i], ring[i + 1], 3.6 * hs)
    comb = c.P("combover", c.hair_col, raw=True, rough=0.8, rigid="hair")                # three brave strands
    top = c.skull_c.z + c.skull_r.z
    for k, x in enumerate((-5.0, 0.0, 5.0)):
        pts = [(c.skull_c.x + x * hs, (c.skull_r.y - 1.0) * math.cos(math.pi * i / 8) * 0.96,
                c.skull_c.z + (c.skull_r.z + 0.8) * math.sin(math.pi * (0.12 + 0.76 * i / 8))) for i in range(9)]
        comb.tube(pts, 0.75, seg=6)
    headset(c)
    return c


ROSTER = {"Rex": rex, "Lola": lola, "Bruno": bruno, "Chip": chip, "Wubz": wubz, "Duchess": duchess, "Vince": vince,
          "Mystica": mystica, "Ref": ref, "Dirk": dirk, "Nigel": nigel}
FIGHTERS = ["Rex", "Lola", "Bruno", "Chip", "Wubz", "Duchess", "Vince", "Mystica"]


# =====================================================================================================

def render_character(name, c, arm_ob, ob):
    """Full-body and face previews with a couple of expressions."""
    common.setup_preview(res=(1100, 1300), bg=(0.16, 0.17, 0.2))
    h = c.height
    set_expression(arm_ob, mouth="grit", fists=True)
    common.render(f"char_{name}_front.png", (330, -190, h * 0.72), (0, 0, h * 0.52), lens=50)
    set_expression(arm_ob, mouth="open", fists=False)
    common.render(f"char_{name}_back.png", (-330, 200, h * 0.75), (0, 0, h * 0.52), lens=50)
    for m in ("closed", "grit", "open", "ouch", "grin"):
        set_expression(arm_ob, mouth=m, fists=True)
        common.render(f"char_{name}_face_{m}.png", (125, -42, c.head_c.z + 4), (0, 0, c.head_c.z - 2), lens=70)
    set_expression(arm_ob, mouth="grit", fists=True)
    fight_pose(arm_ob)
    common.render(f"char_{name}_pose.png", (300, -230, h * 0.7), (0, 0, h * 0.5), lens=50)
    clear_pose(arm_ob)


def render_portrait(name, c, arm_ob):
    """Head-and-shoulders portrait with a transparent background for the character-select screen."""
    scene = bpy.context.scene
    common.setup_preview(res=(512, 512), bg=(0.2, 0.2, 0.22))
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = 'RGBA'
    set_expression(arm_ob, mouth="closed", fists=True)
    saved = common.PREVIEW_DIR
    common.PREVIEW_DIR = os.path.join(EXPORT_DIR, "Portraits")
    top = c.height + (26 if name in ("Bruno", "Duchess") else (8 if name in ("Mystica", "Lola") else 0))
    mid = (top + c.shoulder_z - 14) * 0.5
    span = top - (c.shoulder_z - 14)
    dist = span * 2.95
    common.render(f"P_{name}.png", (dist * 0.93, -dist * 0.36, mid + 6), (0, 0, mid), lens=85)
    common.PREVIEW_DIR = saved
    scene.render.film_transparent = False


def lineup():
    """Everyone in one scene, for a look at the whole cast."""
    common.reset_scene()
    names = list(ROSTER.keys())
    for i, name in enumerate(names):
        c = ROSTER[name]()
        arm_ob, ob = c.build()
        arm_ob.location = (0, (i - (len(names) - 1) / 2) * 78, 0)
        set_expression(arm_ob, mouth=("grit", "grin", "open", "closed")[i % 4], fists=(i % 2 == 0))
    common.setup_preview(res=(2600, 760), bg=(0.16, 0.17, 0.2))
    common.render("lineup.png", (1900, 0, 115), (0, 0, 95), lens=85)


def build_all(names=None, preview=False):
    wanted = [n.lower() for n in names] if names else None
    if wanted == ["lineup"]:
        lineup()
        return
    for name, fn in ROSTER.items():
        if wanted and name.lower() not in wanted:
            continue
        common.reset_scene()
        c = fn()
        arm_ob, ob = c.build()
        export_fbx([arm_ob, ob], f"SK_{name}.fbx")
        render_portrait(name, c, arm_ob)
        if preview:
            render_character(name, c, arm_ob, ob)
    if preview and not wanted:
        lineup()
