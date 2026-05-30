'use client';

import { useState } from 'react';

import { referralsAr } from '@/lib/i18n/referrals-ar';

/**
 * Phase 14 — referral code + share-link block with copy-to-clipboard.
 * Client component (needs navigator.clipboard); the code + share URL
 * are computed server-side and passed in.
 */
export function ReferralCodeCard({
  code,
  shareUrl,
}: {
  code: string;
  shareUrl: string;
}) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const copy = async (text: string, which: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard blocked (insecure context / permissions) — the code
      // is visible on screen, so the user can copy manually.
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-navy-card/40 p-5">
      <div>
        <span className="font-ar mb-1 block text-xs text-ink-muted">
          {referralsAr.yourCodeLabel}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <span
            dir="ltr"
            className="font-ar rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-lg tracking-widest text-gold-light"
          >
            {code}
          </span>
          <button
            type="button"
            onClick={() => copy(code, 'code')}
            className="font-ar rounded-lg border border-border px-3 py-2 text-sm text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light"
          >
            {copied === 'code' ? referralsAr.copied : referralsAr.copyCode}
          </button>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => copy(shareUrl, 'link')}
            className="font-ar rounded-lg border border-border px-3 py-2 text-sm text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light"
          >
            {copied === 'link' ? referralsAr.copied : referralsAr.copyLink}
          </button>
          <span
            dir="ltr"
            className="font-ar max-w-full truncate text-xs text-ink-muted"
          >
            {shareUrl}
          </span>
        </div>
        <p className="font-ar mt-2 text-xs text-ink-muted">
          {referralsAr.shareHint}
        </p>
      </div>
    </div>
  );
}
