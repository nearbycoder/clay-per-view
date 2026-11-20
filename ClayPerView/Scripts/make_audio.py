"""Synthesize effects, crowd and music, then run the offline voice renderer unless --no-voice is set."""
import os
import subprocess
import sys
import wave

import numpy as np

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "Art", "Audio")
rng = np.random.default_rng(7)


# ---- building blocks ---------------------------------------------------------------------------------

def t(dur):
    return np.arange(int(SR * dur)) / SR


def noise(dur):
    return rng.uniform(-1.0, 1.0, int(SR * dur))


def band(x, lo=0.0, hi=20000.0, soft=0.25):
    """Zero-phase band-pass via the FFT with soft edges."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1.0 / SR)
    mask = np.ones_like(f)
    if lo > 0:
        mask *= np.clip((f - lo * (1 - soft)) / max(lo * soft, 1.0), 0.0, 1.0)
    if hi < SR / 2:
        mask *= np.clip((hi * (1 + soft) - f) / max(hi * soft, 1.0), 0.0, 1.0)
    return np.fft.irfft(spec * mask, len(x))


def decay(dur, rate, attack=0.002):
    x = t(dur)
    return np.minimum(x / max(attack, 1e-5), 1.0) * np.exp(-x * rate)


def sweep(dur, f0, f1, curve=1.0):
    """Sine whose pitch glides f0 -> f1."""
    x = t(dur) / dur
    freq = f0 + (f1 - f0) * x ** curve
    return np.sin(2 * np.pi * np.cumsum(freq) / SR)


def tone(dur, freq, shape="sine"):
    ph = 2 * np.pi * freq * t(dur)
    if shape == "saw":
        return 2.0 * ((freq * t(dur)) % 1.0) - 1.0
    if shape == "square":
        return np.sign(np.sin(ph))
    if shape == "tri":
        return 2.0 * np.abs(2.0 * ((freq * t(dur)) % 1.0) - 1.0) - 1.0
    return np.sin(ph)


def drive(x, amount=2.0):
    return np.tanh(x * amount) / np.tanh(amount)


def norm(x, peak=0.9):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 1e-9 else x


def pad(x, dur):
    n = int(SR * dur)
    return np.concatenate([x, np.zeros(max(0, n - len(x)))])[:n]


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[:len(p)] += p
    return out


def at(dst, x, when):
    i = int(when * SR)
    j = min(len(dst), i + len(x))
    if j > i:
        dst[i:j] += x[:j - i]


def fade(x, a=0.004, b=0.01):
    n, m = int(a * SR), int(b * SR)
    y = x.copy()
    if n:
        y[:n] *= np.linspace(0, 1, n)
    if m:
        y[-m:] *= np.linspace(1, 0, m)
    return y


def save(name, x, peak=0.9):
    os.makedirs(OUT, exist_ok=True)
    data = (np.clip(norm(fade(x), peak), -1, 1) * 32767).astype(np.int16)
    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


# ---- impacts -------------------------------------------------------------------------------------------

def thump(dur, f0, f1, rate):
    return sweep(dur, f0, f1, 0.5) * decay(dur, rate)


def clapperboard():
    # Double wooden transient: the blade, then the hollow slate vibrating underneath.
    out = np.zeros(int(SR * .34))
    at(out, band(noise(.075), 900, 8100) * decay(.075, 89), 0)
    at(out, mix(tone(.20, 690)*decay(.20, 22), tone(.17, 1030)*decay(.17, 30)*.41), .014)
    save("Clapboard", out, peak=.78)


def make_impacts():
    clapperboard()
    save("Punch", mix(thump(0.16, 170, 60, 28) * 0.9, band(noise(0.1), 700, 4500) * decay(0.1, 55) * 0.7))
    save("Heavy", mix(thump(0.34, 130, 38, 14), band(noise(0.2), 300, 5000) * decay(0.2, 26) * 0.8,
                      band(noise(0.04), 2500, 9000) * decay(0.04, 90) * 0.5))
    save("Kick", mix(thump(0.22, 210, 70, 20), band(noise(0.08), 1500, 7000) * decay(0.08, 60) * 0.6))
    save("Block", mix(thump(0.09, 240, 150, 45) * 0.6, band(noise(0.06), 900, 3000) * decay(0.06, 80) * 0.5), peak=0.6)
    save("Stomp", mix(thump(0.3, 110, 34, 15), band(noise(0.12), 200, 1800) * decay(0.12, 35) * 0.5))
    save("Slam", mix(thump(0.6, 95, 28, 8.5), band(noise(0.35), 120, 2200) * decay(0.35, 13) * 0.75,
                     pad(np.zeros(int(0.03 * SR)), 0.03), band(noise(0.5), 3000, 9000) * decay(0.5, 9) * 0.12))
    save("Thud", mix(thump(0.2, 150, 50, 22), band(noise(0.1), 300, 2500) * decay(0.1, 40) * 0.5), peak=0.7)
    save("Grab", mix(band(noise(0.14), 500, 3500) * decay(0.14, 28), thump(0.12, 120, 70, 30) * 0.6), peak=0.6)
    w = noise(0.3)
    whoosh = band(w, 300, 1500) * np.sin(np.pi * t(0.3) / 0.3) ** 2 * 0.8 + band(w, 1500, 6000) * np.sin(np.pi * np.clip(t(0.3) / 0.3 * 1.3 - 0.3, 0, 1)) ** 2
    save("Whoosh", whoosh, peak=0.55)
    # Ropes: a rubbery boing.
    x = t(0.5)
    boing = np.sin(2 * np.pi * np.cumsum(70 + 60 * np.exp(-x * 6) + 14 * np.sin(2 * np.pi * 9 * x)) / SR)
    save("Ropes", mix(boing * decay(0.5, 7), tone(0.5, 140, "tri") * decay(0.5, 9) * 0.3), peak=0.6)
    save("Bonk", mix(sweep(0.18, 420, 250, 0.4) * decay(0.18, 22), tone(0.18, 840) * decay(0.18, 40) * 0.35,
                     band(noise(0.03), 1000, 5000) * decay(0.03, 100) * 0.4))

    def clang(partials, rate, dur, hit=0.5):
        body = sum(np.sin(2 * np.pi * f * t(dur) + rng.uniform(0, 6.28)) * decay(dur, rate * (1 + i * 0.35)) * a
                   for i, (f, a) in enumerate(partials))
        return mix(body, band(noise(0.05), 1500, 10000) * decay(0.05, 70) * hit)

    save("Chair", clang([(523, 1.0), (1187, 0.8), (1873, 0.7), (2741, 0.5), (3517, 0.4), (4409, 0.3)], 7.5, 0.7))
    save("Pan", clang([(880, 1.0), (1420, 0.7), (2330, 0.55), (3110, 0.3)], 5.0, 0.9, hit=0.35))
    save("Bell", pad(mix(*[pad(np.concatenate([np.zeros(int(SR * 0.28 * k)), clang([(1245, 1.0), (2104, 0.6), (3320, 0.45), (4670, 0.3)], 4.2, 1.1, 0.3)]), 1.9)
                           for k in range(3)]), 1.9))
    # Guitar smash: a detuned chord strangled by a crunch.
    strings = [82.4, 110.0, 146.8, 196.0, 246.9, 329.6]
    chord = sum(drive(tone(0.9, f * rng.uniform(0.97, 1.04), "saw"), 3.0) * decay(0.9, 5 + i) for i, f in enumerate(strings))
    save("Guitar", mix(band(chord, 80, 5000) * 0.6, band(noise(0.25), 400, 6000) * decay(0.25, 18), thump(0.3, 140, 50, 15)))
    x = t(0.34)
    squeak = np.sin(2 * np.pi * np.cumsum(700 + 800 * np.sin(np.pi * x / 0.34) + 90 * np.sin(2 * np.pi * 34 * x)) / SR)
    save("Squeak", squeak * np.sin(np.pi * x / 0.34) ** 0.6, peak=0.6)
    save("Break", mix(band(noise(0.12), 800, 8000) * decay(0.12, 45), thump(0.2, 180, 60, 20) * 0.7,
                      np.concatenate([np.zeros(int(0.05 * SR)), band(noise(0.2), 1500, 7000) * decay(0.2, 22) * 0.5])))
    save("Pickup", mix(sweep(0.12, 500, 950) * decay(0.12, 22), tone(0.12, 1500) * decay(0.12, 40) * 0.3), peak=0.5)
    save("Pop", mix(sweep(0.09, 320, 1300, 0.5) * decay(0.09, 40), band(noise(0.02), 2000, 9000) * decay(0.02, 150) * 0.6))
    # Splat: wet noise sliding down in pitch.
    w = noise(0.42)
    splat = sum(band(w, lo, lo * 1.8) * np.exp(-((t(0.42) - c) / 0.07) ** 2) for lo, c in ((2600, 0.03), (1500, 0.08), (800, 0.15), (400, 0.24)))
    save("Splat", mix(splat, thump(0.2, 120, 50, 22) * 0.6))


def make_big():
    w = noise(1.5)
    boom = band(w, 30, 220) * decay(1.5, 3.2) * 1.4 + band(w, 220, 2500) * decay(1.5, 6.5) + band(w, 2500, 9000) * decay(1.5, 14) * 0.5
    save("Explosion", drive(mix(boom, thump(0.9, 90, 24, 5.5) * 1.2), 1.8))
    x = t(0.4)
    buzz = np.sign(np.sin(2 * np.pi * np.cumsum(180 + 900 * rng.uniform(0, 1, len(x)).repeat(1)[:len(x)] * 0 + 140 * np.sin(2 * np.pi * 37 * x) + 600 * (rng.uniform(0, 1, len(x)) > 0.985).cumsum() % 3) / SR))
    save("Zap", mix(band(buzz, 400, 7000) * decay(0.4, 6) * 0.7, band(noise(0.4), 3000, 12000) * decay(0.4, 10) * 0.6), peak=0.6)
    power = sum(drive(tone(0.75, f, "saw"), 4.0) for f in (110.0, 164.8, 220.0, 110.6))
    save("Chord", band(power, 70, 5200) * decay(0.75, 3.2), peak=0.7)
    x = t(0.34)
    note = sum(np.sin(2 * np.pi * np.cumsum(1568.0 * h * (1 + 0.012 * np.sin(2 * np.pi * 7 * x))) / SR) / h for h in (1, 2, 3))
    save("Scream", note * np.minimum(x / 0.03, 1) * np.minimum((0.34 - x) / 0.06, 1), peak=0.5)
    w = noise(0.42)
    save("Flame", band(w, 80, 900) * np.sin(np.pi * t(0.42) / 0.42) ** 1.5 + band(w, 900, 5000) * np.sin(np.pi * t(0.42) / 0.42) ** 3 * 0.5, peak=0.6)
    save("Sizzle", band(noise(0.25), 3500, 12000) * decay(0.25, 12), peak=0.4)
    x = t(1.1)
    sub = np.sin(2 * np.pi * np.cumsum(120 * np.exp(-x * 1.6) + 34) / SR) * (0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 9 * x)))
    save("BassDrop", drive(mix(sub * decay(1.1, 1.6), thump(0.3, 160, 40, 12)), 2.4))
    w = noise(1.4)
    rise = np.minimum(t(1.4) / 0.25, 1.0)
    save("Rocket", (band(w, 60, 700) + band(w, 700, 5000) * 0.6 * (t(1.4) / 1.4)) * rise, peak=0.75)
    crackle = (rng.uniform(0, 1, int(SR * 0.9)) > 0.9985).astype(float) * rng.uniform(0.4, 1.0, int(SR * 0.9))
    save("Pyro", mix(band(noise(0.5), 100, 6000) * decay(0.5, 9), thump(0.4, 110, 35, 9), band(np.convolve(crackle, decay(0.01, 600), "same"), 1500, 12000) * 1.5))
    save("Swell", mix((band(noise(1.3), 300, 5000) * (t(1.3) / 1.3) ** 2), sweep(1.3, 110, 440, 2.0) * (t(1.3) / 1.3) ** 2 * 0.5,
                      np.concatenate([np.zeros(int(1.25 * SR)), thump(0.5, 100, 35, 7)])), peak=0.7)
    save("Special", mix(sweep(0.5, 300, 1800, 0.6) * decay(0.5, 4) * 0.5, band(noise(0.5), 2000, 9000) * np.sin(np.pi * t(0.5) / 0.5) ** 2 * 0.5,
                        sum(pad(np.concatenate([np.zeros(int(SR * 0.06 * k)), tone(0.3, f) * decay(0.3, 9)]), 0.7) for k, f in enumerate((784, 988, 1175, 1568)))), peak=0.6)
    save("HypeFull", sum(pad(np.concatenate([np.zeros(int(SR * 0.07 * k)), mix(tone(0.25, f), tone(0.25, f * 2) * 0.4) * decay(0.25, 10)]), 0.7)
                         for k, f in enumerate((523, 659, 784, 1047, 1319))), peak=0.5)


def make_ui():
    save("Tick", mix(tone(0.05, 880, "tri"), tone(0.05, 1760) * 0.3) * decay(0.05, 60), peak=0.35)
    save("Select", pad(mix(tone(0.09, 660, "tri") * decay(0.09, 25), np.concatenate([np.zeros(int(0.07 * SR)), tone(0.16, 990, "tri") * decay(0.16, 16)])), 0.25), peak=0.45)
    save("Back", pad(mix(tone(0.09, 520, "tri") * decay(0.09, 25), np.concatenate([np.zeros(int(0.07 * SR)), tone(0.14, 390, "tri") * decay(0.14, 18)])), 0.22), peak=0.4)
    # Fanfare: four brassy stabs and a held chord.
    out = np.zeros(int(SR * 2.6))
    brass = lambda f, d: band(drive(mix(tone(d, f, "saw"), tone(d, f * 1.005, "saw")), 2.0), 150, 4500) * np.minimum(t(d) / 0.02, 1) * np.minimum((d - t(d)) / 0.05, 1)
    for when, notes, d in ((0.0, (392, 523), 0.16), (0.2, (392, 523), 0.16), (0.4, (392, 523), 0.16), (0.62, (523, 659, 784), 0.5),
                           (1.2, (466, 587, 698), 0.3), (1.55, (523, 659, 784, 1047), 1.0)):
        for f in notes:
            at(out, brass(f, d) * 0.5, when)
    save("Fanfare", out, peak=0.7)


# ---- the crowd ------------------------------------------------------------------------------------------

def crowd_bed(dur, excitement):
    """Many voices at once: shaped noise with slow swells, plus scattered claps and whistles."""
    w = noise(dur)
    murmur = band(w, 180, 900) * 0.9 + band(w, 900, 3200) * (0.35 + 0.5 * excitement)
    swell = 0.75 + 0.25 * band(noise(dur), 0, 1.5, soft=1.0) / 0.02
    swell = np.clip(swell, 0.4, 1.3)
    out = murmur * swell
    claps = int(dur * (10 + 60 * excitement))
    for _ in range(claps):
        c = band(noise(0.03), 1200, 5000) * decay(0.03, 110) * rng.uniform(0.15, 0.5)
        at(out, c, rng.uniform(0, dur - 0.05))
    for _ in range(int(dur * excitement * 1.5)):
        d = rng.uniform(0.25, 0.5)
        whistle = sweep(d, rng.uniform(1600, 2200), rng.uniform(2400, 3200)) * np.sin(np.pi * t(d) / d) * 0.08
        at(out, whistle, rng.uniform(0, dur - 0.6))
    return out


def loopable(x, overlap=1.0):
    n = int(overlap * SR)
    ramp = np.linspace(0, 1, n)
    body = x[:-n].copy()
    body[:n] = body[:n] * ramp + x[-n:] * (1 - ramp)
    return body


def make_crowd():
    save("Crowd_Loop", loopable(crowd_bed(9.0, 0.35)), peak=0.5)
    cheer = crowd_bed(1.9, 1.0) * np.minimum(t(1.9) / 0.15, 1) * np.exp(-np.maximum(t(1.9) - 0.5, 0) * 1.9)
    save("Cheer", cheer, peak=0.7)
    w = noise(1.0)
    ooh = (band(w, 280, 620) + band(w, 700, 1100) * 0.4) * np.sin(np.pi * np.clip(t(1.0) / 1.0, 0, 1)) ** 1.2
    save("Gasp", ooh, peak=0.6)


# ---- music ----------------------------------------------------------------------------------------------

def kick():
    return mix(thump(0.22, 150, 42, 16), band(noise(0.02), 1500, 6000) * decay(0.02, 150) * 0.3)


def snare():
    return mix(band(noise(0.18), 900, 8000) * decay(0.18, 22), tone(0.1, 190) * decay(0.1, 30) * 0.6)


def hat(open_=False):
    d = 0.16 if open_ else 0.045
    return band(noise(d), 6000, 16000) * decay(d, 18 if open_ else 70) * 0.5


def bass_note(freq, dur):
    return band(drive(mix(tone(dur, freq, "saw"), tone(dur, freq * 0.5, "square") * 0.5), 2.5), 30, 900) * np.minimum(t(dur) / 0.006, 1) * np.exp(-t(dur) * 3.0)


def stab(freqs, dur, bright=4500):
    x = sum(tone(dur, f, "saw") + tone(dur, f * 1.007, "saw") for f in freqs)
    return band(drive(x * 0.4, 3.0), 120, bright) * np.minimum(t(dur) / 0.004, 1) * np.exp(-t(dur) * 5.0)


def lead(freq, dur):
    x = tone(dur, freq, "square") * 0.5 + tone(dur, freq * 2.0, "tri") * 0.3
    vib = 1 + 0.01 * np.sin(2 * np.pi * 6 * t(dur))
    return band(x * vib[:len(x)], 300, 5000) * np.minimum(t(dur) / 0.01, 1) * np.minimum((dur - t(dur)) / 0.03, 1)


def loop_buffer(bars, bpm):
    beat = 60.0 / bpm
    return np.zeros(int(round(bars * 4 * beat * SR))), beat


def wrap_add(dst, x, when):
    """Add into a loop so tails wrap round to the start."""
    n = len(dst)
    idx = (int(when * SR) + np.arange(len(x))) % n
    np.add.at(dst, idx, x)


def make_music():
    A1, C2, D2, E2, G2 = 55.0, 65.4, 73.4, 82.4, 98.0
    # --- fight: driving hard rock in E, 150 bpm ---
    out, beat = loop_buffer(8, 150)
    riff = [E2, E2, G2, E2, A1 * 2, E2, G2 * 1.125, G2]
    roots = [E2, E2, C2 * 2, D2 * 2, E2, E2, G2, D2 * 2]
    for bar in range(8):
        b0 = bar * 4 * beat
        for q in range(4):
            wrap_add(out, kick() * 0.95, b0 + q * beat)
            if q in (1, 3):
                wrap_add(out, snare() * 0.8, b0 + q * beat)
        if bar % 4 == 3:
            for k in range(4):
                wrap_add(out, snare() * (0.4 + 0.12 * k), b0 + 3 * beat + k * beat * 0.25)
        for e in range(8):
            wrap_add(out, hat(e == 7) * 0.5, b0 + e * beat * 0.5)
            wrap_add(out, bass_note(riff[e] * (roots[bar] / E2), beat * 0.48) * 0.75, b0 + e * beat * 0.5)
        root = roots[bar] * 2
        for when, d in ((0.0, 0.9), (1.5, 0.4), (2.5, 0.9)):
            wrap_add(out, stab((root, root * 1.498, root * 2), beat * d) * 0.42, b0 + when * beat)
    melody = [(0, 659.3, 1.0), (1.0, 784.0, 0.5), (1.5, 880.0, 1.5), (3.0, 784.0, 1.0), (4.0, 659.3, 1.0), (5.0, 587.3, 0.5), (5.5, 659.3, 2.0),
              (8.0, 880.0, 1.0), (9.0, 987.8, 0.5), (9.5, 1174.7, 1.5), (11.0, 987.8, 1.0), (12.0, 880.0, 1.5), (13.5, 784.0, 0.5), (14.0, 659.3, 2.0)]
    for start, f, d in melody:
        wrap_add(out, lead(f, d * beat) * 0.2, (16 + start) * beat)
    save("Music_Fight", drive(out * 0.55, 1.4), peak=0.8)

    # --- menu: strutting funk in A minor, 104 bpm ---
    out, beat = loop_buffer(8, 104)
    line = [(0, 110.0), (0.75, 110.0), (1.5, 130.8), (2.0, 146.8), (2.75, 164.8), (3.5, 146.8)]
    chords = [(220.0, 261.6, 329.6), (220.0, 261.6, 329.6), (174.6, 220.0, 261.6), (196.0, 246.9, 293.7)] * 2
    for bar in range(8):
        b0 = bar * 4 * beat
        shift = 1.0 if bar % 4 < 2 else (0.794 if bar % 4 == 2 else 0.891)
        wrap_add(out, kick() * 0.9, b0)
        wrap_add(out, kick() * 0.7, b0 + 2.5 * beat)
        wrap_add(out, snare() * 0.6, b0 + beat)
        wrap_add(out, snare() * 0.6, b0 + 3 * beat)
        for e in range(8):
            wrap_add(out, hat(e % 4 == 3) * 0.4, b0 + e * beat * 0.5)
        for when, f in line:
            wrap_add(out, bass_note(f * shift, beat * 0.42) * 0.8, b0 + when * beat)
        for when in (0.5, 2.0, 3.5):
            wrap_add(out, stab(chords[bar], beat * 0.3, bright=3000) * 0.3, b0 + when * beat)
    save("Music_Menu", drive(out * 0.6, 1.2), peak=0.75)


if __name__ == "__main__":
    make_impacts()
    make_big()
    make_ui()
    make_crowd()
    make_music()
    from entrance_music import render
    render()
    if "--no-voice" not in sys.argv:
        subprocess.run([os.path.join(ROOT, "Scripts", "voices.sh")], check=True)
    print("audio written to", OUT, len([f for f in os.listdir(OUT) if f.endswith(".wav")]), "files")
