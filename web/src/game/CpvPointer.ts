// Port of the game-mode half of CpvPointer.cpp: mouse and touch on the menus. (The click targets
// themselves are laid out by the HUD, CpvHud.ts.)
//
// The desktop game catches the mouse with a Slate widget laid over the viewport, shown only while a menu
// is up. Here the engine layer reports the pointer once a frame (engine/input.ts) and the same queue,
// QueuePointer, takes it from there.

import { Pointer } from '../engine/input';
import { LogVerbose } from '../engine/platform';
import { FVector2D } from '../engine/ue';
import { ACpvGameMode, ECpvMode, ECpvOptionsPage, ECpvPhase, implement } from './CpvGame';
import { ECpvClick } from './CpvHud';

/** The point waiting in the queue came from a finger: there is no hover to draw for it. */
let bQueuedTouch = false;

/** The desktop game hides the mouse cursor while a bout is on and shows it over the menus. */
function ShowCursor(bShow: boolean): void {
  document.body.style.cursor = bShow ? '' : 'none';
}

implement(ACpvGameMode, {
  QueuePointer(Normalized, bClick) {
    // Preserve the click if a mouse move arrives during the same engine frame.
    if (!this.bPointerClick || bClick) { this.PointerPoint = Normalized; }
    this.bHavePointer = true;
    this.bPointerClick = this.bPointerClick || bClick;
  },

  ClosePointer() {
    this.Hud?.ClearHover();
    this.bHavePointer = this.bPointerClick = false;
    ShowCursor(true);
  },

  ClickViewport(At) {
    if (!this.bPointerVisible) { return; }
    // This is a simulated click inside the picture: it joins the queue exactly as a real one does.
    bQueuedTouch = false;
    this.QueuePointer(At, true);
  },

  ReadPointer(Menu) {
    const Hud = this.Hud;
    if (!Hud) { return; }
    for (const In of Menu) {
      if (In.bUp || In.bDown || In.bLeft || In.bRight || In.bOk || In.bBack || In.bPause) { Hud.ClearHover(); }
    }
    const bShow = this.IsDemo() || this.Phase === ECpvPhase.Select || this.Phase === ECpvPhase.Results || this.bPaused || (this.IsRehearsing() && this.Lesson === 4);
    if (this.bPointerVisible !== bShow) {
      // Anything that happened before the menu came up (or after it went away) is not meant for it.
      this.bPointerVisible = bShow;
      Hud.ClearHover();
      this.bHavePointer = this.bPointerClick = false;
      ShowCursor(bShow);
    }
    else if (bShow && Pointer.bInside && (Pointer.bMoved || Pointer.bClicked)) {
      bQueuedTouch = Pointer.bTouch;
      this.QueuePointer(new FVector2D(Pointer.X, Pointer.Y), Pointer.bClicked);
    }
    if (!bShow || !this.bHavePointer) { return; }
    const Pixel = new FVector2D(this.PointerPoint.X * Hud.SizeX, this.PointerPoint.Y * Hud.SizeY);
    const bClick = this.bPointerClick;
    this.bHavePointer = this.bPointerClick = false;
    if (bQueuedTouch) { Hud.ClearHover(); }
    else { Hud.SetHover(Pixel); }
    // Hover is visual. Restoring the OS cursor on a new screen must not choose a keyboard row.
    if (!bClick) { return; }
    const Area = Hud.HitAt(Pixel);
    if (!Area) { return; }
    LogVerbose(() => `CPV_POINTER action=${Area.Action} row=${Area.Index}`);
    const First = Menu[0];
    switch (Area.Action) {
      case ECpvClick.Main: this.MenuIndex = Area.Index; break;
      case ECpvClick.Pause: this.PauseIndex = Area.Index; break;
      case ECpvClick.Result: this.ResultIndex = Area.Index; break;
      case ECpvClick.Option:
        this.OptionIndex = Area.Index;
        First.bOk = First.bOk || (this.OptionsPage === ECpvOptionsPage.General && (this.OptionIndex === 4 || this.OptionIndex === 5));
        return;
      case ECpvClick.Less: case ECpvClick.More:
        this.OptionIndex = Area.Index;
        First.bLeft = First.bLeft || Area.Action === ECpvClick.Less;
        First.bRight = First.bRight || Area.Action === ECpvClick.More;
        return;
      case ECpvClick.Roster: {
        const Device = this.Mode === ECpvMode.TwoPlayer && this.bLocked[0] ? 1 : 0;
        Menu[Device].Pick = Area.Index;
        Menu[Device].bOk = true;
        return;
      }
      case ECpvClick.Back: First.bBack = true; return;
      case ECpvClick.Accept: break;
    }
    First.bOk = true;
  },
});
