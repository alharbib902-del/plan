'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { type Lang, parseLang, t } from '@/lib/i18n/operator';

/**
 * Operator portal language-aware header (Phase 5.1, S6).
 *
 * Co-located with LangToggle because both need `useSearchParams`
 * (App Router layouts cannot read searchParams; this wrapper is
 * the bridge from the Server-Component layout to the URL reader).
 * Renders the AERIS title + translated tagline + the LangToggle
 * button. The `dir` attribute on the wrapping element flips with
 * the language.
 */
export function OperatorPortalHeader() {
  const searchParams = useSearchParams();
  const lang = parseLang(searchParams.get('lang'));

  return (
    <header
      lang={lang}
      dir={lang === 'en' ? 'ltr' : 'rtl'}
      className="relative mb-8"
    >
      <div className="absolute end-0 top-0">
        <LangToggle currentLang={lang} />
      </div>
      <div className="text-center">
        <span className="font-display text-2xl tracking-[0.28em] text-gold-light">
          AERIS
        </span>
        <p className="font-ar mt-2 text-xs uppercase tracking-tagged text-ink-muted">
          {t('portal_tagline', lang)}
        </p>
      </div>
    </header>
  );
}

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
