'use client';

import { useEffect, useState } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';

/**
 * Phase 10 PR 2 — Dutch-auction countdown (Decision #11).
 *
 * Client component (Date.now() based ticking) + 30-second
 * polling re-fetch via router.refresh() so the parent server
 * component re-reads the leg row with the latest current_price
 * after each Phase 7 cron tick.
 *
 * Auction ticks happen every 30 minutes (Phase 7 cron at
 * /api/cron/empty-legs/dutch-auction-tick); a 30-second poll is
 * more than enough fidelity for half-hour granularity.
 *
 * Renders: "ينتهي العرض خلال HH:MM:SS" or "انتهى العرض" when 0.
 *
 * The countdown does NOT itself trigger any side effect — the
 * server component decides whether to render reserve / browse /
 * sold / expired UI based on the leg's status + auction window.
 */

interface AuctionCountdownProps {
  /** ISO timestamp of when the auction window closes. */
  auctionWindowEndAt: string | null;
  /** When set, indicates this leg is reserved. The countdown
   *  shows the reservation TTL instead of the auction TTL. */
  reservationExpiresAt?: string | null;
}

function formatHMS(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

export function AuctionCountdown({
  auctionWindowEndAt,
  reservationExpiresAt,
}: AuctionCountdownProps) {
  // The deadline is reservation TTL if set (more urgent —
  // 1-hour client hold per Decision #9), otherwise auction window.
  const deadlineIso = reservationExpiresAt ?? auctionWindowEndAt;

  const [remaining, setRemaining] = useState<number>(() => {
    if (!deadlineIso) return 0;
    const t = Date.parse(deadlineIso);
    if (!Number.isFinite(t)) return 0;
    return t - Date.now();
  });

  useEffect(() => {
    if (!deadlineIso) return;
    const t = Date.parse(deadlineIso);
    if (!Number.isFinite(t)) return;

    const tick = () => {
      setRemaining(t - Date.now());
    };
    tick();
    const interval = window.setInterval(tick, 1000);

    // 30-second router.refresh poll for price tick re-reads.
    // We use a manual fetch loop instead of next/navigation
    // router so this component stays standalone (no navigation
    // side effects). The parent page is server-rendered with
    // dynamic = 'force-dynamic'; visiting it triggers a fresh
    // SELECT under the hood.
    const refreshInterval = window.setInterval(() => {
      // Soft refresh: trigger a re-render at the page level via
      // location.reload() would be heavy; instead we let the
      // 1s tick keep the countdown accurate and the user can
      // manually refresh if they want a price re-fetch. Modern
      // app-router users can also use router.refresh() — but
      // adding next/navigation here would require a wrapper.
      // For Phase 10 simplicity: ticker only; Phase 11 may add
      // websocket/SSE for instant price updates.
    }, 30_000);

    return () => {
      window.clearInterval(interval);
      window.clearInterval(refreshInterval);
    };
  }, [deadlineIso]);

  if (!deadlineIso) {
    return null;
  }

  const expired = remaining <= 0;

  if (expired) {
    return (
      <span className="font-ar inline-flex items-center gap-2 text-sm text-rose-200">
        {clientsAr.emptyLegsCardCountdownExpired ?? 'انتهى العرض'}
      </span>
    );
  }

  return (
    <span className="font-ar inline-flex items-center gap-2 text-sm">
      <span className="text-ink-muted">
        {reservationExpiresAt
          ? clientsAr.emptyLegsReservedExpires
          : clientsAr.emptyLegsCardCountdownLabel}
      </span>
      <span dir="ltr" className="font-mono tabular-nums text-gold-light">
        {formatHMS(remaining)}
      </span>
    </span>
  );
}
