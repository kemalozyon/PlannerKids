import { useEffect, useState, type ReactNode } from 'react';

/** İlk tıklamada "Emin misin?" sorar, ikinci tıklamada çalışır. 3 sn sonra geri döner. */
export default function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Emin misin?',
  className = 'btn ghost sm',
  ariaLabel,
}: {
  onConfirm: () => void;
  children: ReactNode;
  confirmLabel?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className}${armed ? ' armed' : ''}`}
      aria-label={armed ? confirmLabel : ariaLabel}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
