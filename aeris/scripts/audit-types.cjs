#!/usr/bin/env node
/**
 * Diff types/database.ts (hand-maintained generated types) against the LIVE DB.
 * For every table mapped in the Database["public"]["Tables"] block, resolve its
 * Row type interface, extract field names, and compare to live columns.
 *
 * Reports:
 *   - DECLARED-BUT-ABSENT: column in types/database.ts Row but NOT in live  (dangerous: select('*') + .prop => undefined at runtime)
 *   - LIVE-NOT-IN-TYPES:    column in live but NOT in the Row type           (typed client can't see it; missing coverage)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const live = require(path.join(ROOT, 'reports', 'live-schema-compact.json')).tables;
const src = fs.readFileSync(path.join(ROOT, 'types', 'database.ts'), 'utf8');

// 1) table -> RowTypeName  (within Tables: { ... })
const tablesStart = src.indexOf('Tables: {');
const tablesBlock = src.slice(tablesStart, src.indexOf('Functions:', tablesStart) > 0 ? src.indexOf('Functions:', tablesStart) : src.length);
const tableToRow = {};
const tblRe = /^\s{6}([a-z_][a-z0-9_]*):\s*\{\s*$/gm;
let tm;
while ((tm = tblRe.exec(tablesBlock))) {
  const tname = tm[1];
  const after = tablesBlock.slice(tm.index, tm.index + 400);
  const rm = after.match(/Row:\s*([A-Za-z0-9_]+)/);
  if (rm) tableToRow[tname] = rm[1];
}

// 2) extract fields of a named interface/type alias (object literal)
function typeFields(typeName) {
  // interface X { ... }  OR  type X = { ... }
  let re = new RegExp('(?:interface|type)\\s+' + typeName + '\\b[^{]*\\{', 'm');
  const m = src.match(re);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  let depth = 0, body = '', i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    if (depth >= 1 && !(c === '{' && depth === 1)) body += c;
  }
  // capture extends/intersections too (e.g. `interface X extends Y {` or `type X = Y & {`)
  const fields = [];
  for (const line of body.split('\n')) {
    const fm = line.match(/^\s*([a-z_][a-z0-9_]*)\??\s*:/i);
    if (fm) fields.push(fm[1]);
  }
  return [...new Set(fields)];
}

let totalDeclaredAbsent = 0, totalLiveNotInTypes = 0, tablesCompared = 0;
const report = [];
for (const [tname, rowType] of Object.entries(tableToRow)) {
  const liveCols = live[tname];
  if (!liveCols) { report.push(`\n[${tname}] -> ${rowType}: table NOT in live (skip)`); continue; }
  const fields = typeFields(rowType);
  if (!fields) { report.push(`\n[${tname}] -> ${rowType}: Row type not resolvable (skip)`); continue; }
  tablesCompared++;
  const liveSet = new Set(Object.keys(liveCols));
  const declaredAbsent = fields.filter((f) => !liveSet.has(f));
  const liveNotInTypes = Object.keys(liveCols).filter((c) => !fields.includes(c));
  if (declaredAbsent.length || liveNotInTypes.length) {
    report.push(`\n[${tname}] (type ${rowType}, ${fields.length} fields vs ${liveSet.size} live cols)`);
    if (declaredAbsent.length) { report.push('   DECLARED-BUT-ABSENT in live: ' + declaredAbsent.join(', ')); totalDeclaredAbsent += declaredAbsent.length; }
    if (liveNotInTypes.length) { report.push('   live-not-in-types: ' + liveNotInTypes.join(', ')); totalLiveNotInTypes += liveNotInTypes.length; }
  }
}
console.log('types/database.ts tables mapped: ' + Object.keys(tableToRow).length + ' | compared: ' + tablesCompared);
console.log(report.join('\n'));
console.log('\n==== SUMMARY ====');
console.log('DECLARED-BUT-ABSENT columns (types says exists, live does NOT): ' + totalDeclaredAbsent);
console.log('live-not-in-types columns (live has, types omits): ' + totalLiveNotInTypes);
