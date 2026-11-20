// The picture: one WebGL canvas, a camera placed in Unreal terms, and a short post chain of its own -
// shallow focus, bloom, vignette, grain, then the film tone curve. Radiance in the scene is in nits, as in
// the desktop game, and is exposed here for a fixed EV100 the way the Unreal post-process volume does it.

import {
  CustomToneMapping,
  DepthTexture,
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Texture,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  ShaderChunk,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

import { CM, ToCameraMatrix, VerticalFov } from './convert';
import { Shared } from './materials';
import { FRotator, FVector } from './ue';
import { LensSettings } from './world';

/** The show is lit like a TV studio and shot at a fixed exposure: EV100 8.6. */
const EV100 = 8.6;
/** Fine adjustment of the exposure, found by matching the mat and the crowd against frames of the desktop game. */
const EXPOSURE_TRIM = 1.12;
/**
 * The engine's bloom has no threshold: a little of everything spreads. Its settings add up to about 7% of
 * the light, but frames of the desktop game show more lift in the dark parts of the hall than that gives
 * (its fog and bounce light add their own haze), and this amount, spread evenly over the scales, matches them.
 */
const BLOOM_INTENSITY = 0.135;
/** Share of the bloom at each scale, tightest first (each stage is twice as wide as the one before). */
const BLOOM_WEIGHTS = [0.22, 0.18, 0.18, 0.16, 0.14, 0.08, 0.04];
/** The largest blur of an out-of-focus point, as a fraction of the picture's width (radius). */
const MAX_BLUR = 0.0065;
/**
 * The blur a 36 mm, f/3.2 lens gives by the textbook formula is about half of what frames of the desktop
 * game show behind the fighters; this makes up the difference.
 */
const FOCUS_GAIN = 2.2;

// Unreal's film tone mapping, as its colour grading step applies it (PostProcessCombineLUTs.usf and
// TonemapCommon.ush, with the engine's default curve: slope 0.88, toe 0.55, shoulder 0.26, white clip
// 0.04): widen bright saturated colours, the game's saturation and contrast, then the curve channel by
// channel in ACEScg. It keeps coloured lights coloured where three.js's ACES curve bleaches them, which is
// most of how the desktop picture gets its look. Left out: the reference transform's small "glow" and
// "red modifier" tweaks. Input is linear sRGB already multiplied by the exposure; output is linear sRGB 0..1.
const FILM_GLSL = /* glsl */ `
const mat3 CPV_SRGB_TO_AP1 = mat3(0.6130974, 0.0701937, 0.0206156, 0.3395231, 0.9163539, 0.1095698, 0.0473795, 0.0134524, 0.8698146);
const mat3 CPV_AP1_TO_SRGB = mat3(1.7050510, -0.1302564, -0.0240034, -0.6217921, 1.1408047, -0.1289690, -0.0832589, -0.0105483, 1.1529723);
const mat3 CPV_EXPAND = mat3(1.3704124, -0.0834335, -0.0257933, -0.3292922, 1.0970927, -0.0986258, -0.0636831, -0.0108614, 1.2036950);
const mat3 CPV_BLUE = mat3(0.9631836, 0.0, 0.0, 0.0, 0.8984765, 0.0, 0.0368164, 0.1015235, 1.0);
const mat3 CPV_BLUE_INV = mat3(1.0392249, 0.0, 0.0, 0.0, 1.1221981, 0.0, -0.0392226, -0.1222006, 1.0);
const vec3 CPV_AP1_Y = vec3(0.2722287, 0.6740818, 0.0536895);
vec3 cpvFilmCurve(vec3 x) {
  vec3 L = log(max(x, vec3(1e-7))) * 0.4342944819;
  vec3 straight = 0.88 * (L + 0.9016409);
  vec3 toe = 0.9 / (1.0 + exp(-3.9111111 * (L + 0.3902772)));
  vec3 shoulder = 1.04 - 1.56 / (1.0 + exp(2.2564103 * (L + 0.6061863)));
  toe = mix(straight, toe, step(L, vec3(-0.3902772)));
  shoulder = mix(straight, shoulder, step(vec3(-0.6061863), L));
  vec3 t = 1.0 - clamp((L + 0.3902772) / -0.2159091, 0.0, 1.0);
  t = (3.0 - 2.0 * t) * t * t;
  return mix(toe, shoulder, t);
}
vec3 cpvFilm(vec3 color) {
  vec3 c = CPV_SRGB_TO_AP1 * max(color, vec3(0.0));
  float luma = dot(c, CPV_AP1_Y);
  vec3 chroma = c / max(luma, 1e-6);
  float spread = dot(chroma - 1.0, chroma - 1.0);
  c = mix(c, CPV_EXPAND * c, (1.0 - exp2(-4.0 * spread)) * (1.0 - exp2(-4.0 * luma * luma)));
  c = max(vec3(0.0), mix(vec3(dot(c, CPV_AP1_Y)), c, 1.08));
  c = pow(c * (1.0 / 0.18), vec3(1.04)) * 0.18;
  c = max(CPV_BLUE * c, vec3(0.0));
  c = mix(vec3(dot(c, CPV_AP1_Y)), c, 0.96);
  c = cpvFilmCurve(c);
  c = max(mix(vec3(dot(c, CPV_AP1_Y)), c, 0.93), vec3(0.0));
  return clamp(CPV_AP1_TO_SRGB * (CPV_BLUE_INV * c), 0.0, 1.0);
}
`;

// three.js leaves one tone mapping slot for the application; every material and pass that tone-maps goes through it.
ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace(
  'vec3 CustomToneMapping( vec3 color ) { return color; }',
  `${FILM_GLSL}\nvec3 CustomToneMapping( vec3 color ) { return cpvFilm( color * toneMappingExposure ); }`,
);

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

// Bloom is a small pyramid: the picture is averaged down seven times (the first step straight to a
// quarter of its size) and added back up, each level with its share. Every pass is tiny.
const BLOOM_DOWN_SHADER = {
  uniforms: { tSource: { value: null as Texture | null }, uTexel: { value: new Vector2() }, uCeiling: { value: 1e9 } },
  vertexShader: QUAD_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSource;
    uniform vec2 uTexel;
    uniform float uCeiling;
    varying vec2 vUv;
    void main() {
      // Four bilinear taps: a 4x4 box of the source. The ceiling keeps a few very hot pixels (camera
      // flashes, LED lettering) from turning into flickering blobs.
      vec3 a = min(texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb, vec3(uCeiling));
      vec3 b = min(texture2D(tSource, vUv + uTexel * vec2(1.0, -1.0)).rgb, vec3(uCeiling));
      vec3 c = min(texture2D(tSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb, vec3(uCeiling));
      vec3 d = min(texture2D(tSource, vUv + uTexel * vec2(1.0, 1.0)).rgb, vec3(uCeiling));
      gl_FragColor = vec4((a + b + c + d) * 0.25, 1.0);
    }`,
};

const BLOOM_UP_SHADER = {
  uniforms: {
    tLevel: { value: null as Texture | null }, tBelow: { value: null as Texture | null }, uTexel: { value: new Vector2() },
    uLevel: { value: 1 }, uBelow: { value: 1 },
  },
  vertexShader: QUAD_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tLevel;
    uniform sampler2D tBelow;
    uniform vec2 uTexel;
    uniform float uLevel;
    uniform float uBelow;
    varying vec2 vUv;
    void main() {
      vec3 wide = texture2D(tBelow, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tBelow, vUv + uTexel * vec2(0.5, -0.5)).rgb
        + texture2D(tBelow, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tBelow, vUv + uTexel * vec2(0.5, 0.5)).rgb;
      gl_FragColor = vec4(texture2D(tLevel, vUv).rgb * uLevel + wide * (0.25 * uBelow), 1.0);
    }`,
};

// The last pass: what the lens and the film do. Shallow focus first (the desktop camera is a 36 mm sensor
// at f/3.2 focused on the action, which is what makes the arena read as a miniature set), then bloom,
// vignette and grain on the light itself, as in the engine, and finally the picture is developed and
// encoded for the screen.
const LENS_SHADER = {
  uniforms: {
    tScene: { value: null as Texture | null },
    tDepth: { value: null as Texture | null },
    tSoft: { value: null as Texture | null },
    tBloom: { value: null as Texture | null },
    uTexel: { value: new Vector2() },
    uBloomTexel: { value: new Vector2() },
    uTime: { value: 0 },
    uExposure: { value: 1 },
    uBloom: { value: BLOOM_INTENSITY },
    uVignette: { value: 0.45 },
    uGrain: { value: 0.12 },
    uAspect: { value: 9 / 16 },
    uNear: { value: 0.25 },
    uFar: { value: 260 },
    uFocus: { value: 9 },      // metres
    uBlur: { value: 0 },       // radius in pixels of a point infinitely far behind the focus; 0 = everything sharp
    uMaxBlur: { value: 6 },
  },
  vertexShader: QUAD_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tScene;
    uniform sampler2D tDepth;
    uniform sampler2D tSoft;
    uniform sampler2D tBloom;
    uniform vec2 uTexel;
    uniform vec2 uBloomTexel;
    uniform float uTime;
    uniform float uExposure;
    uniform float uBloom;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAspect;
    uniform float uNear;
    uniform float uFar;
    uniform float uFocus;
    uniform float uBlur;
    uniform float uMaxBlur;
    varying vec2 vUv;
    ${FILM_GLSL}
    #ifdef CPV_FOCUS
    const vec2 TAPS[12] = vec2[12](
      vec2(0.38, 0.16), vec2(-0.16, 0.38), vec2(-0.38, -0.16), vec2(0.16, -0.38),
      vec2(0.92, 0.38), vec2(0.38, 0.92), vec2(-0.38, 0.92), vec2(-0.92, 0.38),
      vec2(-0.92, -0.38), vec2(-0.38, -0.92), vec2(0.38, -0.92), vec2(0.92, -0.38));
    float cpvDistance(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      return (uNear * uFar) / (uFar - d * (uFar - uNear));
    }
    // Blur radius in pixels of a point this far from the lens.
    float cpvBlur(float z) { return min(uBlur * abs(z - uFocus) / z, uMaxBlur); }
    vec3 cpvFocus(vec2 uv) {
      vec3 sharp = texture2D(tScene, uv).rgb;
      float z0 = cpvDistance(uv);
      float r0 = cpvBlur(z0);
      if (r0 < 0.6) { return sharp; }
      // The blurred picture is gathered from the quarter-size copy the bloom already made: each tap is
      // itself an average, so a dozen cover the disc without speckle.
      float turn = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      mat2 spin = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
      vec3 sum = texture2D(tSoft, uv).rgb;
      float total = 1.0;
      for (int i = 0; i < 12; i++) {
        vec2 at = uv + spin * TAPS[i] * r0 * uTexel;
        float zi = cpvDistance(at);
        // Something nearer and in focus keeps its edge: it only joins the blur as far as it is blurred itself.
        float w = zi >= z0 ? 1.0 : clamp(cpvBlur(zi) / r0, 0.0, 1.0);
        sum += texture2D(tSoft, at).rgb * w;
        total += w;
      }
      return mix(sharp, sum / total, smoothstep(0.6, 3.0, r0));
    }
    #endif
    void main() {
      #ifdef CPV_FOCUS
      vec3 c = cpvFocus(vUv);
      #else
      vec3 c = texture2D(tScene, vUv).rgb;
      #endif
      vec3 glow = texture2D(tBloom, vUv + uBloomTexel * vec2(-0.5, -0.5)).rgb + texture2D(tBloom, vUv + uBloomTexel * vec2(0.5, -0.5)).rgb
        + texture2D(tBloom, vUv + uBloomTexel * vec2(-0.5, 0.5)).rgb + texture2D(tBloom, vUv + uBloomTexel * vec2(0.5, 0.5)).rgb;
      c = (c + glow * (0.25 * uBloom)) * uExposure;
      // Cosine-fourth falloff, scaled so the corners darken the same at any aspect ratio.
      vec2 p = (vUv * 2.0 - 1.0) * vec2(1.0, uAspect) * (1.41421356 / sqrt(1.0 + uAspect * uAspect)) * uVignette;
      float lens = 1.0 / (dot(p, p) + 1.0);
      c *= lens * lens;
      float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 311.7, vec2(12.9898, 78.233))) * 43758.5453);
      c *= 1.0 + (n - 0.5) * uGrain;
      c = cpvFilm(c);
      gl_FragColor = vec4(mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)), 1.0);
    }`,
};

// What a broadcast camera records: the linear scene capture exposed at the studio's fixed EV100 (the light
// moods' exposure bias belongs to the main camera only), developed, and written to an 8-bit sRGB target.
const DEVELOP_SHADER = {
  uniforms: { tHdr: { value: null as Texture | null }, uExposure: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tHdr;
    uniform float uExposure;
    varying vec2 vUv;
    ${FILM_GLSL}
    void main() {
      gl_FragColor = vec4(cpvFilm(texture2D(tHdr, vUv).rgb * uExposure), 1.0);
    }`,
};

// A captured frame shown flat on the screen (instant replay). A linear capture is exposed and developed
// like the live picture; one made by CaptureDisplay is already a finished picture and is shown as it is.
const PICTURE_SHADER = {
  uniforms: { uPicture: { value: null as Texture | null }, uExposure: { value: 1 }, uDisplayReferred: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uPicture;
    uniform float uExposure;
    uniform float uDisplayReferred;
    varying vec2 vUv;
    ${FILM_GLSL}
    void main() {
      vec3 c = texture2D(uPicture, vUv).rgb;
      if (uDisplayReferred < 0.5) { c = cpvFilm(c * uExposure); }
      gl_FragColor = vec4(mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)), 1.0);
    }`,
};

export interface FPictureSettings {
  /** Fraction of the canvas's device pixels actually rendered. */
  Scale: number;
  /** 0 off, 1 low, 2 medium, 3 high. */
  Shadows: number;
  /** Bloom, vignette and grain (and shallow focus, if that is on too). Off: the scene goes straight to the screen. */
  bPost: boolean;
  /** MSAA samples: 0, 2 or 4. */
  Antialias: number;
  /** 0..3: how much of the lighting rig is evaluated (the arena reads this). */
  Lighting: number;
  /** 0..3: crowd density and particle counts (the arena and effects read this). */
  Effects: number;
  /** 0..3: texture filtering and clay surface detail. */
  Textures: number;
  /** Refreshes per second of the arena's video screens; 0 turns the live feed off. */
  FeedHz: number;
  /** The camera's shallow focus (needs bPost). */
  bDepthOfField: boolean;
}

function QuadMaterial(Shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }, Defines?: Record<string, string>): ShaderMaterial {
  const Uniforms: Record<string, { value: unknown }> = {};
  for (const [Name, U] of Object.entries(Shader.uniforms)) { Uniforms[Name] = { value: U.value instanceof Vector2 ? U.value.clone() : U.value }; }
  return new ShaderMaterial({
    uniforms: Uniforms, vertexShader: Shader.vertexShader, fragmentShader: Shader.fragmentShader, defines: Defines ?? {},
    depthTest: false, depthWrite: false, toneMapped: false,
  });
}

export class FRenderer {
  readonly GL: WebGLRenderer;
  readonly Camera = new PerspectiveCamera(40, 16 / 9, 0.25, 260);
  readonly Settings: FPictureSettings = {
    Scale: 1, Shadows: 3, bPost: true, Antialias: 4, Lighting: 3, Effects: 3, Textures: 3, FeedHz: 8, bDepthOfField: true,
  };
  /** Goes up every time Apply() is called, so the arena and effects can notice a change of settings. */
  SettingsVersion = 0;
  /** Exposure compensation in stops (the arena's light moods drive it). */
  ExposureBias = 0;
  Width = 1280;
  Height = 720;
  private Scene: Scene;
  private BuiltFor = '';
  private FovDeg = 40;
  private SceneTarget: WebGLRenderTarget | null = null;
  private Down: WebGLRenderTarget[] = [];
  private Up: WebGLRenderTarget[] = [];
  private Quad = new FullScreenQuad();
  private DownMaterial = QuadMaterial(BLOOM_DOWN_SHADER);
  private UpMaterial = QuadMaterial(BLOOM_UP_SHADER);
  private LensMaterial: ShaderMaterial | null = null;
  private FeedCamera = new PerspectiveCamera(40, 16 / 9, 0.25, 260);
  private Pictures: Array<{ Texture: Texture; X0: number; Y0: number; X1: number; Y1: number }> = [];
  private PictureScene = new Scene();
  private PictureCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private PictureMaterial = new ShaderMaterial({ ...PICTURE_SHADER, depthTest: false, depthWrite: false, toneMapped: false });
  private FeedHdr: WebGLRenderTarget | null = null;
  private Develop = new FullScreenQuad(new ShaderMaterial({ ...DEVELOP_SHADER, depthTest: false, depthWrite: false, toneMapped: false }));

  constructor(readonly Canvas: HTMLCanvasElement, InScene: Scene) {
    this.Scene = InScene;
    this.GL = new WebGLRenderer({ canvas: Canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    this.GL.outputColorSpace = SRGBColorSpace;
    this.GL.toneMapping = CustomToneMapping;
    this.GL.shadowMap.enabled = true;
    this.GL.shadowMap.type = PCFShadowMap;
    this.GL.shadowMap.autoUpdate = false;
    this.GL.setClearColor(0x000000, 1);
    this.Camera.matrixAutoUpdate = false;
    this.FeedCamera.matrixAutoUpdate = false;
    const Quad = new Mesh(new PlaneGeometry(2, 2), this.PictureMaterial);
    Quad.frustumCulled = false;
    this.PictureScene.add(Quad);
  }

  /** Device pixels per CSS pixel after the render scale, capped so 4K-and-up displays stay playable. */
  PixelRatio(): number {
    const Native = Math.min(window.devicePixelRatio || 1, 2);
    const MaxLines = 1620;
    const Fit = Math.min(1, MaxLines / Math.max(1, this.Height * Native));
    return Math.max(0.3, Native * Fit * this.Settings.Scale);
  }

  Resize(Width: number, Height: number): void {
    this.Width = Math.max(1, Math.floor(Width));
    this.Height = Math.max(1, Math.floor(Height));
    this.Camera.aspect = this.Width / this.Height;
    this.BuiltFor = '';
  }

  /** Call after changing Settings. */
  Apply(): void {
    this.BuiltFor = '';
    ++this.SettingsVersion;
    // Texture detail: how well the clay's thumbprints hold up at a glancing angle.
    const Sharpness = Math.min([1, 2, 4, 8][Math.max(0, Math.min(3, Math.round(this.Settings.Textures)))], this.GL.capabilities.getMaxAnisotropy());
    for (const Texture of [Shared.uClayNormal.value, Shared.uClayDetail.value]) {
      if (Texture && Texture.anisotropy !== Sharpness) {
        Texture.anisotropy = Sharpness;
        Texture.needsUpdate = true;
      }
    }
  }

  /** The post chain and the camera feeds keep the scene's light in floating point; a few old devices cannot. */
  CanRenderFloat(): boolean {
    return this.GL.extensions.has('EXT_color_buffer_float') || this.GL.extensions.has('EXT_color_buffer_half_float');
  }

  private Build(): void {
    const Ratio = this.PixelRatio();
    const S = this.Settings;
    const Key = `${this.Width}x${this.Height}@${Ratio.toFixed(3)}/${S.bPost}/${S.Antialias}/${S.Shadows}/${S.bDepthOfField}`;
    if (Key === this.BuiltFor) { return; }
    this.BuiltFor = Key;
    this.GL.setPixelRatio(Ratio);
    this.GL.setSize(this.Width, this.Height, false);
    this.GL.shadowMap.enabled = S.Shadows > 0;
    this.SceneTarget?.depthTexture?.dispose();
    this.SceneTarget?.dispose();
    for (const Target of [...this.Down, ...this.Up]) { Target.dispose(); }
    this.LensMaterial?.dispose();
    this.SceneTarget = null;
    this.Down = [];
    this.Up = [];
    this.LensMaterial = null;
    if (!S.bPost || !this.CanRenderFloat()) { return; }
    const W = Math.max(8, Math.floor(this.Width * Ratio)), H = Math.max(8, Math.floor(this.Height * Ratio));
    this.SceneTarget = new WebGLRenderTarget(W, H, { type: HalfFloatType, samples: S.Antialias });
    if (S.bDepthOfField) { this.SceneTarget.depthTexture = new DepthTexture(W, H); }
    let LW = Math.max(2, Math.round(W / 4)), LH = Math.max(2, Math.round(H / 4));
    for (let i = 0; i < BLOOM_WEIGHTS.length; ++i) {
      this.Down.push(new WebGLRenderTarget(LW, LH, { type: HalfFloatType, depthBuffer: false }));
      if (i < BLOOM_WEIGHTS.length - 1) { this.Up.push(new WebGLRenderTarget(LW, LH, { type: HalfFloatType, depthBuffer: false })); }
      LW = Math.max(2, Math.round(LW / 2));
      LH = Math.max(2, Math.round(LH / 2));
    }
    this.LensMaterial = QuadMaterial(LENS_SHADER, S.bDepthOfField ? { CPV_FOCUS: '' } : {});
  }

  /** Scene-referred nits to display: 1 / (1.2 * 2^EV100), opened up by the bias. */
  Exposure(): number {
    return (Math.pow(2, this.ExposureBias) / (1.2 * Math.pow(2, EV100))) * EXPOSURE_TRIM;
  }

  /** Places the camera the way Unreal does: location in cm, rotator, horizontal field of view. */
  SetView(Location: FVector, Rotation: FRotator, FovDeg: number): void {
    ToCameraMatrix(Location, Rotation, this.Camera.matrix);
    this.Camera.matrixWorldNeedsUpdate = true;
    this.Camera.fov = VerticalFov(FovDeg, this.Camera.aspect);
    this.Camera.updateProjectionMatrix();
    this.FovDeg = FovDeg;
  }

  private Pass(Material: ShaderMaterial, Target: WebGLRenderTarget | null): void {
    this.Quad.material = Material;
    this.GL.setRenderTarget(Target);
    this.Quad.render(this.GL);
  }

  Render(TimeSeconds: number): void {
    this.Build();
    const Exposure = this.Exposure();
    this.GL.toneMappingExposure = Exposure;
    Shared.uExposure.value = Exposure;
    this.GL.shadowMap.needsUpdate = true;
    const Target = this.SceneTarget;
    const Lens = this.LensMaterial;
    if (Target && Lens) {
      this.GL.setRenderTarget(Target);
      this.GL.render(this.Scene, this.Camera);
      // Bloom: down the pyramid...
      const Down = this.DownMaterial.uniforms, Up = this.UpMaterial.uniforms;
      let Source: WebGLRenderTarget = Target;
      for (let i = 0; i < this.Down.length; ++i) {
        Down.tSource.value = Source.texture;
        (Down.uTexel.value as Vector2).set(1 / Source.width, 1 / Source.height);
        Down.uCeiling.value = i === 0 ? 6 / Exposure : 1e9;
        this.Pass(this.DownMaterial, this.Down[i]);
        Source = this.Down[i];
      }
      // ...and back up, each level adding its share.
      const Last = this.Down.length - 1;
      for (let i = Last - 1; i >= 0; --i) {
        const Below = i === Last - 1 ? this.Down[Last] : this.Up[i + 1];
        Up.tLevel.value = this.Down[i].texture;
        Up.tBelow.value = Below.texture;
        (Up.uTexel.value as Vector2).set(1 / Below.width, 1 / Below.height);
        Up.uLevel.value = BLOOM_WEIGHTS[i];
        Up.uBelow.value = i === Last - 1 ? BLOOM_WEIGHTS[Last] : 1;
        this.Pass(this.UpMaterial, this.Up[i]);
      }
      const U = Lens.uniforms;
      U.tScene.value = Target.texture;
      U.tDepth.value = Target.depthTexture;
      U.tSoft.value = this.Down[0].texture;
      U.tBloom.value = this.Up[0].texture;
      (U.uTexel.value as Vector2).set(1 / Target.width, 1 / Target.height);
      (U.uBloomTexel.value as Vector2).set(1 / this.Up[0].width, 1 / this.Up[0].height);
      U.uTime.value = TimeSeconds;
      U.uExposure.value = Exposure;
      U.uAspect.value = this.Height / this.Width;
      U.uNear.value = this.Camera.near;
      U.uFar.value = this.Camera.far;
      // Circle of confusion of a real lens: focal length from the field of view and the sensor width,
      // aperture from the f-stop. uBlur is the blur radius, in pixels, of a point infinitely far away.
      const Focus = LensSettings.DepthOfFieldFocalDistance * CM;
      if (Focus > 0.1 && LensSettings.DepthOfFieldFstop > 0) {
        const Sensor = LensSettings.DepthOfFieldSensorWidth / 1000;
        const Focal = Sensor / 2 / Math.tan((this.FovDeg * Math.PI) / 360);
        const Circle = (Focal * Focal) / (LensSettings.DepthOfFieldFstop * Math.max(Focus - Focal, 0.01));
        U.uFocus.value = Focus;
        U.uBlur.value = 0.5 * (Circle / Sensor) * Target.width * FOCUS_GAIN;
      } else {
        U.uBlur.value = 0;
      }
      U.uMaxBlur.value = MAX_BLUR * Target.width;
      this.Pass(Lens, null);
    } else {
      this.GL.setRenderTarget(null);
      this.GL.render(this.Scene, this.Camera);
    }
    if (this.Pictures.length > 0) {
      const Ratio = this.PixelRatio();
      const W = this.Width * Ratio, H = this.Height * Ratio;
      const AutoClear = this.GL.autoClear;
      this.GL.autoClear = false;
      this.GL.setRenderTarget(null);
      for (const P of this.Pictures) {
        this.PictureMaterial.uniforms.uPicture.value = P.Texture;
        this.PictureMaterial.uniforms.uExposure.value = Exposure;
        this.PictureMaterial.uniforms.uDisplayReferred.value = P.Texture.userData.bDisplayReferred ? 1 : 0;
        // Viewport in device pixels, measured from the bottom left.
        this.GL.setViewport((P.X0 * W) / Ratio, ((1 - P.Y1) * H) / Ratio, ((P.X1 - P.X0) * W) / Ratio, ((P.Y1 - P.Y0) * H) / Ratio);
        this.GL.render(this.PictureScene, this.PictureCamera);
      }
      this.GL.setViewport(0, 0, this.Width, this.Height);
      this.GL.autoClear = AutoClear;
      this.Pictures.length = 0;
    }
  }

  /**
   * Shows a captured frame over the scene for this frame only (the HUD calls it while a replay runs).
   * Coordinates are fractions of the picture, from the top left.
   */
  DrawPicture(Picture: Texture | null, X0: number, Y0: number, X1: number, Y1: number): void {
    if (Picture) { this.Pictures.push({ Texture: Picture, X0, Y0, X1, Y1 }); }
  }

  /** Renders the scene from another camera into a texture (the scoreboard feed and the replay tape). */
  Capture(Target: WebGLRenderTarget, Location: FVector, Rotation: FRotator, FovDeg: number): void {
    ToCameraMatrix(Location, Rotation, this.FeedCamera.matrix);
    this.FeedCamera.matrixWorldNeedsUpdate = true;
    this.FeedCamera.aspect = Target.width / Target.height;
    this.FeedCamera.fov = VerticalFov(FovDeg, this.FeedCamera.aspect);
    this.FeedCamera.updateProjectionMatrix();
    const Before = this.GL.getRenderTarget();
    this.GL.setRenderTarget(Target);
    this.GL.render(this.Scene, this.FeedCamera);
    this.GL.setRenderTarget(Before);
  }

  /** A target for CaptureDisplay: an 8-bit sRGB picture with no depth of its own. */
  MakeDisplayTarget(Width: number, Height: number): WebGLRenderTarget {
    const Target = new WebGLRenderTarget(Width, Height, { colorSpace: SRGBColorSpace, depthBuffer: false });
    Target.texture.userData.bDisplayReferred = true;
    return Target;
  }

  /**
   * Films the scene the way the arena's cameras do: a finished, tone-mapped picture at the studio's fixed
   * exposure, stored in Target (from MakeDisplayTarget). Screens and the replay show it without further
   * processing, and because the scene is rendered into a buffer of its own first, a screen that is in
   * shot may go on showing the previous picture.
   */
  CaptureDisplay(Target: WebGLRenderTarget, Location: FVector, Rotation: FRotator, FovDeg: number): void {
    if (!this.CanRenderFloat()) { return; }
    if (!this.FeedHdr || this.FeedHdr.width !== Target.width || this.FeedHdr.height !== Target.height) {
      this.FeedHdr?.dispose();
      this.FeedHdr = new WebGLRenderTarget(Target.width, Target.height, { type: HalfFloatType });
    }
    this.Capture(this.FeedHdr, Location, Rotation, FovDeg);
    const Material = this.Develop.material as ShaderMaterial;
    Material.uniforms.tHdr.value = this.FeedHdr.texture;
    Material.uniforms.uExposure.value = EXPOSURE_TRIM / (1.2 * Math.pow(2, EV100));
    const Before = this.GL.getRenderTarget();
    this.GL.setRenderTarget(Target);
    this.Develop.render(this.GL);
    this.GL.setRenderTarget(Before);
  }
}

/** The one renderer. Set by main.ts. */
export let GRenderer: FRenderer;
export function SetRenderer(Renderer: FRenderer): void { GRenderer = Renderer; }
