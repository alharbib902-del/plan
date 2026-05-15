import { clientsAr } from '@/lib/i18n/clients-ar';

/**
 * Phase 9 PR 1 — shared inline banner for client-portal forms.
 * Mirror of `components/operator/error-banner.tsx`.
 */

interface ClientBannerProps {
  // Phase 10 PR 2: extended from {error, success} to also include
  // {info, warning} for the empty-legs detail surface (reserved-by-
  // me, reserved-by-other, terminal-state copy).
  kind: 'error' | 'success' | 'info' | 'warning';
  children: React.ReactNode;
}

export function ClientBanner({ kind, children }: ClientBannerProps) {
  let tone: string;
  switch (kind) {
    case 'error':
      tone = 'border-rose-400/40 bg-rose-500/10 text-rose-100';
      break;
    case 'success':
      tone = 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100';
      break;
    case 'warning':
      tone = 'border-amber-400/40 bg-amber-500/10 text-amber-100';
      break;
    case 'info':
    default:
      tone = 'border-sky-400/40 bg-sky-500/10 text-sky-100';
      break;
  }
  const role = kind === 'error' || kind === 'warning' ? 'alert' : 'status';
  return (
    <div
      role={role}
      className={`font-ar rounded-lg border px-4 py-3 text-sm ${tone}`}
    >
      {children}
    </div>
  );
}

export function clientErrorMessage(code: string): string {
  return clientsAr.errors[code] ?? clientsAr.errors.rpc_failed;
}
