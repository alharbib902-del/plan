'use client';

import { useState, useTransition } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { promoteLead } from '@/app/(admin)/admin/actions/trips';
import {
  AIRCRAFT_CATEGORIES,
  AIRCRAFT_CATEGORY_LABEL_AR,
  type AircraftCategoryValue,
} from '@/lib/validators/promote-lead';
import type { TripPreferences } from '@/lib/validators/trip-preferences';
import { TripPreferencesFields } from '@/components/forms/trip-preferences-fields';
import { cn } from '@/lib/utils/cn';

interface PromoteLeadFormProps {
  leadId: string;
  leadTripType: 'one_way' | 'round_trip' | 'multi_city';
  alreadyConverted: boolean;
  // Phase 6.1 PR 2: customer-pre-filled preferences read
  // from lead_inquiries.preferences. The founder amends
  // before promoting. Strips the legacy lead_trip_type
  // key on display so the founder edits real preferences,
  // not the legacy injection that the RPC re-adds.
  initialPreferences: TripPreferences;
}

export function PromoteLeadForm({
  leadId,
  leadTripType,
  alreadyConverted,
  initialPreferences,
}: PromoteLeadFormProps) {
  const [aircraftCategory, setAircraftCategory] =
    useState<AircraftCategoryValue>('mid');
  const [specialRequests, setSpecialRequests] = useState('');
  // Phase 6.1 PR 2: pre-fill from lead.preferences (minus
  // the legacy lead_trip_type key — the RPC re-injects it).
  const [preferences, setPreferences] = useState<TripPreferences>(() => {
    const { lead_trip_type: _ignored, ...editable } = initialPreferences;
    return editable;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (alreadyConverted) {
    return (
      <div className="rounded-md border border-emerald-400/30 bg-emerald-500/5 p-4">
        <p className="font-ar text-sm text-emerald-200">
          تم تحويل هذا الطلب إلى طلب رحلة بالفعل.
        </p>
      </div>
    );
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.append('lead_id', leadId);
    formData.append('aircraft_category', aircraftCategory);
    if (specialRequests.trim().length > 0) {
      formData.append('special_requests', specialRequests);
    }
    // Phase 6.1 PR 2: serialize preferences as a single
    // JSON-string field. The Server Action JSON.parses +
    // tripPreferencesSchema.safeParse +
    // mergeTripPreferences before passing to the 6-arg
    // RPC. Empty object (no edits) → '{}', the default.
    formData.append('preferences', JSON.stringify(preferences));

    startTransition(async () => {
      const result = await promoteLead(formData);
      // promoteLead redirects on success — if we get here, it failed.
      if (!result.ok) {
        setError(translateError(result.error));
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {leadTripType === 'multi_city' && (
        <p className="font-ar rounded-md border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          هذا الطلب متعدد الوجهات. سيتم إنشاء طلب رحلة بمسار واحد فقط
          مبدئيًا، عدّل الـ legs يدويًا قبل الإرسال للمشغّل (محرّر المسارات
          سيتوفر في Phase 4.1).
        </p>
      )}

      <label className="block">
        <span className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
          فئة الطائرة المطلوبة
        </span>
        <select
          value={aircraftCategory}
          onChange={(e) =>
            setAircraftCategory(e.target.value as AircraftCategoryValue)
          }
          className={cn(
            'font-ar mt-1 block w-full rounded-md border border-border bg-navy-secondary/80 px-3 py-2 text-sm text-ink',
            'hover:border-gold/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40'
          )}
        >
          {AIRCRAFT_CATEGORIES.map((cat) => (
            <option key={cat} value={cat} className="bg-navy">
              {AIRCRAFT_CATEGORY_LABEL_AR[cat]}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
          متطلبات خاصة (اختياري)
        </span>
        <textarea
          value={specialRequests}
          onChange={(e) => setSpecialRequests(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="مثال: حيوان أليف، تموين خاص، VIP..."
          className="font-ar mt-1 block w-full rounded-md border border-border bg-navy-secondary/80 px-3 py-2 text-sm text-ink placeholder:text-ink-muted hover:border-gold/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
        />
      </label>

      {/* Phase 6.1 PR 2: structured customer preferences,
          pre-filled from lead.preferences when set on the
          public /request form, editable by the founder
          before promotion. Always-expanded (no collapsible
          wrapper) — admin sees the full state at a glance.
          Per spec S3. */}
      <div className="rounded-md border border-border bg-navy-secondary/40 p-4">
        <h4 className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
          تفضيلات العميل (اختياري)
        </h4>
        <div className="mt-3">
          <TripPreferencesFields
            value={preferences}
            onChange={setPreferences}
            disabled={pending}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="font-ar inline-flex w-full items-center justify-center gap-2 rounded-md border border-gold/50 bg-gold/10 px-4 py-2.5 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <ArrowRightLeft className="h-4 w-4" aria-hidden />
        )}
        تأكيد التحويل
      </button>

      {error && (
        <p className="font-ar text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function translateError(code: string): string {
  switch (code) {
    case 'invalid_input':
      return 'البيانات غير مكتملة. اختر فئة الطائرة على الأقل.';
    case 'lead_not_found':
      return 'تعذّر العثور على هذا الطلب. ربما حُذف.';
    case 'lead_not_promotable':
      return 'هذا الطلب لا يمكن تحويله (محوّل أو مغلق بالفعل).';
    case 'failed':
    default:
      return 'تعذّر تحويل الطلب الآن. حاول مرة أخرى.';
  }
}
