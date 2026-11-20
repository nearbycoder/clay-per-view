#include "CpvAI.h"
#include "CpvFighter.h"
#include "CpvGame.h"

void FCpvAI::Reset()
{
	Clock = BlockLeft = RunLeft = StrafeLeft = BackOffLeft = ComboGap = ClinchDelay = 0.f;
	ComboLeft = 0;
	DownPlan = -1;
	SeenAttack = nullptr;
	bWantWeapon = false;
	bPunishRolled = false;
}

FCpvInput FCpvAI::Think(float Dt, ACpvFighter& Me, ACpvFighter& Foe, ACpvGameMode& Game)
{
	FCpvInput In;
	const float S = Skill();
	// Quick stars build strings. Power stars take bigger risks in the clinch.
	const float Style = (Me.Def().Power - Me.Def().Speed) / 5.f;
	const FVector2D To = Foe.Pos2D() - Me.Pos2D();
	const float Dist = To.Size();
	const FVector2D Dir = Dist > 1.f ? To / Dist : Me.Facing2D();
	const FVector2D Side(-Dir.Y, Dir.X);
	Clock -= Dt;
	BlockLeft -= Dt;
	RunLeft -= Dt;
	StrafeLeft -= Dt;
	BackOffLeft -= Dt;
	ComboGap -= Dt;
	const ECpvState State = Me.GetState();
	const ECpvState FoeState = Foe.GetState();
	auto Chance = [](float PerSecond, float Step) { return FMath::FRand() < PerSecond * Step; };

	// --- things that happen to us ---
	if (State == ECpvState::Held)
	{
		In.bLight = Chance(3.f + 7.f * S, Dt); // mash to wriggle free
		return In;
	}
	if (State == ECpvState::Down)
	{
		In.bLight = Chance(2.f + 5.f * S, Dt);
		return In;
	}
	if (State == ECpvState::Clinch)
	{
		if (Me.GetStateTime() < 0.01f) { ClinchDelay = FMath::FRandRange(0.2f, 0.7f) * (1.3f - S * 0.6f); }
		if (Me.GetStateTime() >= ClinchDelay)
		{
			const float R = FMath::FRand();
			if (R < 0.45f + 0.22f * Style) { In.bHeavy = true; }
			else if (R < 0.72f) { In.bLight = true; }
			else
			{
				In.bGrab = true;
				// Whip toward whichever ropes are further away, for a longer run-up.
				const FVector2D P = Me.Pos2D();
				In.Move = FMath::Abs(P.X) > FMath::Abs(P.Y) ? FVector2D(P.X > 0.0 ? -1.0 : 1.0, 0.0) : FVector2D(0.0, P.Y > 0.0 ? -1.0 : 1.0);
			}
		}
		return In;
	}
	if (State == ECpvState::Attack)
	{
		// Keep a combo going.
		if (ComboLeft > 0 && Me.Move && Me.Move->Chain > 0.f && Me.GetStateTime() >= Me.Move->Chain - 0.05f && ComboGap <= 0.f)
		{
			In.bLight = true;
			--ComboLeft;
			ComboGap = 0.12f;
		}
		return In;
	}
	if (State == ECpvState::Rebound)
	{
		if (Dist < 210.f && FVector2D::DotProduct(Dir, Me.Facing2D()) > 0.5 && Foe.IsStanding())
		{
			if (FMath::FRand() < 0.6f) { In.bLight = true; } else { In.bHeavy = true; }
		}
		return In;
	}
	if (State == ECpvState::BlockStun)
	{
		// Something just bounced off the guard, and more of the string may follow: stay covered.
		BlockLeft = FMath::Max(BlockLeft, 0.28f);
		In.bBlock = true;
		return In;
	}
	if (State != ECpvState::Idle && State != ECpvState::Run && State != ECpvState::Block) { return In; }

	// --- the kill ---
	if (FoeState == ECpvState::Dazed)
	{
		In.Move = Dist > 120.f ? Dir : FVector2D::ZeroVector;
		if (Dist < 170.f && Chance(4.f, Dt)) { In.bSpecial = true; }
		return In;
	}

	// --- defence: react once to each attack we see coming ---
	if (Foe.IsAttacking() && Dist < 210.f)
	{
		const void* Tag = Foe.Move ? static_cast<const void*>(Foe.Move) : static_cast<const void*>(&Foe);
		if (SeenAttack != Tag)
		{
			SeenAttack = Tag;   // one reaction roll per attack, not one per frame
			if (FMath::FRand() < React())
			{
				if (FoeState == ECpvState::GrabTry)
				{
					// Strikes beat grabs, but only from outside their reach: up close, get out of the way.
					if (Dist > 112.f) { In.bLight = true; }
					else { In.bDodge = true; In.Move = -Dir + Side * (FMath::FRand() < 0.5f ? 0.6 : -0.6); BlockLeft = 0.f; }
				}
				else if (FMath::FRand() < 0.28f) { In.bDodge = true; In.Move = -Dir + Side * (FMath::FRand() < 0.5f ? 0.8 : -0.8); }
				else { BlockLeft = FMath::FRandRange(0.35f, 0.6f); }
			}
		}
	}
	else if (!Foe.IsAttacking()) { SeenAttack = nullptr; }

	// --- punish: they swung, it was blocked or it missed, and they are still recovering ---
	if (Foe.IsRecovering() && Dist < 122.f)
	{
		if (!bPunishRolled && Foe.RecoveryLeft() > 0.12f)
		{
			bPunishRolled = true;
			if (FMath::FRand() < Punish())
			{
				BlockLeft = 0.f;
				if (Me.Weapon == ECpvWeapon::None && Foe.RecoveryLeft() > 0.3f && FMath::FRand() < 0.4f) { In.bGrab = true; }
				else
				{
					In.bLight = true;
					ComboLeft = 2;
				}
				return In;
			}
		}
	}
	else { bPunishRolled = false; }

	if (BlockLeft > 0.f)
	{
		In.bBlock = true;
		return In;
	}

	// --- signature move ---
	if (Me.HasFullHype() && Foe.IsStanding() && FoeState != ECpvState::Dodge)
	{
		float Min = 0.f, Max = 600.f;
		switch (Me.Def().Special)
		{
		case ECpvSpecial::Scream: Max = 380.f; break;
		case ECpvSpecial::Flame: Max = 280.f; break;
		case ECpvSpecial::Shockwave: Max = 300.f; break;
		case ECpvSpecial::Scepter: Max = 175.f; break;
		case ECpvSpecial::Bomb: Min = 170.f; break;
		default: Min = 120.f; break;
		}
		if (Dist >= Min && Dist <= Max && Chance(1.5f + 3.f * S, Dt))
		{
			In.bSpecial = true;
			return In;
		}
		// Too close for it: hop back now and then to make room, but keep fighting rather than
		// walking backwards under fire with a full meter.
		if (Dist < Min && Chance(0.9f, Dt))
		{
			In.bDodge = true;
			In.Move = -Dir;
			return In;
		}
	}

	// --- opponent on the mat ---
	if (FoeState == ECpvState::Down || FoeState == ECpvState::GetUp)
	{
		if (DownPlan < 0)
		{
			const float R = FMath::FRand();
			DownPlan = R < 0.4f ? 0 : (R < 0.6f ? 1 : (R < 0.82f ? 2 : 3)); // stomp, splash, taunt, wait
			if (Me.HasFullHype() && DownPlan == 2) { DownPlan = 0; }
			if (Game.bPins && !Game.IsRun() && !Game.IsDemo() && Me.Weapon == ECpvWeapon::None &&
				Foe.Health < 66.f && FMath::FRand() < 0.25f + (66.f - Foe.Health) * 0.009f) { DownPlan = 4; }
		}
		if (DownPlan == 4)
		{
			if (Game.CanCover(&Me)) { In.bGrab = true; }
			else { In.Move = Dir; }
		}
		else if (DownPlan == 2)
		{
			if (Dist < 200.f) { In.Move = -Dir; }
			else if (FoeState == ECpvState::Down && Chance(5.f, Dt)) { In.bTaunt = true; DownPlan = 3; }
		}
		else if (DownPlan == 0 || DownPlan == 1)
		{
			if (Dist > 120.f) { In.Move = Dir; }
			else if (FoeState == ECpvState::Down && Chance(6.f, Dt))
			{
				if (DownPlan == 0) { In.bLight = true; } else { In.bHeavy = true; }
				if (FMath::FRand() < 0.5f) { DownPlan = 3; }
			}
		}
		else if (Dist < 150.f) { In.Move = -Dir; }
		return In;
	}
	DownPlan = -1;

	// --- weapons lying around ---
	FVector WeaponAt;
	const bool bWeaponOnMat = Game.NearestWeapon(Me.Pos2D(), WeaponAt);
	if (Me.Weapon == ECpvWeapon::None && bWeaponOnMat)
	{
		if (Clock <= 0.f && !bWantWeapon) { bWantWeapon = FMath::FRand() < 0.35f + 0.3f * S; }
		const FVector2D ToWeapon = FVector2D(WeaponAt.X, WeaponAt.Y) - Me.Pos2D();
		if (bWantWeapon && ToWeapon.Size() < Dist + 60.f)
		{
			if (ToWeapon.Size() > 85.f) { In.Move = ToWeapon.GetSafeNormal(); }
			else if (Chance(8.f, Dt)) { In.bGrab = true; bWantWeapon = false; }
			return In;
		}
	}
	else { bWantWeapon = false; }

	// --- spacing and offence ---
	if (BackOffLeft > 0.f)
	{
		In.Move = -Dir * 0.9 + Side * StrafeSign * 0.4;
		return In;
	}
	if (Me.Weapon != ECpvWeapon::None && Dist > 190.f && Dist < 345.f && Foe.IsStanding() && Chance(0.5f + S, Dt))
	{
		// The prop travels straight ahead. Turn toward the rival before letting it go.
		if (FVector2D::DotProduct(Me.Facing2D(), Dir) > 0.96) { In.bGrab = true; return In; }
	}
	if (Dist > 300.f)
	{
		In.Move = Dir;
		if (Clock <= 0.f)
		{
			Clock = FMath::FRandRange(0.4f, 0.9f);
			if (FMath::FRand() < 0.3f + 0.2f * S) { RunLeft = 0.9f; }
			else if (!Me.HasFullHype() && FMath::FRand() < 0.12f) { In.bTaunt = true; }
		}
		In.bRun = RunLeft > 0.f;
		return In;
	}
	if (State == ECpvState::Run)
	{
		// Arriving at a sprint: turn it into a running attack.
		In.Move = Dir;
		In.bRun = true;
		if (Dist < 215.f)
		{
			if (FMath::FRand() < 0.55f) { In.bLight = true; } else { In.bHeavy = true; }
		}
		return In;
	}
	if (Dist > 128.f)
	{
		if (StrafeLeft <= 0.f && Clock <= 0.f)
		{
			Clock = FMath::FRandRange(0.3f, 0.7f);
			if (FMath::FRand() < 0.3f)
			{
				StrafeLeft = FMath::FRandRange(0.3f, 0.7f);
				StrafeSign = FMath::FRand() < 0.5f ? 1.f : -1.f;
			}
		}
		In.Move = StrafeLeft > 0.f ? (Side * StrafeSign + Dir * 0.35).GetSafeNormal() : Dir;
		if (Me.Weapon != ECpvWeapon::None && Dist < 175.f && Chance(3.f + 3.f * S, Dt)) { In.bLight = true; }
		return In;
	}

	// Toe to toe. A turtling opponent gets grabbed.
	if (FoeState == ECpvState::Block && Dist < 104.f && Me.Weapon == ECpvWeapon::None && Chance(2.f + 5.f * S, Dt))
	{
		In.bGrab = true;
		return In;
	}
	if (Clock <= 0.f)
	{
		Clock = FMath::FRandRange(0.32f, 0.75f) * (1.4f - S * 0.6f);
		const float R = FMath::FRand();
		if (Me.Weapon != ECpvWeapon::None)
		{
			if (R < 0.6f) { In.bLight = true; }
			else if (R < 0.88f) { In.bHeavy = true; }
			else { BackOffLeft = 0.4f; }
		}
		else if (R < 0.44f - 0.18f * Style)
		{
			In.bLight = true;
			ComboLeft = FMath::RandRange(0, 2) + (S > 0.5f ? 1 : 0);
			ComboLeft = FMath::Min(ComboLeft, 2);
		}
		else if (R < 0.58f) { In.bHeavy = true; }
		else if (R < 0.66f - 0.1f * Style) { In.bHeavy = true; In.Move = Dir; }
		else if (R < 0.86f) { In.bGrab = true; }
		else if (R < 0.93f) { BlockLeft = 0.45f; }
		else
		{
			BackOffLeft = FMath::FRandRange(0.3f, 0.6f);
			StrafeSign = FMath::FRand() < 0.5f ? 1.f : -1.f;
		}
	}
	return In;
}
