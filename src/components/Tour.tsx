// Sesli ve yazılı tanıtım turu. Her sahnede ilgili sayfa açılır, ilgili öge driver.js ile öne çıkar,
// altta altyazı kelime kelime vurgulanır. Sesler önceden üretilmiş statik dosyalardır (public/demo/,
// scripts/gen-demo-audio.mjs); canlı TTS yok. Ses dosyası yoksa ya da "Sessiz izle" seçildiyse kelime
// zamanları okuma hızından tahmin edilir ve tur kendi kendine ilerler.
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { estimateWords, sceneEnd, SCENES, TOUR_KEY, VIEW_EVENT, wordAt, type TourMode, type Word } from '../lib/tour';


const base = import.meta.env.BASE_URL ?? '/';

async function waitFor(selector: string, ms = 4000): Promise<HTMLElement | null> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && el.getBoundingClientRect().height > 0) return el;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

export default function Tour({ mode: startMode, onClose }: { mode: TourMode; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<TourMode>(startMode);
  const [words, setWords] = useState<Word[]>([]);
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);
  const [noAudio, setNoAudio] = useState(false);
  const drv = useRef<Driver | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const scene = SCENES[i];
  const last = i === SCENES.length - 1;

  // driver.js bir kez kurulur; kapanınca temizlenir
  useEffect(() => {
    drv.current = driver({ animate: true, overlayOpacity: 0.5, stagePadding: 6, stageRadius: 14, allowClose: false, overlayClickBehavior: () => {}, disableActiveInteraction: true });
    return () => {
      drv.current?.destroy();
      audio.current?.pause();
      try {
        localStorage.setItem(TOUR_KEY, 'seen');
      } catch {
        /* yok say */
      }
    };
  }, []);

  // Sahne: sayfayı aç, ögeyi öne çıkar, sesi/zamanları yükle
  useEffect(() => {
    let alive = true;
    setT(0);
    setWords([]);
    audio.current?.pause();
    audio.current = null;
    // Dünyam'da hangi oda açılsın (World.tsx dinler)
    if (scene.view) window.dispatchEvent(new CustomEvent(VIEW_EVENT, { detail: scene.view }));
    if (location.hash !== `#${scene.hash}`) location.hash = scene.hash;
    (async () => {
      const el = await waitFor(`[data-tour="${scene.target}"]`);
      if (!alive) return;
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        await new Promise((r) => setTimeout(r, 350));
        if (alive) drv.current?.highlight({ element: el });
      } else drv.current?.destroy();
      if (mode === 'audio') {
        try {
          const res = await fetch(`${base}demo/${scene.id}.json`);
          if (!res.ok) throw new Error('yok');
          const data = (await res.json()) as { words: Word[]; text?: string };
          // Metin değiştiyse eski ses başka şey söyler: yeniden üretilene kadar yazılı anlatım
          if (data.text != null && data.text !== scene.text) throw new Error('eski ses');
          if (!alive) return;
          const a = new Audio(`${base}demo/${scene.id}.mp3`);
          audio.current = a;
          setWords(data.words);
          setNoAudio(false);
          await a.play();
          return;
        } catch {
          if (!alive) return;
          // Ses dosyası yok (henüz üretilmedi) ya da tarayıcı çalmaya izin vermedi: yazılı moda düş
          setNoAudio(true);
        }
      }
      setWords(estimateWords(scene.text));
    })();
    return () => {
      alive = false;
    };
  }, [i, mode, scene]);

  // Zaman: ses varsa sesin anı, yoksa saat; sahne bitince sıradakine geç
  useEffect(() => {
    if (!words.length || paused) {
      audio.current?.pause();
      return;
    }
    const a = audio.current;
    if (a && a.paused && a.currentTime < (a.duration || Infinity)) a.play().catch(() => {});
    let raf = 0;
    let prev = performance.now();
    let local = t;
    const tick = (now: number) => {
      if (a) local = a.currentTime;
      else local += (now - prev) / 1000;
      prev = now;
      setT(local);
      const done = a ? a.ended : local >= sceneEnd(words);
      if (done) {
        if (!last) setTimeout(() => setI((x) => Math.min(SCENES.length - 1, x + 1)), a ? 500 : 0);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, paused, last]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setI((x) => Math.min(SCENES.length - 1, x + 1));
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      else if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cur = wordAt(words, t);
  const shown = words.length ? words : scene.text.split(/\s+/).map((w) => ({ w, s: 0, e: 0 }));
  // driver.js'in örtüsünün üstünde kalsın diye doğrudan body'ye
  return createPortal(
    <div className="tour-panel" role="dialog" aria-label="Tanıtım turu" aria-live="polite">
      <div className="tour-head">
        <span className="tour-step">
          {i + 1}/{SCENES.length}
        </span>
        <strong className="grow">{scene.title}</strong>
        <button
          className="tour-btn"
          aria-label={mode === 'audio' ? 'Sesi kapat, yazılı izle' : 'Sesli izle'}
          onClick={() => setMode(mode === 'audio' ? 'text' : 'audio')}
        >
          {mode === 'audio' && !noAudio ? '🔊' : '🔇'}
        </button>
        <button className="tour-btn" aria-label="Turu bitir" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="tour-text">
        {shown.map((w, k) => (
          <span key={k} className={k === cur ? 'now' : k < cur ? 'said' : ''}>
            {w.w}{' '}
          </span>
        ))}
      </p>
      {noAudio && mode === 'audio' && <p className="tour-note">Ses dosyaları henüz yok; yazılı anlatımla devam ediyoruz.</p>}
      <div className="tour-controls">
        <button className="btn sm" disabled={i === 0} onClick={() => setI(i - 1)}>
          ⏮ Geri
        </button>
        <button className="btn sm" onClick={() => setPaused(!paused)}>
          {paused ? '▶ Devam' : '⏸ Duraklat'}
        </button>
        {last ? (
          <button className="btn sm primary" onClick={onClose}>
            Bitir
          </button>
        ) : (
          <button className="btn sm primary" onClick={() => setI(i + 1)}>
            İleri ⏭
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
