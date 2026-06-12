import { Send, Inbox, BadgeCheck, Plane } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Step = {
  icon: LucideIcon;
  title: string;
  description: string;
};

const STEPS: Step[] = [
  {
    icon: Send,
    title: 'اطلب رحلتك',
    description:
      'حدّد وجهتك وتاريخك وعدد الركاب عبر نموذج واحد بسيط — أو تواصل معنا مباشرة عبر واتساب.',
  },
  {
    icon: Inbox,
    title: 'استقبل عروض المشغّلين',
    description:
      'يوزّع فريق Aeris طلبك على مشغّلين معتمدين فقط، وتصلك عروض حقيقية قابلة للمقارنة.',
  },
  {
    icon: BadgeCheck,
    title: 'قارن واختر بثقة',
    description:
      'أسعار وطائرات بشفافية كاملة — اقبل العرض الأنسب لك بضغطة واحدة، وفريقنا يتولى التنسيق.',
  },
  {
    icon: Plane,
    title: 'حلّق وأنت مطمئن',
    description:
      'نتابع رحلتك حتى الهبوط، ويُضاف كاش باك Privilege إلى محفظتك بعد كل رحلة مدفوعة.',
  },
];

export function HowItWorks() {
  return (
    <section className="border-y border-border bg-navy-secondary/40 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <span className="font-ar inline-flex items-center rounded-full border border-gold/30 bg-gold/5 px-4 py-1.5 text-xs uppercase tracking-tagged text-gold-light">
            كيف نعمل
          </span>
          <h2 className="font-ar mt-6 text-3xl leading-tight text-ink sm:text-4xl">
            من الطلب إلى الإقلاع في أربع خطوات
          </h2>
          <p className="font-ar mx-auto mt-4 max-w-2xl text-sm leading-7 text-ink-secondary sm:text-base">
            صمّمنا الرحلة كاملة لتكون بسيطة عليك ودقيقة خلف الكواليس — بإشراف
            بشري مباشر في كل خطوة.
          </p>
        </div>

        <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className="relative flex flex-col rounded-xl border border-border bg-navy-card/60 p-6 backdrop-blur-sm transition-all hover:border-gold/40"
              >
                <div className="mb-5 flex items-center justify-between">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-gold">
                    <Icon className="h-6 w-6" aria-hidden />
                  </span>
                  <span
                    aria-hidden
                    className="font-display text-4xl leading-none text-gold/20"
                  >
                    {i + 1}
                  </span>
                </div>
                <h3 className="font-ar text-lg text-ink">{step.title}</h3>
                <p className="font-ar mt-2 text-sm leading-7 text-ink-secondary">
                  {step.description}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
