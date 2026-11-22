import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { ART_STYLES, ArtStyleId } from '../data/balance';
import { getShadowMapSize, GraphicsSettings } from './graphicsSettings';

export interface RenderPerfStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  renderScale: number;
  width: number;
  height: number;
  postProcessing: boolean;
}

const TacticalGradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSaturation: { value: 1.06 },
    uContrast: { value: 1.08 },
    uWarmth: { value: 0.025 },
    uDesaturate: { value: 0.0 },
    uVignette: { value: 0.18 },
    uDamageFlash: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uWarmth;
    uniform float uDesaturate;
    uniform float uVignette;
    uniform float uDamageFlash;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 col = texel.rgb;

      // Subtle split-tone temperature shift in linear HDR space
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadows = vec3(1.0 - uWarmth * 0.6, 1.0, 1.0 + uWarmth);
      vec3 highlights = vec3(1.0 + uWarmth, 1.0 + uWarmth * 0.35, 1.0 - uWarmth * 0.7);
      col *= mix(shadows, highlights, smoothstep(0.05, 0.75, luma));

      // Saturation + noir support
      float sat = mix(uSaturation, 0.0, uDesaturate);
      col = mix(vec3(luma), col, sat);

      // Gentle contrast pivot around linear mid-grey (0.18)
      vec3 pivot = vec3(0.18);
      col = max(vec3(0.0), (col - pivot) * uContrast + pivot);

      // Clean optical vignette
      vec2 centered = vUv * 2.0 - 1.0;
      float dist = dot(centered, centered);
      float vig = clamp(1.0 - dist * uVignette, 0.25, 1.0);
      col *= vig;

      // Radial hit damage tint
      if (uDamageFlash > 0.001) {
        float edge = smoothstep(0.35, 1.35, dist) * uDamageFlash;
        col = mix(col, vec3(0.85, 0.06, 0.04), clamp(edge * 0.72, 0.0, 0.75));
      }

      gl_FragColor = vec4(col, texel.a);
    }
  `,
};

export class RenderPipeline {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloomPass: UnrealBloomPass;
  private gradePass: ShaderPass;
  private outputPass: OutputPass;
  private fxaaPass: ShaderPass;
  private smaaPass: SMAAPass;

  private settings: GraphicsSettings;
  private artStyle: ArtStyleId = 'clean';
  private shadowLights: THREE.DirectionalLight[] = [];
  private width = 1280;
  private height = 720;
  private lastShadowSize = -1;
  private lastRenderTimeMs = 0;

  private emaFps = 60;
  private emaFrameMs = 16.6;
  private damageFlash = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    initialSettings: GraphicsSettings,
    initialArtStyle: ArtStyleId,
    width = window.innerWidth,
    height = window.innerHeight,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.settings = { ...initialSettings };
    this.artStyle = initialArtStyle;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);

    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const effDpr = this.computeEffectivePixelRatio();
    const rtW = Math.max(1, Math.floor(this.width * effDpr));
    const rtH = Math.max(1, Math.floor(this.height * effDpr));
    const renderTarget = new THREE.WebGLRenderTarget(rtW, rtH, {
      type: THREE.HalfFloatType,
      samples: 0,
    });

    this.composer = new EffectComposer(this.renderer, renderTarget);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      0.18, // Restrained AAA strength — prevents glowing plastic haze
      0.32,
      0.90, // Only true emissives / specular hotspots bloom
    );
    this.gradePass = new ShaderPass(TacticalGradeShader);
    this.outputPass = new OutputPass();
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.smaaPass = new SMAAPass(rtW, rtH);

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.fxaaPass);
    this.composer.addPass(this.smaaPass);

    this.applySettings(this.settings, this.artStyle);
  }

  public registerShadowLight(light: THREE.DirectionalLight): void {
    if (!this.shadowLights.includes(light)) {
      this.shadowLights.push(light);
      this.syncShadowLight(light, getShadowMapSize(this.settings.shadowQuality), true);
    }
  }

  private computeEffectivePixelRatio(): number {
    const style = ART_STYLES.find((s) => s.id === this.artStyle);
    const styleScale = style ? style.pixelScale : 1;
    const baseDpr = Math.min(window.devicePixelRatio || 1, 1.75);
    return Math.max(0.32, Math.min(2.15, baseDpr * this.settings.renderScale * styleScale));
  }

  private syncShadowLight(light: THREE.DirectionalLight, size: number, forceReset: boolean): void {
    if (size <= 0) {
      light.castShadow = false;
      return;
    }
    light.castShadow = true;
    if (forceReset || light.shadow.mapSize.x !== size || light.shadow.mapSize.y !== size) {
      light.shadow.mapSize.set(size, size);
      light.shadow.bias = -0.00045;
      light.shadow.normalBias = 0.025;
      if (light.shadow.map) {
        light.shadow.map.dispose();
        light.shadow.map = null;
      }
      light.shadow.needsUpdate = true;
    }
  }

  public applySettings(settings: GraphicsSettings, artStyle: ArtStyleId): void {
    this.settings = { ...settings };
    this.artStyle = artStyle;

    // 1. Resolution / pixel ratio
    const effDpr = this.computeEffectivePixelRatio();
    this.renderer.setPixelRatio(effDpr);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(effDpr);
    this.composer.setSize(this.width, this.height);

    const effW = Math.max(1, Math.floor(this.width * effDpr));
    const effH = Math.max(1, Math.floor(this.height * effDpr));
    this.fxaaPass.uniforms['resolution'].value.set(1 / effW, 1 / effH);
    this.smaaPass.setSize(effW, effH);

    // 2. Shadow quality
    const shadowSize = getShadowMapSize(this.settings.shadowQuality);
    const sizeChanged = shadowSize !== this.lastShadowSize;
    this.lastShadowSize = shadowSize;
    this.renderer.shadowMap.enabled = shadowSize > 0;
    for (const light of this.shadowLights) {
      this.syncShadowLight(light, shadowSize, sizeChanged);
    }

    // 3. View distance & fog calibration (keep far >= 250 so 210m skydome stays visible)
    this.camera.far = Math.max(250, this.settings.viewDistance * 2.0);
    this.camera.updateProjectionMatrix();
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = Math.max(18, this.settings.viewDistance * 0.34);
      this.scene.fog.far = Math.max(75, this.settings.viewDistance * 1.15);
    }

    // 4. Post-processing & grading toggles
    const pp = this.settings.postProcessing;
    this.bloomPass.enabled = pp && this.settings.bloom;
    this.gradePass.enabled = pp && this.settings.colorGrading;
    this.outputPass.enabled = pp;
    this.fxaaPass.enabled = pp && this.settings.antiAliasing === 'fxaa';
    this.smaaPass.enabled = pp && this.settings.antiAliasing === 'smaa';

    this.applyGradingForStyle(artStyle);
  }

  private applyGradingForStyle(artStyle: ArtStyleId): void {
    const u = this.gradePass.uniforms;
    const styleDef = ART_STYLES.find((s) => s.id === artStyle);
    let sat = 1.07;
    let con = 1.07;
    let warmth = 0.024;
    let desat = 0.0;
    let vig = styleDef ? styleDef.vignette * 0.65 : 0.16;
    let exposure = 1.04;

    if (artStyle === 'noir') {
      desat = 1.0;
      con = 1.28;
      exposure = 0.98;
    } else if (artStyle === 'comic') {
      sat = 1.32;
      con = 1.22;
      warmth = 0.04;
    } else if (artStyle === 'crt' || artStyle === 'pixel' || artStyle === 'psx') {
      sat = 1.12;
      con = 1.12;
      warmth = 0.015;
    } else if (artStyle === 'matrix' || artStyle === 'vapor') {
      sat = 1.25;
      con = 1.14;
      warmth = -0.025;
    }

    u['uSaturation'].value = sat;
    u['uContrast'].value = con;
    u['uWarmth'].value = warmth;
    u['uDesaturate'].value = desat;
    u['uVignette'].value = vig;
    this.renderer.toneMappingExposure = exposure;
  }

  public triggerDamageFlash(intensity = 0.75): void {
    this.damageFlash = Math.min(1.0, Math.max(this.damageFlash, intensity));
  }

  public resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.applySettings(this.settings, this.artStyle);
  }

  public shouldRenderFrame(nowMs: number): boolean {
    if (this.settings.fpsCap <= 0) {
      this.lastRenderTimeMs = nowMs;
      return true;
    }
    const minIntervalMs = 1000 / this.settings.fpsCap;
    if (nowMs - this.lastRenderTimeMs + 0.4 >= minIntervalMs) {
      this.lastRenderTimeMs = nowMs;
      return true;
    }
    return false;
  }

  public render(dtSec: number): void {
    const startMs = performance.now();

    if (this.damageFlash > 0.001) {
      this.damageFlash = Math.max(0, this.damageFlash - dtSec * 3.2);
    }
    this.gradePass.uniforms['uDamageFlash'].value = this.damageFlash;

    if (this.settings.postProcessing) {
      this.composer.render(dtSec);
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    const renderMs = Math.max(0.01, performance.now() - startMs);
    const clampedDt = Math.max(0.001, Math.min(0.25, dtSec));
    const instFps = 1 / clampedDt;
    this.emaFps = this.emaFps * 0.9 + instFps * 0.1;
    this.emaFrameMs = this.emaFrameMs * 0.9 + renderMs * 0.1;
  }

  public getPerfStats(): RenderPerfStats {
    const effDpr = this.computeEffectivePixelRatio();
    return {
      fps: Math.round(this.emaFps),
      frameMs: Number(this.emaFrameMs.toFixed(2)),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      renderScale: this.settings.renderScale,
      width: Math.floor(this.width * effDpr),
      height: Math.floor(this.height * effDpr),
      postProcessing: this.settings.postProcessing,
    };
  }

  public dispose(): void {
    this.bloomPass.dispose();
    this.gradePass.dispose();
    this.fxaaPass.dispose();
    this.outputPass.dispose();
    this.smaaPass.edgesRT.dispose();
    this.smaaPass.weightsRT.dispose();
    this.smaaPass.areaTexture.dispose();
    this.smaaPass.searchTexture.dispose();
    this.smaaPass.materialEdges.dispose();
    this.smaaPass.materialWeights.dispose();
    this.smaaPass.materialBlend.dispose();
    this.composer.dispose();
    this.shadowLights.length = 0;
  }
}
