// Keyboard, gamepads, pointer and the on-screen touch pad, behind the calls the game makes on Unreal's
// player controller: is a key down, was it pressed this frame, and what does an analogue axis read.
//
// Keys are named as in Unreal (EKeys.SpaceBar, EKeys.Gamepad_FaceButton_Bottom). Keyboard keys follow
// physical position (KeyboardEvent.code), so the layout in the manual holds on any keyboard.

export type FKey = string;

export const EKeys = {
  A: 'KeyA', B: 'KeyB', C: 'KeyC', D: 'KeyD', E: 'KeyE', F: 'KeyF', G: 'KeyG', H: 'KeyH', I: 'KeyI', J: 'KeyJ', K: 'KeyK', L: 'KeyL', M: 'KeyM',
  N: 'KeyN', O: 'KeyO', P: 'KeyP', Q: 'KeyQ', R: 'KeyR', S: 'KeyS', T: 'KeyT', U: 'KeyU', V: 'KeyV', W: 'KeyW', X: 'KeyX', Y: 'KeyY', Z: 'KeyZ',
  Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown',
  Enter: 'Enter', SpaceBar: 'Space', BackSpace: 'Backspace', Escape: 'Escape', Tab: 'Tab',
  LeftShift: 'ShiftLeft', RightShift: 'ShiftRight', LeftControl: 'ControlLeft', RightControl: 'ControlRight',
  Comma: 'Comma', Period: 'Period', Slash: 'Slash', Semicolon: 'Semicolon', Apostrophe: 'Quote',
  NumPadZero: 'Numpad0', NumPadOne: 'Numpad1', NumPadTwo: 'Numpad2', NumPadThree: 'Numpad3', NumPadFour: 'Numpad4', NumPadFive: 'Numpad5', NumPadSix: 'Numpad6',
  F11: 'F11',
  Gamepad_LeftX: 'Gamepad_LeftX', Gamepad_LeftY: 'Gamepad_LeftY', Gamepad_RightTriggerAxis: 'Gamepad_RightTriggerAxis',
  Gamepad_DPad_Up: 'Gamepad_DPad_Up', Gamepad_DPad_Down: 'Gamepad_DPad_Down', Gamepad_DPad_Left: 'Gamepad_DPad_Left', Gamepad_DPad_Right: 'Gamepad_DPad_Right',
  Gamepad_LeftStick_Up: 'Gamepad_LeftStick_Up', Gamepad_LeftStick_Down: 'Gamepad_LeftStick_Down',
  Gamepad_LeftStick_Left: 'Gamepad_LeftStick_Left', Gamepad_LeftStick_Right: 'Gamepad_LeftStick_Right',
  Gamepad_FaceButton_Bottom: 'Gamepad_FaceButton_Bottom', Gamepad_FaceButton_Right: 'Gamepad_FaceButton_Right',
  Gamepad_FaceButton_Left: 'Gamepad_FaceButton_Left', Gamepad_FaceButton_Top: 'Gamepad_FaceButton_Top',
  Gamepad_LeftShoulder: 'Gamepad_LeftShoulder', Gamepad_RightShoulder: 'Gamepad_RightShoulder',
  Gamepad_LeftTrigger: 'Gamepad_LeftTrigger', Gamepad_RightTrigger: 'Gamepad_RightTrigger',
  Gamepad_Special_Left: 'Gamepad_Special_Left', Gamepad_Special_Right: 'Gamepad_Special_Right',
  Gamepad_LeftThumbstick: 'Gamepad_LeftThumbstick', Gamepad_RightThumbstick: 'Gamepad_RightThumbstick',
} as const;

// Standard-mapping gamepad buttons, by index.
const PAD_BUTTONS: Array<[number, FKey]> = [
  [0, EKeys.Gamepad_FaceButton_Bottom], [1, EKeys.Gamepad_FaceButton_Right], [2, EKeys.Gamepad_FaceButton_Left], [3, EKeys.Gamepad_FaceButton_Top],
  [4, EKeys.Gamepad_LeftShoulder], [5, EKeys.Gamepad_RightShoulder], [6, EKeys.Gamepad_LeftTrigger], [7, EKeys.Gamepad_RightTrigger],
  [8, EKeys.Gamepad_Special_Left], [9, EKeys.Gamepad_Special_Right], [10, EKeys.Gamepad_LeftThumbstick], [11, EKeys.Gamepad_RightThumbstick],
  [12, EKeys.Gamepad_DPad_Up], [13, EKeys.Gamepad_DPad_Down], [14, EKeys.Gamepad_DPad_Left], [15, EKeys.Gamepad_DPad_Right],
];

// Keys the page must not act on while the game has them (scrolling, quick find, tab focus).
const SWALLOW = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Slash', 'Quote', 'Backspace', 'Tab', 'Enter']);

class FKeyState {
  Down = new Set<FKey>();
  Pressed = new Set<FKey>();      // went down during the frame being processed
  Incoming = new Set<FKey>();     // went down since the last frame began
  Analog = new Map<FKey, number>();
}

/** Player 0 owns the keyboard, the first gamepad and the touch pad; player 1 owns the second gamepad. */
const Players = [new FKeyState(), new FKeyState()];
/** Buttons and stick held on the touch pad (merged into player 0's gamepad). */
const Touch = { Buttons: new Set<FKey>(), X: 0, Y: 0 };
const PadWasDown: Array<Set<FKey>> = [new Set(), new Set()];

export class APlayerController {
  constructor(readonly Index: number) {}
  IsInputKeyDown(Key: FKey): boolean { return Players[this.Index].Down.has(Key); }
  WasInputKeyJustPressed(Key: FKey): boolean { return Players[this.Index].Pressed.has(Key); }
  GetInputAnalogKeyState(Key: FKey): number { return Players[this.Index].Analog.get(Key) ?? 0; }
}

const Controllers = [new APlayerController(0), new APlayerController(1)];

export const Pointer = {
  /** Position over the game picture, 0..1 from the top left. */
  X: 0,
  Y: 0,
  bInside: false,
  /** Moved since the last frame. */
  bMoved: false,
  /** Pressed (mouse button or tap) since the last frame. */
  bClicked: false,
  /** The last interaction was a touch, so there is no hover to show. */
  bTouch: false,
  PendingMove: false,
  PendingClick: false,
};

function SetKey(Player: number, Key: FKey, bDown: boolean): void {
  const State = Players[Player];
  if (bDown) {
    if (!State.Down.has(Key)) { State.Incoming.add(Key); }
    State.Down.add(Key);
  } else {
    State.Down.delete(Key);
  }
}

let OnFirstGesture: (() => void) | null = null;
let LastDevice: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';

export const Input = {
  GetPlayerController(Index: number): APlayerController | null { return Controllers[Index] ?? null; }, 
  /** What the player last used; the HUD shows matching button names. */
  LastDevice(): 'keyboard' | 'gamepad' | 'touch' { return LastDevice; },
  /** Called once on the first key, click or tap (browsers only allow sound after one). */
  OnFirstGesture(Fn: () => void): void { OnFirstGesture = Fn; },

  Attach(Target: HTMLElement): void {
    const Gesture = () => {
      const Fn = OnFirstGesture;
      OnFirstGesture = null;
      Fn?.();
    };
    window.addEventListener('keydown', (E) => {
      if (E.metaKey || E.ctrlKey || E.altKey) { return; }
      if (SWALLOW.has(E.code)) { E.preventDefault(); }
      if (!E.repeat) { SetKey(0, E.code, true); }
      LastDevice = 'keyboard';
      Gesture();
    });
    window.addEventListener('keyup', (E) => SetKey(0, E.code, false));
    window.addEventListener('blur', () => {
      for (const State of Players) { State.Down.clear(); }
      Touch.Buttons.clear();
      Touch.X = Touch.Y = 0;
    });
    const Track = (E: PointerEvent) => {
      const Box = Target.getBoundingClientRect();
      Pointer.X = (E.clientX - Box.left) / Math.max(1, Box.width);
      Pointer.Y = (E.clientY - Box.top) / Math.max(1, Box.height);
      Pointer.bInside = Pointer.X >= 0 && Pointer.X <= 1 && Pointer.Y >= 0 && Pointer.Y <= 1;
      Pointer.bTouch = E.pointerType === 'touch';
    };
    Target.addEventListener('pointermove', (E) => {
      Track(E);
      Pointer.PendingMove = true;
    });
    Target.addEventListener('pointerdown', (E) => {
      Track(E);
      if (E.button === 0) { Pointer.PendingClick = true; }
      Gesture();
    });
    Target.addEventListener('pointerleave', () => { Pointer.bInside = false; });
    Target.addEventListener('contextmenu', (E) => E.preventDefault());
  },

  /** Touch pad: a held button (named as a gamepad key) or the stick (-1..1, Y up). */
  SetTouchButton(Key: FKey, bDown: boolean): void {
    if (bDown) { Touch.Buttons.add(Key); } else { Touch.Buttons.delete(Key); }
    LastDevice = 'touch';
  },
  SetTouchStick(X: number, Y: number): void {
    Touch.X = X;
    Touch.Y = Y;
  },
  /** Scripted key event (tests): as if the key had been pressed or released on the keyboard. */
  InjectKey(Key: FKey, bDown: boolean, Player = 0): void { SetKey(Player, Key, bDown); },

  /** Start of a frame: latch what was pressed since the last one and read the gamepads. */
  BeginFrame(): void {
    const Pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const Connected: Gamepad[] = [];
    for (const Pad of Pads) { if (Pad && Pad.connected && Pad.mapping === 'standard') { Connected.push(Pad); } }
    for (let Player = 0; Player < 2; ++Player) {
      const State = Players[Player];
      const Pad = Connected[Player];
      const Now = new Set<FKey>();
      let X = 0, Y = 0, Trigger = 0;
      if (Pad) {
        for (const [Index, Key] of PAD_BUTTONS) { if (Pad.buttons[Index]?.pressed) { Now.add(Key); } }
        X = Pad.axes[0] ?? 0;
        Y = -(Pad.axes[1] ?? 0); // Unreal reads stick-up as positive
        Trigger = Pad.buttons[7]?.value ?? 0;
      }
      if (Player === 0) {
        for (const Key of Touch.Buttons) { Now.add(Key); }
        if (Math.abs(Touch.X) > Math.abs(X)) { X = Touch.X; }
        if (Math.abs(Touch.Y) > Math.abs(Y)) { Y = Touch.Y; }
      }
      // The stick doubles as four digital directions for menus.
      if (X < -0.5) { Now.add(EKeys.Gamepad_LeftStick_Left); }
      if (X > 0.5) { Now.add(EKeys.Gamepad_LeftStick_Right); }
      if (Y > 0.5) { Now.add(EKeys.Gamepad_LeftStick_Up); }
      if (Y < -0.5) { Now.add(EKeys.Gamepad_LeftStick_Down); }
      const Before = PadWasDown[Player];
      for (const Key of Now) {
        if (!Before.has(Key)) {
          SetKey(Player, Key, true);
          if (Pad && !Touch.Buttons.has(Key)) { LastDevice = 'gamepad'; }
        }
      }
      for (const Key of Before) { if (!Now.has(Key)) { SetKey(Player, Key, false); } }
      PadWasDown[Player] = Now;
      State.Analog.set(EKeys.Gamepad_LeftX, X);
      State.Analog.set(EKeys.Gamepad_LeftY, Y);
      State.Analog.set(EKeys.Gamepad_RightTriggerAxis, Trigger);
      State.Pressed = State.Incoming;
      State.Incoming = new Set();
    }
    Pointer.bMoved = Pointer.PendingMove;
    Pointer.bClicked = Pointer.PendingClick;
    Pointer.PendingMove = false;
    Pointer.PendingClick = false;
  },
};
