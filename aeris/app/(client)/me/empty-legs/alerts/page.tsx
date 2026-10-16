import 'server-only';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireClientSession } from '@/lib/clients/auth';
import { listClientAlerts } from '@/lib/empty-legs/alerts';
import { EmptyLegAlertForm } from '@/components/clients/empty-leg-alert-form';
import { deleteAlert, toggleAlert } from '@/app/actions/empty-leg-alerts';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function priceLabel(price: number | null): string {
  return price == null
    ? emptyLegsAr.alertAnyPrice
    : `${Number(price).toLocaleString('en-US')} ${emptyLegsAr.alertCurrency}`;
}

export default async function EmptyLegAlertsPage() {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();
  if (process.env.ENABLE_CLIENT_EMPTY_LEGS_PORTAL !== 'true') notFound();

  const session = await requireClientSession();
  const alerts = await listClientAlerts(session.client_id);

  return (
    <div dir="rtl" className="space-y-8">
      <div>
        <Link href="/me/empty-legs" className="text-sm text-gold-light hover:underline">
          {clientsAr.emptyLegsPortalTitle}
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-ink">{emptyLegsAr.alertsTitle}</h1>
        <p className="text-sm text-ink-secondary">{emptyLegsAr.alertsIntro}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-ink">{emptyLegsAr.alertsNewTitle}</h2>
        <div className="rounded-lg border border-border bg-navy-card/40 p-4">
          <EmptyLegAlertForm />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-ink">{emptyLegsAr.alertsMyTitle}</h2>
        {alerts.length === 0 ? (
          <p className="text-ink-secondary">{emptyLegsAr.alertsEmpty}</p>
        ) : (
          <ul className="space-y-3">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className="rounded-lg border border-border bg-navy-card/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">
                    {alert.origin_iata} → {alert.destination_iata}
                  </span>
                  <span className="text-sm text-ink-secondary">{priceLabel(alert.max_price_sar)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <span className="text-ink-secondary">
                    {alert.date_from || alert.date_to ? (
                      <span>
                        {alert.date_from ?? '…'} — {alert.date_to ?? '…'} ·{' '}
                      </span>
                    ) : null}
                    <span className={alert.is_active ? 'text-emerald-300' : 'text-ink-secondary'}>
                      {alert.is_active ? emptyLegsAr.alertActiveLabel : emptyLegsAr.alertPausedLabel}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <form action={toggleAlert}>
                      <input type="hidden" name="alert_id" value={alert.id} />
                      <input type="hidden" name="active" value={(!alert.is_active).toString()} />
                      <button type="submit" className="text-gold-light hover:underline">
                        {alert.is_active ? emptyLegsAr.alertPause : emptyLegsAr.alertResume}
                      </button>
                    </form>
                    <form action={deleteAlert}>
                      <input type="hidden" name="alert_id" value={alert.id} />
                      <button type="submit" className="text-rose-300 hover:underline">
                        {emptyLegsAr.alertDelete}
                      </button>
                    </form>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
