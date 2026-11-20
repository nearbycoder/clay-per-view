#pragma once

#include "CoreMinimal.h"
#include "CpvTypes.h"
#include "GameFramework/Actor.h"
#include "CpvFx.generated.h"

class UInstancedStaticMeshComponent;
class UMaterialInstanceDynamic;
class UStaticMesh;
class UStaticMeshComponent;

/**
 * Every effect is a lump of clay: impact bursts, comic words, flying chunks that stick to the mat,
 * cotton-wool puffs, flames, music notes. They move on the same stepped clock as the cast.
 */
UCLASS()
class ACpvFx : public AActor
{
	GENERATED_BODY()
public:
	ACpvFx();
	void Build(float InMatHalf, float InFloorZ);
	virtual void Tick(float DeltaTime) override;
	void SetCamera(const FVector& InCamPos) { CamPos = InCamPos; }

	void Impact(const FVector& At, ECpvWord Word, float Size, const FLinearColor& Colour);
	void Blobs(const FVector& At, const FVector& Dir, int32 Count, const FLinearColor& A, const FLinearColor& B, float Speed, bool bStick = true);
	void Puff(const FVector& At, float Size, int32 Count = 3, const FLinearColor& Colour = FLinearColor::White);
	void Ring(const FVector& At, float Size, const FLinearColor& Colour);
	void Stars(const FVector& At, int32 Count);
	void Teeth(const FVector& At, const FVector& Dir, int32 Count);
	void Flames(const FVector& At, const FVector& Dir, int32 Count, float Speed = 420.f);
	void Notes(const FVector& At, const FVector& Dir, int32 Count, const FLinearColor& Colour);
	void Bolt(const FVector& From, const FVector& To);
	void Confetti(int32 Count);
	void Splat(const FVector& At, float Size, const FLinearColor& Colour);
	void Explosion(const FVector& At, float Size);
	/** Dizzy stars circling a head; call every frame it should show. */
	void Halo(int32 Slot, const FVector& HeadTop);
	void Clear(bool bKeepSplats);

private:
	enum ELayer { L_Blob, L_Splat, L_Puff, L_Ring, L_Star, L_Tooth, L_Flame, L_Note, L_Bolt, L_Confetti, L_Burst, L_Count };
	enum EFlags : uint8 { F_Billboard = 1, F_Stick = 2, F_Persist = 4, F_Fall = 8, F_Flat = 16 };

	struct FParticle
	{
		bool bAlive = false;
		FVector Pos = FVector::ZeroVector;
		FVector Vel = FVector::ZeroVector;
		FRotator Rot = FRotator::ZeroRotator;
		FRotator Spin = FRotator::ZeroRotator;
		FVector Axes = FVector(1.0, 1.0, 1.0);
		float Scale0 = 1.f, Scale1 = 1.f;
		float Age = 0.f, Life = 1.f;
		float Gravity = 0.f, Drag = 0.f;
		uint8 Flags = 0;
		FLinearColor Colour = FLinearColor::White;
	};

	struct FLayer
	{
		UInstancedStaticMeshComponent* Mesh = nullptr;
		TArray<FParticle> Parts;
		TArray<FTransform> Xf;
		int32 Next = 0;
		bool bDirty = true;
	};

	struct FWord
	{
		UStaticMeshComponent* Comp = nullptr;
		UMaterialInstanceDynamic* Mat = nullptr;
		FVector Pos = FVector::ZeroVector;
		float Age = 0.f, Life = 0.f, Size = 1.f, Tilt = 0.f;
	};

	FParticle& Spawn(ELayer Layer, const FVector& Pos, const FLinearColor& Colour);
	void StepLayer(FLayer& Layer, float Dt);
	UStaticMesh* WordMesh(ECpvWord Word);

	UPROPERTY()
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> LayerMeshes;
	UPROPERTY()
	TArray<TObjectPtr<UStaticMeshComponent>> WordComps;
	UPROPERTY()
	TArray<TObjectPtr<UMaterialInstanceDynamic>> WordMats;
	UPROPERTY()
	TMap<uint8, TObjectPtr<UStaticMesh>> WordMeshes;

	FLayer Layers[L_Count];
	TArray<FWord> Words;
	FVector CamPos = FVector(0.0, 1100.0, 250.0);
	float MatHalf = 300.f;
	float FloorZ = -110.f;
	float StepAccum = 0.f;
	int64 LastStepIndex = -1;
	float HaloSeen[2] = { -10.f, -10.f };
	FVector HaloPos[2];
	float Age = 0.f;
	FRandomStream Rng;
};
