#include "CpvArena.h"
#include "ClayPerView.h"
#include "CpvUi.h"

#include "Components/ExponentialHeightFogComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/PostProcessComponent.h"
#include "Components/SceneCaptureComponent2D.h"
#include "Components/SpotLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/Canvas.h"
#include "Engine/StaticMesh.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Kismet/KismetRenderingLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
	FVector ReadVec(const TSharedPtr<FJsonObject>& Obj, const TCHAR* Field)
	{
		const TArray<TSharedPtr<FJsonValue>>* A = nullptr;
		if (Obj.IsValid() && Obj->TryGetArrayField(Field, A) && A->Num() >= 3)
		{
			return FVector((*A)[0]->AsNumber(), (*A)[1]->AsNumber(), (*A)[2]->AsNumber());
		}
		return FVector::ZeroVector;
	}

	FLinearColor Srgb(uint8 R, uint8 G, uint8 B) { return FLinearColor(FColor(R, G, B)); }

	// Base light strengths in candelas; moods scale these.
	const float KeyCandelas = 30000.f;
	const float StageCandelas = 9000.f;
	const float WashCandelas = 16000.f;
	const float FillCandelas = 20000.f;
}

ACpvArena::ACpvArena()
{
	PrimaryActorTick.bCanEverTick = true;
	USceneComponent* Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Root->SetMobility(EComponentMobility::Static);
	RootComponent = Root;
}

bool ACpvArena::LoadLayout(TArray<FSeat>& Seats, TArray<FScreen>& Screens, TArray<FLightSpec>& Lights, TArray<FString>& Meshes)
{
	const FString Path = FPaths::ProjectContentDir() / TEXT("CPV/Data/arena_layout.json");
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *Path))
	{
		UE_LOG(LogCpv, Error, TEXT("Missing %s (run build.sh --assets)"), *Path);
		return false;
	}
	TSharedPtr<FJsonObject> Root;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Root) || !Root.IsValid())
	{
		UE_LOG(LogCpv, Error, TEXT("Could not parse %s"), *Path);
		return false;
	}
	if (const TSharedPtr<FJsonObject>* Ring = nullptr; Root->TryGetObjectField(TEXT("ring"), Ring))
	{
		MatHalf = (*Ring)->GetNumberField(TEXT("mat_half"));
		RopeHalf = (*Ring)->GetNumberField(TEXT("rope_half"));
		FloorZ = (*Ring)->GetNumberField(TEXT("floor_z"));
		const TArray<TSharedPtr<FJsonValue>>& Z = (*Ring)->GetArrayField(TEXT("rope_z"));
		for (int32 i = 0; i < 3 && i < Z.Num(); ++i) { RopeZ[i] = Z[i]->AsNumber(); }
	}
	for (const TSharedPtr<FJsonValue>& V : Root->GetArrayField(TEXT("meshes"))) { Meshes.Add(V->AsString()); }
	for (const TSharedPtr<FJsonValue>& V : Root->GetArrayField(TEXT("seats")))
	{
		const TArray<TSharedPtr<FJsonValue>>& A = V->AsArray();
		if (A.Num() >= 5)
		{
			Seats.Add({ FVector(A[0]->AsNumber(), A[1]->AsNumber(), A[2]->AsNumber()), static_cast<float>(A[3]->AsNumber()), static_cast<int32>(A[4]->AsNumber()) });
		}
	}
	for (const TSharedPtr<FJsonValue>& V : Root->GetArrayField(TEXT("screens")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		Screens.Add({ O->GetStringField(TEXT("name")), ReadVec(O, TEXT("center")), ReadVec(O, TEXT("normal")),
			static_cast<float>(O->GetNumberField(TEXT("width"))), static_cast<float>(O->GetNumberField(TEXT("height"))) });
	}
	for (const TSharedPtr<FJsonValue>& V : Root->GetArrayField(TEXT("lights")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		Lights.Add({ ReadVec(O, TEXT("pos")), ReadVec(O, TEXT("dir")), O->GetStringField(TEXT("kind")) });
	}
	if (const TSharedPtr<FJsonObject>* Stage = nullptr; Root->TryGetObjectField(TEXT("stage"), Stage))
	{
		StageDoor = ReadVec(*Stage, TEXT("door"));
		StageFront = ReadVec(*Stage, TEXT("front"));
		RampBottom = ReadVec(*Stage, TEXT("ramp_bottom"));
		Ringside = ReadVec(*Stage, TEXT("ringside"));
	}
	if (const TArray<TSharedPtr<FJsonValue>>* Pyro = nullptr; Root->TryGetArrayField(TEXT("pyro"), Pyro))
	{
		for (const TSharedPtr<FJsonValue>& V : *Pyro)
		{
			const TArray<TSharedPtr<FJsonValue>>& A = V->AsArray();
			if (A.Num() >= 3) { PyroPoints.Add(FVector(A[0]->AsNumber(), A[1]->AsNumber(), A[2]->AsNumber())); }
		}
	}
	if (const TArray<TSharedPtr<FJsonValue>>* Seats2 = nullptr; Root->TryGetArrayField(TEXT("announce"), Seats2))
	{
		for (const TSharedPtr<FJsonValue>& V : *Seats2)
		{
			const TSharedPtr<FJsonObject> O = V->AsObject();
			AnnounceSeats.Add(FTransform(FRotator(0.f, O->GetNumberField(TEXT("yaw")), 0.f), ReadVec(O, TEXT("pos"))));
		}
	}
	Bell = ReadVec(Root, TEXT("bell"));
	if (const TSharedPtr<FJsonObject>* Cam = nullptr; Root->TryGetObjectField(TEXT("camera"), Cam)) { HardCam = ReadVec(*Cam, TEXT("hard")); }
	return true;
}

void ACpvArena::Build()
{
	if (bBuilt) { return; }
	bBuilt = true;
	TArray<FSeat> Seats;
	TArray<FScreen> Screens;
	TArray<FLightSpec> Lights;
	TArray<FString> Meshes;
	if (!LoadLayout(Seats, Screens, Lights, Meshes)) { return; }
	BuildMeshes(Meshes);
	BuildRopes();
	BuildScreens(Screens);
	if (!FParse::Param(FCommandLine::Get(), TEXT("CpvNoCrowd"))) { BuildCrowd(Seats); }
	BuildLights(Lights);
	BuildAtmosphere();
	SetMood(ECpvLightMood::Show, 0.f);
	UE_LOG(LogCpv, Display, TEXT("Arena built: %d meshes, %d seats, %d lights, %d screens"), Meshes.Num(), Seats.Num(), Lights.Num(), Screens.Num());
}

void ACpvArena::BuildMeshes(const TArray<FString>& Meshes)
{
	for (const FString& Name : Meshes)
	{
		UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, *FString::Printf(TEXT("/Game/CPV/Arena/%s.%s"), *Name, *Name));
		if (!Mesh)
		{
			UE_LOG(LogCpv, Warning, TEXT("Missing arena mesh %s"), *Name);
			continue;
		}
		UStaticMeshComponent* Part = NewObject<UStaticMeshComponent>(this);
		Part->SetStaticMesh(Mesh);
		Part->SetMobility(EComponentMobility::Static);
		Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Part->SetupAttachment(RootComponent);
		Part->RegisterComponent();
		MeshParts.Add(Part);
	}
}

UInstancedStaticMeshComponent* ACpvArena::MakeInstances(const TCHAR* MeshPath, UMaterialInterface* Material, int32 CustomFloats, bool bShadow)
{
	UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, MeshPath);
	if (!Mesh)
	{
		UE_LOG(LogCpv, Warning, TEXT("Missing mesh %s"), MeshPath);
		return nullptr;
	}
	UInstancedStaticMeshComponent* Part = NewObject<UInstancedStaticMeshComponent>(this);
	Part->SetStaticMesh(Mesh);
	if (Material) { Part->SetMaterial(0, Material); }
	Part->SetNumCustomDataFloats(CustomFloats);
	Part->SetMobility(EComponentMobility::Movable);
	Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Part->SetCastShadow(bShadow);
	Part->bAffectDistanceFieldLighting = false;
	Part->bAffectDynamicIndirectLighting = false;
	Part->SetupAttachment(RootComponent);
	Part->RegisterComponent();
	return Part;
}

void ACpvArena::BuildCrowd(const TArray<FSeat>& Seats)
{
	UMaterialInterface* CrowdBase = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/CPV/Materials/M_Crowd.M_Crowd"));
	UMaterialInterface* FlashBase = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/CPV/Materials/M_Flash.M_Flash"));
	UMaterialInterface* SignBase = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/CPV/Materials/M_Sign.M_Sign"));
	CrowdMaterial = CrowdBase ? UMaterialInstanceDynamic::Create(CrowdBase, this) : nullptr;
	FlashMaterial = FlashBase ? UMaterialInstanceDynamic::Create(FlashBase, this) : nullptr;
	SignMaterial = SignBase ? UMaterialInstanceDynamic::Create(SignBase, this) : nullptr;
	DrawSignAtlas();
	if (SignMaterial && SignAtlas) { SignMaterial->SetTextureParameterValue(TEXT("Atlas"), SignAtlas); }

	const TCHAR* VariantPaths[5] = {
		TEXT("/Game/CPV/Crowd/SM_CrowdA.SM_CrowdA"), TEXT("/Game/CPV/Crowd/SM_CrowdB.SM_CrowdB"), TEXT("/Game/CPV/Crowd/SM_CrowdC.SM_CrowdC"),
		TEXT("/Game/CPV/Crowd/SM_CrowdD.SM_CrowdD"), TEXT("/Game/CPV/Crowd/SM_CrowdFar.SM_CrowdFar") };
	UInstancedStaticMeshComponent* People[5];
	TArray<FTransform> Xf[5];
	TArray<float> Data[5];
	for (int32 i = 0; i < 5; ++i) { People[i] = MakeInstances(VariantPaths[i], CrowdMaterial, 12, false); }
	UInstancedStaticMeshComponent* Chairs = MakeInstances(TEXT("/Game/CPV/Props/SM_Chair.SM_Chair"), nullptr, 0, false);
	UInstancedStaticMeshComponent* Signs = MakeInstances(TEXT("/Game/CPV/Crowd/SM_Sign.SM_Sign"), SignMaterial, 2, false);
	CameraFlashes = MakeInstances(TEXT("/Engine/BasicShapes/Sphere.Sphere"), FlashMaterial, 1, false);
	TArray<FTransform> ChairXf, SignXf, FlashXf;
	TArray<float> SignData, FlashData;

	const FLinearColor Shirts[] = {
		Srgb(200, 40, 40), Srgb(36, 86, 196), Srgb(242, 194, 48), Srgb(40, 150, 90), Srgb(230, 110, 30), Srgb(130, 60, 190),
		Srgb(235, 235, 228), Srgb(30, 30, 34), Srgb(255, 90, 160), Srgb(25, 170, 160), Srgb(120, 125, 135), Srgb(150, 30, 50),
		Srgb(70, 160, 230), Srgb(245, 245, 245) };
	const FLinearColor Trousers[] = { Srgb(50, 70, 120), Srgb(30, 40, 70), Srgb(28, 28, 32), Srgb(150, 130, 95), Srgb(90, 92, 100), Srgb(70, 50, 40) };

	FRandomStream Rng(19981);
	for (const FSeat& Seat : Seats)
	{
		// Only the floor seats and the first few rows get the detailed figures; everyone further back is the light version.
		const bool bFar = Seat.Tier == 2 || (Seat.Tier == 1 && Seat.Pos.Z > 110.0);
		const int32 V = bFar ? 4 : Rng.RandRange(0, 3);
		const float Scale = bFar ? Rng.FRandRange(1.0f, 1.16f) : Rng.FRandRange(0.92f, 1.08f);
		const float Yaw = Seat.Yaw + Rng.FRandRange(-10.f, 10.f);
		const FRotator Rot(0.f, Yaw, 0.f);
		const FVector Forward = Rot.Vector();
		const FVector Loc = Seat.Pos + FVector(Rng.FRandRange(-5.f, 5.f), Rng.FRandRange(-5.f, 5.f), 0.f);
		const FLinearColor Shirt = Shirts[Rng.RandRange(0, UE_ARRAY_COUNT(Shirts) - 1)];
		const FLinearColor Legs = Trousers[Rng.RandRange(0, UE_ARRAY_COUNT(Trousers) - 1)];
		float Excite = Rng.FRand();
		if (Seat.Tier == 0) { Excite *= 0.75f; }
		const float Phase = Rng.FRand();
		const bool bSign = !bFar && Rng.FRand() < 0.04f;
		if (bSign)
		{
			Excite = 0.f; // sign holders stay on their feet
			SignXf.Add(FTransform(Rot, Loc + FVector(0.0, 0.0, 150.0 * Scale) + Forward * 18.0, FVector(Scale)));
			SignData.Add(static_cast<float>(Rng.RandRange(0, 15)));
			SignData.Add(Phase);
		}
		if (Seat.Tier >= 1 && Rng.FRand() < 0.085f)
		{
			FlashXf.Add(FTransform(FRotator::ZeroRotator, Loc + FVector(0.0, 0.0, 125.0) + Forward * 22.0, FVector(0.11)));
			FlashData.Add(Rng.FRand());
		}
		if (Seat.Tier == 0) { ChairXf.Add(FTransform(Rot, Seat.Pos)); }
		Xf[V].Add(FTransform(Rot, Loc, FVector(Scale)));
		const float YawRad = FMath::DegreesToRadians(Yaw);
		const float Row[12] = { Shirt.R, Shirt.G, Shirt.B, Legs.R, Legs.G, Legs.B, FMath::Pow(Rng.FRand(), 1.4f), Rng.FRand(), Phase, Excite,
			FMath::Cos(YawRad) * Scale, FMath::Sin(YawRad) * Scale };
		Data[V].Append(Row, 12);
	}
	auto Fill = [](UInstancedStaticMeshComponent* Part, const TArray<FTransform>& Transforms, const TArray<float>& Custom, int32 Floats)
	{
		if (!Part || Transforms.Num() == 0) { return; }
		Part->AddInstances(Transforms, false, true);
		for (int32 i = 0; i < Transforms.Num() && Floats > 0; ++i)
		{
			Part->SetCustomData(i, MakeArrayView(&Custom[i * Floats], Floats), false);
		}
		Part->MarkRenderStateDirty();
	};
	for (int32 i = 0; i < 5; ++i)
	{
		Fill(People[i], Xf[i], Data[i], 12);
		if (People[i]) { CrowdParts.Add(People[i]); }
	}
	Fill(Chairs, ChairXf, TArray<float>(), 0);
	Fill(Signs, SignXf, SignData, 2);
	Fill(CameraFlashes, FlashXf, FlashData, 1);
}

void ACpvArena::DrawSignAtlas()
{
	SignAtlas = UKismetRenderingLibrary::CreateRenderTarget2D(this, 1024, 1024, RTF_RGBA8_SRGB, FLinearColor::White);
	if (!SignAtlas) { return; }
	UCanvas* Canvas = nullptr;
	FVector2D Size;
	FDrawToRenderTargetContext Context;
	UKismetRenderingLibrary::BeginDrawCanvasToRenderTarget(this, SignAtlas, Canvas, Size, Context);
	if (Canvas)
	{
		const TCHAR* Slogans[16][2] = {
			{ TEXT("CLAY"), TEXT("> CGI") }, { TEXT("HI"), TEXT("MOM!") }, { TEXT("SQUISH"), TEXT("HIM!") }, { TEXT("I LUV"), TEXT("LOLA") },
			{ TEXT("REX"), TEXT("4 PREZ") }, { TEXT("MY EX IS"), TEXT("A LUMP") }, { TEXT("THIS IS"), TEXT("A SIGN") }, { TEXT("CHEF'S"), TEXT("KISS!") },
			{ TEXT("DROP"), TEXT("THE BASS") }, { TEXT("OFF WITH"), TEXT("HIS HEAD") }, { TEXT("CANCEL"), TEXT("HIM!") }, { TEXT("RATINGS"), TEXT("GOLD") },
			{ TEXT("MOLD &"), TEXT("HOLD") }, { TEXT("VINCE"), TEXT("SHREDS") }, { TEXT("WE WANT"), TEXT("SPLAT") }, { TEXT("MYSTICA"), TEXT("KNEW") } };
		const FLinearColor Cards[] = { Srgb(255, 240, 150), Srgb(255, 255, 255), Srgb(255, 190, 210), Srgb(190, 235, 255), Srgb(200, 255, 190), Srgb(255, 215, 160) };
		const FLinearColor Inks[] = { Srgb(200, 30, 30), Srgb(25, 40, 120), Srgb(20, 20, 24), Srgb(120, 30, 150) };
		for (int32 i = 0; i < 16; ++i)
		{
			const float X = (i % 4) * 256.f, Y = (i / 4) * 256.f;
			CpvUi::Fill(Canvas, X, Y, 256.f, 256.f, Cards[i % UE_ARRAY_COUNT(Cards)]);
			const FLinearColor Ink = Inks[(i * 7) % UE_ARRAY_COUNT(Inks)];
			for (int32 Line = 0; Line < 2; ++Line)
			{
				const FString Str = Slogans[i][Line];
				float Pt = 86.f;
				while (Pt > 24.f && CpvUi::Measure(Str, CpvUi::Font(ECpvFont::Comic, Pt)).X > 226.f) { Pt -= 4.f; }
				CpvUi::Text(Canvas, Str, X + 128.f, Y + 34.f + Line * 96.f + (86.f - Pt) * 0.5f, CpvUi::Font(ECpvFont::Comic, Pt), Ink, ECpvAlign::Center);
			}
		}
	}
	UKismetRenderingLibrary::EndDrawCanvasToRenderTarget(this, Context);
}

void ACpvArena::BuildRopes()
{
	UMaterialInterface* Clay = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/CPV/Materials/M_Clay.M_Clay"));
	RopeMaterial = Clay ? UMaterialInstanceDynamic::Create(Clay, this) : nullptr;
	RopeMesh = MakeInstances(TEXT("/Game/CPV/Props/SM_RopeSeg.SM_RopeSeg"), RopeMaterial, 3, true);
	if (!RopeMesh) { return; }
	RopeXforms.SetNum(4 * 3 * RopeSegments);
	RopeMesh->AddInstances(RopeXforms, false, true);
	const FLinearColor Tints[3] = { Srgb(40, 70, 190), Srgb(238, 236, 228), Srgb(200, 40, 40) }; // bottom, middle, top
	for (int32 i = 0; i < RopeXforms.Num(); ++i)
	{
		const FLinearColor& C = Tints[(i / RopeSegments) % 3];
		const float Row[3] = { C.R, C.G, C.B };
		RopeMesh->SetCustomData(i, MakeArrayView(Row, 3), false);
	}
	UpdateRopes(0.f);
}

void ACpvArena::BumpRopes(int32 Side, float Along, float Impulse)
{
	if (Side < 0 || Side > 3) { return; }
	RopeVel[Side] += Impulse;
	RopeAt[Side] = FMath::Clamp(Along * 0.5f + 0.5f, 0.12f, 0.88f);
}

void ACpvArena::BumpRopesAt(const FVector& Location, float Impulse)
{
	if (FMath::Abs(Location.X) > FMath::Abs(Location.Y))
	{
		BumpRopes(Location.X > 0.0 ? 0 : 1, Location.Y / RopeHalf, Impulse);
	}
	else
	{
		BumpRopes(Location.Y > 0.0 ? 2 : 3, Location.X / RopeHalf, Impulse);
	}
}

void ACpvArena::UpdateRopes(float DeltaTime)
{
	if (!RopeMesh) { return; }
	const int32 Sub = FMath::Clamp(FMath::CeilToInt(DeltaTime / 0.008f), 1, 8);
	const float H = DeltaTime / Sub;
	for (int32 S = 0; S < 4; ++S)
	{
		for (int32 i = 0; i < Sub; ++i)
		{
			RopeVel[S] += (-260.f * RopeBend[S] - 5.5f * RopeVel[S]) * H;
			RopeBend[S] += RopeVel[S] * H;
		}
		RopeBend[S] = FMath::Clamp(RopeBend[S], -70.f, 90.f);
	}
	const FVector Normals[4] = { FVector(1, 0, 0), FVector(-1, 0, 0), FVector(0, 1, 0), FVector(0, -1, 0) };
	const FVector Tangents[4] = { FVector(0, 1, 0), FVector(0, 1, 0), FVector(1, 0, 0), FVector(1, 0, 0) };
	int32 Index = 0;
	for (int32 S = 0; S < 4; ++S)
	{
		for (int32 Level = 0; Level < 3; ++Level)
		{
			const float LevelScale = Level == 1 ? 1.f : 0.8f;
			FVector Prev;
			for (int32 i = 0; i <= RopeSegments; ++i)
			{
				const float U = static_cast<float>(i) / RopeSegments;
				const float Peak = RopeAt[S];
				const float Tent = U < Peak ? U / Peak : (1.f - U) / (1.f - Peak);
				const float Shape = FMath::Pow(FMath::Clamp(Tent, 0.f, 1.f), 1.25f);
				const FVector P = Normals[S] * (RopeHalf + RopeBend[S] * Shape * LevelScale) + Tangents[S] * (RopeHalf * (U * 2.f - 1.f))
					+ FVector(0.0, 0.0, RopeZ[Level] - 2.5 * FMath::Sin(U * UE_PI));
				if (i > 0)
				{
					const FVector D = P - Prev;
					RopeXforms[Index++] = FTransform(FRotationMatrix::MakeFromX(D).ToQuat(), (P + Prev) * 0.5, FVector(D.Size() / 100.0 * 1.03, 1.0, 1.0));
				}
				Prev = P;
			}
		}
	}
	RopeMesh->BatchUpdateInstancesTransforms(0, RopeXforms, true, true, false);
}

void ACpvArena::BuildScreens(const TArray<FScreen>& Screens)
{
	UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/CPV/Materials/M_Screen.M_Screen"));
	UStaticMesh* Plane = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Plane.Plane"));
	FeedTarget = UKismetRenderingLibrary::CreateRenderTarget2D(this, 640, 360, RTF_RGBA8_SRGB, FLinearColor::Black);
	StageScreen = UKismetRenderingLibrary::CreateRenderTarget2D(this, 1024, 540, RTF_RGBA8_SRGB, FLinearColor(0.01f, 0.01f, 0.03f));
	if (!Base || !Plane) { return; }
	for (const FScreen& Screen : Screens)
	{
		UStaticMeshComponent* Part = NewObject<UStaticMeshComponent>(this);
		Part->SetStaticMesh(Plane);
		Part->SetMobility(EComponentMobility::Movable);
		Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Part->SetCastShadow(false);
		Part->SetupAttachment(RootComponent);
		Part->RegisterComponent();
		// Plane X runs along the picture's width, Y down its height, Z out of the screen.
		const FVector N = Screen.Normal.GetSafeNormal();
		const FVector Right = FVector::CrossProduct(N, FVector::UpVector).GetSafeNormal();
		const FMatrix Basis(Right, FVector(0.0, 0.0, -1.0), N, FVector::ZeroVector);
		Part->SetWorldTransform(FTransform(Basis.ToQuat(), Screen.Center + N * 1.0, FVector(Screen.Width / 100.0, Screen.Height / 100.0, 1.0)));
		UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(Base, this);
		const bool bStage = Screen.Name == TEXT("stage");
		Mid->SetTextureParameterValue(TEXT("Screen"), bStage ? StageScreen : FeedTarget);
		Mid->SetScalarParameterValue(TEXT("LedGrid"), bStage ? 190.f : 120.f);
		Mid->SetScalarParameterValue(TEXT("Intensity"), bStage ? 325.f : 650.f);
		Part->SetMaterial(0, Mid);
		if (!bStage) { LiveScreens.Add(Mid); }
		MeshParts.Add(Part);
	}
	FeedCapture = NewObject<USceneCaptureComponent2D>(this);
	FeedCapture->SetupAttachment(RootComponent);
	FeedCapture->SetMobility(EComponentMobility::Movable);
	FeedCapture->TextureTarget = FeedTarget;
	FeedCapture->CaptureSource = SCS_FinalColorLDR;
	FeedCapture->bCaptureEveryFrame = false;
	FeedCapture->bCaptureOnMovement = false;
	FeedCapture->bAlwaysPersistRenderingState = true;
	FeedCapture->FOVAngle = 40.f;
	FeedCapture->RegisterComponent();
	FeedCapture->SetWorldLocationAndRotation(HardCam, (FVector(0.0, 0.0, 60.0) - HardCam).Rotation());
}

void ACpvArena::SetFeedView(const FVector& Location, const FRotator& Rotation, float Fov)
{
	if (FeedCapture)
	{
		FeedCapture->SetWorldLocationAndRotation(Location, Rotation);
		FeedCapture->FOVAngle = Fov;
	}
}

void ACpvArena::BuildLights(const TArray<FLightSpec>& Lights)
{
	auto MakeSpot = [this](const FLightSpec& Spec, float Inner, float Outer, float Radius, const FLinearColor& Colour, bool bShadows, float Volumetric)
	{
		USpotLightComponent* L = NewObject<USpotLightComponent>(this);
		L->SetMobility(EComponentMobility::Movable);
		L->SetupAttachment(RootComponent);
		L->SetIntensityUnits(ELightUnits::Candelas);
		L->SetInnerConeAngle(Inner);
		L->SetOuterConeAngle(Outer);
		L->SetAttenuationRadius(Radius);
		L->SetLightColor(Colour, false);
		L->SetCastShadows(bShadows);
		L->SetVolumetricScatteringIntensity(Volumetric);
		L->SetSourceRadius(10.f);
		L->RegisterComponent();
		L->SetWorldLocationAndRotation(Spec.Pos, Spec.Dir.Rotation());
		return L;
	};
	int32 KeyCount = 0;
	for (const FLightSpec& Spec : Lights)
	{
		if (Spec.Kind == TEXT("key"))
		{
			// The truss carries sixteen lamps but only the inner two per side are real lights (at double
			// strength), and one of each pair casts shadows: every extra overlapping light costs per pixel.
			const int32 InSide = KeyCount++ % 4;
			if (InSide == 1 || InSide == 2)
			{
				KeyLights.Add(MakeSpot(Spec, 19.f, 34.f, 1500.f, FLinearColor(1.f, 0.93f, 0.82f), InSide == 1, 0.8f));
			}
		}
		else if (Spec.Kind == TEXT("stage"))
		{
			StageLights.Add(MakeSpot(Spec, 12.f, 24.f, 2400.f, FLinearColor(0.72f, 0.84f, 1.f), false, 1.4f));
		}
		else if (Spec.Kind == TEXT("wash"))
		{
			WashLights.Add(MakeSpot(Spec, 9.f, 17.f, 3300.f, FLinearColor(1.f, 0.2f, 0.5f), false, 2.2f));
			WashBase.Add(Spec.Dir.Rotation());
		}
	}
	// The stage arch back-lights whoever walks out, so three spots on the ring truss light their faces.
	for (int32 i = -1; i <= 1; ++i)
	{
		FLightSpec Spec;
		Spec.Pos = FVector(-640.0, i * 300.0, 700.0);
		Spec.Dir = (FVector(-1600.0, i * 90.0, 40.0) - Spec.Pos).GetSafeNormal();
		USpotLightComponent* L = MakeSpot(Spec, 9.f, 17.f, 3200.f, FLinearColor(1.f, 0.95f, 0.88f), i == 0, 0.9f);
		StageLights.Add(L);
		StageBoost.Add(L);
	}
	// Cool overhead fill so the stands never fall to black.
	for (int32 i = 0; i < 4; ++i)
	{
		const float A = UE_TWO_PI * (i + 0.5f) / 4.f;
		UPointLightComponent* L = NewObject<UPointLightComponent>(this);
		L->SetMobility(EComponentMobility::Movable);
		L->SetupAttachment(RootComponent);
		L->SetIntensityUnits(ELightUnits::Candelas);
		L->SetAttenuationRadius(4400.f);
		L->SetLightColor(FLinearColor(0.5f, 0.62f, 1.f), false);
		L->SetCastShadows(false);
		L->SetVolumetricScatteringIntensity(0.f);
		L->SetSourceRadius(60.f);
		L->RegisterComponent();
		L->SetWorldLocation(FVector(FMath::Cos(A) * 1750.0, FMath::Sin(A) * 1750.0, 1250.0));
		FillLights.Add(L);
	}
	FlashLight = NewObject<UPointLightComponent>(this);
	FlashLight->SetMobility(EComponentMobility::Movable);
	FlashLight->SetupAttachment(RootComponent);
	FlashLight->SetIntensityUnits(ELightUnits::Candelas);
	FlashLight->SetAttenuationRadius(2600.f);
	FlashLight->SetCastShadows(false);
	FlashLight->SetVolumetricScatteringIntensity(0.4f);
	FlashLight->SetIntensity(0.f);
	FlashLight->RegisterComponent();
	FlashLight->SetWorldLocation(FVector(0.0, 0.0, 430.0));
}

void ACpvArena::BuildAtmosphere()
{
	Fog = NewObject<UExponentialHeightFogComponent>(this);
	Fog->SetupAttachment(RootComponent);
	Fog->SetMobility(EComponentMobility::Movable);
	Fog->RegisterComponent();
	Fog->SetWorldLocation(FVector(0.0, 0.0, FloorZ));
	Fog->SetFogDensity(0.012f);
	Fog->SetFogHeightFalloff(0.002f);
	Fog->SetFogInscatteringColor(FLinearColor(0.f, 0.f, 0.f));
	Fog->SetVolumetricFog(true);
	Fog->SetVolumetricFogScatteringDistribution(0.55f);
	Fog->SetVolumetricFogExtinctionScale(0.55f);
	Fog->SetVolumetricFogAlbedo(FColor(225, 230, 245));
	Fog->SetVolumetricFogDistance(7000.f);

	PostProcess = NewObject<UPostProcessComponent>(this);
	PostProcess->SetupAttachment(RootComponent);
	PostProcess->bUnbound = true;
	PostProcess->Priority = 1.f;
	FPostProcessSettings& S = PostProcess->Settings;
	S.bOverride_AutoExposureMethod = true;
	S.AutoExposureMethod = AEM_Histogram;
	S.bOverride_AutoExposureMinBrightness = true;
	S.bOverride_AutoExposureMaxBrightness = true;
	S.AutoExposureMinBrightness = 8.6f;   // fixed exposure (EV100): the show is lit like a TV studio
	S.AutoExposureMaxBrightness = 8.6f;
	S.bOverride_AutoExposureBias = true;
	S.AutoExposureBias = 0.f;
	S.bOverride_BloomIntensity = true;
	S.BloomIntensity = 0.55f;
	S.bOverride_VignetteIntensity = true;
	S.VignetteIntensity = 0.45f;
	S.bOverride_MotionBlurAmount = true;
	S.MotionBlurAmount = 0.f;
	S.bOverride_FilmGrainIntensity = true;
	S.FilmGrainIntensity = 0.12f;
	S.bOverride_ColorSaturation = true;
	S.ColorSaturation = FVector4(1.08, 1.08, 1.08, 1.0);
	S.bOverride_ColorContrast = true;
	S.ColorContrast = FVector4(1.04, 1.04, 1.04, 1.0);
	PostProcess->RegisterComponent();
	if (FeedCapture)
	{
		// A manually triggered scene capture has no continuous eye-adaptation history. Match the
		// studio camera at EV100 8.6 (f/4, 1/24s, ISO 100), including on the first taped frame.
		FPostProcessSettings& Camera = FeedCapture->PostProcessSettings;
		Camera = S;
		Camera.AutoExposureMethod = AEM_Manual;
		Camera.bOverride_AutoExposureApplyPhysicalCameraExposure = true;
		Camera.AutoExposureApplyPhysicalCameraExposure = true;
		Camera.bOverride_CameraISO = Camera.bOverride_CameraShutterSpeed = Camera.bOverride_DepthOfFieldFstop = true;
		Camera.CameraISO = 100.f;
		Camera.CameraShutterSpeed = 24.f;
		Camera.DepthOfFieldFstop = 4.f;
		FeedCapture->PostProcessBlendWeight = 1.f;
	}
}

void ACpvArena::SetBroadcastFlashes(bool bEnabled)
{
	bBroadcastFlashes = bEnabled;
	if (CameraFlashes) { CameraFlashes->SetVisibility(bEnabled); }
	if (!bEnabled && FlashLight) { FlashLevel = 0.f; FlashLight->SetIntensity(0.f); }
}

void ACpvArena::SetMood(ECpvLightMood NewMood, float BlendSeconds)
{
	Mood = NewMood;
	switch (NewMood)
	{
	case ECpvLightMood::House: KeyGoal = 0.75f; StageGoal = 0.5f; WashGoal = 0.35f; FillGoal = 2.6f; ExposureGoal = 0.2f; break;
	case ECpvLightMood::Show: KeyGoal = 1.f; StageGoal = 0.25f; WashGoal = 0.9f; FillGoal = 1.44f; ExposureGoal = 0.f; break;
	case ECpvLightMood::Entrance: KeyGoal = 0.2f; StageGoal = 1.15f; WashGoal = 1.32f; FillGoal = 0.88f; ExposureGoal = 0.85f; break;
	case ECpvLightMood::Drama: KeyGoal = 1.05f; StageGoal = 0.1f; WashGoal = 0.5f; FillGoal = 0.9f; ExposureGoal = 0.35f; break;
	}
	MoodRate = BlendSeconds > 0.f ? 1.f / BlendSeconds : 0.f;
	if (BlendSeconds <= 0.f)
	{
		KeyLevel = KeyGoal; StageLevel = StageGoal; WashLevel = WashGoal; FillLevel = FillGoal; Exposure = ExposureGoal;
	}
}

void ACpvArena::UpdateLights(float DeltaTime)
{
	auto Approach = [&](float& Value, float Goal)
	{
		Value = MoodRate > 0.f ? FMath::FInterpConstantTo(Value, Goal, DeltaTime, MoodRate * 1.2f) : Goal;
	};
	Approach(KeyLevel, KeyGoal);
	Approach(StageLevel, StageGoal);
	Approach(WashLevel, WashGoal);
	Approach(FillLevel, FillGoal);
	Exposure = MoodRate > 0.f ? FMath::FInterpConstantTo(Exposure, ExposureGoal, DeltaTime, MoodRate * 2.6f) : ExposureGoal;
	if (PostProcess) { PostProcess->Settings.AutoExposureBias = Exposure; }
	for (USpotLightComponent* L : KeyLights) { L->SetIntensity(KeyCandelas * KeyLevel); }
	for (USpotLightComponent* L : StageLights) { L->SetIntensity(StageCandelas * StageLevel * (StageBoost.Contains(L) ? 5.f : 1.f)); }
	for (UPointLightComponent* L : FillLights) { L->SetIntensity(FillCandelas * FillLevel); }
	// Wash lights sweep the stands and drift between two colours.
	const float Speed = Mood == ECpvLightMood::Entrance ? 1.6f : 0.55f;
	for (int32 i = 0; i < WashLights.Num(); ++i)
	{
		const float Phase = i * 1.31f;
		FRotator R = WashBase[i];
		R.Yaw += 26.f * FMath::Sin(Age * Speed + Phase);
		R.Pitch += 9.f * FMath::Sin(Age * Speed * 0.7f + Phase * 2.f);
		WashLights[i]->SetWorldRotation(R);
		const float Mix = 0.5f + 0.5f * FMath::Sin(Age * 0.35f + i * 0.9f);
		const FLinearColor A = (i % 2 == 0) ? FLinearColor(1.f, 0.12f, 0.45f) : FLinearColor(0.1f, 0.55f, 1.f);
		const FLinearColor B = (i % 2 == 0) ? FLinearColor(1.f, 0.55f, 0.1f) : FLinearColor(0.45f, 0.2f, 1.f);
		WashLights[i]->SetLightColor(FMath::Lerp(A, B, Mix), false);
		WashLights[i]->SetIntensity(WashCandelas * WashLevel);
	}
	if (FlashLight)
	{
		FlashLevel = FMath::Max(0.f, FlashLevel - DeltaTime * 6.f);
		FlashLight->SetIntensity(bBroadcastFlashes ? FlashLevel * 220000.f : 0.f);
	}
}

void ACpvArena::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	if (!bBuilt) { return; }
	Age += DeltaTime;
	UpdateRopes(DeltaTime);
	UpdateLights(DeltaTime);

	HypePop = FMath::Max(0.f, HypePop - DeltaTime * 0.45f);
	HypeShown = FMath::FInterpTo(HypeShown, FMath::Clamp(HypeTarget + HypePop, 0.f, 1.f), DeltaTime, 5.f);
	if (CrowdMaterial) { CrowdMaterial->SetScalarParameterValue(TEXT("Hype"), HypeShown); }
	if (FlashMaterial) { FlashMaterial->SetScalarParameterValue(TEXT("Hype"), HypeShown); }
	if (SignMaterial) { SignMaterial->SetScalarParameterValue(TEXT("Hype"), HypeShown); }

	// The scoreboard's live feed refreshes a few times a second, like the cast does.
	FeedClock += DeltaTime;
	if (FeedCapture && bFeedEnabled && FeedClock >= FeedInterval)
	{
		FeedClock = 0.f;
		CaptureFeed();
	}
}
