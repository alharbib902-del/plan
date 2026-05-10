import bcrypt from 'bcryptjs';

/**
 * Phase 8 PR 2c — bcrypt wrappers for the operator portal.
 *
 * Cost = 12 (~250-500ms per hash on Vercel cold). Uses
 * `bcryptjs` (pure JS) rather than `bcrypt` (native binding)
 * to avoid Vercel cold-start failures from glibc mismatches
 * (Codex spec round-2 P1 #3 fix).
 *
 * The DB-side guard regex `^[$]2[aby][$]` (PR 2a §1) accepts
 * both `bcryptjs` ($2a$ / $2b$) and `bcrypt` ($2a$ / $2b$ /
 * $2y$) outputs, so the choice is interchangeable from the
 * RPC's perspective.
 */

const COST = 12;

export async function hashOperatorPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, COST);
}

export async function verifyOperatorPassword(
  plaintext: string,
  storedHash: string
): Promise<boolean> {
  if (!plaintext || !storedHash) return false;
  try {
    return await bcrypt.compare(plaintext, storedHash);
  } catch {
    return false;
  }
}
