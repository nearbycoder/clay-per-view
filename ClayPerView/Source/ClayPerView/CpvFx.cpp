#include "CpvFx.h"
#include "ClayPerView.h"
#include "CpvPuppet.h"

#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Materials/MaterialInstanceDynamic.h"

namespace
{
	struct FLayerSpec { const TCHAR* Mesh; int32 Capacity; bool bShadow; };
	const FLayerSpec GSpecs[] = {
		{ TEXT("/Game/CPV/Props/SM_FxBlob.SM_FxBlob"), 280, true },
		{ TEXT("/Game/CPV/Props/SM_FxSplat.SM_FxSplat"), 170, false },
		{ TEXT("/Game/CPV/Props/SM_FxPuff.SM_FxPuff"), 70, false },
		{ TEXT("/Game/CPV/Props/SM_FxRing.SM_FxRing"), 12, false },
		{ TEXT("/Game/CPV/Props/SM_FxStar.SM_FxStar"), 70, false },
		{ TEXT("/Game/CPV/Props/SM_FxTooth.SM_FxTooth"), 24, false },
		{ TEXT("/Game/CPV/Props/SM_FxFlame.SM_FxFlame"), 70, false },
		{ TEXT("/Game/CPV/Props/SM_FxNote.SM_FxNote"), 40, false },
		{ TEXT("/Game/CPV/Props/SM_FxBolt.SM_FxBolt"), 14, false },
		{ TEXT("/Game/CPV/Props/SM_FxConfetti.SM_FxConfetti"), 420, false },
		{ TEXT("/Game/CPV/Props/SM_FxBurst.SM_FxBurst"), 14, false },
	};
	const FTransform GHidden(FQuat::Identity, FVector(0.0, 0.0, -2000.0), FVector(0.0001));
}

ACpvFx::ACpvFx()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Rng.Initialize(4242);
}

void ACpvFx::Build(float InMatHalf, float InFloorZ)
{
	MatHalf = InMatHalf;
	FloorZ = InFloorZ;
	for (int32 i = 0; i < L_Count; ++i)
	{
		UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, GSpecs[i].Mesh);
		if (!Mesh)
		{
			UE_LOG(LogCpv, Warning, TEXT("Missing effect mesh %s"), GSpecs[i].Mesh);
			continue;
		}
		UInstancedStaticMeshComponent* Part = NewObject<UInstancedStaticMeshComponent>(this);
		Part->SetStaticMesh(Mesh);
		Part->SetNumCustomDataFloats(3);
		Part->SetMobility(EComponentMobility::Movable);
		Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Part->SetCastShadow(GSpecs[i].bShadow);
		Part->bAffectDistanceFieldLighting = false;
		Part->bAffectDynamicIndirectLighting = false;
		Part->SetupAttachment(RootComponent);
		Part->RegisterComponent();
		FLayer& Layer = Layers[i];
		Layer.Mesh = Part;
		Layer.Parts.SetNum(GSpecs[i].Capacity);
		Layer.Xf.Init(GHidden, GSpecs[i].Capacity);
		Part->AddInstances(Layer.Xf, false, true);
		LayerMeshes.Add(Part);
	}
	UMaterialInterface* Clay = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/CPV/Materials/M_Clay.M_Clay"));
	for (int32 i = 0; i < 6; ++i)
	{
		UStaticMeshComponent* Comp = NewObject<UStaticMeshComponent>(this);
		Comp->SetMobility(EComponentMobility::Movable);
		Comp->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Comp->SetCastShadow(false);
		Comp->SetupAttachment(RootComponent);
		Comp->RegisterComponent();
		Comp->SetVisibility(false);
		UMaterialInstanceDynamic* Mat = Clay ? UMaterialInstanceDynamic::Create(Clay, this) : nullptr;
		FWord W;
		W.Comp = Comp;
		W.Mat = Mat;
		Words.Add(W);
		WordComps.Add(Comp);
		WordMats.Add(Mat);
	}
}

UStaticMesh* ACpvFx::WordMesh(ECpvWord Word)
{
	const uint8 Key = static_cast<uint8>(Word);
	if (TObjectPtr<UStaticMesh>* Found = WordMeshes.Find(Key)) { return *Found; }
	static const TCHAR* Names[] = { TEXT(""), TEXT("Pow"), TEXT("Bam"), TEXT("Wham"), TEXT("Splat"), TEXT("Crunch"), TEXT("Bonk"), TEXT("Oof"), TEXT("KO"), TEXT("Zap"), TEXT("Boom") };
	UStaticMesh* Mesh = Key > 0 && Key < UE_ARRAY_COUNT(Names)
		? LoadObject<UStaticMesh>(nullptr, *FString::Printf(TEXT("/Game/CPV/Props/SM_Word%s.SM_Word%s"), Names[Key], Names[Key])) : nullptr;
	WordMeshes.Add(Key, TObjectPtr<UStaticMesh>(Mesh));
	return Mesh;
}

ACpvFx::FParticle& ACpvFx::Spawn(ELayer LayerId, const FVector& Pos, const FLinearColor& Colour)
{
	FLayer& Layer = Layers[LayerId];
	static FParticle Dummy;
	if (!Layer.Mesh || Layer.Parts.Num() == 0) { Dummy = FParticle(); return Dummy; }
	// Take the next free slot, or recycle the one after the last spawn when the layer is full.
	int32 Slot = Layer.Next;
	for (int32 i = 0; i < Layer.Parts.Num(); ++i)
	{
		const int32 Try = (Layer.Next + i) % Layer.Parts.Num();
		if (!Layer.Parts[Try].bAlive) { Slot = Try; break; }
	}
	Layer.Next = (Slot + 1) % Layer.Parts.Num();
	FParticle& P = Layer.Parts[Slot];
	P = FParticle();
	P.bAlive = true;
	P.Pos = Pos;
	P.Colour = Colour;
	const float Row[3] = { Colour.R, Colour.G, Colour.B };
	Layer.Mesh->SetCustomData(Slot, MakeArrayView(Row, 3), true);
	Layer.bDirty = true;
	return P;
}

void ACpvFx::Impact(const FVector& At, ECpvWord Word, float Size, const FLinearColor& Colour)
{
	FParticle& B = Spawn(L_Burst, At, Colour);
	B.Flags = F_Billboard;
	B.Scale0 = Size * 0.35f;
	B.Scale1 = Size;
	B.Life = 0.3f;
	B.Rot.Roll = Rng.FRandRange(0.f, 360.f);
	if (Word == ECpvWord::None) { return; }
	UStaticMesh* Mesh = WordMesh(Word);
	if (!Mesh) { return; }
	FWord* Use = &Words[0];
	for (FWord& W : Words)
	{
		if (W.Age >= W.Life) { Use = &W; break; }
		if (W.Age > Use->Age) { Use = &W; }
	}
	Use->Comp->SetStaticMesh(Mesh);
	Use->Pos = At + FVector(0.0, 0.0, 34.0 * Size);
	Use->Age = 0.f;
	Use->Life = 0.75f;
	Use->Size = Size * 1.1f;
	Use->Tilt = Rng.FRandRange(-16.f, 16.f);
	if (Use->Mat)
	{
		Use->Comp->SetMaterial(0, Use->Mat);
		static const FLinearColor Inks[] = { FLinearColor(1.f, 0.82f, 0.1f), FLinearColor(1.f, 0.25f, 0.15f), FLinearColor(1.f, 1.f, 1.f), FLinearColor(0.3f, 0.9f, 1.f) };
		Use->Mat->SetVectorParameterValue(TEXT("Tint"), Inks[Rng.RandRange(0, 3)]);
	}
}

void ACpvFx::Blobs(const FVector& At, const FVector& Dir, int32 Count, const FLinearColor& A, const FLinearColor& B, float Speed, bool bStick)
{
	for (int32 i = 0; i < Count; ++i)
	{
		FParticle& P = Spawn(L_Blob, At + Rng.VRand() * 8.0, Rng.FRand() < 0.6f ? A : B);
		const FVector Spread = (Dir.GetSafeNormal() * 0.9 + Rng.VRand() * 0.75 + FVector(0.0, 0.0, 0.7)).GetSafeNormal();
		P.Vel = Spread * Speed * Rng.FRandRange(0.45f, 1.2f);
		P.Gravity = 1500.f;
		P.Scale0 = P.Scale1 = Rng.FRandRange(0.5f, 1.5f);
		P.Axes = FVector(Rng.FRandRange(0.7f, 1.3f), Rng.FRandRange(0.7f, 1.3f), Rng.FRandRange(0.7f, 1.3f));
		P.Rot = FRotator(Rng.FRandRange(0.f, 360.f), Rng.FRandRange(0.f, 360.f), 0.f);
		P.Spin = FRotator(Rng.FRandRange(-500.f, 500.f), Rng.FRandRange(-500.f, 500.f), 0.f);
		P.Life = Rng.FRandRange(5.f, 9.f);
		P.Flags = F_Fall | (bStick ? F_Stick : 0);
	}
}

void ACpvFx::Puff(const FVector& At, float Size, int32 Count, const FLinearColor& Colour)
{
	for (int32 i = 0; i < Count; ++i)
	{
		FParticle& P = Spawn(L_Puff, At + Rng.VRand() * 14.0 * Size, Colour);
		P.Vel = (Rng.VRand() * 60.0 + FVector(0.0, 0.0, 40.0)) * Size;
		P.Drag = 3.f;
		P.Scale0 = Size * 0.3f;
		P.Scale1 = Size * Rng.FRandRange(0.8f, 1.3f);
		P.Rot = FRotator(Rng.FRandRange(0.f, 360.f), Rng.FRandRange(0.f, 360.f), 0.f);
		P.Life = Rng.FRandRange(0.35f, 0.6f);
	}
}

void ACpvFx::Ring(const FVector& At, float Size, const FLinearColor& Colour)
{
	FParticle& P = Spawn(L_Ring, At, Colour);
	P.Scale0 = Size * 0.15f;
	P.Scale1 = Size;
	P.Life = 0.45f;
}

void ACpvFx::Stars(const FVector& At, int32 Count)
{
	for (int32 i = 0; i < Count; ++i)
	{
		FParticle& P = Spawn(L_Star, At, FLinearColor::White);
		P.Vel = (Rng.VRand() + FVector(0.0, 0.0, 0.8)).GetSafeNormal() * Rng.FRandRange(180.f, 420.f);
		P.Gravity = 700.f;
		P.Scale0 = P.Scale1 = Rng.FRandRange(0.7f, 1.4f);
		P.Flags = F_Billboard;
		P.Spin.Roll = Rng.FRandRange(-400.f, 400.f);
		P.Life = Rng.FRandRange(0.45f, 0.8f);
	}
}

void ACpvFx::Teeth(const FVector& At, const FVector& Dir, int32 Count)
{
	for (int32 i = 0; i < Count; ++i)
	{
		FParticle& P = Spawn(L_Tooth, At, FLinearColor::White);
		P.Vel = (Dir.GetSafeNormal() + Rng.VRand() * 0.5 + FVector(0.0, 0.0, 0.9)).GetSafeNormal() * Rng.FRandRange(260.f, 480.f);
		P.Gravity = 1500.f;
		P.Scale0 = P.Scale1 = 1.6f;
		P.Spin = FRotator(Rng.FRandRange(-700.f, 700.f), Rng.FRandRange(-700.f, 700.f), 0.f);
		P.Life = 4.f;
		P.Flags = F_Fall;
	}
}

void ACpvFx::Flames(const FVector& At, const FVector& Dir, int32 Count, float Speed)
{
	for (int32 i = 0; i < Count; ++i)
	{
		FParticle& P = Spawn(L_Flame, At + Rng.VRand() * 10.0, FLinearColor::White);
		P.Vel = (Dir.GetSafeNormal() + Rng.VRand() * 0.28).GetSafeNormal() * Speed * Rng.FRandRange(0.6f, 1.15f) + FVector(0.0, 0.0, 60.0);
		P.Drag = 1.6f;
		P.Scale0 = 0.6f;
		P.Scale1 = Rng.FRandRange(1.3f, 2.4f);
		P.Rot.Yaw = Rng.FRandRange(0.f, 360.f);
		P.Life = Rng.FRandRange(0.3f, 0.55f);
	}
}

void ACpvFx::Notes(const FVector& At, const FVector& Dir, int32 Count, const FLinearColor& Colour)
{
	for (int32 i = 0; i < Count; ++i)
	{
		FParticle& P = Spawn(L_Note, At + Rng.VRand() * 12.0, Colour);
		P.Vel = (Dir.GetSafeNormal() + Rng.VRand() * 0.3).GetSafeNormal() * Rng.FRandRange(380.f, 620.f);
		P.Drag = 0.6f;
		P.Scale0 = 0.8f;
		P.Scale1 = Rng.FRandRange(1.2f, 2.0f);
		P.Flags = F_Billboard;
		P.Rot.Roll = Rng.FRandRange(-25.f, 25.f);
		P.Life = Rng.FRandRange(0.45f, 0.8f);
	}
}

void ACpvFx::Bolt(const FVector& From, const FVector& To)
{
	// A zig-zag of bolt pieces from one point to the other.
	const FVector Delta = To - From;
	const int32 Pieces = FMath::Clamp(FMath::RoundToInt(Delta.Size() / 95.f), 1, 6);
	for (int32 i = 0; i < Pieces; ++i)
	{
		const FVector A = From + Delta * (static_cast<float>(i) / Pieces);
		const FVector B = From + Delta * (static_cast<float>(i + 1) / Pieces);
		FParticle& P = Spawn(L_Bolt, (A + B) * 0.5 + Rng.VRand() * 12.0, FLinearColor::White);
		P.Rot = FRotationMatrix::MakeFromZX(B - A, CamPos - A).Rotator();
		P.Scale0 = P.Scale1 = (B - A).Size() / 100.f;
		P.Axes = FVector(1.0, 1.4, 1.0);
		P.Life = 0.22f;
	}
}

void ACpvFx::Confetti(int32 Count)
{
	static const FLinearColor Colours[] = { FLinearColor(1.f, 0.1f, 0.1f), FLinearColor(1.f, 0.8f, 0.05f), FLinearColor(0.1f, 0.4f, 1.f),
		FLinearColor(0.1f, 0.9f, 0.3f), FLinearColor(1.f, 0.3f, 0.7f), FLinearColor(1.f, 1.f, 1.f) };
	for (int32 i = 0; i < Count; ++i)
	{
		const FVector At(Rng.FRandRange(-MatHalf, MatHalf), Rng.FRandRange(-MatHalf, MatHalf), Rng.FRandRange(380.f, 720.f));
		FParticle& P = Spawn(L_Confetti, At, Colours[Rng.RandRange(0, 5)]);
		P.Vel = FVector(Rng.FRandRange(-40.f, 40.f), Rng.FRandRange(-40.f, 40.f), Rng.FRandRange(-190.f, -90.f));
		P.Scale0 = P.Scale1 = Rng.FRandRange(1.2f, 2.2f);
		P.Rot = FRotator(Rng.FRandRange(0.f, 360.f), Rng.FRandRange(0.f, 360.f), Rng.FRandRange(0.f, 360.f));
		P.Spin = FRotator(Rng.FRandRange(-300.f, 300.f), Rng.FRandRange(-200.f, 200.f), Rng.FRandRange(-300.f, 300.f));
		P.Life = Rng.FRandRange(6.f, 10.f);
		P.Flags = F_Fall | F_Flat;
	}
}

void ACpvFx::Splat(const FVector& At, float Size, const FLinearColor& Colour)
{
	FParticle& P = Spawn(L_Splat, FVector(At.X, At.Y, 0.4 + Rng.FRandRange(0.f, 0.5f)), Colour);
	P.Scale0 = P.Scale1 = Size * Rng.FRandRange(0.7f, 1.25f);
	P.Rot.Yaw = Rng.FRandRange(0.f, 360.f);
	P.Flags = F_Persist;
}

void ACpvFx::Explosion(const FVector& At, float Size)
{
	Puff(At, 2.6f * Size, 7, FLinearColor(0.12f, 0.12f, 0.13f));
	Puff(At + FVector(0.0, 0.0, 30.0), 2.f * Size, 5, FLinearColor(1.f, 0.55f, 0.1f));
	for (int32 i = 0; i < 10; ++i)
	{
		Flames(At, Rng.VRand() + FVector(0.0, 0.0, 0.5), 1, 520.f * Size);
	}
	Ring(FVector(At.X, At.Y, 3.0), 5.f * Size, FLinearColor(1.f, 0.8f, 0.3f));
	Stars(At, 8);
	Impact(At + FVector(0.0, 0.0, 60.0), ECpvWord::Boom, 2.6f * Size, FLinearColor(1.f, 0.7f, 0.1f));
}

void ACpvFx::Halo(int32 Slot, const FVector& HeadTop)
{
	if (Slot >= 0 && Slot < 2)
	{
		HaloSeen[Slot] = Age;
		HaloPos[Slot] = HeadTop;
	}
}

void ACpvFx::Clear(bool bKeepSplats)
{
	for (int32 i = 0; i < L_Count; ++i)
	{
		if (bKeepSplats && i == L_Splat) { continue; }
		for (FParticle& P : Layers[i].Parts) { P.bAlive = false; }
		Layers[i].bDirty = true;
	}
	for (FWord& W : Words)
	{
		W.Age = W.Life;
		if (W.Comp) { W.Comp->SetVisibility(false); }
	}
}

void ACpvFx::StepLayer(FLayer& Layer, float Dt)
{
	if (!Layer.Mesh) { return; }
	bool bAny = Layer.bDirty;
	for (int32 i = 0; i < Layer.Parts.Num(); ++i)
	{
		FParticle& P = Layer.Parts[i];
		if (!P.bAlive)
		{
			Layer.Xf[i] = GHidden;
			continue;
		}
		bAny = true;
		if (!(P.Flags & F_Persist))
		{
			P.Age += Dt;
			if (P.Age >= P.Life)
			{
				P.bAlive = false;
				Layer.Xf[i] = GHidden;
				continue;
			}
		}
		const bool bResting = (P.Flags & F_Fall) && P.Vel.IsNearlyZero(1.0) && P.Age > 0.1f;
		if (!bResting)
		{
			P.Vel.Z -= P.Gravity * Dt;
			P.Vel *= FMath::Max(0.f, 1.f - P.Drag * Dt);
			P.Pos += P.Vel * Dt;
			P.Rot += P.Spin * Dt;
		}
		if (P.Flags & F_Fall)
		{
			// Lands on the mat inside the ring, on the arena floor outside it.
			const bool bOnMat = FMath::Abs(P.Pos.X) < MatHalf && FMath::Abs(P.Pos.Y) < MatHalf;
			const float Ground = (bOnMat ? 0.f : FloorZ) + 2.f;
			if (P.Pos.Z <= Ground && P.Vel.Z <= 0.0)
			{
				P.Pos.Z = Ground;
				if ((P.Flags & F_Stick) && bOnMat && Rng.FRand() < 0.5f)
				{
					Splat(P.Pos, P.Scale0 * 0.42f, P.Colour);
					P.bAlive = false;
					Layer.Xf[i] = GHidden;
					continue;
				}
				if (P.Vel.Z < -220.0 && !(P.Flags & F_Flat))
				{
					P.Vel = FVector(P.Vel.X * 0.45, P.Vel.Y * 0.45, -P.Vel.Z * 0.3);
					P.Spin = P.Spin * 0.4f;
				}
				else
				{
					P.Vel = FVector::ZeroVector;
					P.Spin = FRotator::ZeroRotator;
					if (P.Flags & F_Flat) { P.Rot.Pitch = 0.f; P.Rot.Roll = 0.f; }
				}
			}
		}
		const float U = (P.Flags & F_Persist) ? 0.f : P.Age / P.Life;
		float Scale = FMath::Lerp(P.Scale0, P.Scale1, FMath::Sqrt(U));
		if (U > 0.8f) { Scale *= (1.f - U) / 0.2f; }
		FQuat Q = P.Rot.Quaternion();
		if (P.Flags & F_Billboard)
		{
			Q = (CamPos - P.Pos).Rotation().Quaternion() * FRotator(0.f, 0.f, P.Rot.Roll).Quaternion();
		}
		Layer.Xf[i] = FTransform(Q, P.Pos, P.Axes * Scale);
	}
	if (bAny)
	{
		Layer.Mesh->BatchUpdateInstancesTransforms(0, Layer.Xf, true, true, false);
		Layer.bDirty = false;
	}
}

void ACpvFx::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	Age += DeltaTime;
	StepAccum += DeltaTime;
	bool bStep = ACpvPuppet::StepRate <= 0.f;
	if (!bStep)
	{
		const int64 StepIndex = FMath::FloorToInt64(GetWorld()->GetTimeSeconds() * ACpvPuppet::StepRate);
		bStep = StepIndex != LastStepIndex;
		LastStepIndex = StepIndex;
	}
	if (!bStep) { return; }
	const float Dt = FMath::Clamp(StepAccum, 0.001f, 0.2f);
	StepAccum = 0.f;

	// Dizzy stars: four per dazed head, re-posed every frame they are wanted.
	for (int32 Slot = 0; Slot < 2; ++Slot)
	{
		if (Age - HaloSeen[Slot] > 0.2f) { continue; }
		for (int32 k = 0; k < 4; ++k)
		{
			const float A = Age * 5.5f + k * UE_HALF_PI;
			FParticle& P = Spawn(L_Star, HaloPos[Slot] + FVector(FMath::Cos(A) * 24.0, FMath::Sin(A) * 24.0, 8.0 + 4.0 * FMath::Sin(A * 2.f)), FLinearColor::White);
			P.Flags = F_Billboard;
			P.Scale0 = P.Scale1 = 0.9f;
			P.Life = Dt * 1.05f;
			P.Rot.Roll = A * 40.f;
		}
	}
	for (int32 i = 0; i < L_Count; ++i) { StepLayer(Layers[i], Dt); }

	for (FWord& W : Words)
	{
		if (W.Age >= W.Life || !W.Comp) { continue; }
		W.Age += Dt;
		if (W.Age >= W.Life)
		{
			W.Comp->SetVisibility(false);
			continue;
		}
		const float U = W.Age / W.Life;
		// Pops in with an overshoot, hangs, then shrinks away.
		float Scale = U < 0.18f ? FMath::Lerp(0.3f, 1.25f, U / 0.18f) : (U < 0.3f ? FMath::Lerp(1.25f, 1.f, (U - 0.18f) / 0.12f) : 1.f);
		if (U > 0.82f) { Scale *= (1.f - U) / 0.18f; }
		const FVector Pos = W.Pos + FVector(0.0, 0.0, 26.0 * U);
		const FQuat Q = (CamPos - Pos).Rotation().Quaternion() * FRotator(0.f, 0.f, W.Tilt).Quaternion();
		W.Comp->SetWorldTransform(FTransform(Q, Pos, FVector(Scale * W.Size)));
		W.Comp->SetVisibility(true);
	}
}
