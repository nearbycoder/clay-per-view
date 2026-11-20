using UnrealBuildTool;

public class ClayPerView : ModuleRules
{
	public ClayPerView(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "Slate", "SlateCore", "Json", "RenderCore", "RHI", "AssetRegistry", "ApplicationCore", "AudioMixer" });
	}
}
