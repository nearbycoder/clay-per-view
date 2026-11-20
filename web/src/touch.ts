// On-screen controls for phones and tablets: a floating stick on the left, action buttons on the right.
// They drive player one's gamepad (see engine/input.ts), so the game needs no touch-specific code. Menus
// are tapped directly; the pad only appears while a bout the player controls is on.

import { EKeys, FKey, Input } from './engine/input';

interface FButton {
  Label: string;
  Key: FKey;
  /** Position from the right and bottom edges, in units of the base button size. */
  Right: number;
  Bottom: number;
  Size: number;
  Class?: string;
}

const BUTTONS: FButton[] = [
  { Label: 'JAB', Key: EKeys.Gamepad_FaceButton_Left, Right: 1.55, Bottom: 0.35, Size: 1.25, Class: 'main' },
  { Label: 'HEAVY', Key: EKeys.Gamepad_FaceButton_Top, Right: 0.3, Bottom: 1.25, Size: 1.05 },
  { Label: 'GRAB', Key: EKeys.Gamepad_FaceButton_Right, Right: 0.2, Bottom: 0.1, Size: 1.05 },
  { Label: 'DODGE', Key: EKeys.Gamepad_FaceButton_Bottom, Right: 2.95, Bottom: 0.1, Size: 0.95 },
  { Label: 'BLOCK', Key: EKeys.Gamepad_RightShoulder, Right: 2.55, Bottom: 1.3, Size: 0.95 },
  { Label: 'STAR', Key: EKeys.Gamepad_LeftShoulder, Right: 1.45, Bottom: 2.05, Size: 0.95, Class: 'star' },
  { Label: 'TAUNT', Key: EKeys.Gamepad_Special_Left, Right: 0.3, Bottom: 2.5, Size: 0.75, Class: 'small' },
];

const CSS = `
#touch { position: absolute; inset: 0; z-index: 5; pointer-events: none; display: none; font: 700 13px/1 CpvBold, system-ui, sans-serif; letter-spacing: .06em; --u: clamp(52px, 10.5vmin, 86px); }
#touch.on { display: block; }
#touch .zone { position: absolute; left: 0; bottom: 0; width: 46%; height: 72%; pointer-events: auto; touch-action: none; }
#touch .stick { position: absolute; width: calc(var(--u) * 1.9); height: calc(var(--u) * 1.9); margin: calc(var(--u) * -0.95) 0 0 calc(var(--u) * -0.95); border-radius: 50%; border: 2px solid rgba(255,255,255,.28); background: rgba(13,9,21,.28); left: calc(var(--u) * 1.6); bottom: calc(var(--u) * 0.5); top: auto; }
#touch .stick.live { bottom: auto; }
#touch .knob { position: absolute; left: 50%; top: 50%; width: calc(var(--u) * 0.86); height: calc(var(--u) * 0.86); margin: calc(var(--u) * -0.43) 0 0 calc(var(--u) * -0.43); border-radius: 50%; background: rgba(255,201,40,.82); box-shadow: 0 3px 0 rgba(0,0,0,.35); }
#touch .knob.run { background: rgba(255,122,61,.95); }
#touch button { position: absolute; pointer-events: auto; touch-action: none; border-radius: 50%; border: 2px solid rgba(255,255,255,.42); background: rgba(13,9,21,.42); color: #fff8e7; font: inherit; padding: 0; -webkit-tap-highlight-color: transparent; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
#touch button.main { background: rgba(193,39,45,.62); font-size: 16px; }
#touch button.star { background: rgba(255,201,40,.5); color: #1b1024; text-shadow: none; }
#touch button.small { font-size: 11px; }
#touch button.down { background: rgba(255,255,255,.55); color: #1b1024; text-shadow: none; transform: scale(.94); }
#touch button.pause { right: max(12px, env(safe-area-inset-right)); top: max(70px, 19vh); width: 46px; height: 46px; border-radius: 12px; font-size: 12px; }
#touch .pad { position: absolute; right: max(10px, env(safe-area-inset-right)); bottom: max(10px, env(safe-area-inset-bottom)); width: 0; height: 0; }
#rotate { position: absolute; inset: 0; z-index: 20; display: none; place-content: center; justify-items: center; gap: 14px; padding: 24px; text-align: center; background: rgba(13,9,21,.94); color: #fff8e7; font: 600 18px/1.35 CpvSemi, system-ui, sans-serif; }
#rotate b { font: 400 30px/1 "Titan One", CpvTitle, sans-serif; color: #ffc928; }
@media (orientation: portrait) and (pointer: coarse) { #rotate { display: grid; } }
`;

/**
 * Builds the pad inside Root. WantPad says, each frame, whether the pad should be showing (a bout the
 * player controls); Root's own taps keep working for menus.
 */
export function InitTouch(Root: HTMLElement, WantPad: () => boolean = () => false): void {
  const Style = document.createElement('style');
  Style.textContent = CSS;
  document.head.appendChild(Style);

  const Rotate = document.createElement('div');
  Rotate.id = 'rotate';
  Rotate.innerHTML = '<b>TURN YOUR SCREEN</b><span>Clay-Per-View plays in landscape.</span>';
  Root.appendChild(Rotate);

  const Pad = document.createElement('div');
  Pad.id = 'touch';
  Pad.setAttribute('aria-hidden', 'true');
  Root.appendChild(Pad);

  // --- the stick ---
  const Zone = document.createElement('div');
  Zone.className = 'zone';
  const Stick = document.createElement('div');
  Stick.className = 'stick';
  const Knob = document.createElement('div');
  Knob.className = 'knob';
  Stick.appendChild(Knob);
  Zone.appendChild(Stick);
  Pad.appendChild(Zone);
  let StickPointer = -1;
  let CentreX = 0, CentreY = 0;
  const Reach = () => Stick.offsetWidth * 0.5;
  const MoveStick = (E: PointerEvent) => {
    let Dx = E.clientX - CentreX, Dy = E.clientY - CentreY;
    const Len = Math.hypot(Dx, Dy), Max = Reach();
    if (Len > Max) { Dx *= Max / Len; Dy *= Max / Len; }
    Knob.style.transform = `translate(${Dx}px, ${Dy}px)`;
    const X = Dx / Max, Y = -Dy / Max;
    const Dead = Math.hypot(X, Y) < 0.18;
    Input.SetTouchStick(Dead ? 0 : X, Dead ? 0 : Y);
    // Pushing the stick to the rim is "run".
    const bRun = Len >= Max * 0.93;
    Knob.classList.toggle('run', bRun);
    Input.SetTouchButton(EKeys.Gamepad_RightTrigger, bRun);
  };
  const EndStick = () => {
    StickPointer = -1;
    Stick.classList.remove('live');
    Stick.style.left = Stick.style.top = '';
    Knob.style.transform = '';
    Knob.classList.remove('run');
    Input.SetTouchStick(0, 0);
    Input.SetTouchButton(EKeys.Gamepad_RightTrigger, false);
  };
  Zone.addEventListener('pointerdown', (E) => {
    E.stopPropagation();
    E.preventDefault();
    if (StickPointer !== -1) { return; }
    StickPointer = E.pointerId;
    Zone.setPointerCapture(E.pointerId);
    const Box = Zone.getBoundingClientRect();
    CentreX = E.clientX;
    CentreY = E.clientY;
    Stick.classList.add('live');
    Stick.style.left = `${E.clientX - Box.left}px`;
    Stick.style.top = `${E.clientY - Box.top}px`;
    MoveStick(E);
  });
  Zone.addEventListener('pointermove', (E) => { if (E.pointerId === StickPointer) { MoveStick(E); } });
  for (const Type of ['pointerup', 'pointercancel'] as const) {
    Zone.addEventListener(Type, (E) => { if (E.pointerId === StickPointer) { EndStick(); } });
  }

  // --- the buttons ---
  const Held = new Set<FKey>();
  const Bind = (El: HTMLElement, Key: FKey) => {
    const Set = (bDown: boolean) => {
      if (bDown) { Held.add(Key); } else { Held.delete(Key); }
      El.classList.toggle('down', bDown);
      Input.SetTouchButton(Key, bDown);
    };
    El.addEventListener('pointerdown', (E) => {
      E.stopPropagation();
      E.preventDefault();
      El.setPointerCapture(E.pointerId);
      Set(true);
    });
    for (const Type of ['pointerup', 'pointercancel'] as const) { El.addEventListener(Type, () => Set(false)); }
    El.addEventListener('contextmenu', (E) => E.preventDefault());
  };
  const Cluster = document.createElement('div');
  Cluster.className = 'pad';
  for (const B of BUTTONS) {
    const El = document.createElement('button');
    El.type = 'button';
    El.tabIndex = -1;
    El.textContent = B.Label;
    if (B.Class) { El.className = B.Class; }
    El.style.width = El.style.height = `calc(var(--u) * ${B.Size})`;
    El.style.right = `calc(var(--u) * ${B.Right})`;
    El.style.bottom = `calc(var(--u) * ${B.Bottom})`;
    Bind(El, B.Key);
    Cluster.appendChild(El);
  }
  Pad.appendChild(Cluster);
  const Pause = document.createElement('button');
  Pause.type = 'button';
  Pause.tabIndex = -1;
  Pause.className = 'pause';
  Pause.textContent = 'II';
  Bind(Pause, EKeys.Gamepad_Special_Right);
  Pad.appendChild(Pause);

  // Show the pad once the player has touched the screen, and only while there is something to steer.
  let bTouchUser = window.matchMedia('(pointer: coarse)').matches;
  window.addEventListener('pointerdown', (E) => { if (E.pointerType === 'touch') { bTouchUser = true; } }, { capture: true });
  window.addEventListener('keydown', () => { bTouchUser = window.matchMedia('(pointer: coarse)').matches; });
  const Sync = () => {
    const bOn = bTouchUser && WantPad();
    if (Pad.classList.contains('on') !== bOn) {
      Pad.classList.toggle('on', bOn);
      if (!bOn) {
        if (StickPointer !== -1) { EndStick(); }
        for (const Key of [...Held]) { Input.SetTouchButton(Key, false); }
        Held.clear();
        Pad.querySelectorAll('button.down').forEach((El) => El.classList.remove('down'));
      }
    }
    requestAnimationFrame(Sync);
  };
  requestAnimationFrame(Sync);
}
