// Port of CpvGameEvents.cpp: what happens around the fighters - hit effects, weapons, projectiles,
// referee, commentary, sound.

import { Assets } from '../engine/assets';
import { Audio, UAudioComponent } from '../engine/audio';
import { GConfig, LogVerbose, UGameplayStatics } from '../engine/platform';
import { FLinearColor, FMath, FRotator, FVector, FVector2D, INDEX_NONE, UE_PI, UE_TWO_PI } from '../engine/ue';
import { IsValid, UStaticMeshComponent } from '../engine/world';
import { ECpvLightMood } from './CpvArena';
import { CpvData } from './CpvData';
import { ACpvGameMode, ECpvAudioBus, ECpvPhase, FLine, FMatWeapon, FProjectile, implement } from './CpvGame';
import { ECpvBone } from './CpvPose';
import { ECpvReaction, ECpvState, ECpvWeapon, ECpvWord } from './CpvTypes';
import { CpvUi, ECpvAlign, ECpvFont } from './CpvUi';

/** FVector2D(V): drops the height. */
function To2D(V: FVector): FVector2D { return new FVector2D(V.X, V.Y); }

/** FName::IsNone. */
function IsNone(Name: string): boolean { return Name === '' || Name === 'None'; }

/** TArray::RemoveAll, in place. */
function RemoveAll<T>(List: T[], Match: (Item: T) => boolean): void {
  for (let i = List.length - 1; i >= 0; --i) {
    if (Match(List[i])) { List.splice(i, 1); }
  }
}

/** FString::Replace(TEXT("{name}"), ...): every occurrence, whatever its case. */
function ReplaceName(Text: string, Name: string): string { return Text.replace(/\{name\}/gi, () => Name); }

implement(ACpvGameMode, {
  // ---------------------------------------------------------------------------------------------
  // Combat feedback
  // ---------------------------------------------------------------------------------------------

  OnStrike(From, Victim, Damage, Reaction, Word, Sound, At, bBlocked) {
    this.PlaySound(Sound, FMath.Clamp(0.55 + Damage * 0.04, 0.5, 1.1), FMath.FRandRange(0.92, 1.1));
    if (this.IsRehearsing() && From && Victim) {
      const bLandedJab = this.Lesson === 0 && From.Slot === 0 && From.Move === CpvData.Jab && !bBlocked;
      const bGuarded = this.Lesson === 1 && Victim.Slot === 0 && bBlocked;
      const bSlammed = this.Lesson === 2 && From.Slot === 0 && From.GetState() === ECpvState.Throwing && Sound === 'Slam';
      if (bLandedJab || bGuarded || bSlammed) { this.PassCue(); }
    }
    if (bBlocked) {
      this.Fx.Puff(At, 0.45, 2);
      this.Shake(3);
      return;
    }
    if (this.IsRun() && From && From.Slot === 0 && this.Phase === ECpvPhase.Fight) {
      if ((this.Episode === 0 && From.Combo >= 3) || (this.Episode === 1 && (From.Move === CpvData.WeaponSwing || From.Move === CpvData.WeaponSmash))) {
        this.FulfillCrowdCall();
      }
    }
    const Push = From ? Victim.GetActorLocation().Sub(From.GetActorLocation()).GetSafeNormal2D() : new FVector(1, 0, 0);
    const Def = Victim.Def();
    this.Fx.Impact(At, Word, 0.55 + Damage * 0.055, Word === ECpvWord.None ? new FLinearColor(1, 0.95, 0.7) : new FLinearColor(1, 0.85, 0.2));
    this.Fx.Blobs(At, Push, 2 + FMath.RoundToInt(Damage * 0.55), Def.Clay, Def.Clay2, 250 + Damage * 15);
    if (Damage >= 9) { this.Fx.Stars(At, FMath.Clamp(FMath.RoundToInt(Damage * 0.4), 3, 8)); }
    if (Damage >= 10 && At.Z > 100 && FMath.FRand() < 0.35) { this.Fx.Teeth(At, Push, FMath.RandRange(1, 3)); }
    this.Shake(Damage * 1.1);
    this.Arena.CrowdPop(Damage * 0.02 + (Word !== ECpvWord.None ? 0.12 : 0));
    if (Damage >= 12) {
      this.Arena.Flash(0.3);
      this.PlaySound('Cheer', 0.5, FMath.FRandRange(0.95, 1.08));
      if (FMath.FRand() < 0.45) { this.CommentatorsReact(FMath.FRand() < 0.5 ? 'SitShock' : 'SitCheer'); }
    }
    if (From && From.Combo >= 4 && From.Combo % 2 === 0) { this.Say('combo', 0.7, From.Def().Name); }
    else if (Damage >= 13) { this.Say('bighit', 0.5, From ? From.Def().Name : ''); }
    else if (Victim.Health > 0 && Victim.Health < 25 && Victim.Health + Damage >= 25) { this.Say('lowhealth', 1, Def.Name); }
  },

  OnCleanBlock(Who) {
    this.MoveCallout[Who.Slot] = 'PERFECT BLOCK!';
    this.MoveCalloutLeft[Who.Slot] = 1;
    this.Arena.CrowdPop(0.22);
    this.Fx.Stars(Who.GetHeadLocation(), 3);
    LogVerbose(() => `CPV_PERFECT_BLOCK slot=${Who.Slot}`);
  },

  OnSlam(At, Strength, bPlayImpact = true) {
    if (bPlayImpact) { this.PlaySound('Slam', FMath.Clamp(Strength, 0.4, 1.1), FMath.FRandRange(0.9, 1.05)); }
    this.Shake(Strength * 11);
    const Ground = new FVector(At.X, At.Y, 6);
    this.Fx.Puff(Ground, 1.1 * Strength, 4, new FLinearColor(0.92, 0.9, 0.84));
    this.Fx.Ring(new FVector(At.X, At.Y, 2.5), 2.6 * Strength, new FLinearColor(0.95, 0.93, 0.88));
    for (let S = 0; S < 4; ++S) { this.Arena.BumpRopes(S, FMath.FRandRange(-0.5, 0.5), 70 * Strength); }
    this.Arena.CrowdPop(0.1 * Strength);
  },

  OnKnockout(Victim, By) {
    if (this.IsDemo()) {
      this.SlowLeft = 0.5;
      return;
    }
    if (Victim.bDazeOnKo) {
      // Deciding round: the loser is out on their feet. Curtain Call time.
      this.SlowLeft = 0.45;
      this.PlaySound('Gasp');
      this.PlaySound('VO_CurtainCall');
      this.Arena.SetMood(ECpvLightMood.Drama, 0.6);
      this.Arena.CrowdPop(0.6);
      this.Say('dazed', 1, By ? By.Def().Name : '');
      this.CommentatorsReact('SitShock');
    } else {
      this.SlowLeft = 1.1;
      this.ShowBanner('CANCELLED!', '', 1.8, new FLinearColor(1, 0.25, 0.15), 1.15);
      this.PlaySound('VO_Cancelled');
      this.PlaySound('Cheer', 1);
      this.Arena.Flash(0.8);
      this.Arena.CrowdPop(0.8);
      this.Say('ko', 1, Victim.Def().Name);
      this.CommentatorsReact('SitCheer');
    }
  },

  OnTaunt(Who) {
    this.Arena.CrowdPop(0.4);
    this.PlaySound('Cheer', 0.7, FMath.FRandRange(0.95, 1.1));
    this.Say('taunt', 0.6, Who.Def().Name);
    // Playing to the crowd sometimes earns a gift from the cheap seats.
    if (this.Phase === ECpvPhase.Fight && !this.IsRehearsing() && this.Weapons.length < 2 && FMath.FRand() < 0.4) {
      this.TossWeaponIn(FMath.RandRange(1, ECpvWeapon.Count - 1) as ECpvWeapon);
    }
  },

  OnSpecial(Who) {
    if (this.IsRehearsing() && this.Lesson === 3 && Who.Slot === 0) { this.PassCue(); }
    this.MoveCallout[Who.Slot] = Who.Def().SpecialName;
    this.MoveCalloutLeft[Who.Slot] = 1.7;
    this.PlaySound('Special');
    this.Arena.Flash(0.35);
    this.Arena.CrowdPop(0.45);
    this.Say('special', 0.8, Who.Def().Name);
  },

  OnGrab(Attacker, _Victim) {
    this.PlaySound('Grab', 0.8);
    this.Say('grab', 0.25, Attacker.Def().Name);
  },

  OnRopeBounce(Who) {
    this.Say('ropes', 0.3, Who.Def().Name);
  },

  OnHypeFull(Who) {
    if (this.IsDemo()) { return; }
    this.PlaySound('HypeFull', 0.8);
    this.MoveCallout[Who.Slot] = 'SIGNATURE READY!';
    this.MoveCalloutLeft[Who.Slot] = 1.4;
  },

  StrikeReferee(From, Move) {
    const Referee = this.Referee;
    if (!Referee || this.RefDown > 0 || Referee.bHidden || !Move.bHitsStanding || Move.Damage < 6) { return; }
    const To = To2D(Referee.GetActorLocation()).Sub(From.Pos2D());
    const Dist = To.Size();
    if (Dist > Move.Range - 12 || FVector2D.DotProduct(To.GetSafeNormal(), From.Facing2D()) < 0.6) { return; }
    // The official takes one for the team.
    this.RefDown = 4.2;
    Referee.Play('KnockDown', 0.04);
    Referee.HitFlash(1);
    Referee.ForceStep();
    const At = Referee.GetActorLocation().Add(new FVector(0, 0, 120));
    this.Fx.Impact(At, ECpvWord.Oof, 1.3, new FLinearColor(1, 0.85, 0.2));
    this.Fx.Blobs(At, new FVector(To.X, To.Y, 0), 6, new FLinearColor(0.9, 0.9, 0.88), new FLinearColor(0.02, 0.02, 0.02), 320);
    this.PlaySound('Heavy');
    this.PlaySound('Gasp', 0.8);
    this.Shake(10);
    this.Arena.CrowdPop(0.5);
    From.AddHype(8);
    this.Say('refdown', 1);
    this.CommentatorsReact('SitShock');
  },

  // ---------------------------------------------------------------------------------------------
  // Props, weapons and projectiles
  // ---------------------------------------------------------------------------------------------

  TakeProp(MeshPath) {
    let Comp: UStaticMeshComponent | null = null;
    for (const C of this.PropPool) {
      if (!C.IsVisible()) { Comp = C; break; }
    }
    if (!Comp) {
      Comp = new UStaticMeshComponent();
      this.PropPool.push(Comp);
    }
    Comp.SetStaticMesh(MeshPath);
    Comp.SetWorldScale3D(FVector.Splat(1));
    Comp.SetVisibility(true);
    return Comp;
  },

  ReturnProp(Comp) {
    if (Comp) { Comp.SetVisibility(false); }
  },

  NearestWeapon(From) {
    let Best = 1e9;
    let At: FVector | null = null;
    for (const W of this.Weapons) {
      if (!W.bResting || FMath.Abs(W.Pos.X) > 280 || FMath.Abs(W.Pos.Y) > 280) { continue; }
      const D = To2D(W.Pos).Sub(From).Size();
      if (D < Best) { Best = D; At = W.Pos; }
    }
    return Best < 1e8 ? At : null;
  },

  WeaponNear(Who, Range) {
    const At = this.NearestWeapon(Who.Pos2D());
    return At !== null && To2D(At).Sub(Who.Pos2D()).Size() <= Range;
  },

  TryPickup(Who) {
    let Best = INDEX_NONE;
    let BestDist = 135;
    for (let i = 0; i < this.Weapons.length; ++i) {
      const D = To2D(this.Weapons[i].Pos).Sub(Who.Pos2D()).Size();
      if (this.Weapons[i].bResting && D < BestDist) { Best = i; BestDist = D; }
    }
    if (Best === INDEX_NONE) { return false; }
    const W = this.Weapons[Best];
    this.ReturnProp(W.Comp);
    this.Weapons.splice(Best, 1);
    Who.GiveWeapon(W.Type, W.Uses);
    this.PlaySound('Pickup');
    this.Arena.CrowdPop(0.25);
    this.Say('weapon', 0.7, CpvData.Weapon(W.Type).Name);
    return true;
  },

  DropWeaponAt(Type, Uses, At, Fling) {
    const W = new FMatWeapon();
    W.Type = Type;
    W.Uses = Uses;
    W.Comp = this.TakeProp(CpvData.Weapon(Type).Mesh);
    W.Pos = At;
    W.Vel = new FVector(Fling.X, Fling.Y, 160);
    W.Rot = new FRotator(FMath.FRandRange(0, 360), FMath.FRandRange(0, 360), 0);
    W.Spin = new FRotator(FMath.FRandRange(-300, 300), FMath.FRandRange(-200, 200), 0);
    this.Weapons.push(W);
  },

  BreakWeapon(Type, At) {
    this.PlaySound('Break');
    this.Fx.Blobs(At, new FVector(0, 0, 1), 12, new FLinearColor(0.45, 0.3, 0.18), new FLinearColor(0.5, 0.52, 0.56), 380, false);
    this.Fx.Puff(At, 1.2, 4);
    this.Fx.Stars(At, 6);
    this.Say('weaponbreak', 0.6, CpvData.Weapon(Type).Name);
  },

  ThrowWeapon(From, Type, Uses) {
    const W = new FMatWeapon();
    W.Type = Type;
    W.Uses = Uses;
    W.Comp = this.TakeProp(CpvData.Weapon(Type).Mesh);
    W.Pos = From.GetBoneLocation(From.bMirror ? ECpvBone.HandL : ECpvBone.HandR);
    const Dir = From.Facing2D();
    W.Vel = new FVector(Dir.X * 980, Dir.Y * 980, 140);
    W.Spin = new FRotator(900, 0, 300);
    W.bThrown = true;
    W.Owner = From;
    this.Weapons.push(W);
    this.PlaySound('Whoosh', 1, 0.8);
  },

  TossWeaponIn(Type) {
    // Sails in from the stands on a random side and lands somewhere near the middle of the ring.
    const A = FMath.FRandRange(0, UE_TWO_PI);
    const From = new FVector(FMath.Cos(A) * 780, FMath.Sin(A) * 780, 120);
    const To = new FVector(FMath.FRandRange(-150, 150), FMath.FRandRange(-150, 150), 0);
    const T = 1.15;
    const W = new FMatWeapon();
    W.Type = Type;
    W.Uses = CpvData.Weapon(Type).Uses;
    W.Comp = this.TakeProp(CpvData.Weapon(Type).Mesh);
    W.Pos = From;
    W.Vel = new FVector((To.X - From.X) / T, (To.Y - From.Y) / T, (To.Z - From.Z) / T + 0.5 * 1500 * T);
    W.Spin = new FRotator(FMath.FRandRange(250, 500), FMath.FRandRange(-200, 200), FMath.FRandRange(-200, 200));
    this.Weapons.push(W);
    this.PlaySound('Whoosh', 0.7, 0.7);
    this.PlaySound('Cheer', 0.5);
    this.MoveCallout[0] = this.MoveCallout[1] = '';
    this.ShowBanner(`INCOMING: ${CpvData.Weapon(Type).Name}!`, 'WALK OVER IT AND PRESS GRAB', 2.2, new FLinearColor(1, 0.85, 0.2), 0.5);
    this.Say('weaponin', 0.8, CpvData.Weapon(Type).Name);
  },

  TickWeapons(Dt) {
    for (let i = this.Weapons.length - 1; i >= 0; --i) {
      const W = this.Weapons[i];
      if (!W.bResting) {
        W.Vel = W.Vel.WithZ(W.Vel.Z - (W.bThrown ? 500 : 1500) * Dt);
        W.Pos = W.Pos.Add(W.Vel.Mul(Dt));
        W.Rot = W.Rot.Add(W.Spin.Mul(Dt));
        const Target = W.bThrown && W.Owner ? W.Owner.GetFoe() : null;
        if (Target) {
          const Flat = To2D(W.Pos).Sub(Target.Pos2D());
          if (Target.IsHittable() && Target.IsStanding() && Flat.Size() < 58 && W.Pos.Z < 190) {
            // A knockdown can add the defender's dropped prop to this same array.
            const Hit = W;
            this.ReturnProp(W.Comp);
            this.Weapons.splice(i, 1);
            const Def = CpvData.Weapon(Hit.Type);
            if (this.IsRun() && this.Episode === 1 && Hit.Owner !== null && Hit.Owner.Slot === 0) { this.FulfillCrowdCall(); }
            Target.TakeBlow(Hit.Owner, 11 + Def.Damage * 0.5, ECpvReaction.Knockdown, To2D(Hit.Vel).GetSafeNormal().Mul(340), 0, Def.Word, Def.Sound, 0.13);
            this.BreakWeapon(Hit.Type, Hit.Pos);
            continue;
          }
        }
        const bOnMat = FMath.Abs(W.Pos.X) < this.Arena.MatHalf && FMath.Abs(W.Pos.Y) < this.Arena.MatHalf;
        const Ground = bOnMat ? 4 : this.Arena.FloorZ + 4;
        if (W.Pos.Z <= Ground && W.Vel.Z < 0) {
          W.Pos = W.Pos.WithZ(Ground);
          if (W.Vel.Z < -260) {
            W.Vel = new FVector(W.Vel.X * 0.4, W.Vel.Y * 0.4, -W.Vel.Z * 0.3);
            W.Spin = W.Spin.Mul(0.5);
            this.PlaySound('Thud', 0.7);
          } else {
            W.bResting = true;
            W.bThrown = false;
            W.Vel = FVector.ZeroVector;
            W.Rot = new FRotator(0, W.Rot.Yaw, 90); // lying on its side
            W.Pos = W.Pos.WithZ(Ground + 8);
          }
        }
        if (W.Pos.Z < this.Arena.FloorZ - 50 || FMath.Abs(W.Pos.X) > 1500 || FMath.Abs(W.Pos.Y) > 1500) {
          this.ReturnProp(W.Comp);
          this.Weapons.splice(i, 1);
          continue;
        }
      }
      if (W.Comp) { W.Comp.SetWorldLocationAndRotation(W.Pos, W.Rot); }
    }
  },

  SpawnProjectile(Owner, Kind, From, Target) {
    const P = new FProjectile();
    P.Kind = Kind;
    P.Owner = Owner;
    P.Pos = From;
    if (Kind === 0) {
      const T = 0.72;
      P.Comp = this.TakeProp('/Game/CPV/Props/SM_Bomb.SM_Bomb');
      P.Vel = new FVector((Target.X - From.X) / T, (Target.Y - From.Y) / T, (10 - From.Z) / T + 0.5 * 1500 * T);
    } else {
      P.Comp = this.TakeProp('/Game/CPV/Props/SM_CrystalBall.SM_CrystalBall');
      const Dir = To2D(Target).Sub(To2D(From)).GetSafeNormal();
      P.Vel = new FVector(Dir.X * 780, Dir.Y * 780, 0);
      P.Pos = P.Pos.WithZ(FMath.Max(From.Z, 90));
    }
    this.Projectiles.push(P);
    this.PlaySound('Whoosh', 0.9, Kind === 0 ? 0.8 : 1.2);
  },

  TickProjectiles(Dt) {
    for (let i = this.Projectiles.length - 1; i >= 0; --i) {
      const P = this.Projectiles[i];
      P.Age += Dt;
      const Target = P.Owner ? P.Owner.GetFoe() : null;
      let bDone = false;
      if (P.Kind === 0) {
        P.Vel = P.Vel.WithZ(P.Vel.Z - 1500 * Dt);
        P.Pos = P.Pos.Add(P.Vel.Mul(Dt));
        const bNear = Target !== null && To2D(P.Pos).Sub(Target.Pos2D()).Size() < 52 && P.Pos.Z < 170 && P.Age > 0.25;
        if (P.Pos.Z <= 12 || bNear) {
          bDone = true;
          this.Fx.Explosion(new FVector(P.Pos.X, P.Pos.Y, FMath.Max(P.Pos.Z, 20)), 1);
          this.PlaySound('Explosion');
          this.Arena.Flash(1);
          this.Shake(22);
          this.Arena.CrowdPop(0.5);
          if (Target && Target.IsHittable()) {
            const Away = Target.Pos2D().Sub(To2D(P.Pos));
            if (Away.Size() < 175) {
              Target.TakeBlow(P.Owner, 22, ECpvReaction.Launch, Away.GetSafeNormal().Mul(380), 700, ECpvWord.None, 'Heavy', 0.16);
            }
          }
        }
      } else {
        P.Pos = P.Pos.Add(P.Vel.Mul(Dt));
        P.Pos = P.Pos.WithZ(92 + 10 * FMath.Sin(P.Age * 14));
        if (FMath.FRand() < 0.5) { this.Fx.Stars(P.Pos, 1); }
        if (Target && Target.IsHittable() && Target.IsStanding() && To2D(P.Pos).Sub(Target.Pos2D()).Size() < 56) {
          bDone = true;
          Target.TakeBlow(P.Owner, 20, ECpvReaction.Knockdown, To2D(P.Vel).GetSafeNormal().Mul(430), 0, ECpvWord.Wham, 'Heavy', 0.15);
          this.Fx.Puff(P.Pos, 1.5, 5, new FLinearColor(0.6, 0.45, 1));
          this.PlaySound('Zap', 0.8, 1.3);
        } else if (FMath.Abs(P.Pos.X) > this.Arena.RopeHalf || FMath.Abs(P.Pos.Y) > this.Arena.RopeHalf || P.Age > 1.6) {
          bDone = true;
          this.Arena.BumpRopesAt(P.Pos, 240);
          this.Fx.Puff(P.Pos, 1.2, 4, new FLinearColor(0.6, 0.45, 1));
        }
      }
      if (P.Comp) { P.Comp.SetWorldLocationAndRotation(P.Pos, new FRotator(P.Age * 500, P.Age * 300, 0)); }
      if (bDone) {
        this.ReturnProp(P.Comp);
        this.Projectiles.splice(i, 1);
      }
    }
  },

  // ---------------------------------------------------------------------------------------------
  // Referee and commentators
  // ---------------------------------------------------------------------------------------------

  TickReferee(Dt) {
    const Referee = this.Referee;
    if (!Referee || !this.Fighters[0] || !this.Fighters[1]) { return; }
    const Phase = this.Phase;
    const bInRing = Phase === ECpvPhase.RoundIntro || Phase === ECpvPhase.Fight || Phase === ECpvPhase.RoundEnd || Phase === ECpvPhase.MatchEnd
      || Phase === ECpvPhase.Results || this.IsDemo();
    Referee.bHidden = !bInRing;
    if (!bInRing || this.PinSlot >= 0) { return; }
    const A = this.Fighters[0].Pos2D(), B = this.Fighters[1].Pos2D();
    const Mid = A.Add(B).Mul(0.5);
    let Me = To2D(Referee.GetActorLocation());
    Referee.SetLookTarget(new FVector(Mid.X, Mid.Y, 110), 0.8);
    if (this.RefDown > 0) {
      this.RefDown -= Dt;
      if (this.RefDown <= 0.9 && Referee.GetClip() !== 'GetUp') { Referee.Play('GetUp', 0.1); }
      if (this.RefDown <= 0) { Referee.Play('RefIdle', 0.15); }
      return;
    }
    // One-off gestures (start signal, calling for the bell).
    if (!IsNone(this.RefAct)) {
      if (this.RefActLeft <= 0) {
        Referee.Play(this.RefAct, 0.12);
        this.RefActLeft = Referee.GetClipLength();
      }
      this.RefActLeft -= Dt;
      if (this.RefActLeft <= 0) { this.RefAct = ''; }
      return;
    }
    // Otherwise hover on the far side of the action, out of arm's reach.
    let Goal: FVector2D;
    if ((Phase === ECpvPhase.MatchEnd || Phase === ECpvPhase.Results) && this.Winner >= 0) {
      Goal = this.Fighters[this.Winner].Pos2D().Add(new FVector2D(-70, -20));
    } else {
      let Axis = B.Sub(A).GetSafeNormal();
      if (Axis.IsNearlyZero()) { Axis = new FVector2D(1, 0); }
      let Side = new FVector2D(-Axis.Y, Axis.X);
      if (Side.Y > 0) { Side = Side.Neg(); } // prefer the side away from the broadcast camera
      Goal = Mid.Add(Side.Mul(185));
      // Keep the official's silhouette beside a clinch instead of directly behind both faces.
      const Offset = Mid.X > 0 ? -118 : 118;
      Goal = Goal.WithX(Goal.X + Offset * FMath.Clamp(1 - FVector2D.Distance(A, B) / 260, 0, 1));
    }
    const Limit = this.Arena.RingLimit() - 6;
    Goal = new FVector2D(FMath.Clamp(Goal.X, -Limit, Limit), FMath.Clamp(Goal.Y, -Limit, Limit));
    // Step away if a fighter is too close.
    for (const F of [A, B]) {
      const Off = Goal.Sub(F);
      if (Off.Size() < 125) { Goal = F.Add((Off.IsNearlyZero() ? new FVector2D(0, -1) : Off.GetSafeNormal()).Mul(125)); }
    }
    this.RefGoal = Goal;
    const To = this.RefGoal.Sub(Me);
    const Dist = To.Size();
    const bRaise = (Phase === ECpvPhase.MatchEnd || Phase === ECpvPhase.Results) && this.Winner >= 0 && Dist < 30;
    if (Dist > 22) {
      Me = Me.Add(To.Div(Dist).Mul(FMath.Min(Dist, 190 * Dt)));
      Referee.Play('Walk', 0.15, 1, false);
    } else if (bRaise) { Referee.Play('RefRaise', 0.2, 1, false); }
    else { Referee.Play('RefIdle', 0.2, 1, false); }
    const Face = bRaise ? new FVector2D(0, 1) : Mid.Sub(Me);
    const Want = FMath.RadiansToDegrees(FMath.Atan2(Face.Y, Face.X));
    const Now = Referee.GetActorRotation().Yaw;
    // Unreal hands back an actor's yaw wrapped to (-180, 180]; the wrap here keeps the turn below the same.
    const Yaw = FRotator.NormalizeAxis(Now + FMath.Clamp(FMath.FindDeltaAngleDegrees(Now, Want), -400 * Dt, 400 * Dt));
    Referee.SetActorLocationAndRotation(new FVector(Me.X, Me.Y, 0), new FRotator(0, Yaw, 0));
    Referee.bMirror = FMath.Cos(FMath.DegreesToRadians(Referee.GetActorRotation().Yaw)) < -0.2;
  },

  CommentatorsReact(Clip) {
    for (let i = 0; i < 2; ++i) {
      if (this.Commentators[i] && (i === 0 || FMath.FRand() < 0.7)) { this.Commentators[i].Play(Clip, 0.08, FMath.FRandRange(0.9, 1.15)); }
    }
  },

  TickCommentators(_Dt) {
    if (!this.Fighters[0] || !this.Fighters[1]) { return; }
    const Mid = this.Fighters[0].GetActorLocation().Add(this.Fighters[1].GetActorLocation()).Mul(0.5).Add(new FVector(0, 0, 110));
    for (let i = 0; i < 2; ++i) {
      const Booth = this.Commentators[i];
      if (!Booth) { continue; }
      Booth.SetLookTarget(Mid, 0.9);
      if (Booth.IsClipDone() && Booth.GetClip() !== 'SitIdle') { Booth.Play('SitIdle', 0.2); }
    }
  },

  // ---------------------------------------------------------------------------------------------
  // Commentary
  // ---------------------------------------------------------------------------------------------

  LoadCommentary() {
    const LoadCaptions = (File: string, Prefix: string, Out: Map<string, string>) => {
      const Root = Assets.Json<Record<string, unknown> | undefined>(File);
      if (Root) {
        for (const [Key, Value] of Object.entries(Root)) { Out.set(Prefix + Key, String(Value)); }
      } else { console.warn(`Missing captions: ${File}.json`); }
    };
    LoadCaptions('announcer', 'VO_', this.AnnouncerCaptions);
    LoadCaptions('captions_pt_BR', '', this.PortugueseCaptions);
    for (const Def of CpvData.Roster()) {
      const DisplayName = Def.Name;
      const Entrance = `VO_Name_${Def.VoiceId}`;
      const WinnerCall = `VO_Win_${Def.VoiceId}`;
      this.AnnouncerCaptions.set(Entrance, `${DisplayName}!`);
      this.AnnouncerCaptions.set(WinnerCall, `Your winner... ${DisplayName}!`);
      this.PortugueseCaptions.set(Entrance, `${DisplayName}!`);
      const WinnerTemplate = this.PortugueseCaptions.get('winner') ?? '';
      this.PortugueseCaptions.set(WinnerCall, ReplaceName(WinnerTemplate, DisplayName));
    }
    const Root = Assets.Json<Record<string, unknown> | undefined>('commentary');
    if (!Root) {
      console.warn('No commentary: commentary.json');
      return;
    }
    for (const [Key, Value] of Object.entries(Root)) {
      const List: FLine[] = [];
      this.Lines.set(Key, List);
      for (const A of Value as unknown[]) {
        if (Array.isArray(A) && A.length >= 2) { List.push({ Speaker: Math.trunc(Number(A[0])), Text: String(A[1]) }); }
      }
    }
  },

  Say(Event, Chance = 1, Name = '') {
    if (this.IsRehearsing() || this.PinSlot >= 0) { return; }
    if (this.IsDemo() || !IsNone(this.PendingVoice) || this.SayCooldown > 0 || FMath.FRand() > Chance) { return; }
    const List = this.Lines.get(Event);
    if (!List || List.length === 0) { return; }
    const Index = FMath.RandRange(0, List.length - 1);
    const Line = List[Index];
    let Key = `VO_${Event}_${Index}`;
    const Localized = this.PortugueseCaptions.get(Key) ?? '';
    const Prop = Name === '' ? undefined : this.PortugueseCaptions.get(Name);
    this.PendingSubtitle.Portuguese = ReplaceName(Localized, Prop ?? Name);
    if (/\{name\}/i.test(Line.Text)) {
      Key += `_${Name.toUpperCase().replace(/ /g, '_')}`;
    }
    this.PendingVoice = Key;
    this.PendingSubtitle.Speaker = Line.Speaker;
    this.PendingSubtitle.Text = ReplaceName(Line.Text, Name);
  },

  // ---------------------------------------------------------------------------------------------
  // Sound
  // ---------------------------------------------------------------------------------------------

  FindSound(Name) {
    const Found = this.Sounds.get(Name);
    if (Found !== undefined) { return Found; }
    const Sound = Audio.FindSound(Name);
    this.Sounds.set(Name, Sound);
    return Sound;
  },

  StopVoice() {
    if (IsValid(this.VoiceComp)) { this.VoiceComp.Stop(); }
    this.VoiceComp = null;
    this.PendingVoice = '';
    this.Subtitle.Left = 0;
    this.SayCooldown = 0;
    this.DuckLeft = 0;
  },

  PlaySound(Name, Volume = 1, Pitch = 1) {
    const Sound = this.FindSound(Name);
    if (!Sound) { return; }
    const Key = Name;
    const bVoice = Key.startsWith('VO_');
    const bUi = Name === 'Tick' || Name === 'Select' || Name === 'Back';
    if (this.Arena && this.Arena.IsTaping() && !bVoice && !bUi) {
      const At = this.GetWorld().GetTimeSeconds();
      RemoveAll(this.TapeSounds, (S) => S.At < At - 6);
      this.TapeSounds.push({ At, Name, Volume, Pitch });
    }
    let Level = Volume;
    if (bVoice) {
      // Voices sit on top of the mix, and the music and crowd step back while they speak.
      this.StopVoice();
      this.DuckLeft = Sound.GetDuration() + 0.15;
      const Words = this.AnnouncerCaptions.get(Name);
      if (Words !== undefined) {
        this.Subtitle.Speaker = INDEX_NONE;
        this.Subtitle.Text = Words;
        this.Subtitle.Portuguese = this.PortugueseCaptions.get(Name) ?? '';
        this.Subtitle.Left = FMath.Max(1, this.DuckLeft);
      }
      LogVerbose(() => `Voice ${Key} (${Sound.GetDuration().toFixed(2)}s)`);
      this.VoiceLevel = Level * 1.25;
      const Gain = this.VoiceLevel * this.BusGain(ECpvAudioBus.Voice);
      if (Gain > 0) { this.VoiceComp = UGameplayStatics.SpawnSound2D(Sound, Gain, Pitch); }
      return;
    } else if (this.IsDemo() && !bUi) {
      Level *= 0.45;   // the bout behind the menus stays in the background
    }
    const bCrowd = Name === 'Cheer' || Name === 'Gasp';
    let Bus = ECpvAudioBus.Effects;
    if (bUi) { Bus = ECpvAudioBus.Interface; }
    else if (bCrowd) { Bus = ECpvAudioBus.Crowd; }
    else if (Name === 'Fanfare' || Key.startsWith('Theme_')) { Bus = ECpvAudioBus.Music; }
    this.PlayMixedClip(Sound, Bus, Level, Pitch);
  },

  BusGain(Bus) {
    return (this.MasterGain() * this.BusVolume[Bus]) / 10;
  },

  PlayMixedClip(Sound, Bus, Level, Pitch = 1) {
    RemoveAll(this.PlayingClips, (Clip) => !IsValid(Clip.Component) || !Clip.Component.IsPlaying());
    const Gain = Level * this.BusGain(Bus);
    if (Sound && Gain > 0) {
      const Comp = UGameplayStatics.SpawnSound2D(Sound, Gain, Pitch);
      if (Comp) {
        this.PlayingClips.push({ Component: Comp, Bus, Level });
        return Comp;
      }
    }
    return null;
  },

  StartLoop(Which, Name, Level) {
    const Sound = this.FindSound(Name);
    if (Which === 'Music') { this.MusicLevel = Level; }
    let Comp = Which === 'Music' ? this.MusicComp : this.CrowdComp;
    if (!Comp || Comp.Sound !== Sound) {
      if (Comp) {
        Comp.Stop();
        Comp.bDestroyed = true;
      }
      Comp = Sound ? UGameplayStatics.CreateSound2D(Sound, 1, 1) : null;
      if (Which === 'Music') { this.MusicComp = Comp; } else { this.CrowdComp = Comp; }
    }
    this.RefreshBeds();
  },

  RefreshMix() {
    for (const Clip of this.PlayingClips) {
      if (IsValid(Clip.Component)) { Clip.Component.SetVolumeMultiplier(Clip.Level * this.BusGain(Clip.Bus)); }
    }
    if (IsValid(this.VoiceComp)) { this.VoiceComp.SetVolumeMultiplier(this.VoiceLevel * this.BusGain(ECpvAudioBus.Voice)); }
    this.RefreshBeds();
  },

  TickAudio(Dt) {
    this.DuckLeft = FMath.Max(0, this.DuckLeft - Dt);
    // Let the ring announcer finish before the booth responds.
    if (!IsNone(this.PendingVoice) && this.DuckLeft <= 0 && (!IsValid(this.VoiceComp) || !this.VoiceComp.IsPlaying())) {
      const Key = this.PendingVoice;
      this.PendingVoice = '';
      this.PlaySound(Key, 0.9);
      this.Subtitle = this.PendingSubtitle.Clone();
      const ReadTime = FMath.Clamp(1.6 + (this.bPortugueseSubtitles ? this.Subtitle.Portuguese.length : this.Subtitle.Text.length) * 0.045, 2.2, 4.5);
      this.Subtitle.Left = FMath.Max(ReadTime, this.DuckLeft);
      this.SayCooldown = this.Subtitle.Left + 1.2;
      if (this.Commentators[this.Subtitle.Speaker]) { this.Commentators[this.Subtitle.Speaker].Play('SitTalk', 0.1); }
    }
    this.TickBeds(Dt);
  },

  TickBeds(Dt) {
    const bSpeech = (!this.bPaused && this.DuckLeft > 0) || (IsValid(this.VoicePreview) && this.VoicePreview.IsPlaying());
    const bDuck = this.bVoiceDucking && bSpeech && this.BusGain(ECpvAudioBus.Voice) > 0;
    this.Duck = FMath.FInterpTo(this.Duck, bDuck ? 0.4 : 1, Dt, 7);
    this.RefreshBeds();
  },

  RefreshBeds() {
    const SetLoop = (Comp: UAudioComponent | null, Gain: number) => {
      if (!Comp) { return; }
      if (Gain <= 0) {
        if (Comp.IsPlaying()) { Comp.Stop(); }
        return;
      }
      Comp.SetVolumeMultiplier(Gain);
      if (!Comp.IsPlaying()) { Comp.Play(); }
    };
    if (this.Arena) {
      const Level = (0.22 + 0.7 * this.Arena.GetHype()) * (this.IsDemo() ? 0.7 : 1);
      SetLoop(this.CrowdComp, Level * this.BusGain(ECpvAudioBus.Crowd) * FMath.Lerp(1, this.Duck, 0.6));
    }
    SetLoop(this.MusicComp, this.MusicLevel * this.BusGain(ECpvAudioBus.Music) * this.Duck);
  },

  LoadOptions() {
    const Section = 'ClayPerView.Options';
    this.Difficulty = GConfig.GetInt(Section, 'Difficulty', this.Difficulty);
    this.RoundsToWin = GConfig.GetInt(Section, 'RoundsToWin', this.RoundsToWin);
    this.RoundSeconds = GConfig.GetInt(Section, 'RoundSeconds', this.RoundSeconds);
    this.AnimStyle = GConfig.GetInt(Section, 'AnimStyle', this.AnimStyle);
    this.SoundVolume = GConfig.GetInt(Section, 'Volume', this.SoundVolume);
    this.LoadAVOptions();
    this.bFullscreen = GConfig.GetBool(Section, 'Fullscreen', this.bFullscreen);
    this.Difficulty = FMath.Clamp(this.Difficulty, 0, 2);
    this.RoundsToWin = FMath.Clamp(this.RoundsToWin, 1, 2);
    this.RoundSeconds = this.RoundSeconds === 60 || this.RoundSeconds === 0 ? this.RoundSeconds : 99;
    this.AnimStyle = FMath.Clamp(this.AnimStyle, 0, 2);
    this.SoundVolume = FMath.Clamp(this.SoundVolume, 0, 10);
  },

  SaveOptions() {
    const Section = 'ClayPerView.Options';
    GConfig.SetInt(Section, 'Difficulty', this.Difficulty);
    GConfig.SetInt(Section, 'RoundsToWin', this.RoundsToWin);
    GConfig.SetInt(Section, 'RoundSeconds', this.RoundSeconds);
    GConfig.SetInt(Section, 'AnimStyle', this.AnimStyle);
    GConfig.SetInt(Section, 'Volume', this.SoundVolume);
    this.SaveAVOptions();
    GConfig.SetBool(Section, 'Fullscreen', this.bFullscreen);
    GConfig.Flush();
  },

  // ---------------------------------------------------------------------------------------------
  // The big screen on the entrance stage
  // ---------------------------------------------------------------------------------------------

  DrawStageScreen(Top, Main, Colour) {
    const Target = this.Arena ? this.Arena.GetStageScreen() : null;
    if (!Target) { return; }
    const Canvas = Target.Ctx;
    const Size = new FVector2D(Target.Width, Target.Height);
    CpvUi.Fill(Canvas, 0, 0, Size.X, Size.Y, new FLinearColor(0.012, 0.014, 0.05));
    for (let i = 0; i < 9; ++i) {   // sunburst stripes
      const X = Size.X * 0.5, Y = Size.Y * 1.25;
      const A0 = -UE_PI + (UE_PI * (i * 2)) / 18, A1 = -UE_PI + (UE_PI * (i * 2 + 1)) / 18;
      CpvUi.Quad(Canvas, new FVector2D(X, Y), new FVector2D(X + FMath.Cos(A0) * 1400, Y + FMath.Sin(A0) * 1400),
        new FVector2D(X + FMath.Cos(A1) * 1400, Y + FMath.Sin(A1) * 1400), new FVector2D(X, Y), new FLinearColor(Colour.R, Colour.G, Colour.B, 0.16));
    }
    CpvUi.Text(Canvas, Top, Size.X * 0.5, 110, CpvUi.Font(ECpvFont.Impact, 76, 40), FLinearColor.White, ECpvAlign.Center);
    let Pt = 190;
    while (Pt > 60 && CpvUi.Measure(Main, CpvUi.Font(ECpvFont.Title, Pt)).X > Size.X - 80) { Pt -= 8; }
    CpvUi.Outlined(Canvas, Main, Size.X * 0.5, 215 + (190 - Pt) * 0.4, CpvUi.Font(ECpvFont.Title, Pt), Colour, new FLinearColor(0.02, 0.02, 0.05), 7, ECpvAlign.Center);
    CpvUi.Fill(Canvas, 0, Size.Y - 64, Size.X, 64, new FLinearColor(Colour.R, Colour.G, Colour.B, 0.9));
    CpvUi.Text(Canvas, 'LIVE  *  FAMOUS LAST BLOWS  *  LIVE', Size.X * 0.5, Size.Y - 56, CpvUi.Font(ECpvFont.Impact, 40, 60), new FLinearColor(0.02, 0.02, 0.05), ECpvAlign.Center);
    Target.MarkDirty();
  },
});
