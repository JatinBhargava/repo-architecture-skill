#!/usr/bin/env node
// Reads a repository's data model into entities with their columns, each table with the file and
// line it's defined on, for a box's `entities` in architecture.json. Understands SQL migrations
// (CREATE TABLE, then ALTER TABLE … ADD/DROP COLUMN in file order), Prisma schemas, Alembic
// op.create_table and SQLModel table classes. Only reads files.
//   node schema.mjs <repo path> [--only name,name] [--out entities.json]
import fs from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
const root = path.resolve(args[0] ?? ".")
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null)
const only = opt("--only") ? new Set(opt("--only").split(",").map((s) => s.trim().toLowerCase())) : null
const out = opt("--out")

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor", "venv", ".venv", "target", "__pycache__"])
const files = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name))
    } else files.push(path.relative(root, path.join(dir, e.name)))
  }
})(root)
files.sort()

const read = (f) => fs.readFileSync(path.join(root, f), "utf8")
const lineOf = (t, i) => t.slice(0, i).split("\n").length
const tables = new Map() // name -> { name, evidence, columns: [] }
const bare = (n) => n.replace(/"/g, "").split(".").pop().toLowerCase()
const table = (name, at) => {
  const key = bare(name)
  if (!tables.has(key)) tables.set(key, { name: key, evidence: [at], columns: [] })
  return tables.get(key)
}

/** Top-level comma split (ignores commas inside parentheses and quotes). */
function splitTop(s) {
  const parts = []
  let depth = 0
  let q = null
  let cur = ""
  for (const ch of s) {
    if (q) {
      cur += ch
      if (ch === q) q = null
      continue
    }
    if (ch === "'" || ch === '"') q = ch
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (ch === "," && depth === 0) {
      parts.push(cur)
      cur = ""
    } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts.map((p) => p.replace(/--[^\n]*/g, "").trim()).filter(Boolean)
}

/** One SQL column definition: "user_id uuid not null references auth.users (id) on delete cascade". */
function sqlColumn(def) {
  const m = /^("?[\w]+"?)\s+(.+)$/s.exec(def.replace(/\s+/g, " "))
  if (!m) return null
  const rest = m[2]
  const type = (/^((?:double precision|timestamp(?:tz)?(?: with(?:out)? time zone)?|character varying|[\w.]+)(?:\s*\([^)]*\))?(?:\[\])?)/i.exec(rest) ?? [, rest.split(" ")[0]])[1]
  const col = { name: m[1].replace(/"/g, ""), type: type.toLowerCase() }
  if (/\bprimary key\b/i.test(rest)) col.key = "pk"
  const ref = /\breferences\s+([\w."]+)\s*(?:\(\s*"?(\w+)"?\s*\))?/i.exec(rest)
  if (ref) {
    col.key = col.key ?? "fk"
    col.ref = `${ref[1].replace(/"/g, "")}${ref[2] ? `.${ref[2]}` : ""}`
  }
  if (!/\bnot null\b/i.test(rest) && col.key !== "pk") col.nullable = true
  const def0 = /\bdefault\s+((?:'[^']*'|\([^)]*\)|[\w.:]+(?:\([^)]*\))?)(?:::[\w\[\]]+)?)/i.exec(rest)
  if (def0) col.default = def0[1]
  if (/\bunique\b/i.test(rest)) col.unique = true
  if (/\bgenerated\b/i.test(rest)) col.note = "generated"
  return col
}

// ---- SQL migrations, in file order ----
for (const f of files.filter((f) => f.endsWith(".sql"))) {
  const t = read(f)
  for (const m of t.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(/gi)) {
    let i = m.index + m[0].length
    let depth = 1
    const start = i
    while (i < t.length && depth > 0) {
      if (t[i] === "(") depth++
      else if (t[i] === ")") depth--
      i++
    }
    const body = t.slice(start, i - 1)
    const tb = table(m[1], `${f}:${lineOf(t, m.index)}`)
    for (const part of splitTop(body)) {
      const pk = /^(?:constraint\s+\w+\s+)?primary\s+key\s*\(([^)]*)\)/i.exec(part)
      if (pk) {
        for (const c of pk[1].split(",").map((s) => s.trim().replace(/"/g, ""))) {
          const col = tb.columns.find((x) => x.name === c)
          if (col) {
            col.key = "pk"
            delete col.nullable
          }
        }
        continue
      }
      const fk = /^(?:constraint\s+\w+\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+([\w."]+)\s*(?:\(([^)]*)\))?/i.exec(part)
      if (fk) {
        const col = tb.columns.find((x) => x.name === fk[1].trim().replace(/"/g, ""))
        if (col) {
          col.key = col.key ?? "fk"
          col.ref = `${fk[2].replace(/"/g, "")}${fk[3] ? `.${fk[3].trim()}` : ""}`
        }
        continue
      }
      if (/^(constraint|unique|check|exclude|like)\b/i.test(part)) continue
      const col = sqlColumn(part)
      if (col) tb.columns.push(col)
    }
  }
  for (const m of t.matchAll(/alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w."]+)\s+([^;]+);/gi)) {
    if (!tables.has(bare(m[1]))) continue
    const tb = tables.get(bare(m[1]))
    for (const action of splitTop(m[2])) {
      const ren = /^rename\s+(?:column\s+)?"?(\w+)"?\s+to\s+"?(\w+)"?$/i.exec(action)
      if (ren && !/^rename\s+to\b/i.test(action)) {
        const col = tb.columns.find((x) => x.name === ren[1])
        if (col) {
          col.name = ren[2]
          col.note = [col.note, `renamed from ${ren[1]} in ${f}:${lineOf(t, m.index)}`].filter(Boolean).join("; ")
        }
        continue
      }
      const add = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(.+)$/is.exec(action)
      if (add && !/^add\s+(constraint|primary|foreign|unique|check)/i.test(action)) {
        const col = sqlColumn(add[1])
        if (col && !tb.columns.some((x) => x.name === col.name)) tb.columns.push({ ...col, note: [col.note, `added in ${f}:${lineOf(t, m.index)}`].filter(Boolean).join("; ") })
      }
      const drop = /^drop\s+(?:column\s+)?(?:if\s+exists\s+)?"?(\w+)"?/i.exec(action)
      if (drop) tb.columns = tb.columns.filter((x) => x.name !== drop[1])
    }
  }
}

// ---- Prisma ----
for (const f of files.filter((f) => f.endsWith(".prisma"))) {
  const t = read(f)
  for (const m of t.matchAll(/^model\s+(\w+)\s*\{([^}]*)\}/gm)) {
    const map = /@@map\(\s*"([^"]+)"/.exec(m[2])
    const tb = table(map ? map[1] : m[1], `${f}:${lineOf(t, m.index)}`)
    for (const line of m[2].split("\n")) {
      const c = /^\s*(\w+)\s+([\w]+)(\[\])?(\?)?(.*)$/.exec(line)
      if (!c || line.trim().startsWith("@@") || line.trim().startsWith("//")) continue
      const attrs = c[5]
      const rel = /@relation\([^)]*fields:\s*\[([^\]]*)\][^)]*references:\s*\[([^\]]*)\]/.exec(attrs)
      if (/^[A-Z]/.test(c[2]) && !["String", "Int", "BigInt", "Float", "Decimal", "Boolean", "DateTime", "Json", "Bytes"].includes(c[2])) {
        // A relation field: mark its foreign-key column instead of listing it.
        if (rel) for (const fkc of rel[1].split(",").map((s) => s.trim())) {
          const col = tb.columns.find((x) => x.name === fkc)
          if (col) Object.assign(col, { key: col.key ?? "fk", ref: `${c[2]}.${rel[2].trim()}` })
          else tb.columns.push({ name: fkc, type: "?", key: "fk", ref: `${c[2]}.${rel[2].trim()}` })
        }
        continue
      }
      const col = { name: c[1], type: `${c[2]}${c[3] ?? ""}` }
      if (/@id\b/.test(attrs)) col.key = "pk"
      if (c[4]) col.nullable = true
      const d = /@default\(([^)]*\)?)\)/.exec(attrs)
      if (d) col.default = d[1]
      if (/@unique\b/.test(attrs)) col.unique = true
      const existing = tb.columns.find((x) => x.name === col.name)
      if (existing) Object.assign(existing, { ...col, key: existing.key ?? col.key, ref: existing.ref })
      else tb.columns.push(col)
    }
  }
}

// ---- Alembic op.create_table ----
for (const f of files.filter((f) => /alembic|migrations?\//.test(f) && f.endsWith(".py"))) {
  const t = read(f)
  for (const m of t.matchAll(/op\.create_table\(\s*["'](\w+)["']([\s\S]*?)\n\s*\)\s*\n/g)) {
    const tb = table(m[1], `${f}:${lineOf(t, m.index)}`)
    if (tb.columns.length) continue
    for (const c of m[2].matchAll(/sa\.Column\(\s*["'](\w+)["']\s*,\s*([^,()]+(?:\([^)]*\))?(?:\([^)]*\))?)([^\n]*)/g)) {
      const col = { name: c[1], type: c[2].replace(/^(sa|sqlmodel\.sql\.sqltypes|postgresql)\./, "").replace(/\(\)$/, "").trim() }
      if (/primary_key\s*=\s*True/.test(c[3])) col.key = "pk"
      if (/nullable\s*=\s*True/.test(c[3])) col.nullable = true
      tb.columns.push(col)
    }
    for (const fk of m[2].matchAll(/ForeignKeyConstraint\(\s*\[\s*["'](\w+)["']\s*\]\s*,\s*\[\s*["']([\w.]+)["']/g)) {
      const col = tb.columns.find((x) => x.name === fk[1])
      if (col) Object.assign(col, { key: col.key ?? "fk", ref: fk[2] })
    }
    for (const pk of m[2].matchAll(/PrimaryKeyConstraint\(([^)]*)\)/g))
      for (const n of [...pk[1].matchAll(/["'](\w+)["']/g)].map((x) => x[1])) {
        const col = tb.columns.find((x) => x.name === n)
        if (col) {
          col.key = "pk"
          delete col.nullable
        }
      }
  }
}

// ---- SQLModel (table=True classes, with fields inherited from their bases) ----
for (const f of files.filter((f) => f.endsWith(".py"))) {
  const t = read(f)
  if (!/table\s*=\s*True/.test(t)) continue
  const classes = new Map()
  for (const m of t.matchAll(/^class\s+(\w+)\(([^)]*)\):\n((?:[ \t]+[^\n]*\n|\n)*)/gm)) {
    const fields = []
    // Field definitions, joining a Field( … ) that runs over several lines.
    const lines = m[3].split("\n")
    for (let li = 0; li < lines.length; li++) {
      const fm = /^[ \t]{4}(\w+)\s*:\s*([^=\n]+?)(?:\s*=\s*(.+))?$/.exec(lines[li])
      if (!fm) continue
      let init = fm[3] ?? ""
      let depth = (init.match(/\(/g) ?? []).length - (init.match(/\)/g) ?? []).length
      while (depth > 0 && li + 1 < lines.length) {
        li++
        init += " " + lines[li].trim()
        depth += (lines[li].match(/\(/g) ?? []).length - (lines[li].match(/\)/g) ?? []).length
      }
      if (fm[1].startsWith("_") || /Relationship\(/.test(init) || /^list\[/.test(fm[2])) continue
      fields.push({ name: fm[1], type: fm[2].trim(), init })
    }
    classes.set(m[1], { bases: m[2].split(",").map((s) => s.trim()), fields, at: `${f}:${lineOf(t, m.index)}`, isTable: /table\s*=\s*True/.test(m[2]) })
  }
  const collect = (name, seen = new Set()) => {
    const c = classes.get(name)
    if (!c || seen.has(name)) return []
    seen.add(name)
    const inherited = c.bases.flatMap((b) => collect(b, seen))
    const own = new Map([...inherited, ...c.fields].map((x) => [x.name, x]))
    return [...own.values()]
  }
  for (const [name, c] of classes) {
    if (!c.isTable) continue
    const tb = table(name, c.at)
    tb.columns = collect(name).map((x) => {
      const col = { name: x.name, type: x.type.replace(/\s*\|\s*None/, "") }
      if (/primary_key\s*=\s*True/.test(x.init)) col.key = "pk"
      const fk = /foreign_key\s*=\s*["']([\w.]+)["']/.exec(x.init)
      if (fk) Object.assign(col, { key: col.key ?? "fk", ref: fk[1] })
      if (/\|\s*None/.test(x.type) && col.key !== "pk") col.nullable = true
      if (/unique\s*=\s*True/.test(x.init)) col.unique = true
      return col
    })
  }
}

const entities = [...tables.values()].filter((t) => (!only || only.has(t.name)) && t.columns.length)
if (out) fs.writeFileSync(out, JSON.stringify(entities, null, 1))
for (const e of entities) console.log(`${e.name.padEnd(22)} ${String(e.columns.length).padStart(3)} columns  ← ${e.evidence[0]}`)
if (!entities.length) console.log("No tables found (SQL migrations, Prisma, Alembic or SQLModel).")
