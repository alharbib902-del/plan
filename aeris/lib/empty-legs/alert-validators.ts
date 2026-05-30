import { z } from 'zod';

import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

const iata = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, emptyLegsAr.alertValIata));

export const createAlertSchema = z
  .object({
    origin_iata: iata,
    destination_iata: iata,
    max_price_sar: z
      .union([z.literal(''), z.coerce.number().positive(emptyLegsAr.alertValPricePositive)])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v)),
    date_from: z
      .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, emptyLegsAr.alertValDate)])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v)),
    date_to: z
      .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, emptyLegsAr.alertValDate)])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v)),
  })
  .refine((d) => d.origin_iata !== d.destination_iata, {
    message: emptyLegsAr.alertValRouteDistinct,
    path: ['destination_iata'],
  })
  .refine((d) => !d.date_from || !d.date_to || d.date_from <= d.date_to, {
    message: emptyLegsAr.alertValDateOrder,
    path: ['date_to'],
  });

export type CreateAlertInput = z.infer<typeof createAlertSchema>;

export const alertIdSchema = z.object({
  alert_id: z.string().uuid(emptyLegsAr.alertValAlertId),
});
