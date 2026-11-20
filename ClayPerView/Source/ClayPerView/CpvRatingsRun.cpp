// Three episodes make one broadcast. Each headliner has a hand-cast card.
#include "CpvGame.h"
#include "ClayPerView.h"
#include "CpvArena.h"
#include "CpvFighter.h"
#include "Misc/ConfigCacheIni.h"

int32 ACpvGameMode::RivalForEpisode(int32 Stage) const
{
	// The card is cast around the lead. Each rival appears once, and the lead never fights a double.
	static const int32 Cards[][3] = {{3, 2, 6}, {7, 4, 5}, {0, 5, 1}, {5, 4, 0},
		{6, 3, 1}, {1, 2, 7}, {4, 0, 3}, {2, 6, 5}};
	return Cards[Cursor[0]][Stage];
}

const TCHAR* ACpvGameMode::EpisodeName() const
{
	static const TCHAR* Names[] = {TEXT("COLD OPEN"), TEXT("PROP DEPARTMENT"), TEXT("PRIME TIME")};
	return Names[Episode];
}

const TCHAR* ACpvGameMode::EpisodeRule() const
{
	static const TCHAR* Rules[] = {TEXT("One take. Win it to stay on air."), TEXT("Both corners start armed. Grab to throw your prop."),
		TEXT("Both stars start with a full signature meter.")};
	return Rules[Episode];
}

const TCHAR* ACpvGameMode::CrowdCall() const
{
	static const TCHAR* Calls[] = {TEXT("LAND A THREE-HIT COMBO"), TEXT("LAND A PROP HIT"), TEXT("FINISH WITH A CURTAIN CALL")};
	return Calls[Episode];
}

void ACpvGameMode::FulfillCrowdCall()
{
	if (!IsRun() || bCrowdCall) { return; }
	bCrowdCall = true;
	Arena->CrowdPop(0.65f);
	PlaySound("Cheer", 0.65f);
	UE_LOG(LogCpv, Display, TEXT("CPV_CROWD_CALL episode=%d"), Episode + 1);
}

void ACpvGameMode::ScoreEpisode()
{
	if (Winner != 0) { return; }
	EpisodeStars[Episode] = 1 + (Fighters[0]->Health >= CpvRule::MaxHealth * 0.5f ? 1 : 0) + (bCrowdCall ? 1 : 0);
	UE_LOG(LogCpv, Display, TEXT("CPV_SCORE episode=%d stars=%d season=%d"), Episode + 1, EpisodeStars[Episode], SeasonStars());
	if (Episode != 2) { return; }
	const int32 Star = Cursor[0];
	Champions[Difficulty] |= 1 << Star;
	int32& Record = BestShow[Difficulty][Star];
	Record = FMath::Max(Record, SeasonStars());
	const TCHAR* Section = TEXT("ClayPerView.Champions");
	GConfig->SetInt(Section, *FString::FromInt(Difficulty), Champions[Difficulty], GGameUserSettingsIni);
	GConfig->SetInt(Section, *FString::Printf(TEXT("Best_%d_%d"), Difficulty, Star), Record, GGameUserSettingsIni);
	GConfig->Flush(false, GGameUserSettingsIni);
}
