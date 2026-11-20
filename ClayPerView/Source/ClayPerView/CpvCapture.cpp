// Optional offline trailer capture. Only the Unreal viewport and this game's final mix enter the recording.
#include "CpvGame.h"
#include "CpvFighter.h"
#include "ClayPerView.h"
#include "Containers/StringConv.h"
#include "Engine/GameViewportClient.h"
#include "HAL/FileManager.h"
#include "HAL/IConsoleManager.h"
#include "Misc/FileHelper.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "UnrealClient.h"

void ACpvGameMode::OpenCapture()
{
	FString Audit;
	if (FParse::Value(FCommandLine::Get(), TEXT("CpvAudit="), Audit) && !Audit.IsEmpty())
	{
		const FString Folder = FPaths::ProjectSavedDir() / TEXT("MatchTests");
		IFileManager::Get().MakeDirectory(*Folder, true);
		AuditPath = Folder / (FPaths::MakeValidFileName(Audit) + TEXT(".tsv"));
		AuditStart = FPlatformTime::Seconds();
		const auto Setting = [](const TCHAR* Name)
		{
			const IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(Name);
			return Var ? Var->GetInt() : -1;
		};
		const FString Header = FString::Printf(TEXT("# ParallelExecute=%d ParallelDestruction=%d\n"), Setting(TEXT("r.RDG.ParallelExecute")), Setting(TEXT("r.RDG.ParallelDestruction")))
			+ TEXT("seconds\tphase\tmode\tepisode\tround\twinner\tp1_hp\tp2_hp\tstars\tlesson\tpin\tcount\tpaused\tfps\n");
		FFileHelper::SaveStringToFile(Header, *AuditPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
	}
	FString Take;
	if (!FParse::Value(FCommandLine::Get(), TEXT("CpvFilm="), Take) || Take.IsEmpty()) { return; }
	const FString Folder = FPaths::ProjectSavedDir() / TEXT("Shots") / FPaths::MakeValidFileName(Take);
	IFileManager::Get().MakeDirectory(*Folder, true);
	FilmPixels.Reset(IFileManager::Get().CreateFileWriter(*(Folder / TEXT("frames.bgra"))));
	FilmTimings.Reset(IFileManager::Get().CreateFileWriter(*(Folder / TEXT("timing.tsv"))));
	if (!FilmPixels || !FilmTimings) { FilmPixels.Reset(); FilmTimings.Reset(); return; }
	FilmStart = FPlatformTime::Seconds();
	UGameViewportClient::OnScreenshotCaptured().AddUObject(this, &ACpvGameMode::WriteCapture);
	UE_LOG(LogCpv, Display, TEXT("CPV_FILM %s"), *Folder);
}

void ACpvGameMode::TickCapture()
{
	if (!AuditPath.IsEmpty()) { AuditSample(); }
	if (!FilmPixels) { return; }
	const double Now = FPlatformTime::Seconds();
	if (Now >= NextFilmFrame)
	{
		NextFilmFrame = Now + 1.0 / 30.0;
		FScreenshotRequest::RequestScreenshot(false);
	}
}

void ACpvGameMode::AuditSample()
{
	const double Now = FPlatformTime::Seconds() - AuditStart;
	if (static_cast<int32>(Phase) == LastAuditPhase && Now < NextAudit) { return; }
	LastAuditPhase = static_cast<int32>(Phase);
	NextAudit = Now + 2.0;
	const FString Row = FString::Printf(TEXT("%.3f\t%d\t%d\t%d\t%d\t%d\t%.1f\t%.1f\t%d\t%d\t%d\t%d\t%d\t%.1f\n"),
		Now, LastAuditPhase, static_cast<int32>(Mode), Episode + 1, Round, Winner,
		Fighters[0] ? Fighters[0]->Health : 0.f, Fighters[1] ? Fighters[1]->Health : 0.f, SeasonStars(), Lesson,
		PinSlot, PinCount, bPaused ? 1 : 0, MeasuredFPS);
	FFileHelper::SaveStringToFile(Row, *AuditPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM, &IFileManager::Get(), FILEWRITE_Append);
}

void ACpvGameMode::WriteCapture(int32 Width, int32 Height, const TArray<FColor>& Pixels)
{
	if (!FilmPixels || Pixels.Num() != static_cast<int64>(Width) * Height) { return; }
	if (FilmSize == FIntPoint::ZeroValue) { FilmSize = FIntPoint(Width, Height); }
	if (FilmSize != FIntPoint(Width, Height)) { return; }
	FilmPixels->Serialize(const_cast<FColor*>(Pixels.GetData()), Pixels.Num() * sizeof(FColor));
	WriteCaptureTime(FString::Printf(TEXT("frame\t%.6f\t%d\t%d\n"), FPlatformTime::Seconds() - FilmStart, Width, Height));
}

void ACpvGameMode::WriteCaptureTime(const FString& Line)
{
	if (!FilmTimings) { return; }
	FTCHARToUTF8 Bytes(*Line);
	FilmTimings->Serialize(const_cast<void*>(static_cast<const void*>(Bytes.Get())), Bytes.Length());
}

void ACpvGameMode::EndPlay(const EEndPlayReason::Type Reason)
{
	if (FilmPixels)
	{
		UGameViewportClient::OnScreenshotCaptured().RemoveAll(this);
		FilmPixels.Reset();
		FilmTimings.Reset();
	}
	ClosePointer();
	Super::EndPlay(Reason);
}
