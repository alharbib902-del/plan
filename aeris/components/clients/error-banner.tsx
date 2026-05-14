import { clientsAr } from '@/lib/i18n/clients-ar';

/**
 * Phase 9 PR 1 — shared inline banner for client-portal forms.
 * Mirror of `components/operator/error-banner.tsx`.
 */

interface ClientBannerProps {
  kind: 'error' | 'success';
  children: React.ReactNode;
}

export function ClientBanner({ kind, children }: ClientBannerProps) {
  const tone =
    kind === 'error'
      ? 'border-rose-400/40 bg-rose-500/10 text-rose-100'
      : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100';
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`font-ar rounded-lg border px-4 py-3 text-sm ${tone}`}
    >
      {children}
    </div>
  );
}

export function clientErrorMessage(code: string): string {
  return clientsAr.errors[code] ?? clientsAr.errors.rpc_failed;
}
