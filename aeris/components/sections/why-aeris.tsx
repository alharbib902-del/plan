import { ShieldCheck, Sparkles, Clock, Globe2 } from 'lucide-react';

const PILLARS = [
  {
    icon: ShieldCheck,
    title: 'سرية وموثوقية',
    description:
      'نحفظ بياناتك ومتطلباتك بسرية تامة، مع تحقق دقيق من جميع المشغّلين والطائرات قبل أي رحلة.',
  },
  {
    icon: Sparkles,
    title: 'تجربة فاخرة من البداية',
    description:
      'اهتمام بالتفاصيل — من حجز السيارة الفارهة إلى الضيافة على متن الطائرة وفق ذوقك.',
  },
  {
    icon: Clock,
    title: 'استجابة شخصية',
    description:
      'فريق Aeris يتابع طلبك مباشرة عبر واتساب، بدون أتمتة وبدون تحويل.',
  },
  {
    icon: Globe2,
    title: 'تغطية محلية وخليجية',
    description:
      'انطلاق من جميع مطارات المملكة الرئيسية ووصول إلى الوجهات الخليجية والعالمية.',
  },
];

export function WhyAeris() {
  return (
    <section
      id="why"
      className="relative border-y border-border bg-navy-secondary py-20 sm:py-24 lg:py-28"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <span className="font-ar inline-flex items-center rounded-full border border-gold/30 bg-gold/5 px-4 py-1.5 text-xs uppercase tracking-tagged text-gold-light">
              لماذا Aeris
            </span>
            <h2 className="font-ar mt-6 text-3xl leading-tight text-ink sm:text-4xl md:text-5xl">
              معيار جديد للطيران الخاص في المملكة
            </h2>
            <p className="font-ar mt-5 max-w-xl text-base leading-8 text-ink-secondary">
              بنيت Aeris لتجمع بين أفضل المشغّلين وأكثر العملاء تطلباً عبر
              تجربة رقمية أنيقة وعملية تشغيلية محكمة، بإشراف مباشر من فريق
              متخصص.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-navy-card/60 p-5">
                <div className="font-ar text-base font-medium text-gold-light">
                  شبكة قيد الاعتماد
                </div>
                <div className="font-ar mt-2 text-sm leading-7 text-ink-secondary">
                  مشغّلون منتقَون يدوياً قبل أي رحلة.
                </div>
              </div>
              <div className="rounded-lg border border-border bg-navy-card/60 p-5">
                <div className="font-ar text-base font-medium text-gold-light">
                  تشغيل بإشراف مباشر
                </div>
                <div className="font-ar mt-2 text-sm leading-7 text-ink-secondary">
                  فريق Aeris يتولّى كل طلب شخصياً.
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <div
                  key={pillar.title}
                  className="rounded-xl border border-border bg-navy-card/40 p-6 transition-all hover:border-gold/40"
                >
                  <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-gold">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="font-ar text-lg text-ink">{pillar.title}</h3>
                  <p className="font-ar mt-2 text-sm leading-7 text-ink-secondary">
                    {pillar.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
