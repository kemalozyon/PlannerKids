// Kronometre çalışırken Dünyam'ın yerinde (App.tsx → GameLock) ve odak modunda: odanın dokunulmaz görüntüsü,
// karakter ilk ders masasında (STUDY: oda → kütüphane → eklenen odalar) oturmuş ders çalışıyor. Masa yoksa
// odanın ortasında küçük bir sehpada çalışır. Oyun yok: dokunma, yürüme, envanter kapalı; yalnızca bakılır.
import { Canvas, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import { has, itemById } from '../../lib/catalog';
import { CFG } from '../../lib/config';
import { dayPhase } from '../../lib/dayPhase';
import { toLocalDate } from '../../lib/date';
import { ownedCount } from '../../lib/economy';
import { useGame } from '../../lib/GameContext';
import { useReading } from '../../lib/ReadingContext';
import { emptyLayout, isIndoor, mapById, roomSpace, sanitizeLayout, studySpot, type SpaceId, type WorldCtx } from '../../lib/world';
import { entryOf, spacePlan } from '../../lib/worldPlan';
import AvatarModel, { HIP_Y, type AvatarAnim } from '../avatar/AvatarModel';
import Atmosphere from './Atmosphere';
import { QualityContext } from './gfx';
import { surfaceTop } from './items';
import { VOID_BG } from './WorldView';
import WorldScene from './WorldScene';

const OFF = new Vector3(18, 20, 18);

export default function StudyRoom() {
  const { stats } = useGame();
  const reading = useReading();
  const today = toLocalDate();
  const phase = dayPhase(new Date().getHours());
  const ctx: WorldCtx = useMemo(() => ({ map: stats?.world.map ?? CFG.world.maps[0].id, today, rooms: stats?.rooms ?? [] }), [stats?.world.map, stats?.rooms, today]);
  // İlk ders masası: oda, kütüphane, sonra eklenen odalar sırasıyla (teraslar hariç)
  const found = useMemo(() => {
    if (!stats) return null;
    const owned = (it: Parameters<typeof ownedCount>[0]) => ownedCount(it, stats.owned, stats.unlock);
    const order: SpaceId[] = ['room', 'library', ...ctx.rooms.map((r) => roomSpace(r.id)).filter((sp) => isIndoor(sp, ctx))];
    const layoutOf = (sp: SpaceId) => sanitizeLayout(sp, stats.spaces[sp] ?? emptyLayout(sp), ctx, owned).layout;
    for (const sp of order) {
      const l = layoutOf(sp);
      const i = l.items.findIndex((p) => has(itemById(p.item), 'STUDY'));
      const spot = i >= 0 ? studySpot(l, i) : null;
      if (spot) return { space: sp, layout: l, desk: { spot, top: surfaceTop(itemById(l.items[i].item)!) } };
    }
    return { space: 'room' as SpaceId, layout: layoutOf('room'), desk: null };
  }, [stats, ctx]);
  const space: SpaceId = found?.space ?? 'room';
  const desk = found?.desk ?? null;
  const plan = useMemo(() => spacePlan(ctx, space), [ctx, space]);
  const layouts = useMemo(() => (found ? { [found.space]: found.layout } : {}), [found]);
  const r = plan.regions[0];
  const fallback = entryOf(plan, space) ?? { x: r.x + 2, y: r.y + 2 };
  // Oturuş yeri; masa yoksa odanın içinde, kuzeye (sehpaya) dönük
  const seat = desk
    ? { x: r.x + desk.spot.x, z: r.y + desk.spot.z, y: desk.spot.y, face: desk.spot.face, stool: desk.spot.stool, top: desk.top, table: false }
    : { x: fallback.x + 1.5, z: fallback.y + 0.5, y: 0.45, face: Math.PI, stool: true, top: 0.62, table: true };
  const center = useMemo(() => ({ x: Math.floor(seat.x), y: Math.floor(seat.z) }), [seat.x, seat.z]);
  const anim = useRef<AvatarAnim>({ state: 'study' } as AvatarAnim);
  if (!stats) return null;
  // Masanın üstündeki defter: karakterin önünde (yüzü sin/cos(face) yönüne bakar)
  const fx = Math.sin(seat.face);
  const fz = Math.cos(seat.face);
  return (
    <Canvas
      orthographic
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ position: [seat.x + OFF.x, OFF.y, seat.z + OFF.z], zoom: 60, near: -60, far: 320 }}
      style={{ background: VOID_BG }}
      aria-label="Odanda ders çalışan karakterin"
    >
      <Atmosphere phase={phase} quality="dusuk" mode="iso" backdrop="void" target={() => ({ x: seat.x, z: seat.z })} />
      <QualityContext.Provider value="dusuk">
        <Suspense fallback={null}>
          <WorldScene
            plan={plan}
            map={mapById(ctx.map)}
            layouts={layouts}
            creatures={[]}
            night={phase === 'gece' || phase === 'aksam'}
            books={reading.books.filter((b) => b.status === 'done')}
            reading={reading.books.filter((b) => b.status === 'reading')}
            phase={phase}
            channels={{}}
            tv={null}
            center={center}
          />
          <group position={[seat.x, seat.y - HIP_Y, seat.z]} rotation-y={seat.face}>
            <AvatarModel look={stats.equipped.look} anim={anim} live />
          </group>
          {seat.stool && (
            <mesh position={[seat.x, seat.y / 2, seat.z]} castShadow>
              <cylinderGeometry args={[0.2, 0.17, seat.y, 14]} />
              <meshStandardMaterial color="#b9844f" />
            </mesh>
          )}
          {seat.table && (
            <mesh position={[seat.x + fx * 0.55, seat.top / 2, seat.z + fz * 0.55]} castShadow>
              <boxGeometry args={[0.8, seat.top, 0.5]} />
              <meshStandardMaterial color="#c89a6a" />
            </mesh>
          )}
          {/* Açık defter */}
          <group position={[seat.x + fx * 0.42, seat.top + 0.012, seat.z + fz * 0.42]} rotation-y={seat.face}>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.09, 0, 0]} rotation-z={s * -0.06}>
                <boxGeometry args={[0.17, 0.01, 0.23]} />
                <meshStandardMaterial color="#fffaf0" />
              </mesh>
            ))}
          </group>
        </Suspense>
      </QualityContext.Provider>
      <FixedCamera x={seat.x} z={seat.z} />
    </Canvas>
  );
}

/** Kamera karaktere bakar; ekran boyuna göre yakınlık; sahne ~15 fps çizilir (karakter canlı) */
function FixedCamera({ x, z }: { x: number; z: number }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    camera.position.set(x + OFF.x, OFF.y + 0.6, z + OFF.z);
    camera.lookAt(x, 0.6, z);
    camera.zoom = Math.min(size.width, size.height) / 4.5;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, x, z, invalidate]);
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && invalidate(), 66);
    return () => clearInterval(id);
  }, [invalidate]);
  return null;
}
