#!/usr/bin/env node
// Checks an architecture model before it's built.
//   node validate.mjs <architecture.json> [--repo <path>]
// Errors stop the build; warnings are printed. With --repo, every evidence "path:line" must exist.
import fs from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
const file = args[0]
const repo = args.includes("--repo") ? args[args.indexOf("--repo") + 1] : null
if (!file) {
  console.error("usage: validate.mjs <architecture.json> [--repo <path>]")
  process.exit(2)
}

const errors = []
const warnings = []
let m
try {
  m = JSON.parse(fs.readFileSync(file, "utf8"))
} catch (e) {
  console.error(`Can't read ${file}: ${e.message}`)
  process.exit(1)
}

const need = (cond, msg) => cond || errors.push(msg)
need(m.meta?.name && m.meta?.repo && m.meta?.summary, "meta needs name, repo and summary")
need(Array.isArray(m.zones) && m.zones.length >= 2, "zones: at least 2")
need(Array.isArray(m.nodes) && m.nodes.length >= 3, "nodes: at least 3")
need(Array.isArray(m.flows) && m.flows.length >= 1, "flows: at least 1")
if (errors.length) finish()

const zoneIds = new Set()
for (const z of m.zones) {
  need(z.id && z.label, `zone without id or label: ${JSON.stringify(z)}`)
  need(!zoneIds.has(z.id), `duplicate zone id: ${z.id}`)
  zoneIds.add(z.id)
}
if (m.zones.length > 5) warnings.push(`${m.zones.length} zones: more than 5 columns gets wide; merge some`)

const NODE_KINDS = new Set(["client", "cdn", "gateway", "service", "worker", "queue", "db", "cache", "storage", "cron", "ai", "auth", "payment", "email", "chat", "external"])
const nodeIds = new Set()
const perZone = {}
for (const n of m.nodes) {
  need(n.id && n.title && n.sub !== undefined, `node needs id, title and sub: ${JSON.stringify(n)}`)
  need(!nodeIds.has(n.id), `duplicate node id: ${n.id}`)
  need(zoneIds.has(n.zone), `node ${n.id}: unknown zone "${n.zone}"`)
  nodeIds.add(n.id)
  for (const e of n.entities ?? []) need(typeof e.name === "string" && Array.isArray(e.columns), `node ${n.id}: entity needs a name and columns: ${JSON.stringify(e).slice(0, 80)}`)
  for (const e of n.endpoints ?? []) need(typeof e.method === "string" && typeof e.path === "string" && e.path.startsWith("/"), `node ${n.id}: endpoint needs a method and a path starting with "/": ${JSON.stringify(e)}`)
  if (n.kind !== undefined) need(NODE_KINDS.has(n.kind), `node ${n.id}: kind must be one of ${[...NODE_KINDS].join(", ")} (got "${n.kind}")`)
  perZone[n.zone] = (perZone[n.zone] ?? 0) + 1
  if (n.title?.length > 22) warnings.push(`node ${n.id}: title "${n.title}" is long for its box (22 characters fit)`)
  if (n.sub?.length > 30) warnings.push(`node ${n.id}: sub "${n.sub}" is long for its box (30 characters fit)`)
}
for (const [z, k] of Object.entries(perZone)) if (k > 7) warnings.push(`zone ${z} has ${k} boxes; 7 or fewer read best`)
for (const z of zoneIds) if (!perZone[z]) warnings.push(`zone ${z} has no boxes`)

const KINDS = new Set(["req", "res", "check", "block"])
const usedNodes = new Set()
const flowIds = new Set()
for (const f of m.flows) {
  need(f.id && f.name && Array.isArray(f.steps), `flow needs id, name and steps: ${f.id ?? f.name}`)
  need(!flowIds.has(f.id), `duplicate flow id: ${f.id}`)
  flowIds.add(f.id)
  const toggles = new Set((f.toggles ?? []).map((t) => t.id))
  if ((f.steps ?? []).length < 3) warnings.push(`flow ${f.id}: only ${f.steps?.length ?? 0} steps`)
  ;(f.steps ?? []).forEach((s, i) => {
    const at = `flow ${f.id} step ${i + 1}`
    need(nodeIds.has(s.from), `${at}: unknown "from" node "${s.from}"`)
    need(nodeIds.has(s.to), `${at}: unknown "to" node "${s.to}"`)
    need(KINDS.has(s.kind), `${at}: kind must be req, res, check or block (got "${s.kind}")`)
    need(typeof s.text === "string" && s.text.length > 0, `${at}: text is required`)
    if (s.endpoint) {
      const target = m.nodes.find((n) => n.id === s.to)
      const keys = (target?.endpoints ?? []).map((e) => `${e.method.toUpperCase()} ${e.path}`)
      need(keys.includes(s.endpoint), `${at}: endpoint "${s.endpoint}" isn't one of ${s.to}'s endpoints`)
    }
    if (s.entities) {
      const target = m.nodes.find((n) => n.id === s.to)
      const names = (target?.entities ?? []).map((e) => e.name)
      for (const e of s.entities) need(names.includes(e), `${at}: table "${e}" isn't one of ${s.to}'s entities`)
    }
    if (s.when) need(toggles.has(s.when.replace(/^!/, "")), `${at}: "when" names a toggle this flow doesn't have: ${s.when}`)
    if (s.kind === "block" && !s.when) warnings.push(`${at}: a block without "when" always ends the flow here`)
    for (const k of ["ms", "usd", "counter"]) if (s[k] !== undefined) need(typeof s[k] === "number", `${at}: ${k} must be a number`)
    usedNodes.add(s.from)
    usedNodes.add(s.to)
  })
  for (const t of toggles) if (!(f.steps ?? []).some((s) => s.when?.replace(/^!/, "") === t)) warnings.push(`flow ${f.id}: toggle "${t}" changes nothing`)
}
for (const n of nodeIds) if (!usedNodes.has(n)) warnings.push(`node ${n} isn't used by any flow`)

// Evidence: "path" or "path:line", relative to the repository.
if (repo) {
  const all = []
  const collect = (list, where) => (list ?? []).forEach((e) => all.push([e, where]))
  m.nodes.forEach((n) => collect(n.evidence, `node ${n.id}`))
  m.nodes.forEach((n) => (n.endpoints ?? []).forEach((e) => collect(e.evidence, `node ${n.id} ${e.method} ${e.path}`)))
  m.nodes.forEach((n) => (n.entities ?? []).forEach((e) => collect(e.evidence, `node ${n.id} table ${e.name}`)))
  m.flows.forEach((f) => f.steps.forEach((s, i) => collect(s.evidence, `flow ${f.id} step ${i + 1}`)))
  ;(m.components ?? []).forEach((c) => collect(c.evidence, `component ${c.name}`))
  ;(m.data ?? []).forEach((d) => collect(d.evidence, `data ${d.name}`))
  ;(m.guards ?? []).forEach((g) => collect(g.evidence, `guard ${g.what}`))
  let checked = 0
  for (const [e, where] of all) {
    const mt = /^(.*?)(?::(\d+))?$/.exec(e)
    const p = path.join(repo, mt[1])
    if (!fs.existsSync(p)) {
      errors.push(`${where}: evidence "${e}" doesn't exist in the repository`)
      continue
    }
    if (mt[2] && fs.statSync(p).isFile()) {
      const lines = fs.readFileSync(p, "utf8").split("\n").length
      if (Number(mt[2]) > lines) errors.push(`${where}: evidence "${e}" points past the end of the file (${lines} lines)`)
    }
    checked++
  }
  console.log(`evidence: ${checked} of ${all.length} references found in ${repo}`)
  const steps = m.flows.flatMap((f) => f.steps)
  const cited = steps.filter((s) => s.evidence?.length).length
  if (cited < steps.length / 2) warnings.push(`only ${cited} of ${steps.length} steps cite evidence`)
}

finish()

function finish() {
  for (const w of warnings) console.log(`warning: ${w}`)
  for (const e of errors) console.error(`error: ${e}`)
  if (errors.length) {
    console.error(`${errors.length} error(s); fix the model and run again.`)
    process.exit(1)
  }
  console.log(`model ok: ${m.zones.length} zones, ${m.nodes.length} boxes, ${m.flows.length} flows, ${m.flows.reduce((n, f) => n + f.steps.length, 0)} steps`)
  process.exit(0)
}
