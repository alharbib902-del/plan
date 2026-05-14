import bcrypt from 'bcryptjs';

/**
 * Phase 9 PR 1 — bcrypt wrappers for the client portal.
 *
 * Mirror of `lib/operators/password.ts` (Phase 8 PR 2c).
 * Cost = 12; pure-JS bcryptjs for Vercel cold-start safety.
 */

const COST = 12;

export async function hashClientPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, COST);
}

export async function verifyClientPassword(
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
