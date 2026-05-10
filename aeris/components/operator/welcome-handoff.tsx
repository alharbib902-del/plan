'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { operatorConsumeWelcomeToken } from '@/app/actions/operators-public';
import { OperatorBanner, operatorErrorMessage } from './error-banner';

const ar = operatorsAr.portal.welcome;

export function OperatorWelcomeHandoff({ rawToken }: { rawToken: string }) {
  const router = useRouter();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await operatorConsumeWelcomeToken({ raw_token: rawToken });
      if (cancelled) return;
      if (result.ok) {
        setDone(true);
        // Redirect: if password_must_change, go set password.
        const target = result.password_must_change
          ? '/operator/profile/password'
          : '/operator/dashboard';
        setTimeout(() => router.push(target), 800);
        router.refresh();
      } else {
        setErrorCode(result.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawToken, router]);

  if (errorCode) {
    return (
      <div className="space-y-4">
        <OperatorBanner kind="error">{operatorErrorMessage(errorCode)}</OperatorBanner>
        <Link
          href="/operator/login"
          className="font-ar inline-block text-sm text-gold-light hover:underline"
        >
          {operatorsAr.portal.login.submit}
        </Link>
      </div>
    );
  }

  if (done) {
    return <OperatorBanner kind="success">{ar.successMessage}</OperatorBanner>;
  }

  return (
    <p className="font-ar text-sm text-ink-secondary">{ar.subtitle}</p>
  );
}
