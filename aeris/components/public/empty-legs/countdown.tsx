'use client';

import { useEffect, useState } from 'react';

interface Props {
  /** ISO timestamp (e.g. `result.reservation_expires_at`). */
  targetIso: string;
  /** Optional callback fired exactly once when the deadline elapses. */
  onExpire?: () => void;
}

export function ReservationCountdown({ targetIso, onExpire }: Props) {
  const [remainingMs, setRemainingMs] = useState<number>(() =>
    Math.max(0, Date.parse(targetIso) - Date.now())
  );

  useEffect(() => {
    const targetMs = Date.parse(targetIso);
    if (!Number.isFinite(targetMs)) return undefined;

    const tick = () => {
      const left = Math.max(0, targetMs - Date.now());
      setRemainingMs(left);
      if (left === 0 && onExpire) onExpire();
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetIso, onExpire]);

  if (remainingMs <= 0) {
    return (
      <span className="font-ar text-sm text-red-300">00:00</span>
    );
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');

  return (
    <span
      className="font-ar inline-flex items-baseline gap-1 text-3xl text-gold-light tabular-nums"
      dir="ltr"
    >
      {minutes}:{seconds}
    </span>
  );
}
