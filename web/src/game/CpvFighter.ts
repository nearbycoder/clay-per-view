// Port of CpvFighter.h / CpvFighter.cpp: the brawler - movement, strikes, combos, blocking, grapples,
// whips, knockdowns, signature moves and weapons.

import { LogVerbose } from '../engine/platform';
import { FLinearColor, FMath, FRotator, FTransform, FVector, FVector2D } from '../engine/ue';
import { UStaticMeshComponent } from '../engine/world';
import { CpvData } from './CpvData';
import type { ACpvGameMode } from './CpvGame';
import { ECpvBone } from './CpvPose';
import { ACpvPuppet } from './CpvPuppet';
import { CpvRule, DefaultMove, ECpvReaction, ECpvSpecial, ECpvState, ECpvWeapon, ECpvWord, FCpvFighterDef, FCpvInput, FCpvMove } from './CpvTypes';

export enum ECpvThrow { None, Headbutt, Slam, Whip, Shove }

// Throwing whatever is in your hand. Handled as a strike whose "hit" launches a projectile.
const GThrowMove: FCpvMove = { ...DefaultMove, Clip: 'Throw', HitTime: 0.32, Duration: 0.78, Damage: 0, Range: 0, Lunge: 0, Sound: 'Whoosh' };

function YawOf(Dir: FVector2D): number { return FMath.RadiansToDegrees(FMath.Atan2(Dir.Y, Dir.X)); }

/** Keeps a point within the ropes. Returns it with the ring side that was hit (0..3), or -1. */
function ClampToRing(P: FVector2D, Limit: number): { P: FVector2D; Side: number } {
  let X = P.X, Y = P.Y;
  let Side = -1;
  if (X > Limit) { X = Limit; Side = 0; }
  else if (X < -Limit) { X = -Limit; Side = 1; }
  if (Y > Limit) { Y = Limit; Side = 2; }
  else if (Y < -Limit) { Y = -Limit; Side = 3; }
  return { P: Side < 0 ? P : new FVector2D(X, Y), Side };
}

/** The input buffers: a press is remembered for a moment so it is not lost between states. */
type FBuffer = 'BufLight' | 'BufHeavy' | 'BufGrab' | 'BufSpecial' | 'BufTaunt' | 'BufDodge';

/** A playable (or AI-driven) brawler. The game mode steps fighters in a fixed order each frame. */
export class ACpvFighter extends ACpvPuppet {
  Slot = 0;
  RosterIndex = 0;
  Health: number = CpvRule.MaxHealth;
  ShownHealth: number = CpvRule.MaxHealth;   // trails Health for the HUD's damage flash
  Hype = 0;
  Height = 0;
  Weapon = ECpvWeapon.None;
  WeaponUses = 0;
  bArmor = false;
  bDazeOnKo = false;        // deciding round: stagger about waiting for a finisher instead of dropping
  Move: FCpvMove | null = null;

  // stats for the results screen
  Combo = 0;
  BestCombo = 0;
  DamageDealt = 0;
  HitsLanded = 0;
  Taunts = 0;

  private WeaponComp = new UStaticMeshComponent();
  private Foe: ACpvFighter | null = null;
  private Game: ACpvGameMode | null = null;
  private Partner: ACpvFighter | null = null;   // the other half of a clinch or throw

  private State = ECpvState.Idle;
  private StateTime = 0;
  private Vel = FVector2D.ZeroVector;      // knockback / slide velocity
  private VertVel = 0;
  private bBounced = false;
  private InvulnLeft = 0;
  private StunLeft = 0;
  private DownLeft = 0;
  private GroundHits = 0;       // blows taken while lying on the mat this knockdown
  private GuardWindow = 0;
  private bGuardHeld = false;
  private BlockedPenalty = 0;   // extra recovery after a strike bounces off a guard (and no combo follow-up)
  private bFaceDown = false;
  private bStrikeDone = false;
  private bMoveConnected = false;
  private ComboStep = 0;
  private ComboClock = 0;
  private RunBonus = 0;                        // > 0 just after bouncing off the ropes
  private TravelDir = new FVector2D(1, 0);     // dodge / whip / rebound direction
  private Throw = ECpvThrow.None;
  private ThrowStage = 0;
  private SpecialStage = 0;
  private SpecialClock = 0;
  private Escape = 0;
  private Juggle = 0;            // hits taken in the current beating
  private JuggleClock = 0;
  private bKoHandled = false;
  private bWeaponOnLeft = false;
  private PropGrip = new FVector(0, 0, 20);
  private PropTurn = new FRotator(-90, 0, 0);
  private BufLight = 0;
  private BufHeavy = 0;
  private BufGrab = 0;
  private BufSpecial = 0;
  private BufTaunt = 0;
  private BufDodge = 0;

  constructor() {
    super();
    this.WeaponComp.SetVisibility(false);
  }

  /** The weapon component belongs to the fighter and goes with it (Unreal does this for its components). */
  override Destroy(): void {
    super.Destroy();
    this.WeaponComp.DestroyComponent();
  }

  Setup(InSlot: number, InRosterIndex: number, InGame: ACpvGameMode): void {
    this.Slot = InSlot;
    this.RosterIndex = InRosterIndex;
    this.Game = InGame;
    this.SetCharacter(this.Def().Id);
    this.Hype = 0;
    this.Combo = this.BestCombo = this.HitsLanded = this.Taunts = 0;
    this.DamageDealt = 0;
  }

  ResetForRound(Start: FVector, Yaw: number): void {
    this.SetActorLocationAndRotation(Start, new FRotator(0, Yaw, 0));
    this.Health = this.ShownHealth = CpvRule.MaxHealth;
    this.Height = this.VertVel = 0;
    this.Vel = FVector2D.ZeroVector;
    this.VisualOffset = FVector.ZeroVector;
    this.VisualScale = FVector.Splat(1);
    this.VisualYaw = 0;
    this.HeadSquash = new FVector2D(1, 1);
    this.BoneScale.fill(1);
    this.bHidden = false;
    this.Partner = null;
    this.Move = null;
    this.bArmor = this.bKoHandled = this.bStrikeDone = this.bBounced = false;
    this.InvulnLeft = this.StunLeft = this.DownLeft = this.RunBonus = this.JuggleClock = 0;
    this.Juggle = 0;
    this.GuardWindow = 0;
    this.bGuardHeld = false;
    this.BufLight = this.BufHeavy = this.BufGrab = this.BufSpecial = this.BufTaunt = this.BufDodge = 0;
    this.Combo = 0;
    this.Weapon = ECpvWeapon.None;
    this.WeaponComp.SetVisibility(false);
    this.State = ECpvState.Idle;
    this.StateTime = 0;
    this.UpdateMirror();
    this.MirrorAlpha = this.bMirror ? 1 : 0;
    this.Play('Idle', 0);
    this.ForceStep();
  }

  // --- queries ---
  GetState(): ECpvState { return this.State; }
  GetStateTime(): number { return this.StateTime; }
  IsDown(): boolean { return this.State === ECpvState.Down || this.State === ECpvState.Dead; }
  IsAttacking(): boolean { return this.State === ECpvState.Attack || this.State === ECpvState.GrabTry || this.State === ECpvState.Special; }
  /** Swung and now recovering: the moment to hit back. */
  IsRecovering(): boolean { return this.State === ECpvState.Attack && this.bStrikeDone && this.Move !== null; }
  RecoveryLeft(): number { return this.IsRecovering() && this.Move ? FMath.Max(0, this.Move.Duration + this.BlockedPenalty - this.StateTime) : 0; }
  IsBusy(): boolean { return this.State !== ECpvState.Idle && this.State !== ECpvState.Run && this.State !== ECpvState.Block; }
  HasFullHype(): boolean { return this.Hype >= CpvRule.MaxHype - 0.01; }
  Pos2D(): FVector2D { return new FVector2D(this.GetActorLocation().X, this.GetActorLocation().Y); }
  DistanceTo(Other: ACpvFighter): number { return this.Pos2D().Sub(Other.Pos2D()).Size(); }
  Def(): FCpvFighterDef { return CpvData.Fighter(this.RosterIndex); }
  SetFoe(InFoe: ACpvFighter | null): void { this.Foe = InFoe; }
  GetFoe(): ACpvFighter | null { return this.Foe; }

  private SpeedMul(): number { return 0.88 + 0.06 * this.Def().Speed; }
  private PowerMul(): number { return 0.82 + 0.07 * this.Def().Power; }
  private GutsMul(): number { return 1.18 - 0.07 * this.Def().Guts; }

  Facing2D(): FVector2D {
    const Yaw = FMath.DegreesToRadians(this.GetActorRotation().Yaw);
    return new FVector2D(FMath.Cos(Yaw), FMath.Sin(Yaw));
  }

  private RingLimit(): number {
    return this.Game && this.Game.GetArena() ? this.Game.GetArena().RingLimit() : 236;
  }

  IsStanding(): boolean {
    switch (this.State) {
      case ECpvState.Down: case ECpvState.Dead: case ECpvState.Airborne: case ECpvState.GetUp: case ECpvState.Thrown: return false;
      default: return true;
    }
  }

  IsHittable(): boolean {
    return this.State !== ECpvState.Dead && this.State !== ECpvState.Scripted && this.State !== ECpvState.Win && this.State !== ECpvState.Thrown
      && this.State !== ECpvState.Held && this.InvulnLeft <= 0;
  }

  CanBeGrabbed(): boolean {
    if (this.InvulnLeft > 0 || this.Height > 1) { return false; }
    switch (this.State) {
      case ECpvState.Idle: case ECpvState.Run: case ECpvState.Block: case ECpvState.BlockStun: case ECpvState.HitStun: case ECpvState.Stagger:
      case ECpvState.Attack: case ECpvState.GrabTry: case ECpvState.Taunt: case ECpvState.Pickup: case ECpvState.Whipped: case ECpvState.Rebound:
        return true;
      default: return false;
    }
  }

  AddHype(Amount: number): void {
    const bWasFull = this.HasFullHype();
    this.Hype = FMath.Clamp(this.Hype + Amount, 0, CpvRule.MaxHype);
    if (!bWasFull && this.HasFullHype() && this.Game) { this.Game.OnHypeFull(this); }
  }

  // --- scripted control (intros, finishers, victory) ---
  SetScripted(bOn: boolean): void {
    if (bOn) {
      this.Partner = null;
      this.Move = null;
      this.Vel = FVector2D.ZeroVector;
      this.Height = 0;
      this.bArmor = false;
      this.State = ECpvState.Scripted;
      this.StateTime = 0;
    } else if (this.State === ECpvState.Scripted) {
      this.EnterState(ECpvState.Idle);
    }
  }

  EnterState(NewState: ECpvState): void {
    LogVerbose(() => `state ${this.Def().Id} slot=${this.Slot} ${this.State}->${NewState}`);
    this.State = NewState;
    this.StateTime = 0;
    this.bStrikeDone = false;
    this.BlockedPenalty = 0;
    if (NewState === ECpvState.Down) { this.GroundHits = 0; }
    if (NewState === ECpvState.Idle) {
      this.Move = null;
      this.bArmor = false;
      this.Throw = ECpvThrow.None;
      this.ComboStep = 0;
      if (this.WeaponComp.IsVisible() && this.Weapon === ECpvWeapon.None) { this.WeaponComp.SetVisibility(false); } // signature props
    }
  }

  Kill(bFlat: boolean): void {
    if (this.State === ECpvState.Dead) { return; }
    this.DropWeapon(false);
    if (!bFlat && this.IsStanding()) { this.Play('Collapse', 0.08); }
    this.State = ECpvState.Dead;
    this.StateTime = 0;
    this.Vel = FVector2D.ZeroVector;
    this.Health = 0;
  }

  RecoverFromCover(bShouldersUp: boolean): void {
    this.Vel = FVector2D.ZeroVector;
    this.BufLight = this.BufHeavy = this.BufGrab = this.BufSpecial = this.BufTaunt = this.BufDodge = 0;
    if (bShouldersUp) {
      this.EnterState(ECpvState.GetUp);
      this.InvulnLeft = 0.75;
      this.Play('GetUp', 0.12);
    } else {
      this.EnterState(ECpvState.Stagger);
      this.StunLeft = 0.46;
      this.Play('Stagger', 0.12);
    }
  }

  Celebrate(): void {
    this.DropWeapon(false);
    this.Partner = null;
    this.State = ECpvState.Win;
    this.StateTime = 0;
    this.Vel = FVector2D.ZeroVector;
    this.Play('Victory', 0.25);
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  private Buffer(In: FCpvInput, Dt: number): void {
    const Keep = 0.2;
    const Track = (Timer: number, bPressed: boolean): number => (bPressed ? Keep : FMath.Max(0, Timer - Dt));
    this.BufLight = Track(this.BufLight, In.bLight);
    this.BufHeavy = Track(this.BufHeavy, In.bHeavy);
    this.BufGrab = Track(this.BufGrab, In.bGrab);
    this.BufSpecial = Track(this.BufSpecial, In.bSpecial);
    this.BufTaunt = Track(this.BufTaunt, In.bTaunt);
    this.BufDodge = Track(this.BufDodge, In.bDodge);
  }

  /** Uses up a buffered press (the C++ takes the timer by reference; here it is named). */
  private Consume(Timer: FBuffer): boolean {
    if (this[Timer] > 0) {
      this[Timer] = 0;
      return true;
    }
    return false;
  }

  private FaceToward(Target: FVector2D, Dt: number, Rate: number): void {
    const To = Target.Sub(this.Pos2D());
    if (To.SizeSquared() < 1) { return; }
    const Want = YawOf(To);
    const Now = this.GetActorRotation().Yaw;
    const Delta = FMath.FindDeltaAngleDegrees(Now, Want);
    const StepYaw = FMath.Clamp(Delta, -Rate * Dt, Rate * Dt);
    this.SetActorRotation(new FRotator(0, Now + StepYaw, 0));
  }

  private MoveBy(Delta: FVector2D): void {
    const P = ClampToRing(this.Pos2D().Add(Delta), this.RingLimit()).P;
    this.SetActorLocation(new FVector(P.X, P.Y, 0));
  }

  private HitRopes(Impulse: number): void {
    if (this.Game && this.Game.GetArena()) {
      this.Game.GetArena().BumpRopesAt(this.GetActorLocation(), Impulse);
      this.Game.PlaySound('Ropes', FMath.Clamp(Impulse / 500, 0.3, 1));
    }
  }

  UpdateMirror(): void {
    const X = this.Facing2D().X;
    const bWant = X < -0.2 ? true : (X > 0.2 ? false : this.bMirror);
    if (bWant !== this.bMirror) {
      this.bMirror = bWant;
      this.UpdateWeaponAttachment();
    }
  }

  private UpdateWeaponAttachment(): void {
    if (!this.WeaponComp.IsVisible()) { return; }
    // Bone space: X = thumb side, Y = down the arm. By default the prop's +Z (business end) lies along the thumb.
    const R = (this.Weapon !== ECpvWeapon.None ? new FRotator(-90, 0, 0) : this.PropTurn).Quaternion();
    const Grip = this.Weapon !== ECpvWeapon.None ? CpvData.Weapon(this.Weapon).GripOffset : this.PropGrip;
    const Loc = new FVector(0, 7, 0).Sub(R.RotateVector(Grip));
    this.AttachProp(this.WeaponComp, this.bMirror ? ECpvBone.HandL : ECpvBone.HandR, new FTransform(R, Loc));
    this.bWeaponOnLeft = this.bMirror;
  }

  // --- weapons ---
  GiveWeapon(Type: ECpvWeapon, Uses: number): void {
    if (Type === ECpvWeapon.None) { return; }
    this.Weapon = Type;
    this.WeaponUses = Uses;
    this.WeaponComp.SetStaticMesh(CpvData.Weapon(Type).Mesh);
    this.WeaponComp.SetVisibility(true);
    this.UpdateWeaponAttachment();
  }

  /** Show a prop in the weapon hand without it being a usable weapon (signature moves, finishers). Null hides it. */
  SetHandProp(MeshPath: string | null, Grip: FVector = new FVector(0, 0, 20), Turn: FRotator = new FRotator(-90, 0, 0)): void {
    this.Weapon = ECpvWeapon.None;
    if (!MeshPath) {
      this.WeaponComp.SetVisibility(false);
      return;
    }
    this.PropGrip = Grip;
    this.PropTurn = Turn;
    this.WeaponComp.SetStaticMesh(MeshPath);
    this.WeaponComp.SetVisibility(true);
    this.UpdateWeaponAttachment();
  }

  DropWeapon(bBreak: boolean): void {
    if (this.Weapon === ECpvWeapon.None) { return; }
    const At = this.GetBoneLocation(this.bWeaponOnLeft ? ECpvBone.HandL : ECpvBone.HandR);
    if (this.Game) {
      if (bBreak) { this.Game.BreakWeapon(this.Weapon, At); }
      else { this.Game.DropWeaponAt(this.Weapon, this.WeaponUses, At, this.Facing2D().Mul(-120).Add(new FVector2D(FMath.FRandRange(-80, 80), FMath.FRandRange(-80, 80)))); }
    }
    this.Weapon = ECpvWeapon.None;
    this.WeaponComp.SetVisibility(false);
  }

  // ---------------------------------------------------------------------------------------------
  // Starting things
  // ---------------------------------------------------------------------------------------------

  private StartMove(InMove: FCpvMove): void {
    this.Move = InMove;
    this.bMoveConnected = false;
    this.EnterState(ECpvState.Attack);
    this.Play(InMove.Clip, 0.05);
    if (this.Game) { this.Game.PlaySound('Whoosh', 0.5, FMath.FRandRange(0.9, 1.15)); }
  }

  private StartLight(): void {
    const bFoeDown = this.Foe !== null && this.Foe.State === ECpvState.Down && this.DistanceTo(this.Foe) < 165;
    if (bFoeDown) { this.StartMove(CpvData.Stomp); }
    else if (this.Weapon !== ECpvWeapon.None) { this.StartMove(CpvData.WeaponSwing); }
    else {
      this.ComboStep = 1;
      this.StartMove(CpvData.Jab);
    }
  }

  private StartHeavy(In: FCpvInput): void {
    const bFoeDown = this.Foe !== null && this.Foe.State === ECpvState.Down && this.DistanceTo(this.Foe) < 190;
    if (bFoeDown) { this.StartMove(CpvData.Splash); return; }
    if (this.Weapon !== ECpvWeapon.None) { this.StartMove(CpvData.WeaponSmash); return; }
    const ToFoe = this.Foe ? this.Foe.Pos2D().Sub(this.Pos2D()).GetSafeNormal() : this.Facing2D();
    const bForward = In.Move.SizeSquared() > 0.2 && FVector2D.DotProduct(In.Move.GetSafeNormal(), ToFoe) > 0.5;
    this.StartMove(bForward ? CpvData.Boot : CpvData.Haymaker);
  }

  private StartGrab(): void {
    if (this.Weapon !== ECpvWeapon.None) {
      this.StartMove(GThrowMove);
      return;
    }
    if (this.Game && this.Game.TryCover(this)) { return; }
    const Dist = this.Foe ? this.DistanceTo(this.Foe) : 1000;
    if (this.Game && this.Game.WeaponNear(this, 125) && (Dist > 135 || (this.Foe !== null && !this.Foe.IsStanding()))) {
      this.EnterState(ECpvState.Pickup);
      this.Play('Pickup', 0.06);
      return;
    }
    this.EnterState(ECpvState.GrabTry);
    this.Play('GrabTry', 0.06);
  }

  private StartDodge(Dir: FVector2D): void {
    this.TravelDir = Dir.GetSafeNormal();
    if (this.TravelDir.IsNearlyZero()) { this.TravelDir = this.Facing2D().Neg(); }
    this.EnterState(ECpvState.Dodge);
    this.InvulnLeft = 0.27;
    const bForward = FVector2D.DotProduct(this.TravelDir, this.Facing2D()) > 0.6;
    this.Play(bForward ? 'Roll' : 'Dodge', 0.04, bForward ? 1.4 : 1);
    if (this.Game) { this.Game.PlaySound('Whoosh', 0.4, 1.3); }
  }

  private StartSpecial(): boolean {
    const Foe = this.Foe, Game = this.Game;
    if (!Foe || !Game) { return false; }
    if (Game.TryStartFinisher(this)) { return true; }
    if (!this.HasFullHype()) { return false; }
    this.Hype = 0;
    this.EnterState(ECpvState.Special);
    this.SpecialStage = 0;
    this.SpecialClock = 0;
    this.bArmor = true;
    this.SetActorRotation(new FRotator(0, YawOf(Foe.Pos2D().Sub(this.Pos2D())), 0));
    switch (this.Def().Special) {
      case ECpvSpecial.Bomb: case ECpvSpecial.Orb: this.Play('Throw', 0.08, 0.85); break;
      case ECpvSpecial.Scream: case ECpvSpecial.Flame: this.Play('SpecScream', 0.08); break;
      case ECpvSpecial.Zap: this.Play('SpecZap', 0.08); break;
      case ECpvSpecial.Chord: this.Play('SpecStrum', 0.08); break;
      case ECpvSpecial.Shockwave: this.Play('SpecSlam', 0.08); break;
      case ECpvSpecial.Scepter:
        this.DropWeapon(false);
        this.SetHandProp('/Game/CPV/Props/SM_Scepter.SM_Scepter', new FVector(0, 0, 12));
        this.Play('WeaponSwing', 0.08, 0.62);
        break;
    }
    Game.OnSpecial(this);
    return true;
  }

  private StartClinch(Victim: ACpvFighter): void {
    let Dir = Victim.Pos2D().Sub(this.Pos2D()).GetSafeNormal();
    if (Dir.IsNearlyZero()) { Dir = this.Facing2D(); }
    this.Partner = Victim;
    Victim.Partner = this;
    this.SetActorRotation(new FRotator(0, YawOf(Dir), 0));
    const Spot = ClampToRing(this.Pos2D().Add(Dir.Mul(62)), this.RingLimit()).P;
    Victim.SetActorLocationAndRotation(new FVector(Spot.X, Spot.Y, 0), new FRotator(0, YawOf(Dir.Neg()), 0));
    Victim.Vel = FVector2D.ZeroVector;
    Victim.Move = null;
    Victim.bArmor = false;
    Victim.Escape = 0;
    Victim.EnterState(ECpvState.Held);
    Victim.Play('ClinchV', 0.08);
    Victim.UpdateMirror();
    this.EnterState(ECpvState.Clinch);
    this.Play('ClinchA', 0.08);
    if (this.Game) { this.Game.OnGrab(this, Victim); }
  }

  private StartThrow(Kind: ECpvThrow, Dir: FVector2D): void {
    const Partner = this.Partner;
    if (!Partner) {
      this.EnterState(ECpvState.Idle);
      return;
    }
    this.Throw = Kind;
    this.ThrowStage = 0;
    this.TravelDir = Dir.IsNearlyZero() ? this.Facing2D() : Dir.GetSafeNormal();
    this.EnterState(ECpvState.Throwing);
    Partner.EnterState(ECpvState.Thrown);
    switch (Kind) {
      case ECpvThrow.Headbutt: this.Play('Headbutt', 0.05); Partner.Play('HeadbuttV', 0.05); break;
      case ECpvThrow.Slam: this.Play('SlamA', 0.06); Partner.Play('SlamV', 0.06); break;
      case ECpvThrow.Whip: this.Play('WhipA', 0.06); break;
      case ECpvThrow.Shove: this.Play('ShoveA', 0.05); Partner.Play('ShoveV', 0.05); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Hitting and being hit
  // ---------------------------------------------------------------------------------------------

  private DoStrike(InMove: FCpvMove): void {
    if (InMove === GThrowMove) {
      if (this.Weapon !== ECpvWeapon.None && this.Game) {
        this.Game.ThrowWeapon(this, this.Weapon, this.WeaponUses);
        this.Weapon = ECpvWeapon.None;
        this.WeaponComp.SetVisibility(false);
      }
      return;
    }
    const bWeaponMove = InMove === CpvData.WeaponSwing || InMove === CpvData.WeaponSmash;
    const M: FCpvMove = { ...InMove };
    if (bWeaponMove && this.Weapon !== ECpvWeapon.None) {
      const W = CpvData.Weapon(this.Weapon);
      M.Damage += W.Damage;
      M.Word = W.Word;
      M.Sound = W.Sound;
    }
    let Scale = this.PowerMul();
    if (this.RunBonus > 0) { Scale *= 1.25; }
    let bLanded = false;
    const Foe = this.Foe;
    if (Foe && Foe.IsHittable()) {
      const bDownTarget = Foe.State === ECpvState.Down;
      const bAllowed = bDownTarget ? M.bHitsDown : (M.bHitsStanding && Foe.Height < 150);
      const To = Foe.Pos2D().Sub(this.Pos2D());
      const Dist = To.Size();
      const Dot = Dist > 1 ? FVector2D.DotProduct(To.Div(Dist), this.Facing2D()) : 1;
      if (bAllowed && Dist <= M.Range && (Dist < 48 || Dot >= FMath.Cos(FMath.DegreesToRadians(M.Arc)))) {
        bLanded = Foe.TakeHit(this, M, Scale);
        if (bLanded && bWeaponMove && this.Weapon !== ECpvWeapon.None) {
          this.AddHype(CpvData.Weapon(this.Weapon).HypeBonus);
          if (--this.WeaponUses <= 0) { this.DropWeapon(true); }
        }
      }
    }
    if (this.Game) { this.Game.StrikeReferee(this, M); }
    LogVerbose(() => `strike ${this.Def().Id} ${M.Clip} landed=${bLanded ? 1 : 0} dist=${(Foe ? this.DistanceTo(Foe) : -1).toFixed(0)} `
      + `foeState=${Foe ? Foe.State : -1} foeInv=${(Foe ? Foe.InvulnLeft : 0).toFixed(2)}`);
  }

  // --- being hit ---
  /** Returns true if the blow landed (false if blocked or dodged). */
  TakeHit(From: ACpvFighter | null, InMove: FCpvMove, DamageScale: number): boolean {
    const Dir = From ? this.Pos2D().Sub(From.Pos2D()).GetSafeNormal() : this.Facing2D().Neg();
    if (this.State === ECpvState.Block && !InMove.bUnblockable && FVector2D.DotProduct(this.Facing2D(), Dir.Neg()) > 0.2) {
      const bClean = this.GuardWindow > 0;
      this.GuardWindow = 0;
      if (!bClean) { this.Health = FMath.Max(1, this.Health - InMove.Damage * DamageScale * 0.12); }
      this.StunLeft = bClean ? 0.08 : 0.2;
      this.EnterState(ECpvState.BlockStun);
      this.Play('BlockHit', 0.02);
      this.Vel = Dir.Mul(InMove.Knockback * 0.6);
      this.Jolt(6, 0);
      this.Freeze(0.04);
      if (From) {
        From.Freeze(0.04);
        From.AddHype(1);
        // Blocks beat strikes: the attacker recoils, cannot continue the combo and can be hit back.
        From.BlockedPenalty = bClean ? 0.3 : 0.16;
        From.Jolt(-7, 0);
      }
      this.AddHype(bClean ? 8 : 2);
      if (bClean && this.Game) { this.Game.OnCleanBlock(this); }
      if (this.Game) {
        this.Game.OnStrike(From, this, 0, ECpvReaction.Light, ECpvWord.None, 'Block', this.GetActorLocation().Add(new FVector(Dir.X * -20, Dir.Y * -20, 120)), true);
      }
      this.ForceStep();
      return false;
    }
    this.TakeBlow(From, InMove.Damage * DamageScale, InMove.Reaction, Dir.Mul(InMove.Knockback), InMove.Lift, InMove.Word, InMove.Sound, InMove.HitStop);
    return true;
  }

  /** Damage with a chosen reaction, for specials, throws and hazards. */
  TakeBlow(From: ACpvFighter | null, Damage: number, Reaction: ECpvReaction, Push: FVector2D, Lift: number, Word: ECpvWord, Sound: string, HitStop = 0.1): void {
    if (this.State === ECpvState.Dead || this.State === ECpvState.Scripted || this.State === ECpvState.Win) { return; }
    // A long beating does less per hit, and the fifth blow in a row always sends them flying so
    // nobody gets jabbed to death in a corner.
    this.Juggle = this.JuggleClock > 0 ? this.Juggle + 1 : 1;
    this.JuggleClock = 1.3;
    let Dmg = Damage * this.GutsMul() * 0.85 * FMath.Max(0.5, 1 - 0.1 * (this.Juggle - 1));
    if (this.Juggle >= 5 && Reaction < ECpvReaction.Knockdown && this.State !== ECpvState.Down) {
      Reaction = ECpvReaction.Knockdown;
      this.Juggle = 0;
    }
    const bCounter = this.State === ECpvState.Whipped || this.State === ECpvState.Rebound || (this.State === ECpvState.Attack && !this.bStrikeDone);
    if (bCounter) { Dmg *= 1.3; }
    if (this.State === ECpvState.Down) { Dmg *= 0.75; }
    if (this.bArmor) { Dmg *= 0.5; }
    const bWasDazed = this.State === ECpvState.Dazed;
    this.Health = FMath.Max(0, this.Health - Dmg);
    LogVerbose(() => `blow ${this.Def().Id} slot=${this.Slot} dmg=${Dmg.toFixed(1)} by=${
      !From ? 'none' : (From.State === ECpvState.Special ? 'special' : (From.State === ECpvState.Throwing || From.State === ECpvState.Clinch ? 'grapple' : (From.Move ? From.Move.Clip : 'other')))}`);
    this.AddHype(Dmg * 0.4);
    if (From) {
      From.DamageDealt += Dmg;
      From.HitsLanded++;
      From.Combo++;
      From.BestCombo = FMath.Max(From.BestCombo, From.Combo);
      From.ComboClock = 1.7;
      From.bMoveConnected = true;
      From.AddHype(Dmg * 0.95 + (Word !== ECpvWord.None ? 3 : 0) + (bCounter ? 5 : 0));
      From.Freeze(HitStop);
    }
    this.HitFlash(1);
    const PushDir = Push.GetSafeNormal();
    const Strength = Reaction === ECpvReaction.Light ? 9 : (Reaction === ECpvReaction.Gut ? 6 : 18);
    this.Jolt(-FVector2D.DotProduct(PushDir, this.Facing2D()) * Strength, FVector2D.CrossProduct(this.Facing2D(), PushDir) * Strength);
    this.Freeze(HitStop);
    const bLow = !this.IsStanding();
    const At = this.GetActorLocation().Add(new FVector(-PushDir.X * 18, -PushDir.Y * 18, bLow ? 24 + this.Height : (Reaction === ECpvReaction.Gut ? 92 : 128)));
    if (this.Game) { this.Game.OnStrike(From, this, Dmg, Reaction, Word, Sound, At, false); }

    if (this.Health <= 0 && !this.bKoHandled) {
      this.bKoHandled = true;
      if (this.Game) { this.Game.OnKnockout(this, From); }
    }
    if (this.bArmor && this.Health > 0) {
      this.ForceStep();
      return; // signature moves shrug hits off
    }
    if (Reaction >= ECpvReaction.Heavy) { this.DropWeapon(false); }

    if (this.Health <= 0) {
      this.DropWeapon(false);
      if (this.bDazeOnKo && !bWasDazed) {
        // Deciding round: whatever happens, they end up on their feet and helpless.
        if (this.State === ECpvState.Down) {
          this.DownLeft = FMath.Min(this.DownLeft, 0.8);
          this.ForceStep();
          return;
        }
        this.ApplyReaction(Reaction <= ECpvReaction.Gut ? ECpvReaction.Heavy : Reaction, Push, Lift);
      } else {
        this.bDazeOnKo = false;
        this.ApplyReaction(ECpvReaction.Launch, Push.IsNearlyZero() ? this.Facing2D().Mul(-380) : Push.Mul(1.25).Add(PushDir.Mul(220)), FMath.Max(Lift, 560));
      }
      return;
    }

    // Still in it: pick the reaction, upgraded when caught helpless.
    let R = Reaction;
    if ((this.State === ECpvState.Whipped || this.State === ECpvState.Rebound || this.State === ECpvState.Airborne) && R >= ECpvReaction.Heavy) { R = ECpvReaction.Launch; }
    if (this.State === ECpvState.Down || this.State === ECpvState.GetUp) {
      if (R === ECpvReaction.Launch && Lift > 0) {
        this.ApplyReaction(R, Push, Lift * 0.6);
      } else {
        // One free shot at somebody on the mat; the second one gets them scrambling back up.
        ++this.GroundHits;
        this.DownLeft = this.GroundHits >= 2 ? FMath.Min(this.DownLeft, 0.25) : FMath.Min(this.DownLeft + 0.22, 1.5);
        this.ForceStep();
      }
      return;
    }
    this.ApplyReaction(R, Push, Lift);
  }

  private ApplyReaction(Reaction: ECpvReaction, Push: FVector2D, Lift: number): void {
    if (this.Partner) {
      // Being knocked about ends any hold.
      const Other = this.Partner;
      this.Partner = null;
      Other.Partner = null;
      if (Other.State === ECpvState.Clinch || Other.State === ECpvState.Held || Other.State === ECpvState.Throwing || Other.State === ECpvState.Thrown) {
        Other.EnterState(ECpvState.Idle);
      }
    }
    this.Move = null;
    this.bArmor = false;
    this.Vel = Push;
    switch (Reaction) {
      case ECpvReaction.Light:
        this.StunLeft = 0.24;
        this.EnterState(ECpvState.HitStun);
        this.Play('HitHigh', 0.03);
        break;
      case ECpvReaction.Gut:
        this.StunLeft = 0.36;
        this.EnterState(ECpvState.HitStun);
        this.Play('HitGut', 0.03);
        break;
      case ECpvReaction.Heavy:
        this.StunLeft = 0.62;
        this.EnterState(ECpvState.Stagger);
        this.Play('Stagger', 0.04);
        break;
      case ECpvReaction.Knockdown:
        this.EnterState(ECpvState.Down);
        this.Play('KnockDown', 0.04);
        this.DownLeft = 0.62 + 1 + 0.9 * (1 - this.Health / CpvRule.MaxHealth);
        this.bFaceDown = false;
        this.bBounced = false; // reused: mat thump not played yet
        break;
      case ECpvReaction.Launch:
        this.EnterState(ECpvState.Airborne);
        this.Height = FMath.Max(this.Height, 2);
        this.VertVel = FMath.Max(Lift, 380);
        this.bBounced = false;
        this.Play('AirFlail', 0.05);
        break;
    }
    this.ForceStep();
  }

  private ReleaseFromThrow(NewState: ECpvState, Push: FVector2D): void {
    if (this.Partner) {
      this.Partner.Partner = null;
      this.Partner = null;
    }
    if (this.Health <= 0 && NewState !== ECpvState.Down) {
      // Thrown out with nothing left: drop (or reel, in a deciding round).
      this.ApplyReaction(this.bDazeOnKo ? ECpvReaction.Heavy : ECpvReaction.Launch, Push, 520);
      return;
    }
    if (NewState === ECpvState.Stagger) { this.ApplyReaction(ECpvReaction.Heavy, Push, 0); }
    else if (NewState === ECpvState.HitStun) { this.ApplyReaction(ECpvReaction.Light, Push, 0); }
    else {
      this.Vel = Push;
      this.EnterState(NewState);
    }
  }

  private BeginWhipped(Dir: FVector2D): void {
    if (this.Partner) {
      this.Partner.Partner = null;
      this.Partner = null;
    }
    this.TravelDir = Dir.GetSafeNormal();
    this.SetActorRotation(new FRotator(0, YawOf(this.TravelDir), 0));
    this.Vel = FVector2D.ZeroVector;
    this.EnterState(ECpvState.Whipped);
    this.Play('WhipRun', 0.08);
  }

  // ---------------------------------------------------------------------------------------------
  // Per-frame logic
  // ---------------------------------------------------------------------------------------------

  private TickThrow(Dt: number): void {
    const V = this.Partner;
    if (!V) {
      if (this.StateTime > 0.25) { this.EnterState(ECpvState.Idle); }
      return;
    }
    const Fwd = this.Facing2D();
    switch (this.Throw) {
      case ECpvThrow.Headbutt:
        if (this.ThrowStage === 0 && this.StateTime >= 0.22) {
          this.ThrowStage = 1;
          V.Health = FMath.Max(0, V.Health - 9 * this.PowerMul() * V.GutsMul());
          this.DamageDealt += 9; this.HitsLanded++; this.Combo++; this.BestCombo = FMath.Max(this.BestCombo, this.Combo); this.ComboClock = 1.7;
          this.AddHype(10);
          V.AddHype(4);
          V.HitFlash(1);
          V.Freeze(0.09);
          this.Freeze(0.09);
          if (this.Game) { this.Game.OnStrike(this, V, 9, ECpvReaction.Light, ECpvWord.Bonk, 'Bonk', V.GetHeadLocation(), false); }
          if (V.Health <= 0 && !V.bKoHandled) { V.bKoHandled = true; if (this.Game) { this.Game.OnKnockout(V, this); } }
        }
        if (this.ThrowStage === 1 && this.StateTime >= 0.46) {
          this.ThrowStage = 2;
          V.ReleaseFromThrow(ECpvState.Stagger, Fwd.Mul(260));
        }
        break;
      case ECpvThrow.Slam:
        if (this.ThrowStage === 0 && this.StateTime >= 0.8) {
          this.ThrowStage = 1;
          const Dmg = 20 * this.PowerMul() * V.GutsMul();
          V.Health = FMath.Max(0, V.Health - Dmg);
          this.DamageDealt += Dmg; this.HitsLanded++; this.Combo++; this.BestCombo = FMath.Max(this.BestCombo, this.Combo); this.ComboClock = 1.7;
          this.AddHype(22);
          V.AddHype(8);
          V.HitFlash(1);
          V.Freeze(0.14);
          this.Freeze(0.14);
          const At = V.GetActorLocation().Add(new FVector(Fwd.X * -50, Fwd.Y * -50, 20));
          if (this.Game) {
            this.Game.OnStrike(this, V, Dmg, ECpvReaction.Knockdown, ECpvWord.Splat, 'Slam', At, false);
            this.Game.OnSlam(At, 1.1, false);
          }
          if (V.Health <= 0 && !V.bKoHandled) { V.bKoHandled = true; if (this.Game) { this.Game.OnKnockout(V, this); } }
        }
        if (this.ThrowStage === 1 && this.StateTime >= 1.06) {
          this.ThrowStage = 2;
          // The victim's clip ends lying 12 cm toward the thrower; make that their real position.
          const Spot = V.Pos2D().Add(V.Facing2D().Mul(12));
          V.SetActorLocation(new FVector(Spot.X, Spot.Y, 0));
          V.Partner = null;
          this.Partner = null;
          V.Vel = FVector2D.ZeroVector;
          V.EnterState(ECpvState.Down);
          V.Play('DownBack', 0);
          V.bFaceDown = false;
          V.bBounced = true;
          V.DownLeft = 0.9 + 0.9 * (1 - V.Health / CpvRule.MaxHealth);
          V.ForceStep();
        }
        break;
      case ECpvThrow.Whip:
        if (this.ThrowStage === 0 && this.StateTime >= 0.3) {
          this.ThrowStage = 1;
          V.BeginWhipped(this.TravelDir);
          this.AddHype(5);
          if (this.Game) { this.Game.PlaySound('Whoosh', 0.8, 0.8); }
        }
        break;
      case ECpvThrow.Shove:
        if (this.ThrowStage === 0 && this.StateTime >= 0.1) {
          this.ThrowStage = 1;
          V.ReleaseFromThrow(ECpvState.HitStun, Fwd.Mul(330));
        }
        break;
      default: break;
    }
    const End = this.Throw === ECpvThrow.Slam ? 1.25 : (this.Throw === ECpvThrow.Shove ? 0.4 : 0.6);
    if (this.StateTime >= End) { this.EnterState(ECpvState.Idle); }
  }

  private TickSpecial(Dt: number): void {
    const Game = this.Game!, Foe = this.Foe!;   // Step has already checked both
    const Fx = Game.GetFx();
    const Fwd = this.Facing2D();
    const Hand = this.GetBoneLocation(this.bMirror ? ECpvBone.HandL : ECpvBone.HandR);
    const Mouth = this.GetHeadLocation().Add(new FVector(Fwd.X * 18, Fwd.Y * 18, -8));
    const To = Foe.Pos2D().Sub(this.Pos2D());
    const Dist = To.Size();
    const Dot = Dist > 1 ? FVector2D.DotProduct(To.Div(Dist), Fwd) : 1;
    let End = 1;
    switch (this.Def().Special) {
      case ECpvSpecial.Bomb:
      case ECpvSpecial.Orb:
        End = 0.92;
        if (this.SpecialStage === 0 && this.StateTime >= 0.38) {
          this.SpecialStage = 1;
          Game.SpawnProjectile(this, this.Def().Special === ECpvSpecial.Bomb ? 0 : 1, Hand, Foe.GetActorLocation());
        }
        break;
      case ECpvSpecial.Scream:
      case ECpvSpecial.Flame:
      {
        End = 1.3;
        const bFlame = this.Def().Special === ECpvSpecial.Flame;
        if (this.StateTime >= 0.4 && this.StateTime <= 1.02) {
          this.SpecialClock -= Dt;
          const Dir3 = new FVector(Fwd.X, Fwd.Y, -0.05);
          if (bFlame) { Fx.Flames(Mouth, Dir3, 2, 520); }
          else if (FMath.FRand() < 0.6) { Fx.Notes(Mouth, Dir3, 1, new FLinearColor(1, 0.3, 0.7)); }
          if (this.SpecialClock <= 0) {
            this.SpecialClock = 0.15;
            ++this.SpecialStage;
            Game.PlaySound(bFlame ? 'Flame' : 'Scream', 0.9, 1 + this.SpecialStage * 0.03);
            const Range = bFlame ? 330 : 430;
            if (Foe.IsHittable() && Dist < Range && Dot > 0.78) {
              const bLast = this.SpecialStage >= 4;
              Foe.TakeBlow(this, bFlame ? 6 : 5, bLast ? ECpvReaction.Knockdown : ECpvReaction.Light, Fwd.Mul(bFlame ? 240 : 380), 0,
                bLast ? (bFlame ? ECpvWord.Boom : ECpvWord.Wham) : ECpvWord.None, bFlame ? 'Sizzle' : 'Punch', 0.03);
            }
          }
        }
        break;
      }
      case ECpvSpecial.Zap:
        End = 1.15;
        if (this.SpecialStage === 0 && this.StateTime >= 0.35) {
          this.SpecialStage = 1;
          Game.PlaySound('Zap');
          const bHit = Foe.IsHittable() && Dist < 680 && Dot > 0.8;
          const Target = bHit ? Foe.GetActorLocation().Add(new FVector(0, 0, 110)) : Hand.Add(new FVector(Fwd.X, Fwd.Y, 0).Mul(600));
          Fx.Bolt(Hand, Target);
          if (bHit) { Foe.TakeBlow(this, 18, ECpvReaction.Heavy, Fwd.Mul(160), 0, ECpvWord.Zap, 'Zap', 0.22); }
        }
        break;
      case ECpvSpecial.Chord:
        End = 1.25;
        for (let k = 0; k < 3; ++k) {
          if (this.SpecialStage === k && this.StateTime >= 0.32 + 0.26 * k) {
            ++this.SpecialStage;
            Game.PlaySound('Chord', 1, 1 + 0.12 * k);
            const Top = Foe.GetActorLocation().Add(new FVector(FMath.FRandRange(-60, 60), FMath.FRandRange(-60, 60), 620));
            Fx.Bolt(Top, Foe.GetActorLocation().Add(new FVector(0, 0, 120)));
            Game.GetArena().Flash(0.5);
            if (Foe.IsHittable() && Dist < 760) {
              Foe.TakeBlow(this, 7, k === 2 ? ECpvReaction.Knockdown : ECpvReaction.Light, Fwd.Mul(140), 0, k === 2 ? ECpvWord.Zap : ECpvWord.None, 'Zap', 0.1);
            }
          }
        }
        break;
      case ECpvSpecial.Shockwave:
        End = 1.2;
        if (this.SpecialStage === 0 && this.StateTime >= 0.66) {
          this.SpecialStage = 1;
          Game.PlaySound('BassDrop');
          Game.OnSlam(this.GetActorLocation(), 1.6);
          Fx.Ring(this.GetActorLocation().Add(new FVector(0, 0, 3)), 7, new FLinearColor(0.3, 1, 0.45));
          Fx.Ring(this.GetActorLocation().Add(new FVector(0, 0, 3)), 4.2, new FLinearColor(0.5, 0.2, 1));
          for (let S = 0; S < 4; ++S) { Game.GetArena().BumpRopes(S, 0, 260); }
          if (Foe.IsHittable() && Dist < 340 && Foe.Height < 60) {
            Foe.TakeBlow(this, 20, ECpvReaction.Launch, (Dist > 1 ? To.Div(Dist) : Fwd).Mul(300), 720, ECpvWord.Boom, 'Heavy', 0.14);
          }
        }
        break;
      case ECpvSpecial.Scepter:
        End = 1.0;
        if (this.SpecialStage === 0 && this.StateTime >= 0.39) {
          this.SpecialStage = 1;
          Fx.Stars(Hand, 10);
          if (Foe.IsHittable() && Dist < 205 && Dot > 0.2) {
            Foe.TakeBlow(this, 24, ECpvReaction.Launch, Fwd.Mul(720), 540, ECpvWord.Wham, 'Heavy', 0.16);
          } else { Game.PlaySound('Whoosh', 1, 0.7); }
        }
        break;
    }
    if (this.StateTime >= End) { this.EnterState(ECpvState.Idle); }
  }

  private TickAir(Dt: number): void {
    this.VertVel -= CpvRule.Gravity * Dt;
    this.Height += this.VertVel * Dt;
    const Clamped = ClampToRing(this.Pos2D().Add(this.Vel.Mul(Dt)), this.RingLimit());
    const P = Clamped.P;
    if (Clamped.Side >= 0 && this.Vel.Size() > 150) {
      this.HitRopes(this.Vel.Size() * 0.7);
      this.Vel = this.Vel.Mul(-0.35);
    }
    this.SetActorLocation(new FVector(P.X, P.Y, 0));
    if (this.Height <= 0 && this.VertVel < 0) {
      this.Height = 0;
      if (this.Game) { this.Game.OnSlam(this.GetActorLocation(), FMath.Clamp(-this.VertVel / 900, 0.4, 1.3)); }
      if (!this.bBounced && this.VertVel < -620) {
        this.bBounced = true;
        this.VertVel = -this.VertVel * 0.32;
        this.Vel = this.Vel.Mul(0.6);
        this.Height = 1;
      } else {
        this.Vel = this.Vel.Mul(0.4);
        this.EnterState(ECpvState.Down);
        this.Play('Land', 0.04);
        this.bFaceDown = false;
        this.bBounced = true;
        this.DownLeft = 0.3 + 1 + 0.9 * (1 - this.Health / CpvRule.MaxHealth);
        this.ForceStep();
      }
    }
  }

  Step(Dt: number, In: FCpvInput): void {
    if (this.ShownHealth < this.Health) { this.ShownHealth = this.Health; }
    this.ShownHealth = FMath.FInterpConstantTo(this.ShownHealth, this.Health, Dt, 24);
    if (this.ComboClock > 0) {
      this.ComboClock -= Dt;
      if (this.ComboClock <= 0) { this.Combo = 0; }
    }
    const Foe = this.Foe, Game = this.Game;
    if (!Foe || !Game) { return; }
    // A tap on an impact frame still belongs to the player. Hold its buffer through hit stop.
    const bHitStop = this.IsFrozen();
    this.Buffer(In, bHitStop ? 0 : Dt);
    this.GuardWindow = FMath.Max(0, this.GuardWindow - Dt);
    if (In.bBlock && !this.bGuardHeld) { this.GuardWindow = 0.13; }
    this.bGuardHeld = In.bBlock;
    if (bHitStop) { return; }
    this.StateTime += Dt;
    this.InvulnLeft = FMath.Max(0, this.InvulnLeft - Dt);
    this.RunBonus = FMath.Max(0, this.RunBonus - Dt);
    this.JuggleClock = FMath.Max(0, this.JuggleClock - Dt);

    const Me = this.Pos2D();
    const FoePos = Foe.Pos2D();
    const ToFoe = FoePos.Sub(Me);
    const Dist = ToFoe.Size();
    let Stick = In.Move;
    if (Stick.SizeSquared() > 1) { Stick = Stick.GetSafeNormal(); }
    const bMoving = Stick.SizeSquared() > 0.04;
    let bGroundSlide = true;

    switch (this.State) {
      case ECpvState.Idle:
      {
        this.FaceToward(FoePos, Dt, 900);
        if (In.bRun && bMoving) { this.EnterState(ECpvState.Run); break; }
        if (this.Consume('BufDodge')) { this.StartDodge(bMoving ? Stick : this.Facing2D().Neg()); break; }
        if (this.Consume('BufSpecial') && this.StartSpecial()) { break; }
        if (this.Consume('BufGrab')) { this.StartGrab(); break; }
        if (this.Consume('BufLight')) { this.StartLight(); break; }
        if (this.Consume('BufHeavy')) { this.StartHeavy(In); break; }
        if (this.Consume('BufTaunt')) {
          this.EnterState(ECpvState.Taunt);
          this.Play(this.Def().Taunt, 0.1);
          break;
        }
        if (In.bBlock) {
          this.EnterState(ECpvState.Block);
          this.Play('Block', 0.06);
          break;
        }
        if (bMoving) { this.MoveBy(Stick.Mul(CpvRule.WalkSpeed * this.SpeedMul() * Dt)); }
        this.Play(bMoving ? 'Walk' : 'Idle', 0.12, bMoving ? this.SpeedMul() * 1.1 : 1, false);
        break;
      }
      case ECpvState.Run:
      {
        if (!In.bRun || !bMoving) { this.EnterState(ECpvState.Idle); break; }
        this.FaceToward(Me.Add(Stick.Mul(100)), Dt, 720);
        const Clamped = ClampToRing(Me.Add(this.Facing2D().Mul(CpvRule.RunSpeed * this.SpeedMul() * Dt)), this.RingLimit());
        const P = Clamped.P;
        const Side = Clamped.Side;
        this.SetActorLocation(new FVector(P.X, P.Y, 0));
        if (Side >= 0) {
          // Hit the ropes at a run: bounce back out with interest.
          this.HitRopes(420);
          const N = Side === 0 ? new FVector2D(-1, 0) : (Side === 1 ? new FVector2D(1, 0) : (Side === 2 ? new FVector2D(0, -1) : new FVector2D(0, 1)));
          this.TravelDir = this.Facing2D().Sub(N.Mul(2 * FVector2D.DotProduct(this.Facing2D(), N))).GetSafeNormal();
          this.TravelDir = this.TravelDir.Add(N.Mul(0.6)).GetSafeNormal();
          this.SetActorRotation(new FRotator(0, YawOf(this.TravelDir), 0));
          this.EnterState(ECpvState.Rebound);
          this.Throw = ECpvThrow.None; // marks a voluntary rebound (not a whip victim)
          this.RunBonus = 1.1;
          this.Play('RopeBounce', 0.04);
          this.AddHype(3);
          break;
        }
        if (this.Consume('BufLight')) { this.RunBonus = FMath.Max(this.RunBonus, 0.01); this.StartMove(CpvData.Clothesline); break; }
        if (this.Consume('BufHeavy')) { this.StartMove(CpvData.Dropkick); break; }
        if (this.Consume('BufGrab')) { this.StartGrab(); break; }
        if (this.Consume('BufDodge')) { this.StartDodge(this.Facing2D()); break; }
        this.Play('Run', 0.1, this.SpeedMul(), false);
        break;
      }
      case ECpvState.Rebound:
      {
        const bVictim = this.Throw === ECpvThrow.Whip;
        if (this.StateTime >= 0.18) {
          this.MoveBy(this.TravelDir.Mul((bVictim ? 560 : CpvRule.RunSpeed * 1.2) * Dt));
          if (this.IsClipDone() || this.GetClip() === 'RopeBounce') { this.Play(bVictim ? 'WhipRun' : 'Run', 0.06, 1.1, false); }
          if (!bVictim) {
            if (this.Consume('BufLight')) { this.StartMove(CpvData.Clothesline); break; }
            if (this.Consume('BufHeavy')) { this.StartMove(CpvData.Dropkick); break; }
            if (this.Consume('BufGrab')) { this.StartGrab(); break; }
          }
        }
        if (this.StateTime >= (bVictim ? 0.95 : 0.7) || (this.StateTime > 0.3 && Dist < 70)) {
          this.Throw = ECpvThrow.None;
          this.EnterState(ECpvState.Idle);
        }
        break;
      }
      case ECpvState.Whipped:
      {
        const Clamped = ClampToRing(Me.Add(this.TravelDir.Mul(620 * Dt)), this.RingLimit());
        const P = Clamped.P;
        const Side = Clamped.Side;
        this.SetActorLocation(new FVector(P.X, P.Y, 0));
        if (Side >= 0) {
          this.HitRopes(480);
          this.TravelDir = this.TravelDir.Neg();
          this.SetActorRotation(new FRotator(0, YawOf(this.TravelDir), 0));
          this.EnterState(ECpvState.Rebound);
          this.Throw = ECpvThrow.Whip;
          this.Play('RopeBounce', 0.04);
          Game.OnRopeBounce(this);
        } else if (this.StateTime > 1.6) { this.EnterState(ECpvState.Idle); }
        break;
      }
      case ECpvState.Dodge:
      {
        const Total = 0.34;
        const U = FMath.Clamp(this.StateTime / Total, 0, 1);
        this.MoveBy(this.TravelDir.Mul((180 / Total) * 2 * (1 - U) * Dt));
        if (this.StateTime >= Total) { this.EnterState(ECpvState.Idle); }
        break;
      }
      case ECpvState.Block:
        this.FaceToward(FoePos, Dt, 600);
        if (!In.bBlock) { this.EnterState(ECpvState.Idle); }
        else if (this.Consume('BufDodge')) { this.StartDodge(bMoving ? Stick : this.Facing2D().Neg()); }
        break;
      case ECpvState.BlockStun:
        this.StunLeft -= Dt;
        if (this.StunLeft <= 0) {
          if (In.bBlock) { this.EnterState(ECpvState.Block); this.Play('Block', 0.05); }
          else { this.EnterState(ECpvState.Idle); }
        }
        break;
      case ECpvState.HitStun:
      case ECpvState.Stagger:
        this.StunLeft -= Dt;
        if (this.StunLeft <= 0) {
          if (this.Health <= 0) {
            this.EnterState(ECpvState.Dazed);
            this.Play('Dazed', 0.15);
          } else { this.EnterState(ECpvState.Idle); }
        }
        break;
      case ECpvState.Attack:
      {
        const M = this.Move;
        if (!M) { this.EnterState(ECpvState.Idle); break; }
        if (this.StateTime < M.HitTime) {
          if (this.StateTime < M.HitTime * 0.6 && M !== CpvData.Clothesline && M !== CpvData.Dropkick) { this.FaceToward(FoePos, Dt, 420); }
          if (M.Lunge > 0 && (Dist > 74 || M.Lunge > 100)) { this.MoveBy(this.Facing2D().Mul((M.Lunge / M.HitTime) * Dt)); }
        } else if (!this.bStrikeDone) {
          this.bStrikeDone = true;
          this.DoStrike(M);
          if (this.State !== ECpvState.Attack) { break; }
        }
        if (M.Chain > 0 && this.StateTime >= M.Chain && this.ComboStep > 0 && this.ComboStep < 3 && this.BufLight > 0 && this.BlockedPenalty <= 0) {
          this.BufLight = 0;
          ++this.ComboStep;
          this.StartMove(this.ComboStep === 2 ? CpvData.Cross : CpvData.Uppercut);
          break;
        }
        if (this.StateTime >= M.Duration + this.BlockedPenalty) { this.EnterState(ECpvState.Idle); }
        break;
      }
      case ECpvState.GrabTry:
      {
        if (this.StateTime < 0.12 && Dist > 70) { this.MoveBy(this.Facing2D().Mul(330 * Dt)); }
        if (!this.bStrikeDone && this.StateTime >= 0.1 && this.StateTime <= 0.25 && Dist <= CpvRule.GrabRange
          && FVector2D.DotProduct(ToFoe.GetSafeNormal(), this.Facing2D()) > 0.45 && Foe.CanBeGrabbed()) {
          this.bStrikeDone = true;
          const bCatch = Foe.State === ECpvState.Rebound || Foe.State === ECpvState.Whipped;
          this.StartClinch(Foe);
          if (bCatch) { this.StartThrow(ECpvThrow.Slam, this.Facing2D()); } // caught on the rebound: straight into the slam
          break;
        }
        if (this.StateTime >= 0.42) { this.EnterState(ECpvState.Idle); }
        break;
      }
      case ECpvState.Clinch:
        if (!this.Partner) { this.EnterState(ECpvState.Idle); break; }
        if (this.StateTime > 0.14) {
          if (this.Consume('BufLight')) { this.StartThrow(ECpvThrow.Headbutt, this.Facing2D()); break; }
          if (this.Consume('BufHeavy')) { this.StartThrow(ECpvThrow.Slam, this.Facing2D()); break; }
          if (this.Consume('BufGrab')) { this.StartThrow(ECpvThrow.Whip, bMoving ? Stick : this.Facing2D()); break; }
        }
        if (this.StateTime > 1.4) { this.StartThrow(ECpvThrow.Shove, this.Facing2D()); }
        break;
      case ECpvState.Held:
        if (!this.Partner) { this.EnterState(ECpvState.Idle); break; }
        if (In.AnyPress()) { ++this.Escape; }
        if (this.Escape >= 6 && this.Partner.State === ECpvState.Clinch) {
          // Wriggled free: shove the grabber off.
          const Other = this.Partner;
          Other.ApplyReaction(ECpvReaction.Heavy, this.Facing2D().Mul(260), 0);
          this.EnterState(ECpvState.Idle);
          this.Play('ShoveA', 0.05);
          this.AddHype(6);
        }
        break;
      case ECpvState.Throwing:
        this.TickThrow(Dt);
        break;
      case ECpvState.Thrown:
        if (!this.Partner && this.StateTime > 0.2) { this.EnterState(ECpvState.Idle); }
        break;
      case ECpvState.Airborne:
        this.TickAir(Dt);
        bGroundSlide = false;
        break;
      case ECpvState.Down:
        if (!this.bBounced && this.GetClip() === 'KnockDown' && this.StateTime >= 0.36) {
          this.bBounced = true;
          Game.OnSlam(this.GetActorLocation(), 0.7);
        }
        if (this.IsClipDone() && (this.GetClip() === 'KnockDown' || this.GetClip() === 'Land')) { this.Play(this.bFaceDown ? 'DownFront' : 'DownBack', 0.05); }
        if (this.Health <= 0 && !this.bDazeOnKo) {
          if (this.StateTime > 0.5) { this.Kill(true); }
          break;
        }
        this.DownLeft -= Dt + (In.AnyPress() ? 0.12 : 0);   // every button press shaves a little off the time on the mat
        if (this.DownLeft <= 0) {
          this.EnterState(ECpvState.GetUp);
          this.InvulnLeft = 0.6;
          this.Play(this.bFaceDown ? 'GetUpFront' : 'GetUp', 0.08);
        }
        break;
      case ECpvState.GetUp:
        if (this.StateTime >= 0.8) {
          if (this.Health <= 0) {
            this.EnterState(ECpvState.Dazed);
            this.Play('Dazed', 0.15);
          } else { this.EnterState(ECpvState.Idle); }
        }
        break;
      case ECpvState.Dazed:
        Game.GetFx().Halo(this.Slot, this.GetHeadLocation().Add(new FVector(0, 0, 22)));
        if (this.StateTime >= CpvRule.DazedTime) {
          this.Kill(false);
          Game.OnSlam(this.GetActorLocation(), 0.6);
        }
        break;
      case ECpvState.Taunt:
        if (!this.bStrikeDone && this.StateTime >= this.GetClipLength() * 0.7) {
          this.bStrikeDone = true;
          ++this.Taunts;
          this.AddHype(18);
          Game.OnTaunt(this);
        }
        if (this.StateTime >= this.GetClipLength()) { this.EnterState(ECpvState.Idle); }
        break;
      case ECpvState.Pickup:
        if (!this.bStrikeDone && this.StateTime >= 0.16) {
          this.bStrikeDone = true;
          Game.TryPickup(this);
        }
        if (this.StateTime >= 0.5) { this.EnterState(ECpvState.Idle); }
        break;
      case ECpvState.Special:
        this.TickSpecial(Dt);
        break;
      case ECpvState.Scripted:
      case ECpvState.Dead:
      case ECpvState.Win:
        bGroundSlide = false;
        break;
    }

    // Knockback slides to a stop; hard shoves into the ropes make them twang.
    if (bGroundSlide && !this.Vel.IsNearlyZero(1)) {
      const Clamped = ClampToRing(this.Pos2D().Add(this.Vel.Mul(Dt)), this.RingLimit());
      const P = Clamped.P;
      if (Clamped.Side >= 0 && this.Vel.Size() > 240) {
        this.HitRopes(this.Vel.Size() * 0.8);
        this.Vel = this.Vel.Mul(-0.3);
      }
      this.SetActorLocation(new FVector(P.X, P.Y, 0));
      this.Vel = this.Vel.Mul(FMath.Max(0, 1 - 5.5 * Dt));
      if (this.Vel.Size() < 14) { this.Vel = FVector2D.ZeroVector; }
    }
    if (this.State !== ECpvState.Scripted && this.State !== ECpvState.Dead) {
      this.VisualOffset = this.VisualOffset.WithZ(this.Height); // scripted scenes own the visual offset (buried, launched, flattened...)
      this.UpdateMirror();
    }
    if (this.WeaponComp.IsVisible() && this.bWeaponOnLeft !== this.bMirror) { this.UpdateWeaponAttachment(); }
  }
}
