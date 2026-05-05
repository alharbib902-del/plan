'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { acceptOfferV2 } from '@/app/(admin)/admin/actions/trips';
import type { OfferSource } from '@/types/database';

/**
 * Unified accept button for the Phase 5 admin comparison view.
 *
 * Routes to either Phase 4 or Phase 5 offer table via the
 * `acceptOfferV2` Server Action's `offer_source` field.
 * The (future) trip detail page passes the source from each
 * row in `listOffersByTripUnified` so this component never
 * has to guess which table the offer lives in.
 */
export function AcceptOfferUnifiedButton({
  offerId,
  offerSource,
}: {
  offerId: string;
  offerSource: OfferSource;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleClick = () => {
    if (pending) return;
    if (
      !confirm(
        'هل أنت متأكد من قبول هذا العرض؟ سيتم رفض جميع العروض الأخرى تلقائيًا، وستُلغى أي روابط مشغّل لم تُستخدم بعد.'
      )
    ) {
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.append('offer_id', offerId);
    formData.append('offer_source', offerSource);

    startTransition(async () => {
      const result = await acceptOfferV2(formData);
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
    case 'unknown_source':
      return 'مصدر العرض غير معروف. حدّث الصفحة وحاول مجددًا.';
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
