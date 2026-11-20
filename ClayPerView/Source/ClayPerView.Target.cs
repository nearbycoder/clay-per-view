using UnrealBuildTool;

public class ClayPerViewTarget : TargetRules
{
	public ClayPerViewTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V8;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_9;
		ExtraModuleNames.Add("ClayPerView");
	}
}
