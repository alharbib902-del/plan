'use client';

import { useSearchParams } from 'next/navigation';

import { LangToggle } from '@/components/operator/lang-toggle';
import { parseLang, t } from '@/lib/i18n/operator';

/**
 * Operator portal header (Phase 5.1).
 *
 * Client component because it needs `useSearchParams()` to read
 * the active language. The layout (Server Component) cannot read
 * searchParams in App Router, so the language-aware chrome lives
 * here. The page also reads searchParams independently for its
 * own server-rendered children — both come from the same URL,
 * so the two readers never disagree.
 *
 * The `dir` attribute on the wrapping element flips with the
 * language so the AERIS title block centers correctly and the
 * toggle anchors to the visual end (right in RTL, left in LTR).
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
