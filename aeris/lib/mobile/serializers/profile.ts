/**
 * Pure client-profile shape + mapper (NO 'server-only' — so the tsx
 * unit suite can import it directly, mirroring the other mobile
 * serializers).
 *
 * This mapper IS the read allowlist: only these four fields ever
 * leave the `clients` row to the client surface — never password_hash,
 * privilege columns, session/tier internals, etc. The DB read in
 * profile-core selects exactly these columns; the mapper is the
 * compile-time guarantee that nothing else is forwarded even if the
 * select widens.
 */
export interface ClientProfile {
  full_name: string;
  contact_phone: string;
  auth_email: string;
  marketing_opt_in: boolean;
}

export function mapClientProfileRow(row: {
  full_name?: string | null;
  contact_phone?: string | null;
  auth_email?: string | null;
  marketing_opt_in?: boolean | null;
}): ClientProfile {
  return {
    full_name: row.full_name ?? '',
    contact_phone: row.contact_phone ?? '',
    auth_email: row.auth_email ?? '',
    marketing_opt_in: row.marketing_opt_in === true,
  };
}
