#!/usr/bin/env node
/**
 * Strict app<->LIVE DB compatibility checker.
 * Cross-references column/param usage in app code against reports/live-schema-compact.json
 * (the live external Supabase schema fetched via PostgREST).
 *
 * Emits CANDIDATE mismatches only — each must be human-verified before reporting.
 * High-precision signals:
 *   1) RPC param keys:   .rpc('fn', { literalKey: ... })  vs live function params
 *   2) Filter columns:   .eq/.neq/.gt/.gte/.lt/.lte/.like/.ilike/.is/.in/.contains/.order/.match/.filter('col', ...)
 *   3) Write keys:       .insert/.update/.upsert({ literalKey: ... })  vs live table columns
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// --ci → fail the process (exit 1) when any non-allowlisted mismatch is found.
const CI = process.argv.includes('--ci');
const SNAPSHOT = path.join(ROOT, 'reports', 'live-schema-compact.json');
if (!fs.existsSync(SNAPSHOT)) {
  console.error(
    'ERROR: reports/live-schema-compact.json missing.\n' +
      'Refresh it from the live DB:  node scripts/live-introspect.cjs\n' +
      '(reads SUPABASE_SERVICE_ROLE_KEY from .env.local; read-only PostgREST OpenAPI).'
  );
  process.exit(1);
}
const live = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));

// Known-acceptable findings, each "type|rel|table_or_fn|col_or_key" — kept
// EMPTY by design; add an entry ONLY with a one-line justification when a
// finding is a confirmed false positive (e.g. a column PostgREST does not
// expose in its OpenAPI). A non-empty allowlist is a smell, not a fix.
const ALLOWLIST = new Set([]);
const liveTables = live.tables; // name -> {col: type}
const liveRpcs = {};            // name -> Set(paramName)
for (const [fn, params] of Object.entries(live.rpcs)) {
  liveRpcs[fn] = new Set(params.map((p) => String(p).split(':')[0]));
}

const FILTER_METHODS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'order', 'match', 'filter', 'overlaps'];

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name === '.next') continue;
      walk(fp, acc);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) {
      acc.push(fp);
    }
  }
  return acc;
}

function lineOf(content, idx) {
  return content.slice(0, idx).split('\n').length;
}

// Extract balanced {...} starting at index of '{'
function balancedObject(content, braceIdx) {
  let depth = 0;
  for (let i = braceIdx; i < content.length; i++) {
    const c = content[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return content.slice(braceIdx, i + 1);
    }
  }
  return content.slice(braceIdx, braceIdx + 2000);
}

// top-level keys of an object literal string (string-aware; captures the
// FIRST key after `{` and every key after a top-level `,`; supports both
// `key: value` and shorthand `key`; skips `...spread` entries).
function topLevelKeys(objStr) {
  const keys = [];
  let depth = 0;
  let inStr = null; // active quote char while inside a string literal
  const readKeyAt = (j) => {
    const rest = objStr.slice(j);
    if (/^\s*\.\.\./.test(rest)) return; // spread element, not a key
    const m = rest.match(/^\s*['"`]?([A-Za-z_$][A-Za-z0-9_$]*)['"`]?\s*[:,}]/);
    if (m) keys.push(m[1]);
  };
  for (let i = 0; i < objStr.length; i++) {
    const c = objStr[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{' || c === '[' || c === '(') {
      depth++;
      if (c === '{' && depth === 1) readKeyAt(i + 1); // first key
      continue;
    }
    if (c === '}' || c === ']' || c === ')') { depth--; continue; }
    if (c === ',' && depth === 1) readKeyAt(i + 1); // subsequent keys
  }
  return [...new Set(keys)];
}

const files = walk(path.join(ROOT, 'app'), []);
walk(path.join(ROOT, 'components'), files);
walk(path.join(ROOT, 'lib'), files);

const findings = { missingRpc: [], missingTable: [], rpc: [], filter: [], write: [], select: [], enumv: [] };
const seenMissingRpc = new Set();
const seenMissingTable = new Set();
const stats = { rpcChecks: 0, filterChecks: 0, writeChecks: 0, selectChecks: 0, enumChecks: 0, fromResolved: 0, fromDynamic: 0, tablesChecked: new Set(), rpcsChecked: new Set() };

// per-table enum columns: col -> Set(allowed values), parsed from live type strings "... enum(a|b|c)"
const enumCols = {};
for (const [t, cols] of Object.entries(liveTables)) {
  for (const [c, typ] of Object.entries(cols)) {
    const em = String(typ).match(/enum\(([^)]*)\)/);
    if (em) {
      enumCols[t] = enumCols[t] || {};
      enumCols[t][c] = new Set(em[1].split('|'));
    }
  }
}

// extract the first string-literal argument of a `.select(` at position selIdx (index of '(')
function selectStringArg(content, parenIdx) {
  let i = parenIdx + 1;
  while (i < content.length && /\s/.test(content[i])) i++;
  const q = content[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let out = '';
  for (i = i + 1; i < content.length; i++) {
    if (content[i] === '\\') { out += content[i + 1]; i++; continue; }
    if (content[i] === q) break;
    out += content[i];
  }
  return out;
}

// conservative: return plain column tokens from a PostgREST select string (skip embeds/json/aliases-with-embeds/*)
function selectColumns(sel) {
  // split top-level commas (respect parens)
  const parts = [];
  let depth = 0, cur = '';
  for (const c of sel) {
    if (c === '(') { depth++; cur += c; }
    else if (c === ')') { depth--; cur += c; }
    else if (c === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  const cols = [];
  for (let p of parts) {
    p = p.trim();
    if (!p || p === '*' || p.startsWith('count')) continue;
    if (p.includes('(')) continue;          // embed: related(...) -> skip
    if (p.includes('!')) continue;          // hint/embed disambiguation -> skip
    if (p.includes(':')) p = p.split(':').pop().trim(); // alias:col -> col
    if (p.includes('->')) p = p.split('->')[0].trim();  // jsonpath -> base col
    p = p.replace(/::.*$/, '').trim();       // cast
    if (/^[a-z_][a-z0-9_]*$/.test(p)) cols.push(p);
  }
  return [...new Set(cols)];
}

// Self-test for the key parser (Codex review: it must capture the FIRST key,
// shorthand keys, multiline + nested objects, string braces, and skip spreads).
function runSelfTest() {
  const cases = [
    ['{ p_operator_id: x }', ['p_operator_id']],
    ['{ p_operator_id: x, p_payload: y }', ['p_operator_id', 'p_payload']],
    ['{ a: { nested: 1 }, b: 2 }', ['a', 'b']],
    ['{\n  a: 1,\n  b: 2,\n}', ['a', 'b']],
    ['{ ...common, c: 3 }', ['c']],
    ['{ a, b }', ['a', 'b']],
    ["{ a: '}', b: 2 }", ['a', 'b']],
  ];
  let failed = 0;
  for (const [input, expect] of cases) {
    const got = topLevelKeys(input);
    const ok =
      got.length === expect.length && expect.every((k) => got.includes(k));
    if (!ok) {
      failed++;
      console.error(
        `SELF-TEST FAIL: topLevelKeys(${JSON.stringify(input)}) = [${got}] expected [${expect}]`
      );
    }
  }
  if (failed > 0) {
    console.error(`\nSELF-TEST FAILED (${failed}) — key parser broken; aborting.`);
    process.exit(1);
  }
  console.log('self-test: topLevelKeys OK (' + cases.length + ' cases)');
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}
if (CI) runSelfTest();

for (const fp of files) {
  const content = fs.readFileSync(fp, 'utf8');
  const rel = path.relative(ROOT, fp).replace(/\\/g, '/');

  // resolve `const NAME = 'literal'` table-name constants in this file
  const constMap = {};
  const cre = /\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*['"]([a-z0-9_]+)['"]/g;
  let cm;
  while ((cm = cre.exec(content))) constMap[cm[1]] = cm[2];

  let m;

  // --- 0) MISSING RPC: every .rpc('literal') whose fn is absent from the
  // live snapshot — a typo'd / removed function name (the worst drift). ---
  const rpcAnyRe = /\.rpc\(\s*['"]([a-z0-9_]+)['"]/gi;
  while ((m = rpcAnyRe.exec(content))) {
    const fn = m[1];
    if (!liveRpcs[fn]) {
      const key = rel + '|' + fn;
      if (!seenMissingRpc.has(key)) {
        seenMissingRpc.add(key);
        findings.missingRpc.push({ rel, line: lineOf(content, m.index), fn });
      }
    }
  }

  // --- 1) RPC param checks (for fns present in the snapshot) ---
  const rpcRe = /\.rpc\(\s*['"]([a-z0-9_]+)['"]\s*,\s*\{/gi;
  while ((m = rpcRe.exec(content))) {
    const fn = m[1];
    const braceIdx = content.indexOf('{', m.index + m[0].length - 1);
    const objStr = balancedObject(content, braceIdx);
    const keys = topLevelKeys(objStr);
    const liveParams = liveRpcs[fn];
    if (!liveParams) continue; // missing fn handled by scan 0 above
    stats.rpcsChecked.add(fn);
    for (const k of keys) {
      stats.rpcChecks++;
      if (!liveParams.has(k)) {
        findings.rpc.push({ rel, line: lineOf(content, m.index), fn, key: k, live: [...liveParams].join(',') });
      }
    }
  }

  // --- locate every .from(...) (literal OR resolvable const) and its window ---
  const fromRe = /\.from\(\s*([A-Za-z_$][A-Za-z0-9_$.]*|['"][a-z0-9_]+['"])\s*\)/g;
  const froms = [];
  while ((m = fromRe.exec(content))) {
    let arg = m[1];
    let table = null;
    if (/^['"]/.test(arg)) table = arg.replace(/['"]/g, '');
    else if (constMap[arg]) table = constMap[arg];
    // every .from is a window boundary even if table unknown (prevents overrun)
    froms.push({ table, start: m.index + m[0].length });
  }
  for (let i = 0; i < froms.length; i++) {
    const { table, start } = froms[i];
    const end = i + 1 < froms.length ? froms[i + 1].start : Math.min(content.length, start + 700);
    const win = content.slice(start, Math.min(end, start + 700));
    if (!table) { stats.fromDynamic++; continue; } // unknown table (dynamic) — used only as boundary
    const cols = liveTables[table];
    if (!cols) {
      // resolved table name absent from the live snapshot — a typo'd /
      // removed table (the worst drift). Dynamic .from(var) is skipped above.
      const key = rel + '|' + table;
      if (!seenMissingTable.has(key)) {
        seenMissingTable.add(key);
        findings.missingTable.push({ rel, line: lineOf(content, start), table });
      }
      continue;
    }
    stats.fromResolved++;
    stats.tablesChecked.add(table);
    const colSet = new Set(Object.keys(cols));

    // 2) filter columns (+ enum-value check for eq/neq literal values)
    const fm = new RegExp("\\.(" + FILTER_METHODS.join('|') + ")\\(\\s*['\"]([a-z0-9_]+)['\"]\\s*(?:,\\s*['\"]([^'\"]*)['\"])?", 'gi');
    let fmatch;
    const tEnum = enumCols[table] || {};
    while ((fmatch = fm.exec(win))) {
      const col = fmatch[2];
      const val = fmatch[3];
      stats.filterChecks++;
      if (!colSet.has(col)) {
        findings.filter.push({ rel, line: lineOf(content, start + fmatch.index), table, method: fmatch[1], col });
      } else if (val != null && (fmatch[1] === 'eq' || fmatch[1] === 'neq') && tEnum[col]) {
        stats.enumChecks++;
        if (!tEnum[col].has(val)) {
          findings.enumv.push({ rel, line: lineOf(content, start + fmatch.index), table, col, val, allowed: [...tEnum[col]].join('|') });
        }
      }
    }

    // 2b) select columns (conservative)
    const selRe = /\.select\(/g;
    let smatch;
    while ((smatch = selRe.exec(win))) {
      const parenIdx = start + smatch.index + smatch[0].length - 1;
      const sel = selectStringArg(content, parenIdx);
      if (!sel) continue;
      for (const col of selectColumns(sel)) {
        stats.selectChecks++;
        if (!colSet.has(col)) {
          findings.select.push({ rel, line: lineOf(content, parenIdx), table, col });
        }
      }
    }

    // 3) write keys (.insert/.update/.upsert)
    const wr = /\.(insert|update|upsert)\(\s*\{/gi;
    let wmatch;
    while ((wmatch = wr.exec(win))) {
      const braceIdx = start + wmatch.index + wmatch[0].length - 1;
      const objStr = balancedObject(content, braceIdx);
      const keys = topLevelKeys(objStr);
      for (const k of keys) {
        stats.writeChecks++;
        if (!colSet.has(k)) {
          findings.write.push({ rel, line: lineOf(content, braceIdx), table, op: wmatch[1], key: k });
        } else if (tEnum[k]) {
          const vm = objStr.match(new RegExp('\\b' + k + "\\s*:\\s*['\"]([^'\"]*)['\"]"));
          if (vm) {
            stats.enumChecks++;
            if (!tEnum[k].has(vm[1])) {
              findings.enumv.push({ rel, line: lineOf(content, braceIdx), table, col: k, val: vm[1], allowed: [...tEnum[k]].join('|') });
            }
          }
        }
      }
    }
  }
}

function dump(title, arr, fmt) {
  console.log('\n==================== ' + title + ' (' + arr.length + ') ====================');
  for (const f of arr) console.log(fmt(f));
}
dump('MISSING RPC (fn not in live schema)', findings.missingRpc, (f) => `${f.rel}:${f.line}  rpc('${f.fn}') — function NOT in live schema`);
dump('MISSING TABLE (not in live schema)', findings.missingTable, (f) => `${f.rel}:${f.line}  from('${f.table}') — table NOT in live schema`);
dump('RPC PARAM mismatches', findings.rpc, (f) => `${f.rel}:${f.line}  rpc('${f.fn}') key '${f.key}' NOT in live params [${f.live}]`);
dump('FILTER COLUMN mismatches', findings.filter, (f) => `${f.rel}:${f.line}  from('${f.table}').${f.method}('${f.col}') — col NOT in live`);
dump('SELECT COLUMN mismatches', findings.select, (f) => `${f.rel}:${f.line}  from('${f.table}').select(... '${f.col}' ...) — col NOT in live`);
dump('WRITE KEY mismatches', findings.write, (f) => `${f.rel}:${f.line}  from('${f.table}').${f.op}({ '${f.key}' }) — col NOT in live`);
dump('ENUM VALUE mismatches', findings.enumv, (f) => `${f.rel}:${f.line}  ${f.table}.${f.col} = '${f.val}' NOT in enum [${f.allowed}]`);

console.log('\nTOTAL candidates: missingRpc=' + findings.missingRpc.length + ' missingTable=' + findings.missingTable.length + ' rpc=' + findings.rpc.length + ' filter=' + findings.filter.length + ' select=' + findings.select.length + ' write=' + findings.write.length + ' enum=' + findings.enumv.length);
console.log('\n---- COVERAGE ----');
console.log('from() resolved to a live table: ' + stats.fromResolved + ' (dynamic/unresolved: ' + stats.fromDynamic + ')');
console.log('distinct tables exercised: ' + stats.tablesChecked.size + ' [' + [...stats.tablesChecked].sort().join(', ') + ']');
console.log('filter-column checks performed: ' + stats.filterChecks);
console.log('select-column checks performed: ' + stats.selectChecks);
console.log('enum-value checks performed: ' + stats.enumChecks);
console.log('write-key checks performed: ' + stats.writeChecks);
console.log('rpc-param checks performed: ' + stats.rpcChecks + ' across ' + stats.rpcsChecked.size + ' distinct RPCs');
fs.writeFileSync(path.join(ROOT, 'reports', 'audit-candidates.json'), JSON.stringify(findings, null, 2));

// ---- CI gate -------------------------------------------------------------
// A finding here means app code references a column / RPC param / enum value
// that the live schema snapshot does NOT have → a silent runtime break
// waiting to happen. Tables/RPCs absent from the snapshot are skipped above
// (coverage gap, not a false alarm), so every finding is a real mismatch.
function sig(type, f) {
  if (type === 'missingRpc') return `missingRpc|${f.rel}|${f.fn}`;
  if (type === 'missingTable') return `missingTable|${f.rel}|${f.table}`;
  if (type === 'rpc') return `rpc|${f.rel}|${f.fn}|${f.key}`;
  if (type === 'filter') return `filter|${f.rel}|${f.table}|${f.col}`;
  if (type === 'select') return `select|${f.rel}|${f.table}|${f.col}`;
  if (type === 'write') return `write|${f.rel}|${f.table}|${f.key}`;
  return `enumv|${f.rel}|${f.table}|${f.col}`;
}
const blocking = [];
for (const [type, arr] of Object.entries(findings)) {
  for (const f of arr) {
    if (!ALLOWLIST.has(sig(type, f))) blocking.push(sig(type, f));
  }
}
console.log('\nNON-ALLOWLISTED findings: ' + blocking.length);
if (CI && blocking.length > 0) {
  console.error(
    '\nDB-COMPAT CHECK FAILED — ' +
      blocking.length +
      ' app<->schema mismatch(es) above. Fix the code, or (if the snapshot ' +
      'is stale) refresh it: node scripts/live-introspect.cjs'
  );
  process.exit(1);
}
