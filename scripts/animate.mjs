#!/usr/bin/env node
// Makes an animated SVG of the architecture with one flow playing through it: the same zones,
// parts and lines as the interactive page; a request dot travels each hop along the real
// connections, the line and its two parts light up, and a caption names the step. Animated with
// SVG's own animation (SMIL), so it plays wherever SVGs show (browsers, GitHub, Notion) and can be
// frozen at any moment for video (scripts/animate-video.mjs). Needs only Node.
// With --video it also writes an MP4 and a GIF beside the SVG (scripts/animate-video.mjs).
//   node animate.mjs <architecture.json> <out.svg> [--flow <id>] [--title "<text>"] [--footer "<text>"] [--tag "<text>"] [--video]
// --tag sets the short line in the bottom-left corner ("Sketch your product →" unless given; --tag "" leaves it out).
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null)
const VALUE_FLAGS = new Set(["--flow", "--title", "--footer", "--tag"])
const [modelPath, outPath] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUE_FLAGS.has(args[i - 1])))
if (!modelPath || !outPath) {
  console.error('usage: animate.mjs <architecture.json> <out.svg> [--flow <id>] [--title "<text>"] [--footer "<text>"] [--tag "<text>"] [--video]')
  process.exit(2)
}
const m = JSON.parse(fs.readFileSync(modelPath, "utf8"))
const flow = opt("--flow") ? m.flows.find((f) => f.id === opt("--flow")) : m.flows[0]
if (!flow) {
  console.error(`No flow "${opt("--flow")}". Flows: ${m.flows.map((f) => f.id).join(", ")}`)
  process.exit(2)
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])

// ---- The steps this flow takes with every "what if" off ----
const steps = []
for (const s of flow.steps) {
  if (s.when && !s.when.startsWith("!")) continue
  steps.push(s)
  if (s.kind === "block") break
}

// ---- Layout: the interactive page's own ----
const COL_W = 236, COL_GAP = 40, PAD = 20, NODE_W = 200, NODE_H = 60, BIG_H = 86, ROW_GAP = 20, TOP = 48
const KIND_GUESS = [
  [/\b(postgres|mysql|sqlite|mongo|database|db|dynamo)\b/, "db"], [/\b(redis|cache|memcache)/, "cache"], [/\b(s3|bucket|storage|blob)\b/, "storage"],
  [/\b(queue|kafka|rabbit|sqs|pubsub|stream)/, "queue"], [/\b(cron|schedul|daily|nightly)/, "cron"], [/\b(claude|anthropic|openai|gpt|gemini|llm|ai)\b/, "ai"],
  [/\b(stripe|dodo|paypal|razorpay|payments?|billing|checkout)\b/, "payment"], [/\b(smtp|email|mail|sendgrid|resend)\b/, "email"],
  [/\b(telegram|slack|discord|twilio|sms)\b/, "chat"], [/\b(auth|login|jwt|oauth|identity|sign-?in)/, "auth"], [/\b(cdn|static site|edge)/, "cdn"],
  [/\b(proxy|gateway|traefik|nginx|load balancer|ingress)\b/, "gateway"], [/\b(worker|job|steps?|task|consumer)\b/, "worker"],
  [/\b(browser|web app|mobile|desktop|client|frontend|react|admin)/, "client"],
]
const boxes = {}
let bottom = 0
m.zones.forEach((z, col) => {
  let y = TOP
  const x = PAD + col * (COL_W + COL_GAP) + (COL_W - NODE_W) / 2
  for (const n of m.nodes.filter((n) => n.zone === z.id)) {
    const h = n.big ? BIG_H : NODE_H
    const words = `${n.title} ${n.sub}`.toLowerCase()
    const kind = n.kind ?? KIND_GUESS.find(([re]) => re.test(words))?.[1] ?? (col === m.zones.length - 1 ? "external" : "service")
    boxes[n.id] = { id: n.id, x, y, w: NODE_W, h, col, title: n.title, sub: n.sub, kind, n }
    y += h + ROW_GAP
  }
  bottom = Math.max(bottom, y)
})
const DW = PAD * 2 + m.zones.length * COL_W + (m.zones.length - 1) * COL_GAP
const DH = bottom + 4

function pathBetween(a, b) {
  const A = boxes[a], B = boxes[b]
  const dxc = B.x + B.w / 2 - (A.x + A.w / 2)
  if (Math.abs(dxc) < (A.w + B.w) / 2 - 24) {
    const down = B.y > A.y
    const x1 = A.x + A.w - 18, y1 = down ? A.y + A.h : A.y
    const x2 = B.x + B.w - 18, y2 = down ? B.y : B.y + B.h
    const bulge = 34 + Math.abs(y2 - y1) * 0.15
    return [[x1, y1], [x1 + bulge, y1 + (down ? 10 : -10)], [x2 + bulge, y2 + (down ? -10 : 10)], [x2, y2]]
  }
  const right = dxc > 0
  const lane = right ? -7 : 7
  const x1 = right ? A.x + A.w : A.x, y1 = A.y + A.h / 2 + lane
  const x2 = right ? B.x : B.x + B.w, y2 = B.y + B.h / 2 + lane
  const dx = (x2 - x1) * 0.45
  return [[x1, y1], [x1 + dx, y1], [x2 - dx, y2], [x2, y2]]
}
const bez = (p, t) => {
  const u = 1 - t
  return [0, 1].map((k) => u ** 3 * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t ** 3 * p[3][k])
}
function atLength(p, frac, n = 400) {
  const pts = Array.from({ length: n + 1 }, (_, i) => bez(p, i / n))
  const seg = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]))
  const want = seg.reduce((a, b) => a + b, 0) * frac
  let run = 0
  for (let i = 0; i < seg.length; i++) {
    if (run + seg[i] >= want) return pts[i]
    run += seg[i]
  }
  return pts[n]
}
const f1 = (v) => v.toFixed(1)
const dstr = (p) => `M${f1(p[0][0])},${f1(p[0][1])} C${f1(p[1][0])},${f1(p[1][1])} ${f1(p[2][0])},${f1(p[2][1])} ${f1(p[3][0])},${f1(p[3][1])}`

// ---- Timeline ----
const MOVE = 0.8, CHECK = 0.6, DWELL = 0.75, LEAD = 0.6, TAIL = 1.6
const timeline = []
let t = LEAD
for (const s of steps) {
  const d = s.from === s.to ? CHECK : MOVE
  timeline.push({ s, start: t, end: t + d, until: t + d + DWELL })
  t += d + DWELL
}
const T = Math.round((t + TAIL) * 100) / 100
const kt = (x) => Math.max(0, Math.min(1, x / T)).toFixed(5)
/** An attribute that is `on` inside the intervals and `off` elsewhere, looping with the flow. */
function discrete(intervals, on = "1", off = "0") {
  const raw = [[0, off]]
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) raw.push([a, on], [b, off])
  let last = -1
  const pairs = raw.map(([tm, v]) => {
    tm = Math.max(tm, last + 0.0005)
    last = tm
    return [tm, v]
  })
  return [pairs.map(([x]) => kt(x)).join(";"), pairs.map(([, v]) => v).join(";")]
}
const ANIM = `dur="${T}s" repeatCount="indefinite"`

// ---- Look (breakscale-style, light) ----
const KINDS = {
  client: ["#f2effe", "#866fc2", "#534775"], cdn: ["#e2f6f4", "#00948e", "#005d59"], gateway: ["#e5f3fe", "#2388c3", "#235575"],
  service: ["#eaf2ff", "#567fca", "#394f79"], worker: ["#edf1ff", "#6a79ca", "#434c79"], queue: ["#f5eefc", "#9769b8", "#5c446f"],
  db: ["#e4f4fd", "#008cb9", "#185771"], cache: ["#fbefe2", "#af7112", "#6a481c"], storage: ["#e2f6f6", "#009394", "#005c5d"],
  cron: ["#f4f2e2", "#928100", "#595019"], ai: ["#fcecf4", "#b45f90", "#6d3e58"], auth: ["#e9f5e9", "#4b934f", "#345b35"],
  payment: ["#ffeced", "#be5d6c", "#733d45"], email: ["#feede5", "#ba6734", "#704328"], chat: ["#feede5", "#ba6734", "#704328"],
  external: ["#feede5", "#ba6734", "#704328"],
}
const ICONS = {
  client: '<rect x="2" y="4" width="14" height="10" rx="2"/><path d="M6 18h6"/><rect x="17" y="8" width="5" height="11" rx="1"/>',
  cdn: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  gateway: '<rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 17.5h.01M10 17.5h.01M15 14V9M12 6a4.2 4.2 0 0 1 6 0"/>',
  service: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  worker: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  queue: '<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 12l10 5 10-5M2 17l10 5 10-5"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  cache: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',
  storage: '<rect x="2" y="13" width="20" height="8" rx="2"/><path d="M5 13l3-9h8l3 9M6 17h.01M10 17h.01"/>',
  cron: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ai: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  auth: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M17 6l3 3M15 8l2 2"/>',
  payment: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.8 7L3 21l2-6.2A8 8 0 1 1 21 12z"/>',
  external: '<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4 12a4 4 0 0 0 1 7.9h12.5z"/>',
}
const TONE = { req: "#325cbd", res: "#187a3b", check: "#945500", block: "#c52b30" }
const WORD = { req: "REQUEST", res: "REPLY", check: "CHECK", block: "STOPPED" }

// ---- Page frame (16:9) and where the diagram sits ----
const W = 1600, H = 900
const S = Math.min(1440 / DW, 520 / DH)
const DX0 = (W - DW * S) / 2
// Diagram and caption centred between the title (ends ~130) and the footer (~850).
const DY0 = Math.round(130 + (720 - (DH * S + 26 + 112)) / 2)
const used = new Set(steps.flatMap((s) => [s.from, s.to]))
const out = []

for (const z of m.zones) {
  const mine = Object.values(boxes).filter((b) => b.n.zone === z.id)
  if (!mine.length) continue
  const x = Math.min(...mine.map((b) => b.x)) - 18, y = Math.min(...mine.map((b) => b.y)) - 36
  const r = Math.max(...mine.map((b) => b.x + b.w)) + 18, btm = Math.max(...mine.map((b) => b.y + b.h)) + 16
  out.push(`<rect x="${x}" y="${y}" width="${r - x}" height="${btm - y}" rx="14" fill="none" stroke="#b3aba1" stroke-dasharray="4 5"/>`)
  out.push(`<text x="${x + 14}" y="${y + 22}" class="mono" font-size="10.5" letter-spacing="0.7" fill="#525862">${esc(z.label.toUpperCase())}</text>`)
}
const drawn = new Set()
for (const s of steps) {
  if (s.from === s.to) continue
  const key = [s.from, s.to].sort().join("|")
  if (drawn.has(key)) continue
  drawn.add(key)
  out.push(`<path d="${dstr(pathBetween(s.from, s.to))}" fill="none" stroke="#b3aba1" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="1.5 5"/>`)
}
for (const b of Object.values(boxes)) {
  const [f, st, ink] = KINDS[b.kind] ?? KINDS.service
  const ivs = timeline.filter((e) => e.s.from === b.id || e.s.to === b.id).map((e) => [e.start, e.until])
  let ring = ""
  if (ivs.length) {
    const [k, v] = discrete(ivs)
    ring = `<rect x="${b.x - 5}" y="${b.y - 5}" width="${b.w + 10}" height="${b.h + 10}" rx="14" fill="#e3edff" stroke="#325cbd" stroke-width="2.5" opacity="0"><animate attributeName="opacity" calcMode="discrete" keyTimes="${k}" values="${v}" ${ANIM}/></rect>`
  }
  const count = (b.n.endpoints ?? []).length || (b.n.entities ?? []).length
  const badge = count
    ? `<rect x="${b.x + b.w - 38}" y="${b.y - 7}" width="34" height="16" rx="8" fill="#fffdfa" stroke="${st}"/><text x="${b.x + b.w - 21}" y="${b.y + 5}" text-anchor="middle" class="mono" font-size="9.5" font-weight="650" fill="${ink}">${count}</text>`
    : ""
  out.push(
    `<g${used.has(b.id) ? "" : ' opacity="0.3"'}>${ring}<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="${f}" stroke="${st}" stroke-width="1.5"/>` +
      `<g transform="translate(${b.x + 12},${b.y + 11}) scale(0.67)" fill="none" stroke="${st}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[b.kind] ?? ICONS.service}</g>` +
      `<text x="${b.x + 35}" y="${b.y + 24}" font-size="14" font-weight="550" fill="${ink}">${esc(b.title)}</text>` +
      `<line x1="${b.x + 12}" x2="${b.x + b.w - 12}" y1="${b.y + 33}" y2="${b.y + 33}" stroke="${st}" stroke-opacity=".3"/>` +
      `<text x="${b.x + 12}" y="${b.y + 49}" class="mono" font-size="9.5" letter-spacing="0.4" fill="${ink}" opacity=".85">${esc(b.sub.toUpperCase())}</text>${badge}</g>`,
  )
}
// Each hop lit while it's the current step: its line with an arrow and a numbered badge.
timeline.forEach((e, i) => {
  const s = e.s
  const [k, v] = discrete([[e.start, e.until]])
  const tone = TONE[s.kind]
  const show = `<animate attributeName="opacity" calcMode="discrete" keyTimes="${k}" values="${v}" ${ANIM}/>`
  if (s.from === s.to) {
    const B = boxes[s.from]
    const bx = B.x + B.w - 4, by = B.y + 4
    out.push(
      `<g opacity="0">${show}<rect x="${B.x - 5}" y="${B.y - 5}" width="${B.w + 10}" height="${B.h + 10}" rx="14" fill="none" stroke="${tone}" stroke-width="2.5" stroke-dasharray="5 4"/>` +
        `<circle cx="${bx}" cy="${by}" r="11" fill="${tone}" stroke="#faf7f3" stroke-width="2"/><text x="${bx}" y="${by + 4}" text-anchor="middle" class="mono" font-size="11" font-weight="650" fill="#fff">${i + 1}</text></g>`,
    )
    return
  }
  const p = pathBetween(s.from, s.to)
  const [mx, my] = atLength(p, 0.5)
  const end = p[3], before = atLength(p, 0.985)
  const ang = (Math.atan2(end[1] - before[1], end[0] - before[0]) * 180) / Math.PI
  out.push(
    `<g opacity="0">${show}<path d="${dstr(p)}" fill="none" stroke="${tone}" stroke-width="2.6" stroke-linecap="round"/>` +
      `<path d="M-9,-5 L1,0 L-9,5 z" fill="${tone}" transform="translate(${f1(end[0])},${f1(end[1])}) rotate(${f1(ang)})"/>` +
      `<circle cx="${f1(mx)}" cy="${f1(my - 16)}" r="11" fill="#1e242e" stroke="#faf7f3" stroke-width="2"/>` +
      `<text x="${f1(mx)}" y="${f1(my - 12)}" text-anchor="middle" class="mono" font-size="11" font-weight="650" fill="#faf7f3">${i + 1}</text></g>`,
  )
  // The request dot for this hop, moving along this line only (one motion path per hop keeps it exact).
  out.push(
    `<g opacity="0">${show}<animateMotion path="${dstr(p)}" calcMode="spline" keyTimes="0;${kt(e.start)};${kt(e.end)};1" keyPoints="0;0;1;1" keySplines="0 0 1 1;.45 0 .55 1;0 0 1 1" ${ANIM}/>` +
      `<circle r="9" fill="#faf7f3"/><circle r="6" fill="${tone}"/></g>`,
  )
})

// ---- Captions: one per step, and a title card before and after ----
const CY = DY0 + DH * S + 26
const caps = timeline.map((e, i) => {
  const s = e.s
  const [k, v] = discrete([[e.start, e.until]])
  const route = s.from === s.to ? boxes[s.from].title : `${boxes[s.from].title} → ${boxes[s.to].title}`
  let detail = s.detail ?? ""
  if (detail.length > 118) detail = `${detail.slice(0, 117).replace(/\s+\S*$/, "")}…`
  return (
    `<g opacity="0"><animate attributeName="opacity" calcMode="discrete" keyTimes="${k}" values="${v}" ${ANIM}/>` +
    `<circle cx="106" cy="${CY + 24}" r="5" fill="${TONE[s.kind]}"/>` +
    `<text x="120" y="${CY + 29}" class="mono" font-size="13" letter-spacing="0.8" fill="#525862">STEP ${i + 1} OF ${timeline.length} · ${WORD[s.kind]} · ${esc(route.toUpperCase())}</text>` +
    `<text x="96" y="${CY + 64}" font-size="27" font-weight="650" letter-spacing="-0.5" fill="#1e242e">${esc(s.text)}</text>` +
    `<text x="96" y="${CY + 92}" font-size="16" fill="#525862">${esc(detail)}</text></g>`
  )
})
const [ik, iv] = discrete([[0, timeline[0].start], [timeline.at(-1).until, T]])
caps.push(
  `<g><animate attributeName="opacity" calcMode="discrete" keyTimes="${ik}" values="${iv}" ${ANIM}/>` +
    `<text x="96" y="${CY + 29}" class="mono" font-size="13" letter-spacing="0.8" fill="#525862">${esc(flow.name.toUpperCase())} · ${timeline.length} STEPS THROUGH ${used.size} PARTS</text>` +
    `<text x="96" y="${CY + 64}" font-size="27" font-weight="650" letter-spacing="-0.5" fill="#1e242e">${esc(flow.summary ?? flow.name)}</text>` +
    `<text x="96" y="${CY + 92}" font-size="16" fill="#525862">Every hop is read from the code: the dot is the request; faded parts take no part in this flow.</text></g>`,
)
const legend = ["req", "res", "check", "block"]
  .map((k, j) => `<circle cx="${1186 + j * 92}" cy="96" r="5" fill="${TONE[k]}"/><text x="${1196 + j * 92}" y="100" class="mono" font-size="12" letter-spacing="0.6" fill="#525862">${WORD[k]}</text>`)
  .join("")
const title = opt("--title") ?? `${flow.name}, hop by hop`
const tag = opt("--tag") ?? "Sketch your product →"
const footer = opt("--footer") ?? (m.meta.url ? m.meta.url.replace(/^https?:\/\//, "") : m.meta.repo)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">${esc(m.meta.name)} system design: ${esc(flow.name)}</title>
<desc id="d">${esc(m.meta.name)} architecture with the "${esc(flow.name)}" flow playing through it, ${timeline.length} steps through ${used.size} parts.</desc>
<style>
text{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,Roboto,"Helvetica Neue",Arial,sans-serif}
.mono{font-family:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace}
</style>
<defs>
<pattern id="minor" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#f1ece6"/></pattern>
<pattern id="major" width="120" height="120" patternUnits="userSpaceOnUse"><rect width="120" height="120" fill="url(#minor)"/><path d="M120 0H0V120" fill="none" stroke="#e7e2dc"/></pattern>
</defs>
<rect width="${W}" height="${H}" fill="#faf7f3"/>
<rect width="${W}" height="${H}" fill="url(#major)"/>
<text x="80" y="62" class="mono" font-size="13" letter-spacing="1" fill="#525862">SYSTEM DESIGN · ${esc(m.meta.name.toUpperCase())}</text>
<text x="80" y="108" font-size="40" font-weight="700" letter-spacing="-1.4" fill="#1e242e">${esc(title)}</text>
${legend}
<g transform="translate(${f1(DX0)},${DY0}) scale(${S.toFixed(4)})">${out.join("")}</g>
<rect x="80" y="${f1(CY)}" width="1440" height="112" rx="14" fill="#fffdfa" stroke="#e8e2da"/>
${caps.join("")}
<rect x="80" y="${H - 40}" width="1440" height="4" rx="2" fill="#ece7e0"/>
<rect x="80" y="${H - 40}" width="0" height="4" rx="2" fill="#325cbd"><animate attributeName="width" values="0;1440;1440" keyTimes="0;${kt(timeline.at(-1).until)};1" ${ANIM}/></rect>
${tag ? `<text x="80" y="${H - 52}" class="mono" font-size="14" font-weight="650" letter-spacing="0.4" fill="#1e242e">${esc(tag)}</text>` : ""}
<text x="1520" y="${H - 52}" text-anchor="end" class="mono" font-size="14" font-weight="650" fill="#325cbd">${esc(footer)}</text>
</svg>
`
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(outPath, svg)
console.log(`animated=${path.resolve(outPath)} (${Math.round(Buffer.byteLength(svg) / 1024)} KB): ${flow.id}, ${timeline.length} steps, ${T}s loop`)
if (args.includes("--video")) {
  const video = path.join(path.dirname(fileURLToPath(import.meta.url)), "animate-video.mjs")
  const r = spawnSync(process.execPath, [video, path.resolve(outPath)], { stdio: "inherit" })
  if (r.status !== 0) process.exitCode = r.status ?? 1
}
