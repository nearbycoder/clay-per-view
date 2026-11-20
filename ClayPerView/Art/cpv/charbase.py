"""The shared clay-character builder: one skeleton layout, chunky lumps of coloured clay per body part.

Characters face +X, left side at +Y, feet on Z = 0, bind pose with the arms ARM_ANGLE degrees out from
hanging straight down. Every character has the same bone names so the game can drive them all with
one procedural animation system:

  root > pelvis > spine > chest > neck > head
  chest > clavicle_l > upperarm_l > forearm_l > hand_l > (fist_l, open_l)      (and _r)
  pelvis > thigh_l > shin_l > foot_l                                             (and _r)
  head > brow_l/r, lid_l/r, pupil_l/r, mouth_closed/grit/open/ouch/grin, hair > tail
  optional: belly (child of spine), skirt (child of pelvis)

Replacement parts (mouth shapes, fist/open hands) each hang off their own bone; the game shows one by
scaling the others to nothing, the way stop-motion animators swap sculpted mouths.
"""
import math

import numpy as np
from mathutils import Matrix, Vector, noise

from .common import Piece, build_skinned, col, export_fbx, log, make_armature, mix, rot, shade, tri_count

ARM_ANGLE = 42.0
MOUTHS = ("closed", "grit", "open", "ouch", "grin")

WHITE = col("#f4f1ea")
BLACK = col("#141416")
TEETH = col("#f3efe2")
MOUTH_DARK = col("#2b0a0d")
TONGUE = col("#d9566b")
GOLD = col("#e0b03a")
SILVER = col("#b9bec8")


# ---- paint helpers (per-vertex colour functions) ---------------------------------------------------

def paint_checker(a, b, size=5.0):
    def fn(co, nrm):
        cell = np.floor(co / size).astype(np.int32)
        m = ((cell[:, 0] + cell[:, 1] + cell[:, 2]) % 2 == 0)[:, None]
        return np.where(m, np.array(a, dtype=np.float32), np.array(b, dtype=np.float32))
    return fn


def paint_stripes_y(a, b, width=6.0):
    def fn(co, nrm):
        m = (np.floor(co[:, 1] / width + 0.5).astype(np.int32) % 2 == 0)[:, None]
        return np.where(m, np.array(a, dtype=np.float32), np.array(b, dtype=np.float32))
    return fn


def paint_speckle(base, spark, amount=0.18, scale=0.55):
    def fn(co, nrm):
        n = np.array([noise.noise(Vector((float(p[0]) * scale, float(p[1]) * scale, float(p[2]) * scale))) for p in co])
        m = (n > (0.5 - amount))[:, None]
        return np.where(m, np.array(spark, dtype=np.float32), np.array(base, dtype=np.float32))
    return fn


def paint_blotch(base, other, scale=0.09, threshold=0.05):
    """Soft camouflage / marbled clay blotches."""
    def fn(co, nrm):
        n = np.array([noise.noise(Vector((float(p[0]) * scale, float(p[1]) * scale + 7.0, float(p[2]) * scale))) for p in co])
        m = (n > threshold)[:, None]
        return np.where(m, np.array(other, dtype=np.float32), np.array(base, dtype=np.float32))
    return fn


def paint_region(base, other, test):
    """Colour `other` wherever test(co) is true (e.g. stubble on the jaw, blush on the cheeks)."""
    def fn(co, nrm):
        m = test(co)[:, None]
        return np.where(m, np.array(other, dtype=np.float32), np.array(base, dtype=np.float32))
    return fn


class Char:
    def __init__(self, name, skin, leg=1.0, torso=1.0, arm=1.0, shoulders=23.0, hips=11.0, head=1.0,
                 chest=(22.0, 15.0), waist=(18.0, 13.0), hip=(19.0, 14.0), belly=0.0,
                 arm_r=(7.5, 6.5, 5.5), leg_r=(10.0, 7.5, 6.0), neck_r=7.5, hand=1.0, foot=1.0,
                 skull=(19.0, 18.0, 20.0), jaw=(15.5, 15.5, 12.5), jaw_drop=9.0, eye_y=7.5, eye_z=4.0, eye_size=1.0,
                 mouth_z=-11.5, mouth_scale=1.0, lip=None, hair=None, belly_bone=False, skirt_bone=False):
        self.name = name
        self.skin = skin
        self.lip = lip or shade(skin, 0.45)
        self.hair_col = hair or col("#2a1c14")
        self.leg, self.torso_s, self.arm, self.hs = leg, torso, arm, head
        self.shoulders, self.hips = shoulders, hips
        self.chest, self.waist, self.hip, self.belly = chest, waist, hip, belly
        self.arm_r, self.leg_r, self.neck_r = arm_r, leg_r, neck_r
        self.hand_s, self.foot_s = hand, foot
        self.mouth_scale = mouth_scale
        self.eye_size = eye_size
        self.belly_bone, self.skirt_bone = belly_bone, skirt_bone
        self.pieces = []

        # -- joints --
        self.ankle_z = 9.0
        self.knee_z = self.ankle_z + 35.0 * leg
        self.hip_z = self.knee_z + 40.0 * leg
        self.pelvis_z = self.hip_z + 4.0
        self.waist_z = self.pelvis_z + 8.0 * torso
        self.chest_z = self.waist_z + 16.0 * torso
        self.neck_z = self.chest_z + 24.0 * torso
        self.shoulder_z = self.neck_z - 6.0
        self.headpivot_z = self.neck_z + 7.0
        hs = head
        self.head_c = Vector((2.0, 0.0, self.headpivot_z + 15.0 * hs))
        a = math.radians(ARM_ANGLE)
        self.arm_dir = Vector((0.0, math.sin(a), -math.cos(a)))
        self.upper_len, self.fore_len = 26.0 * arm, 24.0 * arm
        self.height = self.head_c.z + skull[2] * hs + 2.0 * hs

        # -- head volumes (used to place features on the face surface) --
        C = self.head_c
        self.skull_c = C + Vector((0.0, 0.0, 2.0 * hs))
        self.skull_r = Vector(skull) * hs
        self.jaw_c = C + Vector((3.0 * hs, 0.0, -jaw_drop * hs))
        self.jaw_r = Vector(jaw) * hs
        self.eye_c = {}
        for s in (1, -1):
            y, z = s * eye_y * hs, C.z + eye_z * hs
            self.eye_c[s] = Vector((self.face_x(y, z) - 2.2 * hs * eye_size, y, z))
        mz = C.z + mouth_z * hs
        self.mouth_c = Vector((self.face_x(0.0, mz) - 0.3 * hs, 0.0, mz))

    # ---- joints -------------------------------------------------------------------------------------
    def shoulder(self, s):
        return Vector((0.0, s * self.shoulders, self.shoulder_z))

    def _arm(self, s, dist):
        d = Vector((self.arm_dir.x, s * self.arm_dir.y, self.arm_dir.z))
        return self.shoulder(s) + d * dist

    def elbow(self, s):
        return self._arm(s, self.upper_len)

    def wrist(self, s):
        return self._arm(s, self.upper_len + self.fore_len)

    def hand_c(self, s):
        return self._arm(s, self.upper_len + self.fore_len + 6.5 * self.hand_s)

    def armdir(self, s):
        return Vector((self.arm_dir.x, s * self.arm_dir.y, self.arm_dir.z))

    def hipj(self, s):
        return Vector((0.0, s * self.hips, self.hip_z))

    def knee(self, s):
        return Vector((0.5, s * (self.hips + 0.6), self.knee_z))

    def ankle(self, s):
        return Vector((0.0, s * (self.hips + 1.2), self.ankle_z))

    def face_x(self, y, z):
        """X of the face's front surface at (y, z), from the skull and jaw ellipsoids."""
        best = None
        for c, r in ((self.skull_c, self.skull_r), (self.jaw_c, self.jaw_r)):
            t = 1.0 - ((y - c.y) / r.y) ** 2 - ((z - c.z) / r.z) ** 2
            if t > 0.0:
                x = c.x + r.x * math.sqrt(t)
                best = x if best is None else max(best, x)
        return best if best is not None else self.head_c.x

    def torso_x(self, y, z):
        """X of the torso's front surface at (y, z), from the chest and waist/belly ellipsoids."""
        t = self.torso_s
        cw, cd = self.chest
        ww, wd = self.waist
        lumps = ((Vector((1.5, 0, self.chest_z + 11 * t)), Vector((cd, cw, 15.5 * t))),
                 (Vector((0.5 + self.belly * 5.0, 0, self.waist_z + 7 * t)), Vector((wd + self.belly * 9.0, ww + self.belly * 4.0, 14.5 * t + self.belly * 3.0))))
        best = None
        for c, r in lumps:
            u = 1.0 - (y / r.y) ** 2 - ((z - c.z) / r.z) ** 2
            if u > 0.0:
                x = c.x + r.x * math.sqrt(u)
                best = x if best is None else max(best, x)
        return best if best is not None else 0.0

    def skull_ring(self, dz, grow=0.6, wobble=0.0, n=32):
        """Loop of points hugging the skull at height dz (head-scaled) above the head centre."""
        z = self.head_c.z + dz * self.hs
        r = self.skull_r
        k = math.sqrt(max(0.04, 1.0 - ((z - self.skull_c.z) / r.z) ** 2))
        return [(self.skull_c.x + (r.x * k + grow) * math.cos(2 * math.pi * i / n), (r.y * k + grow) * math.sin(2 * math.pi * i / n),
                 z + wobble * math.cos(2 * math.pi * i / n)) for i in range(n)]

    def face_pt(self, y, z, out=0.0):
        """A point on (or `out` cm in front of) the face surface. y, z are head-scaled offsets from the head centre."""
        yy, zz = y * self.hs, self.head_c.z + z * self.hs
        return Vector((self.face_x(yy, zz) + out, yy, zz))

    # ---- skeleton -----------------------------------------------------------------------------------
    def bones(self):
        B = []
        up = Vector((0, 0, 1))

        def add(name, head, tail, parent):
            B.append((name, tuple(head), tuple(tail), parent))

        add("root", (0, 0, 0), (0, 0, 10), None)
        add("pelvis", (0, 0, self.pelvis_z), (0, 0, self.waist_z), "root")
        add("spine", (0, 0, self.waist_z), (0, 0, self.chest_z), "pelvis")
        add("chest", (0, 0, self.chest_z), (0, 0, self.neck_z), "spine")
        add("neck", (0, 0, self.neck_z), (0, 0, self.headpivot_z), "chest")
        add("head", (0, 0, self.headpivot_z), (0, 0, self.headpivot_z + 30 * self.hs), "neck")
        for s, t in ((1, "l"), (-1, "r")):
            add("clavicle_" + t, (0, s * 5, self.shoulder_z + 1), self.shoulder(s), "chest")
            add("upperarm_" + t, self.shoulder(s), self.elbow(s), "clavicle_" + t)
            add("forearm_" + t, self.elbow(s), self.wrist(s), "upperarm_" + t)
            add("hand_" + t, self.wrist(s), self.hand_c(s), "forearm_" + t)
            hc = self.hand_c(s)
            add("fist_" + t, hc, hc + self.armdir(s) * 4, "hand_" + t)
            add("open_" + t, hc, hc + self.armdir(s) * 4, "hand_" + t)
            add("thigh_" + t, self.hipj(s), self.knee(s), "pelvis")
            add("shin_" + t, self.knee(s), self.ankle(s), "thigh_" + t)
            add("foot_" + t, self.ankle(s), self.ankle(s) + Vector((13 * self.foot_s, 0, -5)), "shin_" + t)
            e = self.eye_c[s]
            add("lid_" + t, e, e + Vector((3, 0, 0)), "head")
            add("pupil_" + t, e + Vector((4.4 * self.hs * self.eye_size, 0, 0)), e + Vector((7, 0, 0)), "head")
            b = e + Vector((3.6, 0, 7.6)) * self.hs
            add("brow_" + t, b, b + Vector((3, 0, 0)), "head")
        for m in MOUTHS:
            add("mouth_" + m, self.mouth_c, self.mouth_c + Vector((3, 0, 0)), "head")
        top = self.head_c + Vector((-2.0, 0, 15.0)) * self.hs
        add("hair", top, top + up * 8, "head")
        back = self.head_c + Vector((-17.0, 0, 6.0)) * self.hs
        add("tail", back, back + Vector((-8, 0, -4)), "hair")
        if self.belly_bone:
            add("belly", (4, 0, self.waist_z + 4), (self.waist[1] + self.belly * 12, 0, self.waist_z + 2), "spine")
        if self.skirt_bone:
            add("skirt", (0, 0, self.pelvis_z), (0, 0, self.pelvis_z - 14), "pelvis")
        return B

    # ---- piece helpers -----------------------------------------------------------------------------
    def P(self, name, colour, **kw):
        if kw.get("raw"):
            kw.setdefault("sharp", 62.0)
        elif kw.get("paint") is None:
            kw.setdefault("decimate", 0.42)      # painted lumps keep every vertex so patterns stay crisp
        p = Piece(f"{self.name}_{name}", colour, **kw)
        self.pieces.append(p)
        return p

    # ---- standard body parts ----------------------------------------------------------------------
    def torso(self, colour, sleeves="none", pecs=0.0, traps=0.0, rough=0.72, paint=None, sleeve_r=1.6, hem=True, name="torso",
              yoke=True):
        """Chest + waist lump in the top's colour; sleeves: none | short | long."""
        bones = ["pelvis", "spine", "chest", "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r"]
        if sleeves == "long":
            bones += ["forearm_l", "forearm_r"]
        if self.belly_bone:
            bones.append("belly")
        p = self.P(name, colour, voxel=1.6, smooth=5, bones=bones, rough=rough, paint=paint)
        cw, cd = self.chest
        ww, wd = self.waist
        t = self.torso_s
        p.ball((1.5, 0, self.chest_z + 11 * t), 1.0, scale=(cd, cw, 15.5 * t))
        p.ball((0.5 + self.belly * 5.0, 0, self.waist_z + 7 * t), 1.0, scale=(wd + self.belly * 9.0, ww + self.belly * 4.0, 14.5 * t + self.belly * 3.0))
        if hem:
            p.ball((0.5 + self.belly * 3.0, 0, self.pelvis_z + 5), 1.0, scale=(self.hip[1] * 0.98 + self.belly * 4.0, self.hip[0] * 0.99 + self.belly * 2.0, 8.5))
        if yoke:
            p.capsule((0, -self.shoulders + 5, self.shoulder_z + 1.5 + traps * 2), (0, self.shoulders - 5, self.shoulder_z + 1.5 + traps * 2), 7.0 + traps * 2.5)
        for s in (1, -1):
            if yoke:
                p.ball(self.shoulder(s), self.arm_r[0] + 2.6)
            if pecs > 0:
                p.ball((cd * 0.62, s * cw * 0.42, self.chest_z + 14 * t), 7.5 * pecs + 2.0, scale=(0.8, 1.15, 0.9))
            if sleeves == "short":
                p.capsule(self.shoulder(s), self._arm(s, self.upper_len * 0.55), self.arm_r[0] + sleeve_r, self.arm_r[0] + sleeve_r + 0.4)
            elif sleeves == "long":
                p.capsule(self.shoulder(s), self.elbow(s), self.arm_r[0] + sleeve_r, self.arm_r[1] + sleeve_r)
                p.capsule(self.elbow(s), self._arm(s, self.upper_len + self.fore_len * 0.93), self.arm_r[1] + sleeve_r, self.arm_r[2] + sleeve_r + 0.6)
        return p

    def bottom(self, colour, kind="pants", rough=0.72, paint=None, cuff=0.0, name="bottom"):
        """Pelvis lump + trouser legs. kind: pants | shorts | trunks."""
        p = self.P(name, colour, voxel=1.6, smooth=5, rough=rough, paint=paint,
                   bones=["pelvis", "spine", "thigh_l", "thigh_r", "shin_l", "shin_r"])
        hw, hd = self.hip
        p.ball((0, 0, self.pelvis_z + 1), 1.0, scale=(hd, hw, 12.5))
        tr, cr, ar = self.leg_r
        for s in (1, -1):
            hipj, knee, ankle = self.hipj(s), self.knee(s), self.ankle(s)
            if kind == "pants":
                p.capsule(hipj, knee, tr + 0.8, cr + 1.2)
                p.capsule(knee, ankle + Vector((0, 0, 4)), cr + 1.2, ar + 1.2 + cuff)
            elif kind == "shorts":
                p.capsule(hipj, hipj.lerp(knee, 0.72), tr + 1.2, tr + 0.6)
            else:
                p.capsule(hipj, hipj.lerp(knee, 0.3), tr + 0.6, tr + 0.2)
        return p

    def legs(self, colour, upper=True, rough=0.72, paint=None, name="legs"):
        """Bare (or stockinged) legs from the hip down to the ankle."""
        p = self.P(name, colour, voxel=1.5, smooth=5, rough=rough, paint=paint, bones=["thigh_l", "thigh_r", "shin_l", "shin_r"])
        tr, cr, ar = self.leg_r
        for s in (1, -1):
            hipj, knee, ankle = self.hipj(s), self.knee(s), self.ankle(s)
            if upper:
                p.capsule(hipj.lerp(knee, 0.18), knee, tr, cr)
            p.capsule(knee, ankle + Vector((0, 0, 2)), cr, ar)
        return p

    def boots(self, colour, shaft=0.5, rough=0.5, sole=None, paint=None, name="boots", heel=0.0):
        """Feet plus a boot shaft covering `shaft` of the shin (0 = low shoe)."""
        p = self.P(name, colour, voxel=1.3, smooth=4, rough=rough, paint=paint, bones=["shin_l", "shin_r", "foot_l", "foot_r"])
        tr, cr, ar = self.leg_r
        f = self.foot_s
        for s in (1, -1):
            knee, ankle = self.knee(s), self.ankle(s)
            if shaft > 0:
                top = ankle.lerp(knee, shaft)
                p.capsule(top, ankle, ar + (cr - ar) * shaft + 1.4, ar + 1.6)
            p.ball(ankle + Vector((0, 0, -1)), ar + 1.6)
            y = ankle.y
            p.capsule((-4.5 * f, y, 5.6 + heel), (11.5 * f, y, 5.0), 6.0 * f, 5.4 * f)
            if heel > 0:
                p.cyl((-6.0 * f, y, 0.0), (-6.0 * f, y, 4.0 + heel), 2.4 * f, 3.0 * f, seg=10)
        if sole is not None:
            for s, t in ((1, "l"), (-1, "r")):
                q = self.P(f"{name}_sole_{t}", sole, raw=True, rough=0.6, rigid="foot_" + t)
                y = self.ankle(s).y
                q.box((3.4 * f, y, 1.5), (23.0 * f, 12.6 * f, 3.0), bevel=1.4, bseg=3)
        return p

    def arms(self, colour, upper=True, rough=0.72, paint=None, name="arms"):
        """Bare arms (upper optional, for short sleeves) down to the wrist."""
        p = self.P(name, colour, voxel=1.4, smooth=5, rough=rough, paint=paint, bones=["upperarm_l", "upperarm_r", "forearm_l", "forearm_r"])
        ur, er, wr = self.arm_r
        for s in (1, -1):
            if upper:
                p.capsule(self.shoulder(s), self.elbow(s), ur, er)
            else:
                p.capsule(self._arm(s, self.upper_len * 0.45), self.elbow(s), ur * 0.97, er)
            p.capsule(self.elbow(s), self.wrist(s), er, wr)
        return p

    def hand_frame(self, s):
        """Matrix whose local axes are X = thumb side (forward), Y = palm normal, Z = along the arm.
        The right hand's frame is mirrored, which is fine because hands are voxel-remeshed."""
        d = self.armdir(s)
        f = Vector((1, 0, 0))
        n = d.cross(f) if s > 0 else f.cross(d)
        n.normalize()
        return Matrix((f, n, d)).transposed().to_4x4()

    def hands(self, colour, rough=0.72, name="hand", knuckle=None):
        k = self.hand_s
        for s, t in ((1, "l"), (-1, "r")):
            base = Matrix.Translation(self.hand_c(s)) @ self.hand_frame(s)
            fist = self.P(f"{name}_fist_{t}", colour, voxel=0.95, smooth=3, lumps=0.1, rough=rough, rigid="fist_" + t)
            fist.ball((0, 0, 0), 1.0, scale=(6.9 * k, 5.6 * k, 6.5 * k), m=base)
            for i in range(4):
                fist.ball(((-4.4 + 2.9 * i) * k, -1.2 * k, 4.9 * k), 2.45 * k, m=base)
            fist.capsule((5.6 * k, 1.5 * k, -1.5 * k), (2.6 * k, 4.6 * k, 3.2 * k), 2.3 * k, m=base)
            fist.capsule((0, 0, -9.0 * k), (0, 0, -4.0 * k), self.arm_r[2] + 0.4, m=base)
            hand = self.P(f"{name}_open_{t}", colour, voxel=0.95, smooth=3, lumps=0.1, rough=rough, rigid="open_" + t)
            hand.ball((0, 0, -0.5 * k), 1.0, scale=(6.0 * k, 3.0 * k, 6.4 * k), m=base)
            for i in range(4):
                x = (-4.3 + 2.87 * i) * k
                tip = 11.5 + (1.6 if i in (1, 2) else 0.0)
                hand.capsule((x, 0, 4.0 * k), (x * 1.32, 1.4 * k, tip * k), 1.95 * k, 1.7 * k, m=base)
            hand.capsule((5.0 * k, 0.4 * k, -1.0 * k), (10.2 * k, 1.0 * k, 3.6 * k), 2.2 * k, 1.9 * k, m=base)
            hand.capsule((0, 0, -9.0 * k), (0, 0, -4.0 * k), self.arm_r[2] + 0.4, m=base)

    def yoke(self, colour, traps=0.0, rough=0.72, name="yoke"):
        """Bare shoulders and upper back, for tank tops and strapless dresses."""
        p = self.P(name, colour, voxel=1.5, smooth=5, rough=rough, bones=["chest", "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r"])
        p.capsule((0, -self.shoulders + 4, self.shoulder_z + 1.0 + traps * 2), (0, self.shoulders - 4, self.shoulder_z + 1.0 + traps * 2), 6.6 + traps * 2.5)
        for s in (1, -1):
            p.ball(self.shoulder(s), self.arm_r[0] + 1.6)
        return p

    def gauntlets(self, colour, rough=0.6, grow=1.0, start=0.12, name="gauntlets", paint=None):
        """Forearm covers (long gloves, bracers, cuffs)."""
        p = self.P(name, colour, voxel=1.3, smooth=4, rough=rough, paint=paint, bones=["upperarm_l", "upperarm_r", "forearm_l", "forearm_r"])
        for s in (1, -1):
            a = self._arm(s, self.upper_len + self.fore_len * start)
            p.capsule(a, self._arm(s, self.upper_len + self.fore_len * 0.97), self.arm_r[1] + grow, self.arm_r[2] + grow + 0.5)
        return p

    def skirt(self, colour, top_r, bottom_r, z_top, z_bottom, rough=0.72, paint=None, name="skirt", squash=0.86, rigid=None, bones=None):
        """A bell of clay hanging from the waist. Short skirts sway rigidly on the `skirt` bone; long
        ones pass `bones` (pelvis + legs) so the cloth is carried by the knees instead of being kicked through."""
        if bones:
            p = self.P(name, colour, voxel=1.7, smooth=5, rough=rough, paint=paint, bones=bones)
        else:
            p = self.P(name, colour, voxel=1.7, smooth=5, rough=rough, paint=paint, rigid=rigid or ("skirt" if self.skirt_bone else "pelvis"))
        m = Matrix.Diagonal((squash, 1.0, 1.0, 1.0))
        p.cyl((0, 0, z_top), (0, 0, z_bottom), top_r, bottom_r, seg=28, m=m)
        p.ball((0, 0, z_top), top_r, scale=(1, 1, 0.5), m=m)
        return p

    def neck(self, colour, rough=0.72, name="neck"):
        p = self.P(name, colour, voxel=1.4, smooth=4, rough=rough, bones=["chest", "neck", "head"])
        p.capsule((0, 0, self.neck_z - 5), (1.0, 0, self.headpivot_z + 6 * self.hs), self.neck_r + 0.8, self.neck_r)
        return p

    # ---- head and face -----------------------------------------------------------------------------
    def head(self, colour=None, nose=("ball", 4.6), ears=True, chin=0.0, cheeks=0.0, paint=None, brow_ridge=0.0, name="head"):
        hs = self.hs
        C = self.head_c
        p = self.P(name, colour or self.skin, voxel=1.1, smooth=4, lumps=0.14, rigid="head", paint=paint)
        p.ball(self.skull_c, 1.0, scale=tuple(self.skull_r))
        p.ball(self.jaw_c, 1.0, scale=tuple(self.jaw_r))
        if chin > 0:
            p.ball(Vector((self.face_x(0, C.z - 17 * hs) - 3.5 * hs, 0, C.z - 18 * hs)), 5.2 * chin * hs, scale=(1.0, 1.25, 0.9))
        if cheeks > 0:
            for s in (1, -1):
                p.ball(self.face_pt(s * 9.5, -6.5, -4.0 * cheeks), 6.2 * cheeks * hs)
        if brow_ridge > 0:
            p.capsule(self.face_pt(-8.5, 8.5, -2.5), self.face_pt(8.5, 8.5, -2.5), 3.2 * brow_ridge * hs)
        kind, size = nose
        nz = C.z + 0.0 * hs
        base = Vector((self.face_x(0, nz) - 1.0 * hs, 0, nz))
        if kind == "ball":
            p.ball(base + Vector((size * 0.55 * hs, 0, -1.0 * hs)), size * hs)
        elif kind == "long":
            p.capsule(base + Vector((0, 0, 2.5 * hs)), base + Vector((size * 1.5 * hs, 0, -2.0 * hs)), size * 0.62 * hs, size * 0.8 * hs)
        elif kind == "hook":
            p.capsule(base + Vector((0, 0, 3.5 * hs)), base + Vector((size * 1.2 * hs, 0, -0.5 * hs)), size * 0.6 * hs, size * 0.72 * hs)
            p.ball(base + Vector((size * 1.05 * hs, 0, -2.8 * hs)), size * 0.8 * hs)
        elif kind == "button":
            p.ball(base + Vector((size * 0.5 * hs, 0, -1.5 * hs)), size * hs, scale=(1.0, 1.1, 0.85))
        elif kind == "wide":
            p.ball(base + Vector((size * 0.45 * hs, 0, -1.6 * hs)), size * hs, scale=(0.9, 1.45, 0.8))
        if ears:
            for s in (1, -1):
                p.ball(C + Vector((-1.5 * hs, s * (self.skull_r.y - 0.5 * hs), 0.5 * hs)), 5.6 * hs, scale=(0.62, 0.42, 1.0))
        return p

    def eyes(self, iris=None, lid=None, lash=False, brow=None, brow_r=1.7, white=WHITE, lid_drop=3.7):
        """Eyeballs (rigid to the head), pupils, eyelids and brows on their own bones."""
        hs = self.hs * self.eye_size
        whites = self.P("eye_white", white, raw=True, rough=0.22, rigid="head")
        for s, t in ((1, "l"), (-1, "r")):
            e = self.eye_c[s]
            whites.ball(e, 5.5 * hs, scale=(0.86, 1.0, 1.12), seg=24)
            pup = self.P("pupil_" + t, BLACK, raw=True, rough=0.12, rigid="pupil_" + t)
            pc = e + Vector((4.35 * hs, -s * 0.5 * hs, 0))
            if iris is not None:
                ir = self.P("iris_" + t, iris, raw=True, rough=0.18, rigid="pupil_" + t)
                ir.ball(pc - Vector((0.35 * hs, 0, 0)), 3.1 * hs, scale=(0.42, 1.0, 1.0), seg=22)
            pup.ball(pc, 2.3 * hs, scale=(0.5, 1.0, 1.0), seg=20)
            ld = self.P("lid_" + t, lid or shade(self.skin, 0.9), raw=True, rough=0.7, rigid="lid_" + t)
            ld.ball(e + Vector((0.5 * hs, 0, lid_drop * hs)), 6.05 * hs, scale=(0.97, 1.07, 0.62), seg=22)
            if lash:
                lc = self.P("lash_" + t, BLACK, raw=True, rough=0.5, rigid="lid_" + t)
                for k in range(3):
                    y0 = s * (2.0 + 2.2 * k) * hs
                    a = e + Vector((4.6 * hs, y0, 2.6 * hs))
                    lc.capsule(a, a + Vector((1.6 * hs, s * (0.8 + 0.5 * k) * hs, 1.9 * hs)), 0.42 * hs, 0.2 * hs, seg=6)
            br = self.P("brow_" + t, brow or self.hair_col, raw=True, rough=0.65, rigid="brow_" + t)
            inner = e + Vector((4.4 * hs, -s * 4.6 * hs, 7.3 * hs))
            outer = e + Vector((3.0 * hs, s * 5.8 * hs, 7.9 * hs))
            mid = (inner + outer) * 0.5 + Vector((0.8 * hs, 0, 0.9 * hs))
            br.tube([inner, inner.lerp(mid, 0.5) + Vector((0.2 * hs, 0, 0.3 * hs)), mid, mid.lerp(outer, 0.5) + Vector((0.1 * hs, 0, 0.15 * hs)), outer],
                    [brow_r * hs * 1.05, brow_r * hs * 1.12, brow_r * hs * 1.1, brow_r * hs * 0.92, brow_r * hs * 0.7], seg=12)
            br.ball(inner, brow_r * hs * 1.05, seg=12)
            br.ball(outer, brow_r * hs * 0.7, seg=12)

    def mouth_matrix(self):
        return Matrix.Translation(self.mouth_c) @ rot(0, 7, 0)

    def mouths(self, lip=None, teeth=TEETH):
        """The five replacement mouths, each on its own bone."""
        lip = lip or self.lip
        k = self.hs * self.mouth_scale
        M = self.mouth_matrix() @ Matrix.Scale(k, 4)

        def piece(mouth, tag, colour, rough=0.6):
            return self.P(f"mouth_{mouth}_{tag}", colour, raw=True, rough=rough, rigid="mouth_" + mouth)

        # closed: a lopsided smirk
        p = piece("closed", "lip", lip)
        pts = [(0.3, -7.6, 0.2), (0.75, -4.0, -0.75), (0.95, 0.0, -0.9), (0.8, 4.0, -0.2), (0.3, 7.6, 1.5)]
        p.tube(pts, [0.75, 1.1, 1.2, 1.1, 0.75], seg=12, m=M)
        p.ball(pts[0], 0.75, seg=8, m=M)
        p.ball(pts[-1], 0.75, seg=8, m=M)
        # grit: clenched teeth
        p = piece("grit", "lip", lip)
        p.box((0.2, 0, 0), (2.2, 16.6, 8.2), bevel=1.6, bseg=3, m=M)
        t = piece("grit", "teeth", teeth, rough=0.3)
        t.box((1.0, 0, 0), (1.9, 14.0, 5.8), bevel=0.9, bseg=2, m=M)
        g = piece("grit", "gaps", shade(lip, 0.7))
        for y in (-4.7, -2.35, 0.0, 2.35, 4.7):
            g.box((1.97, y, 0), (0.22, 0.42, 5.4), m=M)
        g.box((1.97, 0, 0), (0.22, 13.6, 0.5), m=M)
        # open: a full-throated yell
        p = piece("open", "lip", lip)
        p.torus((0.4, 0, 0), 6.4, 1.55, r3=rot(0, 90, 0), squash=1.28, seg=32, rseg=12, m=M)
        c = piece("open", "cavity", MOUTH_DARK, rough=0.8)
        c.ball((0.0, 0, 0), 1.0, scale=(1.5, 7.9, 6.1), seg=24, m=M)
        t = piece("open", "teeth", teeth, rough=0.3)
        t.box((1.05, 0, 3.9), (1.5, 10.4, 2.6), bevel=0.7, m=M)
        tg = piece("open", "tongue", TONGUE, rough=0.5)
        tg.ball((1.0, 0, -3.5), 1.0, scale=(1.5, 4.6, 2.2), seg=12, m=M)
        # ouch: a small pained "o"
        p = piece("ouch", "lip", lip)
        p.torus((0.5, 0, 0), 3.5, 1.4, r3=rot(0, 90, 0), squash=0.9, seg=24, rseg=12, m=M)
        c = piece("ouch", "cavity", MOUTH_DARK, rough=0.8)
        c.ball((0.2, 0, 0), 1.0, scale=(1.2, 3.2, 3.6), seg=12, m=M)
        # grin: a wide toothy smile (flat dark band with the teeth standing proud of it)
        ys = (-9.4, -7.6, -5.2, -2.6, 0.0, 2.6, 5.2, 7.6, 9.4)
        arc = [(0.0, y, 4.2 * (y / 9.4) ** 2 - 2.0) for y in ys]
        flat = Matrix.Diagonal((0.42, 1.0, 1.0, 1.0))
        p = piece("grin", "lip", lip)
        p.tube(arc, [1.4, 2.5, 3.2, 3.5, 3.6, 3.5, 3.2, 2.5, 1.4], seg=12, m=M @ Matrix.Translation((0.5, 0, 0)) @ flat)
        t = piece("grin", "teeth", teeth, rough=0.3)
        t.tube(arc[1:-1], [1.2, 2.0, 2.3, 2.4, 2.3, 2.0, 1.2], seg=12, m=M @ Matrix.Translation((1.35, 0, 0)) @ flat)
        g = piece("grin", "gaps", shade(lip, 0.7))
        for y in (-5.2, -2.6, 0.0, 2.6, 5.2):
            z = 4.2 * (y / 9.4) ** 2 - 2.0
            g.box((2.36, y, z), (0.2, 0.4, 4.4), m=M)

    # ---- finishing -----------------------------------------------------------------------------------
    def build(self):
        arm_ob = make_armature("Armature", self.bones())
        ob = build_skinned("SK_" + self.name, arm_ob, self.pieces)
        log("SK_" + self.name, "tris", tri_count(ob), "height", round(self.height, 1))
        return arm_ob, ob


def set_expression(arm_ob, mouth="grit", fists=True, lids=0.0, brows=0.0):
    """Pose the replacement parts for a preview render."""
    pb = arm_ob.pose.bones
    tiny = (0.001, 0.001, 0.001)
    for m in MOUTHS:
        if "mouth_" + m in pb:
            pb["mouth_" + m].scale = (1, 1, 1) if m == mouth else tiny
    for t in ("l", "r"):
        if "fist_" + t in pb:
            pb["fist_" + t].scale = (1, 1, 1) if fists else tiny
            pb["open_" + t].scale = tiny if fists else (1, 1, 1)


def pose_rotate(arm_ob, bone, axis, degrees):
    """Rotate a pose bone about a world axis through its head (for preview poses)."""
    import bpy
    pb = arm_ob.pose.bones[bone]
    head = (arm_ob.matrix_world @ pb.matrix).to_translation()
    r = Matrix.Translation(head) @ Matrix.Rotation(math.radians(degrees), 4, axis) @ Matrix.Translation(-head)
    pb.matrix = arm_ob.matrix_world.inverted() @ r @ arm_ob.matrix_world @ pb.matrix
    bpy.context.view_layer.update()


def clear_pose(arm_ob):
    import bpy
    for pb in arm_ob.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()


def fight_pose(arm_ob):
    """A guard stance used to check how the clay bends at the joints."""
    for t, s in (("l", 1), ("r", -1)):
        pose_rotate(arm_ob, "upperarm_" + t, 'X', s * 30)       # bring the arm in to the side
        pose_rotate(arm_ob, "upperarm_" + t, 'Y', -55)          # swing it forward
        pose_rotate(arm_ob, "forearm_" + t, 'Y', -95)           # bend the elbow up
    pose_rotate(arm_ob, "thigh_l", 'Y', -42)
    pose_rotate(arm_ob, "shin_l", 'Y', 60)
    pose_rotate(arm_ob, "thigh_r", 'Y', 14)
    pose_rotate(arm_ob, "shin_r", 'Y', 22)
    pose_rotate(arm_ob, "spine", 'Y', 10)
    pose_rotate(arm_ob, "chest", 'Z', 18)
    pose_rotate(arm_ob, "head", 'Z', -14)
