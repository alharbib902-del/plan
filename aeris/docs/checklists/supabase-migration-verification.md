# Supabase Migration Verification

## Purpose

Confirm that all migrations under `supabase/migrations/` applied
cleanly to the target Supabase project: enums exist, `lead_inquiries`
has the right shape, RLS is enabled with the correct (deny-all)
posture for `lead_inquiries`, and anon clients are actually blocked
when they hit the REST API.

Schema/RLS *metadata* checks use the SQL Editor (it runs as table
owner — fine for inspecting structure). **Anon access tests must use
the REST API or `@supabase/supabase-js` with the anon key**, never
the SQL Editor — the SQL Editor bypasses RLS, so a `select` there
will return rows even when the policy correctly denies anon clients.

## When to run

- After every migration applied to staging or production.
- Before every production deploy (cheap to re-run).
- After any change to `supabase/migrations/*.sql`.

## Setup

You need:

- Supabase project URL → save as `URL`.
- Supabase anon key → save as `ANON`. (Found in Project Settings → API.)
- Access to the SQL Editor (Project → SQL Editor).

```bash
export URL="https://<your-project>.supabase.co"
export ANON="<your anon key>"
```

## Steps

### 1. Apply migrations in order

1. [ ] In Supabase → SQL Editor, run the contents of
       `supabase/migrations/20260422000001_initial_schema.sql`
       (only on a fresh project; skip if already applied).
2. [ ] Run the contents of
       `supabase/migrations/20260425000002_lead_inquiries.sql`.
       → No errors. The migration is idempotent only insofar as
       Postgres complains about duplicate types/tables on re-run;
       that is the expected guardrail.

### 2. Schema metadata (SQL Editor — owner privileges, fine here)

3. [ ] Enums exist:
       ```sql
       SELECT typname FROM pg_type
       WHERE typname IN ('lead_status', 'lead_trip_type');
       ```
       → Two rows.
4. [ ] `lead_inquiries` columns + nullability:
       ```sql
       SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'lead_inquiries'
       ORDER BY ordinal_position;
       ```
       → 16 rows. Spot-check: `id` (uuid, NO, default
       `uuid_generate_v4()`); `request_number` (varchar, NO, default
       `generate_request_number('AER'::text)`); `customer_name`,
       `customer_phone`, `trip_type`, `origin`, `destination`,
       `departure_date`, `passengers` all `is_nullable = NO`;
       `return_date`, `notes`, `internal_notes`, `last_contacted_at`
       all `is_nullable = YES`; `status` and `source` have defaults.
5. [ ] Indexes exist:
       ```sql
       SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'lead_inquiries';
       ```
       → Includes `lead_inquiries_pkey`,
       `lead_inquiries_request_number_key`,
       `idx_lead_inquiries_status_created`,
       `idx_lead_inquiries_created`.
6. [ ] `updated_at` trigger fires:
       ```sql
       UPDATE lead_inquiries
       SET notes = notes WHERE id = (SELECT id FROM lead_inquiries LIMIT 1);

       SELECT id, updated_at, created_at
       FROM lead_inquiries
       ORDER BY updated_at DESC LIMIT 1;
       ```
       → `updated_at` is more recent than `created_at` (or equal on
       the very first update — re-run to confirm bumping).

### 3. RLS posture (SQL Editor — metadata only)

7. [ ] RLS is enabled on `lead_inquiries`:
       ```sql
       SELECT relname, relrowsecurity
       FROM pg_class
       WHERE relname = 'lead_inquiries';
       ```
       → `relrowsecurity = t`.
8. [ ] **Zero policies** on `lead_inquiries`:
       ```sql
       SELECT policyname, cmd, roles
       FROM pg_policies
       WHERE tablename = 'lead_inquiries';
       ```
       → **No rows.** This is correct for Phase 2: only the service
       role (server-side) reads or writes this table. If you see
       any rows here, either the migration is wrong or someone
       added a policy out-of-band — investigate before continuing.

### 4. Anon access probes (REST — must NOT use SQL Editor)

9. [ ] Anon SELECT is denied (data is invisible):
       ```bash
       curl -s \
         -H "apikey: $ANON" \
         -H "Authorization: Bearer $ANON" \
         "$URL/rest/v1/lead_inquiries?select=id&limit=1"
       ```
       → Response body is **`[]`** (empty array). The HTTP status is
       200 but no rows are returned, because no policy grants
       `SELECT` to anon.
10. [ ] Anon INSERT is denied:
        ```bash
        curl -s -i -X POST \
          -H "apikey: $ANON" \
          -H "Authorization: Bearer $ANON" \
          -H "Content-Type: application/json" \
          -d '{
            "customer_name": "rls_probe",
            "customer_phone": "+966500000000",
            "trip_type": "one_way",
            "origin": "RUH",
            "destination": "DXB",
            "departure_date": "2099-01-01",
            "passengers": 1
          }' \
          "$URL/rest/v1/lead_inquiries"
        ```
        → HTTP **`401`** or **`403`**. Body mentions a row-level
        security / policy violation (e.g. `"new row violates
        row-level security policy for table \"lead_inquiries\""`).
11. [ ] In SQL Editor, confirm the failed insert left no row:
        ```sql
        SELECT count(*) FROM lead_inquiries
        WHERE customer_name = 'rls_probe';
        ```
        → `0`.

### 5. Service-role positive control (SQL Editor)

12. [ ] As the SQL Editor (which uses owner privileges, the same
        privilege the app's admin client holds):
        ```sql
        SELECT count(*) FROM lead_inquiries;
        ```
        → A real number (≥ 0). This proves the table is reachable
        from the privileged path used by the app, while step 9
        proved it is blocked from the public path.

## Pass criteria

- All 12 steps complete without unexpected errors.
- Steps 7 and 8: RLS is on **and** there are zero policies on
  `lead_inquiries`.
- Step 9: anon SELECT returns `[]`.
- Step 10: anon INSERT returns 401/403 with an RLS message.
- Step 12: service-role SELECT returns a real count.

## If it fails

- **Step 3 returns < 2 rows:** the enums migration did not run.
  Re-run `20260425000002_lead_inquiries.sql`.
- **Step 4 missing columns or wrong nullability:** the table did not
  apply correctly. Drop with `DROP TABLE lead_inquiries CASCADE` and
  re-run the migration. *Do not do this in production with real
  data without taking a snapshot first.*
- **Step 7 returns `f` (RLS off):** run
  `ALTER TABLE lead_inquiries ENABLE ROW LEVEL SECURITY;` and open
  an issue — the migration should have done this.
- **Step 8 returns one or more policies:** drop the unwanted policy:
  `DROP POLICY "<name>" ON lead_inquiries;`. Investigate who added
  it and why. The intended state is zero policies.
- **Step 9 returns rows:** RLS is on but a policy is granting anon
  SELECT. Inspect `pg_policies` and remove the offending policy.
- **Step 10 returns 200/201 (insert succeeded):** same root cause as
  step 9. Roll the table back to the migration's intended state and
  re-test before any deploy. Treat this as a P1 security finding.
- **Step 12 returns nothing or errors:** the SQL Editor session is
  broken or the table genuinely doesn't exist. Re-apply the
  migration.
