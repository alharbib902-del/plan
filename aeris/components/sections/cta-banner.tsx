import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { whatsappLink } from '@/lib/utils/format';
import { AERIS_DEFAULT_WHATSAPP_MESSAGE } from '@/lib/config/contact';

export function CtaBanner() {
  return (
    <section className="relative bg-navy py-20 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div
          className="relative overflow-hidden rounded-2xl border border-gold/25 bg-navy-card/70 p-8 shadow-luxury sm:p-12 md:p-16"
          style={{
            backgroundImage:
              'radial-gradient(ellipse at 20% 0%, rgba(201,169,97,0.10), transparent 60%)',
          }}
        >
          <div className="text-center">
            <h2 className="font-ar text-3xl leading-tight text-ink sm:text-4xl md:text-5xl">
              جاهز لتجربة طيران خاص لا تُنسى؟
            </h2>
            <p className="font-ar mx-auto mt-4 max-w-2xl text-base leading-8 text-ink-secondary">
              شاركنا تفاصيل رحلتك ثم أرسلها مباشرة إلى فريق Aeris عبر واتساب
              — قناتنا التشغيلية الرسمية اليوم.
            </p>

            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <Link
                href="/request"
                className="font-ar group inline-flex items-center justify-center gap-2 rounded-md bg-gold-shine px-8 py-4 text-base font-medium text-navy shadow-gold transition-all hover:shadow-gold-glow"
              >
                ابدأ طلب الرحلة
                <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1 rtl:rotate-180" />
              </Link>
              <Link
                href={whatsappLink(AERIS_DEFAULT_WHATSAPP_MESSAGE)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-ar inline-flex items-center justify-center gap-2 rounded-md border border-gold/40 px-8 py-4 text-base text-gold-light transition-all hover:border-gold hover:bg-gold/10"
              >
                تواصل عبر واتساب
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
