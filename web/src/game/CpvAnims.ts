// Port of CpvAnims.cpp: every animation in the game, sculpted pose by pose. See FCpvPose for the angle
// conventions. Characters face +X; "left" poses lead with the left side (an orthodox fighting stance).
//
// The C++ copies poses by assignment (`P b = a;`); here Copy() does that.

import { ECpvEase, ECpvFace, FCpvClip, FCpvPose } from './CpvPose';

const F = ECpvFace;
const E = ECpvEase;
const P = FCpvPose;
type P = FCpvPose;

function Copy(Pose: P): P { return Pose.Clone(); }

// ---- base poses ---------------------------------------------------------------------------------

function Guard(): P
{
  let p = new P();
  p.Pelvis(4, 26).Spine(8, 4).Chest(6, 6).Neck(4, -14).Head(2, -20);
  p.LegL(26, 6).KneeL(34).LegR(-16, 10, -10).KneeR(38);
  p.ArmL(52, 14, 28).ElbowL(112).ArmR(30, 18, 30).ElbowR(128);
  return p.Expr(F.Angry);
}

function Stand(): P
{
  let p = new P();
  p.Arms(4, 8).Elbows(14).Legs(0, 6).Knees(4);
  return p.Expr(F.Neutral).Hands(false, false);
}

function DownBack(): P
{
  let p = new P();
  p.Pelvis(-90).Floor(13).Spine(-2).Neck(6).Head(8);
  p.ArmL(8, 62).ElbowL(25).ArmR(6, 74).ElbowR(20).LegL(6, 14).KneeL(8).LegR(4, 18).KneeR(12);
  return p.Expr(F.KO).Hands(false, false);
}

function DownFront(): P
{
  let p = new P();
  p.Pelvis(90).Floor(12).Spine(-6).Head(-18, 40);
  p.ArmL(150, 40).ElbowL(60).ArmR(160, 30).ElbowR(50).LegL(-4, 12).KneeL(6).LegR(-2, 14).KneeR(10);
  return p.Expr(F.KO).Hands(false, false);
}

function ClinchA(): P
{
  let p = new P();
  p.Pelvis(8, 10).Spine(18).Chest(10).Head(4, -10);
  p.ArmL(72, 8, 20).ElbowL(55).ArmR(68, 12, 20).ElbowR(60).LegL(30, 8).KneeL(40).LegR(-20, 10).KneeR(40);
  return p.Expr(F.Effort).Hands(false, false);
}

function ClinchV(): P
{
  let p = new P();
  p.Pelvis(10, -10).Spine(24).Chest(12).Head(14, 10);
  p.ArmL(80, 16, 20).ElbowL(50).ArmR(76, 14, 20).ElbowR(46).LegL(-18, 10).KneeL(42).LegR(28, 8).KneeR(40);
  return p.Expr(F.Effort).Hands(false, false);
}

function RunA(): P
{
  let p = new P();
  p.Pelvis(14).Spine(10).Chest(6).Head(-16);
  p.LegL(55).KneeL(35).LegR(-35).KneeR(72).ArmL(-40, 10).ElbowL(85).ArmR(50, 10).ElbowR(85);
  return p.Expr(F.Effort);
}

function Sit(): P
{
  let p = new P();
  p.Floor(57).Spine(6).Chest(4);
  p.Legs(84, 8).Knees(86).ArmL(42, 12, 10).ElbowL(72).ArmR(42, 12, 10).ElbowR(72);
  return p.Expr(F.Neutral).Hands(false, false);
}

function RefWatch(): P
{
  let p = new P();
  p.Pelvis(8).Spine(24).Chest(12).Neck(-12).Head(-14);
  p.LegL(40, 14).KneeL(60).LegR(36, 14).KneeR(58).ArmL(46, 10, 20).ElbowL(36).ArmR(46, 10, 20).ElbowR(36);
  return p.Expr(F.Neutral).Hands(false, false);
}

function Hold(Pose: P, Length = 1): FCpvClip
{
  const C = new FCpvClip();
  C.Key(0, Pose).Key(Length, Pose);
  return C;
}

function BuildClips(M: Map<string, FCpvClip>): void
{
  const G = Copy(Guard());
  const S = Copy(Stand());

  // ================= stance and movement =================
  // A lateral press, one lifted shoulder and the official down at mat level.
  {
    let cover = new P();
    cover.Floor(35).Pelvis(58).Spine(28).Chest(9).Head(-38, 13);
    cover.LegL(28, 24).KneeL(101).LegR(-32, 34).KneeR(67);
    cover.ArmL(73, 18, 12).ElbowL(89).ArmR(54, 28).ElbowR(64).Expr(F.Effort).Hands(false, false);
    let tuck = Copy(DownBack()); tuck.LegL(86, 16).KneeL(106).ArmR(35, 45).ElbowR(56).Head(9, -22).Expr(F.Hurt);
    let raised = Copy(RefWatch()); raised.Floor(39).Pelvis(26).Spine(24).Legs(61, 19).Knees(104);
    raised.ArmR(147, 26).ElbowR(35).ArmL(51, 32).ElbowL(55);
    let slap = Copy(raised); slap.Spine(47).ArmR(26, 21).ElbowR(12).Hands(false, false);
    M.set("PinCover", Hold(cover));
    M.set("PinShoulders", Hold(tuck));
    M.set("RefCount", new FCpvClip().Key(0, raised).Key(0.58, raised).Key(0.76, slap, E.In).Key(0.86, slap).Key(1, raised));
  }

  {
    let b = Copy(G);
    b.KneeL(42).KneeR(46).ArmL(56, 14, 28).ElbowL(108).ArmR(34, 18, 30).ElbowR(124).Spine(11, 4);
    M.set("Idle", new FCpvClip().Key(0, G).Key(0.45, b).Key(0.9, G).Loop());
  }
  {
    let a = Copy(G), b = Copy(G);
    a.LegL(38, 6).KneeL(22).LegR(-24, 10, -10).KneeR(30);
    b.LegL(14, 6).KneeL(46).LegR(-4, 10, -10).KneeR(48).Spine(10, 4);
    M.set("Walk", new FCpvClip().Key(0, a).Key(0.18, b).Key(0.36, a).Loop());
  }
  {
    const a = Copy(RunA()), b = Copy(RunA().Mirrored());
    M.set("Run", new FCpvClip().Key(0, a, E.Linear).Key(0.16, b, E.Linear).Key(0.32, a, E.Linear).Loop());
  }
  {
    let a = Copy(RunA()), b = Copy(RunA().Mirrored());
    for (const p of [a, b]) { p.Pelvis(-8).Spine(-8).Chest(-6).Head(-8); p.Expr(F.Shock).Hands(false, false); }
    a.ArmL(40, 60).ElbowL(30).ArmR(120, 40).ElbowR(30);
    b.ArmL(120, 40).ElbowL(30).ArmR(40, 60).ElbowR(30);
    M.set("WhipRun", new FCpvClip().Key(0, a, E.Linear).Key(0.15, b, E.Linear).Key(0.3, a, E.Linear).Loop());
  }
  {
    let d = Copy(G);
    d.Pelvis(-10, 26).Spine(-12, 4).Chest(-8, 6).Head(8, -20).LegL(40, 8).KneeL(58).LegR(-26, 10, -10).KneeR(62);
    d.ArmL(40, 20, 28).ElbowL(100).ArmR(22, 24, 30).ElbowR(110);
    M.set("Dodge", new FCpvClip().Key(0, G).Key(0.08, d, E.Out).Key(0.2, d).Key(0.34, G));
  }
  {
    let a = new P(), b = new P(), c = new P();
    a.Pelvis(60).Floor(36).Spine(40).Chest(30).Head(40).Legs(100, 10).Knees(130).Arms(60, 10).Elbows(100);
    b = Copy(a); b.Pelvis(200).Floor(26);
    c = Copy(a); c.Pelvis(320).Floor(36);
    let end = Copy(G); end.Pelvis(364, 26);
    M.set("Roll", new FCpvClip().Key(0, G).Key(0.1, a, E.Out).Key(0.24, b, E.Linear).Key(0.38, c, E.Linear).Key(0.52, end, E.Out));
  }
  {
    let a = Copy(S), b = Copy(S);
    a.Pelvis(-4).Chest(-8).Head(-10).LegL(30, 6).KneeL(10).LegR(-22, 6).KneeR(26).ArmL(-30, 22).ElbowL(20).ArmR(36, 22).ElbowR(30);
    b = Copy(a.Mirrored());
    a.Expr(F.Smug); b.Expr(F.Smug);
    M.set("Strut", new FCpvClip().Key(0, a).Key(0.36, b).Key(0.72, a).Loop());
  }

  // ================= strikes =================
  {
    let ext = Copy(G);
    ext.Pelvis(6, 34).Spine(10, 8).Chest(8, 14).Neck(4, -18).Head(2, -34);
    ext.ArmL(86, 4, 20).ElbowL(4).LegL(32, 6).KneeL(38).Expr(F.Attack);
    let half = Copy(FCpvPose.Blend(G, ext, 0.4));
    M.set("Jab", new FCpvClip().Key(0, G).Key(0.05, half, E.In).Key(0.1, ext, E.Out).Key(0.17, ext).Key(0.3, G));
  }
  {
    let load = Copy(G), ext = Copy(G);
    load.Chest(6, 18).ArmR(20, 22, 30).ElbowR(132);
    ext.Pelvis(6, -8).Spine(12, -14).Chest(8, -24).Neck(4, 14).Head(2, 20);
    ext.ArmR(88, 6, 20).ElbowR(4).ArmL(40, 20, 28).ElbowL(125).LegR(-24, 10, -25).KneeR(30).LegL(30, 6).KneeL(40).Expr(F.Attack);
    M.set("Cross", new FCpvClip().Key(0, G).Key(0.08, load).Key(0.16, ext, E.Out).Key(0.24, ext).Key(0.42, G));
  }
  {
    let low = Copy(G), up = Copy(G);
    low.Pelvis(10, 10).Spine(22).Chest(10, 10).Head(-10, -10).LegL(40, 8).KneeL(70).LegR(-10, 12).KneeR(75);
    low.ArmR(-10, 14, 10).ElbowR(95).ArmL(45, 16, 28).ElbowL(120).Expr(F.Effort);
    up.Pelvis(-6, -10).Spine(-10, -10).Chest(-8, -16).Head(-18, 22).LegL(18, 6).KneeL(10).LegR(-8, 8).KneeR(12);
    up.ArmR(128, 10, 30).ElbowR(55).ArmL(20, 22, 20).ElbowL(110).Expr(F.Attack);
    M.set("Uppercut", new FCpvClip().Key(0, G).Key(0.12, low).Key(0.22, up, E.Out).Key(0.34, up).Key(0.56, G));
  }
  {
    let wind = Copy(G), swing = Copy(G), follow = Copy(G);
    wind.Pelvis(0, 50).Spine(-6, 16).Chest(-8, 24).Neck(0, -30).Head(0, -52);
    wind.ArmR(-35, 55, 0).ElbowR(75).ArmL(60, 20, 20).ElbowL(60).LegL(30, 6).KneeL(30).LegR(-22, 12).KneeR(42).Expr(F.Effort);
    let wind2 = Copy(wind); wind2.ArmR(-45, 60, 0).ElbowR(85).Chest(-10, 28);
    swing.Pelvis(10, -20).Spine(18, -22).Chest(12, -30).Neck(0, 26).Head(0, 40);
    swing.ArmR(82, 25, 30).ElbowR(18).ArmL(10, 30, 10).ElbowL(100).LegL(40, 6).KneeL(52).LegR(-30, 10, -20).KneeR(25).Expr(F.Attack);
    follow = Copy(swing); follow.Chest(14, -52).ArmR(70, -25, 40).ElbowR(45).Head(0, 60);
    M.set("Haymaker", new FCpvClip().Key(0, G).Key(0.2, wind).Key(0.36, wind2).Key(0.46, swing, E.Out).Key(0.58, follow, E.Out).Key(0.95, G));
  }
  {
    let chamber = Copy(G), ext = Copy(G);
    chamber.Pelvis(-4, 10).Spine(-6).LegR(70, 5).KneeR(100).LegL(8, 6).KneeL(18).ArmL(20, 45).ElbowL(60).ArmR(10, 50).ElbowR(60);
    ext.Pelvis(-14, 6).Spine(-12).Chest(-6).Head(14, -6).LegR(98, 4).KneeR(4).AnkleR(20).LegL(6, 6).KneeL(12);
    ext.ArmL(30, 50).ElbowL(50).ArmR(-10, 55).ElbowR(40).Expr(F.Attack);
    M.set("Boot", new FCpvClip().Key(0, G).Key(0.14, chamber).Key(0.24, ext, E.Out).Key(0.34, ext).Key(0.5, chamber).Key(0.68, G));
  }
  {
    let run = Copy(RunA()), hit = Copy(RunA()), stum = Copy(G);
    run.Chest(6, -24).ArmR(20, 95).ElbowR(8).Expr(F.Attack);
    hit.Pelvis(10, 20).Chest(8, 40).ArmR(62, 70).ElbowR(10).LegL(-30).KneeL(40).LegR(50).KneeR(30).Expr(F.Attack);
    stum.Pelvis(16, 30).Spine(20, 10);
    M.set("Clothesline", new FCpvClip().Key(0, run).Key(0.15, hit, E.Out).Key(0.4, stum).Key(0.6, G));
  }
  {
    let jump = new P(), ext = new P(), fall = new P(), crouch = new P();
    jump.Pelvis(-30).Air(25).Legs(60, 6).Knees(80).Arms(40, 40).Elbows(40).Expr(F.Effort);
    ext.Pelvis(-80).Air(30).Spine(10).Head(30).Legs(95, 4).Knees(5).Arms(30, 60).Elbows(20).Expr(F.Attack);
    fall.Pelvis(-90).Floor(14).Head(10).Legs(30, 12).Knees(20).Arms(20, 60).Elbows(20).Expr(F.Effort);
    crouch.Pelvis(15, 20).Spine(25).Chest(10).LegL(75, 10).KneeL(110).LegR(60, 12).KneeR(115).Arms(40, 10).Elbows(60);
    M.set("Dropkick", new FCpvClip().Key(0, RunA()).Key(0.12, jump, E.Out).Key(0.26, ext, E.Out).Key(0.4, ext)
      .Key(0.58, fall, E.In).Key(0.85, fall).Key(1.2, crouch).Key(1.45, G));
  }
  {
    let up = Copy(G), down = Copy(G);
    up.Pelvis(-4, 10).Spine(-6).LegR(85, 8).KneeR(110).LegL(6, 6).KneeL(14).Arms(30, 40).Elbows(70).Expr(F.Effort);
    down.Pelvis(10, 10).Spine(18).Head(20, -10).LegR(40, 6).KneeR(8).LegL(-6, 6).KneeL(26).Arms(20, 30).Elbows(50).Expr(F.Attack);
    M.set("Stomp", new FCpvClip().Key(0, G).Key(0.16, up).Key(0.26, down, E.In).Key(0.36, down).Key(0.55, G));
  }
  {
    let crouch = Copy(G), jump = new P(), flop = new P(), push = new P();
    crouch.Pelvis(10, 0).Spine(20).Legs(50, 12).Knees(92).Arms(-30, 20).Elbows(30).Expr(F.Effort);
    jump.Pelvis(20).Air(70).Arms(150, 40).Elbows(10).Legs(-20, 20).Knees(30).Expr(F.Attack);
    flop.Pelvis(85).Floor(26, 60).Head(-20).Arms(110, 60).Elbows(10).Legs(-10, 30).Knees(8).Expr(F.Attack);
    let bounce = Copy(flop); bounce.Floor(34, 60);
    push.Pelvis(40).Floor(44, 28).Spine(-10).Arms(60, 20).Elbows(20).Legs(40, 14).Knees(100);
    M.set("Splash", new FCpvClip().Key(0, G).Key(0.2, crouch).Key(0.4, jump, E.Out).Key(0.6, flop, E.In).Key(0.72, bounce, E.Out)
      .Key(0.9, flop, E.In).Key(1.3, push).Key(1.6, G));
  }
  {
    let wind = Copy(G), swing = Copy(G), follow = Copy(G);
    wind.Pelvis(2, 40).Chest(0, 50).Head(0, -70).ArmR(20, 70, -30).ElbowR(60).Expr(F.Effort);
    swing.Pelvis(8, -6).Chest(8, -40).Head(0, 30).ArmR(78, 20, 20).ElbowR(12).LegL(36, 6).KneeL(46).Expr(F.Attack);
    follow = Copy(swing); follow.Chest(10, -58).ArmR(60, -32, 20).ElbowR(42).Head(0, 46);
    M.set("WeaponSwing", new FCpvClip().Key(0, G).Key(0.14, wind).Key(0.24, swing, E.Out).Key(0.34, follow, E.Out).Key(0.62, G));
  }
  {
    let up = Copy(G), down = Copy(G);
    up.Pelvis(-6, 6).Spine(-18).Chest(-12).Head(-12, 0).Arms(165, 8).Elbows(40).LegL(20, 8).KneeL(16).LegR(-10, 10).KneeR(20).Expr(F.Effort);
    down.Pelvis(14, 6).Spine(42).Chest(22).Head(10, 0).Arms(48, 6).Elbows(8).LegL(40, 8).KneeL(56).LegR(-20, 10).KneeR(40).Expr(F.Attack);
    M.set("WeaponSmash", new FCpvClip().Key(0, G).Key(0.24, up).Key(0.36, down, E.In).Key(0.5, down).Key(0.86, G));
  }
  {
    let wind = Copy(G), rel = Copy(G), follow = Copy(G);
    wind.Pelvis(0, 46).Chest(-6, 50).Head(0, -76).ArmR(-30, 70, -40).ElbowR(95).ArmL(70, 10).ElbowL(20).Expr(F.Effort);
    rel.Pelvis(8, -10).Spine(20, -10).Chest(10, -30).Head(0, 30).ArmR(100, 15, 20).ElbowR(10).ArmL(20, 30).ElbowL(70).Expr(F.Attack).Hands(true, false);
    follow = Copy(rel); follow.ArmR(50, -10).ElbowR(20).Chest(14, -44).Head(0, 44);
    M.set("Throw", new FCpvClip().Key(0, G).Key(0.2, wind).Key(0.32, rel, E.Out).Key(0.45, follow, E.Out).Key(0.78, G));
  }
  {
    let bend = Copy(G);
    bend.Pelvis(20, 10).Spine(55).Chest(25).Head(10, -10).Legs(45, 12).Knees(72).ArmR(50, 5).ElbowR(10).ArmL(20, 20).ElbowL(60).Hands(true, false);
    M.set("Pickup", new FCpvClip().Key(0, G).Key(0.15, bend).Key(0.3, bend).Key(0.5, G));
  }

  // ================= grapples =================
  {
    let lunge = Copy(G), clasp = Copy(G);
    lunge.Pelvis(12, 10).Spine(22).Chest(12).Head(-6, -10).ArmL(70, 25, 10).ElbowL(30).ArmR(64, 28, 10).ElbowR(34);
    lunge.LegL(44, 8).KneeL(50).LegR(-28, 10).KneeR(30).Expr(F.Effort).Hands(false, false);
    clasp = Copy(lunge); clasp.Arms(74, 4, 20).Elbows(48);
    M.set("GrabTry", new FCpvClip().Key(0, G).Key(0.1, lunge, E.Out).Key(0.22, clasp).Key(0.42, G));
  }
  {
    let a = Copy(ClinchA()), b = Copy(ClinchA());
    b.Spine(22, 0, 5).Chest(12, 0, 4).ArmL(76, 10, 20).ElbowL(50);
    M.set("ClinchA", new FCpvClip().Key(0, a).Key(0.3, b).Key(0.6, a).Loop());
    let c = Copy(ClinchV()), d = Copy(ClinchV());
    d.Spine(20, 0, -6).Chest(14, 0, -4).Head(10, 10);
    M.set("ClinchV", new FCpvClip().Key(0, c).Key(0.3, d).Key(0.6, c).Loop());
  }
  {
    let back = Copy(ClinchA()), slam = Copy(ClinchA());
    back.Spine(-12).Chest(-10).Neck(-20).Head(-25).Expr(F.Effort);
    slam.Spine(34).Chest(16).Neck(14).Head(20).Expr(F.Attack);
    M.set("Headbutt", new FCpvClip().Key(0, ClinchA()).Key(0.14, back).Key(0.22, slam, E.In).Key(0.32, slam).Key(0.6, G));
    let hurt = Copy(ClinchV());
    hurt.Spine(-16).Chest(-12).Neck(-20).Head(-30).Arms(60, 60).Elbows(30).Expr(F.Hurt);
    M.set("HeadbuttV", new FCpvClip().Key(0, ClinchV()).Key(0.21, ClinchV()).Key(0.24, hurt, E.Out).Key(0.6, hurt));
  }
  {
    let scoop = Copy(ClinchA()), lift = Copy(ClinchA()), slam = Copy(ClinchA());
    scoop.Pelvis(20).Spine(40).Chest(20).Legs(60, 14).Knees(95).ArmL(40, 10).ElbowL(30).ArmR(60, 10).ElbowR(40);
    lift.Pelvis(-6).Spine(-14).Chest(-10).Head(-10).Legs(10, 14).Knees(15).Arms(150, 20).Elbows(25);
    let lift2 = Copy(lift); lift2.Knees(26).Arms(156, 20);
    slam.Pelvis(30).Spine(50).Chest(25).Head(10).Legs(50, 14).Knees(80).Arms(60, 15).Elbows(15).Expr(F.Attack);
    M.set("SlamA", new FCpvClip().Key(0, ClinchA()).Key(0.18, scoop).Key(0.45, lift, E.Out).Key(0.65, lift2).Key(0.8, slam, E.In)
      .Key(1.0, slam).Key(1.25, G));
    // The victim's offsets are in their own frame: +X is toward the attacker, who stands ~62 cm away.
    let v1 = Copy(ClinchV()), v2 = new P(), v3 = new P(), v4 = new P();
    v1.Pelvis(-40).Air(0, 25).Spine(-10).Arms(40, 50).Elbows(30).Legs(30, 10).Knees(40).Expr(F.Shock);
    v2.Pelvis(-90).Air(128, 62).Spine(-8).Head(-10).Arms(30, 70).Elbows(20).LegL(20, 20).KneeL(30).LegR(40, 16).KneeR(50).Expr(F.Shock).Hands(false, false);
    let v2b = Copy(v2); v2b.Air(134, 62).LegL(40, 20).LegR(20, 16);
    v3.Pelvis(-90).Floor(13, 12).Head(10).Arms(20, 70).Elbows(15).Legs(25, 14).Knees(20).Expr(F.Hurt).Hands(false, false);
    let v3b = Copy(v3); v3b.Floor(24, 12).Legs(40, 16);
    v4 = Copy(DownBack()); v4.Root = v4.Root.WithX(12);
    M.set("SlamV", new FCpvClip().Key(0, ClinchV()).Key(0.18, v1).Key(0.45, v2, E.Out).Key(0.65, v2b).Key(0.8, v3, E.In)
      .Key(0.9, v3b, E.Out).Key(1.05, v4, E.In).Key(1.25, v4));
  }
  {
    let pull = Copy(ClinchA()), fling = Copy(G);
    pull.Chest(10, 40).ArmR(60, 40).ElbowR(70).ArmL(80, -10).ElbowL(30);
    fling.Pelvis(8, -10).Spine(20, -10).Chest(10, -46).Head(0, 40).ArmL(85, 20).ElbowL(5).ArmR(50, 30).ElbowR(60).Expr(F.Attack).Hands(false, true);
    M.set("WhipA", new FCpvClip().Key(0, ClinchA()).Key(0.15, pull).Key(0.32, fling, E.Out).Key(0.6, G));
  }
  {
    let push = Copy(ClinchA()), back = Copy(G);
    push.Spine(26).Arms(82, 10).Elbows(8).Expr(F.Attack);
    back.Pelvis(-8, 26).Spine(-10).Arms(50, 40).Elbows(40).LegL(34, 8).KneeL(20).Expr(F.Hurt);
    M.set("ShoveA", new FCpvClip().Key(0, ClinchA()).Key(0.1, push, E.Out).Key(0.4, G));
    M.set("ShoveV", new FCpvClip().Key(0, ClinchV()).Key(0.1, back, E.Out).Key(0.45, G));
  }

  // ================= reactions =================
  {
    let hit = Copy(G), more = Copy(G);
    hit.Pelvis(-6, 26).Spine(-14, 4).Chest(-12, 6).Neck(-18, -10).Head(-30, -12).ArmL(30, 35, 10).ElbowL(70).ArmR(15, 35, 10).ElbowR(80).Expr(F.Hurt);
    more = Copy(hit); more.Spine(-18, 4).Head(-36, -8).ArmL(36, 44, 10);
    M.set("HitHigh", new FCpvClip().Key(0, hit).Key(0.1, more, E.Out).Key(0.34, G));
  }
  {
    let hit = Copy(G);
    hit.Pelvis(8, 26).Spine(40).Chest(26).Neck(10).Head(20, -20).ArmL(30, 5, 40).ElbowL(100).ArmR(30, 5, 40).ElbowR(100);
    hit.LegL(30, 6).KneeL(45).LegR(-10, 10).KneeR(50).Expr(F.Hurt);
    let more = Copy(hit); more.Spine(46).Head(26, -20);
    M.set("HitGut", new FCpvClip().Key(0, hit).Key(0.14, more, E.Out).Key(0.44, G));
  }
  {
    let a = Copy(G), b = Copy(G), c = Copy(G);
    a.Pelvis(-14, 20).Spine(-16).Chest(-10).Head(-20, -10).Arms(70, 50).Elbows(40).LegL(40, 8).KneeL(20).LegR(-20, 10).KneeR(30).Expr(F.Hurt);
    b.Pelvis(-10, 22).Spine(-10).Head(-10, -14).ArmL(140, 30).ElbowL(20).ArmR(20, 60).ElbowR(30).LegL(-10, 8).KneeL(40).LegR(30, 10).KneeR(15).Expr(F.Hurt);
    c.Pelvis(-4, 24).Spine(0).ArmL(60, 40).ElbowL(60).ArmR(90, 40).ElbowR(40).LegL(34, 8).KneeL(30).LegR(-14, 10).KneeR(36).Expr(F.Hurt);
    M.set("Stagger", new FCpvClip().Key(0, a).Key(0.2, b).Key(0.4, c).Key(0.62, G));
  }
  {
    let a = Copy(G), air = new P(), land = new P(), bounce = new P();
    a.Pelvis(-25, 10).Spine(-20).Arms(80, 40).Elbows(30).LegL(30, 6).KneeL(30).LegR(0, 10).KneeR(40).Expr(F.Hurt);
    air.Pelvis(-65).Floor(44).Spine(-10).Head(-10).Arms(100, 50).Elbows(20).Legs(50, 12).Knees(40).Expr(F.Hurt).Hands(false, false);
    land.Pelvis(-90).Floor(13).Head(10).Arms(20, 70).Elbows(15).Legs(20, 12).Knees(15).Expr(F.Hurt).Hands(false, false);
    bounce = Copy(land); bounce.Floor(21).Legs(36, 14).Arms(40, 70);
    M.set("KnockDown", new FCpvClip().Key(0, a).Key(0.18, air, E.Out).Key(0.36, land, E.In).Key(0.46, bounce, E.Out).Key(0.62, DownBack(), E.In));
    M.set("DownBack", Hold(DownBack()));
    M.set("DownFront", Hold(DownFront()));
    M.set("Land", new FCpvClip().Key(0, land).Key(0.1, bounce, E.Out).Key(0.26, DownBack(), E.In));
  }
  {
    let sit = new P(), crouch = new P();
    sit.Pelvis(-40).Floor(18).Spine(40).Chest(20).Head(10).Arms(50, 20).Elbows(40).Legs(70, 15).Knees(100).Expr(F.Effort);
    crouch.Pelvis(15, 20).Spine(25).Chest(10).LegL(75, 10).KneeL(110).LegR(60, 12).KneeR(115).Arms(40, 10).Elbows(60).Expr(F.Effort);
    M.set("GetUp", new FCpvClip().Key(0, DownBack()).Key(0.25, sit).Key(0.5, crouch).Key(0.8, G));
    let push = new P();
    push.Pelvis(60).Floor(30).Spine(-20).Head(-20).Arms(70, 20).Elbows(30).Legs(40, 14).Knees(90).Expr(F.Effort);
    M.set("GetUpFront", new FCpvClip().Key(0, DownFront()).Key(0.25, push).Key(0.5, crouch).Key(0.8, G));
  }
  {
    let a = new P(), b = new P(), c = new P();
    a.Pelvis(-60).Floor(48).Arms(120, 50).Elbows(20).LegL(40, 25).KneeL(50).LegR(10, 25).KneeR(30).Expr(F.Shock).Hands(false, false);
    b = Copy(a); b.Pelvis(-240).ArmL(60, 70).ArmR(150, 40).LegL(10, 25).KneeL(20).LegR(50, 25).KneeR(60);
    c = Copy(a); c.Pelvis(-420);
    M.set("AirFlail", new FCpvClip().Key(0, a, E.Linear).Key(0.3, b, E.Linear).Key(0.6, c, E.Linear).Loop());
  }
  {
    let blk = Copy(G), hit = Copy(G);
    blk.Pelvis(6, 24).Spine(16, 4).Chest(10, 4).Neck(8, -12).Head(10, -16).ArmL(78, -6, 35).ElbowL(132).ArmR(72, -2, 35).ElbowR(138);
    blk.LegL(26, 6).KneeL(40).LegR(-16, 10).KneeR(44).Expr(F.Effort);
    hit = Copy(blk); hit.Pelvis(-2, 24).Spine(6, 4).ArmL(70, -6, 35).ArmR(64, -2, 35).KneeL(30);
    M.set("Block", new FCpvClip().Key(0, blk).Key(0.5, blk).Loop());
    M.set("BlockHit", new FCpvClip().Key(0, hit).Key(0.1, hit).Key(0.22, blk));
  }
  {
    let a = new P(), b = new P();
    a.Pelvis(4, 10, 6).Spine(6, 0, 10).Chest(4, 0, 8).Head(10, 10, 14).Arms(6, 10).Elbows(14).LegL(10, 8).KneeL(24).LegR(-4, 10).KneeR(26);
    b.Pelvis(2, -6, -6).Spine(8, 0, -10).Chest(0, 0, -8).Head(-6, -12, -12).Arms(2, 14).Elbows(10).LegL(4, 10).KneeL(28).LegR(6, 8).KneeR(22);
    a.Expr(F.Dazed).Hands(false, false); b.Expr(F.Dazed).Hands(false, false);
    M.set("Dazed", new FCpvClip().Key(0, a).Key(0.7, b).Key(1.4, a).Loop());
    let buckle = new P(), fall = new P();
    buckle.Pelvis(20).Spine(20).Head(20).Arms(10, 15).Elbows(10).Legs(50, 10).Knees(120).Expr(F.KO).Hands(false, false);
    fall.Pelvis(70).Floor(22).Spine(10).Arms(120, 30).Elbows(30).Legs(10, 12).Knees(40).Expr(F.KO).Hands(false, false);
    let df = Copy(DownFront()), dfb = Copy(DownFront());
    dfb.Floor(18);
    M.set("Collapse", new FCpvClip().Key(0, a).Key(0.25, buckle, E.In).Key(0.5, fall, E.In).Key(0.62, df, E.In).Key(0.74, dfb, E.Out).Key(0.9, df, E.In));
  }
  {
    let arch = new P(), more = new P(), fwd = Copy(RunA());
    arch.Pelvis(-12).Spine(-20).Chest(-16).Head(-20).Arms(20, 80).Elbows(20).Legs(20, 10).Knees(20).Expr(F.Hurt).Hands(false, false);
    more = Copy(arch); more.Spine(-28).Chest(-20).Arms(30, 88);
    M.set("RopeBounce", new FCpvClip().Key(0, arch).Key(0.16, more, E.Out).Key(0.34, fwd, E.In));
  }

  // ================= signature moves =================
  {
    let inhale = Copy(G), yell = Copy(G), yell2 = new P();
    inhale.Pelvis(-4, 6).Spine(-18).Chest(-14).Head(-20, -6).Arms(-20, 35).Elbows(40).Expr(F.Effort);
    yell.Pelvis(10, 0).Spine(30).Chest(16).Head(-8, 0).Arms(-35, 40).Elbows(20).LegL(30, 14).KneeL(40).LegR(-20, 14).KneeR(40).Expr(F.Attack);
    yell2 = Copy(yell); yell2.Spine(34).Head(-4, 0).Arms(-42, 46);
    M.set("SpecScream", new FCpvClip().Key(0, G).Key(0.25, inhale).Key(0.4, yell, E.Out).Key(0.55, yell2).Key(0.7, yell).Key(0.85, yell2)
      .Key(1.0, yell).Key(1.3, G));
  }
  {
    let look = Copy(G), zap = Copy(G);
    look.Pelvis(2, 10).ArmR(60, 10, 30).ElbowR(120).Head(22, 4).ArmL(10, 20).ElbowL(40).Expr(F.Smug);
    zap.Pelvis(4, -10).Chest(6, -25).Head(0, 30).ArmR(90, 0, 10).ElbowR(0).ArmL(-10, 30).ElbowL(50).LegL(30, 8).KneeL(30).Expr(F.Smug).Hands(true, false);
    let zap2 = Copy(zap); zap2.ArmR(92, 2, 10).Chest(8, -27);
    M.set("SpecZap", new FCpvClip().Key(0, G).Key(0.2, look).Key(0.35, zap, E.Out).Key(0.6, zap2).Key(0.9, zap).Key(1.15, G));
  }
  {
    let crouch = Copy(G), jump = new P(), land = new P();
    crouch.Pelvis(10, 0).Spine(22).Legs(52, 14).Knees(96).Arms(-20, 20).Elbows(40).Expr(F.Effort);
    jump.Air(95).Pelvis(-10).Spine(-10).Arms(170, 20).Elbows(10).Legs(70, 15).Knees(110).Expr(F.Attack);
    land.Pelvis(20, 0).Spine(40).Chest(20).Head(-20).Legs(70, 20).Knees(112).Arms(40, 30).Elbows(10).Expr(F.Attack);
    M.set("SpecSlam", new FCpvClip().Key(0, G).Key(0.25, crouch).Key(0.45, jump, E.Out).Key(0.65, land, E.In).Key(0.9, land).Key(1.2, G));
  }
  {
    let a = Copy(G), b = new P();
    a.Pelvis(-8, 30).Spine(-14).Chest(-8).Head(-10, -30).LegL(20, 25).KneeL(30).LegR(-10, 25).KneeR(30);
    a.ArmL(60, 40, 0).ElbowL(60).ArmR(30, 10, 30).ElbowR(95).Expr(F.Attack).Hands(false, true);
    b = Copy(a); b.ArmR(10, 12, 30).ElbowR(70).Spine(-6).Head(6, -30);
    M.set("SpecStrum", new FCpvClip().Key(0, G).Key(0.2, a).Key(0.32, b, E.In).Key(0.46, a).Key(0.58, b, E.In).Key(0.72, a).Key(0.84, b, E.In)
      .Key(1.0, a).Key(1.25, G));
  }
  {
    let a = Copy(G), b = new P();
    a.Pelvis(-6, 0).Spine(-10).Head(-6, 0).ArmL(82, 22, 0).ElbowL(24).ArmR(86, 14, 0).ElbowR(18).LegL(20, 12).KneeL(26).LegR(-12, 12).KneeR(26);
    a.Expr(F.Effort).Hands(false, false);
    b = Copy(a); b.ArmL(90, 10, 0).ElbowL(14).ArmR(78, 26, 0).ElbowR(30).Spine(-4);
    M.set("SpecCast", new FCpvClip().Key(0, G).Key(0.2, a).Key(0.4, b).Key(0.6, a).Key(0.8, b).Key(1.0, a).Key(1.25, G));
  }

  // ================= showmanship =================
  {
    let flex = Copy(S), pump = new P();
    flex.Pelvis(-4).Spine(-8).Chest(-10).Head(-10).ArmL(0, 92, -90).ElbowL(112).ArmR(0, 92, -90).ElbowR(112).LegL(8, 14).KneeL(12).LegR(-4, 14).KneeR(12);
    flex.Expr(F.Happy).Hands(true, true);
    pump = Copy(flex); pump.Elbows(128).Chest(-14).Knees(22);
    M.set("TauntFlex", new FCpvClip().Key(0, G).Key(0.25, flex, E.Over).Key(0.5, pump).Key(0.75, flex).Key(1.0, pump).Key(1.3, G));
  }
  {
    let a = Copy(S), b = new P();
    a.Pelvis(-4, 40).Spine(-6).Head(-12, -30).ArmR(165, 16).ElbowR(6).ArmL(8, 38, 40).ElbowL(96).LegL(10, 12).KneeL(10).LegR(-6, 14).KneeR(14);
    a.Expr(F.Happy).Hands(false, true);
    b = Copy(a); b.ArmR(172, 26).Pelvis(-4, 40, 8).Knees(22);
    M.set("TauntPoint", new FCpvClip().Key(0, G).Key(0.25, a, E.Over).Key(0.55, b).Key(0.85, a).Key(1.15, b).Key(1.4, G));
  }
  {
    let a = Copy(S), b = new P();
    a.Pelvis(0, 10, 10).Spine(0, 0, -8).Head(0, -10, 6).ArmR(150, 20).ElbowR(30).ArmL(40, 20).ElbowL(100).LegL(14, 12).KneeL(30).LegR(-8, 12).KneeR(10);
    a.Expr(F.Happy);
    b = Copy(a.Mirrored()); b.Pelvis(0, 10, -10);
    M.set("TauntDance", new FCpvClip().Key(0, G).Key(0.2, a).Key(0.45, b).Key(0.7, a).Key(0.95, b).Key(1.2, a).Key(1.45, G));
  }
  {
    let a = Copy(S), b = new P();
    a.Pelvis(-6, 20).Spine(-8).Neck(-8).Head(-10, -20).ArmR(40, 30, -20).ElbowR(122).WristR(0, 25).ArmL(6, 14, 30).ElbowL(70);
    a.LegL(6, 8).KneeL(6).LegR(-2, 8).KneeR(6).Expr(F.Smug).Hands(true, false);
    b = Copy(a); b.WristR(0, -25).ElbowR(116);
    M.set("TauntWave", new FCpvClip().Key(0, G).Key(0.3, a).Key(0.5, b).Key(0.7, a).Key(0.9, b).Key(1.1, a).Key(1.4, G));
  }
  {
    let a = Copy(S), b = new P();
    a.Pelvis(-2, 20).Head(6, -20).ArmR(70, 5, 40).ElbowR(142).ArmL(10, 30, 30).ElbowL(90).Legs(4, 10).Knees(8).Expr(F.Smug).Hands(true, false);
    b = Copy(a); b.ArmR(84, 44, 0).ElbowR(26).Head(-12, -20).Spine(-8).Expr(F.Happy);
    M.set("TauntKiss", new FCpvClip().Key(0, G).Key(0.3, a).Key(0.55, a).Key(0.7, b, E.Over).Key(1.1, b).Key(1.4, G));
  }
  {
    let a = Copy(S), b = new P();
    a.Pelvis(-2, 30).Head(26, -24).ArmR(45, 5, 30).ElbowR(112).ArmL(4, 12, 20).ElbowL(30).Legs(2, 8).Knees(6).Expr(F.Smug).Hands(true, false);
    b = Copy(a); b.Head(22, -20).WristR(10, 10);
    M.set("TauntPhone", new FCpvClip().Key(0, G).Key(0.3, a).Key(0.6, b).Key(0.9, a).Key(1.2, b).Key(1.5, G));
  }
  {
    let a = Copy(S), b = new P();
    a.Pelvis(4, 20).Spine(10).Head(24, -20).ArmR(165, 15).ElbowR(8).ArmL(30, 30).ElbowL(60).LegL(20, 16).KneeL(30).LegR(-10, 16).KneeR(30).Expr(F.Attack);
    b = Copy(a); b.Spine(-8).Head(-22, -20).ArmR(158, 22);
    M.set("TauntRock", new FCpvClip().Key(0, G).Key(0.2, a).Key(0.35, b).Key(0.5, a).Key(0.65, b).Key(0.8, a).Key(0.95, b).Key(1.3, G));
  }
  {
    let a = Copy(S), b = new P();
    a.Pelvis(-2, 10).Spine(-6).Head(8, -10).ArmL(62, 30, 10).ElbowL(76).ArmR(58, 18, 10).ElbowR(64).Legs(6, 10).Knees(14).Expr(F.Smug).Hands(false, false);
    b = Copy(a); b.ArmL(58, 18, 10).ElbowL(64).ArmR(62, 30, 10).ElbowR(76).Head(4, -10, 8);
    M.set("TauntMystic", new FCpvClip().Key(0, G).Key(0.25, a).Key(0.5, b).Key(0.75, a).Key(1.0, b).Key(1.25, a).Key(1.5, G));
  }
  {
    let a = Copy(S), b = new P();
    a.Pelvis(-6).Spine(-10).Chest(-10).Head(-16).ArmL(170, 22).ElbowL(12).ArmR(172, 18).ElbowR(10).LegL(6, 12).KneeL(8).LegR(-2, 12).KneeR(8);
    a.Expr(F.Happy);
    b = Copy(a); b.Knees(26).ArmL(160, 30).ElbowL(30).ArmR(162, 26).ElbowR(28).Spine(-4);
    M.set("Victory", new FCpvClip().Key(0, a).Key(0.3, b).Key(0.6, a).Loop());
  }
  {
    let a = Copy(S);
    a.Head(4).Expr(F.Neutral);
    let b = Copy(a); b.Chest(3).Arms(6, 9).Head(2);
    M.set("Stand", new FCpvClip().Key(0, a).Key(1.1, b).Key(2.2, a).Loop());
  }

  // ================= referee =================
  {
    let a = Copy(RefWatch()), b = Copy(RefWatch());
    b.Spine(28).KneeL(66).KneeR(64).Head(-10, 6);
    M.set("RefIdle", new FCpvClip().Key(0, a).Key(0.6, b).Key(1.2, a).Loop());
    let up = Copy(S), chop = Copy(S);
    up.Spine(-6).ArmR(170, 10).ElbowR(6).ArmL(10, 20).ElbowL(30).Legs(4, 12).Knees(10).Expr(F.Attack).Hands(false, false);
    chop.Pelvis(8).Spine(24).ArmR(70, 4).ElbowR(4).ArmL(-10, 24).ElbowL(40).LegL(30, 10).KneeL(40).LegR(-16, 10).KneeR(30).Expr(F.Attack).Hands(false, false);
    M.set("RefSignal", new FCpvClip().Key(0, RefWatch()).Key(0.3, up).Key(0.55, up).Key(0.68, chop, E.In).Key(1.0, chop).Key(1.3, RefWatch()));
    let w1 = Copy(S), w2 = Copy(S);
    w1.ArmL(165, 30).ElbowL(10).ArmR(165, 30).ElbowR(10).Legs(4, 14).Knees(8).Expr(F.Shock).Hands(false, false);
    w2 = Copy(w1); w2.ArmL(150, -24).ArmR(150, -24);
    M.set("RefBell", new FCpvClip().Key(0, RefWatch()).Key(0.2, w1).Key(0.4, w2).Key(0.6, w1).Key(0.8, w2).Key(1.0, w1).Key(1.2, w2).Key(1.5, S));
    let raise = Copy(S);
    raise.ArmR(168, 24).ElbowR(8).ArmL(6, 10).ElbowL(20).Head(-6, 20).Expr(F.Happy).Hands(false, false);
    M.set("RefRaise", new FCpvClip().Key(0, S).Key(0.4, raise, E.Over).Key(1.4, raise));
  }

  // ================= seated (commentators) =================
  {
    let a = Copy(Sit()), b = Copy(Sit());
    b.Spine(9).Head(4, 6);
    M.set("SitIdle", new FCpvClip().Key(0, a).Key(1.0, b).Key(2.0, a).Loop());
    let t1 = Copy(Sit()), t2 = Copy(Sit());
    t1.ArmR(70, 20, 0).ElbowR(88).Head(-4, -10).Spine(10).Expr(F.Attack);
    t2.ArmR(62, 36, 0).ElbowR(62).Head(6, 12).Spine(4).Expr(F.Happy);
    M.set("SitTalk", new FCpvClip().Key(0, a).Key(0.25, t1).Key(0.5, t2).Key(0.75, t1).Key(1.0, t2).Key(1.3, a));
    let shock = Copy(Sit());
    shock.Spine(-10).Chest(-8).Head(-12).ArmL(150, 30, 30).ElbowL(128).ArmR(150, 30, 30).ElbowR(128).Expr(F.Shock);
    M.set("SitShock", new FCpvClip().Key(0, a).Key(0.15, shock, E.Over).Key(1.0, shock).Key(1.3, a));
    let cheer = Copy(Sit()), cheer2 = new P();
    cheer.Floor(63).Spine(-8).Head(-14).ArmL(165, 26).ElbowL(14).ArmR(168, 22).ElbowR(12).Expr(F.Happy).Hands(true, true);
    cheer2 = Copy(cheer); cheer2.Floor(59).ArmL(150, 34).ElbowL(40).ArmR(152, 30).ElbowR(36);
    M.set("SitCheer", new FCpvClip().Key(0, a).Key(0.15, cheer, E.Over).Key(0.35, cheer2).Key(0.55, cheer).Key(0.75, cheer2).Key(0.95, cheer).Key(1.3, a));
  }
}

let ClipMap: Map<string, FCpvClip> | null = null;

function Clips(): Map<string, FCpvClip> {
  if (!ClipMap) {
    ClipMap = new Map();
    BuildClips(ClipMap);
    for (const [Name, Clip] of ClipMap) {
      for (let i = 1; i < Clip.Keys.length; ++i) {
        if (Clip.Keys[i].Time < Clip.Keys[i - 1].Time) { console.error(`Clip ${Name} has keys out of order`); }
      }
    }
  }
  return ClipMap;
}

export const CpvAnim = {
  /** Every clip in the game, by name. Built on first use. */
  Get(Name: string): FCpvClip { return Clips().get(Name) ?? Clips().get('Idle')!; },
  Has(Name: string): boolean { return Clips().has(Name); },
  GetNames(): string[] { return [...Clips().keys()]; },
};
