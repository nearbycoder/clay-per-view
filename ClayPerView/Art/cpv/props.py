"""Weapons, finisher props and clay effect shapes.

Weapons are modelled with the grip at the origin and the business end along +Z (the game attaches
them to a hand bone). Effect shapes are near-white so the game can tint them per instance.
"""
import math

from mathutils import Matrix, Vector

from . import common
from .common import FONT_COMIC, FONT_TITLE, Piece, build_static, col, export_fbx, log, rot, shade, text_mesh, tri_count

WHITE = col("#f4f1ea")
STEEL = col("#9aa0ab")
BLACK = col("#17171a")
GOLD = col("#e0b03a")
WOOD = col("#8a5a33")


def star_pts(r_out, r_in, points=5, phase=90.0):
    out = []
    for i in range(points * 2):
        r = r_out if i % 2 == 0 else r_in
        a = math.radians(phase) + math.pi * i / points
        out.append((r * math.cos(a), r * math.sin(a)))
    return out


# ---- weapons -----------------------------------------------------------------------------------------

def chair():
    """Folding chair. Origin on the floor under the seat, seat facing +X (also used for floor seating)."""
    frame = Piece("chair_frame", STEEL, raw=True, rough=0.35)
    seat = Piece("chair_seat", col("#2b2f3a"), raw=True, rough=0.7)
    for s in (-1, 1):
        y = s * 20
        frame.tube([(17, y, 0), (-12, y, 44), (-18, y, 86)], 1.6, seg=8)      # front leg up into the back upright
        frame.tube([(-20, y, 0), (10, y, 43)], 1.6, seg=8)                     # rear leg
    frame.tube([(17, -20, 2), (17, 20, 2)], 1.3, seg=8)
    frame.tube([(-20, -20, 2), (-20, 20, 2)], 1.3, seg=8)
    frame.tube([(-18, -20, 86), (-18, 20, 86)], 1.6, seg=8)
    seat.box((-1, 0, 45), (36, 40, 3.5), bevel=1.2)
    seat.box((-16.5, 0, 72), (3, 40, 22), r3=rot(0, -8, 0), bevel=1.2)
    return build_static("SM_Chair", [frame, seat])


def guitar():
    """Electric guitar held by the neck: grip at the origin, body at the far end."""
    body = Piece("guitar_body", col("#d32f2f"), voxel=1.4, smooth=3, rough=0.3, lumps=0.1)
    m = Matrix.Diagonal((0.32, 1.0, 1.0, 1.0))
    body.ball((0, 0, 82), 21, scale=(1, 1, 0.95), m=m)
    body.ball((0, 0, 60), 16, m=m)
    body.ball((0, 13, 50), 7, m=m)       # horns
    body.ball((0, -13, 50), 7, m=m)
    neck = Piece("guitar_neck", col("#4a2f1c"), raw=True, rough=0.5)
    neck.box((0, 0, 28), (3.4, 5.6, 62), bevel=1.0)
    neck.box((0, 0, -7), (3.0, 8.5, 16), bevel=1.2)                           # headstock
    metal = Piece("guitar_metal", col("#e6e8ee"), raw=True, rough=0.25)
    for z in (66, 76):
        metal.box((3.6, 0, z), (1.4, 9, 3.2), bevel=0.4)
    metal.box((3.4, 0, 90), (1.2, 10, 3), bevel=0.4)
    for i in range(6):
        metal.cyl((1.8, -2.1 + 0.84 * i, -4), (3.9, -2.1 + 0.84 * i, 90), 0.14, seg=5)
        metal.ball((-1.6, 3.6 if i % 2 else -3.6, -12 + i * 2.2), 1.1, seg=8)
    return build_static("SM_Guitar", [body, neck, metal])


def slate():
    """The prop department's clapperboard. The hinge is near the grip, and the blade sits open."""
    front = rot(0, 0, 90) @ rot(90, 0, 0)
    panel = Piece("slate", col("#192431"), raw=True, rough=0.66)
    chalk = Piece("chalk", col("#fff1d0"), raw=True, rough=0.82)
    metal = Piece("hinge", col("#bea67e"), raw=True, rough=0.35)
    red = Piece("channel_id", col("#dd4845"), raw=True, rough=0.56)
    panel.box((0, 0, 24), (3.2, 50, 37), bevel=1.25)
    # Two bars with contrasting chalk chevrons. The top bar rotates about the left hinge.
    top = Matrix.Translation((0,-23,44)) @ rot(13,0,0) @ Matrix.Translation((0,23,-44))
    for place,z in ((None,40),(top,46)):
        panel.box((0,0,z), (4.4,51,5.5), bevel=0.75,m=place)
        for y in (-18,-7,4,15):
            chalk.box((2.3,y,z), (.5,5.4,5.4), r3=rot(-22,0,0),bevel=.18,m=place)
    for x in (-2.3,2.3):
        metal.cyl((x-.5,-22,43), (x+.5,-22,43), 2.35,seg=16)
    red.box((1.9,0,31),(.6,44,8.2),bevel=.25)
    chalk.text("CLAY-PER-VIEW",(2.6,0,31.2),5.5,.35,r3=front,font=FONT_COMIC)
    chalk.text("TAKE  02",(1.9,0,18.3),8,.3,r3=front,font=FONT_COMIC)
    chalk.box((2,0,11),(.52,42,.7))
    return build_static("SM_Slate",[panel,chalk,metal,red])


def pan():
    black = Piece("pan", col("#202024"), raw=True, rough=0.35)
    black.lathe([(0, 0), (15.5, 0), (18, 4.5), (17, 4.5), (15, 1.2), (0, 1.2)], c=(0, 0, 46), r3=rot(0, 90, 0), seg=28)
    black.cyl((0, 0, 0), (0, 0, 30), 1.9, 1.5, seg=10)
    grip = Piece("pan_grip", col("#7a1f1f"), raw=True, rough=0.6)
    grip.capsule((0, 0, 0), (0, 0, 16), 2.4, seg=10)
    return build_static("SM_Pan", [black, grip])


def mallet():
    handle = Piece("mallet_handle", WOOD, raw=True, rough=0.6)
    handle.cyl((0, 0, -4), (0, 0, 66), 2.4, 2.8, seg=12)
    head = Piece("mallet_head", col("#b7793f"), voxel=1.6, smooth=3, rough=0.6, lumps=0.25)
    head.cyl((-22, 0, 74), (22, 0, 74), 15, seg=24)
    bands = Piece("mallet_bands", col("#3b3f4a"), raw=True, rough=0.35)
    for x in (-17, 17):
        bands.torus((x, 0, 74), 14.6, 1.5, r3=rot(0, 90, 0), seg=28, rseg=8)
    return build_static("SM_Mallet", [handle, head, bands])


def trophy():
    """A gold star award on a plinth, swung star-first."""
    gold = Piece("trophy_gold", GOLD, raw=True, rough=0.22)
    gold.lathe([(0, 0), (3.2, 0), (2.2, 4), (1.6, 20), (2.6, 24), (0, 25)], c=(0, 0, 8), seg=16)
    gold.prism(star_pts(15, 6.3), -2.6, 2.6, m=Matrix.Translation((0, 0, 44)) @ rot(0, 0, 90) @ rot(90, 0, 0))
    base = Piece("trophy_base", col("#2a1c14"), raw=True, rough=0.4)
    base.box((0, 0, 3), (11, 11, 9), bevel=1.2)
    plate = Piece("trophy_plate", GOLD, raw=True, rough=0.25)
    plate.box((5.6, 0, 3), (0.6, 7, 3.4), bevel=0.2)
    return build_static("SM_Trophy", [gold, base, plate])


def chicken():
    """Rubber chicken, held by the feet."""
    body = Piece("chicken", col("#f3d44a"), voxel=1.1, smooth=3, rough=0.45, lumps=0.2)
    body.capsule((0, 0, 12), (0, 0, 40), 5.5, 9.5)
    body.capsule((0, 0, 40), (3, 0, 58), 4.5, 3.6)
    body.ball((4, 0, 62), 6.0)
    for s in (-1, 1):
        body.capsule((0, s * 3, 12), (0, s * 4, -2), 2.2, 1.6)
        body.ball((0, s * 9, 34), 6.5, scale=(0.5, 0.6, 1.3))
    red = Piece("chicken_red", col("#d32f2f"), voxel=0.9, smooth=2, rough=0.5)
    for i, z in enumerate((66, 68, 66)):
        red.ball((2 + i * 2.2, 0, z), 2.6)
    red.ball((9.5, 0, 57), 2.4, scale=(0.8, 0.8, 1.5))
    beak = Piece("chicken_beak", col("#e67e22"), raw=True, rough=0.5)
    beak.cyl((8, 0, 62), (15, 0, 61), 2.4, 0.3, seg=10)
    feet = Piece("chicken_feet", col("#e67e22"), raw=True, rough=0.5)
    for s in (-1, 1):
        for a in (-35, 0, 35):
            feet.capsule((0, s * 4, -2), (5 * math.cos(math.radians(a)), s * 4 + 5 * math.sin(math.radians(a)), -5), 0.9, seg=6)
    eye = Piece("chicken_eye", BLACK, raw=True, rough=0.2)
    for s in (-1, 1):
        eye.ball((7.5, s * 4.6, 64), 1.3, seg=8)
    return build_static("SM_Chicken", [body, red, beak, feet, eye])


# ---- finisher / signature props ---------------------------------------------------------------------

def bomb():
    body = Piece("bomb", col("#1b1b20"), voxel=1.2, smooth=3, rough=0.3, lumps=0.15)
    body.ball((0, 0, 0), 14)
    body.cyl((0, 0, 11), (0, 0, 18), 5, seg=14)
    fuse = Piece("bomb_fuse", col("#c9a56a"), raw=True, rough=0.7)
    fuse.tube([(0, 0, 17), (1, 0, 23), (4, 1, 27), (9, 1, 29)], 1.0, seg=8)
    spark = Piece("bomb_spark", col("#ffd23f"), raw=True, rough=0.5, slot="Glow")
    spark.ball((10, 1, 29.5), 2.6, seg=8)
    return build_static("SM_Bomb", [body, fuse, spark])


def giant_mic():
    """A microphone the size of a car, modelled head-down so it lands head first. Origin at the head's tip."""
    head = Piece("mic_head", col("#b9bec8"), voxel=3.0, smooth=3, rough=0.35, lumps=0.6)
    head.ball((0, 0, 62), 62, scale=(1, 1, 1.0))
    band = Piece("mic_band", col("#3b3f4a"), raw=True, rough=0.4)
    band.torus((0, 0, 78), 59, 7, seg=40, rseg=10)
    grille = Piece("mic_grille", col("#70757f"), raw=True, rough=0.4)
    for k in range(8):
        grille.torus((0, 0, 62), 62.6, 1.6, r3=rot(0, 90, 0) @ rot(22.5 * k, 0, 0), seg=40, rseg=6)
    body = Piece("mic_body", col("#22252c"), raw=True, rough=0.4)
    body.cyl((0, 0, 110), (0, 0, 330), 34, 24, seg=28)
    body.cyl((0, 0, 330), (0, 0, 345), 26, 22, seg=28)
    switch = Piece("mic_switch", col("#d32f2f"), raw=True, rough=0.4)
    switch.box((31, 0, 200), (6, 14, 26), bevel=2)
    return build_static("SM_GiantMic", [head, band, grille, body, switch], uv_density=80.0)


def rolling_pin():
    """Held in both hands: origin at the centre, axis along Y."""
    wood = Piece("pin", col("#c99a5b"), voxel=1.6, smooth=3, rough=0.55, lumps=0.2)
    wood.cyl((0, -42, 0), (0, 42, 0), 13, seg=28)
    grip = Piece("pin_grips", col("#8a5a33"), raw=True, rough=0.55)
    for s in (-1, 1):
        grip.cyl((0, s * 42, 0), (0, s * 50, 0), 3.2, seg=12)
        grip.capsule((0, s * 52, 0), (0, s * 66, 0), 4.4, seg=12)
    return build_static("SM_RollingPin", [wood, grip])


def rocket():
    """Cartoon rocket standing on its fins, nose up. Origin at the base centre."""
    hull = Piece("rocket_hull", col("#f1eee6"), voxel=2.2, smooth=3, rough=0.35, lumps=0.3)
    hull.cyl((0, 0, 30), (0, 0, 150), 24, 24, seg=28)
    hull.ball((0, 0, 150), 24, scale=(1, 1, 2.0))
    red = Piece("rocket_red", col("#d32f2f"), voxel=1.8, smooth=3, rough=0.35, lumps=0.2)
    red.ball((0, 0, 176), 17, scale=(1, 1, 1.6))
    for k in range(3):
        a = 2 * math.pi * k / 3
        d = Vector((math.cos(a), math.sin(a), 0))
        red.hull([tuple(d * 20 + Vector((0, 0, 70))), tuple(d * 52 + Vector((0, 0, 0))), tuple(d * 52 + Vector((0, 0, 18))),
                  tuple(d * 20 + Vector((0, 0, 22))), tuple(d * 20 + Vector((-d.y * 3, d.x * 3, 46))), tuple(d * 20 + Vector((d.y * 3, -d.x * 3, 46))),
                  tuple(d * 50 + Vector((-d.y * 3, d.x * 3, 8))), tuple(d * 50 + Vector((d.y * 3, -d.x * 3, 8)))])
    port = Piece("rocket_port", col("#5cc8ff"), raw=True, rough=0.15)
    port.ball((22.5, 0, 118), 9, scale=(0.35, 1, 1), seg=18)
    ring = Piece("rocket_ring", col("#3b3f4a"), raw=True, rough=0.3)
    ring.torus((23, 0, 118), 9.5, 1.8, r3=rot(0, 90, 0), seg=24, rseg=8)
    ring.cyl((0, 0, 18), (0, 0, 32), 17, 22, seg=24)
    return build_static("SM_Rocket", [hull, red, port, ring], uv_density=60.0)


def giant_speaker():
    """Speaker stack the size of a wardrobe. Origin at the base centre, cones facing +X."""
    box = Piece("spk_box", col("#17171b"), raw=True, rough=0.7)
    box.box((0, 0, 110), (100, 150, 220), bevel=6, bseg=3)
    cone = Piece("spk_cone", col("#2e3038"), raw=True, rough=0.5)
    dome = Piece("spk_dome", col("#8d93a0"), raw=True, rough=0.3)
    rim = Piece("spk_rim", col("#7b2ff7"), raw=True, rough=0.4, slot="Glow")
    for z, r in ((62, 50), (162, 38)):
        cone.lathe([(0, -6), (r * 0.3, -6), (r, 2), (r + 4, 4), (r + 4, 0), (0, 0)], c=(50, 0, z), r3=rot(0, 90, 0), seg=36)
        dome.ball((46, 0, z), r * 0.3, scale=(0.6, 1, 1), seg=18)
        rim.torus((53, 0, z), r + 5, 2.2, r3=rot(0, 90, 0), seg=40, rseg=8)
    return build_static("SM_GiantSpeaker", [box, cone, dome, rim], uv_density=60.0)


def scepter():
    gold = Piece("scepter", GOLD, raw=True, rough=0.22)
    gold.cyl((0, 0, -6), (0, 0, 70), 1.9, 1.6, seg=12)
    gold.ball((0, 0, -7), 3.0, seg=12)
    gold.torus((0, 0, 70), 4.2, 1.5, seg=18, rseg=8)
    gold.box((0, 0, 92), (2.2, 2.2, 12), bevel=0.5)
    gold.box((0, 0, 93), (2.2, 9, 2.4), bevel=0.5)
    orb = Piece("scepter_orb", col("#7e57c2"), raw=True, rough=0.12)
    orb.ball((0, 0, 79), 8.5, seg=20)
    return build_static("SM_Scepter", [gold, orb])


def crystal_ball():
    orb = Piece("orb", col("#8f7bff"), raw=True, rough=0.08)
    orb.ball((0, 0, 0), 13, seg=28)
    core = Piece("orb_core", col("#d6ccff"), raw=True, rough=0.3, slot="Glow")
    core.ball((0, 0, 0), 6.5, seg=14)
    return build_static("SM_CrystalBall", [orb, core])


def belt(icon=False):
    """Hand-set broadcast title. The screen and lettering stand proud of the leather."""
    front = rot(0, 0, 90) @ rot(90, 0, 0)
    strap = Piece("oxblood_leather", col("#511d2d"), raw=True, rough=0.84)
    brass = Piece("warm_brass", col("#ebad37"), raw=True, rough=0.34)
    edge = Piece("pale_gold", col("#ffe397"), raw=True, rough=0.4)
    ink = Piece("enamel", col("#172438"), raw=True, rough=0.36)
    tv = Piece("television_glass", col("#096570"), raw=True, rough=0.26)
    ruby = Piece("red_lacquer", col("#e53938"), raw=True, rough=0.32)
    if not icon:
        outline = [(-54, -5), (-51, -9), (-24, -10), (-13, -16), (13, -16), (24, -10),
                   (51, -9), (54, -5), (54, 5), (51, 9), (24, 10), (13, 16),
                   (-13, 16), (-24, 10), (-51, 9), (-54, 5)]
        strap.prism(outline, -2, 1.5, m=front)
        for side in (-1, 1):
            for y in range(21, 51, 3):
                for z in (-7, 7):
                    edge.cyl((1.6, side*y, z), (1.65, side*(y+1.6), z), 0.24, seg=6)
            for y in (30, 40):
                brass.box((2.2, side*y, 0), (1.6, 8.4, 11), bevel=0.7)
                ink.box((3.1, side*y, 0), (0.65, 7, 9.3), bevel=0.5)
                edge.prism(star_pts(3.3, 1.5), 0, 0.6, m=Matrix.Translation((3.5, side*y, 0)) @ front)
            for z in (-3, 3):
                brass.ball((1.9, side*48, z), 1.1, scale=(0.4, 1, 1), seg=10)
    # A gilt miniature CRT, with rabbit ears, a channel dial and the station's raised call letters.
    brass.box((2, 0, 0), (5.5, 37, 26), bevel=2.3, bseg=4)
    edge.box((4.5, 0, 0.2), (2.3, 35.5, 24.5), bevel=1, bseg=3)
    ink.box((5.5, 0, 0.2), (1.6, 33.6, 22.4), bevel=0.75)
    tv.box((6.4, -2.9, 1), (1.5, 23.3, 15.9), bevel=0.7, bseg=3)
    edge.text("CPV", (7.4, -2.9, 1.3), 10.7, 0.95, r3=front, font=FONT_TITLE, bevel=0.12)
    for z in (4.9, -2):
        brass.cyl((6.5, 12.1, z), (8.15, 12.1, z), 2.45, seg=20)
        ruby.box((8.35, 12.1, z), (0.55, 0.75, 3.1), r3=rot(-35, 0, 0), bevel=0.18)
    edge.text("PRIME TIME", (6.7, -2.7, -8.8), 3.1, 0.35, r3=front, font=FONT_COMIC, bevel=0.05)
    brass.capsule((1, -3, 12), (1, -13, 21.5), 0.7, seg=8)
    brass.capsule((1, 3, 12), (1, 10, 18.7), 0.7, seg=8)
    for y,z in ((-13,21.5),(10,18.7)):
        ruby.ball((1, y, z), 1.4, seg=12)
    return build_static("SM_Belt", [piece for piece in (strap, brass, edge, ink, tv, ruby) if len(piece.bm.verts)])


def tv_camera():
    """Broadcast camera on a tripod, lens along +X. Origin on the floor."""
    body = Piece("cam_body", col("#2a2d36"), raw=True, rough=0.5)
    body.box((0, 0, 150), (70, 30, 34), bevel=4)
    body.cyl((35, 0, 150), (62, 0, 150), 11, 14, seg=20)
    body.box((-30, 0, 174), (26, 20, 16), bevel=3)                           # viewfinder
    legs = Piece("cam_legs", col("#6f7480"), raw=True, rough=0.4)
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.5
        legs.cyl((0, 0, 128), (55 * math.cos(a), 55 * math.sin(a), 0), 2.4, seg=8)
    legs.cyl((0, 0, 120), (0, 0, 134), 5, seg=12)
    lens = Piece("cam_lens", col("#101014"), raw=True, rough=0.1)
    lens.cyl((62, 0, 150), (64, 0, 150), 12, seg=20)
    tally = Piece("cam_tally", col("#ff3b30"), raw=True, rough=0.4, slot="Glow")
    tally.ball((30, 0, 170), 2.6, seg=10)
    return build_static("SM_TVCamera", [body, legs, lens, tally])


# ---- effect shapes -----------------------------------------------------------------------------------

def fx_star():
    p = Piece("star", col("#ffd23f"), voxel=0.7, smooth=3, rough=0.5, lumps=0.05)
    p.prism(star_pts(10, 4.6), -2.2, 2.2)
    return build_static("SM_FxStar", [p])


def fx_burst():
    """Flat spiky impact burst, facing +X (the game billboards it)."""
    p = Piece("burst", WHITE, raw=True, rough=0.6)
    pts = []
    n = 14
    for i in range(n * 2):
        r = (50 if i % 4 == 0 else 40) if i % 2 == 0 else 22
        a = math.pi * i / n
        pts.append((r * math.cos(a), r * math.sin(a)))
    p.prism(pts, -1.5, 1.5, m=rot(0, 0, 90) @ rot(90, 0, 0))
    return build_static("SM_FxBurst", [p])


def fx_puff():
    p = Piece("puff", WHITE, voxel=1.6, smooth=3, rough=0.95, lumps=0.4)
    for (x, y, z, r) in ((0, 0, 0, 14), (11, 4, 5, 10), (-9, 7, 3, 11), (3, -11, 4, 9), (-4, -3, 11, 10), (8, -6, -6, 8), (-10, -8, -4, 8)):
        p.ball((x, y, z), r)
    return build_static("SM_FxPuff", [p])


def fx_blob():
    p = Piece("blob", WHITE, voxel=0.8, smooth=3, rough=0.72, lumps=0.25)
    p.ball((0, 0, 0), 5)
    p.ball((3.2, 1, 1.5), 3.4)
    p.ball((-2.5, -2, 2.2), 3.0)
    p.ball((0.5, 2.8, -2.4), 2.8)
    return build_static("SM_FxBlob", [p])


def fx_splat():
    """A flattened splat with satellite drops, lying on the floor (Z up), about 60 cm across."""
    p = Piece("splat", WHITE, voxel=0.9, smooth=3, rough=0.7, lumps=0.1)
    m = Matrix.Diagonal((1, 1, 0.09, 1))
    p.ball((0, 0, 0), 15, m=m)
    for k, (a, d, r) in enumerate(((20, 17, 7), (95, 15, 8), (160, 19, 6), (215, 16, 8.5), (290, 18, 6.5), (335, 13, 7.5))):
        x, y = d * math.cos(math.radians(a)), d * math.sin(math.radians(a))
        p.ball((x, y, 0), r, m=m)
        p.capsule((x * 0.6, y * 0.6, 0), (x * 1.5, y * 1.5, 0), r * 0.5, r * 0.3, m=m)
        p.ball((x * 1.75, y * 1.75, 0), r * 0.42, m=m)
    return build_static("SM_FxSplat", [p])


def fx_ring():
    p = Piece("ring", WHITE, raw=True, rough=0.7)
    p.torus((0, 0, 0), 50, 3.2, seg=48, rseg=8, m=Matrix.Diagonal((1, 1, 0.7, 1)))
    return build_static("SM_FxRing", [p])


def fx_flame():
    outer = Piece("flame_outer", col("#ff6a00"), voxel=1.0, smooth=3, rough=0.6, slot="Glow", lumps=0.2)
    for (x, y, h, r) in ((0, 0, 44, 11), (8, 3, 28, 7.5), (-7, -4, 32, 8), (2, -8, 22, 6)):
        outer.capsule((x, y, r * 0.9), (x * 1.1, y * 1.1, h), r, r * 0.12)
    inner = Piece("flame_inner", col("#ffe14d"), voxel=1.0, smooth=3, rough=0.6, slot="Glow", lumps=0.1)
    inner.capsule((1.5, 0, 9), (1.8, 0, 30), 6.5, 1.0)
    inner.ball((1.5, 0, 9), 7.2)
    return build_static("SM_FxFlame", [outer, inner])


def fx_bolt():
    p = Piece("bolt", col("#fff27a"), raw=True, rough=0.5, slot="Glow")
    pts = [(-6, 50), (9, 50), (2, 22), (13, 22), (-9, -50), (-3, -8), (-13, -8)]
    p.prism(list(reversed(pts)), -2.2, 2.2, m=rot(0, 0, 90) @ rot(90, 0, 0))
    return build_static("SM_FxBolt", [p])


def fx_note():
    p = Piece("note", WHITE, voxel=0.8, smooth=3, rough=0.5, lumps=0.05)
    m = rot(0, 0, 90)
    p.ball((-6, 0, 0), 6, scale=(1.25, 0.6, 0.9), m=m)
    p.cyl((-0.5, 0, 0), (-0.5, 0, 30), 1.6, seg=10, m=m)
    p.capsule((-0.5, 0, 30), (9, 0, 22), 1.8, 1.2, m=m)
    p.capsule((9, 0, 22), (11, 0, 14), 1.2, 0.6, m=m)
    return build_static("SM_FxNote", [p])


def fx_tooth():
    p = Piece("tooth", col("#f7f3e6"), voxel=0.45, smooth=2, rough=0.3, lumps=0.0)
    p.ball((0, 0, 2.2), 2.2, scale=(1, 0.8, 1.1))
    p.capsule((-1.0, 0, 1.5), (-1.3, 0, -2.6), 1.1, 0.5)
    p.capsule((1.0, 0, 1.5), (1.3, 0, -2.6), 1.1, 0.5)
    return build_static("SM_FxTooth", [p])


def fx_confetti():
    p = Piece("confetti", WHITE, raw=True, rough=0.6)
    p.box((0, 0, 0), (7, 4, 0.4))
    return build_static("SM_FxConfetti", [p])


def fx_word(word, name):
    """Comic impact word in chunky clay letters, readable along +Y when facing +X (the game billboards it)."""
    p = Piece("word", WHITE, raw=True, rough=0.6)
    me = text_mesh(word, font=FONT_COMIC, size=40.0, depth=7.0, bevel=0.9)
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    centre = Matrix.Translation((-(max(xs) + min(xs)) / 2, -(max(ys) + min(ys)) / 2, 0))
    # text plane XY -> upright, facing +X, reading toward -Y (left to right for a viewer on +X)
    p.mesh(me, m=rot(0, 0, 90) @ rot(90, 0, 0) @ centre)
    return build_static(name, [p])


WORDS = {"POW!": "SM_WordPow", "BAM!": "SM_WordBam", "WHAM!": "SM_WordWham", "SPLAT!": "SM_WordSplat", "CRUNCH!": "SM_WordCrunch",
         "BONK!": "SM_WordBonk", "OOF!": "SM_WordOof", "K.O.!": "SM_WordKO", "ZAP!": "SM_WordZap", "BOOM!": "SM_WordBoom"}


def rope_segment():
    """One fat clay rope link: a capsule 1 m long along X (the game stretches a chain of these)."""
    p = Piece("rope", WHITE, raw=True, rough=0.75)
    p.capsule((-50, 0, 0), (50, 0, 0), 3.6, seg=10)
    return build_static("SM_RopeSeg", [p])


def build_all(preview=False):
    makers = [chair, guitar, slate, pan, mallet, trophy, chicken, bomb, giant_mic, rolling_pin, rocket, giant_speaker, scepter, crystal_ball,
              belt, tv_camera, fx_star, fx_burst, fx_puff, fx_blob, fx_splat, fx_ring, fx_flame, fx_bolt, fx_note, fx_tooth, fx_confetti,
              rope_segment]
    objs = [fn() for fn in makers]
    objs += [fx_word(word, name) for word, name in WORDS.items()]
    for ob in objs:
        export_fbx([ob], ob.name + ".fbx")
    log("props:", len(objs), "meshes, tris", sum(tri_count(o) for o in objs))
    if preview:
        x = 0.0
        row = 0
        for i, ob in enumerate(objs):
            ob.location = ((i % 9) * 130 - 520, (i // 9) * 190 - 280, 0)
        common.setup_preview(res=(1800, 1100), bg=(0.16, 0.17, 0.2))
        common.render("props.png", (0, -1500, 1300), (0, 60, 0), lens=50)
    return objs
