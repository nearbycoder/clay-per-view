// The game's six materials, ported from the Unreal graphs in ClayPerView/Scripts/import_assets.py.
//
//   M_Clay    every lump of clay: sRGB vertex colour with roughness in alpha, thumbprint normals and
//             mottling from two tiling maps, and a "boil" that jitters the detail on each animation step.
//   M_Glow    lamps, LED strips and LED faces (unlit).
//   M_Crowd   the audience: clothes from per-instance data, the sit/stand/wave motion in the vertex shader.
//   M_Flash   camera flashes twinkling in the stands.
//   M_Screen  the video walls.
//   M_Sign    fan placards.
//
// Light is measured as in the desktop game: candelas in, nits out, exposed for a fixed EV100. Only the
// lights that matter most are real three.js lights (see CpvArena.ts); the rest of the rig - stage, wash
// and fill lights - is the "stadium" list below, which clay shades per pixel with diffuse only and the
// crowd receives per spectator.

import {
  Color,
  DoubleSide,
  IUniform,
  Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  Texture,
  UniformsLib,
  UniformsUtils,
  Vector3,
  Vector4,
} from 'three';

import { Assets } from './assets';
import { FLinearColor } from './ue';

export const MAX_STADIUM_LIGHTS = 32;

/** Uniforms every material shares: one object each, so a single write reaches all shaders. */
export const Shared = {
  uTime: { value: 0 },
  uStadCount: { value: 0 },
  uStadPos: { value: Array.from({ length: MAX_STADIUM_LIGHTS }, () => new Vector4(0, 0, 0, 1)) }, // xyz position (m), w radius (m)
  uStadDir: { value: Array.from({ length: MAX_STADIUM_LIGHTS }, () => new Vector4(0, -1, 0, -2)) }, // xyz direction, w cos(outer cone)
  uStadCol: { value: Array.from({ length: MAX_STADIUM_LIGHTS }, () => new Vector4(0, 0, 0, 1)) }, // rgb colour * candelas, w 1 / (cos inner - cos outer)
  uClayNormal: { value: null as Texture | null },
  uClayDetail: { value: null as Texture | null },
  uCrowdFlashPos: { value: new Vector3(0, 4.3, 0) },
  uCrowdFlash: { value: 0 }, // candelas
  uCrowdAmbient: { value: new Vector3(0, 0, 0) }, // lux reaching every spectator whatever way they face
  // Light bounced up off the lit mat (the desktop game's global illumination did this): rgb is the lux on a
  // surface facing straight down just above the middle of the ring, w the radius in metres it fades over.
  uBounce: { value: new Vector4(0, 0, 0, 8) },
  uExposure: { value: 1 },
};

const STADIUM_GLSL = /* glsl */ `
uniform int uStadCount;
uniform vec4 uStadPos[${MAX_STADIUM_LIGHTS}];
uniform vec4 uStadDir[${MAX_STADIUM_LIGHTS}];
uniform vec4 uStadCol[${MAX_STADIUM_LIGHTS}];
uniform vec4 uBounce;
// Irradiance from the stage, wash and fill lights at a world position (metres) with a world normal.
vec3 cpvStadium(vec3 P, vec3 N) {
  // The mat is a big soft light from below: strongest on surfaces that face down, gone outside the ringside.
  float reach = clamp(1.0 - dot(P.xz, P.xz) / (uBounce.w * uBounce.w), 0.0, 1.0);
  float lift = max(P.y, 0.0) / 3.5;
  vec3 sum = uBounce.rgb * ((0.5 - 0.5 * N.y) * reach * reach / (1.0 + lift * lift));
  for (int i = 0; i < ${MAX_STADIUM_LIGHTS}; i++) {
    if (i >= uStadCount) break;
    vec3 L = uStadPos[i].xyz - P;
    float d2 = dot(L, L);
    float d = sqrt(d2);
    L /= d;
    float r = d / uStadPos[i].w;
    float window = clamp(1.0 - r * r * r * r, 0.0, 1.0);
    float cone = clamp((dot(-L, uStadDir[i].xyz) - uStadDir[i].w) * uStadCol[i].w, 0.0, 1.0);
    sum += uStadCol[i].rgb * (max(dot(N, L), 0.0) * window * window * cone * cone / max(d2, 0.01));
  }
  return sum;
}
`;

const CLAY_VERTEX_PARS = /* glsl */ `
attribute vec4 aClay;
#ifdef CPV_INSTANCED
attribute vec4 aCustom0;
#endif
varying vec4 vClay;
varying vec3 vInst;
varying vec2 vClayUv;
varying vec3 vCpvWorld;
`;

const CLAY_VERTEX_MAIN = /* glsl */ `
vClay = aClay;
vClayUv = uv;
#ifdef CPV_INSTANCED
  vInst = aCustom0.rgb;
  vCpvWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vInst = vec3(1.0);
  vCpvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`;

const CLAY_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uClayNormal;
uniform sampler2D uClayDetail;
uniform vec3 uTint;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uBoil;
uniform float uBoilRate;
uniform float uDetailTiling;
uniform float uNormalStrength;
uniform float uMottle;
uniform float uCavity;
uniform float uRoughVar;
uniform float uTime;
varying vec4 vClay;
varying vec3 vInst;
varying vec2 vClayUv;
varying vec3 vCpvWorld;
${STADIUM_GLSL}
mat3 cpvTangentFrame(vec3 eyePos, vec3 surfNorm, vec2 st) {
  vec3 q0 = dFdx(eyePos);
  vec3 q1 = dFdy(eyePos);
  vec2 st0 = dFdx(st);
  vec2 st1 = dFdy(st);
  vec3 N = surfNorm;
  vec3 q1perp = cross(q1, N);
  vec3 q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(T * scale, B * scale, N);
}
`;

const CLAY_COLOUR = /* glsl */ `
float cpvStep = floor(uTime * uBoilRate);
vec2 cpvJitter = fract(sin(vec2(cpvStep * 12.9898, cpvStep * 78.233)) * 43758.5453);
vec2 cpvUv = vClayUv * uDetailTiling + cpvJitter * uBoil;
vec4 cpvDetail = texture2D(uClayDetail, cpvUv * 0.37 + 0.31);
vec3 cpvBase = pow(max(vClay.rgb, vec3(0.0001)), vec3(2.2)) * uTint * vInst;
cpvBase *= 1.0 + (cpvDetail.g - 0.5) * 2.0 * uMottle;
cpvBase *= mix(1.0, clamp(cpvDetail.b * 2.0, 0.0, 1.0), uCavity);
diffuseColor.rgb = cpvBase;
`;

const CLAY_ROUGHNESS = /* glsl */ `
float roughnessFactor = clamp(vClay.a * (1.0 + (cpvDetail.r - 0.5) * 2.0 * uRoughVar), 0.0, 1.0);
`;

// The normal map was painted for Unreal (green points down the texture), hence the flipped Y.
const CLAY_NORMAL = /* glsl */ `
vec3 cpvMapN = texture2D(uClayNormal, cpvUv).xyz * 2.0 - 1.0;
cpvMapN.y = -cpvMapN.y;
cpvMapN = normalize(mix(vec3(0.0, 0.0, 1.0), cpvMapN, uNormalStrength));
normal = normalize(cpvTangentFrame(-vViewPosition, normal, cpvUv) * cpvMapN);
`;

const CLAY_EMISSIVE = /* glsl */ `
totalEmissiveRadiance += uFlashColor * (uFlash * 450.0);
`;

const CLAY_STADIUM = /* glsl */ `
#include <lights_fragment_end>
reflectedLight.directDiffuse += cpvStadium(vCpvWorld, inverseTransformDirection(normal, viewMatrix)) * BRDF_Lambert(material.diffuseContribution);
`;

function Replace(Source: string, Token: string, With: string): string {
  if (!Source.includes(Token)) { throw new Error(`shader hook ${Token} not found`); }
  return Source.replace(Token, With);
}

type Uniforms = Record<string, IUniform>;

function ClayUniforms(): Uniforms {
  return {
    uTint: { value: new Color(1, 1, 1) },
    uFlash: { value: 0 },
    uFlashColor: { value: new Color(1, 1, 1) },
    uBoil: { value: 0 },
    uBoilRate: { value: 12 },
    uDetailTiling: { value: 1 },
    uNormalStrength: { value: 1 },
    uMottle: { value: 0.22 },
    uCavity: { value: 0.35 },
    uRoughVar: { value: 0.3 },
  };
}

function MakeClay(Instanced: boolean): { Material: Material; Uniforms: Uniforms } {
  const Mat = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const U = ClayUniforms();
  if (Instanced) { Mat.defines = { ...Mat.defines, CPV_INSTANCED: 1 }; }
  Mat.onBeforeCompile = (Shader) => {
    Object.assign(Shader.uniforms, U, {
      uTime: Shared.uTime, uClayNormal: Shared.uClayNormal, uClayDetail: Shared.uClayDetail,
      uStadCount: Shared.uStadCount, uStadPos: Shared.uStadPos, uStadDir: Shared.uStadDir, uStadCol: Shared.uStadCol, uBounce: Shared.uBounce,
    });
    let V = Shader.vertexShader;
    V = Replace(V, '#include <common>', `#include <common>\n${CLAY_VERTEX_PARS}`);
    V = Replace(V, '#include <project_vertex>', `#include <project_vertex>\n${CLAY_VERTEX_MAIN}`);
    Shader.vertexShader = V;
    let F = Shader.fragmentShader;
    F = Replace(F, '#include <common>', `#include <common>\n${CLAY_FRAGMENT_PARS}`);
    F = Replace(F, '#include <color_fragment>', CLAY_COLOUR);
    F = Replace(F, '#include <roughnessmap_fragment>', CLAY_ROUGHNESS);
    F = Replace(F, '#include <normal_fragment_maps>', CLAY_NORMAL);
    F = Replace(F, '#include <emissivemap_fragment>', CLAY_EMISSIVE);
    F = Replace(F, '#include <lights_fragment_end>', CLAY_STADIUM);
    Shader.fragmentShader = F;
  };
  Mat.customProgramCacheKey = () => (Instanced ? 'cpv-clay-instanced' : 'cpv-clay');
  return { Material: Mat, Uniforms: U };
}

function MakeGlow(Instanced: boolean): { Material: Material; Uniforms: Uniforms } {
  const Mat = new MeshBasicMaterial();
  const U: Uniforms = { uTint: { value: new Color(1, 1, 1) }, uIntensity: { value: 1400 } };
  if (Instanced) { Mat.defines = { ...Mat.defines, CPV_INSTANCED: 1 }; }
  Mat.onBeforeCompile = (Shader) => {
    Object.assign(Shader.uniforms, U);
    let V = Shader.vertexShader;
    V = Replace(V, '#include <common>', `#include <common>
attribute vec4 aClay;
#ifdef CPV_INSTANCED
attribute vec4 aCustom0;
#endif
varying vec3 vGlow;`);
    V = Replace(V, '#include <project_vertex>', `#include <project_vertex>
vGlow = pow(max(aClay.rgb, vec3(0.0001)), vec3(2.2));
#ifdef CPV_INSTANCED
vGlow *= aCustom0.rgb;
#endif`);
    Shader.vertexShader = V;
    let F = Shader.fragmentShader;
    F = Replace(F, '#include <common>', '#include <common>\nuniform vec3 uTint;\nuniform float uIntensity;\nvarying vec3 vGlow;');
    F = Replace(F, '#include <color_fragment>', 'diffuseColor.rgb = vGlow * uTint * uIntensity;');
    Shader.fragmentShader = F;
  };
  Mat.customProgramCacheKey = () => (Instanced ? 'cpv-glow-instanced' : 'cpv-glow');
  return { Material: Mat, Uniforms: U };
}

// Per-instance data, twelve floats in three vec4s: shirt rgb, trousers rgb, skin tone, hair tone, phase,
// excitability and two spares (Unreal needed the instance's yaw there; here the motion is applied in the
// spectator's own space, before the instance matrix). aLight is the light reaching this spectator and
// aLightDir where most of it comes from; CpvArena.ts refreshes both a few hundred seats per frame.
const CROWD_VERTEX = /* glsl */ `
attribute vec4 aClay;
attribute vec2 uv1;
attribute vec2 uv2;
attribute vec4 aCustom0;
attribute vec4 aCustom1;
attribute vec4 aCustom2;
attribute vec3 aLight;
attribute vec3 aLightDir;
uniform float uTime;
uniform float uHype;
uniform float uStepRate;
uniform float uBrightness;
uniform vec3 uCrowdFlashPos;
uniform float uCrowdFlash;
uniform vec3 uCrowdAmbient;
varying vec3 vColour;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec3 shirt = aCustom0.rgb;
  vec3 pants = vec3(aCustom0.a, aCustom1.rg);
  float skinTone = aCustom1.b;
  float hairTone = aCustom1.a;
  float phase = aCustom2.r;
  float excite = aCustom2.g;

  vec3 skin = mix(vec3(0.82, 0.56, 0.40), vec3(0.20, 0.10, 0.05), skinTone);
  vec3 dark = vec3(0.012, 0.009, 0.007);
  vec3 brown = vec3(0.15, 0.065, 0.028);
  vec3 fair = vec3(0.72, 0.52, 0.2);
  vec3 hair = hairTone < 0.5 ? mix(dark, brown, hairTone * 2.0) : mix(brown, fair, hairTone * 2.0 - 1.0);
  float rest = clamp(1.0 - aClay.r - aClay.g - aClay.b, 0.0, 1.0);
  vec3 albedo = (aClay.r * skin + aClay.g * shirt + aClay.b * pants + rest * hair) * aClay.a * uBrightness;

  // Sit, stand, bob and wave, in steps like the rest of the cast. Offsets are in Unreal's axes (cm).
  float t = uStepRate > 0.0 ? floor(uTime * uStepRate) / uStepRate : uTime;
  float mood = uHype * 1.25 + 0.10 * sin(t * 0.7 + phase * 40.0);
  float stand = smoothstep(excite * 0.9 + 0.06, excite * 0.9 + 0.20, mood);
  vec3 seated = vec3(uv1.x, uv1.y, uv2.x);
  float wave = uv2.y;
  float upper = clamp(-uv2.x / 30.0, 0.0, 1.0);
  vec3 o = seated * (1.0 - stand);
  o.x += (1.0 - stand) * upper * sin(t * 1.3 + phase * 30.0) * 2.0;
  o.y += (1.0 - stand) * upper * sin(t * 0.9 + phase * 17.0) * 1.5;
  float bob = abs(sin(t * 5.5 + phase * 50.0));
  o.z += stand * bob * 6.0;
  o.y += stand * wave * sin(t * 6.5 + phase * 21.0) * 10.0;
  o.x += stand * wave * cos(t * 6.5 + phase * 21.0) * 4.0;
  vec3 transformed = position + vec3(o.x, o.z, o.y) * 0.01;

  vec4 world = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  vec3 N = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vec3 light = aLight * (0.3 + 0.7 * max(dot(N, aLightDir), 0.0)) + uCrowdAmbient;
  vec3 toFlash = uCrowdFlashPos - world.xyz;
  float flashD2 = dot(toFlash, toFlash);
  light += vec3(uCrowdFlash) * max(dot(N, toFlash * inversesqrt(flashD2)), 0.0) / max(flashD2, 1.0);
  vColour = albedo * light * RECIPROCAL_PI;

  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const CROWD_FRAGMENT = /* glsl */ `
varying vec3 vColour;
#include <common>
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(vColour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function MakeCrowd(): { Material: Material; Uniforms: Uniforms } {
  const U: Uniforms = {
    uHype: { value: 0.3 }, uStepRate: { value: 12 }, uBrightness: { value: 1 },
    uTime: Shared.uTime, uCrowdFlashPos: Shared.uCrowdFlashPos, uCrowdFlash: Shared.uCrowdFlash, uCrowdAmbient: Shared.uCrowdAmbient,
    ...UniformsUtils.clone(UniformsLib.fog),
  };
  const Mat = new ShaderMaterial({ uniforms: U, vertexShader: CROWD_VERTEX, fragmentShader: CROWD_FRAGMENT, fog: true });
  return { Material: Mat, Uniforms: U };
}

// Placards: a 4x4 atlas of slogans; per-instance 0 = cell, 1 = phase. Lit like the spectator holding it.
const SIGN_VERTEX = /* glsl */ `
attribute vec4 aClay;
attribute vec4 aCustom0;
attribute vec3 aLight;
uniform float uTime;
uniform float uHype;
uniform vec3 uCrowdAmbient;
varying vec3 vShade;
varying vec2 vAtlasUv;
#include <common>
#include <fog_pars_vertex>
void main() {
  float idx = floor(aCustom0.x + 0.5);
  vec2 cell = vec2(mod(idx, 4.0), floor(idx / 4.0));
  vAtlasUv = (cell + clamp(uv, 0.0, 1.0)) * 0.25;
  float t = floor(uTime * 12.0) / 12.0;
  float lift = 4.0 + 10.0 * uHype;
  vec3 transformed = position + vec3(0.0, abs(sin(t * 5.5 + aCustom0.y * 50.0)) * lift * 0.01, 0.0);
  vShade = pow(max(aClay.rgb, vec3(0.0001)), vec3(2.2)) * (aLight * 0.8 + uCrowdAmbient) * RECIPROCAL_PI;
  vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SIGN_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
varying vec3 vShade;
varying vec2 vAtlasUv;
#include <common>
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(texture2D(uAtlas, vAtlasUv).rgb * vShade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function MakeSign(): { Material: Material; Uniforms: Uniforms } {
  const U: Uniforms = { uHype: { value: 0.3 }, uAtlas: { value: null }, uTime: Shared.uTime, uCrowdAmbient: Shared.uCrowdAmbient, ...UniformsUtils.clone(UniformsLib.fog) };
  const Mat = new ShaderMaterial({ uniforms: U, vertexShader: SIGN_VERTEX, fragmentShader: SIGN_FRAGMENT, fog: true, side: DoubleSide });
  return { Material: Mat, Uniforms: U };
}

// Camera flashes: each little sphere is lit for one animation step now and then, more often as the crowd warms up.
const FLASH_VERTEX = /* glsl */ `
attribute vec4 aCustom0;
uniform float uTime;
uniform float uHype;
void main() {
  float t = floor(uTime * 12.0) / 12.0;
  float ph = fract(aCustom0.x * 91.7 + t * (0.05 + aCustom0.x * 0.06));
  float on = ph < (0.004 + 0.035 * uHype) ? 1.0 : 0.0;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position * on, 1.0);
}
`;

const FLASH_FRAGMENT = /* glsl */ `
#include <common>
void main() {
  gl_FragColor = vec4(9000.0, 8700.0, 7800.0, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function MakeFlash(): { Material: Material; Uniforms: Uniforms } {
  const U: Uniforms = { uHype: { value: 0.3 }, uTime: Shared.uTime };
  return { Material: new ShaderMaterial({ uniforms: U, vertexShader: FLASH_VERTEX, fragmentShader: FLASH_FRAGMENT }), Uniforms: U };
}

// Video walls. The picture is a linear scene capture (or a canvas); it is exposed and tone-mapped here
// the way a camera feed would be, then shown through an LED grid.
const SCREEN_VERTEX = /* glsl */ `
varying vec2 vScreenUv;
void main() {
  vScreenUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SCREEN_FRAGMENT = /* glsl */ `
uniform sampler2D uScreen;
uniform float uIntensity;
uniform float uLedGrid;
uniform float uExposure;
uniform float uLinearFeed;
uniform float uFlipV;
varying vec2 vScreenUv;
#include <common>
vec3 cpvFilmic(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  // A scene capture is stored bottom row first and in scene-referred light; a canvas is neither.
  vec3 picture = texture2D(uScreen, vec2(vScreenUv.x, mix(vScreenUv.y, 1.0 - vScreenUv.y, uFlipV))).rgb;
  if (uLinearFeed > 0.5) { picture = cpvFilmic(picture * uExposure); }
  vec2 cell = fract(vScreenUv * vec2(uLedGrid, uLedGrid * 0.5625)) - 0.5;
  float led = clamp(1.45 - dot(cell, cell) * 4.5, 0.0, 1.0);
  gl_FragColor = vec4(picture * uIntensity * led, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function MakeScreen(): { Material: Material; Uniforms: Uniforms } {
  const U: Uniforms = { uScreen: { value: null }, uIntensity: { value: 700 }, uLedGrid: { value: 140 }, uLinearFeed: { value: 0 }, uFlipV: { value: 0 }, uExposure: Shared.uExposure };
  return { Material: new ShaderMaterial({ uniforms: U, vertexShader: SCREEN_VERTEX, fragmentShader: SCREEN_FRAGMENT }), Uniforms: U };
}

const PARAMETER_NAMES: Record<string, string> = {
  Tint: 'uTint', Flash: 'uFlash', FlashColor: 'uFlashColor', Boil: 'uBoil', BoilRate: 'uBoilRate', DetailTiling: 'uDetailTiling',
  NormalStrength: 'uNormalStrength', Mottle: 'uMottle', Cavity: 'uCavity', RoughnessVariation: 'uRoughVar', Intensity: 'uIntensity',
  Hype: 'uHype', StepRate: 'uStepRate', Brightness: 'uBrightness', LedGrid: 'uLedGrid', Screen: 'uScreen', Atlas: 'uAtlas', LinearFeed: 'uLinearFeed', FlipV: 'uFlipV',
};

export type FMaterialName = 'M_Clay' | 'M_Glow' | 'M_Crowd' | 'M_Sign' | 'M_Flash' | 'M_Screen';

/** A material with its own parameter values, named after Unreal's class so the game code reads the same. */
export class UMaterialInstanceDynamic {
  readonly Material: Material;
  private readonly Uniforms: Uniforms;

  private constructor(readonly Base: FMaterialName, readonly bInstanced: boolean) {
    const Made =
      Base === 'M_Glow' ? MakeGlow(bInstanced)
      : Base === 'M_Crowd' ? MakeCrowd()
      : Base === 'M_Sign' ? MakeSign()
      : Base === 'M_Flash' ? MakeFlash()
      : Base === 'M_Screen' ? MakeScreen()
      : MakeClay(bInstanced);
    this.Material = Made.Material;
    this.Uniforms = Made.Uniforms;
  }

  /** Base is a material name or an Unreal path ("/Game/CPV/Materials/M_Clay.M_Clay"). */
  static Create(Base: string, bInstanced: boolean = false): UMaterialInstanceDynamic {
    const Name = Base.slice(Math.max(Base.lastIndexOf('.'), Base.lastIndexOf('/')) + 1) as FMaterialName;
    return new UMaterialInstanceDynamic(Name, bInstanced);
  }

  SetScalarParameterValue(Name: string, Value: number): void {
    const U = this.Uniforms[PARAMETER_NAMES[Name] ?? Name];
    if (U) { U.value = Value; }
  }
  SetVectorParameterValue(Name: string, Value: FLinearColor): void {
    const U = this.Uniforms[PARAMETER_NAMES[Name] ?? Name];
    if (U) { (U.value as Color).setRGB(Value.R, Value.G, Value.B); }
  }
  SetTextureParameterValue(Name: string, Value: Texture | null): void {
    const U = this.Uniforms[PARAMETER_NAMES[Name] ?? Name];
    if (U) { U.value = Value; }
  }
}

const Defaults = new Map<string, UMaterialInstanceDynamic>();

/** The shared, untinted instance of a material (what a mesh shows until the game gives it its own). */
export function DefaultMaterial(Base: string, bInstanced: boolean = false): UMaterialInstanceDynamic {
  const Key = `${Base}${bInstanced ? '+i' : ''}`;
  let Found = Defaults.get(Key);
  if (!Found) {
    Found = UMaterialInstanceDynamic.Create(Base, bInstanced);
    Defaults.set(Key, Found);
  }
  return Found;
}

/** Call once the textures are loaded. */
export function InitMaterials(): void {
  Shared.uClayNormal.value = Assets.ClayNormal;
  Shared.uClayDetail.value = Assets.ClayDetail;
}
