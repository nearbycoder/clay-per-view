#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CpvArena.generated.h"

class UInstancedStaticMeshComponent;
class UMaterialInstanceDynamic;
class UPointLightComponent;
class USceneCaptureComponent2D;
class USpotLightComponent;
class UStaticMeshComponent;
class UTextureRenderTarget2D;
class UExponentialHeightFogComponent;
class UPostProcessComponent;

UENUM()
enum class ECpvLightMood : uint8
{
	House,   // menus: everything up a little
	Show,    // the fight: bright ring, dim colourful crowd
	Entrance,// ring dimmed, stage and beams hot
	Drama,   // finisher: ring in a tight pool of light
};

/** The venue: ring, ropes, stands, crowd, lights, video screens. Everything is spawned from Art/Export data. */
UCLASS()
class ACpvArena : public AActor
{
	GENERATED_BODY()
public:
	ACpvArena();
	void Build();
	virtual void Tick(float DeltaTime) override;

	// --- ring geometry (cm, mat surface at Z = 0) ---
	float MatHalf = 300.f;
	float RopeHalf = 262.f;
	float FloorZ = -110.f;
	float RopeZ[3] = { 50.f, 90.f, 130.f };
	/** How far a fighter's centre may go from the middle of the ring. */
	float RingLimit() const { return RopeHalf - 26.f; }

	/** Ropes: Side 0 = +X, 1 = -X, 2 = +Y, 3 = -Y. Along is -1..1 along that side, Impulse in cm/s outward. */
	void BumpRopes(int32 Side, float Along, float Impulse);
	/** Convenience: bump whichever side a ring position is nearest to. */
	void BumpRopesAt(const FVector& Location, float Impulse);

	// --- crowd ---
	void SetHype(float NewHype) { HypeTarget = FMath::Clamp(NewHype, 0.f, 1.f); }
	void CrowdPop(float Amount) { HypePop = FMath::Clamp(HypePop + Amount, 0.f, 1.f); }
	float GetHype() const { return HypeShown; }

	// --- lights and screens ---
	void SetMood(ECpvLightMood NewMood, float BlendSeconds = 1.f);
	void SetBroadcastFlashes(bool bEnabled);
	void Flash(float Strength) { FlashLevel = FMath::Max(FlashLevel, Strength); }
	UTextureRenderTarget2D* GetStageScreen() const { return StageScreen; }
	UTextureRenderTarget2D* GetSignAtlas() const { return SignAtlas; }
	/** Point the scoreboard's live feed camera (called by the game's camera director). */
	void SetFeedView(const FVector& Location, const FRotator& Rotation, float Fov);
	bool bFeedEnabled = true;
	float FeedInterval = 0.125f;
	void StartTape();
	void StopTape();
	void DiscardTape();
	bool IsTaping() const { return bTaping; }
	float TapeStart = 0.f, TapeEnd = 0.f;
	UTextureRenderTarget2D* TapeFrame(float At) const;

	// --- layout anchors (Unreal coordinates) ---
	FVector StageDoor = FVector(-2020.0, 0.0, -18.0);
	FVector StageFront = FVector(-1510.0, 0.0, -18.0);
	FVector RampBottom = FVector(-700.0, 0.0, -110.0);
	FVector Ringside = FVector(-510.0, 0.0, -110.0);
	FVector HardCam = FVector(0.0, 1120.0, 255.0);
	FVector Bell = FVector(-200.0, -440.0, -22.0);
	TArray<FVector> PyroPoints;
	TArray<FTransform> AnnounceSeats;

private:
	struct FSeat { FVector Pos; float Yaw; int32 Tier; };
	struct FScreen { FString Name; FVector Center; FVector Normal; float Width; float Height; };
	struct FLightSpec { FVector Pos; FVector Dir; FString Kind; };

	bool LoadLayout(TArray<FSeat>& Seats, TArray<FScreen>& Screens, TArray<FLightSpec>& Lights, TArray<FString>& Meshes);
	void BuildMeshes(const TArray<FString>& Meshes);
	void BuildCrowd(const TArray<FSeat>& Seats);
	void BuildRopes();
	void BuildLights(const TArray<FLightSpec>& Lights);
	void BuildScreens(const TArray<FScreen>& Screens);
	void BuildAtmosphere();
	void DrawSignAtlas();
	void UpdateRopes(float DeltaTime);
	void UpdateLights(float DeltaTime);
	UInstancedStaticMeshComponent* MakeInstances(const TCHAR* MeshPath, UMaterialInterface* Material, int32 CustomFloats, bool bShadow);

	UPROPERTY()
	TArray<TObjectPtr<UStaticMeshComponent>> MeshParts;
	UPROPERTY()
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> CrowdParts;
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> RopeMesh;
	UPROPERTY()
	TObjectPtr<UMaterialInstanceDynamic> CrowdMaterial;
	bool bBroadcastFlashes = true;
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> CameraFlashes;
	UPROPERTY()
	TObjectPtr<UMaterialInstanceDynamic> FlashMaterial;
	UPROPERTY()
	TObjectPtr<UMaterialInstanceDynamic> SignMaterial;
	UPROPERTY()
	TObjectPtr<UMaterialInstanceDynamic> RopeMaterial;
	UPROPERTY()
	TArray<TObjectPtr<USpotLightComponent>> KeyLights;
	UPROPERTY()
	TArray<TObjectPtr<USpotLightComponent>> StageLights;
	UPROPERTY()
	TArray<TObjectPtr<USpotLightComponent>> StageBoost;   // long-throw front lights for the entrance
	UPROPERTY()
	TArray<TObjectPtr<USpotLightComponent>> WashLights;
	UPROPERTY()
	TArray<TObjectPtr<UPointLightComponent>> FillLights;
	UPROPERTY()
	TObjectPtr<UPointLightComponent> FlashLight;
	UPROPERTY()
	TObjectPtr<UExponentialHeightFogComponent> Fog;
	UPROPERTY()
	TObjectPtr<UPostProcessComponent> PostProcess;
	UPROPERTY()
	TObjectPtr<USceneCaptureComponent2D> FeedCapture;
	UPROPERTY()
	TObjectPtr<UTextureRenderTarget2D> FeedTarget;
	UPROPERTY()
	TObjectPtr<UTextureRenderTarget2D> StageScreen;
	UPROPERTY()
	TObjectPtr<UTextureRenderTarget2D> SignAtlas;
	UPROPERTY()
	TArray<TObjectPtr<UMaterialInstanceDynamic>> LiveScreens;
	UPROPERTY()
	TArray<TObjectPtr<UTextureRenderTarget2D>> TapeFrames;
	static constexpr int32 TapeCapacity = 48;
	float TapeTimes[TapeCapacity] = {};
	int32 TapeCount = 0, TapeNext = 0;
	bool bTaping = false;
	float NextTapeSample = 0.f;
	void CaptureFeed();

	// ropes
	static constexpr int32 RopeSegments = 16;
	float RopeBend[4] = { 0.f, 0.f, 0.f, 0.f };
	float RopeVel[4] = { 0.f, 0.f, 0.f, 0.f };
	float RopeAt[4] = { 0.5f, 0.5f, 0.5f, 0.5f };
	TArray<FTransform> RopeXforms;

	// crowd energy
	float HypeTarget = 0.3f;
	float HypeShown = 0.3f;
	float HypePop = 0.f;

	// lights
	ECpvLightMood Mood = ECpvLightMood::Show;
	float KeyLevel = 1.f, StageLevel = 0.3f, WashLevel = 0.6f, FillLevel = 1.f;
	float KeyGoal = 1.f, StageGoal = 0.3f, WashGoal = 0.6f, FillGoal = 1.f;
	float Exposure = 0.f, ExposureGoal = 0.f;   // exposure compensation in stops (the stage is far dimmer than the ring)
	float MoodRate = 1.f;
	float FlashLevel = 0.f;
	TArray<FRotator> WashBase;
	float FeedClock = 0.f;
	float Age = 0.f;
	bool bBuilt = false;
};
