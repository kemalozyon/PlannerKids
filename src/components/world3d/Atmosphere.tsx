// Gökyüzü, sis, güneş ve ortam ışığı (oda görünümü, Bahçem ve gezinti). Gün evresi değişince renkler, ışık gücü ve
// güneşin yönü ~2 sn'de yumuşakça geçer. Gökyüzü sahnenin içinde çizilir (kuşbakışında ekran boyu gradyan doku,
// gezintide kubbe) — böylece sis ufukta gökyüzüne erir ve son işlem (bloom/AO) saydam tuvalle bozulmaz. Habbo gibi
// oda görünümünde (`backdrop: 'void'`) oda koyu bir boşlukta yüzer: gökyüzü ve sis yok, ışık yine gün evresinden.
// Ortam yansıması (IBL) ağdan dosya indirmeden, sahnede birkaç ışık paneliyle bir kez hazırlanır.
import { Environment, Lightformer } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BackSide, CanvasTexture, Color, Fog, PCFShadowMap, SRGBColorSpace, Vector3, type DirectionalLight, type HemisphereLight, type ShaderMaterial } from 'three';
import type { DayPhase } from '../../lib/dayPhase';
import type { Quality } from '../../lib/gfx';
import { rng } from '../../lib/rng';
import { LIGHT, type PhaseLight } from './light';

/** Geçişte kullanılan, karışmış değerler */
interface Mix {
  top: Color;
  horizon: Color;
  sun: Color;
  sky2: Color;
  ground: Color;
  sunI: number;
  hemiI: number;
  env: number;
  sunDir: Vector3;
  stars: number;
}

const toMix = (L: PhaseLight): Mix => ({
  top: new Color(L.top),
  horizon: new Color(L.horizon),
  sun: new Color(L.sun),
  sky2: new Color(L.sky2),
  ground: new Color(L.ground),
  sunI: L.sunI,
  hemiI: L.hemiI,
  env: L.env,
  sunDir: new Vector3(...L.sunDir),
  stars: L.stars ? 1 : 0,
});

const TRANSITION_S = 2;

/** Gölge türü (Canvas `shadows` prop'u): düşükte gölge yok */
export const shadowsFor = (q: Quality) => (q === 'dusuk' ? false : { type: PCFShadowMap });

export default function Atmosphere({
  phase,
  quality,
  mode,
  target,
  backdrop = 'sky',
}: {
  phase: DayPhase;
  quality: Quality;
  /** iso: kuşbakışı (ortografik), third: gezinti (perspektif) */
  mode: 'iso' | 'third';
  /** sky: gökyüzü ve sis; void: Habbo gibi koyu boşluk (yalnızca kuşbakışında) */
  backdrop?: 'sky' | 'void';
  /** Güneş gölgesinin ortalandığı nokta (karakter); verilmezse kameranın kontrol hedefi */
  target?: () => { x: number; z: number };
}) {
  const { scene, invalidate } = useThree();
  const sun = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const cur = useRef<Mix>(toMix(LIGHT[phase]));
  const from = useRef<Mix>(toMix(LIGHT[phase]));
  const to = useRef<Mix>(toMix(LIGHT[phase]));
  const k = useRef(1);
  const dark = mode === 'iso' && backdrop === 'void';
  const sky = useMemo(() => (mode === 'iso' ? new GradientSky(dark) : null), [mode, dark]);
  const fog = useMemo(() => new Fog(LIGHT[phase].horizon, mode === 'iso' ? 60 : 18, mode === 'iso' ? 150 : 62), [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Evre değişince şimdiki karışımdan yenisine geç
  useEffect(() => {
    const c = cur.current;
    from.current = { ...c, top: c.top.clone(), horizon: c.horizon.clone(), sun: c.sun.clone(), sky2: c.sky2.clone(), ground: c.ground.clone(), sunDir: c.sunDir.clone() };
    to.current = toMix(LIGHT[phase]);
    k.current = 0;
    invalidate();
  }, [phase, invalidate]);

  useEffect(() => {
    scene.fog = dark ? null : fog;
    if (sky) scene.background = sky.texture;
    return () => {
      scene.fog = null;
      scene.background = null;
      sky?.texture.dispose();
    };
  }, [scene, fog, sky, dark]);

  const apply = () => {
    const c = cur.current;
    fog.color.copy(c.horizon);
    sky?.draw(c);
    scene.environmentIntensity = c.env;
    const h = hemi.current;
    if (h) {
      h.color.copy(c.sky2);
      h.groundColor.copy(c.ground);
      h.intensity = c.hemiI;
    }
    const s = sun.current;
    if (s) {
      s.color.copy(c.sun);
      s.intensity = c.sunI;
    }
  };
  const first = useRef(true);
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    if (first.current) {
      first.current = false;
      apply();
    }
    if (k.current < 1) {
      k.current = Math.min(1, k.current + dt / TRANSITION_S);
      const e = k.current * k.current * (3 - 2 * k.current);
      const a = from.current;
      const b = to.current;
      const c = cur.current;
      c.top.lerpColors(a.top, b.top, e);
      c.horizon.lerpColors(a.horizon, b.horizon, e);
      c.sun.lerpColors(a.sun, b.sun, e);
      c.sky2.lerpColors(a.sky2, b.sky2, e);
      c.ground.lerpColors(a.ground, b.ground, e);
      c.sunI = a.sunI + (b.sunI - a.sunI) * e;
      c.hemiI = a.hemiI + (b.hemiI - a.hemiI) * e;
      c.env = a.env + (b.env - a.env) * e;
      c.stars = a.stars + (b.stars - a.stars) * e;
      c.sunDir.lerpVectors(a.sunDir, b.sunDir, e);
      apply();
      invalidate();
    }
    // Güneş gölgesi hedefi izler (dünya geniş, gölge haritası değil)
    const l = sun.current;
    if (!l) return;
    const ctl = state.controls as unknown as { target?: Vector3 } | null;
    const t = target ? target() : (ctl?.target ?? { x: 0, z: 0 });
    const d = cur.current.sunDir;
    l.position.set(t.x + d.x, d.y, t.z + d.z);
    l.target.position.set(t.x, 0, t.z);
    l.target.updateMatrixWorld();
  });

  const shadows = quality !== 'dusuk';
  const size = quality === 'yuksek' ? 2048 : 1024;
  const half = mode === 'iso' ? 28 : 24;
  const L = LIGHT[phase];
  return (
    <>
      <hemisphereLight ref={hemi} args={[L.sky2, L.ground, L.hemiI]} />
      <directionalLight
        ref={sun}
        intensity={L.sunI}
        color={L.sun}
        castShadow={shadows}
        shadow-mapSize={[size, size]}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        shadow-camera-far={120}
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
        shadow-radius={quality === 'yuksek' ? 4 : 2}
      />
      {/* Ortam yansıması: gökyüzü paneli üstte, sıcak/soğuk yan paneller, koyu zemin */}
      <Environment key={phase} resolution={64} frames={1} environmentIntensity={L.env}>
        <color attach="background" args={[L.horizon]} />
        <Lightformer form="rect" intensity={1.1} color={L.top} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
        <Lightformer form="rect" intensity={0.8} color={L.sun} position={[6, 3, 4]} rotation-y={Math.atan2(-6, -4)} scale={[6, 4, 1]} />
        <Lightformer form="rect" intensity={0.4} color={L.horizon} position={[-6, 2, -4]} rotation-y={Math.atan2(6, 4)} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={0.2} color={L.ground} position={[0, -4, 0]} rotation-x={-Math.PI / 2} scale={[14, 14, 1]} />
      </Environment>
      {mode === 'third' && <SkyDome mix={cur} />}
    </>
  );
}

/** Kuşbakışı gökyüzü: ekranı kaplayan gradyan doku (yukarısı koyu, ufuk açık); gece yıldızlı */
class GradientSky {
  canvas = document.createElement('canvas');
  texture: CanvasTexture;
  private stars: [number, number, number][];
  private dark: boolean;
  constructor(dark = false) {
    this.dark = dark;
    this.canvas.width = 256;
    this.canvas.height = 256;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const r = rng('gokyuzu');
    this.stars = Array.from({ length: 70 }, () => [r() * 256, r() * 150, 0.4 + r() * 0.9]);
  }
  draw(c: Mix) {
    const g = this.canvas.getContext('2d');
    if (!g) return;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    if (this.dark) {
      // Habbo'nun boşluğu: koyu lacivert, ortası biraz açık
      grad.addColorStop(0, '#0d1420');
      grad.addColorStop(0.55, '#1a2536');
      grad.addColorStop(1, '#0f1724');
    } else {
      grad.addColorStop(0, `#${c.top.getHexString()}`);
      grad.addColorStop(0.75, `#${c.horizon.getHexString()}`);
      grad.addColorStop(1, `#${c.horizon.getHexString()}`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    if (c.stars > 0.01 && !this.dark) {
      g.fillStyle = `rgba(255,255,255,${c.stars * 0.9})`;
      for (const [x, y, s] of this.stars) {
        g.beginPath();
        g.arc(x, y, s, 0, Math.PI * 2);
        g.fill();
      }
    }
    this.texture.needsUpdate = true;
  }
}

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}`;
const DOME_FRAG = /* glsl */ `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float stars;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  vec3 col = mix(horizon, top, pow(h, 0.6));
  // Güneş/ay diski ve hâlesi
  float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
  col += sunColor * (pow(s, 600.0) * 1.4 + pow(s, 12.0) * 0.18);
  // Yıldızlar: yönden türetilen seyrek noktalar
  if (stars > 0.01) {
    vec3 q = floor(vDir * 180.0);
    float n = hash(q);
    col += vec3(step(0.9975, n) * stars * h);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Gezinti gökyüzü: kameranın çevresinde büyük bir kubbe (sis ve gölgeden etkilenmez) */
function SkyDome({ mix }: { mix: { current: Mix } }) {
  const mat = useRef<ShaderMaterial>(null);
  const { camera } = useThree();
  const ref = useRef<import('three').Mesh>(null);
  const uniforms = useMemo(
    () => ({ top: { value: new Color() }, horizon: { value: new Color() }, sunDir: { value: new Vector3(0, 1, 0) }, sunColor: { value: new Color() }, stars: { value: 0 } }),
    [],
  );
  useFrame(() => {
    const c = mix.current;
    uniforms.top.value.copy(c.top);
    uniforms.horizon.value.copy(c.horizon);
    uniforms.sunDir.value.copy(c.sunDir);
    uniforms.sunColor.value.copy(c.sun);
    uniforms.stars.value = c.stars;
    ref.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={ref} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[140, 32, 16]} />
      <shaderMaterial ref={mat} side={BackSide} depthWrite={false} fog={false} uniforms={uniforms} vertexShader={DOME_VERT} fragmentShader={DOME_FRAG} />
    </mesh>
  );
}
