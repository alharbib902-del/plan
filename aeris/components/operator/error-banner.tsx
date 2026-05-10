import { operatorsAr } from '@/lib/i18n/operators-ar';

export function operatorErrorMessage(code: string | null | undefined): string {
  if (!code) return operatorsAr.portal.errors.unknown;
  const map = operatorsAr.portal.errors as Record<string, string>;
  return map[code] ?? `${operatorsAr.portal.errors.unknown} (${code})`;
}

interface BannerProps {
  kind: 'success' | 'error' | 'warning';
  children: React.ReactNode;
}

export function OperatorBanner({ kind, children }: BannerProps) {
  const cls =
    kind === 'success'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
      : kind === 'warning'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
      : 'border-rose-500/40 bg-rose-500/10 text-rose-100';
  return (
    <div className={`font-ar rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}
