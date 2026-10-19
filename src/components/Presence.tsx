// Kapanırken kısa bir çıkış animasyonu: `show` false olunca son görünüş `ms` boyunca `leaving` sınıfıyla kalır
// (CSS: .leaving), sonra kaldırılır. Bırakılan kopyanın ref'i kaldırılır (yeni açılan balon aynı ref'i alabilsin).
// Azaltılmış harekette hemen kaybolur.
import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { reducedMotion } from '../lib/motionPref';

export default function Presence({ show, ms = 160, children }: { show: boolean; ms?: number; children: ReactNode }) {
  const last = useRef<ReactNode>(null);
  const [leaving, setLeaving] = useState(false);
  const was = useRef(show);
  if (show) last.current = children;
  useEffect(() => {
    if (was.current && !show && !reducedMotion()) {
      setLeaving(true);
      const id = setTimeout(() => setLeaving(false), ms);
      was.current = show;
      return () => clearTimeout(id);
    }
    was.current = show;
    setLeaving(false);
  }, [show, ms]);
  if (show) return <>{children}</>;
  if (!leaving || !isValidElement(last.current)) return null;
  const el = last.current as ReactElement<{ ref?: unknown; className?: string }>;
  return cloneElement(el, { ref: null, className: `${el.props.className ?? ''} leaving`.trim() });
}
