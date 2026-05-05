'use client';

import { WifiOff } from 'lucide-react';

/**
 * Offline card — shown by `app/offline/page.tsx`. Client component
 * only because the Retry button needs `window.location.reload()`.
 * Brand-only; intentionally has no link to admin or auth surfaces
 * (offline + auth = false security signal).
 */
export function OfflineCard() {
  const onRetry = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <div className="w-full rounded-2xl border border-gold/30 bg-navy-card/60 p-8 text-center shadow-luxury">
      <div className="mx-auto mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-gold">
        <WifiOff className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="font-ar text-xl text-ink">أنت غير متصل بالإنترنت</h1>
      <p className="font-ar mt-3 text-sm leading-7 text-ink-secondary">
        سيعود Aeris بمجرد رجوع الاتصال. لا حاجة لإعادة تسجيل الدخول أو
        البدء من جديد.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="font-ar mt-6 inline-flex items-center justify-center rounded-md border border-gold/40 bg-gold/10 px-5 py-2 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/20"
      >
        إعادة المحاولة
      </button>
    </div>
  );
}
