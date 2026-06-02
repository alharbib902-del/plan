'use client';

import { useEffect } from 'react';

/**
 * Global error boundary — the ONLY thing rendered when the root layout
 * itself throws, so it must supply its own <html>/<body> and cannot rely
 * on globals.css or the root layout being present. Styles are therefore
 * inline (brand navy + gold) to stay self-contained and robust even if
 * the stylesheet failed to load.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // TODO(REA-01): wire captureException once error monitoring lands.
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(201,169,97,0.08), transparent 60%), linear-gradient(180deg, #050B14 0%, #0A1628 100%)',
          color: '#FAFAFA',
          fontFamily: "'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif",
          lineHeight: 1.75,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '28rem',
            textAlign: 'center',
            border: '1px solid rgba(201,169,97,0.3)',
            background: 'rgba(13,27,48,0.6)',
            borderRadius: '1rem',
            padding: '2rem',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', margin: 0, color: '#FAFAFA' }}>
            حدث خطأ غير متوقّع
          </h1>
          <p
            style={{
              marginTop: '0.75rem',
              fontSize: '0.875rem',
              color: '#A8B2C1',
            }}
          >
            نعتذر، واجهنا مشكلة غير متوقّعة. جرّب إعادة التحميل، وإن استمرّت
            المشكلة تواصل معنا عبر واتساب.
          </p>
          {error?.digest ? (
            <p
              dir="ltr"
              style={{
                marginTop: '0.5rem',
                fontSize: '0.75rem',
                color: 'rgba(168,178,193,0.7)',
              }}
            >
              ref: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '0.375rem',
              border: '1px solid rgba(201,169,97,0.4)',
              background: 'rgba(201,169,97,0.1)',
              color: '#E8D4A8',
              padding: '0.5rem 1.25rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
