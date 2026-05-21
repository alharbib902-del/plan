/**
 * Structural tests for the MFA queries layer.
 *
 * Runs as `npm run test:admin-mfa-queries-structural`.
 *
 * These are NOT integration tests — they don't talk to Postgres.
 * They use a recording fake supabase client to assert the SHAPE
 * of the queries we build:
 *
 *   - consumeAdminMfaRecoveryCode MUST include admin_user_id
 *     in the UPDATE filter (PR #90 round-1 P1 regression guard).
 *   - The UPDATE must end in `.select(...).maybeSingle()` so the
 *     caller can detect a zero-row update atomically.
 *   - verifyAdminMfaOtpChallenge MUST include the
 *     `last_used_at.is.null,last_used_at.lt.<stepStart>` OR
 *     clause (PR #90 round-1 P2 regression guard).
 *
 * The fake intercepts `createAdminClient` via a global hatch
 * (`globalThis.__aerisAdminClientOverride`). Production code
 * doesn't read that hatch; only this test sets it.
 */

import { strict as assert } from 'node:assert';

import {
  hashRecoveryCode,
  mintRecoveryCodes,
} from '@/lib/admin/mfa/recovery-codes';
import {
  generateTotp,
  mintTotpSecret,
} from '@/lib/admin/mfa/totp';

// ============================================================
// Recording fake
// ============================================================

interface RecordedCall {
  table: string;
  ops: string[];
  updatePatch?: Record<string, unknown>;
}

interface FakeOptions {
  /** Rows returned by `.select(...).maybeSingle()` after an update. */
  updateReturning?: unknown;
  /** Rows returned by `.select(cols).eq(col, val).maybeSingle()` */
  selectReturning?: unknown;
  /** Count returned by `.select(cols, {count:'exact', head:true})...` */
  countReturning?: number;
}

interface FakeResult {
  client: unknown;
  calls: RecordedCall[];
}

function buildFake(opts: FakeOptions = {}): FakeResult {
  const calls: RecordedCall[] = [];

  const makeChain = (call: RecordedCall): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    chain.eq = (_col: string, _val: unknown) => {
      call.ops.push(`eq(${_col})`);
      return chain;
    };
    chain.neq = (_col: string, _val: unknown) => {
      call.ops.push(`neq(${_col})`);
      return chain;
    };
    chain.is = (_col: string, _val: unknown) => {
      call.ops.push(`is(${_col})`);
      return chain;
    };
    chain.or = (clause: string) => {
      call.ops.push(`or(${clause})`);
      return chain;
    };
    chain.gt = (_col: string, _val: unknown) => {
      call.ops.push(`gt(${_col})`);
      return chain;
    };
    chain.lt = (_col: string, _val: unknown) => {
      call.ops.push(`lt(${_col})`);
      return chain;
    };
    chain.order = (_col: string, _o: unknown) => {
      call.ops.push(`order(${_col})`);
      return chain;
    };
    chain.limit = (_n: number) => {
      call.ops.push(`limit(${_n})`);
      return chain;
    };
    chain.select = (_cols: string, _opts?: unknown) => {
      call.ops.push(`select(${_cols})`);
      return chain;
    };
    chain.maybeSingle = async () => {
      call.ops.push('maybeSingle');
      // Returning shape: an update-then-select chain returns the
      // affected row; a plain select chain returns the row.
      const updated = call.ops.some((o) => o.startsWith('update'));
      const data = updated ? opts.updateReturning ?? null : opts.selectReturning ?? null;
      return { data, error: null };
    };
    chain.single = async () => {
      call.ops.push('single');
      const updated = call.ops.some((o) => o.startsWith('update'));
      const data = updated ? opts.updateReturning ?? null : opts.selectReturning ?? null;
      return { data, error: null };
    };
    // For count chains: `.select(cols, {count:'exact', head:true}).eq().is()`
    // The terminal Promise resolves with { count }.
    // We model this by making the chain itself thenable when count was requested.
    chain.then = (resolve: (v: unknown) => unknown) => {
      // Resolved when the chain is awaited directly.
      if (call.ops.some((o) => o.includes('count'))) {
        return resolve({ count: opts.countReturning ?? 0, error: null, data: null });
      }
      return resolve({ data: null, error: null });
    };
    return chain;
  };

  const client: Record<string, unknown> = {
    from(table: string) {
      const call: RecordedCall = { table, ops: [] };
      calls.push(call);
      const root: Record<string, unknown> = {
        select(cols: string, options?: { count?: string; head?: boolean }) {
          call.ops.push(
            options?.count
              ? `select(${cols},count=${options.count})`
              : `select(${cols})`
          );
          return makeChain(call);
        },
        insert(_rows: unknown) {
          call.ops.push('insert');
          return Promise.resolve({ data: null, error: null });
        },
        update(patch: Record<string, unknown>) {
          call.ops.push('update');
          call.updatePatch = patch;
          return makeChain(call);
        },
        upsert(_row: unknown, _opts: unknown) {
          call.ops.push('upsert');
          return Promise.resolve({ data: null, error: null });
        },
        delete() {
          call.ops.push('delete');
          return makeChain(call);
        },
      };
      return root;
    },
  };

  return { client, calls };
}

// ============================================================
// Override hatch (installed in queries.ts via globalThis check)
// ============================================================

interface GlobalWithHatch {
  __aerisAdminClientOverride?: unknown;
}

function installFake(client: unknown): void {
  (globalThis as GlobalWithHatch).__aerisAdminClientOverride = client;
}

function uninstallFake(): void {
  delete (globalThis as GlobalWithHatch).__aerisAdminClientOverride;
}

// ============================================================
// Test harness
// ============================================================

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(`  ✗ ${name}`);
    // eslint-disable-next-line no-console
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// eslint-disable-next-line no-console
console.log('\n[admin-mfa-queries-structural] running …\n');

async function run(): Promise<void> {
  // Import dynamically so the hatch is installed first.
  const { consumeAdminMfaRecoveryCode, verifyAdminMfaOtpChallenge } =
    await import('@/lib/admin/mfa/queries');

  // ============================================================
  // consumeAdminMfaRecoveryCode
  // ============================================================

  await test(
    'consume: UPDATE chain includes admin_user_id filter (P1 regression guard)',
    async () => {
      const fake = buildFake({
        // Pre-check loadAdminMfaSecret returns an enrolled row,
        // then the UPDATE returns a single row (success).
        selectReturning: {
          admin_user_id: 'admin-A',
          secret_base32: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
          enrolled_at: '2026-01-01T00:00:00Z',
          last_used_at: null,
        },
        updateReturning: { id: 'row-1' },
        countReturning: 9,
      });
      installFake(fake.client);
      try {
        const result = await consumeAdminMfaRecoveryCode({
          admin_user_id: 'admin-A',
          raw_code: 'ABCD-EFGH-JKLM',
          consumed_session_id: 'sess-1',
        });
        assert.equal(result.ok, true);

        // Find the UPDATE call against admin_mfa_recovery_codes.
        const updateCall = fake.calls.find(
          (c) =>
            c.table === 'admin_mfa_recovery_codes' &&
            c.ops.some((o) => o === 'update')
        );
        assert.ok(updateCall, 'expected an UPDATE against recovery_codes');
        // The chain MUST include both code_hash AND admin_user_id eq
        // filters. The P1 regression was scoping the UPDATE to
        // code_hash alone.
        assert.ok(
          updateCall!.ops.includes('eq(code_hash)'),
          `missing eq(code_hash): ${updateCall!.ops.join('→')}`
        );
        assert.ok(
          updateCall!.ops.includes('eq(admin_user_id)'),
          `missing eq(admin_user_id) — P1 regression: ${updateCall!.ops.join('→')}`
        );
        assert.ok(
          updateCall!.ops.includes('is(consumed_at)'),
          `missing is(consumed_at): ${updateCall!.ops.join('→')}`
        );
        // And it must end in select(...).maybeSingle() so the
        // caller can detect a zero-row UPDATE.
        assert.ok(
          updateCall!.ops.includes('maybeSingle'),
          `missing maybeSingle terminator: ${updateCall!.ops.join('→')}`
        );
      } finally {
        uninstallFake();
      }
    }
  );

  await test(
    'consume: zero-row update returns invalid_or_consumed (cross-admin guard)',
    async () => {
      const fake = buildFake({
        selectReturning: {
          admin_user_id: 'admin-A',
          secret_base32: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
          enrolled_at: '2026-01-01T00:00:00Z',
          last_used_at: null,
        },
        // updateReturning omitted → null → simulates "no row
        // matched the filter" (e.g. the code belongs to a
        // different admin, or it was already consumed).
        countReturning: 10,
      });
      installFake(fake.client);
      try {
        const result = await consumeAdminMfaRecoveryCode({
          admin_user_id: 'admin-A',
          raw_code: 'XYZW-EFGH-JKLM',
          consumed_session_id: null,
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.equal(result.reason, 'invalid_or_consumed');
        }
      } finally {
        uninstallFake();
      }
    }
  );

  await test('consume: code_hash is sha256 of canonicalized input', async () => {
    const fake = buildFake({
      selectReturning: {
        admin_user_id: 'admin-A',
        secret_base32: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
        enrolled_at: '2026-01-01T00:00:00Z',
        last_used_at: null,
      },
      updateReturning: { id: 'row-1' },
      countReturning: 9,
    });
    installFake(fake.client);
    try {
      // Hash from canonicalized form must equal hash from
      // dashed form (regression guard for canonicalization).
      const expected = hashRecoveryCode('ABCD-EFGH-JKLM');
      const expectedFromCanonical = hashRecoveryCode('abcd efgh jklm');
      assert.equal(expected, expectedFromCanonical);

      const result = await consumeAdminMfaRecoveryCode({
        admin_user_id: 'admin-A',
        raw_code: 'abcd-efgh-jklm',
        consumed_session_id: null,
      });
      assert.equal(result.ok, true);
    } finally {
      uninstallFake();
    }
  });

  // ============================================================
  // verifyAdminMfaOtpChallenge
  // ============================================================

  await test(
    'challenge: UPDATE includes last_used_at OR clause (P2 race guard)',
    async () => {
      const { base32 } = mintTotpSecret();
      // Use system time so the OTP we generate matches the one
      // verifyAdminMfaOtpChallenge will reproduce internally
      // (it calls verifyTotp without an explicit nowSeconds).
      const otp = generateTotp({ secretBase32: base32 })!;

      const fake = buildFake({
        selectReturning: {
          admin_user_id: 'admin-A',
          secret_base32: base32,
          enrolled_at: '2026-01-01T00:00:00Z',
          last_used_at: null,
        },
        updateReturning: { admin_user_id: 'admin-A' },
      });
      installFake(fake.client);
      try {
        const result = await verifyAdminMfaOtpChallenge({
          admin_user_id: 'admin-A',
          otp_candidate: otp,
        });
        assert.equal(
          result.ok,
          true,
          `expected verify success, got ${JSON.stringify(result)}`
        );

        const updateCall = fake.calls.find(
          (c) =>
            c.table === 'admin_mfa_secrets' &&
            c.ops.some((o) => o === 'update')
        );
        assert.ok(updateCall, 'expected an UPDATE against admin_mfa_secrets');
        assert.ok(
          updateCall!.ops.includes('eq(admin_user_id)'),
          `missing eq(admin_user_id): ${updateCall!.ops.join('→')}`
        );
        const orOp = updateCall!.ops.find((o) => o.startsWith('or('));
        assert.ok(
          orOp,
          `missing OR clause (P2 race guard): ${updateCall!.ops.join('→')}`
        );
        assert.match(
          orOp!,
          /last_used_at\.is\.null/,
          'OR clause missing last_used_at.is.null branch'
        );
        assert.match(
          orOp!,
          /last_used_at\.lt\./,
          'OR clause missing last_used_at.lt.<stepStart> branch'
        );
      } finally {
        uninstallFake();
      }
    }
  );

  await test(
    'challenge: zero-row update returns replay_same_step',
    async () => {
      const { base32 } = mintTotpSecret();
      const nowSeconds = Math.floor(Date.now() / 1000);
      const otp = generateTotp({ secretBase32: base32, nowSeconds })!;

      const fake = buildFake({
        selectReturning: {
          admin_user_id: 'admin-A',
          secret_base32: base32,
          enrolled_at: '2026-01-01T00:00:00Z',
          // Last use was AT the current step boundary or later
          // → UPDATE filter rejects.
          last_used_at: new Date().toISOString(),
        },
        // updateReturning omitted → null → zero rows.
      });
      installFake(fake.client);
      try {
        const result = await verifyAdminMfaOtpChallenge({
          admin_user_id: 'admin-A',
          otp_candidate: otp,
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.equal(result.reason, 'replay_same_step');
        }
      } finally {
        uninstallFake();
      }
    }
  );

  await test('challenge: invalid OTP never reaches the UPDATE', async () => {
    const { base32 } = mintTotpSecret();
    const fake = buildFake({
      selectReturning: {
        admin_user_id: 'admin-A',
        secret_base32: base32,
        enrolled_at: '2026-01-01T00:00:00Z',
        last_used_at: null,
      },
    });
    installFake(fake.client);
    try {
      const result = await verifyAdminMfaOtpChallenge({
        admin_user_id: 'admin-A',
        otp_candidate: '000000',
      });
      // Almost certainly invalid; if astronomically lucky it
      // may match — skip in that case.
      if (!result.ok && 'reason' in result) {
        assert.equal(result.reason, 'invalid_otp');
      }
      const anyUpdate = fake.calls.some((c) =>
        c.ops.some((o) => o === 'update')
      );
      assert.equal(anyUpdate, false, 'no UPDATE should run for invalid OTP');
    } finally {
      uninstallFake();
    }
  });

  // sanity check that mintRecoveryCodes is callable from this test file
  // (catches accidental cycle/export breakage)
  await test('mintRecoveryCodes still returns 10 unique codes (smoke)', () => {
    const codes = mintRecoveryCodes();
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
  });
}

run().then(() => {
  // eslint-disable-next-line no-console
  console.log(
    `\n[admin-mfa-queries-structural] ${passed} passed, ${failed} failed\n`
  );
  if (failed > 0) process.exit(1);
});
