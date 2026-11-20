#include "CpvTypes.h"

namespace
{
	FLinearColor C(uint8 R, uint8 G, uint8 B) { return FLinearColor(FColor(R, G, B)); }

	FCpvMove Make(FName Clip, float HitTime, float Duration, float Damage, float Range, float Lunge, ECpvReaction Reaction, float Knockback,
		float HitStop, ECpvWord Word, FName Sound, float Chain = 0.f, float Lift = 0.f, float Arc = 55.f)
	{
		FCpvMove M;
		M.Clip = Clip; M.HitTime = HitTime; M.Duration = Duration; M.Damage = Damage; M.Range = Range; M.Lunge = Lunge;
		M.Reaction = Reaction; M.Knockback = Knockback; M.HitStop = HitStop; M.Word = Word; M.Sound = Sound; M.Chain = Chain;
		M.Lift = Lift; M.Arc = Arc;
		return M;
	}

	FCpvMove Ground(FCpvMove M)
	{
		M.bHitsStanding = false;
		M.bHitsDown = true;
		return M;
	}
}

namespace CpvData
{
	//                                clip           hit    dur    dmg  range lunge reaction                 push   stop   word              sound      chain  lift
	const FCpvMove Jab = Make("Jab", 0.10f, 0.30f, 4.f, 118.f, 26.f, ECpvReaction::Light, 150.f, 0.05f, ECpvWord::None, "Punch", 0.19f);
	const FCpvMove Cross = Make("Cross", 0.16f, 0.42f, 6.f, 124.f, 34.f, ECpvReaction::Light, 200.f, 0.07f, ECpvWord::None, "Punch", 0.27f);
	const FCpvMove Uppercut = Make("Uppercut", 0.22f, 0.56f, 10.f, 118.f, 30.f, ECpvReaction::Launch, 190.f, 0.13f, ECpvWord::Pow, "Heavy", 0.f, 640.f);
	const FCpvMove Haymaker = Make("Haymaker", 0.46f, 0.95f, 15.f, 132.f, 52.f, ECpvReaction::Knockdown, 420.f, 0.15f, ECpvWord::Bam, "Heavy");
	const FCpvMove Boot = Make("Boot", 0.24f, 0.68f, 11.f, 150.f, 40.f, ECpvReaction::Heavy, 520.f, 0.11f, ECpvWord::Wham, "Kick");
	const FCpvMove Clothesline = Make("Clothesline", 0.15f, 0.6f, 13.f, 120.f, 150.f, ECpvReaction::Knockdown, 380.f, 0.13f, ECpvWord::Wham, "Heavy", 0.f, 0.f, 75.f);
	const FCpvMove Dropkick = Make("Dropkick", 0.26f, 1.45f, 17.f, 170.f, 190.f, ECpvReaction::Launch, 560.f, 0.15f, ECpvWord::Bam, "Kick", 0.f, 420.f);
	const FCpvMove Stomp = Ground(Make("Stomp", 0.26f, 0.55f, 6.f, 115.f, 30.f, ECpvReaction::Light, 0.f, 0.08f, ECpvWord::None, "Stomp"));
	const FCpvMove Splash = Ground(Make("Splash", 0.60f, 1.6f, 14.f, 150.f, 0.f, ECpvReaction::Light, 0.f, 0.14f, ECpvWord::Splat, "Slam"));
	const FCpvMove WeaponSwing = Make("WeaponSwing", 0.24f, 0.62f, 9.f, 165.f, 34.f, ECpvReaction::Heavy, 360.f, 0.12f, ECpvWord::Bonk, "Weapon");
	const FCpvMove WeaponSmash = Make("WeaponSmash", 0.36f, 0.86f, 13.f, 160.f, 40.f, ECpvReaction::Knockdown, 300.f, 0.16f, ECpvWord::Crunch, "Weapon");

	const TArray<FCpvFighterDef>& Roster()
	{
		static const TArray<FCpvFighterDef> List = {
			{ TEXT("Rex"), TEXT("REX GRANITE"), TEXT("Straight-to-Streaming Action Hero"), TEXT("\"I do my own stunts. And yours.\""),
			  5, 2, 4, C(214, 60, 44), C(201, 138, 94), C(86, 104, 58), "TauntFlex", TEXT("BOX OFFICE BOMB"), ECpvSpecial::Bomb,
			  TEXT("DIRECTOR'S CUT"), ECpvFinisher::Explode, TEXT("Rex") },
			{ TEXT("Lola"), TEXT("LOLA GLITZ"), TEXT("Chart-Topping Pop Diva"), TEXT("\"You may clap now.\""),
			  2, 5, 2, C(255, 45, 149), C(242, 196, 164), C(255, 45, 149), "TauntDance", TEXT("HIGH NOTE"), ECpvSpecial::Scream,
			  TEXT("MIC DROP"), ECpvFinisher::MicDrop, TEXT("Lola") },
			{ TEXT("Bruno"), TEXT("CHEF BRUNO FLAMBE"), TEXT("Volcanic TV Chef"), TEXT("\"It's raw! Like you!\""),
			  4, 2, 5, C(240, 236, 226), C(219, 162, 124), C(241, 238, 230), "TauntKiss", TEXT("FLAMBE"), ECpvSpecial::Flame,
			  TEXT("ORDER UP!"), ECpvFinisher::RollingPin, TEXT("Bruno") },
			{ TEXT("Chip"), TEXT("CHIP STERLING"), TEXT("Tech Billionaire, Allegedly Human"), TEXT("\"Your face is my next acquisition.\""),
			  2, 4, 2, C(142, 149, 159), C(239, 208, 184), C(142, 149, 159), "TauntPhone", TEXT("PUSH NOTIFICATION"), ECpvSpecial::Zap,
			  TEXT("LAUNCH DAY"), ECpvFinisher::Rocket, TEXT("Chip") },
			{ TEXT("Wubz"), TEXT("DJ WUBZ"), TEXT("Festival Headliner, Face Unknown"), TEXT("\"...\"  (the visor shows a thumbs-up)"),
			  3, 4, 3, C(57, 231, 95), C(57, 231, 95), C(123, 47, 247), "TauntDance", TEXT("BASS DROP"), ECpvSpecial::Shockwave,
			  TEXT("WALL OF SOUND"), ECpvFinisher::Speaker, TEXT("Wubz") },
			{ TEXT("Duchess"), TEXT("DUCHESS WINNIFRED"), TEXT("Frostiest Royal in the Tabloids"), TEXT("\"One does not sweat. One glistens.\""),
			  3, 3, 3, C(126, 87, 194), C(243, 215, 198), C(94, 42, 150), "TauntWave", TEXT("ROYAL DECREE"), ECpvSpecial::Scepter,
			  TEXT("OFF WITH THE HEAD"), ECpvFinisher::HeadPop, TEXT("Duchess") },
			{ TEXT("Vince"), TEXT("VINCE VOLTAGE"), TEXT("Stadium Rock Survivor"), TEXT("\"This one goes out to your dentist.\""),
			  3, 3, 3, C(179, 32, 42), C(230, 195, 173), C(179, 32, 42), "TauntRock", TEXT("POWER CHORD"), ECpvSpecial::Chord,
			  TEXT("ENCORE"), ECpvFinisher::Encore, TEXT("Vince") },
			{ TEXT("Mystica"), TEXT("MADAME MYSTICA"), TEXT("Late-Night TV Psychic"), TEXT("\"I foresee a lot of pain in your future.\""),
			  3, 2, 4, C(21, 127, 134), C(169, 113, 78), C(21, 127, 134), "TauntMystic", TEXT("CRYSTAL BALL"), ECpvSpecial::Orb,
			  TEXT("TINY FATE"), ECpvFinisher::Shrink, TEXT("Mystica") },
		};
		return List;
	}

	const FCpvFighterDef& Fighter(int32 Index)
	{
		const TArray<FCpvFighterDef>& List = Roster();
		return List[((Index % List.Num()) + List.Num()) % List.Num()];
	}

	const FCpvWeaponDef& Weapon(ECpvWeapon Type)
	{
		static const FCpvWeaponDef Defs[] = {
			{ TEXT("NOTHING"), TEXT(""), 0.f, 0, ECpvWord::None, "Punch", FVector::ZeroVector, 0.f },
			{ TEXT("FOLDING CHAIR"), TEXT("/Game/CPV/Props/SM_Chair.SM_Chair"), 8.f, 3, ECpvWord::Crunch, "Chair", FVector(-18.0, 0.0, 84.0), 6.f },
			{ TEXT("GUITAR"), TEXT("/Game/CPV/Props/SM_Guitar.SM_Guitar"), 10.f, 2, ECpvWord::Bam, "Guitar", FVector(0.0, 0.0, 6.0), 8.f },
			{ TEXT("GOLD STAR AWARD"), TEXT("/Game/CPV/Props/SM_Trophy.SM_Trophy"), 7.f, 4, ECpvWord::Bonk, "Bonk", FVector(0.0, 0.0, 18.0), 7.f },
			{ TEXT("FRYING PAN"), TEXT("/Game/CPV/Props/SM_Pan.SM_Pan"), 7.f, 5, ECpvWord::Bonk, "Pan", FVector(0.0, 0.0, 8.0), 5.f },
			{ TEXT("MALLET"), TEXT("/Game/CPV/Props/SM_Mallet.SM_Mallet"), 11.f, 3, ECpvWord::Wham, "Bonk", FVector(0.0, 0.0, 10.0), 6.f },
			{ TEXT("RUBBER CHICKEN"), TEXT("/Game/CPV/Props/SM_Chicken.SM_Chicken"), 2.f, 6, ECpvWord::Oof, "Squeak", FVector(0.0, 0.0, 2.0), 12.f },
			{ TEXT("STUDIO CLAPPERBOARD"), TEXT("/Game/CPV/Props/SM_Slate.SM_Slate"), 6.f, 4, ECpvWord::Bam, "Clapboard", FVector(0.0, -21.0, 40.0), 9.f },
		};
		return Defs[static_cast<int32>(Type) < UE_ARRAY_COUNT(Defs) ? static_cast<int32>(Type) : 0];
	}
}
