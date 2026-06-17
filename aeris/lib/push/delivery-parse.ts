/**
 * Pure parsers for the client_push_deliveries RPC envelopes (NO 'server-only',
 * NO admin import — tsx-testable, mirroring the serializer/core split). The
 * server-only wrappers in `deliveries.ts` call the RPCs and delegate the
 * envelope interpretation here.
 */

export type ClaimResult =
  | { ok: true; claimed: false }
  | { ok: true; claimed: true; deliveryId: string; attempt: number }
  | { ok: false; error: string };

export type MarkResult = { ok: true } | { ok: false; error: string };

export function parseClaimResult(data: unknown, error: unknown): ClaimResult {
  if (error) return { ok: false, error: 'rpc_failed' };
  const env = data as {
    ok?: boolean;
    error?: string;
    claimed?: boolean;
    delivery_id?: string;
    attempt?: number;
  } | null;
  if (!env?.ok) return { ok: false, error: env?.error ?? 'rpc_failed' };
  if (env.claimed !== true) return { ok: true, claimed: false };
  const deliveryId = `${env.delivery_id ?? ''}`;
  // A claim with no delivery_id is a malformed RPC response: the SQL always
  // RETURNs the id on a true claim, so an empty id means the send could never
  // be mark()ed afterwards. Treat it as a transient fault → the sender does
  // NOT proceed with an un-markable delivery.
  if (deliveryId.length === 0) return { ok: false, error: 'rpc_failed' };
  return {
    ok: true,
    claimed: true,
    deliveryId,
    attempt: typeof env.attempt === 'number' ? env.attempt : 0,
  };
}

export function parseMarkResult(data: unknown, error: unknown): MarkResult {
  if (error) return { ok: false, error: 'rpc_failed' };
  const env = data as { ok?: boolean; error?: string } | null;
  if (!env?.ok) return { ok: false, error: env?.error ?? 'rpc_failed' };
  return { ok: true };
}
