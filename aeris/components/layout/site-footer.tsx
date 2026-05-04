import Link from 'next/link';
import { whatsappLink, formatPhone } from '@/lib/utils/format';
import {
  AERIS_CONTACT,
  AERIS_DEFAULT_WHATSAPP_MESSAGE,
} from '@/lib/config/contact';

const FOOTER_LINKS = [
  { href: '/#services', label: 'الخدمات' },
  { href: '/#why', label: 'لماذا Aeris' },
  { href: '/request', label: 'اطلب رحلة' },
];

export function SiteFooter() {
  return (
    <footer
      id="contact"
      className="relative border-t border-border bg-navy-secondary"
    >
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-3 lg:px-8">
        <div>
          <div className="font-display text-3xl tracking-[0.28em] text-gold-light">
            AERIS
          </div>
          <p className="font-ar mt-4 max-w-sm text-sm leading-7 text-ink-secondary">
            منصة ذكية متكاملة للطيران الخاص في المملكة العربية السعودية
            ومنطقة الخليج.
          </p>
        </div>

        <div>
          <h4 className="font-ar text-sm font-semibold uppercase tracking-tagged text-gold">
            روابط سريعة
          </h4>
          <ul className="mt-4 space-y-3">
            {FOOTER_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="font-ar text-sm text-ink-secondary transition-colors hover:text-gold"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="font-ar text-sm font-semibold uppercase tracking-tagged text-gold">
            تواصل معنا
          </h4>
          <ul className="mt-4 space-y-3">
            <li>
              <Link
                href={whatsappLink(AERIS_DEFAULT_WHATSAPP_MESSAGE)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-ar text-sm text-ink-secondary transition-colors hover:text-gold"
                dir="ltr"
              >
                {formatPhone(AERIS_CONTACT.whatsappNumber)}
              </Link>
            </li>
            <li>
              <a
                href={`mailto:${AERIS_CONTACT.email}`}
                className="font-ar text-sm text-ink-secondary transition-colors hover:text-gold"
                dir="ltr"
              >
                {AERIS_CONTACT.email}
              </a>
            </li>
            <li className="font-ar text-sm text-ink-muted">
              قناتنا التشغيلية الرسمية حالياً • الرياض
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-6 sm:flex-row sm:px-6 lg:px-8">
          <p className="font-ar text-xs text-ink-muted">
            © {new Date().getFullYear()} Aeris. جميع الحقوق محفوظة.
          </p>
          <p className="font-display text-xs tracking-tagged text-ink-muted">
            PRIVATE AVIATION · KSA
          </p>
        </div>
      </div>
    </footer>
  );
}
