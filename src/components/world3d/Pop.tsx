// Seçenek balonu: dokunulan eşyanın ya da karakterin yanında açılır (konumu sahnedeki ScreenAnchor yazar).
// Satırlar: kullanım eylemleri (karakter yürür, sonra yapar) ve düzenleme (Taşı, Döndür, Kaldır: hemen).
import type { ReactNode, Ref } from 'react';

export default function Pop({ ref, title, onClose, children }: { ref: Ref<HTMLDivElement>; title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div ref={ref} className="item-pop" role="dialog">
      <div className="pop-head">
        <span className="pop-title">{title}</span>
        <button className="pop-x" onClick={onClose} aria-label="Kapat">
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}
