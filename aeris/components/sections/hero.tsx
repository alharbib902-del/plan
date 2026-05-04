import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { whatsappLink } from '@/lib/utils/format';
import { AERIS_DEFAULT_WHATSAPP_MESSAGE } from '@/lib/config/contact';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 30%, rgba(201,169,97,0.10), transparent 60%), radial-gradient(ellipse at 20% 80%, rgba(201,169,97,0.04), transparent 50%), linear-gradient(180deg, #050B14 0%, #0A1628 60%, #050B14 100%)',
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-7xl flex-col items-center justify-center px-4 pb-20 pt-32 text-center sm:px-6 lg:px-8">
        <span className="font-ar mb-6 inline-flex items-center rounded-full border border-gold/30 bg-gold/5 px-4 py-1.5 text-xs uppercase tracking-tagged text-gold-light">
          الطيران الخاص في المملكة
        </span>

        <h1
          className="font-display text-5xl font-normal leading-[0.95] tracking-[0.18em] sm:text-7xl md:text-8xl"
          style={{
            background:
              'linear-gradient(180deg, #E8D4A8 0%, #C9A961 50%, #8B7339 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          AERIS
        </h1>

        <div className="my-8 h-px w-32 bg-gradient-to-r from-transparent via-gold to-transparent opacity-60" />

        <h2 className="font-ar mx-auto max-w-3xl text-2xl leading-snug text-ink sm:text-3xl md:text-5xl">
          الفضاء يبدأ من هنا
        </h2>

        <p className="font-ar mx-auto mt-6 max-w-2xl text-base leading-8 text-ink-secondary sm:text-lg">
          منصة ذكية متكاملة للطيران الخاص في المملكة العربية السعودية.
          رحلات مخصصة، رحلات الإياب الفارغة، إخلاء طبي، وشحن متخصص — بإشراف
          مباشر من فريق Aeris.
        </p>

        <div className="mt-10 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
          <Link
            href="/request"
            className="font-ar group inline-flex items-center justify-center gap-2 rounded-md bg-gold-shine px-8 py-4 text-base font-medium text-navy shadow-gold transition-all hover:shadow-gold-glow"
          >
            اطلب رحلتك الخاصة
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1 rtl:rotate-180" />
          </Link>

          <Link
            href={whatsappLink(AERIS_DEFAULT_WHATSAPP_MESSAGE)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-ar inline-flex items-center justify-center gap-2 rounded-md border border-gold/40 bg-transparent px-8 py-4 text-base text-gold-light transition-all hover:border-gold hover:bg-gold/10"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            تواصل عبر واتساب
          </Link>
        </div>

        <dl className="mt-16 grid w-full max-w-3xl grid-cols-2 gap-6 border-t border-border pt-10 sm:grid-cols-4">
          {[
            { value: 'بإشراف مباشر', label: 'فريق Aeris يتابع كل طلب' },
            { value: 'خصوصية عالية', label: 'بياناتك ومتطلباتك محفوظة' },
            { value: 'استجابة شخصية', label: 'تواصل مباشر بدون أتمتة' },
            { value: 'تغطية خليجية', label: 'المملكة ودول الخليج' },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <dt className="font-ar text-base font-medium text-gold-light sm:text-lg">
                {stat.value}
              </dt>
              <dd className="font-ar mt-1 text-xs text-ink-muted">
                {stat.label}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
