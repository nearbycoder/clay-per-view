#pragma once

#include "CoreMinimal.h"
#include "CpvTypes.h"

class ACpvFighter;
class ACpvGameMode;

/** Computer opponent: produces the same input frames a player would. */
struct FCpvAI
{
	int32 Level = 1; // 0 easy, 1 normal, 2 hard

	FCpvInput Think(float Dt, ACpvFighter& Me, ACpvFighter& Foe, ACpvGameMode& Game);
	void Reset();

private:
	float Skill() const { return Level == 0 ? 0.3f : (Level == 1 ? 0.58f : 0.86f); }
	float React() const { return Level == 0 ? 0.18f : (Level == 1 ? 0.5f : 0.8f); }    // chance to defend against an attack it sees coming
	float Punish() const { return Level == 0 ? 0.1f : (Level == 1 ? 0.5f : 0.85f); }   // chance to hit back at somebody recovering from a swing

	float Clock = 0.f;          // time until the next decision
	float BlockLeft = 0.f;
	float RunLeft = 0.f;
	float StrafeLeft = 0.f;
	float StrafeSign = 1.f;
	float BackOffLeft = 0.f;
	int32 ComboLeft = 0;
	float ComboGap = 0.f;
	int32 DownPlan = -1;        // what to do about a floored opponent (chosen once per knockdown)
	const void* SeenAttack = nullptr;
	bool bPunishRolled = false; // one decision per opening
	bool bWantWeapon = false;
	float ClinchDelay = 0.f;
};
