// Dünyam ve Bahçem'in 3D parçalarını (three.js, sahne, modeller ~400 KB gzip) önceden indirir. Bugün açılıp oyun
// durumu gelince tarayıcı boştayken çağrılır; alt menüde düğmeye dokunulunca/üstüne gelinince hemen. World.tsx ve
// Garden.tsx'teki lazy() aynı modülleri ister, ikinci kez inmez. Veri tasarrufu açık ya da bağlantı 2G ise boşta
// indirme yapılmaz (yalnızca düğmede).
import { hasWebGL } from './webgl';

const started = new Set<string>();
const once = (key: string, load: () => Promise<unknown>) => {
  if (started.has(key) || !hasWebGL()) return;
  started.add(key);
  load().catch(() => started.delete(key));
};

export const prefetchWorld = () => once('world', () => import('../components/world3d/WorldView'));
export const prefetchGarden = () => once('garden', () => import('../components/world3d/GardenView'));

/** Bağlantı boşta indirmeye uygun mu */
function roomy(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !c?.saveData && !/2g/.test(c?.effectiveType ?? '');
}

/** Tarayıcı boşalınca ikisini de indir; iptal fonksiyonu döner */
export function prefetch3dWhenIdle(): () => void {
  if (!roomy()) return () => {};
  const run = () => {
    prefetchWorld();
    prefetchGarden();
  };
  if ('requestIdleCallback' in window) {
    const id = requestIdleCallback(run, { timeout: 5000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 1500);
  return () => clearTimeout(id);
}
