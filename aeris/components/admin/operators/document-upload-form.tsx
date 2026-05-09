'use client';

import { useState, useTransition, useRef } from 'react';
import { Upload } from 'lucide-react';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { adminUploadOperatorDocument } from '@/app/actions/operators';
import type { OperatorDocumentType } from '@/types/database';

type Toast =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }
  | null;

function errorMessage(code?: string): string {
  if (!code) return operatorsAr.errors.unknown;
  const map = operatorsAr.errors as Record<string, string>;
  if (code === 'unsupported_mime') return 'الملف يجب أن يكون PDF أو صورة.';
  if (code === 'file_too_large') return 'الملف أكبر من 20 ميغابايت.';
  if (code === 'file_required') return 'الرجاء اختيار ملف.';
  return map[code] ?? `${operatorsAr.errors.unknown} (${code})`;
}

const DOC_TYPES: { value: OperatorDocumentType; label: string }[] = [
  { value: 'commercial_registration', label: operatorsAr.forms.documentTypes.commercial_registration },
  { value: 'gaca_license', label: operatorsAr.forms.documentTypes.gaca_license },
  { value: 'license_expiry_proof', label: operatorsAr.forms.documentTypes.license_expiry_proof },
];

export function DocumentUploadForm({ operatorId }: { operatorId: string }) {
  const [isPending, startTransition] = useTransition();
  const [docType, setDocType] = useState<OperatorDocumentType>('commercial_registration');
  const [file, setFile] = useState<File | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setToast({ kind: 'error', message: errorMessage('file_required') });
      return;
    }
    setToast(null);
    const formData = new FormData();
    formData.set('operator_id', operatorId);
    formData.set('document_type', docType);
    formData.set('file', file);

    startTransition(async () => {
      const result = await adminUploadOperatorDocument(formData);
      if (result.ok) {
        setToast({ kind: 'success', message: operatorsAr.toasts.documentUploaded });
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        setToast({ kind: 'error', message: errorMessage(result.error) });
      }
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-border bg-navy-card/40 p-5"
    >
      <h3 className="font-ar text-base font-medium text-ink-primary">
        {operatorsAr.actions.uploadDocument}
      </h3>

      {toast ? (
        <div
          className={`font-ar rounded-lg border px-3 py-2 text-sm ${
            toast.kind === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-100'
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <div>
        <label htmlFor="doc-type" className="font-ar mb-1 block text-xs text-ink-muted">
          {operatorsAr.forms.documentTypeLabel}
        </label>
        <select
          id="doc-type"
          value={docType}
          onChange={(e) => setDocType(e.target.value as OperatorDocumentType)}
          className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
          disabled={isPending}
        >
          {DOC_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="doc-file" className="font-ar mb-1 block text-xs text-ink-muted">
          {operatorsAr.forms.documentFileLabel}
        </label>
        <input
          ref={fileInputRef}
          id="doc-file"
          type="file"
          accept="application/pdf,image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="font-ar block w-full text-sm text-ink-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-gold/15 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gold-light hover:file:bg-gold/25"
          disabled={isPending}
        />
        {file ? (
          <p className="font-ar mt-2 text-xs text-ink-muted">
            {file.name} · {(file.size / 1024).toFixed(1)} KB
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isPending || !file}
        className="font-ar inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gold/40 bg-gold/15 px-4 py-2.5 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60"
      >
        <Upload className="h-4 w-4" aria-hidden />
        {isPending ? '…' : operatorsAr.actions.uploadDocument}
      </button>
    </form>
  );
}
