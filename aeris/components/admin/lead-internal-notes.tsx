'use client';

import { useRef, useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { appendInternalNote } from '@/app/(admin)/admin/actions/leads';

export function LeadInternalNotes({
  leadId,
  existingNotes,
}: {
  leadId: string;
  existingNotes: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const note = ((formData.get('note') as string | null) ?? '').trim();
    if (note.length === 0) {
      setError('من فضلك اكتب ملاحظة قبل الحفظ.');
      return;
    }
    if (note.length > 2000) {
      setError('الملاحظة طويلة جداً (الحد الأقصى 2000 حرف).');
      return;
    }
    setError(null);
    formData.set('id', leadId);

    startTransition(async () => {
      const result = await appendInternalNote(formData);
      if (!result.ok) {
        setError('تعذّر حفظ الملاحظة. حاول مرة أخرى.');
        return;
      }
      formRef.current?.reset();
    });
  };

  return (
    <div className="rounded-xl border border-border bg-navy-card/40 p-5">
      <h3 className="font-ar text-base font-medium text-ink">ملاحظات داخلية</h3>
      <p className="font-ar mt-1 text-xs text-ink-muted">
        ملاحظات الفريق فقط — لا تظهر للعميل.
      </p>

      {existingNotes && existingNotes.trim().length > 0 ? (
        <pre
          dir="auto"
          className="font-ar mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-navy-secondary/60 p-3 text-xs leading-6 text-ink-secondary"
        >
          {existingNotes}
        </pre>
      ) : (
        <p className="font-ar mt-4 rounded-md border border-dashed border-border bg-navy-secondary/40 p-3 text-xs text-ink-muted">
          لا توجد ملاحظات بعد.
        </p>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="mt-4 space-y-3">
        <textarea
          name="note"
          rows={3}
          maxLength={2000}
          placeholder="أضف ملاحظة جديدة (مثل: تواصلت مع العميل عبر واتساب)..."
          aria-label="ملاحظة جديدة"
          className="font-ar block w-full rounded-md border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink placeholder:text-ink-muted/70 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
        />
        {error && (
          <p className="font-ar text-xs text-red-300">{error}</p>
        )}
        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={pending}
            className="font-ar inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-5 py-2 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            )}
            حفظ الملاحظة
          </button>
        </div>
      </form>
    </div>
  );
}
