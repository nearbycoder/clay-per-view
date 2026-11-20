"""The ring and the arena, modelled as chunky clay set pieces.

Blender axes used here: +X = screen right from the main broadcast camera, -X = entrance stage,
+Y = far side (crowd backdrop, announce desk), -Y = broadcast camera side, mat surface at Z = 0.
Unreal sees Y negated; `ue()` converts positions and `ue_yaw()` facing angles for the layout file.
"""
import math

import bmesh
from mathutils import Matrix, Vector

from .common import (FONT_IMPACT, FONT_TITLE, Piece, build_static, col, export_fbx, log, rot, shade, text_mesh,
                     tri_count, write_json)

MAT_HALF = 300.0       # half size of the ring platform
POST = 272.0           # ring post centres
ROPE_HALF = 262.0      # rope square half size
ROPE_Z = (50.0, 90.0, 130.0)
FLOOR_Z = -110.0
BARRICADE = 570.0

# Lower bowl / upper deck / floor seating parameters.
LOW = dict(rows=16, d0=1090.0, r0=380.0, depth=78.0, rise=38.0, z0=-48.0, pitch=58.0)
UP = dict(rows=12, d0=LOW["d0"] + LOW["rows"] * LOW["depth"] + 170.0, r0=380.0 + LOW["rows"] * LOW["depth"] + 170.0,
          depth=76.0, rise=50.0, z0=-48.0 + LOW["rows"] * LOW["rise"] + 230.0, pitch=62.0)
FLOOR_ROWS = (665.0, 740.0, 815.0, 890.0, 965.0)
SHELL = UP["d0"] + UP["rows"] * UP["depth"] + 140.0
CEILING_Z = 1780.0

NAVY = col("#161c33")
RED = col("#c9302c")
BLUE = col("#2456c4")
YELLOW = col("#f2c230")
CREAM = col("#e8e2d2")
STEEL = col("#3b414d")
BLACK = col("#15161a")
WHITE = col("#f1efe8")


def ue(p):
    return [round(p[0], 1), round(-p[1], 1), round(p[2], 1)]


def ue_yaw(dx, dy):
    """Unreal yaw (degrees) for something facing Blender direction (dx, dy)."""
    return round(math.degrees(math.atan2(-dy, dx)), 1)


# ---- small geometry helpers ------------------------------------------------------------------------

def prism(piece, pts2d, z0, z1, m=None):
    piece.prism(pts2d, z0, z1, m=m)


def stadium(w, h, seg=10):
    """CCW outline of a pill shape, w wide and h tall."""
    r = h * 0.5
    pts = []
    for i in range(seg + 1):
        a = -math.pi / 2 + math.pi * i / seg
        pts.append((w * 0.5 - r + r * math.cos(a), r * math.sin(a)))
    for i in range(seg + 1):
        a = math.pi / 2 + math.pi * i / seg
        pts.append((-w * 0.5 + r + r * math.cos(a), r * math.sin(a)))
    return pts


def star(r_out, r_in, points=5, phase=90.0):
    pts = []
    for i in range(points * 2):
        r = r_out if i % 2 == 0 else r_in
        a = math.radians(phase) + math.pi * i / points
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def fit_text(piece, body, width, depth, place, font=FONT_TITLE, bevel=0.0, spacing=1.0):
    """Add text scaled so its run is `width` cm wide. `place` positions the XY-plane text."""
    me = text_mesh(body, font=font, size=10.0, depth=1.0, bevel=bevel, spacing=spacing)
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    w = max(xs) - min(xs)
    s = width / w
    centre = Matrix.Translation((-(max(xs) + min(xs)) * 0.5, -(max(ys) + min(ys)) * 0.5, 0.0))
    piece.mesh(me, m=place @ Matrix.Diagonal((s, s, depth, 1.0)) @ centre)
    return (max(ys) - min(ys)) * s


# Orientation of XY-plane text for the four vertical faces and the floor.
FACE_NEG_Y = rot(90, 0, 0)                 # readable from the camera side
FACE_POS_Y = rot(0, 0, 180) @ rot(90, 0, 0)
FACE_NEG_X = rot(0, 0, -90) @ rot(90, 0, 0)
FACE_POS_X = rot(0, 0, 90) @ rot(90, 0, 0)


# ---- the ring ----------------------------------------------------------------------------------------

def build_ring():
    P = []
    canvas = Piece("canvas", CREAM, rough=0.93, raw=True)
    canvas.box((0, 0, -11), (2 * MAT_HALF, 2 * MAT_HALF, 22), bevel=4, bseg=3)
    P.append(canvas)

    trim = Piece("trim", RED, rough=0.8, raw=True)
    trim.box((0, 0, -27), (2 * MAT_HALF + 5, 2 * MAT_HALF + 5, 9), bevel=2)
    P.append(trim)

    # Mat logo: stacked clay cut-outs, a few millimetres thick each.
    disc_red = Piece("logo_red", RED, rough=0.85, raw=True)
    disc_red.lathe([(0, 0.0), (196, 0.0), (196, 0.7), (0, 0.7)], seg=72)
    star_pts = star(34, 14)
    for sx in (-1, 1):
        prism(disc_red, star_pts, 0.9, 1.6, m=Matrix.Translation((sx * 118, 96, 0)))
    prism(disc_red, star(46, 19), 0.9, 1.7, m=Matrix.Translation((0, 112, 0)))
    P.append(disc_red)
    disc_cream = Piece("logo_cream", shade(CREAM, 1.03), rough=0.9, raw=True)
    disc_cream.lathe([(0, 0.0), (174, 0.0), (174, 0.9), (0, 0.9)], seg=72)
    P.append(disc_cream)
    ribbon = Piece("logo_ribbon", YELLOW, rough=0.8, raw=True)
    prism(ribbon, stadium(520, 96), 0.0, 1.5)
    P.append(ribbon)
    word = Piece("logo_word", NAVY, rough=0.8, raw=True)
    fit_text(word, "CLAY-PER-VIEW", 440, 1.4, Matrix.Translation((0, 0, 1.5 + 0.7)), bevel=0.02)
    fit_text(word, "FAMOUS LAST BLOWS", 250, 1.0, Matrix.Translation((0, -96, 0.9 + 0.5)), font=FONT_IMPACT, spacing=1.15)
    P.append(word)

    # Apron skirts with clay lettering.
    skirt = Piece("skirt", NAVY, rough=0.85, raw=True)
    for sy in (-1, 1):
        skirt.box((0, sy * (MAT_HALF - 4), -68), (2 * MAT_HALF - 6, 6, 84), bevel=1.5)
        skirt.box((sy * (MAT_HALF - 4), 0, -68), (6, 2 * MAT_HALF - 6, 84), bevel=1.5)
    P.append(skirt)
    lettering = Piece("skirt_text", YELLOW, rough=0.8, raw=True)
    fit_text(lettering, "CLAY-PER-VIEW", 330, 3.0, Matrix.Translation((0, -(MAT_HALF - 0.5), -68)) @ FACE_NEG_Y, bevel=0.03)
    fit_text(lettering, "CLAY-PER-VIEW", 330, 3.0, Matrix.Translation((0, MAT_HALF - 0.5, -68)) @ FACE_POS_Y, bevel=0.03)
    P.append(lettering)
    lettering2 = Piece("skirt_text2", WHITE, rough=0.8, raw=True)
    fit_text(lettering2, "FAMOUS LAST BLOWS", 340, 3.0, Matrix.Translation((-(MAT_HALF - 0.5), 0, -68)) @ FACE_NEG_X, font=FONT_IMPACT, spacing=1.1)
    fit_text(lettering2, "FAMOUS LAST BLOWS", 340, 3.0, Matrix.Translation((MAT_HALF - 0.5, 0, -68)) @ FACE_POS_X, font=FONT_IMPACT, spacing=1.1)
    for sx in (-1, 1):
        for face, pos in ((FACE_NEG_Y, (sx * 230, -(MAT_HALF - 0.5), -68)), (FACE_POS_Y, (sx * 230, MAT_HALF - 0.5, -68))):
            prism(lettering2, star(22, 9), -1.5, 1.5, m=Matrix.Translation(pos) @ face)
    P.append(lettering2)

    # Posts, turnbuckle pads and their hooks.
    posts = Piece("posts", STEEL, rough=0.45, raw=True)
    hooks = Piece("hooks", shade(STEEL, 1.5), rough=0.35, raw=True)
    pads_red = Piece("pads_red", RED, rough=0.7, voxel=2.0, smooth=3, lumps=0.35)
    pads_blue = Piece("pads_blue", BLUE, rough=0.7, voxel=2.0, smooth=3, lumps=0.35)
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = sx * POST, sy * POST
            posts.cyl((px, py, FLOOR_Z), (px, py, 148), 8.5, seg=20)
            posts.ball((px, py, 149), 10.5, seg=20)
            posts.cyl((px, py, FLOOR_Z), (px, py, FLOOR_Z + 6), 15, seg=20)
            d = Vector((-sx, -sy, 0)).normalized()
            t = Vector((sy, -sx, 0)).normalized()
            pads = pads_red if sx < 0 else pads_blue
            for z in ROPE_Z:
                c = Vector((sx * ROPE_HALF, sy * ROPE_HALF, z)) + d * 3
                pads.capsule(c - t * 17, c + t * 17, 9.5)
                hooks.cyl((px, py, z), c, 2.6, seg=8)
    P += [posts, hooks, pads_red, pads_blue]

    # Ring steps at the two camera-side corners.
    steps = Piece("steps", shade(STEEL, 1.25), rough=0.5, raw=True)
    treads = Piece("treads", BLACK, rough=0.9, raw=True)
    for sx in (-1, 1):
        steps.box((sx * 225, -340, -61), (120, 72, 98), bevel=3)
        steps.box((sx * 225, -396, -86), (120, 42, 48), bevel=3)
        treads.box((sx * 225, -340, -11), (112, 64, 3), bevel=1)
        treads.box((sx * 225, -396, -61), (112, 34, 3), bevel=1)
    P += [steps, treads]

    # Padded floor around the ring.
    pad = Piece("floor_pad", col("#20242e"), rough=0.92, raw=True)
    span = BARRICADE - 12
    w = span - MAT_HALF
    for s in (-1, 1):
        pad.box((0, s * (MAT_HALF + w / 2), FLOOR_Z + 2), (2 * span, w, 4), bevel=1)
        pad.box((s * (MAT_HALF + w / 2), 0, FLOOR_Z + 2), (w, 2 * MAT_HALF, 4), bevel=1)
    P.append(pad)

    ob = build_static("SM_Ring", P)
    log("SM_Ring tris", tri_count(ob))
    return ob


# ---- ringside: barricade, announce position, timekeeper ---------------------------------------------

def build_ringside():
    P = []
    wall = Piece("barricade", BLACK, rough=0.8, raw=True)
    rail = Piece("barricade_rail", shade(STEEL, 1.4), rough=0.4, raw=True)
    B = BARRICADE
    runs = [((0, -B), (2 * B + 16, 16)), ((0, B), (2 * B + 16, 16)), ((B, 0), (16, 2 * B - 16)),
            ((-B, -(B + 150) / 2), (16, B - 150)), ((-B, (B + 150) / 2), (16, B - 150))]
    for (cx, cy), (sx, sy) in runs:
        wall.box((cx, cy, FLOOR_Z + 51), (sx, sy, 102), bevel=3)
        rail.box((cx, cy, FLOOR_Z + 104), (sx + 4, sy + 4, 5), bevel=1.5)
    P += [wall, rail]
    words = Piece("barricade_text", WHITE, rough=0.8, raw=True)
    for x in (-330, 0, 330):
        fit_text(words, "CLAY-PER-VIEW", 250, 2.0, Matrix.Translation((x, B - 8.5, FLOOR_Z + 55)) @ FACE_NEG_Y, bevel=0.02)
    for y in (-300, 300):
        fit_text(words, "LIVE", 110, 2.0, Matrix.Translation((B - 8.5, y, FLOOR_Z + 55)) @ FACE_NEG_X, font=FONT_IMPACT)
    P.append(words)
    stars = Piece("barricade_stars", YELLOW, rough=0.8, raw=True)
    for x in (-165, 165):
        prism(stars, star(20, 8), -1, 1, m=Matrix.Translation((x, B - 8.5, FLOOR_Z + 55)) @ FACE_NEG_Y)
    P.append(stars)

    # Announce position: riser, desk, monitors, microphones, two chairs.
    riser = Piece("riser", col("#1b1e26"), rough=0.85, raw=True)
    riser.box((190, 478, FLOOR_Z + 30), (340, 150, 60), bevel=3)
    P.append(riser)
    carpet = Piece("carpet", col("#7a1f24"), rough=0.95, raw=True)
    carpet.box((190, 478, FLOOR_Z + 61), (332, 142, 2), bevel=0.8)
    P.append(carpet)
    desk = Piece("desk", col("#6b4a2e"), rough=0.6, raw=True)
    desk.box((190, 446, 26), (280, 64, 8), bevel=2)
    P.append(desk)
    panel = Piece("desk_panel", NAVY, rough=0.8, raw=True)
    panel.box((190, 417, -12), (276, 6, 70), bevel=1.5)
    for sx in (-1, 1):
        panel.box((190 + sx * 136, 446, -12), (6, 60, 70), bevel=1.5)
    P.append(panel)
    desk_text = Piece("desk_text", YELLOW, rough=0.8, raw=True)
    fit_text(desk_text, "CLAY-PER-VIEW", 200, 2.0, Matrix.Translation((190, 413.5, -4)) @ FACE_NEG_Y, bevel=0.02)
    P.append(desk_text)
    live = Piece("desk_live", col("#ff3b30"), rough=0.5, raw=True, slot="Glow")
    fit_text(live, "LIVE", 60, 2.0, Matrix.Translation((190, 413.5, -32)) @ FACE_NEG_Y, font=FONT_IMPACT)
    P.append(live)
    kit = Piece("desk_kit", BLACK, rough=0.5, raw=True)
    for x in (130, 250):
        kit.box((x, 430, 44), (44, 5, 28), r3=rot(-15, 0, 0), bevel=1)        # monitor
        kit.box((x, 432, 31), (16, 10, 3), bevel=0.8)
        kit.cyl((x + 34, 452, 30), (x + 34, 447, 48), 1.2, seg=8)             # mic stand
        kit.ball((x + 34, 446, 50), 3.4, seg=10)
    P.append(kit)
    chairs = Piece("desk_chairs", col("#2a2d36"), rough=0.7, raw=True)
    for x in (130, 250):
        chairs.box((x, 512, -5), (50, 46, 8), bevel=2.5)
        chairs.box((x, 536, 28), (50, 8, 66), bevel=2.5)
        chairs.cyl((x, 512, FLOOR_Z + 62), (x, 512, -8), 4, seg=10)
    P.append(chairs)

    # Timekeeper's table with the bell.
    table = Piece("tk_table", col("#4a3a2a"), rough=0.7, raw=True)
    table.box((-200, 452, -38), (130, 62, 6), bevel=1.5)
    for sx in (-1, 1):
        for sy in (-1, 1):
            table.cyl((-200 + sx * 56, 452 + sy * 24, FLOOR_Z), (-200 + sx * 56, 452 + sy * 24, -40), 3, seg=8)
    table.box((-200, 440, -32), (34, 34, 5), bevel=1)
    P.append(table)
    bell = Piece("bell", col("#d4a82a"), rough=0.25, raw=True)
    bell.lathe([(0, 0), (15, 0), (15.5, 2), (13, 7), (8, 11), (0, 12.5)], c=(-200, 440, -29.5), seg=24)
    bell.ball((-200, 440, -16.5), 2.2, seg=10)
    P.append(bell)
    hammer = Piece("hammer", col("#8a8f99"), rough=0.4, raw=True)
    hammer.cyl((-176, 452, -33), (-150, 452, -33), 1.3, seg=8)
    hammer.cyl((-150, 447, -33), (-150, 457, -33), 2.6, seg=10)
    P.append(hammer)

    ob = build_static("SM_Ringside", P)
    log("SM_Ringside tris", tri_count(ob))
    return ob


# ---- seating bowl ------------------------------------------------------------------------------------

def rr_columns(d, r, n_side=24, n_corner=12):
    """Polyline around a rounded square (half extent d, corner radius r), CCW from the middle of
    the +X side. Returns [(x, y, nx, ny)] with outward normals; the last point repeats the first."""
    r = min(r, d - 1.0)
    e = d - r
    out = []

    def line(x0, y0, x1, y1, nx, ny, n, last=False):
        for i in range(n + (1 if last else 0)):
            t = i / n
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, nx, ny))

    def arc(cx, cy, a0, n):
        for i in range(n):
            a = math.radians(a0 + 90.0 * i / n)
            out.append((cx + r * math.cos(a), cy + r * math.sin(a), math.cos(a), math.sin(a)))

    h = n_side // 2
    line(d, 0, d, e, 1, 0, h)
    arc(e, e, 0, n_corner)
    line(e, d, -e, d, 0, 1, n_side)
    arc(-e, e, 90, n_corner)
    line(-d, e, -d, -e, -1, 0, n_side)
    arc(-e, -e, 180, n_corner)
    line(-e, -d, e, -d, 0, -1, n_side)
    arc(e, -e, 270, n_corner)
    line(d, -e, d, 0, 1, 0, h, last=True)
    return out


def rr_eval(d, r, s):
    """Point and outward normal at arc length s along the rounded square (same start/direction)."""
    r = min(r, d - 1.0)
    e = d - r
    q = 0.5 * math.pi * r
    segs = [("l", (d, 0), (0, 1), (1, 0), e), ("a", (e, e), 0.0, None, q), ("l", (e, d), (-1, 0), (0, 1), 2 * e),
            ("a", (-e, e), 90.0, None, q), ("l", (-d, e), (0, -1), (-1, 0), 2 * e), ("a", (-e, -e), 180.0, None, q),
            ("l", (-e, -d), (1, 0), (0, -1), 2 * e), ("a", (e, -e), 270.0, None, q), ("l", (d, -e), (0, 1), (1, 0), e)]
    for kind, p, a, nrm, length in segs:
        if s <= length or (kind, p) == ("l", (d, -e)):
            if kind == "l":
                return (p[0] + a[0] * s, p[1] + a[1] * s, nrm[0], nrm[1])
            ang = math.radians(a) + s / r
            return (p[0] + r * math.cos(ang), p[1] + r * math.sin(ang), math.cos(ang), math.sin(ang))
        s -= length
    return (d, 0, 1, 0)


def rr_length(d, r):
    r = min(r, d - 1.0)
    return 8 * (d - r) + 2 * math.pi * r


def stage_gap(x, y):
    return x < -900 and abs(y) < 500


def build_bowl(prefix, cfg, wall_colour, seat_colour, skip=None, fascia_glow=None, front_wall_to=None):
    """Stepped seating following the rounded square, split into 4 chunks. Returns objects."""
    rows, d0, r0, depth, rise, z0 = cfg["rows"], cfg["d0"], cfg["r0"], cfg["depth"], cfg["rise"], cfg["z0"]
    concrete = col("#2c2f38")
    cols = [rr_columns(d0 + k * depth, r0 + k * depth) for k in range(rows + 1)]
    ncol = len(cols[0]) - 1
    objs = []
    for chunk in range(4):
        step = Piece(f"{prefix}{chunk}_steps", concrete, rough=0.85, raw=True, sharp=30)
        seats = Piece(f"{prefix}{chunk}_seats", seat_colour, rough=0.75, raw=True, sharp=30)
        wall = Piece(f"{prefix}{chunk}_wall", wall_colour, rough=0.8, raw=True, sharp=30)
        glow = Piece(f"{prefix}{chunk}_glow", fascia_glow or (1, 1, 1), rough=0.5, raw=True, slot="Glow") if fascia_glow else None
        j0, j1 = chunk * ncol // 4, (chunk + 1) * ncol // 4
        for j in range(j0, j1):
            mx = (cols[0][j][0] + cols[0][j + 1][0]) * 0.5
            my = (cols[0][j][1] + cols[0][j + 1][1]) * 0.5
            if skip and skip(mx, my):
                continue
            V = step.bm.verts.new
            # Front wall below the first row.
            base = front_wall_to if front_wall_to is not None else FLOOR_Z
            a, b = cols[0][j], cols[0][j + 1]
            wv = wall.bm.verts.new
            wall.bm.faces.new((wv((a[0], a[1], base)), wv((a[0], a[1], z0)), wv((b[0], b[1], z0)), wv((b[0], b[1], base))))
            if glow is not None:
                gv = glow.bm.verts.new
                gz0, gz1 = base + (z0 - base) * 0.42, base + (z0 - base) * 0.62
                o = 1.5
                glow.bm.faces.new((gv((a[0] - a[2] * o, a[1] - a[3] * o, gz0)), gv((a[0] - a[2] * o, a[1] - a[3] * o, gz1)),
                                   gv((b[0] - b[2] * o, b[1] - b[3] * o, gz1)), gv((b[0] - b[2] * o, b[1] - b[3] * o, gz0))))
            for k in range(rows):
                zk = z0 + k * rise
                a0, b0 = cols[k][j], cols[k][j + 1]
                a1, b1 = cols[k + 1][j], cols[k + 1][j + 1]
                # tread
                step.bm.faces.new((V((a0[0], a0[1], zk)), V((a1[0], a1[1], zk)), V((b1[0], b1[1], zk)), V((b0[0], b0[1], zk))))
                # riser up to the next row
                if k < rows - 1:
                    step.bm.faces.new((V((a1[0], a1[1], zk)), V((a1[0], a1[1], zk + rise)), V((b1[0], b1[1], zk + rise)), V((b1[0], b1[1], zk))))
                # seat-back strip near the rear of the tread
                sv = seats.bm.verts.new
                f0, f1 = 0.70, 0.80

                def at(c0, c1, f, z):
                    return sv((c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, z))

                seats.bm.faces.new((at(a0, a1, f0, zk), at(a0, a1, f0, zk + 34), at(b0, b1, f0, zk + 34), at(b0, b1, f0, zk)))
                seats.bm.faces.new((at(a0, a1, f0, zk + 34), at(a0, a1, f1, zk + 34), at(b0, b1, f1, zk + 34), at(b0, b1, f0, zk + 34)))
                seats.bm.faces.new((at(a0, a1, f1, zk + 34), at(a0, a1, f1, zk), at(b0, b1, f1, zk), at(b0, b1, f1, zk + 34)))
            # Back wall / railing behind the top row.
            zt = z0 + (rows - 1) * rise
            a, b = cols[rows][j], cols[rows][j + 1]
            wall.bm.faces.new((wv((a[0], a[1], zt)), wv((a[0], a[1], zt + 110)), wv((b[0], b[1], zt + 110)), wv((b[0], b[1], zt))))
        for p in (step, seats, wall, glow):
            if p is not None:
                bmesh.ops.remove_doubles(p.bm, verts=p.bm.verts, dist=0.01)
        pieces = [p for p in (step, seats, wall, glow) if p is not None and len(p.bm.faces) > 0]
        if pieces:
            ob = build_static(f"SM_{prefix}{chunk}", pieces, uv_density=80.0)
            objs.append(ob)
    return objs


def seat_list(cfg, tier, skip):
    rows, d0, r0, depth, rise, z0, pitch = cfg["rows"], cfg["d0"], cfg["r0"], cfg["depth"], cfg["rise"], cfg["z0"], cfg["pitch"]
    out = []
    for k in range(rows):
        d = d0 + (k + 0.36) * depth
        r = r0 + (k + 0.36) * depth
        length = rr_length(d, r)
        n = int(length / pitch)
        e = d - min(r, d - 1.0)
        # Aisles at the quarter points of every straight side.
        q = 0.5 * math.pi * min(r, d - 1.0)
        side_starts = [e + q, e + q + 2 * e + q, e + q + 2 * (2 * e + q)]
        aisles = [e * 0.5, length - e * 0.5]
        for s0 in side_starts:
            aisles += [s0 + 2 * e * 0.25, s0 + 2 * e * 0.75]
        aisles += [e + q * 0.5 + i * (2 * e + q) for i in range(4)]
        for i in range(n):
            s = (i + 0.5 + (0.5 if k % 2 else 0.0)) * length / n
            if any(abs(s - a) < 48 for a in aisles):
                continue
            x, y, nx, ny = rr_eval(d, r, s % length)
            if skip(x, y, k):
                continue
            out.append([round(x), round(-y), round(z0 + k * rise), ue_yaw(-nx, -ny), tier])
    return out


def floor_seats():
    out = []
    for k, d in enumerate(FLOOR_ROWS):
        r = 70.0 + (d - FLOOR_ROWS[0])
        length = rr_length(d, r)
        n = int(length / 62.0)
        for i in range(n):
            s = (i + 0.5) * length / n
            x, y, nx, ny = rr_eval(d, r, s)
            if x < 0 and abs(y) < 205:        # entrance ramp
                continue
            if abs(abs(x) - abs(y)) < 46 and abs(x) > 400:   # diagonal aisles
                continue
            out.append([round(x), round(-y), round(FLOOR_Z), ue_yaw(-nx, -ny), 0])
    return out


# ---- overhead rig: scoreboard, lighting truss ------------------------------------------------------

def build_rig(layout):
    P = []
    body = Piece("board", col("#14161b"), rough=0.6, raw=True)
    body.box((0, 0, 935), (480, 480, 270), bevel=8)
    body.box((0, 0, 1085), (300, 300, 40), bevel=6)
    body.box((0, 0, 790), (380, 380, 26), bevel=5)
    P.append(body)
    led = Piece("board_led", col("#ffb020"), rough=0.5, raw=True, slot="Glow")
    led.torus((0, 0, 772), 235, 7, seg=48, rseg=8)
    P.append(led)
    cables = Piece("cables", col("#0d0e12"), rough=0.6, raw=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cables.cyl((sx * 120, sy * 120, 1100), (sx * 120, sy * 120, CEILING_Z), 3.5, seg=8)
    screens = []
    for (nx, ny) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        screens.append({"name": "board", "center": ue((nx * 243, ny * 243, 935)), "normal": ue((nx, ny, 0)), "width": 428, "height": 240})
    layout["screens"] += screens

    truss = Piece("truss", col("#2a2d35"), rough=0.5, raw=True)
    rungs = Piece("truss_rungs", col("#4a4e59"), rough=0.4, raw=True)
    cans = Piece("cans", col("#1a1c22"), rough=0.5, raw=True)
    lens = Piece("can_glow", col("#fff3d6"), rough=0.4, raw=True, slot="Glow")
    T, Z = 560.0, 770.0
    lights = []
    for axis in (0, 1):
        for s in (-1, 1):
            for dz in (-13, 13):
                for off in (-13, 13):
                    if axis == 0:
                        truss.cyl((-T - 15, s * T + off, Z + dz), (T + 15, s * T + off, Z + dz), 3.2, seg=8)
                    else:
                        truss.cyl((s * T + off, -T - 15, Z + dz), (s * T + off, T + 15, Z + dz), 3.2, seg=8)
            for i in range(-9, 10):
                c = (i * 60, s * T, Z) if axis == 0 else (s * T, i * 60, Z)
                rungs.box(c, (4, 30, 30) if axis == 0 else (30, 4, 30))
            for i, u in enumerate((-390, -130, 130, 390)):
                pos = Vector((u, s * T, Z - 42)) if axis == 0 else Vector((s * T, u, Z - 42))
                target = Vector((u * 0.42, s * 95, 0)) if axis == 0 else Vector((s * 95, u * 0.42, 0))
                d = (target - pos).normalized()
                cans.cyl(pos - d * 20, pos + d * 20, 15, 18, seg=14)
                cans.cyl(pos - d * 20 + Vector((0, 0, 22)), pos - d * 10, 3, seg=8)
                lens.cyl(pos + d * 20, pos + d * 21.5, 16, seg=14)
                lights.append({"pos": ue(pos + d * 24), "dir": ue(d), "kind": "key"})
    for sx in (-1, 1):
        for sy in (-1, 1):
            cables.cyl((sx * T, sy * T, Z + 13), (sx * T, sy * T, CEILING_Z), 2.5, seg=8)
    P += [cables, truss, rungs, cans, lens]
    layout["lights"] += lights

    # Line-array speakers hanging off the truss corners.
    spk = Piece("speakers", col("#101115"), rough=0.7, raw=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            for i in range(5):
                tilt = 6 * i
                c = Vector((sx * (T + 70), sy * (T + 70), Z + 80 - i * 30))
                spk.box(c + Vector((-sx * i * 3.0, -sy * i * 3.0, 0)), (70, 70, 27), r3=rot(sy * tilt * 0.7, -sx * tilt * 0.7, 45), bevel=3)
            cables.cyl((sx * (T + 70), sy * (T + 70), Z + 95), (sx * (T + 70), sy * (T + 70), CEILING_Z), 2.5, seg=8)
    P.append(spk)
    ob = build_static("SM_Rig", P, uv_density=60.0)
    log("SM_Rig tris", tri_count(ob))
    return ob


# ---- entrance stage ------------------------------------------------------------------------------------

def build_stage(layout):
    P = []
    X0, X1 = -2080.0, -1470.0          # stage back / front
    TOP = FLOOR_Z + 92.0
    deck = Piece("stage_deck", col("#17191f"), rough=0.6, raw=True)
    deck.box(((X0 + X1) / 2, 0, (FLOOR_Z + TOP) / 2), (X1 - X0, 940, TOP - FLOOR_Z), bevel=4)
    P.append(deck)
    # Ramp: a wedge from the stage lip down to ringside.
    ramp = Piece("ramp", col("#1d2028"), rough=0.7, raw=True)
    RX1, HW = -700.0, 120.0
    ramp.hull([(X1, -HW, TOP), (X1, HW, TOP), (RX1, HW, FLOOR_Z + 5), (RX1, -HW, FLOOR_Z + 5),
               (X1, -HW, FLOOR_Z), (X1, HW, FLOOR_Z), (RX1, HW, FLOOR_Z), (RX1, -HW, FLOOR_Z)])
    P.append(ramp)
    edge = Piece("ramp_glow", col("#ffcf40"), rough=0.5, raw=True, slot="Glow")
    for sy in (-1, 1):
        edge.tube([(X1, sy * (HW - 4), TOP + 1.5), (RX1, sy * (HW - 4), FLOOR_Z + 6.5)], 2.2, seg=8)
        edge.tube([(X1, sy * 466, TOP + 1.5), (X1, sy * (HW + 6), TOP + 1.5)], 2.2, seg=8)
    P.append(edge)

    # Video wall with a doorway, flanked by light towers.
    wall = Piece("stage_wall", col("#101216"), rough=0.7, raw=True)
    wall.box((X0 + 20, 0, TOP + 495), (40, 900, 430), bevel=4)          # header above the door
    for sy in (-1, 1):
        wall.box((X0 + 20, sy * 300, TOP + 140), (40, 300, 280), bevel=4)  # door jambs
        wall.box((X0 + 40, sy * 520, TOP + 350), (96, 96, 700), bevel=6)   # towers
    wall.box((X0 - 40, 0, TOP + 140), (10, 320, 290))                    # dark curtain behind the door
    P.append(wall)
    curtain = Piece("curtain", col("#3a0d12"), rough=0.95, raw=True)
    for i in range(-5, 6):
        curtain.cyl((X0 + 6, i * 26, TOP), (X0 + 6, i * 26, TOP + 280), 14, seg=10)
    P.append(curtain)
    tower_glow = Piece("tower_glow", col("#ff3b6b"), rough=0.5, raw=True, slot="Glow")
    for sy in (-1, 1):
        for k in range(-1, 2):
            tower_glow.box((X0 + 89.5, sy * 520 + k * 26, TOP + 350), (2, 9, 640))
    P.append(tower_glow)
    sign = Piece("marquee", col("#ffe9a8"), rough=0.5, raw=True, slot="Glow")
    fit_text(sign, "CLAY-PER-VIEW", 720, 26.0, Matrix.Translation((X0 + 46, 0, TOP + 770)) @ FACE_POS_X, bevel=0.03)
    P.append(sign)
    sign_back = Piece("marquee_back", col("#1a1c22"), rough=0.7, raw=True)
    sign_back.box((X0 + 26, 0, TOP + 770), (16, 800, 130), bevel=5)
    P.append(sign_back)
    layout["screens"].append({"name": "stage", "center": ue((X0 + 41.5, 0, TOP + 495)), "normal": ue((1, 0, 0)), "width": 760, "height": 400})

    # Arch truss with lamp cans over the stage.
    truss = Piece("stage_truss", col("#2a2d35"), rough=0.5, raw=True)
    cans = Piece("stage_cans", col("#1a1c22"), rough=0.5, raw=True)
    lens = Piece("stage_can_glow", col("#d9ecff"), rough=0.4, raw=True, slot="Glow")
    arch_x = X1 - 60
    for sy in (-1, 1):
        for off in (-12, 12):
            truss.cyl((arch_x + off, sy * 600, FLOOR_Z), (arch_x + off, sy * 600, TOP + 880), 3.5, seg=8)
    for off in (-12, 12):
        for dz in (-12, 12):
            truss.cyl((arch_x + off, -612, TOP + 880 + dz), (arch_x + off, 612, TOP + 880 + dz), 3.5, seg=8)
    for i in range(-4, 5):
        pos = Vector((arch_x, i * 130, TOP + 845))
        d = (Vector((-1100, i * 40, FLOOR_Z)) - pos).normalized()
        cans.cyl(pos - d * 18, pos + d * 18, 14, 17, seg=12)
        lens.cyl(pos + d * 18, pos + d * 19.5, 15, seg=12)
        layout["lights"].append({"pos": ue(pos + d * 22), "dir": ue(d), "kind": "stage"})
    P += [truss, cans, lens]

    # Speaker stacks and pyro pots on the stage front corners.
    spk = Piece("stage_speakers", col("#0f1014"), rough=0.75, raw=True)
    for sy in (-1, 1):
        for k in range(3):
            spk.box((X1 - 70, sy * 400, TOP + 32 + k * 62), (90, 110, 60), bevel=4)
    P.append(spk)
    pots = Piece("pyro_pots", col("#3b3f4a"), rough=0.4, raw=True)
    pyro = []
    for sy in (-1, 1):
        for x in (X1 - 30, X1 - 200):
            pots.cyl((x, sy * 215, TOP), (x, sy * 215, TOP + 16), 11, 13, seg=12)
            pyro.append(ue((x, sy * 215, TOP + 18)))
    P.append(pots)
    layout["pyro"] = pyro
    layout["stage"] = {"door": ue((X0 + 60, 0, TOP)), "front": ue((X1 - 40, 0, TOP)), "ramp_bottom": ue((RX1, 0, FLOOR_Z)),
                       "ringside": ue((-BARRICADE + 60, 0, FLOOR_Z)), "top_z": TOP}

    # Black drapes closing the seating gap either side of the stage.
    drape = Piece("drapes", col("#0d0e12"), rough=0.95, raw=True)
    top = LOW["z0"] + LOW["rows"] * LOW["rise"] + 110
    for sy in (-1, 1):
        drape.box(((-LOW["d0"] - (UP["d0"] - 100)) / 2, sy * 505, (FLOOR_Z + top) / 2), (UP["d0"] - 100 - LOW["d0"], 12, top - FLOOR_Z))
    drape.box((-(UP["d0"] - 106), 0, (FLOOR_Z + top) / 2), (12, 1022, top - FLOOR_Z))
    P.append(drape)

    ob = build_static("SM_Stage", P, uv_density=60.0)
    log("SM_Stage tris", tri_count(ob))
    return ob


# ---- shell: floor, walls, roof, banners --------------------------------------------------------------

def build_shell():
    P = []
    floor = Piece("floor", col("#25272e"), rough=0.88, raw=True)
    floor.box((0, 0, FLOOR_Z - 10), (2 * SHELL + 40, 2 * SHELL + 40, 20))
    P.append(floor)
    # Concourse ring between the tiers.
    low_top = LOW["z0"] + (LOW["rows"] - 1) * LOW["rise"]
    walls = Piece("walls", col("#0c0d11"), rough=0.95, raw=True)
    S = SHELL
    walls.box((0, 0, (FLOOR_Z + CEILING_Z) / 2), (2 * S, 2 * S, CEILING_Z - FLOOR_Z))
    bmesh.ops.reverse_faces(walls.bm, faces=walls.bm.faces)
    P.append(walls)
    beams = Piece("roof_beams", col("#181a20"), rough=0.8, raw=True)
    for i in range(-4, 5):
        beams.box((i * 700, 0, CEILING_Z - 45), (36, 2 * S - 20, 90))
        beams.box((0, i * 700, CEILING_Z - 70), (2 * S - 20, 24, 40))
    P.append(beams)
    exits = Piece("exit_signs", col("#3dff7a"), rough=0.5, raw=True, slot="Glow")
    for i in range(-3, 4):
        for s in (-1, 1):
            exits.box((i * 820, s * (S - 4), low_top + 420), (70, 4, 24))
            exits.box((s * (S - 4), i * 820, low_top + 420), (4, 70, 24))
    P.append(exits)

    # Championship banners hanging in the rafters on the far side and the right side.
    palette = [RED, BLUE, YELLOW, col("#2f9e5b"), col("#8a3fc4"), col("#e06a1b")]
    cloth = [Piece(f"banner{i}", palette[i], rough=0.9, raw=True) for i in range(len(palette))]
    emblem = Piece("banner_emblem", WHITE, rough=0.85, raw=True)
    rods = Piece("banner_rods", col("#0d0e12"), rough=0.6, raw=True)
    shape = [(-95, 170), (-95, -110), (0, -170), (95, -110), (95, 170)]
    shape = list(reversed(shape))    # CCW
    slots = [((x, 1650, 1320), FACE_NEG_Y) for x in (-1250, -750, -250, 250, 750, 1250)] + \
            [((1650, y, 1320), FACE_NEG_X) for y in (-1000, -500, 0, 500, 1000)]
    for i, (pos, face) in enumerate(slots):
        m = Matrix.Translation(pos) @ face
        prism(cloth[i % len(cloth)], shape, -2, 2, m=m)
        prism(emblem, star(48, 20), 2, 4.5, m=m @ Matrix.Translation((0, 40, 0)))
        prism(emblem, stadium(130, 22), 2, 4.5, m=m @ Matrix.Translation((0, -60, 0)))
        rods.cyl((pos[0], pos[1], pos[2] + 172), (pos[0], pos[1], CEILING_Z), 2.5, seg=6)
    P += cloth + [emblem, rods]
    ob = build_static("SM_Shell", P, uv_density=120.0)
    log("SM_Shell tris", tri_count(ob))
    return ob


# ---- everything -----------------------------------------------------------------------------------------

def build_all():
    layout = {
        "ring": {"mat_half": MAT_HALF, "rope_half": ROPE_HALF, "post": POST, "rope_z": list(ROPE_Z), "floor_z": FLOOR_Z,
                 "barricade": BARRICADE},
        "screens": [], "lights": [], "meshes": [],
    }
    objs = [build_ring(), build_ringside(), build_rig(layout), build_stage(layout), build_shell()]

    def low_skip(x, y):
        return stage_gap(x, y)

    objs += build_bowl("BowlLow", LOW, col("#1a2238"), col("#243a5c"), skip=low_skip)
    objs += build_bowl("BowlUp", UP, col("#11131a"), col("#3a2430"), fascia_glow=col("#ff4d3d"),
                       front_wall_to=LOW["z0"] + (LOW["rows"] - 1) * LOW["rise"])

    seats = floor_seats()
    seats += seat_list(LOW, 1, lambda x, y, k: stage_gap(x, y) or (y < 0 and abs(x) < 150 and k < 5))
    seats += seat_list(UP, 2, lambda x, y, k: False)
    layout["seats"] = seats
    layout["announce"] = [{"pos": ue((130, 512, FLOOR_Z + 62)), "yaw": ue_yaw(0, -1)},
                          {"pos": ue((250, 512, FLOOR_Z + 62)), "yaw": ue_yaw(0, -1)}]
    layout["bell"] = ue((-200, 440, -22))
    layout["camera"] = {"hard": ue((0, -1120, 255))}
    # Colour-wash lights on the upper fascia, aimed across the crowd.
    for a in range(0, 360, 30):
        d = UP["d0"] - 40
        x, y = d * math.cos(math.radians(a)), d * math.sin(math.radians(a))
        pos = Vector((x * 0.82, y * 0.82, UP["z0"] - 60))
        aim = (Vector((-x * 0.35, -y * 0.35, 80)) - pos).normalized()
        layout["lights"].append({"pos": ue(pos), "dir": ue(aim), "kind": "wash"})
    layout["meshes"] = [o.name for o in objs]
    for o in objs:
        export_fbx([o], o.name + ".fbx")
    write_json("arena_layout.json", layout)
    log("arena: meshes", len(objs), "seats", len(seats), "lights", len(layout["lights"]),
        "tris", sum(tri_count(o) for o in objs))
    return objs, layout
