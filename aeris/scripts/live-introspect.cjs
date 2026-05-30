#!/usr/bin/env node
/**
 * LIVE schema introspector for DB-compatibility auditing.
 * Connects to the EXTERNAL Supabase DB via PostgREST (the exact interface the
 * app uses through supabase-js) using the project's SERVICE_ROLE_KEY from
 * .env.local, and dumps the live, exposed schema: tables -> columns(type),
 * and RPCs -> params(type). Read-only (GET only).
 *
 * Usage:
 *   node scripts/live-introspect.cjs            # writes reports/live-schema.json + prints summary
 */
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const txt = fs.readFileSync(envPath, 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

async function main() {
  const env = loadEnv();
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Missing SUPABASE URL or SERVICE_ROLE_KEY in .env.local');

  const url = base.replace(/\/$/, '') + '/rest/v1/';
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/openapi+json' },
  });
  if (!res.ok) throw new Error('PostgREST OpenAPI fetch failed: ' + res.status + ' ' + (await res.text()).slice(0, 300));
  const spec = await res.json();

  const outDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'live-schema.json'), JSON.stringify(spec, null, 2));

  // --- Build compact table->columns map from definitions ---
  const defs = spec.definitions || (spec.components && spec.components.schemas) || {};
  const tables = {};
  for (const [name, def] of Object.entries(defs)) {
    const props = def.properties || {};
    const cols = {};
    for (const [col, meta] of Object.entries(props)) {
      let t = meta.format || meta.type || '?';
      // PostgREST puts PK/FK hints in description
      const flags = [];
      if (meta.description && /Primary Key/i.test(meta.description)) flags.push('PK');
      if (meta.description && /Foreign Key/i.test(meta.description)) {
        const fk = meta.description.match(/`([^`]+)`/);
        if (fk) flags.push('FK->' + fk[1]);
      }
      if (meta.enum) t += ' enum(' + meta.enum.join('|') + ')';
      cols[col] = t + (flags.length ? ' [' + flags.join(',') + ']' : '');
    }
    tables[name] = cols;
  }

  // --- Build RPC list from paths ---
  const rpcs = {};
  const paths = spec.paths || {};
  for (const [p, ops] of Object.entries(paths)) {
    const m = p.match(/^\/rpc\/(.+)$/);
    if (!m) continue;
    const fn = m[1];
    const post = ops.post || ops.get || {};
    const params = [];
    for (const par of post.parameters || []) {
      if (par.in === 'body' && par.schema && par.schema.properties) {
        for (const [pn, pm] of Object.entries(par.schema.properties)) params.push(pn + ':' + (pm.format || pm.type || '?'));
      } else if (par.name && par.name !== 'select' && par.name !== 'Prefer') {
        params.push(par.name + ':' + (par.type || '?'));
      }
    }
    rpcs[fn] = params;
  }

  // --- Print summary ---
  const tableNames = Object.keys(tables).sort();
  const rpcNames = Object.keys(rpcs).sort();
  console.log('=== LIVE EXTERNAL DB (PostgREST exposed, public schema) ===');
  console.log('Supabase project: ' + base);
  console.log('TABLES/VIEWS: ' + tableNames.length);
  console.log('RPC FUNCTIONS: ' + rpcNames.length);
  console.log('');
  console.log('--- TABLE NAMES ---');
  console.log(tableNames.join('\n'));
  console.log('');
  console.log('--- RPC NAMES ---');
  console.log(rpcNames.join('\n'));

  fs.writeFileSync(
    path.join(outDir, 'live-schema-compact.json'),
    JSON.stringify({ project: base, tables, rpcs }, null, 2)
  );
  console.log('');
  console.log('Wrote: reports/live-schema.json (raw OpenAPI) + reports/live-schema-compact.json (tables+rpcs)');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
