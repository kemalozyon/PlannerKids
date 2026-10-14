// Kodla çizilen, parça parça kurulan low-poly avatar (Habbo gibi): ten, yüz, saç, üst, alt, ayakkabı, şapka,
// gözlük ve sırt. Parçaların stili items.json → style, renkleri görünüşten (avatar.ts → AvatarLook).
// Kemik yok: kollar omuzdan, bacaklar kalçadan döner; yürüme, koşma, zıplama, süzülme, el sallama, dans, oturma,
// yatma ve sallanma useFrame'de hesaplanır (yatarken gövdeyi yatıran çağıran taraftır). Ayakların altı y = 0, boy ~1.2 birim.
// `holding`: bir eşyadan alınan ikram (DISPENSE: kahve, dondurma…) sağ elde, kol öne kalkık.
//
// Dünya görünümü "istek üzerine" çizildiğinden (frameloop="demand") boşta nefes/göz kırpma yalnızca
// `live` açıkken (önizleme, gezinti) oynar; yürürken çağıran taraf kare ister.
import { RoundedBox } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import { Color, DoubleSide, ExtrudeGeometry, Shape, type Group } from 'three';
import { BODIES, styleOf, type AvatarLook } from '../../lib/avatar';

export type AvatarState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'glide' | 'wave' | 'dance' | 'sit' | 'lie' | 'swing';

/** Kalçanın yüksekliği: oturunca kalça oturağa gelsin diye çağıran taraf karakteri bu kadar indirir */
export const HIP_Y = 0.38;
export interface AvatarAnim {
  state: AvatarState;
}

const HIP = 0.38;
const SHOULDER = 0.71;
const NECK = 0.74;

/** Malzeme: düz gölgeli, hafif mat */
function Mat({ c, e, o }: { c: string; e?: number; o?: number }) {
  return (
    <meshStandardMaterial
      color={c}
      roughness={0.8}
      flatShading
      emissive={e ? c : '#000000'}
      emissiveIntensity={e ?? 0}
      transparent={o != null}
      opacity={o ?? 1}
      side={o != null ? DoubleSide : undefined}
    />
  );
}

function Box({ p, s, c, e, r }: { p: [number, number, number]; s: [number, number, number]; c: string; e?: number; r?: [number, number, number] }) {
  return (
    <mesh position={p} rotation={r} castShadow>
      <boxGeometry args={s} />
      <Mat c={c} e={e} />
    </mesh>
  );
}

function Ball({ p, r, c, sc, e }: { p: [number, number, number]; r: number; c: string; sc?: [number, number, number]; e?: number }) {
  return (
    <mesh position={p} scale={sc} castShadow>
      <icosahedronGeometry args={[r, 1]} />
      <Mat c={c} e={e} />
    </mesh>
  );
}

const darker = (c: string, k = 0.75) => '#' + new Color(c).multiplyScalar(k).getHexString();

export default function AvatarModel({ look, anim, live = false, holding }: { look: AvatarLook; anim?: MutableRefObject<AvatarAnim>; live?: boolean; holding?: string | null }) {
  const body = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const head = useRef<Group>(null);
  const eyes = useRef<Group>(null);
  const back = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const scale = BODIES.find((b) => b.id === look.body)?.scale ?? 1;

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = clock.elapsedTime;
    const s = anim?.current.state ?? 'idle';
    const k = Math.min(1, dt * 14);
    const ease = (g: Group | null, x: number, z = 0) => {
      if (!g) return 0;
      g.rotation.x += (x - g.rotation.x) * k;
      g.rotation.z += (z - g.rotation.z) * k;
      return Math.abs(x - g.rotation.x) + Math.abs(z - g.rotation.z);
    };
    let leg = 0;
    let arm = 0;
    let armZ = 0.06;
    let bob = 0;
    let wave = 0;
    let lean = 0;
    // Dansta gövde sağa sola salınır ve döner
    let sway = 0;
    let turn = 0;
    // Oturunca iki bacak birden öne (diz yok: bacaklar öne uzanır), yatınca düz
    let seated = 0;
    if (s === 'sit' || s === 'swing') {
      seated = -1.35;
      arm = s === 'swing' ? -2.3 : -0.45;
      armZ = s === 'swing' ? 0.25 : 0.12;
    } else if (s === 'lie') {
      armZ = 0.12;
    } else if (s === 'walk' || s === 'run') {
      const f = s === 'run' ? 14 : 9;
      const a = s === 'run' ? 0.95 : 0.6;
      leg = Math.sin(t * f) * a;
      arm = -leg * 0.9;
      bob = Math.abs(Math.cos(t * f)) * (s === 'run' ? 0.05 : 0.03);
      lean = s === 'run' ? 0.12 : 0.03;
    } else if (s === 'jump' || s === 'fall') {
      leg = 0.5;
      arm = -2.5;
      armZ = 0.4;
    } else if (s === 'glide') {
      arm = 0;
      armZ = 1.35;
      leg = 0.15;
    } else if (s === 'wave') {
      wave = 1;
    } else if (s === 'dance') {
      const b = t * 7;
      leg = Math.sin(b) * 0.35;
      arm = Math.sin(b) * 0.5;
      armZ = 2.1 + Math.sin(b * 2) * 0.45;
      bob = Math.abs(Math.sin(b)) * 0.07;
      sway = Math.sin(b) * 0.14;
      turn = Math.sin(b / 2) * 0.5;
    } else if (live) {
      bob = Math.sin(t * 2) * 0.008;
      arm = Math.sin(t * 2) * 0.04;
    }
    let moving = 0;
    moving += ease(legL.current, seated || leg);
    moving += ease(legR.current, seated || -leg);
    moving += ease(armL.current, arm, armZ);
    if (wave) {
      if (armR.current) {
        armR.current.rotation.x += (-0.2 - armR.current.rotation.x) * k;
        armR.current.rotation.z = -2.6 + Math.sin(t * 10) * 0.35;
      }
    } else if (holding && s !== 'lie') moving += ease(armR.current, -1.05, -0.1);
    else moving += ease(armR.current, seated ? arm : -arm, -armZ);
    if (body.current) {
      body.current.position.y = bob;
      body.current.rotation.x += (lean - body.current.rotation.x) * k;
      body.current.rotation.z += (sway - body.current.rotation.z) * k;
      body.current.rotation.y += (turn - body.current.rotation.y) * k;
      moving += Math.abs(body.current.rotation.z) + Math.abs(body.current.rotation.y);
    }
    if (back.current) back.current.rotation.x = -0.1 - Math.abs(leg) * 0.35 - (s === 'fall' || s === 'glide' ? 0.6 : 0);
    if (eyes.current) eyes.current.scale.y = s === 'lie' || (live && t % 3.7 < 0.13) ? 0.15 : 1;
    if (head.current && live && s === 'idle') head.current.rotation.y = Math.sin(t * 0.7) * 0.12;
    // İstek üzerine çizilen sahnede pozun yerine oturması için birkaç kare daha
    if (!live && moving > 0.01) invalidate();
  });

  const hair = styleOf(look.hair);
  const top = styleOf(look.top) ?? 'tee';
  const bottom = styleOf(look.bottom) ?? 'pants';
  const shoes = styleOf(look.shoes) ?? 'sneakers';
  const hat = styleOf(look.hat);
  const dress = top === 'dress';
  const astro = top === 'astro';
  const topC = astro ? '#f4f6fb' : look.topColor;
  const legsColor = dress || bottom === 'skirt' ? look.skin : astro ? '#f4f6fb' : look.bottomColor;

  return (
    <group scale={scale}>
      <group ref={body}>
        {/* Bacaklar */}
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? legL : legR} position={[side * 0.085, HIP, 0]}>
            <Leg look={look} bottom={dress ? 'none' : bottom} color={legsColor} shoes={shoes} astro={astro} />
          </group>
        ))}
        {/* Gövde */}
        <Torso look={look} top={top} topC={topC} bottom={dress ? 'dress' : bottom} />
        {/* Kollar */}
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? armL : armR} position={[side * 0.215, SHOULDER, 0]}>
            <Arm look={look} top={top} topC={topC} />
            {side > 0 && holding && (
              // Kol öne kalkınca ikram dik dursun
              <group position={[0, -0.34, 0.05]} rotation-x={1.05}>
                <Treat kind={holding} />
              </group>
            )}
          </group>
        ))}
        {/* Sırt */}
        <group ref={back} position={[0, SHOULDER, -0.11]}>
          <Back style={styleOf(look.back)} color={look.backColor} />
        </group>
        {/* Baş */}
        <group ref={head} position={[0, NECK, 0]}>
          <mesh position={[0, 0.03, 0]}>
            <cylinderGeometry args={[0.07, 0.08, 0.06, 8]} />
            <Mat c={look.skin} />
          </mesh>
          <group position={[0, 0.25, 0]}>
            <RoundedBox args={[0.46, 0.42, 0.4]} radius={0.07} smoothness={2} castShadow>
              <Mat c={look.skin} />
            </RoundedBox>
            {/* Kulaklar */}
            {[-1, 1].map((s) => (
              <Ball key={s} p={[s * 0.235, -0.01, 0]} r={0.05} sc={[0.6, 1, 1]} c={look.skin} />
            ))}
            <group ref={eyes}>
              <Eyes look={look} />
            </group>
            <Face look={look} />
            <Hair style={hair} color={look.hairColor} hat={!!hat && hat !== 'catears' && hat !== 'flowers' && hat !== 'headphones'} />
            <Hat style={hat} color={look.hatColor} />
            <Glasses style={styleOf(look.glasses)} />
            {astro && hat !== 'helmet' && <Box p={[0, -0.2, 0]} s={[0.3, 0.04, 0.3]} c="#c7cdd8" />}
          </group>
        </group>
      </group>
    </group>
  );
}

// ---------- Gövde ----------
function Torso({ look, top, topC, bottom }: { look: AvatarLook; top: string; topC: string; bottom: string }) {
  const y = 0.56;
  const accent = darker(topC, 0.8);
  const parts: ReactNode[] = [];
  // Belden aşağısı (pantolon/şort/etek gövdenin alt kısmını kaplar)
  const waist = bottom === 'skirt' || bottom === 'dress' ? null : bottom === 'none' ? null : look.bottomColor;
  if (top === 'stripes') {
    for (let i = 0; i < 3; i++) parts.push(<Box key={`s${i}`} p={[0, y - 0.1 + i * 0.1, 0]} s={[0.352, 0.035, 0.232]} c="#ffffff" />);
  } else if (top === 'shirt') {
    parts.push(<Box key="c1" p={[-0.06, y + 0.16, 0.105]} s={[0.1, 0.04, 0.03]} c="#ffffff" r={[0, 0, -0.4]} />);
    parts.push(<Box key="c2" p={[0.06, y + 0.16, 0.105]} s={[0.1, 0.04, 0.03]} c="#ffffff" r={[0, 0, 0.4]} />);
    for (let i = 0; i < 3; i++) parts.push(<Ball key={`b${i}`} p={[0, y + 0.08 - i * 0.09, 0.115]} r={0.014} c="#ffffff" />);
  } else if (top === 'vest') {
    parts.push(<Box key="in" p={[0, y + 0.02, 0.112]} s={[0.1, 0.3, 0.01]} c="#ffffff" />);
  } else if (top === 'jersey') {
    parts.push(<Box key="side1" p={[-0.17, y, 0]} s={[0.02, 0.36, 0.225]} c="#ffffff" />);
    parts.push(<Box key="side2" p={[0.17, y, 0]} s={[0.02, 0.36, 0.225]} c="#ffffff" />);
    parts.push(<NumberPlate key="no" y={y} />);
  } else if (top === 'hoodie') {
    parts.push(<Box key="hood" p={[0, y + 0.17, -0.12]} s={[0.3, 0.12, 0.08]} c={accent} />);
    parts.push(<Box key="pocket" p={[0, y - 0.09, 0.112]} s={[0.2, 0.09, 0.01]} c={accent} />);
    parts.push(<Box key="s1" p={[-0.04, y + 0.08, 0.113]} s={[0.012, 0.1, 0.01]} c="#ffffff" />);
    parts.push(<Box key="s2" p={[0.04, y + 0.08, 0.113]} s={[0.012, 0.1, 0.01]} c="#ffffff" />);
  } else if (top === 'jacket') {
    parts.push(<Box key="in" p={[0, y, 0.112]} s={[0.1, 0.36, 0.01]} c="#ffffff" />);
    parts.push(<Box key="l1" p={[-0.07, y + 0.1, 0.116]} s={[0.05, 0.14, 0.01]} c={accent} r={[0, 0, 0.3]} />);
    parts.push(<Box key="l2" p={[0.07, y + 0.1, 0.116]} s={[0.05, 0.14, 0.01]} c={accent} r={[0, 0, -0.3]} />);
  } else if (top === 'starry') {
    for (const [x, yy] of [[-0.09, 0.08], [0.08, 0.02], [-0.03, -0.08], [0.11, -0.1], [-0.12, -0.04]]) {
      parts.push(<StarMesh key={`${x}${yy}`} p={[x, y + yy, 0.113]} s={0.035} c="#ffd23f" />);
    }
  } else if (top === 'astro') {
    parts.push(<Box key="panel" p={[0, y + 0.03, 0.113]} s={[0.14, 0.1, 0.012]} c="#c7cdd8" />);
    parts.push(<Ball key="b1" p={[-0.035, y + 0.03, 0.12]} r={0.015} c="#ef476f" e={0.4} />);
    parts.push(<Ball key="b2" p={[0.035, y + 0.03, 0.12]} r={0.015} c="#06d6a0" e={0.4} />);
    parts.push(<Box key="belt" p={[0, y - 0.12, 0]} s={[0.352, 0.04, 0.232]} c={look.topColor} />);
  }
  return (
    <group>
      <RoundedBox args={[0.34, 0.36, 0.22]} radius={0.04} smoothness={2} position={[0, y, 0]} castShadow>
        <Mat c={topC} />
      </RoundedBox>
      {waist && <Box p={[0, HIP + 0.04, 0]} s={[0.344, 0.08, 0.224]} c={top === 'astro' ? '#f4f6fb' : waist} />}
      {bottom === 'track' && <Box p={[0, HIP + 0.075, 0.113]} s={[0.344, 0.012, 0.005]} c="#ffffff" />}
      {(bottom === 'skirt' || bottom === 'dress') && (
        <mesh position={[0, HIP - 0.02, 0]} castShadow>
          <cylinderGeometry args={[0.17, 0.25, 0.22, 8]} />
          <Mat c={bottom === 'dress' ? topC : look.bottomColor} />
        </mesh>
      )}
      {parts}
    </group>
  );
}

function NumberPlate({ y }: { y: number }) {
  return (
    <group position={[0, y + 0.02, -0.113]}>
      <Box p={[-0.03, 0, 0]} s={[0.025, 0.14, 0.01]} c="#ffffff" />
      <Box p={[0.04, 0, 0]} s={[0.025, 0.14, 0.01]} c="#ffffff" />
      <Box p={[0.04, 0.06, 0]} s={[0.06, 0.025, 0.01]} c="#ffffff" />
      <Box p={[0.04, -0.06, 0]} s={[0.06, 0.025, 0.01]} c="#ffffff" />
    </group>
  );
}

function Leg({ look, bottom, color, shoes, astro }: { look: AvatarLook; bottom: string; color: string; shoes: string; astro: boolean }) {
  const short = bottom === 'shorts';
  const boots = shoes === 'boots' || astro;
  return (
    <group>
      {short ? (
        <>
          <Box p={[0, -0.07, 0]} s={[0.135, 0.14, 0.145]} c={look.bottomColor} />
          <Box p={[0, -0.21, 0]} s={[0.11, 0.16, 0.12]} c={look.skin} />
        </>
      ) : (
        <Box p={[0, -0.15, 0]} s={[0.13, 0.3, 0.14]} c={color} />
      )}
      {bottom === 'track' && <Box p={[0.066, -0.15, 0]} s={[0.005, 0.3, 0.03]} c="#ffffff" />}
      {bottom === 'cargo' && <Box p={[0.068, -0.12, 0.01]} s={[0.01, 0.07, 0.07]} c={darker(look.bottomColor)} />}
      {/* Ayakkabı */}
      {shoes === 'sandals' ? (
        <>
          <Box p={[0, -0.34, 0.025]} s={[0.12, 0.05, 0.19]} c={look.skin} />
          <Box p={[0, -0.36, 0.025]} s={[0.135, 0.03, 0.2]} c="#8d6346" />
          <Box p={[0, -0.33, 0.05]} s={[0.137, 0.025, 0.04]} c={look.shoesColor} />
        </>
      ) : (
        <>
          <Box p={[0, boots ? -0.31 : -0.335, 0.025]} s={[0.14, boots ? 0.12 : 0.07, 0.2]} c={astro ? '#c7cdd8' : look.shoesColor} />
          <Box p={[0, -0.365, 0.025]} s={[0.145, 0.03, 0.205]} c={shoes === 'glow' ? '#3fe0ff' : '#ffffff'} e={shoes === 'glow' ? 0.9 : undefined} />
        </>
      )}
    </group>
  );
}

function Arm({ look, top, topC }: { look: AvatarLook; top: string; topC: string }) {
  const sleeve = top === 'tee' || top === 'jersey' || top === 'dress' ? 'short' : top === 'vest' ? 'white' : 'long';
  return (
    <group>
      {sleeve === 'long' ? (
        <Box p={[0, -0.14, 0]} s={[0.1, 0.3, 0.11]} c={topC} />
      ) : (
        <>
          <Box p={[0, -0.06, 0]} s={[0.11, 0.13, 0.12]} c={sleeve === 'white' ? '#ffffff' : topC} />
          <Box p={[0, -0.2, 0]} s={[0.09, 0.17, 0.1]} c={look.skin} />
        </>
      )}
      {top === 'stripes' && <Box p={[0, -0.12, 0]} s={[0.105, 0.03, 0.115]} c="#ffffff" />}
      {top === 'astro' && <Box p={[0, -0.27, 0]} s={[0.11, 0.05, 0.12]} c="#c7cdd8" />}
      <Ball p={[0, -0.32, 0]} r={0.055} c={look.skin} />
    </group>
  );
}

/** Eldeki ikram: küçük, kodla çizilen nesneler */
function Treat({ kind }: { kind: string }) {
  switch (kind) {
    case 'kahve':
      return (
        <group>
          <mesh position={[0, 0.06, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.04, 0.12, 12]} />
            <Mat c="#ffffff" />
          </mesh>
          <mesh position={[0, 0.115, 0]}>
            <cylinderGeometry args={[0.045, 0.045, 0.01, 12]} />
            <Mat c="#6b3e1f" />
          </mesh>
          <Box p={[0.06, 0.06, 0]} s={[0.02, 0.05, 0.02]} c="#ffffff" />
        </group>
      );
    case 'dondurma':
      return (
        <group>
          <mesh position={[0, 0.05, 0]} rotation-x={Math.PI}>
            <coneGeometry args={[0.045, 0.12, 10]} />
            <Mat c="#d9a35b" />
          </mesh>
          <Ball p={[0, 0.13, 0]} r={0.05} c="#ff9ecb" />
          <Ball p={[0, 0.18, 0]} r={0.035} c="#fff3c4" />
        </group>
      );
    case 'meyve-suyu':
      return (
        <group>
          <Box p={[0, 0.07, 0]} s={[0.07, 0.13, 0.05]} c="#ff9f43" />
          <Box p={[0.01, 0.17, 0]} s={[0.012, 0.08, 0.012]} c="#ef4b4b" />
        </group>
      );
    case 'patlamis-misir':
      return (
        <group>
          <mesh position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.06, 0.045, 0.12, 8]} />
            <Mat c="#e53935" />
          </mesh>
          {[-0.02, 0.02, 0].map((x, i) => (
            <Ball key={i} p={[x, 0.13 + (i === 2 ? 0.03 : 0), i === 2 ? 0 : 0.01]} r={0.03} c="#fff6c9" />
          ))}
        </group>
      );
    case 'kurabiye':
      return (
        <mesh position={[0, 0.03, 0]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.06, 0.06, 0.02, 12]} />
          <Mat c="#c98a4b" />
        </mesh>
      );
    default:
      return (
        <mesh position={[0, 0.07, 0]}>
          <cylinderGeometry args={[0.04, 0.035, 0.14, 12]} />
          <Mat c="#7ec8ff" o={0.75} />
        </mesh>
      );
  }
}

// ---------- Yüz ----------
function Eyes({ look }: { look: AvatarLook }) {
  const z = 0.2;
  const y = 0;
  const eye = (x: number, kind: string) => {
    if (kind === 'happy') {
      return (
        <mesh key={x} position={[x, y - 0.005, z]} rotation={[0, 0, 0]}>
          <torusGeometry args={[0.032, 0.011, 4, 10, Math.PI]} />
          <Mat c="#2b1d16" />
        </mesh>
      );
    }
    if (kind === 'sleepy') {
      return (
        <group key={x}>
          <Box p={[x, y, z]} s={[0.07, 0.03, 0.02]} c="#2b1d16" />
          <Box p={[x, y + 0.02, z + 0.003]} s={[0.075, 0.02, 0.02]} c={look.skin} />
        </group>
      );
    }
    const big = kind === 'big';
    return (
      <group key={x} position={[x, y, z]}>
        <Ball p={[0, 0, 0]} r={big ? 0.05 : 0.038} sc={[1, 1.15, 0.35]} c="#ffffff" />
        <Ball p={[0, -0.004, 0.012]} r={big ? 0.033 : 0.026} sc={[1, 1.1, 0.4]} c={look.eyeColor} />
        <Ball p={[0, -0.004, 0.02]} r={big ? 0.017 : 0.013} sc={[1, 1, 0.4]} c="#111111" />
        <Ball p={[0.012, 0.014, 0.026]} r={0.008} sc={[1, 1, 0.4]} c="#ffffff" />
      </group>
    );
  };
  return (
    <group>
      {eye(-0.1, look.eyes === 'wink' ? 'round' : look.eyes)}
      {eye(0.1, look.eyes === 'wink' ? 'happy' : look.eyes)}
    </group>
  );
}

function Face({ look }: { look: AvatarLook }) {
  const z = 0.2;
  const brow = look.brows;
  const hair = darker(look.hairColor, 0.85);
  return (
    <group>
      {brow !== 'none' &&
        [-1, 1].map((s) => (
          <Box
            key={s}
            p={[s * 0.1, 0.085, z + 0.002]}
            s={[0.075, brow === 'thick' ? 0.026 : 0.014, 0.012]}
            r={[0, 0, brow === 'angry' ? s * 0.35 : s * -0.08]}
            c={hair}
          />
        ))}
      {/* Burun */}
      <Ball p={[0, -0.045, z + 0.005]} r={0.018} sc={[1, 0.8, 0.6]} c={darker(look.skin, 0.9)} />
      <Mouth kind={look.mouth} />
      {look.cheeks === 'blush' &&
        [-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.15, -0.06, z + 0.001]}>
            <circleGeometry args={[0.032, 10]} />
            <meshBasicMaterial color="#ff8fa3" transparent opacity={0.55} />
          </mesh>
        ))}
      {look.cheeks === 'freckles' &&
        [-1, 1].flatMap((s) =>
          [[0.13, -0.05], [0.16, -0.07], [0.15, -0.035]].map(([x, y], i) => (
            <mesh key={`${s}${i}`} position={[s * x, y, z + 0.002]}>
              <circleGeometry args={[0.007, 6]} />
              <meshBasicMaterial color="#a0623a" />
            </mesh>
          )),
        )}
    </group>
  );
}

function Mouth({ kind }: { kind: string }) {
  const z = 0.201;
  const y = -0.105;
  if (kind === 'flat') return <Box p={[0, y, z]} s={[0.07, 0.014, 0.01]} c="#7a2e2e" />;
  if (kind === 'open') return <Ball p={[0, y, z]} r={0.024} sc={[1, 1.2, 0.3]} c="#7a2e2e" />;
  if (kind === 'grin') {
    return (
      <group position={[0, y + 0.012, z]}>
        <mesh rotation={[0, 0, Math.PI]}>
          <circleGeometry args={[0.045, 12, 0, Math.PI]} />
          <meshBasicMaterial color="#7a2e2e" />
        </mesh>
        <mesh position={[0, -0.008, 0.001]}>
          <planeGeometry args={[0.07, 0.014]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>
    );
  }
  return (
    <group position={[0, y + 0.02, z]}>
      <mesh rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.035, 0.009, 4, 10, Math.PI]} />
        <Mat c="#7a2e2e" />
      </mesh>
      {kind === 'tongue' && <Ball p={[0.012, -0.04, 0.004]} r={0.016} sc={[1, 1.2, 0.4]} c="#ff7b9c" />}
    </group>
  );
}

// ---------- Saç ----------
function Hair({ style, color, hat }: { style: string | null; color: string; hat: boolean }) {
  if (!style || style === 'none') return null;
  const dark = darker(color, 0.85);
  const cap = !hat && <Box p={[0, 0.2, -0.005]} s={[0.48, 0.1, 0.43]} c={color} />;
  const backPlate = <Box p={[0, 0.06, -0.2]} s={[0.48, 0.3, 0.07]} c={color} />;
  const sides = <>{[-1, 1].map((s) => <Box key={s} p={[s * 0.235, 0.09, -0.04]} s={[0.04, 0.2, 0.33]} c={color} />)}</>;
  const fringe = !hat && <Box p={[0, 0.16, 0.19]} s={[0.47, 0.07, 0.06]} c={color} />;
  switch (style) {
    case 'short':
      return <group>{cap}{backPlate}{sides}{fringe}</group>;
    case 'side':
      return (
        <group>
          {cap}
          {backPlate}
          {sides}
          {!hat && <Box p={[-0.06, 0.15, 0.2]} s={[0.36, 0.08, 0.06]} r={[0, 0, 0.18]} c={color} />}
        </group>
      );
    case 'long':
      return (
        <group>
          {cap}
          {fringe}
          <Box p={[0, -0.05, -0.21]} s={[0.5, 0.52, 0.08]} c={color} />
          {[-1, 1].map((s) => <Box key={s} p={[s * 0.24, -0.04, -0.03]} s={[0.05, 0.42, 0.34]} c={color} />)}
        </group>
      );
    case 'ponytail':
      return (
        <group>
          {cap}
          {backPlate}
          {sides}
          {fringe}
          <Ball p={[0, 0.1, -0.25]} r={0.05} c={dark} />
          <mesh position={[0, -0.04, -0.29]} rotation={[0.35, 0, 0]} castShadow>
            <coneGeometry args={[0.075, 0.3, 7]} />
            <Mat c={color} />
          </mesh>
        </group>
      );
    case 'bob':
      return (
        <group>
          {cap}
          <Box p={[0, 0.02, -0.2]} s={[0.5, 0.38, 0.08]} c={color} />
          {[-1, 1].map((s) => <Box key={s} p={[s * 0.245, 0.02, 0.0]} s={[0.05, 0.36, 0.4]} c={color} />)}
          {!hat && <Box p={[0, 0.14, 0.2]} s={[0.47, 0.1, 0.06]} c={color} />}
        </group>
      );
    case 'curly': {
      const balls: [number, number, number][] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        balls.push([Math.cos(a) * 0.2, 0.17, Math.sin(a) * 0.17 - 0.02]);
      }
      return (
        <group>
          {!hat && balls.map((p, i) => <Ball key={i} p={p} r={0.085} c={i % 2 ? color : dark} />)}
          {!hat && <Ball p={[0, 0.25, -0.02]} r={0.14} sc={[1.3, 0.6, 1.1]} c={color} />}
          {[-1, 1].map((s) => <Ball key={s} p={[s * 0.22, 0.0, -0.08]} r={0.08} c={color} />)}
          <Ball p={[0, 0.02, -0.21]} r={0.12} sc={[1.6, 1, 0.6]} c={dark} />
        </group>
      );
    }
    case 'spiky':
      return (
        <group>
          {cap}
          {backPlate}
          {sides}
          {!hat &&
            [-0.15, -0.05, 0.05, 0.15].flatMap((x, i) =>
              [0.08, -0.08].map((z, j) => (
                <mesh key={`${i}${j}`} position={[x, 0.3, z]} rotation={[z * 2, 0, x * 1.5]}>
                  <coneGeometry args={[0.05, 0.14, 5]} />
                  <Mat c={(i + j) % 2 ? color : dark} />
                </mesh>
              )),
            )}
        </group>
      );
    case 'bun':
      return (
        <group>
          {cap}
          {backPlate}
          {sides}
          {fringe}
          {!hat && <Ball p={[0, 0.31, -0.06]} r={0.1} c={color} />}
        </group>
      );
    case 'buns':
      return (
        <group>
          {cap}
          {backPlate}
          {sides}
          {fringe}
          {!hat && [-1, 1].map((s) => <Ball key={s} p={[s * 0.19, 0.27, -0.02]} r={0.085} c={color} />)}
        </group>
      );
    case 'braids':
      return (
        <group>
          {cap}
          {backPlate}
          {fringe}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.24, -0.05, -0.05]}>
              {[0, 1, 2, 3].map((i) => <Ball key={i} p={[0, -i * 0.07, 0]} r={0.045} c={i % 2 ? dark : color} />)}
              <Ball p={[0, -0.28, 0]} r={0.025} c="#ef476f" />
            </group>
          ))}
        </group>
      );
    case 'mohawk':
      return (
        <group>
          {!hat && <Box p={[0, 0.3, 0]} s={[0.08, 0.18, 0.42]} c={color} />}
          {[-1, 1].map((s) => <Box key={s} p={[s * 0.2, 0.18, -0.02]} s={[0.07, 0.05, 0.4]} c={dark} />)}
        </group>
      );
  }
  return <group>{cap}{backPlate}</group>;
}

// ---------- Şapka, gözlük, sırt ----------
function Hat({ style, color }: { style: string | null; color: string }) {
  if (!style) return null;
  switch (style) {
    case 'cap':
      return (
        <group position={[0, 0.2, 0]}>
          <mesh position={[0, 0.04, 0]} scale={[1, 0.55, 1]} castShadow>
            <sphereGeometry args={[0.25, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <Mat c={color} />
          </mesh>
          <Box p={[0, 0.03, 0.27]} s={[0.36, 0.025, 0.18]} c={darker(color)} />
          <Ball p={[0, 0.18, 0]} r={0.025} c={darker(color)} />
        </group>
      );
    case 'beanie':
      return (
        <group position={[0, 0.2, 0]}>
          <mesh position={[0, 0.04, -0.01]} scale={[1, 0.75, 1]} castShadow>
            <sphereGeometry args={[0.26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <Mat c={color} />
          </mesh>
          <mesh position={[0, 0.03, -0.01]}>
            <cylinderGeometry args={[0.262, 0.262, 0.07, 12]} />
            <Mat c={darker(color)} />
          </mesh>
          <Ball p={[0, 0.25, -0.01]} r={0.06} c="#ffffff" />
        </group>
      );
    case 'straw':
      return (
        <group position={[0, 0.22, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.42, 0.42, 0.025, 14]} />
            <Mat c="#f2d38a" />
          </mesh>
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[0.2, 0.23, 0.16, 12]} />
            <Mat c="#f2d38a" />
          </mesh>
          <mesh position={[0, 0.03, 0]}>
            <cylinderGeometry args={[0.232, 0.232, 0.05, 12]} />
            <Mat c={color} />
          </mesh>
        </group>
      );
    case 'flowers':
      return (
        <group position={[0, 0.21, 0]}>
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            const c = ['#ff8ac2', '#ffd166', '#ffffff', color][i % 4];
            return <Ball key={i} p={[Math.cos(a) * 0.21, 0.02, Math.sin(a) * 0.19]} r={0.045} c={c} />;
          })}
        </group>
      );
    case 'catears':
      return (
        <group position={[0, 0.22, -0.02]}>
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.15, 0.06, 0]} rotation={[0, 0, -s * 0.25]}>
              <mesh castShadow>
                <coneGeometry args={[0.07, 0.15, 4]} />
                <Mat c={color} />
              </mesh>
              <mesh position={[0, -0.01, 0.025]} scale={[0.6, 0.7, 0.4]}>
                <coneGeometry args={[0.07, 0.15, 4]} />
                <Mat c="#ff9ebd" />
              </mesh>
            </group>
          ))}
          <Box p={[0, 0, 0]} s={[0.44, 0.03, 0.06]} c={color} />
        </group>
      );
    case 'headphones':
      return (
        <group>
          <mesh position={[0, 0.03, 0]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[0.27, 0.025, 6, 16, Math.PI]} />
            <Mat c="#2b2d42" />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.26, 0.0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.08, 0.08, 0.06, 12]} />
              <Mat c={color} />
            </mesh>
          ))}
        </group>
      );
    case 'wizard':
      return (
        <group position={[0, 0.22, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.38, 0.38, 0.025, 14]} />
            <Mat c={color} />
          </mesh>
          <mesh position={[0, 0.22, -0.02]} rotation={[-0.15, 0, 0]} castShadow>
            <coneGeometry args={[0.22, 0.48, 10]} />
            <Mat c={color} />
          </mesh>
          <StarMesh p={[0.0, 0.2, 0.17]} s={0.05} c="#ffd23f" />
          <StarMesh p={[-0.08, 0.08, 0.2]} s={0.03} c="#ffffff" />
        </group>
      );
    case 'crown':
      return <Crown />;
    case 'helmet':
      return (
        <group position={[0, -0.02, 0]}>
          <mesh>
            <sphereGeometry args={[0.36, 16, 12]} />
            <meshStandardMaterial color="#cfe8ff" transparent opacity={0.28} roughness={0.1} metalness={0.2} />
          </mesh>
          <mesh position={[0, -0.27, 0]}>
            <cylinderGeometry args={[0.3, 0.3, 0.07, 14]} />
            <Mat c="#f4f6fb" />
          </mesh>
          <Ball p={[0.28, 0.12, 0]} r={0.035} c={color} e={0.6} />
        </group>
      );
  }
  return null;
}

function Glasses({ style }: { style: string | null }) {
  if (!style) return null;
  const z = 0.235;
  if (style === 'round') {
    return (
      <group position={[0, 0, z]}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.1, 0, 0]}>
            <torusGeometry args={[0.055, 0.01, 6, 14]} />
            <Mat c="#2b2d42" />
          </mesh>
        ))}
        <Box p={[0, 0.01, 0]} s={[0.05, 0.012, 0.01]} c="#2b2d42" />
      </group>
    );
  }
  if (style === 'sun') {
    return (
      <group position={[0, 0.005, z]}>
        {[-1, 1].map((s) => (
          <RoundedBox key={s} args={[0.13, 0.08, 0.015]} radius={0.02} smoothness={2} position={[s * 0.1, 0, 0]}>
            <meshStandardMaterial color="#1b1b2a" roughness={0.2} metalness={0.4} />
          </RoundedBox>
        ))}
        <Box p={[0, 0.02, 0]} s={[0.07, 0.015, 0.01]} c="#1b1b2a" />
      </group>
    );
  }
  const heart = style === 'heart';
  return (
    <group position={[0, 0, z]}>
      {[-1, 1].map((s) =>
        heart ? <HeartMesh key={s} p={[s * 0.1, 0, 0]} s={0.075} c="#ff3d6e" /> : <StarMesh key={s} p={[s * 0.1, 0, 0]} s={0.08} c="#ffd23f" />,
      )}
      <Box p={[0, 0.01, 0]} s={[0.06, 0.012, 0.01]} c={heart ? '#ff3d6e' : '#ff8ac2'} />
    </group>
  );
}

function Back({ style, color }: { style: string | null; color: string }) {
  if (!style) return null;
  switch (style) {
    case 'backpack':
      return (
        <group position={[0, -0.16, -0.06]}>
          <RoundedBox args={[0.28, 0.3, 0.13]} radius={0.04} smoothness={2} castShadow>
            <Mat c={color} />
          </RoundedBox>
          <Box p={[0, -0.06, -0.07]} s={[0.18, 0.12, 0.03]} c={darker(color)} />
          {[-1, 1].map((s) => <Box key={s} p={[s * 0.1, 0.02, 0.09]} s={[0.035, 0.32, 0.02]} c={darker(color, 0.6)} />)}
        </group>
      );
    case 'cape':
      return (
        <mesh position={[0, -0.27, -0.02]} castShadow>
          <planeGeometry args={[0.4, 0.56, 1, 3]} />
          <meshStandardMaterial color={color} side={DoubleSide} roughness={0.7} flatShading />
        </mesh>
      );
    case 'guitar':
      return (
        <group position={[0.02, -0.15, -0.05]} rotation={[0, 0, 0.6]}>
          <Ball p={[0, -0.1, 0]} r={0.12} sc={[1, 1.1, 0.35]} c="#c0703a" />
          <Ball p={[0, 0.03, 0]} r={0.09} sc={[1, 1, 0.35]} c="#c0703a" />
          <Box p={[0, 0.22, 0]} s={[0.04, 0.3, 0.03]} c="#5a3a22" />
          <Ball p={[0, -0.07, -0.04]} r={0.03} sc={[1, 1, 0.3]} c="#2b1d16" />
        </group>
      );
    case 'wings':
      return (
        <group position={[0, -0.1, -0.03]}>
          {[-1, 1].map((s) => (
            <group key={s} rotation={[0, s * 0.5, 0]}>
              <mesh position={[s * 0.2, 0.05, 0]} rotation={[0, 0, s * 0.3]}>
                <circleGeometry args={[0.17, 8]} />
                <meshStandardMaterial color={color} transparent opacity={0.75} side={DoubleSide} emissive={color} emissiveIntensity={0.25} />
              </mesh>
              <mesh position={[s * 0.15, -0.16, 0]} rotation={[0, 0, -s * 0.3]}>
                <circleGeometry args={[0.1, 8]} />
                <meshStandardMaterial color="#ff8ac2" transparent opacity={0.75} side={DoubleSide} />
              </mesh>
            </group>
          ))}
        </group>
      );
    case 'jetpack':
      return (
        <group position={[0, -0.15, -0.07]}>
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.07, 0, 0]}>
              <mesh castShadow>
                <cylinderGeometry args={[0.06, 0.06, 0.3, 10]} />
                <meshStandardMaterial color="#b8c0cc" metalness={0.6} roughness={0.3} />
              </mesh>
              <mesh position={[0, 0.17, 0]}>
                <coneGeometry args={[0.06, 0.07, 10]} />
                <Mat c="#ef476f" />
              </mesh>
              <mesh position={[0, -0.21, 0]} rotation={[Math.PI, 0, 0]}>
                <coneGeometry args={[0.045, 0.12, 8]} />
                <Mat c="#ffb347" e={1} />
              </mesh>
            </group>
          ))}
        </group>
      );
  }
  return null;
}

// ---------- Şekiller ----------
const shapeCache = new Map<string, ExtrudeGeometry>();
function shapeGeo(name: string, make: () => Shape): ExtrudeGeometry {
  let g = shapeCache.get(name);
  if (!g) {
    g = new ExtrudeGeometry(make(), { depth: 0.015, bevelEnabled: false });
    g.center();
    shapeCache.set(name, g);
  }
  return g;
}

const starShape = () => {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.45 : 1;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
};

const heartShape = () => {
  const s = new Shape();
  s.moveTo(0, -0.9);
  s.bezierCurveTo(-1.2, 0, -0.9, 1.1, 0, 0.45);
  s.bezierCurveTo(0.9, 1.1, 1.2, 0, 0, -0.9);
  return s;
};

function StarMesh({ p, s, c }: { p: [number, number, number]; s: number; c: string }) {
  const g = useMemo(() => shapeGeo('star', starShape), []);
  return (
    <mesh geometry={g} position={p} scale={[s, s, 1]}>
      <Mat c={c} e={0.3} />
    </mesh>
  );
}

function HeartMesh({ p, s, c }: { p: [number, number, number]; s: number; c: string }) {
  const g = useMemo(() => shapeGeo('heart', heartShape), []);
  return (
    <mesh geometry={g} position={p} scale={[s, s, 1]}>
      <Mat c={c} e={0.2} />
    </mesh>
  );
}

function Crown() {
  return (
    <group position={[0, 0.24, 0]}>
      <mesh>
        <cylinderGeometry args={[0.17, 0.17, 0.08, 10, 1, true]} />
        <meshStandardMaterial color="#ffcc33" metalness={0.6} roughness={0.3} side={DoubleSide} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.17, 0.08, Math.sin(a) * 0.17]}>
            <coneGeometry args={[0.035, 0.09, 4]} />
            <meshStandardMaterial color="#ffcc33" metalness={0.6} roughness={0.3} />
          </mesh>
        );
      })}
      <Ball p={[0, 0.0, 0.172]} r={0.025} c="#ef476f" e={0.4} />
    </group>
  );
}
