using UnrealBuildTool;

public class ClayPerViewEditorTarget : TargetRules
{
	public ClayPerViewEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V8;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_9;
		ExtraModuleNames.Add("ClayPerView");
	}
}
