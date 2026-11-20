"""The eight walkouts share a four-beat sting, arranged for the character entering."""
import numpy as np
from make_audio import SR, at, band, bass_note, decay, drive, hat, kick, save, snare, sweep, t, thump, tone

def voice(star, note, duration):
    f = 440 * 2 ** ((note - 69) / 12)
    time = t(duration)
    phase = 2 * np.pi * f * time
    if star == "Rex":
        return band(drive(tone(duration, f, "saw") + tone(duration, f*1.5, "saw"), 2), 100, 2800) * decay(duration, 5, .038)
    if star == "Lola":
        return (np.sin(phase + 0.7*np.sin(phase*2)) + 0.24*np.sin(phase*4)) * decay(duration, 4.5)
    if star == "Bruno":
        return sum(g * np.sin(phase*p) * np.exp(-time*r) for p,g,r in ((1,1,7),(1.47,.5,10),(2.18,.31,13),(3.61,.2,17)))
    if star == "Chip":
        return (tone(duration, f, "tri") + 0.25*np.sin(phase*2)) * decay(duration, 7, .008)
    if star == "Wubz":
        return np.sin(phase + (1.9 + .8*np.sin(2*np.pi*6*time))*np.sin(phase*.5)) * decay(duration, 5)
    if star == "Duchess":
        return sum(np.sin(phase*k) * np.exp(-time*(3+2*k))/k for k in range(1,9))
    if star == "Vince":
        chord = tone(duration, f, "saw") + tone(duration, f*1.498, "saw") + .5*tone(duration, f*2.01, "saw")
        return band(drive(chord, 4), 80, 3800) * decay(duration, 3.7)
    return (np.sin(phase + 0.09*np.sin(2*np.pi*5.4*time)) + .17*np.sin(phase*2)) * decay(duration, 2.7,.065)

# Beat, MIDI pitch and note length vary along with the instruments and the rhythm section.
SCORES = {
    "Rex": (114, [(0,38,.8),(.75,38,.23),(1,45,.55),(2,50,1.35)]),
    "Lola": (134, [(0,69,.45),(.5,73,.45),(1,76,.48),(1.75,78,.22),(2,81,1.4)]),
    "Bruno": (122, [(0,62,.45),(.375,69,.3),(.75,67,.3),(1,62,.35),(1.5,70,.35),(2.25,69,.9)]),
    "Chip": (126, [(0,78,.25),(.5,73,.45),(1.25,76,.25),(1.5,78,.25),(2.25,83,1)]),
    "Wubz": (142, [(0,43,.48),(.75,43,.24),(1,50,.45),(1.5,46,.45),(2,43,1.3)]),
    "Duchess": (108, [(0,70,.3),(.33,74,.3),(.67,77,.3),(1,82,.7),(1.75,81,.23),(2,77,1.2)]),
    "Vince": (136, [(0,40,.65),(.75,40,.23),(1,43,.4),(1.5,45,.4),(2,47,1.2)]),
    "Mystica": (99, [(0,61,.8),(.67,68,.7),(1.33,71,.7),(2,74,1.1)]),
}

def render():
    for star, (bpm, notes) in SCORES.items():
        beat = 60/bpm
        out = np.zeros(int(SR * (4*beat + .35)))
        for start, pitch, length in notes:
            hit = voice(star, pitch, length*beat)
            at(out, hit*.63, start*beat)
            at(out, hit*.14, (start+.32)*beat)
        if star in ("Rex","Bruno","Vince"):
            for when,freq in ((0,110),(.75,134),(1.5,98),(2,80)):
                at(out, thump(.22,freq,48,16)*.55, when*beat)
        elif star in ("Lola","Wubz","Chip"):
            for n in range(6):
                at(out, (kick()*.42 if n%2==0 else hat()*.27), n*.5*beat)
        else:
            at(out, bass_note(116.54,beat*2)*.34,0)
            at(out, bass_note(87.3,beat*1.4)*.32,beat*2)
        save("Theme_"+star,out,peak=.78)

if __name__ == "__main__":
    render()
