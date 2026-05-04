'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { acceptOffer } from '@/app/(admin)/admin/actions/trips';

export function AcceptOfferButton({ offerId }: { offerId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleClick = () => {
    if (pending) return;
    if (!confirm('هل أنت متأكد من قبول هذا العرض؟ سيتم رفض جميع العروض الأخرى تلقائيًا.')) {
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.append('offer_id', offerId);

    startTransition(async () => {
      const result = await acceptOffer(formData);
      if (!result.ok) {
        setError(translateError(result.error));
      }
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="font-ar inline-flex w-full items-center justify-center gap-2 rounded-md border border-emerald-400/50 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200 transition-all hover:border-emerald-400 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Check className="h-4 w-4" aria-hidden />
        )}
        قبول العرض
      </button>
      {error && (
        <p className="font-ar text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function translateError(code: string): string {
  switch (code) {
    case 'invalid_input':
      return 'تعذّر التعرّف على العرض.';
    case 'offer_expired':
      return 'انتهت صلاحية هذا العرض. تم تحديث حالته إلى "منتهي".';
    case 'offer_not_pending':
      return 'هذا العرض لم يعد قيد المراجعة (ربما قُبل أو رُفض من قِبل أدمن آخر).';
    case 'trip_not_open':
      return 'الرحلة لم تعد قابلة للحجز (ربما تم حجزها أو إلغاؤها).';
    case 'failed':
    default:
      return 'تعذّر قبول العرض الآن. حاول مرة أخرى.';
  }
}
