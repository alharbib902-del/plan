import { z } from 'zod';

// E.164: starts with '+', then 7-15 digits (first non-zero).
const E164 = /^\+[1-9]\d{6,14}$/;

export const dispatchTripSchema = z.object({
  trip_request_id: z.string().uuid('trip_id_invalid'),
  operator_phone: z
    .string()
    .trim()
    .regex(E164, 'operator_phone_invalid'),
});

export type DispatchTripInput = z.infer<typeof dispatchTripSchema>;
