"""Tiling clay surface maps, generated with numpy:

  T_ClayNormal.png  thumbprints, tool dents and a little grain (tangent-space normal map, Unreal's green-down convention)
  T_ClayDetail.png  R = roughness variation, G = colour mottling, B = cavity shading (all centred on 0.5)

One tile covers 40 cm of surface (see common.box_uv), so the thumbprints are deliberately oversized:
this is clay photographed up close.
"""
import os

import bpy
import numpy as np

from .common import EXPORT_DIR, log

N = 1024


def _spectral_noise(rng, power, lo=1.0, hi=None):
    """Periodic noise with a 1/f^power spectrum between spatial frequencies lo..hi (cycles per tile)."""
    f = np.fft.fftfreq(N) * N
    fx, fy = np.meshgrid(f, f)
    r = np.sqrt(fx * fx + fy * fy)
    amp = np.zeros_like(r)
    band = r >= lo
    if hi is not None:
        band &= r <= hi
    amp[band] = 1.0 / np.power(r[band], power)
    phase = rng.uniform(0, 2 * np.pi, (N, N))
    img = np.fft.ifft2(amp * np.exp(1j * phase)).real
    return img / (np.abs(img).max() + 1e-9)


def _wrapped(a):
    """Toroidal offset in pixels (so features wrap across the tile edges)."""
    return (a + N / 2) % N - N / 2


def height_map(rng):
    y, x = np.mgrid[0:N, 0:N].astype(np.float32)
    h = 0.55 * _spectral_noise(rng, 2.3, lo=1, hi=24)            # soft lumps
    warp_x = 14.0 * _spectral_noise(rng, 2.0, lo=2, hi=20)
    warp_y = 14.0 * _spectral_noise(rng, 2.0, lo=2, hi=20)
    ridges = np.zeros((N, N), dtype=np.float32)
    cover = np.zeros((N, N), dtype=np.float32)
    for _ in range(46):                                           # thumbprints
        cx, cy = rng.uniform(0, N, 2)
        rad = rng.uniform(70, 125)
        ang = rng.uniform(0, np.pi)
        ca, sa = np.cos(ang), np.sin(ang)
        dx, dy = _wrapped(x - cx), _wrapped(y - cy)
        u, v = dx * ca + dy * sa, -dx * sa + dy * ca
        mask = np.clip(1.0 - (u / rad) ** 2 - (v / (rad * 0.72)) ** 2, 0.0, 1.0) ** 0.6
        # whorl centre sits off to one side so most of the print is arches
        wu, wv = u + rad * rng.uniform(-0.5, 0.5) + warp_x, v + rad * rng.uniform(0.2, 1.1) + warp_y
        r = np.sqrt(wu * wu + (wv * 1.25) ** 2)
        lam = rng.uniform(7.5, 9.5)
        pattern = np.sin(2 * np.pi * r / lam)
        take = mask > cover
        ridges = np.where(take, pattern * mask, ridges)
        cover = np.maximum(cover, mask)
    h += 0.16 * ridges
    for _ in range(26):                                           # shallow dents and pinches
        cx, cy = rng.uniform(0, N, 2)
        rad = rng.uniform(28, 80)
        dx, dy = _wrapped(x - cx), _wrapped(y - cy)
        stretch = rng.uniform(0.5, 1.0)
        ang = rng.uniform(0, np.pi)
        u = dx * np.cos(ang) + dy * np.sin(ang)
        v = -dx * np.sin(ang) + dy * np.cos(ang)
        h -= rng.uniform(0.25, 0.6) * np.exp(-((u / rad) ** 2 + (v / (rad * stretch)) ** 2) * 2.2)
    for _ in range(14):                                           # scratches from sculpting tools
        cx, cy = rng.uniform(0, N, 2)
        ang = rng.uniform(0, np.pi)
        length, width = rng.uniform(60, 220), rng.uniform(1.6, 3.2)
        dx, dy = _wrapped(x - cx), _wrapped(y - cy)
        u = dx * np.cos(ang) + dy * np.sin(ang)
        v = -dx * np.sin(ang) + dy * np.cos(ang)
        h -= 0.22 * np.exp(-(v / width) ** 2) * np.clip(1.0 - (u / length) ** 2, 0.0, 1.0)
    h += 0.035 * _spectral_noise(rng, 0.6, lo=60, hi=400)        # grain
    return h.astype(np.float32), ridges


def save(name, rgb):
    os.makedirs(os.path.join(EXPORT_DIR, "Textures"), exist_ok=True)
    img = bpy.data.images.new(name, N, N, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.concatenate([np.clip(rgb, 0.0, 1.0), np.ones((N, N, 1), dtype=np.float32)], axis=2)
    img.pixels.foreach_set(rgba[::-1].astype(np.float32).ravel())      # Blender rows run bottom-up
    img.filepath_raw = os.path.join(EXPORT_DIR, "Textures", name + ".png")
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def build_all():
    rng = np.random.default_rng(1998)
    h, ridges = height_map(rng)
    strength = 3.2
    gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * strength
    gy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * strength     # image rows run downward
    nz = np.ones_like(h)
    length = np.sqrt(gx * gx + gy * gy + nz * nz)
    normal = np.stack([-gx / length * 0.5 + 0.5, -gy / length * 0.5 + 0.5, nz / length * 0.5 + 0.5], axis=2)
    save("T_ClayNormal", normal)
    rough = 0.5 + 0.22 * _spectral_noise(rng, 1.8, lo=1, hi=40) - 0.07 * ridges
    mottle = 0.5 + 0.2 * _spectral_noise(rng, 1.6, lo=2, hi=70)
    blur = h - 0.55 * _spectral_noise(rng, 2.3, lo=1, hi=24)
    cavity = 0.5 + np.clip(h, -1, 1) * 0.35 + 0.1 * ridges
    save("T_ClayDetail", np.stack([rough, mottle, cavity], axis=2))
    log("textures written")
