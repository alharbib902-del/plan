import { FileText, Download } from 'lucide-react';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { createAdminClient } from '@/lib/supabase/admin';
import type { OperatorDocumentRow } from '@/types/database';

const STORAGE_BUCKET = 'operator-documents';
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const TYPE_LABELS = operatorsAr.forms.documentTypes;

interface DocumentListProps {
  documents: OperatorDocumentRow[];
}

/**
 * Server component — generates a fresh signed URL per document
 * on every render (1-hour TTL). Re-renders refresh the URLs
 * automatically thanks to noStore() in the parent page module.
 */
export async function DocumentList({ documents }: DocumentListProps) {
  if (documents.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-navy-card/40 p-8 text-center">
        <FileText className="mx-auto mb-3 h-8 w-8 text-ink-muted" aria-hidden />
        <p className="font-ar text-sm text-ink-muted">
          لا توجد وثائق مرفوعة بعد.
        </p>
      </div>
    );
  }

  const client = createAdminClient();
  const enriched = await Promise.all(
    documents.map(async (doc) => {
      const { data } = await client.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
      return { doc, signed_url: data?.signedUrl ?? null };
    })
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-navy-card/40">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-navy-secondary/40">
            <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
              النوع
            </th>
            <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
              اسم الملف
            </th>
            <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
              الحجم
            </th>
            <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
              تاريخ الرفع
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {enriched.map(({ doc, signed_url }) => (
            <tr key={doc.id} className="border-b border-border/50 last:border-0">
              <td className="px-4 py-3">
                <span className="font-ar text-sm text-ink-primary">
                  {TYPE_LABELS[doc.document_type]}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-ink-secondary">{doc.file_name}</td>
              <td className="px-4 py-3 text-xs text-ink-muted">
                {formatBytes(doc.file_size)}
              </td>
              <td className="px-4 py-3 text-xs text-ink-muted">
                {formatDate(doc.uploaded_at)}
              </td>
              <td className="px-4 py-3 text-end">
                {signed_url ? (
                  <a
                    href={signed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-ar inline-flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs text-gold-light transition-colors hover:bg-gold/20"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    عرض
                  </a>
                ) : (
                  <span className="font-ar text-xs text-rose-200">تعذّر إنشاء الرابط</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
