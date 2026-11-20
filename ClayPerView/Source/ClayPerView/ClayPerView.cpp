#include "ClayPerView.h"
#include "Modules/ModuleManager.h"

#if PLATFORM_MAC && !WITH_EDITOR
#include "Misc/CommandLine.h"
#include "Misc/DelayedAutoRegister.h"
#include "Misc/Parse.h"

// Unreal reads the engine window mode before the game instance exists. Start with a
// drawable window even if an older profile saved borderless mode. TickDisplay then
// applies the player's fullscreen preference once macOS can perform the transition.
static FDelayedAutoRegisterHelper StartMacWindow(EDelayedRegisterRunPhase::EarliestPossiblePluginsLoaded, []()
{
	if (FParse::Param(FCommandLine::Get(), TEXT("fullscreen")))
	{
		FCommandLine::Append(TEXT(" -CpvFullscreen"));
	}
	if (!FParse::Param(FCommandLine::Get(), TEXT("windowed")))
	{
		FCommandLine::Append(TEXT(" -windowed"));
	}
});
#endif

DEFINE_LOG_CATEGORY(LogCpv);

IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, ClayPerView, "ClayPerView");
