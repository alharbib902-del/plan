import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { AERIS_CONTACT } from '@/lib/config/contact';

export function ExpiredLink() {
  const founderWaUrl = `https://wa.me/${AERIS_CONTACT.whatsappNumber}`;

  return (
    <div className="relative min-h-screen bg-navy">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(201,169,97,0.08), transparent 60%), linear-gradient(180deg, #050B14 0%, #0A1628 100%)',
        }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-md items-center justify-center px-4 py-16 sm:px-6">
        <div className="w-full rounded-2xl border border-gold/30 bg-navy-card/60 p-8 text-center shadow-luxury">
          <div className="mx-auto mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-gold">
            <ShieldAlert className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="font-ar text-xl text-ink">
            هذا الرابط منتهي الصلاحية
          </h1>
          <p className="font-ar mt-3 text-sm leading-7 text-ink-secondary">
            الرابط الذي وصلك لم يعد صالحًا — ربما انتهت مدته أو تم استبداله
            برابط أحدث.
          </p>
          <p className="font-ar mt-3 text-xs text-ink-muted">
            للاستفسار، تواصل معنا مباشرة عبر واتساب.
          </p>
          <Link
            href={founderWaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-ar mt-6 inline-flex items-center justify-center rounded-md border border-gold/40 bg-gold/10 px-5 py-2 text-sm text-gold-light hover:border-gold hover:bg-gold/20"
          >
            تواصل عبر واتساب
          </Link>
        </div>
      </div>
    </div>
  );
}
