// Habbo gibi konuşma balonları ve isim etiketi: karakterin başının üstünde (kutuyu WorldView → AvatarAnchor her
// karede başın ekrandaki yerine taşır). Yeni balon altta belirir, eskiler yukarı kayar; her biri birkaç saniyede
// solar. İsim etiketi `name` verilince görünür. Dokunulmaz (pointer-events: none).
import { forwardRef } from 'react';

export interface Bubble {
  id: number;
  text: string;
  /** Kendiliğinden (eylem sonucu): daha sade görünür */
  auto: boolean;
}

/** Bir balonun ekranda kalma süresi (ms) ve aynı anda en çok kaç balon */
export const BUBBLE_MS = 6000;
export const BUBBLE_MAX = 4;

const SpeechBubbles = forwardRef<HTMLDivElement, { bubbles: Bubble[]; name: string | null }>(function SpeechBubbles({ bubbles, name }, ref) {
  return (
    <div ref={ref} className="say-anchor" aria-live="polite">
      <div className="say-stack">
        {bubbles.map((b, i) => (
          <div key={b.id} className={`say-bubble${b.auto ? ' auto' : ''}${i === bubbles.length - 1 ? ' tail' : ''}`}>
            {b.text}
          </div>
        ))}
        {name && <div className="say-name">{name}</div>}
      </div>
    </div>
  );
});

export default SpeechBubbles;
