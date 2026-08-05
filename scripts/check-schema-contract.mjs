#!/usr/bin/env node
// G-1 guardrail — "schema <-> code contract check".
//
// Statically reads every table/column reference across all applied migrations and every
// function body defined in them, then flags any column reference that does not exist on
// the table it's used against. This is the exact class of bug that broke
// admin_create_employee, admin_update_employee, fetch_directory, manager_decide_leave,
// admin_reset_leave_balances and manager_get_team_leaves in the old app — someone renamed
// a column and nothing ever checked the functions again.
//
// Reads supabase/migrations/*.sql in filename order (skipping 0001_baseline_schema.sql,
// which is the OLD project's schema kept for historical reference only and never applied
// to HRMS). Tables can be introduced by `create table` in one file and grown by
// `alter table ... add column` in a later one — both are tracked. A function redefined
// in a later file (`create or replace function`, same name) supersedes the earlier body,
// matching real Postgres semantics, so only the last definition is checked.
//
// Deliberately static (no live DB needed) so it can run on every save, not just after
// a deploy. It is a heuristic regex-based reader, not a real SQL parser — it covers the
// patterns this codebase actually uses (insert into (...), update ... set ..., alias.col,
// excluded.col, declared record variables, alter table add column). Anything it can't
// confidently classify it leaves alone rather than guessing, so a clean run is meaningful
// but not a proof of absence of bugs — G-2 (smoke test every function against a live DB)
// is the backstop.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations')

// 0001_baseline_schema.sql is the OLD project's extracted schema — never applied to
// HRMS, so it must never contribute tables/functions here (see apply-migrations.mjs).
const EXCLUDED_FILES = new Set(['0001_baseline_schema.sql'])

// Trigger functions read NEW/OLD, which aren't declared anywhere in the SQL text —
// wire them to their target table by hand since there are only ever a couple of these.
const TRIGGER_TARGET_TABLE = {
  trg_attendance_monthly_summary: 'attendance',
}

const RESERVED = new Set([
  'where', 'order', 'group', 'on', 'using', 'left', 'right', 'inner', 'outer', 'full',
  'join', 'set', 'values', 'returning', 'into', 'select', 'and', 'or', 'not', 'is',
  'null', 'then', 'else', 'end', 'when', 'case', 'as', 'by', 'limit', 'offset', 'desc',
  'asc', 'distinct', 'exists', 'in', 'between', 'like', 'from',
])

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '')
}

// Splits `str` on `sep` only at paren-depth 0, so defaults like
// `default (now() + '12:00:00'::interval)` don't get split apart.
function splitTopLevel(str, sep = ',') {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of str) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === sep && depth === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  parts.push(cur)
  return parts
}

// Finds the first top-level (paren-depth 0) index of a whole-word keyword.
function findTopLevelKeyword(str, keyword) {
  const re = new RegExp(`\\b${keyword}\\b`, 'i')
  let depth = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (depth === 0) {
      const rest = str.slice(i)
      const m = rest.match(re)
      if (m && m.index === 0) return i
    }
  }
  return -1
}

function loadCombinedSql() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && !EXCLUDED_FILES.has(f))
    .sort()
  const combined = files.map(f => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')).join('\n')
  return { files, sql: stripComments(combined) }
}

function parseCreateTables(sql, tables) {
  const re = /create table (?:if not exists )?"?public"?\.?"?(\w+)"?\s*\(/gi
  let m
  while ((m = re.exec(sql))) {
    const name = m[1]
    // Balance parens from the opening "(" to find the matching close.
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (depth > 0 && i < sql.length) {
      if (sql[i] === '(') depth++
      if (sql[i] === ')') depth--
      i++
    }
    const body = sql.slice(start, i - 1)
    const cols = tables[name] || new Set()
    for (const rawLine of splitTopLevel(body, ',')) {
      const line = rawLine.trim()
      if (!line) continue
      const first = line.split(/\s+/)[0].toLowerCase()
      if (['primary', 'unique', 'foreign', 'check', 'constraint', 'exclude'].includes(first)) continue
      const colMatch = line.match(/^"?(\w+)"?/)
      if (colMatch) cols.add(colMatch[1])
    }
    tables[name] = cols
  }
}

// `alter table X add column [if not exists] col ...` — a table can grow columns in a
// later migration file without its `create table` statement ever changing.
function parseAlterTables(sql, tables) {
  const re = /alter table\s+"?public"?\.?"?(\w+)"?\s+/gi
  let m
  while ((m = re.exec(sql))) {
    const name = m[1]
    if (!tables[name]) continue // alter on a table this pass never saw created — skip rather than guess
    let i = m.index + m[0].length
    let depth = 0
    const start = i
    while (i < sql.length) {
      const ch = sql[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ';' && depth === 0) break
      i++
    }
    const body = sql.slice(start, i)
    for (const clause of splitTopLevel(body, ',')) {
      const cm = clause.trim().match(/^add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/i)
      if (cm) tables[name].add(cm[1])
    }
  }
}

function parseTables(sql) {
  const tables = {}
  // Two passes: a table can be created in one file and altered in a later one, and
  // migration files are already concatenated in filename order by loadCombinedSql.
  parseCreateTables(sql, tables)
  parseAlterTables(sql, tables)
  return tables
}

function parseFunctions(sql) {
  const byName = new Map() // last definition wins, matching `create or replace function`
  const re = /create or replace function public\.(\w+)\(([^)]*)\)[\s\S]*?as \$function\$([\s\S]*?)\$function\$/gi
  let m
  while ((m = re.exec(sql))) {
    byName.set(m[1], { name: m[1], body: m[3] })
  }
  return [...byName.values()]
}

function buildAliasMap(body, tables, fnName) {
  const aliases = {}
  // Every table is addressable by its own name even without an explicit alias.
  for (const t of Object.keys(tables)) aliases[t] = t

  const fromJoinRe = /\b(?:from|join)\s+"?public"?\.?"?(\w+)"?\s+(?:as\s+)?(\w+)/gi
  let m
  while ((m = fromJoinRe.exec(body))) {
    const [, table, alias] = m
    if (!tables[table]) continue
    if (RESERVED.has(alias.toLowerCase())) continue
    aliases[alias] = table
  }

  const declareRe = /\bdeclare\s+/i.test(body)
    ? body.match(/\bdeclare\b([\s\S]*?)\bbegin\b/i)
    : null
  if (declareRe) {
    const declBlock = declareRe[1]
    const varRe = /(\w+)\s+(\w+)\s*;/g
    let d
    while ((d = varRe.exec(declBlock))) {
      const [, alias, table] = d
      if (tables[table]) aliases[alias] = table
    }
  }

  // ON CONFLICT ... DO UPDATE SET excluded.col — excluded mirrors the insert target.
  const insertTableMatch = body.match(/insert into\s+"?public"?\.?"?(\w+)"?/i)
  if (insertTableMatch && tables[insertTableMatch[1]]) {
    aliases.excluded = insertTableMatch[1]
  }

  const triggerTable = TRIGGER_TARGET_TABLE[fnName]
  if (triggerTable) {
    aliases.new = triggerTable
    aliases.old = triggerTable
  }

  return aliases
}

function checkInsertStatements(body, tables, issues, fnName) {
  const re = /insert into\s+"?public"?\.?"?(\w+)"?\s*\(([^)]*)\)/gi
  let m
  while ((m = re.exec(body))) {
    const [, table, colList] = m
    const cols = tables[table]
    if (!cols) continue
    for (const raw of splitTopLevel(colList, ',')) {
      const col = raw.trim().replace(/^"|"$/g, '')
      if (col && !cols.has(col)) {
        issues.push(`${fnName}: insert into ${table} references missing column "${col}"`)
      }
    }
  }
}

function checkUpdateStatements(body, tables, issues, fnName) {
  const re = /update\s+"?public"?\.?"?(\w+)"?\s+set\b/gi
  let m
  while ((m = re.exec(body))) {
    const table = m[1]
    const cols = tables[table]
    if (!cols) continue
    const rest = body.slice(m.index + m[0].length)
    let end = findTopLevelKeyword(rest, 'where')
    const ret = findTopLevelKeyword(rest, 'returning')
    const semi = findTopLevelKeyword(rest, ';')
    for (const candidate of [ret, semi]) {
      if (candidate !== -1 && (end === -1 || candidate < end)) end = candidate
    }
    const setClause = end === -1 ? rest : rest.slice(0, end)
    for (const assignment of splitTopLevel(setClause, ',')) {
      const eq = assignment.indexOf('=')
      if (eq === -1) continue
      const col = assignment.slice(0, eq).trim().replace(/^"|"$/g, '')
      if (col && /^\w+$/.test(col) && !cols.has(col)) {
        issues.push(`${fnName}: update ${table} set references missing column "${col}"`)
      }
    }
  }
}

function checkAliasColumnRefs(body, aliases, tables, issues, fnName) {
  const re = /\b([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\b/g
  let m
  while ((m = re.exec(body))) {
    const [, alias, col] = m
    if (alias === 'public') continue
    const table = aliases[alias]
    if (!table) continue // not a known alias — likely a jsonb key, RECORD field, or schema
    const cols = tables[table]
    if (!cols) continue
    if (!cols.has(col)) {
      issues.push(`${fnName}: "${alias}.${col}" — ${table}.${col} does not exist`)
    }
  }
}

function main() {
  const { files, sql } = loadCombinedSql()
  if (files.length === 0) {
    console.error('No migration files found in', MIGRATIONS_DIR)
    process.exit(2)
  }

  const tables = parseTables(sql)
  const tableCount = Object.keys(tables).length
  if (tableCount === 0) {
    console.error('No tables parsed from', files.join(', '), '— check the CREATE TABLE format.')
    process.exit(2)
  }

  const fns = parseFunctions(sql)
  if (fns.length === 0) {
    console.error('No functions parsed from', files.join(', '), '— check the function delimiter format.')
    process.exit(2)
  }

  const issues = []
  for (const { name, body } of fns) {
    const aliases = buildAliasMap(body, tables, name)
    checkInsertStatements(body, tables, issues, name)
    checkUpdateStatements(body, tables, issues, name)
    checkAliasColumnRefs(body, aliases, tables, issues, name)
  }

  console.log(`Parsed ${files.length} migration file(s): ${files.join(', ')}`)
  console.log(`${tableCount} tables, ${fns.length} functions.`)
  if (issues.length === 0) {
    console.log('✓ No missing-column references found.')
    process.exit(0)
  }
  console.log(`\n✗ ${issues.length} missing-column reference(s):\n`)
  for (const issue of issues) console.log('  ' + issue)
  process.exit(1)
}

main()
