import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, MessageCircle, ShieldCheck, UserRound } from 'lucide-react';
import { FlightRequestForm } from '@/components/forms/flight-request-form';
import { whatsappLink, formatPhone } from '@/lib/utils/format';
import {
  AERIS_CONTACT,
  AERIS_DEFAULT_WHATSAPP_MESSAGE,
} from '@/lib/config/contact';
import { listAirports } from '@/lib/supabase/queries/airports';

// Phase 6.0 PR 2 (S3): airports fetched server-side and shipped
// in the page bundle. Picker is purely client-render with no
// runtime fetch (RLS-public table; data is small and stable).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'اطلب رحلتك الخاصة',
  description:
    'املأ تفاصيل رحلتك الخاصة، ثم أرسلها مباشرة إلى فريق Aeris عبر واتساب — قناتنا التشغيلية الرسمية اليوم.',
};

const HIGHLIGHTS = [
  {
    icon: MessageCircle,
    title: 'واتساب هو الخطوة الأخيرة',
    description:
      'بعد تجهيز الطلب، تابع مباشرة مع فريق Aeris عبر واتساب لإيصاله فوراً.',
  },
  {
    icon: ShieldCheck,
    title: 'خصوصية عالية',
    description: 'بياناتك ومتطلباتك تبقى محفوظة بأعلى معايير السرية.',
  },
  {
    icon: UserRound,
    title: 'استجابة شخصية',
    description: 'فريق Aeris يتولّى طلبك بنفسه, بدون أتمتة وبدون تحويل.',
  },
];

export default async function RequestPage() {
  const airports = await listAirports({ privateCapable: true });
  return (
    <section className="relative pb-24 pt-32">
      <div
        aria-hidden
        className="absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(201,169,97,0.08), transparent 60%), linear-gradient(180deg, #050B14 0%, #0A1628 100%)',
        }}
      />

      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="font-ar group inline-flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-gold"
        >
          <ArrowLeft
            className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:rotate-180"
            aria-hidden
          />
          العودة للرئيسية
        </Link>

        <div className="mt-6 grid gap-12 lg:grid-cols-[1.1fr,1fr] lg:items-start">
          <div>
            <span className="font-ar inline-flex items-center rounded-full border border-gold/30 bg-gold/5 px-4 py-1.5 text-xs uppercase tracking-tagged text-gold-light">
              طلب رحلة خاصة
            </span>
            <h1 className="font-ar mt-6 text-3xl leading-tight text-ink sm:text-4xl md:text-5xl">
              أخبرنا عن رحلتك،
              <br />
              ودعنا نهتم بالباقي.
            </h1>
            <p className="font-ar mt-5 max-w-xl text-base leading-8 text-ink-secondary">
              يستغرق التعبئة أقل من دقيقتين. ثم تُرسل التفاصيل مباشرة إلى
              فريق Aeris عبر واتساب — قناتنا التشغيلية الرسمية اليوم.
            </p>

            <ul className="mt-10 space-y-5">
              {HIGHLIGHTS.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.title} className="flex items-start gap-4">
                    <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-gold">
                      <Icon className="h-5 w-5" aria-hidden />
                    </div>
                    <div>
                      <h3 className="font-ar text-base text-ink">
                        {item.title}
                      </h3>
                      <p className="font-ar mt-1 text-sm leading-7 text-ink-secondary">
                        {item.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-10 rounded-xl border border-border bg-navy-card/50 p-5">
              <p className="font-ar text-sm text-ink-secondary">
                تفضل الاتصال المباشر؟
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <Link
                  href={whatsappLink(AERIS_DEFAULT_WHATSAPP_MESSAGE)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-ar inline-flex items-center justify-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-5 py-2.5 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/20"
                  dir="ltr"
                >
                  واتساب · {formatPhone(AERIS_CONTACT.whatsappNumber)}
                </Link>
              </div>
            </div>
          </div>

          <div>
            <FlightRequestForm airports={airports} />
          </div>
        </div>
      </div>
    </section>
  );
}
