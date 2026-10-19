// Yüksek grafik kalitesinde son işlem: ortam gölgelemesi (N8AO: köşeler, eşya altları), parlama (lambalar, neon,
// gece pencereleri), hafif kenar kararması ve ton eşleme (bileşik çizimde renderer'ın ton eşlemesi kapanır).
// Sahne "istek üzerine" çizilmeye devam eder: bileşik de yalnızca kare istenince çizer.
import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

export default function Effects({ night }: { night: boolean }) {
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <N8AO halfRes aoRadius={1.2} distanceFalloff={0.6} intensity={2.2} quality="low" />
      <Bloom mipmapBlur luminanceThreshold={night ? 0.55 : 0.85} luminanceSmoothing={0.15} intensity={night ? 0.9 : 0.45} />
      <Vignette offset={0.32} darkness={0.38} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
