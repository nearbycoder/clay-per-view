// Port of CpvGameScenes.cpp: scripted set pieces - entrances, Curtain Call finishers and the victory scene.
//
// A sequence runs its steps in the order they are added (a step waits for every step added before it),
// so the Seq.At calls below keep the order they have in the C++.

import { FLinearColor, FMath, FRotator, FVector, FVector2D, UE_PI } from '../engine/ue';
import { ECpvLightMood } from './CpvArena';
import { ACpvGameMode, ECpvPhase, implement } from './CpvGame';
import { ECpvBone, ECpvFace } from './CpvPose';
import { ACpvPuppet } from './CpvPuppet';
import { ECpvFinisher, ECpvState, ECpvWeapon, ECpvWord } from './CpvTypes';

function YawOf2D(D: FVector2D): number { return FMath.RadiansToDegrees(FMath.Atan2(D.Y, D.X)); }
function EaseIn(U: number): number { return U * U; }
function EaseOut(U: number): number { return 1 - (1 - U) * (1 - U); }

implement(ACpvGameMode, {
  Tween(Duration, Fn) {
    this.Tweens.push({ Age: 0, Life: FMath.Max(Duration, 0.001), Fn });
  },

  TickTweens(Dt) {
    for (let i = 0; i < this.Tweens.length; ++i) {
      const T = this.Tweens[i];
      T.Age += Dt;
      const U = FMath.Clamp(T.Age / T.Life, 0, 1);
      T.Fn(U);
    }
    for (let i = this.Tweens.length - 1; i >= 0; --i) {
      if (this.Tweens[i].Age >= this.Tweens[i].Life) { this.Tweens.splice(i, 1); }
    }
  },

  HideProps() {
    for (const Comp of this.PropPool) { Comp.SetVisibility(false); }
    this.Weapons.length = 0;
    this.Projectiles.length = 0;
    this.Tweens.length = 0;
    if (this.LooseHead) { this.LooseHead.bHidden = true; }
  },

  // ---------------------------------------------------------------------------------------------
  // Entrances
  // ---------------------------------------------------------------------------------------------

  StartIntro() {
    this.SetPhase(ECpvPhase.Intro);
    this.BuildIntro();
  },

  BuildIntro() {
    const Seq = this.Seq;
    Seq.Reset();
    this.Arena.SetMood(ECpvLightMood.Entrance, 0.8);
    this.Letterbox = 1;
    for (let i = 0; i < 2; ++i) { this.Fighters[i].bHidden = true; }
    const Door = this.Arena.StageDoor.Add(new FVector(40, 0, 0));
    const Lip = this.Arena.StageFront;
    const Down = FMath.Lerp(this.Arena.StageFront, this.Arena.RampBottom, 0.3);
    const Foot = this.Arena.RampBottom;

    for (let i = 0; i < 2; ++i) {
      const T0 = i * 4.2;
      const F = this.Fighters[i];
      Seq.At(T0, () => {
        const Def = F.Def();
        this.Fighters[1 - i].bHidden = true;
        F.bHidden = false;
        F.SetActorLocationAndRotation(Door, FRotator.ZeroRotator);
        F.UpdateMirror();
        F.Play('Strut', 0);
        F.ForceStep();
        this.NameCard = Def.Name;
        this.NameCardSub = Def.Title;
        this.NameCardAge = 0;
        this.DrawStageScreen('NOW ENTERING', Def.Name, Def.Colour);
        this.PlaySound(`Theme_${Def.VoiceId}`, 0.58);
        this.PlaySound(`VO_Name_${Def.VoiceId}`);
        this.PlaySound('Pyro');
        this.PlaySound('Cheer', 0.9);
        this.Arena.CrowdPop(0.7);
        this.Arena.Flash(0.5);
        for (const Pot of this.Arena.PyroPoints) { this.Fx.Flames(Pot, new FVector(0, 0, 1), 6, 700); }
        // Open on the whole arena, then pick the first star up on the ramp.
        if (i === 0) {
          this.CutTo(new FVector(1160, 1650, 910), new FVector(-440, -100, 105), 62);
          this.MoveTo(new FVector(1050, 1520, 840), new FVector(-470, -90, 115), 58, 1.3);
        } else {
          this.CutTo(Foot.Add(new FVector(-40, -135, 92)), Door.Add(new FVector(120, 0, 130)), 36);
          this.MoveTo(Foot.Add(new FVector(80, -48, 72)), Down.Add(new FVector(0, 0, 112)), 39, 0.8);
        }
        // Walk out of the tunnel, across the stage and a little way down the ramp.
        this.Tween(2.5, (U) => {
          const P = U < 0.62 ? FMath.Lerp(Door, Lip, U / 0.62) : FMath.Lerp(Lip, Down, (U - 0.62) / 0.38);
          F.SetActorLocation(P);
        });
      });
      if (i === 0) {
        Seq.At(1.05, () => {
          this.CutTo(Foot.Add(new FVector(70, 180, 110)), Down.Add(new FVector(-175, 0, 116)), 39);
          this.MoveTo(Foot.Add(new FVector(90, 40, 78)), Down.Add(new FVector(0, 0, 112)), 40, 1.1);
        });
      }
      Seq.At(T0 + 0.5, () => { for (const Pot of this.Arena.PyroPoints) { this.Fx.Flames(Pot, new FVector(0, 0, 1), 5, 760); } });
      Seq.At(T0 + 1.0, () => {
        for (const Pot of this.Arena.PyroPoints) {
          this.Fx.Flames(Pot, new FVector(0, 0, 1), 5, 820);
          this.Fx.Stars(Pot.Add(new FVector(0, 0, 120)), 4);
        }
      });
      Seq.At(T0 + 2.5, () => {
        F.Play(F.Def().Taunt, 0.12);
        this.Arena.CrowdPop(0.5);
      });
    }
    Seq.At(8.4, () => { this.FadeOut = 1; });
    Seq.At(8.6, () => {
      this.FadeOut = 0;
      this.NameCard = '';
    });
  },

  // ---------------------------------------------------------------------------------------------
  // Victory
  // ---------------------------------------------------------------------------------------------

  BuildMatchEnd() {
    const Seq = this.Seq;
    Seq.Reset();
    const W = this.Fighters[this.Winner];
    const L = this.Fighters[1 - this.Winner];
    if (this.bWonByPin) { L.SetScripted(true); L.Play('DownBack', 0.16); }
    else if (L.GetState() !== ECpvState.Dead) { L.Kill(true); }
    W.SetScripted(false);
    W.Celebrate();
    W.SetActorRotation(new FRotator(0, 90, 0)); // face the broadcast camera
    W.UpdateMirror();
    this.Letterbox = 0;
    this.FinisherPrompt = 0;
    this.Arena.SetMood(ECpvLightMood.Show, 1);
    this.Arena.SetHype(1);
    this.Arena.CrowdPop(1);
    this.Arena.Flash(0.6);
    this.Fx.Confetti(140);
    this.ConfettiClock = 0.4;
    this.PlaySound('Bell');
    this.PlaySound('Fanfare');
    this.PlaySound('Cheer', 1);
    const bChampion = this.IsRun() && this.Episode === 2 && this.Winner === 0;
    if (bChampion) {
      W.SetHandProp(null, FVector.ZeroVector);
      const Title = this.TakeProp('/Game/CPV/Props/SM_Belt.SM_Belt');
      if (Title) {
        // Two hands support the strap while the face of the medal stays level for the camera.
        this.Tween(7.2, () => {
          const Left = W.GetBoneLocation(ECpvBone.HandL);
          const Right = W.GetBoneLocation(ECpvBone.HandR);
          Title.SetWorldLocationAndRotation(Left.Add(Right).Mul(0.5).Add(new FVector(0, 5, 9)), new FRotator(0, 90, 0));
        });
      }
    }
    this.PlaySound(bChampion ? 'VO_Champ' : 'VO_Wrap');
    this.ShowBanner(bChampion ? 'CHAMPION!' : "THAT'S A WRAP!", `${W.Def().Name} WINS`, 4.5, W.Def().Colour, 1.1);
    this.DrawStageScreen(bChampion ? 'PRIME TIME CHAMPION' : 'YOUR WINNER', W.Def().Name, W.Def().Colour);
    const At = W.GetActorLocation();
    this.CutTo(At.Add(new FVector(-300, 760, 260)), At.Add(new FVector(0, 0, 108)), 38);
    this.MoveTo(At.Add(new FVector(300, 700, 280)), At.Add(new FVector(0, 0, 110)), 36, 0.3);
    if (bChampion) {
      const Aim = At.Add(new FVector(0, 0, 164));
      Seq.At(1.1, () => {
        this.CutTo(At.Add(new FVector(-95, 500, 205)), Aim, 35);
        this.MoveTo(At.Add(new FVector(45, 460, 210)), Aim, 33, 0.6);
      });
    }
    const NameCue = FMath.Max(1.7, this.DuckLeft);
    Seq.At(NameCue, () => { this.PlaySound(`VO_Win_${W.Def().VoiceId}`); });
    Seq.At(NameCue + 0.3, () => { this.Say('win', 1, W.Def().Name); });
    Seq.At(6.5, () => {});
  },

  // ---------------------------------------------------------------------------------------------
  // Curtain Calls
  // ---------------------------------------------------------------------------------------------

  TryStartFinisher(Attacker) {
    const Victim = Attacker.GetFoe();
    if (this.Phase !== ECpvPhase.Fight || !Victim || Victim.GetState() !== ECpvState.Dazed) { return false; }
    if (Attacker.DistanceTo(Victim) > 280) { return false; }
    this.BuildFinisher(Attacker, Victim);
    return true;
  },

  FinisherBoom(Victim, Chunks, Size) {
    const At = Victim.GetActorLocation().Add(Victim.VisualOffset).Add(new FVector(0, 0, 95));
    const Def = Victim.Def();
    for (let i = 0; i < 6; ++i) {
      this.Fx.Blobs(At, new FVector(FMath.Cos(i * 1.05), FMath.Sin(i * 1.05), 0.4), FMath.TruncToInt(Chunks / 6), Def.Clay, Def.Clay2, 620 * Size);
    }
    this.Fx.Teeth(At.Add(new FVector(0, 0, 50)), new FVector(0, 0, 1), 5);
    this.Fx.Puff(At, 2.4 * Size, 8);
    this.Fx.Stars(At, 10);
    for (let i = 0; i < 9; ++i) {
      this.Fx.Splat(Victim.GetActorLocation().Add(new FVector(FMath.FRandRange(-130, 130), FMath.FRandRange(-130, 130), 0)), FMath.FRandRange(0.9, 1.8),
        FMath.FRand() < 0.6 ? Def.Clay : Def.Clay2);
    }
    this.Arena.Flash(1);
    this.Arena.CrowdPop(1);
    this.Shake(32 * Size);
    this.PlaySound('Splat');
    this.PlaySound('Cheer', 1);
    this.SlowLeft = 0.7;
    this.CommentatorsReact('SitShock');
  },

  BuildFinisher(A, V) {
    if (this.IsRun() && this.Episode === 2 && A.Slot === 0) { this.FulfillCrowdCall(); }
    this.SetPhase(ECpvPhase.Finisher);
    this.Winner = A.Slot;
    const Seq = this.Seq;
    Seq.Reset();
    this.Tweens.length = 0;
    this.FinisherPrompt = 0;
    this.FinisherFor = -1;
    this.SlowLeft = 0;
    this.Letterbox = 1;
    for (const W of this.Weapons) { this.ReturnProp(W.Comp); }
    this.Weapons.length = 0;
    A.DropWeapon(false);
    A.SetScripted(true);
    V.SetScripted(true);
    V.Play('Dazed', 0.1);

    // Stand the attacker a pace in front of the victim, inside the ropes.
    let Dir = V.Pos2D().Sub(A.Pos2D()).GetSafeNormal();
    if (Dir.IsNearlyZero()) { Dir = new FVector2D(1, 0); }
    const Limit = this.Arena.RingLimit() - 20;
    let Vp = V.Pos2D();
    Vp = new FVector2D(FMath.Clamp(Vp.X, -Limit + 60, Limit - 60), FMath.Clamp(Vp.Y, -Limit + 80, Limit - 80));
    let Ap = Vp.Sub(Dir.Mul(125));
    Ap = new FVector2D(FMath.Clamp(Ap.X, -Limit, Limit), FMath.Clamp(Ap.Y, -Limit, Limit));
    Dir = Vp.Sub(Ap).GetSafeNormal();
    V.SetActorLocationAndRotation(new FVector(Vp.X, Vp.Y, 0), new FRotator(0, YawOf2D(Dir.Neg()), 0));
    A.SetActorLocationAndRotation(new FVector(Ap.X, Ap.Y, 0), new FRotator(0, YawOf2D(Dir), 0));
    A.UpdateMirror();
    V.UpdateMirror();
    A.Play('Idle', 0.1);
    const Av = new FVector(Ap.X, Ap.Y, 0), Vv = new FVector(Vp.X, Vp.Y, 0), Mid = Av.Add(Vv).Mul(0.5);
    const D3 = new FVector(Dir.X, Dir.Y, 0);

    const Def = A.Def();
    this.ShowBanner(Def.FinisherName, 'CURTAIN CALL', 2.2, Def.Colour, 1);
    this.MoveCallout[0] = '';
    this.MoveCallout[1] = '';
    this.Arena.SetMood(ECpvLightMood.Drama, 0.4);
    this.Arena.CrowdPop(0.8);
    this.PlaySound('Swell');
    this.Say('finisher', 1, Def.Name);
    this.CutTo(Mid.Add(new FVector(0, 860, 280)), Mid.Add(new FVector(0, 0, 100)), 40);
    this.MoveTo(Mid.Add(new FVector(0, 760, 260)), Mid.Add(new FVector(0, 0, 102)), 38, 1.0);
    V.SetFace(ECpvFace.Dazed, 30);
    let End = 4.4;

    switch (Def.Finisher) {
      case ECpvFinisher.Explode: {
        // Feed them the bomb, stroll away, do not look back.
        const Bomb = this.TakeProp('/Game/CPV/Props/SM_Bomb.SM_Bomb')!;
        Bomb.SetVisibility(false);
        Seq.At(0.5, () => { A.Play('Throw', 0.08, 1.1); });
        Seq.At(0.82, () => {
          Bomb.SetVisibility(true);
          Bomb.SetWorldLocation(V.GetHeadLocation().Sub(D3.Mul(17)).Add(new FVector(0, 0, -8)));
          V.SetFace(ECpvFace.Shock, 30);
          this.PlaySound('Pop');
        });
        Seq.At(1.25, () => {
          A.SetActorRotation(new FRotator(0, YawOf2D(Dir.Neg()), 0));
          A.UpdateMirror();
          A.Play('Strut', 0.12);
          A.SetFace(ECpvFace.Smug, 6);
          const To = Av.Sub(D3.Mul(150));
          this.Tween(1.9, (U) => { A.SetActorLocation(FMath.Lerp(Av, To, U)); });
          this.CutTo(To.Sub(D3.Mul(620)).Add(new FVector(0, 90, 250)), Vv.Add(new FVector(0, 0, 100)), 34);
        });
        for (let k = 0; k < 4; ++k) {
          Seq.At(1.5 + 0.32 * k, () => {
            this.PlaySound('Tick', 1, 1 + 0.18 * k);
            this.Fx.Stars(Bomb.GetComponentLocation().Add(new FVector(0, 0, 30)), 2);
          });
        }
        Seq.At(2.9, () => {
          this.Fx.Explosion(V.GetActorLocation().Add(new FVector(0, 0, 110)), 1.7);
          this.PlaySound('Explosion');
          this.FinisherBoom(V, 66, 1.2);
          V.bHidden = true;
          this.ReturnProp(Bomb);
        });
        Seq.At(3.7, () => { A.Play('TauntFlex', 0.15); });
        End = 5.0;
        break;
      }
      case ECpvFinisher.MicDrop: {
        const Mic = this.TakeProp('/Game/CPV/Props/SM_GiantMic.SM_GiantMic')!;
        Mic.SetVisibility(false);
        Seq.At(0.45, () => {
          A.Play('TauntPoint', 0.1);
          this.MoveTo(Mid.Add(new FVector(0, 1050, 60)), Mid.Add(new FVector(0, 0, 300)), 50, 2.5);
        });
        Seq.At(1.3, () => {
          Mic.SetVisibility(true);
          this.PlaySound('Whoosh', 1, 0.5);
          V.SetFace(ECpvFace.Shock, 30);
          this.Tween(0.5, (U) => { Mic.SetWorldLocationAndRotation(Vv.Add(new FVector(0, 0, FMath.Lerp(1000, 0, EaseIn(U)))), FRotator.ZeroRotator); });
        });
        Seq.At(1.8, () => {
          V.VisualScale = new FVector(2, 2, 0.045);
          V.Play('DownBack', 0);
          V.ForceStep();
          this.OnSlam(Vv, 2.2);
          this.PlaySound('Explosion', 0.8, 0.7);
          this.FinisherBoom(V, 42, 1);
          this.Fx.Impact(Vv.Add(new FVector(0, 60, 150)), ECpvWord.Splat, 3, new FLinearColor(1, 0.85, 0.2));
          this.Tween(0.5, (U) => {
            Mic.SetWorldLocationAndRotation(Vv.Add(new FVector(0, 0, 6 * FMath.Sin(U * 9) * (1 - U))), new FRotator(0, 0, 9 * EaseOut(U)));
          });
        });
        Seq.At(2.6, () => {
          A.Play('TauntDance', 0.12);
          this.MoveTo(Av.Add(new FVector(80, 720, 260)), Av.Add(new FVector(40, 0, 106)), 38, 2);
        });
        End = 4.4;
        break;
      }
      case ECpvFinisher.RollingPin: {
        Seq.At(0.4, () => {
          A.SetHandProp('/Game/CPV/Props/SM_RollingPin.SM_RollingPin', new FVector(0, -58, 0), new FRotator(0, -90, 0));
        });
        for (let k = 0; k < 2; ++k) {
          const T0 = 0.6 + k * 0.95;
          Seq.At(T0, () => { A.Play('WeaponSmash', 0.08); });
          Seq.At(T0 + 0.37, () => {
            V.VisualScale = k === 0 ? new FVector(1.5, 1.5, 0.4) : new FVector(2.2, 2.2, 0.04);
            V.Play('DownBack', 0);
            V.ForceStep();
            this.OnSlam(Vv, 1.5 + k * 0.6);
            this.PlaySound('Bonk', 1, 0.8);
            this.Fx.Impact(Vv.Add(new FVector(0, 40, 130)), k === 0 ? ECpvWord.Crunch : ECpvWord.Splat, 2.4, new FLinearColor(1, 0.85, 0.2));
            if (k === 1) { this.FinisherBoom(V, 30, 0.9); }
          });
        }
        Seq.At(2.6, () => {
          A.SetHandProp(null);
          A.Play('TauntKiss', 0.12);
          // Toss the "pizza".
          this.Tween(1.1, (U) => {
            V.VisualOffset = V.VisualOffset.WithZ(230 * FMath.Sin(U * UE_PI));
            V.VisualYaw = 900 * U;
          });
          this.PlaySound('Whoosh', 0.9, 0.9);
        });
        Seq.At(3.7, () => { this.OnSlam(Vv, 0.7); });
        End = 4.8;
        break;
      }
      case ECpvFinisher.Rocket: {
        const Rocket = this.TakeProp('/Game/CPV/Props/SM_Rocket.SM_Rocket')!;
        Rocket.SetVisibility(false);
        const Pad = Vv.Add(D3.Mul(34));
        Seq.At(0.45, () => { A.Play('TauntPhone', 0.1); });
        Seq.At(1.2, () => {
          Rocket.SetVisibility(true);
          Rocket.SetWorldLocationAndRotation(Pad, FRotator.ZeroRotator);
          this.Fx.Puff(Pad.Add(new FVector(0, 0, 60)), 2.2, 7);
          this.PlaySound('Pop');
          V.SetFace(ECpvFace.Shock, 30);
          V.Play('ClinchV', 0.1);   // hanging on for dear life
          V.VisualOffset = V.VisualOffset.WithZ(46);
        });
        for (let k = 0; k < 3; ++k) {
          Seq.At(1.75 + 0.34 * k, () => {
            this.PlaySound('Tick', 1, 0.9 + 0.2 * k);
            this.Fx.Flames(Pad.Add(new FVector(0, 0, 12)), new FVector(0, 0, -1), 3, 240);
            this.Fx.Puff(Pad, 1.2, 2);
          });
        }
        Seq.At(2.8, () => {
          this.PlaySound('Rocket');
          this.Shake(18);
          this.MoveTo(Mid.Add(new FVector(0, 1200, 80)), Pad.Add(new FVector(0, 0, 650)), 56, 2.2);
          this.Tween(1.05, (U) => {
            const Z = 1500 * EaseIn(U);
            Rocket.SetWorldLocation(Pad.Add(new FVector(0, 0, Z)));
            V.VisualOffset = V.VisualOffset.WithZ(46 + Z);
            this.Fx.Flames(Pad.Add(new FVector(0, 0, Z + 8)), new FVector(0, 0, -1), 2, 420);
            this.Shake(6);
          });
        });
        Seq.At(3.9, () => {
          const Sky = Pad.Add(new FVector(0, 0, 1480));
          this.Fx.Explosion(Sky, 2.6);
          for (let i = 0; i < 5; ++i) {
            this.Fx.Blobs(Sky, new FVector(FMath.Cos(i * 1.26), FMath.Sin(i * 1.26), 0.2), 12, V.Def().Clay, V.Def().Clay2, 700, false);
          }
          this.Fx.Stars(Sky, 16);
          this.PlaySound('Explosion');
          this.Arena.Flash(1);
          this.Arena.CrowdPop(1);
          this.Shake(20);
          this.PlaySound('Cheer', 1);
          V.bHidden = true;
          this.ReturnProp(Rocket);
          this.SlowLeft = 0.6;
        });
        Seq.At(4.5, () => {
          A.Play('TauntPhone', 0.15);
          this.MoveTo(Av.Add(new FVector(60, 720, 260)), Av.Add(new FVector(20, 0, 106)), 38, 3);
        });
        End = 5.8;
        break;
      }
      case ECpvFinisher.Speaker: {
        const Stack = this.TakeProp('/Game/CPV/Props/SM_GiantSpeaker.SM_GiantSpeaker')!;
        Stack.SetVisibility(false);
        const Spot = Av.Sub(D3.Mul(150));
        const Face = new FRotator(0, YawOf2D(Dir), 0);
        Seq.At(0.45, () => { A.Play('TauntDance', 0.1); });
        Seq.At(0.9, () => {
          Stack.SetVisibility(true);
          this.Tween(0.4, (U) => { Stack.SetWorldLocationAndRotation(Spot.Add(new FVector(0, 0, 800 * (1 - EaseIn(U)))), Face); });
        });
        Seq.At(1.3, () => { this.OnSlam(Spot, 2); });
        Seq.At(1.6, () => {
          A.Play('SpecSlam', 0.1, 0.9);
          V.SetFace(ECpvFace.Shock, 30);
        });
        Seq.At(2.2, () => {
          this.PlaySound('BassDrop');
          this.Tween(1.3, (U) => {
            // The victim rattles apart.
            const Rattle = 4 + 14 * U;
            V.VisualOffset = new FVector(FMath.FRandRange(-Rattle, Rattle), FMath.FRandRange(-Rattle, Rattle), 0);
            V.VisualScale = new FVector(1 + 0.12 * FMath.Sin(U * 80), 1 + 0.12 * FMath.Cos(U * 70), 1 - 0.1 * FMath.Sin(U * 90));
            this.Shake(7 + 10 * U);
            if (FMath.FRand() < 0.4) { this.Fx.Ring(Av.Add(D3.Mul(40 + 160 * FMath.FRand())).Add(new FVector(0, 0, 100)), 1.6, new FLinearColor(0.5, 0.2, 1)); }
            if (FMath.FRand() < 0.3) { this.Fx.Blobs(Vv.Add(new FVector(0, 0, 110)), D3, 2, V.Def().Clay, V.Def().Clay2, 300); }
          });
        });
        Seq.At(2.85, () => { this.PlaySound('BassDrop', 1, 1.2); });
        Seq.At(3.5, () => {
          this.FinisherBoom(V, 72, 1.3);
          this.PlaySound('Explosion', 0.9, 1.2);
          V.bHidden = true;
        });
        Seq.At(4.1, () => { A.Play('TauntDance', 0.15); });
        End = 5.4;
        break;
      }
      case ECpvFinisher.HeadPop: {
        Seq.At(0.4, () => {
          A.SetHandProp('/Game/CPV/Props/SM_Scepter.SM_Scepter', new FVector(0, 0, 12));
          A.Play('WeaponSwing', 0.1, 0.5);
        });
        Seq.At(0.9, () => {
          // The head leaves; the body has not noticed yet.
          const HeadAt = V.GetHeadLocation();
          this.PlaySound('Pop');
          this.PlaySound('Heavy');
          this.Fx.Impact(HeadAt, ECpvWord.Bonk, 2.2, new FLinearColor(1, 0.85, 0.2));
          this.Fx.Blobs(HeadAt.Sub(new FVector(0, 0, 20)), new FVector(0, 0, 1), 16, V.Def().Clay, V.Def().Clay2, 420);
          this.Fx.Stars(HeadAt, 8);
          this.Shake(22);
          this.Arena.Flash(0.8);
          this.Arena.CrowdPop(1);
          this.SlowLeft = 0.5;
          for (const B of [ECpvBone.Head, ECpvBone.LidL, ECpvBone.LidR, ECpvBone.PupilL, ECpvBone.PupilR, ECpvBone.BrowL, ECpvBone.BrowR,
            ECpvBone.MouthClosed, ECpvBone.MouthGrit, ECpvBone.MouthOpen, ECpvBone.MouthOuch, ECpvBone.MouthGrin, ECpvBone.Hair, ECpvBone.Tail]) {
            V.BoneScale[B] = 0.001;
          }
          if (!this.LooseHead) { this.LooseHead = this.GetWorld().SpawnActor(ACpvPuppet); }
          const Head = this.LooseHead;
          Head.SetCharacter(V.GetCharacterName());
          for (let i = 0; i < ECpvBone.Count; ++i) { Head.BoneScale[i] = 0.001; }
          for (const B of [ECpvBone.Head, ECpvBone.LidL, ECpvBone.LidR, ECpvBone.PupilL, ECpvBone.PupilR, ECpvBone.BrowL, ECpvBone.BrowR,
            ECpvBone.MouthOpen, ECpvBone.Hair, ECpvBone.Tail]) {
            Head.BoneScale[B] = 1;
          }
          Head.bHidden = false;
          Head.Play('Stand', 0);
          Head.SetFace(ECpvFace.Shock, 30);
          Head.SetActorLocationAndRotation(Vv, V.GetActorRotation());
          const Land = Vv.Add(D3.Mul(900)).Add(new FVector(0, -500, -60));   // somewhere up in the far stands
          this.Tween(1.5, (U) => {
            Head.SetActorLocation(FMath.Lerp(Vv, Land, U).Add(new FVector(0, 0, 520 * FMath.Sin(U * UE_PI))));
            Head.VisualYaw = 1300 * U;
            Head.ForceStep();
          });
          this.MoveTo(Mid.Add(new FVector(0, 1000, 260)), Land.Add(new FVector(0, 0, 200)), 50, 1.6);
        });
        Seq.At(1.9, () => { V.Play('Collapse', 0.1); });
        Seq.At(2.4, () => {
          this.PlaySound('Cheer', 1);
          this.Arena.CrowdPop(1);
          this.OnSlam(Vv, 0.8);
          if (this.LooseHead) { this.LooseHead.bHidden = true; }
        });
        Seq.At(2.7, () => {
          A.SetHandProp(null);
          A.Play('TauntWave', 0.15);
          this.MoveTo(Av.Add(new FVector(50, 720, 260)), Av.Add(new FVector(10, 0, 108)), 38, 2.4);
        });
        End = 4.6;
        break;
      }
      case ECpvFinisher.Encore: {
        const Bury = V.GetHeight() - 46;
        Seq.At(0.35, () => { A.GiveWeapon(ECpvWeapon.Guitar, 99); });
        for (let k = 0; k < 3; ++k) {
          const T0 = 0.55 + k * 0.8;
          Seq.At(T0, () => { A.Play('WeaponSmash', 0.06, 1.1); });
          Seq.At(T0 + 0.33, () => {
            // Each chord drives them further into the canvas, like a nail.
            V.VisualOffset = V.VisualOffset.WithZ((-Bury * (k + 1)) / 3);
            V.HeadSquash = new FVector2D(1.18, 0.8);
            V.SetFace(ECpvFace.Hurt, 0.5);
            V.ForceStep();
            this.OnSlam(Vv, 1.3 + 0.3 * k);
            this.PlaySound('Guitar', 1, 1 + 0.1 * k);
            this.Fx.Impact(Vv.Add(new FVector(0, 40, 180 - 40 * k)), k === 2 ? ECpvWord.Crunch : ECpvWord.Bam, 2.2, new FLinearColor(1, 0.85, 0.2));
            this.Fx.Blobs(Vv.Add(new FVector(0, 0, 30)), new FVector(0, 0, 1), 10, V.Def().Clay, new FLinearColor(0.9, 0.88, 0.82), 420);
            if (k === 2) {
              A.DropWeapon(true);
              this.Arena.Flash(1);
              this.Arena.CrowdPop(1);
              this.PlaySound('Cheer', 1);
              this.SlowLeft = 0.6;
            }
          });
          Seq.At(T0 + 0.6, () => { V.HeadSquash = new FVector2D(1, 1); });
        }
        Seq.At(3.1, () => {
          A.Play('TauntRock', 0.12);
          V.SetFace(ECpvFace.Dazed, 30);
          this.MoveTo(Vv.Add(new FVector(40, 470, 230)), Vv.Add(new FVector(-20, 0, 60)), 36, 2);
        });
        End = 4.8;
        break;
      }
      case ECpvFinisher.Shrink: {
        Seq.At(0.4, () => { A.Play('SpecCast', 0.1); });
        Seq.At(0.95, () => {
          this.PlaySound('Zap', 1, 1.4);
          this.Fx.Puff(Vv.Add(new FVector(0, 0, 100)), 2.2, 7, new FLinearColor(0.6, 0.45, 1));
          this.Fx.Stars(Vv.Add(new FVector(0, 0, 120)), 10);
          this.Arena.Flash(0.6);
          V.SetFace(ECpvFace.Shock, 30);
          this.Tween(0.55, (U) => {
            const S = FMath.Lerp(1, 0.17, EaseOut(U)) * (1 + 0.2 * FMath.Sin(U * 30) * (1 - U));
            V.VisualScale = FVector.Splat(S);
          });
        });
        Seq.At(1.6, () => {
          this.PlaySound('Squeak', 1, 1.5);
          V.Play('WhipRun', 0.1, 1.6);
        });
        Seq.At(1.9, () => {
          A.Play('Strut', 0.12);
          const To = Vv.Sub(D3.Mul(44));
          this.Tween(0.75, (U) => { A.SetActorLocation(FMath.Lerp(Av, To, U)); });
          this.MoveTo(Vv.Add(new FVector(0, 500, 240)), Vv.Add(new FVector(0, 0, 55)), 36, 2.4);
        });
        Seq.At(2.7, () => { A.Play('Stomp', 0.08); });
        Seq.At(2.97, () => {
          V.bHidden = true;
          this.Fx.Impact(Vv.Add(new FVector(0, 30, 70)), ECpvWord.Splat, 2.4, new FLinearColor(1, 0.85, 0.2));
          this.Fx.Splat(Vv, 2.6, V.Def().Clay);
          this.Fx.Blobs(Vv.Add(new FVector(0, 0, 10)), new FVector(0, 0, 1), 18, V.Def().Clay, V.Def().Clay2, 380);
          this.PlaySound('Splat');
          this.PlaySound('Cheer', 1);
          this.Shake(16);
          this.Arena.Flash(0.8);
          this.Arena.CrowdPop(1);
          this.SlowLeft = 0.5;
          this.CommentatorsReact('SitShock');
        });
        Seq.At(3.6, () => { A.Play('TauntMystic', 0.15); });
        End = 5.0;
        break;
      }
    }
    Seq.At(End, () => { V.Kill(true); });
  },
});
