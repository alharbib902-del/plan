import Link from 'next/link';
import { Plane, Repeat, HeartPulse, Package, Handshake, ArrowLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Service = {
  icon: LucideIcon;
  title: string;
  description: string;
  highlights: string[];
  cta: { href: string; label: string };
  external?: boolean;
};

const SERVICES: Service[] = [
  {
    icon: Plane,
    title: 'الرحلات المخصصة (Charter)',
    description:
      'احجز طائرتك الخاصة لأي وجهة، بمواصفات تختارها — من الطائرات الخفيفة إلى الكبيرة لرحلات بعيدة المدى.',
    highlights: [
      'أسطول متعدد الفئات',
      'طاقم محترف يتحدث لغتك',
      'انطلاق من أي مطار خاص في المملكة',
    ],
    cta: { href: '/request', label: 'اطلب رحلتك' },
  },
  {
    icon: Repeat,
    title: 'الرحلات الفارغة (Empty Legs)',
    description:
      'فرص الرحلات الفارغة بأسعار مخفّضة بعد عودة الطائرة من رحلة سابقة — تجربة فاخرة بنصف التكلفة.',
    highlights: [
      'خصومات تصل إلى 60٪',
      'إشعارات فورية للوجهات',
      'مرونة في تواريخ الإقلاع',
    ],
    cta: { href: '/request', label: 'استعلم عن المتاح' },
  },
  {
    icon: HeartPulse,
    title: 'الإخلاء الطبي (MedEvac)',
    description:
      'نقل المرضى بطائرات مجهّزة طبياً مع طاقم تخصصي، بتنسيق محلي ودولي.',
    highlights: [
      'تنسيق طبي عبر مشغّلين معتمدين',
      'مستويات خدمة BMT • ALS • CCT',
      'تنسيق مع المستشفيات والتأمين',
    ],
    // Round 1 PR #76 P2 #4 fix — when ENABLE_MEDEVAC=true, route
    // to the real /medevac intake (Phase 12 PR 1 §4.1
    // create_medevac_request_guest); otherwise fall back to
    // /request so the CTA is never broken if the medevac flag is
    // off. Mirrors the cargo CTA pattern above + matches the
    // gating discipline used by the /medevac page itself and the
    // /admin/medevac pages.
    cta:
      process.env.ENABLE_MEDEVAC === 'true'
        ? { href: '/medevac', label: 'احجز إخلاء طبي' }
        : { href: '/request', label: 'احجز إخلاء طبي' },
  },
  {
    icon: Package,
    title: 'الشحن المتخصص (Cargo)',
    description:
      'شحن جوي للخيول والسيارات الفاخرة والمقتنيات الثمينة بمعايير سرية وأمان عالية.',
    highlights: [
      'نقل الخيول والحيوانات الأليفة',
      'سيارات وعربات نادرة',
      'مقتنيات حساسة الوقت والقيمة',
    ],
    // Round 2 PR #65 P2 #1 — when ENABLE_CARGO=true, route to the
    // real /cargo intake (Phase 11 PR 1 §4.1 create_cargo_request_guest);
    // otherwise fall back to /request so the CTA is never broken if
    // the cargo flag is off in any environment. process.env is read
    // at module load (Server Component → build-time substitution by
    // Next.js), matching the gating discipline used by the
    // /cargo page itself and the /admin/cargo pages.
    cta:
      process.env.ENABLE_CARGO === 'true'
        ? { href: '/cargo', label: 'اطلب عرض شحن' }
        : { href: '/request', label: 'اطلب عرض شحن' },
  },
  {
    icon: Handshake,
    title: 'شراكة المشغّلين (Operators)',
    description:
      'هل لديك أسطول طائرات خاصة؟ انضم إلى شبكة Aeris لتلقي طلبات الرحلات وتوزيع رحلاتك الفارغة.',
    highlights: [
      'طلبات مستهدفة بمواصفات واضحة',
      'لوحة تحكم لإدارة العروض',
      'تسوية مالية شفافة',
    ],
    cta: {
      href: 'mailto:partners@aeris.sa?subject=Aeris%20Operator%20Partnership',
      label: 'انضم كمشغّل',
    },
    external: true,
  },
];

export function Services() {
  return (
    <section
      id="services"
      className="relative bg-navy py-20 sm:py-24 lg:py-28"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <span className="font-ar inline-flex items-center rounded-full border border-gold/30 bg-gold/5 px-4 py-1.5 text-xs uppercase tracking-tagged text-gold-light">
            خدماتنا
          </span>
          <h2 className="font-ar mt-6 text-3xl leading-tight text-ink sm:text-4xl md:text-5xl">
            خمس خدمات. تجربة واحدة لا تُنسى.
          </h2>
          <p className="font-ar mx-auto mt-4 max-w-2xl text-sm leading-7 text-ink-secondary sm:text-base">
            من أول طلب رحلة حتى الهبوط، نوفر لك تجربة طيران خاص متكاملة
            بمعايير الضيافة السعودية الفاخرة.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((service) => {
            const Icon = service.icon;
            return (
              <article
                key={service.title}
                className="group relative flex flex-col rounded-xl border border-border bg-navy-card/60 p-6 backdrop-blur-sm transition-all hover:border-gold/40 hover:shadow-gold sm:p-7"
              >
                <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-gold">
                  <Icon className="h-6 w-6" aria-hidden />
                </div>

                <h3 className="font-ar text-xl text-ink sm:text-2xl">
                  {service.title}
                </h3>
                <p className="font-ar mt-3 text-sm leading-7 text-ink-secondary">
                  {service.description}
                </p>

                <ul className="mt-5 space-y-2">
                  {service.highlights.map((highlight) => (
                    <li
                      key={highlight}
                      className="font-ar flex items-start gap-2 text-sm text-ink-secondary"
                    >
                      <span
                        aria-hidden
                        className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-gold"
                      />
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6 pt-6">
                  <Link
                    href={service.cta.href}
                    target={service.external ? '_blank' : undefined}
                    rel={service.external ? 'noopener noreferrer' : undefined}
                    className="font-ar inline-flex items-center gap-2 text-sm text-gold transition-colors hover:text-gold-light"
                  >
                    {service.cta.label}
                    <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
