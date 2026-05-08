import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  hashSessionToken,
  verifyEmptyLegSessionToken,
  type EmptyLegSessionTokenPayload,
} from './empty-leg-session-token';
import type { OperatorEmptyLegSessionRow } from '@/lib/empty-legs/types';

/**
 * Phase 7 PR 2c — DB-side hash storage helpers for the
 * operator session token table.
 *
 * Reads/writes `operator_empty_leg_sessions` (created in
 * PR 1 §15). NO DDL in this PR. The mint/verify flow:
 *
 *   1. `mintEmptyLegSessionToken({ operatorStubId })` → raw
 *      token + payload.
 *   2. INSERT a session row via `insertOperatorEmptyLegSession`
 *      with the SHA256 hash of the raw token.
 *   3. Return the raw token to the admin once. The DB
 *      keeps only the hash.
 *
 * Validate flow on every operator action (Layers 1+2+3):
 *   - Layer 1 — `verifyEmptyLegSessionToken` (HMAC + payload exp)
 *   - Layer 2 — DB row exists with matching token_hash
 *   - Layer 3 — DB row's `expires_at > NOW()`
 *
 * Codex iteration-12 P1 #2 fix: column is named
 * `operator_stub_id` so it matches the FK target
 * (`phase7_operator_stubs.id`). Phase 7 NEVER writes into
 * the real `operators` table.
 */

const TABLE = 'operator_empty_leg_sessions';

// ============================================================
// INSERT — called by adminMintOperatorSession after the
// token is freshly minted.
// ============================================================

export interface InsertSessionRowOptions {
  operatorStubId: string;
  rawToken: string;
  expiresAt: Date;
}

export async function insertOperatorEmptyLegSession({
  operatorStubId,
  rawToken,
  expiresAt,
}: InsertSessionRowOptions): Promise<OperatorEmptyLegSessionRow> {
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .insert({
      operator_stub_id: operatorStubId,
      token_hash: hashSessionToken(rawToken),
      expires_at: expiresAt.toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    console.error('[operator-session-store] insert failed', error);
    throw new Error(`insertOperatorEmptyLegSession failed: ${error.message}`);
  }
  return data as OperatorEmptyLegSessionRow;
}

// ============================================================
// LOOKUP — Layer 2 + Layer 3 of the 3-layer validation.
// ============================================================

interface LookupSessionResult {
  row: OperatorEmptyLegSessionRow | null;
}

async function lookupSessionByHash(
  tokenHash: string
): Promise<LookupSessionResult> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    console.error('[operator-session-store] lookup failed', error);
    throw new Error(`lookupSessionByHash failed: ${error.message}`);
  }
  return { row: (data as OperatorEmptyLegSessionRow | null) ?? null };
}

// ============================================================
// validateOperatorEmptyLegSession — the 3-layer combined
// helper that operator Server Actions call on every request.
//
// Returns the verified `operator_stub_id` on success so the
// caller can scope its DB queries against it. Returns
// `'invalid_session'` on any failure — opaque error per the
// spec; the operator cannot tell which layer failed.
// ============================================================

export type ValidateSessionResult =
  | {
      ok: true;
      operatorStubId: string;
      sessionId: string;
      payload: EmptyLegSessionTokenPayload;
    }
  | { ok: false; error: 'invalid_session' };

export async function validateOperatorEmptyLegSession(
  rawToken: string | undefined
): Promise<ValidateSessionResult> {
  // Layer 1 — HMAC + payload exp.
  const layer1 = verifyEmptyLegSessionToken(rawToken);
  if (!layer1.valid) {
    return { ok: false, error: 'invalid_session' };
  }

  // Layer 2 — DB row exists with matching token_hash.
  if (!rawToken) {
    return { ok: false, error: 'invalid_session' };
  }
  const tokenHash = hashSessionToken(rawToken);
  const { row } = await lookupSessionByHash(tokenHash);
  if (!row) {
    return { ok: false, error: 'invalid_session' };
  }

  // Belt-and-braces: payload's stub id must match the row's.
  if (row.operator_stub_id !== layer1.payload.operator_stub_id) {
    return { ok: false, error: 'invalid_session' };
  }

  // Layer 3 — DB row's expires_at > NOW(). Compare server-
  // side; the row's `revoked_at` is already filtered out by
  // the lookup query.
  if (Date.parse(row.expires_at) <= Date.now()) {
    return { ok: false, error: 'invalid_session' };
  }

  return {
    ok: true,
    operatorStubId: row.operator_stub_id,
    sessionId: row.id,
    payload: layer1.payload,
  };
}

// ============================================================
// SOFT REVOKE — admin-side action to invalidate a session
// without deleting the row (audit trail preserved).
// ============================================================

export async function revokeOperatorEmptyLegSession(
  sessionId: string
): Promise<void> {
  const client = createAdminClient();
  const { error } = await client
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', sessionId)
    .is('revoked_at', null);

  if (error) {
    console.error('[operator-session-store] revoke failed', error);
    throw new Error(`revokeOperatorEmptyLegSession failed: ${error.message}`);
  }
}

// ============================================================
// LIST ACTIVE BY STUB — admin-side surface helper for
// listing/auditing live sessions per stub.
// ============================================================

export async function listActiveSessionsByStub(
  operatorStubId: string
): Promise<OperatorEmptyLegSessionRow[]> {
  noStore();
  const client = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('operator_stub_id', operatorStubId)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(
      '[operator-session-store] listActiveSessionsByStub failed',
      error
    );
    throw new Error(
      `listActiveSessionsByStub failed: ${error.message}`
    );
  }
  return (data ?? []) as OperatorEmptyLegSessionRow[];
}
