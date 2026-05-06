/**
 * SQL-INSERT-row parser for the addon_catalog seed migration
 * file. Supports the constrained shape used by File C only:
 *
 *   INSERT INTO addon_catalog (
 *     col1, col2, col3, ...
 *   ) VALUES
 *   (literal, literal, literal, ...),
 *   (literal, literal, literal, ...)
 *   ON CONFLICT (subtype) DO UPDATE SET ...;
 *
 * Where each `literal` is one of:
 *   - 'single-quoted string'  (with escaped '' as a single ')
 *   - integer or decimal number
 *   - true / false (case-sensitive)
 *   - NULL (case-insensitive)
 *
 * Phase 6.2 PR 1 only: the seed file is hand-authored to a
 * strict shape so this small parser stays sufficient. Any
 * future seed edit that wants richer SQL (functions, casts,
 * subqueries, expression literals) MUST extend this parser
 * first. The parser throws a clear "Unsupported VALUES
 * expression at row N" error on unrecognized constructs so
 * a drift between seed shape and parser is surfaced loudly,
 * not silently.
 *
 * Codex iteration-8 P1 #3 fix: the parity test runs in CI
 * with no DB connection (Layer 1). Founder Probe 2b runs
 * the DB-side parity check post-deploy (Layer 2).
 */

export type SeedColumns = readonly string[];
export type SeedLiteral = string | number | boolean | null;
export type SeedRow = Record<string, SeedLiteral>;

export class SeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedParseError';
  }
}

// ============================================================================
// Public entry point
// ============================================================================

/**
 * Extract every `INSERT INTO addon_catalog ...` block from
 * the migration file's text and parse all VALUES tuples
 * into SeedRow objects keyed by column name.
 *
 * Throws SeedParseError on any malformed input.
 */
export function parseSeedSql(sqlText: string): SeedRow[] {
  const blocks = extractInsertBlocks(sqlText);
  if (blocks.length === 0) {
    throw new SeedParseError('No `INSERT INTO addon_catalog` blocks found.');
  }

  const allRows: SeedRow[] = [];
  for (const block of blocks) {
    const columns = parseColumnList(block);
    const rows = parseValuesTuples(block, columns);
    allRows.push(...rows);
  }

  return allRows;
}

/**
 * Extract the IN (...) values from the
 * `booking_addons_subtype_check` CHECK constraint inside
 * File A (or any file that defines the constraint). Used
 * to assert the CHECK list matches `KNOWN_ADDON_SUBTYPES`.
 *
 * Returns the parsed list of subtype strings, in source
 * order. Throws if the constraint isn't found or the IN
 * clause shape isn't recognized.
 */
export function parseSubtypeCheck(sqlText: string): string[] {
  const re =
    /ADD CONSTRAINT\s+booking_addons_subtype_check\s+CHECK\s*\(\s*addon_subtype\s+IN\s*\(([\s\S]*?)\)\s*\)/i;
  const match = re.exec(sqlText);
  if (!match) {
    throw new SeedParseError(
      'Could not find ADD CONSTRAINT booking_addons_subtype_check CHECK ... IN (...) in the SQL text.'
    );
  }
  const inner = match[1];
  const tokens = splitTopLevelCommas(inner);
  const subtypes: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].trim();
    const lit = parseLiteral(token, `subtype check entry #${i + 1}`);
    if (typeof lit !== 'string') {
      throw new SeedParseError(
        `subtype check entry #${i + 1} is not a string literal: ${token}`
      );
    }
    subtypes.push(lit);
  }
  return subtypes;
}

// ============================================================================
// Block extraction
// ============================================================================

interface InsertBlock {
  /** The raw column-list text between `(` and `)` after `INSERT INTO addon_catalog`. */
  columnsText: string;
  /** The raw VALUES section, between `VALUES` and the closing `)` of the last tuple. */
  valuesText: string;
}

function extractInsertBlocks(sqlText: string): InsertBlock[] {
  const blocks: InsertBlock[] = [];
  const insertHead = /INSERT\s+INTO\s+addon_catalog\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = insertHead.exec(sqlText)) !== null) {
    const colStart = match.index + match[0].length; // position right after `(`
    const colEnd = findMatchingParen(sqlText, colStart - 1);
    if (colEnd < 0) {
      throw new SeedParseError(
        'Unterminated column list in INSERT INTO addon_catalog (...).'
      );
    }
    const columnsText = sqlText.slice(colStart, colEnd);

    // Find VALUES keyword.
    const afterCols = sqlText.slice(colEnd + 1);
    const valuesMatch = /^\s*VALUES\s*/i.exec(afterCols);
    if (!valuesMatch) {
      throw new SeedParseError(
        'Expected VALUES after column list in INSERT INTO addon_catalog.'
      );
    }
    const valuesStart = colEnd + 1 + valuesMatch[0].length;

    // Find the end of the VALUES section: the last `)` of the last tuple,
    // followed by either `;`, `ON CONFLICT`, or end-of-text. We walk
    // tuple-by-tuple until we don't see another `(` opening.
    const valuesEnd = findValuesEnd(sqlText, valuesStart);
    if (valuesEnd < 0) {
      throw new SeedParseError(
        'Unterminated VALUES section in INSERT INTO addon_catalog.'
      );
    }
    const valuesText = sqlText.slice(valuesStart, valuesEnd);

    blocks.push({ columnsText, valuesText });

    // Resume scanning AFTER the close paren so subsequent
    // INSERTs in the same file are picked up.
    insertHead.lastIndex = valuesEnd + 1;
  }

  return blocks;
}

/**
 * Given an index pointing at `(`, return the index of the
 * matching `)` respecting nested parens AND single-quoted
 * strings (no nested parens inside, but `''` escapes still
 * apply). Returns -1 when unterminated.
 */
function findMatchingParen(text: string, openIdx: number): number {
  if (text[openIdx] !== '(') {
    throw new SeedParseError(
      `findMatchingParen called on non-'(' character at ${openIdx}.`
    );
  }
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          i++; // escaped quote
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inStr = true;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Walk forward from `startIdx` (right after VALUES), parsing
 * tuples `(...)` separated by `,`, and stop at the first
 * non-`(` non-`,` non-whitespace character (typically `;` or
 * `ON CONFLICT`). Returns the index AFTER the last tuple's
 * closing paren.
 */
function findValuesEnd(text: string, startIdx: number): number {
  let i = startIdx;
  let lastTupleEnd = -1;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    if (text[i] !== '(') break;
    const closeIdx = findMatchingParen(text, i);
    if (closeIdx < 0) return -1;
    lastTupleEnd = closeIdx + 1;
    i = closeIdx + 1;
    // optional comma
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === ',') {
      i++;
      continue;
    }
    break;
  }
  return lastTupleEnd;
}

// ============================================================================
// Column-list + tuple parsing
// ============================================================================

function parseColumnList(block: InsertBlock): SeedColumns {
  const tokens = splitTopLevelCommas(block.columnsText);
  return tokens.map((t) => t.trim()).filter((t) => t.length > 0);
}

function parseValuesTuples(
  block: InsertBlock,
  columns: SeedColumns
): SeedRow[] {
  const rows: SeedRow[] = [];
  let i = 0;
  let rowIdx = 0;
  while (i < block.valuesText.length) {
    while (i < block.valuesText.length && /[\s,]/.test(block.valuesText[i])) i++;
    if (i >= block.valuesText.length) break;
    if (block.valuesText[i] !== '(') {
      throw new SeedParseError(
        `Expected '(' at VALUES tuple boundary, got '${block.valuesText[i]}'.`
      );
    }
    const closeIdx = findMatchingParen(block.valuesText, i);
    if (closeIdx < 0) {
      throw new SeedParseError(`Unterminated tuple at VALUES row ${rowIdx + 1}.`);
    }
    const tupleInner = block.valuesText.slice(i + 1, closeIdx);
    const literals = splitTopLevelCommas(tupleInner).map((s) => s.trim());
    if (literals.length !== columns.length) {
      throw new SeedParseError(
        `VALUES row ${rowIdx + 1} has ${literals.length} literals, expected ${columns.length} (matching column list).`
      );
    }
    const row: SeedRow = {};
    for (let c = 0; c < columns.length; c++) {
      row[columns[c]] = parseLiteral(
        literals[c],
        `row ${rowIdx + 1} column "${columns[c]}"`
      );
    }
    rows.push(row);
    rowIdx++;
    i = closeIdx + 1;
  }
  return rows;
}

// ============================================================================
// Literal parser
// ============================================================================

function parseLiteral(token: string, where: string): SeedLiteral {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    throw new SeedParseError(`Empty literal at ${where}.`);
  }

  // NULL (case-insensitive).
  if (/^NULL$/i.test(trimmed)) return null;

  // Boolean.
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Single-quoted string. Supports `''` as an escaped single
  // quote inside the string.
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) {
      throw new SeedParseError(
        `Unterminated string literal at ${where}: ${trimmed}`
      );
    }
    const inner = trimmed.slice(1, -1);
    return inner.replace(/''/g, "'");
  }

  // Number (integer or decimal). Reject leading + or hex.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  throw new SeedParseError(
    `Unsupported VALUES expression at ${where}: ${trimmed}`
  );
}

// ============================================================================
// Comma splitter (top-level only — respects parens + strings)
// ============================================================================

function splitTopLevelCommas(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      buf += ch;
      if (ch === "'") {
        if (text[i + 1] === "'") {
          buf += text[i + 1];
          i++;
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inStr = true;
      buf += ch;
      continue;
    }
    if (ch === '(') {
      depth++;
      buf += ch;
      continue;
    }
    if (ch === ')') {
      depth--;
      buf += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length > 0) out.push(buf);
  return out;
}
