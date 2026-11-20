// Every animation in the game, sculpted pose by pose. See FCpvPose for the angle conventions.
// Characters face +X; "left" poses lead with the left side (an orthodox fighting stance).

#include "CpvPose.h"
#include "ClayPerView.h"

namespace
{
	using F = ECpvFace;
	using E = ECpvEase;
	typedef FCpvPose P;

	// ---- base poses ---------------------------------------------------------------------------------

	P Guard()
	{
		P p;
		p.Pelvis(4, 26).Spine(8, 4).Chest(6, 6).Neck(4, -14).Head(2, -20);
		p.LegL(26, 6).KneeL(34).LegR(-16, 10, -10).KneeR(38);
		p.ArmL(52, 14, 28).ElbowL(112).ArmR(30, 18, 30).ElbowR(128);
		return p.Expr(F::Angry);
	}

	P Stand()
	{
		P p;
		p.Arms(4, 8).Elbows(14).Legs(0, 6).Knees(4);
		return p.Expr(F::Neutral).Hands(false, false);
	}

	P DownBack()
	{
		P p;
		p.Pelvis(-90).Floor(13).Spine(-2).Neck(6).Head(8);
		p.ArmL(8, 62).ElbowL(25).ArmR(6, 74).ElbowR(20).LegL(6, 14).KneeL(8).LegR(4, 18).KneeR(12);
		return p.Expr(F::KO).Hands(false, false);
	}

	P DownFront()
	{
		P p;
		p.Pelvis(90).Floor(12).Spine(-6).Head(-18, 40);
		p.ArmL(150, 40).ElbowL(60).ArmR(160, 30).ElbowR(50).LegL(-4, 12).KneeL(6).LegR(-2, 14).KneeR(10);
		return p.Expr(F::KO).Hands(false, false);
	}

	P ClinchA()
	{
		P p;
		p.Pelvis(8, 10).Spine(18).Chest(10).Head(4, -10);
		p.ArmL(72, 8, 20).ElbowL(55).ArmR(68, 12, 20).ElbowR(60).LegL(30, 8).KneeL(40).LegR(-20, 10).KneeR(40);
		return p.Expr(F::Effort).Hands(false, false);
	}

	P ClinchV()
	{
		P p;
		p.Pelvis(10, -10).Spine(24).Chest(12).Head(14, 10);
		p.ArmL(80, 16, 20).ElbowL(50).ArmR(76, 14, 20).ElbowR(46).LegL(-18, 10).KneeL(42).LegR(28, 8).KneeR(40);
		return p.Expr(F::Effort).Hands(false, false);
	}

	P RunA()
	{
		P p;
		p.Pelvis(14).Spine(10).Chest(6).Head(-16);
		p.LegL(55).KneeL(35).LegR(-35).KneeR(72).ArmL(-40, 10).ElbowL(85).ArmR(50, 10).ElbowR(85);
		return p.Expr(F::Effort);
	}

	P Sit()
	{
		P p;
		p.Floor(57).Spine(6).Chest(4);
		p.Legs(84, 8).Knees(86).ArmL(42, 12, 10).ElbowL(72).ArmR(42, 12, 10).ElbowR(72);
		return p.Expr(F::Neutral).Hands(false, false);
	}

	P RefWatch()
	{
		P p;
		p.Pelvis(8).Spine(24).Chest(12).Neck(-12).Head(-14);
		p.LegL(40, 14).KneeL(60).LegR(36, 14).KneeR(58).ArmL(46, 10, 20).ElbowL(36).ArmR(46, 10, 20).ElbowR(36);
		return p.Expr(F::Neutral).Hands(false, false);
	}

	FCpvClip Hold(const P& Pose, float Length = 1.f)
	{
		FCpvClip C;
		C.Key(0.f, Pose).Key(Length, Pose);
		return C;
	}

	void BuildClips(TMap<FName, FCpvClip>& M)
	{
		const P G = Guard();
		const P S = Stand();

		// ================= stance and movement =================
		// A lateral press, one lifted shoulder and the official down at mat level.
		{
			P cover;
			cover.Floor(35).Pelvis(58).Spine(28).Chest(9).Head(-38, 13);
			cover.LegL(28, 24).KneeL(101).LegR(-32, 34).KneeR(67);
			cover.ArmL(73, 18, 12).ElbowL(89).ArmR(54, 28).ElbowR(64).Expr(F::Effort).Hands(false, false);
			P tuck = DownBack(); tuck.LegL(86, 16).KneeL(106).ArmR(35, 45).ElbowR(56).Head(9, -22).Expr(F::Hurt);
			P raised = RefWatch(); raised.Floor(39).Pelvis(26).Spine(24).Legs(61, 19).Knees(104);
			raised.ArmR(147, 26).ElbowR(35).ArmL(51, 32).ElbowL(55);
			P slap = raised; slap.Spine(47).ArmR(26, 21).ElbowR(12).Hands(false, false);
			M.Add("PinCover", Hold(cover));
			M.Add("PinShoulders", Hold(tuck));
			M.Add("RefCount", FCpvClip().Key(0.f, raised).Key(0.58f, raised).Key(0.76f, slap, E::In).Key(0.86f, slap).Key(1.f, raised));
		}

		{
			P b = G;
			b.KneeL(42).KneeR(46).ArmL(56, 14, 28).ElbowL(108).ArmR(34, 18, 30).ElbowR(124).Spine(11, 4);
			M.Add("Idle", FCpvClip().Key(0.f, G).Key(0.45f, b).Key(0.9f, G).Loop());
		}
		{
			P a = G, b = G;
			a.LegL(38, 6).KneeL(22).LegR(-24, 10, -10).KneeR(30);
			b.LegL(14, 6).KneeL(46).LegR(-4, 10, -10).KneeR(48).Spine(10, 4);
			M.Add("Walk", FCpvClip().Key(0.f, a).Key(0.18f, b).Key(0.36f, a).Loop());
		}
		{
			const P a = RunA(), b = RunA().Mirrored();
			M.Add("Run", FCpvClip().Key(0.f, a, E::Linear).Key(0.16f, b, E::Linear).Key(0.32f, a, E::Linear).Loop());
		}
		{
			P a = RunA(), b = RunA().Mirrored();
			for (P* p : { &a, &b }) { p->Pelvis(-8).Spine(-8).Chest(-6).Head(-8); p->Expr(F::Shock).Hands(false, false); }
			a.ArmL(40, 60).ElbowL(30).ArmR(120, 40).ElbowR(30);
			b.ArmL(120, 40).ElbowL(30).ArmR(40, 60).ElbowR(30);
			M.Add("WhipRun", FCpvClip().Key(0.f, a, E::Linear).Key(0.15f, b, E::Linear).Key(0.3f, a, E::Linear).Loop());
		}
		{
			P d = G;
			d.Pelvis(-10, 26).Spine(-12, 4).Chest(-8, 6).Head(8, -20).LegL(40, 8).KneeL(58).LegR(-26, 10, -10).KneeR(62);
			d.ArmL(40, 20, 28).ElbowL(100).ArmR(22, 24, 30).ElbowR(110);
			M.Add("Dodge", FCpvClip().Key(0.f, G).Key(0.08f, d, E::Out).Key(0.2f, d).Key(0.34f, G));
		}
		{
			P a, b, c;
			a.Pelvis(60).Floor(36).Spine(40).Chest(30).Head(40).Legs(100, 10).Knees(130).Arms(60, 10).Elbows(100);
			b = a; b.Pelvis(200).Floor(26);
			c = a; c.Pelvis(320).Floor(36);
			P end = G; end.Pelvis(364, 26);
			M.Add("Roll", FCpvClip().Key(0.f, G).Key(0.1f, a, E::Out).Key(0.24f, b, E::Linear).Key(0.38f, c, E::Linear).Key(0.52f, end, E::Out));
		}
		{
			P a = S, b = S;
			a.Pelvis(-4).Chest(-8).Head(-10).LegL(30, 6).KneeL(10).LegR(-22, 6).KneeR(26).ArmL(-30, 22).ElbowL(20).ArmR(36, 22).ElbowR(30);
			b = a.Mirrored();
			a.Expr(F::Smug); b.Expr(F::Smug);
			M.Add("Strut", FCpvClip().Key(0.f, a).Key(0.36f, b).Key(0.72f, a).Loop());
		}

		// ================= strikes =================
		{
			P ext = G;
			ext.Pelvis(6, 34).Spine(10, 8).Chest(8, 14).Neck(4, -18).Head(2, -34);
			ext.ArmL(86, 4, 20).ElbowL(4).LegL(32, 6).KneeL(38).Expr(F::Attack);
			P half = FCpvPose::Blend(G, ext, 0.4f);
			M.Add("Jab", FCpvClip().Key(0.f, G).Key(0.05f, half, E::In).Key(0.1f, ext, E::Out).Key(0.17f, ext).Key(0.3f, G));
		}
		{
			P load = G, ext = G;
			load.Chest(6, 18).ArmR(20, 22, 30).ElbowR(132);
			ext.Pelvis(6, -8).Spine(12, -14).Chest(8, -24).Neck(4, 14).Head(2, 20);
			ext.ArmR(88, 6, 20).ElbowR(4).ArmL(40, 20, 28).ElbowL(125).LegR(-24, 10, -25).KneeR(30).LegL(30, 6).KneeL(40).Expr(F::Attack);
			M.Add("Cross", FCpvClip().Key(0.f, G).Key(0.08f, load).Key(0.16f, ext, E::Out).Key(0.24f, ext).Key(0.42f, G));
		}
		{
			P low = G, up = G;
			low.Pelvis(10, 10).Spine(22).Chest(10, 10).Head(-10, -10).LegL(40, 8).KneeL(70).LegR(-10, 12).KneeR(75);
			low.ArmR(-10, 14, 10).ElbowR(95).ArmL(45, 16, 28).ElbowL(120).Expr(F::Effort);
			up.Pelvis(-6, -10).Spine(-10, -10).Chest(-8, -16).Head(-18, 22).LegL(18, 6).KneeL(10).LegR(-8, 8).KneeR(12);
			up.ArmR(128, 10, 30).ElbowR(55).ArmL(20, 22, 20).ElbowL(110).Expr(F::Attack);
			M.Add("Uppercut", FCpvClip().Key(0.f, G).Key(0.12f, low).Key(0.22f, up, E::Out).Key(0.34f, up).Key(0.56f, G));
		}
		{
			P wind = G, swing = G, follow = G;
			wind.Pelvis(0, 50).Spine(-6, 16).Chest(-8, 24).Neck(0, -30).Head(0, -52);
			wind.ArmR(-35, 55, 0).ElbowR(75).ArmL(60, 20, 20).ElbowL(60).LegL(30, 6).KneeL(30).LegR(-22, 12).KneeR(42).Expr(F::Effort);
			P wind2 = wind; wind2.ArmR(-45, 60, 0).ElbowR(85).Chest(-10, 28);
			swing.Pelvis(10, -20).Spine(18, -22).Chest(12, -30).Neck(0, 26).Head(0, 40);
			swing.ArmR(82, 25, 30).ElbowR(18).ArmL(10, 30, 10).ElbowL(100).LegL(40, 6).KneeL(52).LegR(-30, 10, -20).KneeR(25).Expr(F::Attack);
			follow = swing; follow.Chest(14, -52).ArmR(70, -25, 40).ElbowR(45).Head(0, 60);
			M.Add("Haymaker", FCpvClip().Key(0.f, G).Key(0.2f, wind).Key(0.36f, wind2).Key(0.46f, swing, E::Out).Key(0.58f, follow, E::Out).Key(0.95f, G));
		}
		{
			P chamber = G, ext = G;
			chamber.Pelvis(-4, 10).Spine(-6).LegR(70, 5).KneeR(100).LegL(8, 6).KneeL(18).ArmL(20, 45).ElbowL(60).ArmR(10, 50).ElbowR(60);
			ext.Pelvis(-14, 6).Spine(-12).Chest(-6).Head(14, -6).LegR(98, 4).KneeR(4).AnkleR(20).LegL(6, 6).KneeL(12);
			ext.ArmL(30, 50).ElbowL(50).ArmR(-10, 55).ElbowR(40).Expr(F::Attack);
			M.Add("Boot", FCpvClip().Key(0.f, G).Key(0.14f, chamber).Key(0.24f, ext, E::Out).Key(0.34f, ext).Key(0.5f, chamber).Key(0.68f, G));
		}
		{
			P run = RunA(), hit = RunA(), stum = G;
			run.Chest(6, -24).ArmR(20, 95).ElbowR(8).Expr(F::Attack);
			hit.Pelvis(10, 20).Chest(8, 40).ArmR(62, 70).ElbowR(10).LegL(-30).KneeL(40).LegR(50).KneeR(30).Expr(F::Attack);
			stum.Pelvis(16, 30).Spine(20, 10);
			M.Add("Clothesline", FCpvClip().Key(0.f, run).Key(0.15f, hit, E::Out).Key(0.4f, stum).Key(0.6f, G));
		}
		{
			P jump, ext, fall, crouch;
			jump.Pelvis(-30).Air(25).Legs(60, 6).Knees(80).Arms(40, 40).Elbows(40).Expr(F::Effort);
			ext.Pelvis(-80).Air(30).Spine(10).Head(30).Legs(95, 4).Knees(5).Arms(30, 60).Elbows(20).Expr(F::Attack);
			fall.Pelvis(-90).Floor(14).Head(10).Legs(30, 12).Knees(20).Arms(20, 60).Elbows(20).Expr(F::Effort);
			crouch.Pelvis(15, 20).Spine(25).Chest(10).LegL(75, 10).KneeL(110).LegR(60, 12).KneeR(115).Arms(40, 10).Elbows(60);
			M.Add("Dropkick", FCpvClip().Key(0.f, RunA()).Key(0.12f, jump, E::Out).Key(0.26f, ext, E::Out).Key(0.4f, ext)
				.Key(0.58f, fall, E::In).Key(0.85f, fall).Key(1.2f, crouch).Key(1.45f, G));
		}
		{
			P up = G, down = G;
			up.Pelvis(-4, 10).Spine(-6).LegR(85, 8).KneeR(110).LegL(6, 6).KneeL(14).Arms(30, 40).Elbows(70).Expr(F::Effort);
			down.Pelvis(10, 10).Spine(18).Head(20, -10).LegR(40, 6).KneeR(8).LegL(-6, 6).KneeL(26).Arms(20, 30).Elbows(50).Expr(F::Attack);
			M.Add("Stomp", FCpvClip().Key(0.f, G).Key(0.16f, up).Key(0.26f, down, E::In).Key(0.36f, down).Key(0.55f, G));
		}
		{
			P crouch = G, jump, flop, push;
			crouch.Pelvis(10, 0).Spine(20).Legs(50, 12).Knees(92).Arms(-30, 20).Elbows(30).Expr(F::Effort);
			jump.Pelvis(20).Air(70).Arms(150, 40).Elbows(10).Legs(-20, 20).Knees(30).Expr(F::Attack);
			flop.Pelvis(85).Floor(26, 60).Head(-20).Arms(110, 60).Elbows(10).Legs(-10, 30).Knees(8).Expr(F::Attack);
			P bounce = flop; bounce.Floor(34, 60);
			push.Pelvis(40).Floor(44, 28).Spine(-10).Arms(60, 20).Elbows(20).Legs(40, 14).Knees(100);
			M.Add("Splash", FCpvClip().Key(0.f, G).Key(0.2f, crouch).Key(0.4f, jump, E::Out).Key(0.6f, flop, E::In).Key(0.72f, bounce, E::Out)
				.Key(0.9f, flop, E::In).Key(1.3f, push).Key(1.6f, G));
		}
		{
			P wind = G, swing = G, follow = G;
			wind.Pelvis(2, 40).Chest(0, 50).Head(0, -70).ArmR(20, 70, -30).ElbowR(60).Expr(F::Effort);
			swing.Pelvis(8, -6).Chest(8, -40).Head(0, 30).ArmR(78, 20, 20).ElbowR(12).LegL(36, 6).KneeL(46).Expr(F::Attack);
			follow = swing; follow.Chest(10, -58).ArmR(60, -32, 20).ElbowR(42).Head(0, 46);
			M.Add("WeaponSwing", FCpvClip().Key(0.f, G).Key(0.14f, wind).Key(0.24f, swing, E::Out).Key(0.34f, follow, E::Out).Key(0.62f, G));
		}
		{
			P up = G, down = G;
			up.Pelvis(-6, 6).Spine(-18).Chest(-12).Head(-12, 0).Arms(165, 8).Elbows(40).LegL(20, 8).KneeL(16).LegR(-10, 10).KneeR(20).Expr(F::Effort);
			down.Pelvis(14, 6).Spine(42).Chest(22).Head(10, 0).Arms(48, 6).Elbows(8).LegL(40, 8).KneeL(56).LegR(-20, 10).KneeR(40).Expr(F::Attack);
			M.Add("WeaponSmash", FCpvClip().Key(0.f, G).Key(0.24f, up).Key(0.36f, down, E::In).Key(0.5f, down).Key(0.86f, G));
		}
		{
			P wind = G, rel = G, follow = G;
			wind.Pelvis(0, 46).Chest(-6, 50).Head(0, -76).ArmR(-30, 70, -40).ElbowR(95).ArmL(70, 10).ElbowL(20).Expr(F::Effort);
			rel.Pelvis(8, -10).Spine(20, -10).Chest(10, -30).Head(0, 30).ArmR(100, 15, 20).ElbowR(10).ArmL(20, 30).ElbowL(70).Expr(F::Attack).Hands(true, false);
			follow = rel; follow.ArmR(50, -10).ElbowR(20).Chest(14, -44).Head(0, 44);
			M.Add("Throw", FCpvClip().Key(0.f, G).Key(0.2f, wind).Key(0.32f, rel, E::Out).Key(0.45f, follow, E::Out).Key(0.78f, G));
		}
		{
			P bend = G;
			bend.Pelvis(20, 10).Spine(55).Chest(25).Head(10, -10).Legs(45, 12).Knees(72).ArmR(50, 5).ElbowR(10).ArmL(20, 20).ElbowL(60).Hands(true, false);
			M.Add("Pickup", FCpvClip().Key(0.f, G).Key(0.15f, bend).Key(0.3f, bend).Key(0.5f, G));
		}

		// ================= grapples =================
		{
			P lunge = G, clasp = G;
			lunge.Pelvis(12, 10).Spine(22).Chest(12).Head(-6, -10).ArmL(70, 25, 10).ElbowL(30).ArmR(64, 28, 10).ElbowR(34);
			lunge.LegL(44, 8).KneeL(50).LegR(-28, 10).KneeR(30).Expr(F::Effort).Hands(false, false);
			clasp = lunge; clasp.Arms(74, 4, 20).Elbows(48);
			M.Add("GrabTry", FCpvClip().Key(0.f, G).Key(0.1f, lunge, E::Out).Key(0.22f, clasp).Key(0.42f, G));
		}
		{
			P a = ClinchA(), b = ClinchA();
			b.Spine(22, 0, 5).Chest(12, 0, 4).ArmL(76, 10, 20).ElbowL(50);
			M.Add("ClinchA", FCpvClip().Key(0.f, a).Key(0.3f, b).Key(0.6f, a).Loop());
			P c = ClinchV(), d = ClinchV();
			d.Spine(20, 0, -6).Chest(14, 0, -4).Head(10, 10);
			M.Add("ClinchV", FCpvClip().Key(0.f, c).Key(0.3f, d).Key(0.6f, c).Loop());
		}
		{
			P back = ClinchA(), slam = ClinchA();
			back.Spine(-12).Chest(-10).Neck(-20).Head(-25).Expr(F::Effort);
			slam.Spine(34).Chest(16).Neck(14).Head(20).Expr(F::Attack);
			M.Add("Headbutt", FCpvClip().Key(0.f, ClinchA()).Key(0.14f, back).Key(0.22f, slam, E::In).Key(0.32f, slam).Key(0.6f, G));
			P hurt = ClinchV();
			hurt.Spine(-16).Chest(-12).Neck(-20).Head(-30).Arms(60, 60).Elbows(30).Expr(F::Hurt);
			M.Add("HeadbuttV", FCpvClip().Key(0.f, ClinchV()).Key(0.21f, ClinchV()).Key(0.24f, hurt, E::Out).Key(0.6f, hurt));
		}
		{
			P scoop = ClinchA(), lift = ClinchA(), slam = ClinchA();
			scoop.Pelvis(20).Spine(40).Chest(20).Legs(60, 14).Knees(95).ArmL(40, 10).ElbowL(30).ArmR(60, 10).ElbowR(40);
			lift.Pelvis(-6).Spine(-14).Chest(-10).Head(-10).Legs(10, 14).Knees(15).Arms(150, 20).Elbows(25);
			P lift2 = lift; lift2.Knees(26).Arms(156, 20);
			slam.Pelvis(30).Spine(50).Chest(25).Head(10).Legs(50, 14).Knees(80).Arms(60, 15).Elbows(15).Expr(F::Attack);
			M.Add("SlamA", FCpvClip().Key(0.f, ClinchA()).Key(0.18f, scoop).Key(0.45f, lift, E::Out).Key(0.65f, lift2).Key(0.8f, slam, E::In)
				.Key(1.0f, slam).Key(1.25f, G));
			// The victim's offsets are in their own frame: +X is toward the attacker, who stands ~62 cm away.
			P v1 = ClinchV(), v2, v3, v4;
			v1.Pelvis(-40).Air(0, 25).Spine(-10).Arms(40, 50).Elbows(30).Legs(30, 10).Knees(40).Expr(F::Shock);
			v2.Pelvis(-90).Air(128, 62).Spine(-8).Head(-10).Arms(30, 70).Elbows(20).LegL(20, 20).KneeL(30).LegR(40, 16).KneeR(50).Expr(F::Shock).Hands(false, false);
			P v2b = v2; v2b.Air(134, 62).LegL(40, 20).LegR(20, 16);
			v3.Pelvis(-90).Floor(13, 12).Head(10).Arms(20, 70).Elbows(15).Legs(25, 14).Knees(20).Expr(F::Hurt).Hands(false, false);
			P v3b = v3; v3b.Floor(24, 12).Legs(40, 16);
			v4 = DownBack(); v4.Root.X = 12.f;
			M.Add("SlamV", FCpvClip().Key(0.f, ClinchV()).Key(0.18f, v1).Key(0.45f, v2, E::Out).Key(0.65f, v2b).Key(0.8f, v3, E::In)
				.Key(0.9f, v3b, E::Out).Key(1.05f, v4, E::In).Key(1.25f, v4));
		}
		{
			P pull = ClinchA(), fling = G;
			pull.Chest(10, 40).ArmR(60, 40).ElbowR(70).ArmL(80, -10).ElbowL(30);
			fling.Pelvis(8, -10).Spine(20, -10).Chest(10, -46).Head(0, 40).ArmL(85, 20).ElbowL(5).ArmR(50, 30).ElbowR(60).Expr(F::Attack).Hands(false, true);
			M.Add("WhipA", FCpvClip().Key(0.f, ClinchA()).Key(0.15f, pull).Key(0.32f, fling, E::Out).Key(0.6f, G));
		}
		{
			P push = ClinchA(), back = G;
			push.Spine(26).Arms(82, 10).Elbows(8).Expr(F::Attack);
			back.Pelvis(-8, 26).Spine(-10).Arms(50, 40).Elbows(40).LegL(34, 8).KneeL(20).Expr(F::Hurt);
			M.Add("ShoveA", FCpvClip().Key(0.f, ClinchA()).Key(0.1f, push, E::Out).Key(0.4f, G));
			M.Add("ShoveV", FCpvClip().Key(0.f, ClinchV()).Key(0.1f, back, E::Out).Key(0.45f, G));
		}

		// ================= reactions =================
		{
			P hit = G, more = G;
			hit.Pelvis(-6, 26).Spine(-14, 4).Chest(-12, 6).Neck(-18, -10).Head(-30, -12).ArmL(30, 35, 10).ElbowL(70).ArmR(15, 35, 10).ElbowR(80).Expr(F::Hurt);
			more = hit; more.Spine(-18, 4).Head(-36, -8).ArmL(36, 44, 10);
			M.Add("HitHigh", FCpvClip().Key(0.f, hit).Key(0.1f, more, E::Out).Key(0.34f, G));
		}
		{
			P hit = G;
			hit.Pelvis(8, 26).Spine(40).Chest(26).Neck(10).Head(20, -20).ArmL(30, 5, 40).ElbowL(100).ArmR(30, 5, 40).ElbowR(100);
			hit.LegL(30, 6).KneeL(45).LegR(-10, 10).KneeR(50).Expr(F::Hurt);
			P more = hit; more.Spine(46).Head(26, -20);
			M.Add("HitGut", FCpvClip().Key(0.f, hit).Key(0.14f, more, E::Out).Key(0.44f, G));
		}
		{
			P a = G, b = G, c = G;
			a.Pelvis(-14, 20).Spine(-16).Chest(-10).Head(-20, -10).Arms(70, 50).Elbows(40).LegL(40, 8).KneeL(20).LegR(-20, 10).KneeR(30).Expr(F::Hurt);
			b.Pelvis(-10, 22).Spine(-10).Head(-10, -14).ArmL(140, 30).ElbowL(20).ArmR(20, 60).ElbowR(30).LegL(-10, 8).KneeL(40).LegR(30, 10).KneeR(15).Expr(F::Hurt);
			c.Pelvis(-4, 24).Spine(0).ArmL(60, 40).ElbowL(60).ArmR(90, 40).ElbowR(40).LegL(34, 8).KneeL(30).LegR(-14, 10).KneeR(36).Expr(F::Hurt);
			M.Add("Stagger", FCpvClip().Key(0.f, a).Key(0.2f, b).Key(0.4f, c).Key(0.62f, G));
		}
		{
			P a = G, air, land, bounce;
			a.Pelvis(-25, 10).Spine(-20).Arms(80, 40).Elbows(30).LegL(30, 6).KneeL(30).LegR(0, 10).KneeR(40).Expr(F::Hurt);
			air.Pelvis(-65).Floor(44).Spine(-10).Head(-10).Arms(100, 50).Elbows(20).Legs(50, 12).Knees(40).Expr(F::Hurt).Hands(false, false);
			land.Pelvis(-90).Floor(13).Head(10).Arms(20, 70).Elbows(15).Legs(20, 12).Knees(15).Expr(F::Hurt).Hands(false, false);
			bounce = land; bounce.Floor(21).Legs(36, 14).Arms(40, 70);
			M.Add("KnockDown", FCpvClip().Key(0.f, a).Key(0.18f, air, E::Out).Key(0.36f, land, E::In).Key(0.46f, bounce, E::Out).Key(0.62f, DownBack(), E::In));
			M.Add("DownBack", Hold(DownBack()));
			M.Add("DownFront", Hold(DownFront()));
			M.Add("Land", FCpvClip().Key(0.f, land).Key(0.1f, bounce, E::Out).Key(0.26f, DownBack(), E::In));
		}
		{
			P sit, crouch;
			sit.Pelvis(-40).Floor(18).Spine(40).Chest(20).Head(10).Arms(50, 20).Elbows(40).Legs(70, 15).Knees(100).Expr(F::Effort);
			crouch.Pelvis(15, 20).Spine(25).Chest(10).LegL(75, 10).KneeL(110).LegR(60, 12).KneeR(115).Arms(40, 10).Elbows(60).Expr(F::Effort);
			M.Add("GetUp", FCpvClip().Key(0.f, DownBack()).Key(0.25f, sit).Key(0.5f, crouch).Key(0.8f, G));
			P push;
			push.Pelvis(60).Floor(30).Spine(-20).Head(-20).Arms(70, 20).Elbows(30).Legs(40, 14).Knees(90).Expr(F::Effort);
			M.Add("GetUpFront", FCpvClip().Key(0.f, DownFront()).Key(0.25f, push).Key(0.5f, crouch).Key(0.8f, G));
		}
		{
			P a, b, c;
			a.Pelvis(-60).Floor(48).Arms(120, 50).Elbows(20).LegL(40, 25).KneeL(50).LegR(10, 25).KneeR(30).Expr(F::Shock).Hands(false, false);
			b = a; b.Pelvis(-240).ArmL(60, 70).ArmR(150, 40).LegL(10, 25).KneeL(20).LegR(50, 25).KneeR(60);
			c = a; c.Pelvis(-420);
			M.Add("AirFlail", FCpvClip().Key(0.f, a, E::Linear).Key(0.3f, b, E::Linear).Key(0.6f, c, E::Linear).Loop());
		}
		{
			P blk = G, hit = G;
			blk.Pelvis(6, 24).Spine(16, 4).Chest(10, 4).Neck(8, -12).Head(10, -16).ArmL(78, -6, 35).ElbowL(132).ArmR(72, -2, 35).ElbowR(138);
			blk.LegL(26, 6).KneeL(40).LegR(-16, 10).KneeR(44).Expr(F::Effort);
			hit = blk; hit.Pelvis(-2, 24).Spine(6, 4).ArmL(70, -6, 35).ArmR(64, -2, 35).KneeL(30);
			M.Add("Block", FCpvClip().Key(0.f, blk).Key(0.5f, blk).Loop());
			M.Add("BlockHit", FCpvClip().Key(0.f, hit).Key(0.1f, hit).Key(0.22f, blk));
		}
		{
			P a, b;
			a.Pelvis(4, 10, 6).Spine(6, 0, 10).Chest(4, 0, 8).Head(10, 10, 14).Arms(6, 10).Elbows(14).LegL(10, 8).KneeL(24).LegR(-4, 10).KneeR(26);
			b.Pelvis(2, -6, -6).Spine(8, 0, -10).Chest(0, 0, -8).Head(-6, -12, -12).Arms(2, 14).Elbows(10).LegL(4, 10).KneeL(28).LegR(6, 8).KneeR(22);
			a.Expr(F::Dazed).Hands(false, false); b.Expr(F::Dazed).Hands(false, false);
			M.Add("Dazed", FCpvClip().Key(0.f, a).Key(0.7f, b).Key(1.4f, a).Loop());
			P buckle, fall;
			buckle.Pelvis(20).Spine(20).Head(20).Arms(10, 15).Elbows(10).Legs(50, 10).Knees(120).Expr(F::KO).Hands(false, false);
			fall.Pelvis(70).Floor(22).Spine(10).Arms(120, 30).Elbows(30).Legs(10, 12).Knees(40).Expr(F::KO).Hands(false, false);
			P df = DownFront(), dfb = DownFront();
			dfb.Floor(18);
			M.Add("Collapse", FCpvClip().Key(0.f, a).Key(0.25f, buckle, E::In).Key(0.5f, fall, E::In).Key(0.62f, df, E::In).Key(0.74f, dfb, E::Out).Key(0.9f, df, E::In));
		}
		{
			P arch, more, fwd = RunA();
			arch.Pelvis(-12).Spine(-20).Chest(-16).Head(-20).Arms(20, 80).Elbows(20).Legs(20, 10).Knees(20).Expr(F::Hurt).Hands(false, false);
			more = arch; more.Spine(-28).Chest(-20).Arms(30, 88);
			M.Add("RopeBounce", FCpvClip().Key(0.f, arch).Key(0.16f, more, E::Out).Key(0.34f, fwd, E::In));
		}

		// ================= signature moves =================
		{
			P inhale = G, yell = G, yell2;
			inhale.Pelvis(-4, 6).Spine(-18).Chest(-14).Head(-20, -6).Arms(-20, 35).Elbows(40).Expr(F::Effort);
			yell.Pelvis(10, 0).Spine(30).Chest(16).Head(-8, 0).Arms(-35, 40).Elbows(20).LegL(30, 14).KneeL(40).LegR(-20, 14).KneeR(40).Expr(F::Attack);
			yell2 = yell; yell2.Spine(34).Head(-4, 0).Arms(-42, 46);
			M.Add("SpecScream", FCpvClip().Key(0.f, G).Key(0.25f, inhale).Key(0.4f, yell, E::Out).Key(0.55f, yell2).Key(0.7f, yell).Key(0.85f, yell2)
				.Key(1.0f, yell).Key(1.3f, G));
		}
		{
			P look = G, zap = G;
			look.Pelvis(2, 10).ArmR(60, 10, 30).ElbowR(120).Head(22, 4).ArmL(10, 20).ElbowL(40).Expr(F::Smug);
			zap.Pelvis(4, -10).Chest(6, -25).Head(0, 30).ArmR(90, 0, 10).ElbowR(0).ArmL(-10, 30).ElbowL(50).LegL(30, 8).KneeL(30).Expr(F::Smug).Hands(true, false);
			P zap2 = zap; zap2.ArmR(92, 2, 10).Chest(8, -27);
			M.Add("SpecZap", FCpvClip().Key(0.f, G).Key(0.2f, look).Key(0.35f, zap, E::Out).Key(0.6f, zap2).Key(0.9f, zap).Key(1.15f, G));
		}
		{
			P crouch = G, jump, land;
			crouch.Pelvis(10, 0).Spine(22).Legs(52, 14).Knees(96).Arms(-20, 20).Elbows(40).Expr(F::Effort);
			jump.Air(95).Pelvis(-10).Spine(-10).Arms(170, 20).Elbows(10).Legs(70, 15).Knees(110).Expr(F::Attack);
			land.Pelvis(20, 0).Spine(40).Chest(20).Head(-20).Legs(70, 20).Knees(112).Arms(40, 30).Elbows(10).Expr(F::Attack);
			M.Add("SpecSlam", FCpvClip().Key(0.f, G).Key(0.25f, crouch).Key(0.45f, jump, E::Out).Key(0.65f, land, E::In).Key(0.9f, land).Key(1.2f, G));
		}
		{
			P a = G, b;
			a.Pelvis(-8, 30).Spine(-14).Chest(-8).Head(-10, -30).LegL(20, 25).KneeL(30).LegR(-10, 25).KneeR(30);
			a.ArmL(60, 40, 0).ElbowL(60).ArmR(30, 10, 30).ElbowR(95).Expr(F::Attack).Hands(false, true);
			b = a; b.ArmR(10, 12, 30).ElbowR(70).Spine(-6).Head(6, -30);
			M.Add("SpecStrum", FCpvClip().Key(0.f, G).Key(0.2f, a).Key(0.32f, b, E::In).Key(0.46f, a).Key(0.58f, b, E::In).Key(0.72f, a).Key(0.84f, b, E::In)
				.Key(1.0f, a).Key(1.25f, G));
		}
		{
			P a = G, b;
			a.Pelvis(-6, 0).Spine(-10).Head(-6, 0).ArmL(82, 22, 0).ElbowL(24).ArmR(86, 14, 0).ElbowR(18).LegL(20, 12).KneeL(26).LegR(-12, 12).KneeR(26);
			a.Expr(F::Effort).Hands(false, false);
			b = a; b.ArmL(90, 10, 0).ElbowL(14).ArmR(78, 26, 0).ElbowR(30).Spine(-4);
			M.Add("SpecCast", FCpvClip().Key(0.f, G).Key(0.2f, a).Key(0.4f, b).Key(0.6f, a).Key(0.8f, b).Key(1.0f, a).Key(1.25f, G));
		}

		// ================= showmanship =================
		{
			P flex = S, pump;
			flex.Pelvis(-4).Spine(-8).Chest(-10).Head(-10).ArmL(0, 92, -90).ElbowL(112).ArmR(0, 92, -90).ElbowR(112).LegL(8, 14).KneeL(12).LegR(-4, 14).KneeR(12);
			flex.Expr(F::Happy).Hands(true, true);
			pump = flex; pump.Elbows(128).Chest(-14).Knees(22);
			M.Add("TauntFlex", FCpvClip().Key(0.f, G).Key(0.25f, flex, E::Over).Key(0.5f, pump).Key(0.75f, flex).Key(1.0f, pump).Key(1.3f, G));
		}
		{
			P a = S, b;
			a.Pelvis(-4, 40).Spine(-6).Head(-12, -30).ArmR(165, 16).ElbowR(6).ArmL(8, 38, 40).ElbowL(96).LegL(10, 12).KneeL(10).LegR(-6, 14).KneeR(14);
			a.Expr(F::Happy).Hands(false, true);
			b = a; b.ArmR(172, 26).Pelvis(-4, 40, 8).Knees(22);
			M.Add("TauntPoint", FCpvClip().Key(0.f, G).Key(0.25f, a, E::Over).Key(0.55f, b).Key(0.85f, a).Key(1.15f, b).Key(1.4f, G));
		}
		{
			P a = S, b;
			a.Pelvis(0, 10, 10).Spine(0, 0, -8).Head(0, -10, 6).ArmR(150, 20).ElbowR(30).ArmL(40, 20).ElbowL(100).LegL(14, 12).KneeL(30).LegR(-8, 12).KneeR(10);
			a.Expr(F::Happy);
			b = a.Mirrored(); b.Pelvis(0, 10, -10);
			M.Add("TauntDance", FCpvClip().Key(0.f, G).Key(0.2f, a).Key(0.45f, b).Key(0.7f, a).Key(0.95f, b).Key(1.2f, a).Key(1.45f, G));
		}
		{
			P a = S, b;
			a.Pelvis(-6, 20).Spine(-8).Neck(-8).Head(-10, -20).ArmR(40, 30, -20).ElbowR(122).WristR(0, 25).ArmL(6, 14, 30).ElbowL(70);
			a.LegL(6, 8).KneeL(6).LegR(-2, 8).KneeR(6).Expr(F::Smug).Hands(true, false);
			b = a; b.WristR(0, -25).ElbowR(116);
			M.Add("TauntWave", FCpvClip().Key(0.f, G).Key(0.3f, a).Key(0.5f, b).Key(0.7f, a).Key(0.9f, b).Key(1.1f, a).Key(1.4f, G));
		}
		{
			P a = S, b;
			a.Pelvis(-2, 20).Head(6, -20).ArmR(70, 5, 40).ElbowR(142).ArmL(10, 30, 30).ElbowL(90).Legs(4, 10).Knees(8).Expr(F::Smug).Hands(true, false);
			b = a; b.ArmR(84, 44, 0).ElbowR(26).Head(-12, -20).Spine(-8).Expr(F::Happy);
			M.Add("TauntKiss", FCpvClip().Key(0.f, G).Key(0.3f, a).Key(0.55f, a).Key(0.7f, b, E::Over).Key(1.1f, b).Key(1.4f, G));
		}
		{
			P a = S, b;
			a.Pelvis(-2, 30).Head(26, -24).ArmR(45, 5, 30).ElbowR(112).ArmL(4, 12, 20).ElbowL(30).Legs(2, 8).Knees(6).Expr(F::Smug).Hands(true, false);
			b = a; b.Head(22, -20).WristR(10, 10);
			M.Add("TauntPhone", FCpvClip().Key(0.f, G).Key(0.3f, a).Key(0.6f, b).Key(0.9f, a).Key(1.2f, b).Key(1.5f, G));
		}
		{
			P a = S, b;
			a.Pelvis(4, 20).Spine(10).Head(24, -20).ArmR(165, 15).ElbowR(8).ArmL(30, 30).ElbowL(60).LegL(20, 16).KneeL(30).LegR(-10, 16).KneeR(30).Expr(F::Attack);
			b = a; b.Spine(-8).Head(-22, -20).ArmR(158, 22);
			M.Add("TauntRock", FCpvClip().Key(0.f, G).Key(0.2f, a).Key(0.35f, b).Key(0.5f, a).Key(0.65f, b).Key(0.8f, a).Key(0.95f, b).Key(1.3f, G));
		}
		{
			P a = S, b;
			a.Pelvis(-2, 10).Spine(-6).Head(8, -10).ArmL(62, 30, 10).ElbowL(76).ArmR(58, 18, 10).ElbowR(64).Legs(6, 10).Knees(14).Expr(F::Smug).Hands(false, false);
			b = a; b.ArmL(58, 18, 10).ElbowL(64).ArmR(62, 30, 10).ElbowR(76).Head(4, -10, 8);
			M.Add("TauntMystic", FCpvClip().Key(0.f, G).Key(0.25f, a).Key(0.5f, b).Key(0.75f, a).Key(1.0f, b).Key(1.25f, a).Key(1.5f, G));
		}
		{
			P a = S, b;
			a.Pelvis(-6).Spine(-10).Chest(-10).Head(-16).ArmL(170, 22).ElbowL(12).ArmR(172, 18).ElbowR(10).LegL(6, 12).KneeL(8).LegR(-2, 12).KneeR(8);
			a.Expr(F::Happy);
			b = a; b.Knees(26).ArmL(160, 30).ElbowL(30).ArmR(162, 26).ElbowR(28).Spine(-4);
			M.Add("Victory", FCpvClip().Key(0.f, a).Key(0.3f, b).Key(0.6f, a).Loop());
		}
		{
			P a = S;
			a.Head(4).Expr(F::Neutral);
			P b = a; b.Chest(3).Arms(6, 9).Head(2);
			M.Add("Stand", FCpvClip().Key(0.f, a).Key(1.1f, b).Key(2.2f, a).Loop());
		}

		// ================= referee =================
		{
			P a = RefWatch(), b = RefWatch();
			b.Spine(28).KneeL(66).KneeR(64).Head(-10, 6);
			M.Add("RefIdle", FCpvClip().Key(0.f, a).Key(0.6f, b).Key(1.2f, a).Loop());
			P up = S, chop = S;
			up.Spine(-6).ArmR(170, 10).ElbowR(6).ArmL(10, 20).ElbowL(30).Legs(4, 12).Knees(10).Expr(F::Attack).Hands(false, false);
			chop.Pelvis(8).Spine(24).ArmR(70, 4).ElbowR(4).ArmL(-10, 24).ElbowL(40).LegL(30, 10).KneeL(40).LegR(-16, 10).KneeR(30).Expr(F::Attack).Hands(false, false);
			M.Add("RefSignal", FCpvClip().Key(0.f, RefWatch()).Key(0.3f, up).Key(0.55f, up).Key(0.68f, chop, E::In).Key(1.0f, chop).Key(1.3f, RefWatch()));
			P w1 = S, w2 = S;
			w1.ArmL(165, 30).ElbowL(10).ArmR(165, 30).ElbowR(10).Legs(4, 14).Knees(8).Expr(F::Shock).Hands(false, false);
			w2 = w1; w2.ArmL(150, -24).ArmR(150, -24);
			M.Add("RefBell", FCpvClip().Key(0.f, RefWatch()).Key(0.2f, w1).Key(0.4f, w2).Key(0.6f, w1).Key(0.8f, w2).Key(1.0f, w1).Key(1.2f, w2).Key(1.5f, S));
			P raise = S;
			raise.ArmR(168, 24).ElbowR(8).ArmL(6, 10).ElbowL(20).Head(-6, 20).Expr(F::Happy).Hands(false, false);
			M.Add("RefRaise", FCpvClip().Key(0.f, S).Key(0.4f, raise, E::Over).Key(1.4f, raise));
		}

		// ================= seated (commentators) =================
		{
			P a = Sit(), b = Sit();
			b.Spine(9).Head(4, 6);
			M.Add("SitIdle", FCpvClip().Key(0.f, a).Key(1.0f, b).Key(2.0f, a).Loop());
			P t1 = Sit(), t2 = Sit();
			t1.ArmR(70, 20, 0).ElbowR(88).Head(-4, -10).Spine(10).Expr(F::Attack);
			t2.ArmR(62, 36, 0).ElbowR(62).Head(6, 12).Spine(4).Expr(F::Happy);
			M.Add("SitTalk", FCpvClip().Key(0.f, a).Key(0.25f, t1).Key(0.5f, t2).Key(0.75f, t1).Key(1.0f, t2).Key(1.3f, a));
			P shock = Sit();
			shock.Spine(-10).Chest(-8).Head(-12).ArmL(150, 30, 30).ElbowL(128).ArmR(150, 30, 30).ElbowR(128).Expr(F::Shock);
			M.Add("SitShock", FCpvClip().Key(0.f, a).Key(0.15f, shock, E::Over).Key(1.0f, shock).Key(1.3f, a));
			P cheer = Sit(), cheer2;
			cheer.Floor(63).Spine(-8).Head(-14).ArmL(165, 26).ElbowL(14).ArmR(168, 22).ElbowR(12).Expr(F::Happy).Hands(true, true);
			cheer2 = cheer; cheer2.Floor(59).ArmL(150, 34).ElbowL(40).ArmR(152, 30).ElbowR(36);
			M.Add("SitCheer", FCpvClip().Key(0.f, a).Key(0.15f, cheer, E::Over).Key(0.35f, cheer2).Key(0.55f, cheer).Key(0.75f, cheer2).Key(0.95f, cheer).Key(1.3f, a));
		}
	}

	TMap<FName, FCpvClip>& Clips()
	{
		static TMap<FName, FCpvClip> Map;
		if (Map.Num() == 0)
		{
			BuildClips(Map);
			// Sanity: keys must run forward in time.
			for (const auto& Pair : Map)
			{
				for (int32 i = 1; i < Pair.Value.Keys.Num(); ++i)
				{
					if (Pair.Value.Keys[i].Time < Pair.Value.Keys[i - 1].Time)
					{
						UE_LOG(LogCpv, Error, TEXT("Clip %s has keys out of order"), *Pair.Key.ToString());
					}
				}
			}
		}
		return Map;
	}
}

const FCpvClip& CpvAnim::Get(FName Name)
{
	if (const FCpvClip* Found = Clips().Find(Name)) { return *Found; }
	return Clips().FindChecked(TEXT("Idle"));
}

bool CpvAnim::Has(FName Name)
{
	return Clips().Contains(Name);
}

void CpvAnim::GetNames(TArray<FName>& OutNames)
{
	Clips().GetKeys(OutNames);
}
