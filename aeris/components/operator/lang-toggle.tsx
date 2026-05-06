'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { type Lang, t } from '@/lib/i18n/operator';

/**
 * Operator portal language toggle (Phase 5.1, S6).
 *
 * Reads `?lang=` from the URL via useSearchParams, renders a
 * single anchor that flips to the other language. No cookies, no
 * localStorage — preference lives in the URL.
 *
 * `lang=ar` is the default; the toggle drops the param when
 * switching back to AR so the URL stays clean.
 */
export function LangToggle({ currentLang }: { currentLang: Lang }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const targetLang: Lang = currentLang === 'ar' ? 'en' : 'ar';

  const params = new URLSearchParams(searchParams.toString());
  if (targetLang === 'ar') {
    params.delete('lang');
  } else {
    params.set('lang', targetLang);
  }
  const query = params.toString();
  const href = query ? `${pathname}?${query}` : pathname;

  const label =
    targetLang === 'en' ? t('lang_toggle_to_en', currentLang) : t('lang_toggle_to_ar', currentLang);

  return (
    <Link
      href={href}
      prefetch={false}
      className="font-ar inline-flex items-center justify-center rounded-md border border-gold/40 bg-navy-card/60 px-3 py-1.5 text-xs text-gold-light transition-colors hover:border-gold hover:bg-gold/10"
      aria-label={
        targetLang === 'en'
          ? 'Switch to English'
          : 'Switch to Arabic / التبديل إلى العربية'
      }
    >
      {label}
    </Link>
  );
}
