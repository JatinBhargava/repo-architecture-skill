import {
  ClockIcon,
  CloudIcon,
  CogIcon,
  CreditCardIcon,
  DatabaseIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  GlobeIcon,
  HardDriveIcon,
  KeyRoundIcon,
  LayersIcon,
  type LucideIcon,
  MailIcon,
  MessageCircleIcon,
  MonitorSmartphoneIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  RouterIcon,
  ServerIcon,
  SparklesIcon,
  StepForwardIcon,
  XIcon,
  ZapIcon,
} from "lucide-react"
import { type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { Column, Endpoint, Entity, Flow, Model, NodeKind, Step } from "./types"

// ---- Layout: one column per zone, boxes stacked in the order the model lists them ----
const COL_W = 236
const COL_GAP = 40
const PAD = 20
const NODE_W = 200
const NODE_H = 60
const BIG_H = 86
const ROW_GAP = 20
const TOP = 48

// ---- Part kinds: colour (CSS variables in index.css) and icon ----
const KIND_ICON: Record<NodeKind, LucideIcon> = {
  client: MonitorSmartphoneIcon,
  cdn: GlobeIcon,
  gateway: RouterIcon,
  service: ServerIcon,
  worker: CogIcon,
  queue: LayersIcon,
  db: DatabaseIcon,
  cache: ZapIcon,
  storage: HardDriveIcon,
  cron: ClockIcon,
  ai: SparklesIcon,
  auth: KeyRoundIcon,
  payment: CreditCardIcon,
  email: MailIcon,
  chat: MessageCircleIcon,
  external: CloudIcon,
}
/** Colour family for each kind (email and chat share the outside-service colours). */
const KIND_COLOUR: Record<NodeKind, string> = {
  client: "client", cdn: "cdn", gateway: "gateway", service: "service", worker: "worker", queue: "queue", db: "db",
  cache: "cache", storage: "storage", cron: "cron", ai: "ai", auth: "auth", payment: "payment", email: "external",
  chat: "external", external: "external",
}
/** A kind from the box's words, when the model doesn't give one. */
function guessKind(title: string, sub: string, col: number, cols: number): NodeKind {
  const t = `${title} ${sub}`.toLowerCase()
  const has = (re: RegExp) => re.test(t)
  if (has(/\b(postgres|mysql|sqlite|mongo|database|db|dynamo|planetscale|cockroach)\b/)) return "db"
  if (has(/\b(redis|cache|memcache|upstash)/)) return "cache"
  if (has(/\b(s3|bucket|storage|blob|r2)\b/)) return "storage"
  if (has(/\b(queue|kafka|rabbit|sqs|pubsub|stream|bull)/)) return "queue"
  if (has(/\b(cron|schedul|timer|daily|nightly)/)) return "cron"
  if (has(/\b(claude|anthropic|openai|gpt|gemini|llm|ai)\b/)) return "ai"
  if (has(/\b(stripe|dodo|paypal|razorpay|payments?|billing|checkout|paddle)\b/)) return "payment"
  if (has(/\b(smtp|email|mail|sendgrid|resend|postmark|ses)\b/)) return "email"
  if (has(/\b(telegram|slack|discord|twilio|whatsapp|sms)\b/)) return "chat"
  if (has(/\b(auth|login|jwt|oauth|identity|sign-?in|clerk|auth0|keycloak)/)) return "auth"
  if (has(/\b(cdn|static site|edge|cloudfront)/)) return "cdn"
  if (has(/\b(proxy|gateway|traefik|nginx|load balancer|ingress)\b/)) return "gateway"
  if (has(/\b(worker|job|steps?|task|consumer|celery|sidekiq)\b/)) return "worker"
  if (has(/\b(browser|web app|mobile|desktop|client|frontend|react|ios|android|admin)/)) return "client"
  return col === cols - 1 ? "external" : "service"
}

interface Box {
  id: string
  x: number
  y: number
  w: number
  h: number
  col: number
  title: string
  sub: string
  kind: NodeKind
}

function layout(model: Model) {
  const boxes: Record<string, Box> = {}
  let bottom = 0
  const cols = model.zones.length
  model.zones.forEach((z, col) => {
    let y = TOP
    const x = PAD + col * (COL_W + COL_GAP) + (COL_W - NODE_W) / 2
    for (const n of model.nodes.filter((n) => n.zone === z.id)) {
      const h = n.big ? BIG_H : NODE_H
      boxes[n.id] = { id: n.id, x, y, w: NODE_W, h, col, title: n.title, sub: n.sub, kind: n.kind ?? guessKind(n.title, n.sub, col, cols) }
      y += h + ROW_GAP
    }
    bottom = Math.max(bottom, y)
  })
  const width = PAD * 2 + cols * COL_W + (cols - 1) * COL_GAP
  return { boxes, width, height: bottom + 4 }
}

/**
 * A curve from box a to box b, leaving and arriving on the sides that face each other. Boxes
 * stacked one above the other get a curve that bows out to the right, clear of the boxes between.
 */
function pathBetween(A: Box, B: Box) {
  const dxc = B.x + B.w / 2 - (A.x + A.w / 2)
  if (Math.abs(dxc) < (A.w + B.w) / 2 - 24) {
    const down = B.y > A.y
    const x1 = A.x + A.w - 18
    const y1 = down ? A.y + A.h : A.y
    const x2 = B.x + B.w - 18
    const y2 = down ? B.y : B.y + B.h
    const bulge = 34 + Math.abs(y2 - y1) * 0.15
    return `M${x1},${y1} C${x1 + bulge},${y1 + (down ? 10 : -10)} ${x2 + bulge},${y2 + (down ? -10 : 10)} ${x2},${y2}`
  }
  const right = dxc > 0
  // Calls going right run a little above centre and replies going left a little below, so a
  // request and its answer between the same boxes never sit on one line.
  const lane = right ? -7 : 7
  const x1 = right ? A.x + A.w : A.x
  const y1 = A.y + A.h / 2 + lane
  const x2 = right ? B.x : B.x + B.w
  const y2 = B.y + B.h / 2 + lane
  const dx = (x2 - x1) * 0.45
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
}

/** The steps a flow takes with these toggles: `when` filters them, and a block ends the flow. */
function resolve(flow: Flow, on: Record<string, boolean>): Step[] {
  const out: Step[] = []
  for (const s of flow.steps) {
    if (s.when) {
      const neg = s.when.startsWith("!")
      const v = !!on[s.when.replace(/^!/, "")]
      if (neg ? v : !v) continue
    }
    out.push(s)
    if (s.kind === "block") break
  }
  return out
}

const pairKey = (a: string, b: string) => [a, b].sort().join("|")
const epKey = (e: Endpoint) => `${e.method.toUpperCase()} ${e.path}`
/** "POST /api/run?x=1 · next" → "POST /api/run". */
const cleanKey = (k: string) => {
  const m = /^\s*([A-Za-z]+)\s+(\/[^\s?#·]*)/.exec(k)
  return m ? `${m[1].toUpperCase()} ${m[2].replace(/[.,;:]+$/, "")}` : null
}
/** The endpoint on the step's target box that the step calls: named in the model, or read from its text. */
function stepEndpoint(s: Step, endpoints: Endpoint[] | undefined): string | null {
  if (!endpoints?.length) return null
  const want = cleanKey(s.endpoint ?? s.text)
  return want && endpoints.some((e) => epKey(e) === want) ? want : null
}
/** The tables of the step's target box that the step reads or writes: named in the model, or found by name in its text. */
function stepEntities(s: Step, entities: Entity[] | undefined): string[] {
  if (!entities?.length) return []
  if (s.entities) return s.entities.filter((n) => entities.some((e) => e.name === n))
  const words = s.text.toLowerCase()
  return entities.filter((e) => new RegExp(`(^|[^a-z0-9_])${e.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9_])`).test(words)).map((e) => e.name)
}
const METHOD_TONE: Record<string, string> = {
  GET: "bg-blue-soft text-blue",
  POST: "bg-ok-soft text-ok",
  PUT: "bg-warn-soft text-warn",
  PATCH: "bg-warn-soft text-warn",
  DELETE: "bg-bad-soft text-bad",
}
const fmtTime = (ms: number) =>
  ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches
const KIND_LABEL: Record<Step["kind"], string> = { req: "request", res: "reply", check: "check", block: "stopped" }
const kindDot = (k: Step["kind"]) => (k === "block" ? "bg-bad" : k === "res" ? "bg-ok" : k === "check" ? "bg-warn" : "bg-blue")

export default function App({ model }: { model: Model }) {
  const base = useMemo(() => layout(model), [model])
  // Boxes can be dragged; where each was put is remembered in this browser.
  const layoutKey = `architecture-layout:${model.meta.repo}`
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      return JSON.parse(localStorage.getItem(layoutKey) ?? "{}")
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      if (Object.keys(moved).length) localStorage.setItem(layoutKey, JSON.stringify(moved))
      else localStorage.removeItem(layoutKey)
    } catch {
      /* storage unavailable: the layout just isn't remembered */
    }
  }, [moved, layoutKey])
  const boxes = useMemo(() => {
    const out: Record<string, Box> = {}
    for (const [id, b] of Object.entries(base.boxes)) out[id] = moved[id] ? { ...b, ...moved[id] } : b
    return out
  }, [base, moved])
  // Each zone's outline wraps its boxes, wherever they've been dragged.
  const zoneRects = useMemo(
    () =>
      model.zones.flatMap((z) => {
        const mine = Object.values(boxes).filter((b) => model.nodes.find((n) => n.id === b.id)?.zone === z.id)
        if (!mine.length) return []
        const x = Math.min(...mine.map((b) => b.x)) - 18
        const y = Math.min(...mine.map((b) => b.y)) - 36
        const r = Math.max(...mine.map((b) => b.x + b.w)) + 18
        const btm = Math.max(...mine.map((b) => b.y + b.h)) + 16
        return [{ id: z.id, label: z.label, x, y, w: r - x, h: btm - y }]
      }),
    [model, boxes],
  )
  // The view holds every zone; while a box is being dragged it stays put so the drawing doesn't rescale.
  const [dragging, setDragging] = useState<string | null>(null)
  const fitted = useMemo(() => {
    const x = Math.min(0, ...zoneRects.map((z) => z.x - 8))
    const y = Math.min(0, ...zoneRects.map((z) => z.y - 8))
    const r = Math.max(base.width, ...zoneRects.map((z) => z.x + z.w + 8))
    const b = Math.max(base.height, ...zoneRects.map((z) => z.y + z.h + 8))
    return { x, y, w: r - x, h: b - y }
  }, [zoneRects, base])
  const frozen = useRef(fitted)
  if (!dragging) frozen.current = fitted
  const view = dragging ? frozen.current : fitted
  const width = view.w
  const svgRef = useRef<SVGSVGElement>(null)
  const grab = useRef<{ id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null)
  const toSvg = (e: ReactPointerEvent) => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    return pt.matrixTransform(ctm.inverse())
  }
  const dragHandlers = (b: Box) => ({
    onPointerDown: (e: ReactPointerEvent<SVGGElement>) => {
      const p = toSvg(e)
      if (!p) return
      e.currentTarget.setPointerCapture(e.pointerId)
      grab.current = { id: b.id, dx: p.x - b.x, dy: p.y - b.y, sx: e.clientX, sy: e.clientY, moved: false }
    },
    onPointerMove: (e: ReactPointerEvent<SVGGElement>) => {
      const g = grab.current
      const p = g && toSvg(e)
      if (!g || !p) return
      // A press that hasn't travelled a few pixels is still a click, not a drag.
      if (!g.moved) {
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 4) return
        g.moved = true
        setDragging(g.id)
      }
      // Snapped to a 4-unit grid, so dragged boxes still line up.
      const x = Math.round((p.x - g.dx) / 4) * 4
      const y = Math.round((p.y - g.dy) / 4) * 4
      setMoved((o) => ({ ...o, [g.id]: { x, y } }))
    },
    onPointerUp: () => {
      const g = grab.current
      grab.current = null
      setDragging(null)
      if (g && !g.moved) setSelected((cur) => (cur === g.id ? null : g.id))
    },
    onPointerCancel: () => {
      grab.current = null
      setDragging(null)
    },
  })
  const title = (id: string) => boxes[id]?.title ?? id
  const nodeById = useMemo(() => Object.fromEntries(model.nodes.map((n) => [n.id, n])), [model])
  /** The box whose details are open (clicked). */
  const [selected, setSelected] = useState<string | null>(null)

  const [flowId, setFlowId] = useState(model.flows[0]?.id)
  const flow = model.flows.find((f) => f.id === flowId) ?? model.flows[0]
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const steps = useMemo(() => resolve(flow, toggles), [flow, toggles])
  /** The last step that has arrived (-1 before the first), and the one in flight. */
  const [idx, setIdx] = useState(-1)
  const [moving, setMoving] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const run = useRef(0)
  const packet = useRef<SVGGElement>(null)
  const halo = useRef<Record<string, SVGRectElement | null>>({})
  const stepList = useRef<HTMLOListElement>(null)

  // Only this flow's lines, each drawn once in the direction it's first used.
  const lines = useMemo(() => {
    const seen = new Map<string, string>()
    for (const s of steps) {
      if (s.from === s.to || !boxes[s.from] || !boxes[s.to]) continue
      const k = pairKey(s.from, s.to)
      if (!seen.has(k)) seen.set(k, pathBetween(boxes[s.from], boxes[s.to]))
    }
    return [...seen].map(([key, d]) => ({ key, d }))
  }, [steps, boxes])
  const used = useMemo(() => new Set(steps.flatMap((s) => [s.from, s.to])), [steps])

  const finished = idx >= steps.length - 1 || steps[idx]?.kind === "block"
  const shown = moving ?? idx
  const cur = steps[shown]
  const done = steps.slice(0, idx + 1)
  const elapsed = done.reduce((n, s) => n + (s.ms ?? 0), 0)
  const cost = done.reduce((n, s) => n + (s.usd ?? 0), 0)
  const counter = done.reduce((n, s) => n + (s.counter ?? 0), 0)
  // Which endpoint each box is serving at the shown step: the last request that reached it keeps
  // its endpoint lit while the box works on it, until the next request to that box.
  const serving = useMemo(() => {
    const out: Record<string, string> = {}
    steps.slice(0, Math.max(0, shown + 1)).forEach((s) => {
      const k = stepEndpoint(s, nodeById[s.to]?.endpoints)
      if (k) out[s.to] = k
    })
    return out
  }, [steps, shown, nodeById])
  // Tables each data box is working on at the shown step (the last step that reached it with tables).
  const touching = useMemo(() => {
    const out: Record<string, string[]> = {}
    steps.slice(0, Math.max(0, shown + 1)).forEach((s) => {
      const t = stepEntities(s, nodeById[s.to]?.entities)
      if (t.length) out[s.to] = t
    })
    return out
  }, [steps, shown, nodeById])
  const flowTables = useMemo(() => {
    const out: Record<string, Set<string>> = {}
    for (const s of steps) for (const t of stepEntities(s, nodeById[s.to]?.entities)) (out[s.to] ??= new Set()).add(t)
    return out
  }, [steps, nodeById])
  // Every endpoint this flow calls, per box.
  const flowEndpoints = useMemo(() => {
    const out: Record<string, Set<string>> = {}
    for (const s of steps) {
      const k = stepEndpoint(s, nodeById[s.to]?.endpoints)
      if (k) (out[s.to] ??= new Set()).add(k)
    }
    return out
  }, [steps, nodeById])
  const m = model.meta
  // Time and cost show only when the model has them (they come from the repository, never guessed).
  const hasTime = model.flows.some((f) => f.steps.some((s) => s.ms))
  const hasCost = model.flows.some((f) => f.steps.some((s) => s.usd))

  // The step number sits at the middle of its line, or on the box's corner for a check inside it.
  const badge = useMemo(() => {
    if (!cur || !boxes[cur.from] || !boxes[cur.to]) return null
    const A = boxes[cur.from]
    const B = boxes[cur.to]
    if (cur.from === cur.to) return { x: A.x + A.w - 4, y: A.y + 4, n: shown + 1 }
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path")
    p.setAttribute("d", pathBetween(A, B))
    const pt = p.getPointAtLength(p.getTotalLength() / 2)
    return { x: Math.min(Math.max(pt.x, view.x + 16), view.x + width - 16), y: Math.max(pt.y - 16, view.y + 14), n: shown + 1 }
  }, [cur, shown, boxes, width, view])

  const reset = useCallback(() => {
    run.current++
    setPlaying(false)
    setIdx(-1)
    setMoving(null)
    packet.current?.setAttribute("transform", "translate(-40,-40)")
  }, [])
  useEffect(reset, [flowId, toggles, reset])

  /** Moves the packet along a step's line, or pulses the box for a check inside one service. */
  const animate = useCallback(
    (s: Step, token: number) =>
      new Promise<void>((done) => {
        const p = packet.current
        const A = boxes[s.from]
        const B = boxes[s.to]
        if (!p || !A || !B) return done()
        p.dataset.kind = s.kind
        const dur = reduceMotion() ? 0 : (s.from === s.to ? 650 : 1100) / speed
        if (s.from === s.to) {
          p.setAttribute("transform", "translate(-40,-40)")
          const h = halo.current[s.from]
          if (!dur || !h) return done()
          const t0 = performance.now()
          const tick = (now: number) => {
            if (token !== run.current) return done()
            const k = Math.min(1, (now - t0) / dur)
            h.style.opacity = String(Math.sin(k * Math.PI))
            if (k < 1) requestAnimationFrame(tick)
            else {
              h.style.opacity = "0"
              done()
            }
          }
          return void requestAnimationFrame(tick)
        }
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
        path.setAttribute("d", pathBetween(A, B))
        const len = path.getTotalLength()
        const place = (e: number) => {
          const a = path.getPointAtLength(e * len)
          p.setAttribute("transform", `translate(${a.x},${a.y})`)
        }
        if (!dur) {
          place(1)
          return done()
        }
        const t0 = performance.now()
        const tick = (now: number) => {
          if (token !== run.current) return done()
          const k = Math.min(1, (now - t0) / dur)
          place(k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)
          if (k < 1) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
      }),
    [boxes, speed],
  )

  /** Sends the next step; false when the flow has ended or was interrupted. */
  const advance = useCallback(
    async (from: number, token: number) => {
      const i = from + 1
      if (i >= steps.length) return false
      setMoving(i)
      await animate(steps[i], token)
      if (token !== run.current) return false
      setMoving(null)
      setIdx(i)
      return steps[i].kind !== "block" && i < steps.length - 1
    },
    [animate, steps],
  )

  const play = useCallback(async () => {
    let from = finished ? -1 : idx
    if (finished) setIdx(-1)
    const token = ++run.current
    setPlaying(true)
    for (;;) {
      const more = await advance(from, token)
      if (!more || token !== run.current) break
      from++
      // Long enough to read the step before the next one moves.
      await new Promise((r) => setTimeout(r, reduceMotion() ? 0 : 1300 / speed))
      if (token !== run.current) break
    }
    if (token === run.current) setPlaying(false)
  }, [advance, finished, idx, speed])

  const pause = () => {
    run.current++
    setPlaying(false)
    setMoving(null)
  }
  const next = async () => {
    const token = ++run.current
    await advance(idx, token)
  }
  const jump = (i: number) => {
    run.current++
    setPlaying(false)
    setMoving(null)
    setIdx(i)
    // The highlighted line and its arrow show the hop; the dot only shows while moving.
    packet.current?.setAttribute("transform", "translate(-40,-40)")
  }

  useEffect(() => {
    stepList.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: "nearest" })
  }, [shown])

  const stats = [
    { label: "Step", value: `${Math.max(0, shown + 1)}/${steps.length}` },
    hasTime && { label: "Elapsed", value: fmtTime(elapsed) },
    hasCost && { label: "Cost", value: `$${cost.toFixed(3)}` },
    m.counter && { label: m.counter.label, value: counter > 0 ? `−${counter}` : counter < 0 ? `+${-counter}` : "0" },
  ].filter(Boolean) as { label: string; value: string }[]
  const playLabel = playing ? "Pause" : finished && idx >= 0 ? "Play again" : "Play"

  return (
    <div className="mx-auto grid max-w-[1260px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-7 sm:px-6">
      <header className="grid gap-3">
        <p className="label">
          System design · {m.repo}
          {m.commit ? ` · ${m.commit.slice(0, 7)}` : ""}
          {m.date ? ` · ${m.date}` : ""}
        </p>
        <h1 className="text-[34px] leading-none font-[650] tracking-[-0.025em]">{m.name}</h1>
        <p className="max-w-[68ch] text-[14.5px] leading-[1.65] text-muted-foreground">{m.summary}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {(m.facts ?? []).map((f) => (
            <span key={f.label} className="rounded-md border bg-card px-2 py-1 font-mono text-[11.5px]">
              <span className="text-faint">{f.label}</span> {f.value}
            </span>
          ))}
          {m.url && (
            <a href={m.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 text-[13px] font-[550] text-primary hover:underline">
              <ExternalLinkIcon className="size-3.5" /> Repository
            </a>
          )}
        </div>
      </header>

      <section className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px]" aria-label="Flow simulator">
        <div className="panel min-w-0 overflow-hidden">
          {/* Toolbar: which flow, where it is, and the transport controls. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b px-4 py-3">
            <div className="grid min-w-0 gap-1.5">
              <span className="label">Flow</span>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Choose a flow">
                {model.flows.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={f.id === flow.id}
                    onClick={() => {
                      setFlowId(f.id)
                      setToggles({})
                    }}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-[13px] font-[550] transition-colors",
                      f.id === flow.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
                    )}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-end gap-x-5 gap-y-3 max-sm:w-full max-sm:justify-between">
              {stats.map((s) => (
                <div key={s.label} className="grid justify-items-end gap-1">
                  <span className="label">{s.label}</span>
                  <span className="figure text-[18px] sm:text-[22px]">{s.value}</span>
                </div>
              ))}
              <div className="flex overflow-hidden rounded-lg border bg-card" role="group" aria-label="Controls">
                <button type="button" onClick={playing ? pause : () => void play()} aria-label={playLabel} title={playLabel} className="grid size-9 place-items-center text-primary hover:bg-muted">
                  {playing ? <PauseIcon className="size-4 fill-current" /> : finished && idx >= 0 ? <RotateCcwIcon className="size-4" /> : <PlayIcon className="size-4 fill-current" />}
                </button>
                <button
                  type="button"
                  onClick={() => void next()}
                  disabled={playing || finished}
                  aria-label="Next step"
                  title="Next step"
                  className="grid size-9 place-items-center border-l hover:bg-muted disabled:opacity-40"
                >
                  <StepForwardIcon className="size-4" />
                </button>
                <button type="button" onClick={reset} aria-label="Restart" title="Restart" className="grid size-9 place-items-center border-l hover:bg-muted">
                  <RotateCcwIcon className="size-4" />
                </button>
              </div>
            </div>
          </div>

          {/* The canvas: graph paper, the parts, and the request moving between them. */}
          <div className="graph-paper relative">
            {selected && nodeById[selected] && boxes[selected] && (
              <PartPanel
                node={nodeById[selected]}
                kind={boxes[selected].kind}
                serving={serving[selected] ?? null}
                inFlow={flowEndpoints[selected] ?? new Set()}
                touching={touching[selected] ?? []}
                tablesInFlow={flowTables[selected] ?? new Set()}
                steps={steps.map((s, i) => ({ s, i })).filter(({ s }) => s.from === selected || s.to === selected)}
                onJump={(i) => jump(i)}
                onClose={() => setSelected(null)}
              />
            )}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-3 pt-3">
              {(["req", "res", "check", "block"] as const).map((k) => (
                <span key={k} className="label flex items-center gap-1.5">
                  <i className={cn("size-2 rounded-full", kindDot(k))} />
                  {KIND_LABEL[k]}
                </span>
              ))}
              <span className="label">· faded parts aren't in this flow · drag boxes to move them · click one for its details</span>
              {Object.keys(moved).length > 0 && (
                <button type="button" onClick={() => setMoved({})} className="label rounded-md border bg-card px-2 py-0.5 text-primary hover:bg-muted">
                  Reset layout
                </button>
              )}
            </div>
            <div className="overflow-x-auto px-2">
              <svg
                ref={svgRef}
                viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
                className={cn("block h-auto w-full select-none", dragging && "cursor-grabbing")}
                style={{ minWidth: Math.min(view.w, 720) }}
                role="img"
                aria-label={`${m.name}: ${flow.name}`}
              >
                <defs>
                  {[
                    ["arrow", "fill-blue"],
                    ["arrow-bad", "fill-bad"],
                    ["arrow-faint", "fill-line"],
                  ].map(([id, cls]) => (
                    <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" className={cls} />
                    </marker>
                  ))}
                </defs>
                {zoneRects.map((z) => (
                  <g key={z.id}>
                    <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={14} className="fill-none stroke-line" strokeWidth={1} strokeDasharray="4 5" />
                    <text x={z.x + 14} y={z.y + 22} className="fill-muted-foreground font-mono text-[10.5px] tracking-[0.06em] uppercase">
                      {z.label}
                    </text>
                  </g>
                ))}
                <g>
                  {lines.map((e) => (
                    <path key={e.key} d={e.d} className="fill-none stroke-line" strokeWidth={1.5} strokeLinecap="round" strokeDasharray="1.5 5" markerEnd="url(#arrow-faint)" />
                  ))}
                </g>
                <g>
                  {Object.values(boxes).map((b) => {
                    const inFlow = used.has(b.id)
                    const active = !!cur && (cur.from === b.id || cur.to === b.id)
                    const blocked = cur?.kind === "block" && cur.to === b.id && shown === idx
                    const c = KIND_COLOUR[b.kind]
                    const Icon = KIND_ICON[b.kind]
                    return (
                      <g
                        key={b.id}
                        className={cn("transition-opacity", dragging === b.id ? "cursor-grabbing" : "cursor-grab")}
                        style={{ opacity: inFlow ? 1 : 0.3, touchAction: "none" }}
                        tabIndex={0}
                        role="button"
                        aria-label={`${b.title}: show details`}
                        aria-pressed={selected === b.id}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            setSelected((cur) => (cur === b.id ? null : b.id))
                          }
                        }}
                        {...dragHandlers(b)}
                      >
                        {active && <rect x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} rx={13} className={blocked ? "fill-bad-soft" : "fill-blue-soft"} />}
                        {selected === b.id && (
                          <rect x={b.x - 7} y={b.y - 7} width={b.w + 14} height={b.h + 14} rx={15} className="fill-none stroke-foreground" strokeWidth={1.25} strokeDasharray="3 3" />
                        )}
                        <rect
                          x={b.x}
                          y={b.y}
                          width={b.w}
                          height={b.h}
                          rx={10}
                          strokeWidth={active ? 2.25 : 1.5}
                          style={{ fill: `var(--${c}-f)`, stroke: blocked ? "var(--bad)" : `var(--${c}-s)` }}
                        />
                        <g transform={`translate(${b.x + 12},${b.y + 11})`} style={{ color: `var(--${c}-s)` }}>
                          <Icon width={16} height={16} strokeWidth={1.75} />
                        </g>
                        <text x={b.x + 35} y={b.y + 24} className="text-[14px] font-[550]" style={{ fill: `var(--${c}-i)` }}>
                          {b.title}
                        </text>
                        <line x1={b.x + 12} x2={b.x + b.w - 12} y1={b.y + 33} y2={b.y + 33} strokeWidth={1} style={{ stroke: `var(--${c}-s)`, opacity: 0.3 }} />
                        <text x={b.x + 12} y={b.y + 49} className="font-mono text-[10px] tracking-[0.04em] uppercase" style={{ fill: `var(--${c}-i)`, opacity: 0.85 }}>
                          {b.sub}
                        </text>
                        {(() => {
                          const n = nodeById[b.id]
                          const count = n?.endpoints?.length || n?.entities?.length || 0
                          if (!count) return null
                          const live = serving[b.id] ?? (touching[b.id]?.length ? touching[b.id].join(", ") : null)
                          return (
                            <>
                              <g transform={`translate(${b.x + b.w - 8},${b.y + 2})`}>
                                <rect x={-30} y={-9} width={34} height={16} rx={8} strokeWidth={1} style={{ fill: "var(--card)", stroke: `var(--${c}-s)` }} />
                                <text x={-13} y={3} textAnchor="middle" className="font-mono text-[9.5px] font-[650]" style={{ fill: `var(--${c}-i)` }}>
                                  {count}
                                </text>
                              </g>
                              {b.h >= BIG_H && (
                                <text x={b.x + 12} y={b.y + 72} className={cn("font-mono text-[10.5px]", live ? "fill-blue font-[650]" : "")} style={live ? undefined : { fill: `var(--${c}-i)`, opacity: 0.6 }}>
                                  {live ? `▸ ${live.length > 28 ? `${live.slice(0, 27)}…` : live}` : n?.endpoints?.length ? "click to list endpoints" : "click to list tables"}
                                </text>
                              )}
                            </>
                          )
                        })()}
                        <rect
                          ref={(el) => {
                            halo.current[b.id] = el
                          }}
                          x={b.x - 5}
                          y={b.y - 5}
                          width={b.w + 10}
                          height={b.h + 10}
                          rx={14}
                          className="fill-none stroke-warn"
                          strokeWidth={2}
                          style={{ opacity: 0 }}
                        />
                      </g>
                    )
                  })}
                </g>
                <g>
                  {cur && cur.from !== cur.to && boxes[cur.from] && boxes[cur.to] && (
                    <path
                      d={pathBetween(boxes[cur.from], boxes[cur.to])}
                      className={cn("march fill-none", cur.kind === "block" ? "stroke-bad" : "stroke-blue")}
                      strokeWidth={2}
                      strokeLinecap="round"
                      markerEnd={`url(#${cur.kind === "block" ? "arrow-bad" : "arrow"})`}
                    />
                  )}
                  <g ref={packet} transform="translate(-40,-40)" className="group" data-kind="req">
                    <circle r={7.5} className="fill-card" />
                    <circle r={5} className="fill-blue group-data-[kind=block]:fill-bad group-data-[kind=res]:fill-ok group-data-[kind=check]:fill-warn" />
                  </g>
                  {badge && (
                    <g>
                      <circle cx={badge.x} cy={badge.y} r={11} className={cn("stroke-background", cur?.kind === "block" ? "fill-bad" : "fill-foreground")} strokeWidth={2} />
                      <text x={badge.x} y={badge.y + 4} textAnchor="middle" className="fill-background font-mono text-[11px] font-[650]">
                        {badge.n}
                      </text>
                    </g>
                  )}
                </g>
              </svg>
            </div>
            {/* A note in the margin, the way you'd annotate a drawing. */}
            <p className="px-5 pb-4 font-hand text-[22px] leading-[1.25] text-muted-foreground">
              {flow.summary ? `${flow.summary} ` : ""}
              {steps.length} steps through {used.size} parts.
            </p>
          </div>

          {/* What's happening now, in words. */}
          <div className="grid gap-2 border-t px-5 py-4" aria-live="polite">
            {cur ? (
              <>
                <p className="label">
                  <i className={cn("mr-2 inline-block size-2 rounded-full align-middle", kindDot(cur.kind))} />
                  Step {shown + 1} of {steps.length} · {KIND_LABEL[cur.kind]} · {cur.from === cur.to ? title(cur.from) : `${title(cur.from)} → ${title(cur.to)}`}
                </p>
                <h2 className="text-[22px] leading-tight font-[650] tracking-[-0.018em]">{cur.text}</h2>
                {cur.detail && <p className="max-w-[72ch] text-[14px] leading-[1.65] text-muted-foreground">{cur.detail}</p>}
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {cur.proto && <Chip>{cur.proto}</Chip>}
                  {cur.ms ? <Chip>{fmtTime(cur.ms)}</Chip> : null}
                  {cur.usd ? <Chip tone="warn">+${cur.usd.toFixed(3)}</Chip> : null}
                  {cur.counter ? (
                    <Chip tone={cur.counter > 0 ? "warn" : "ok"}>
                      {cur.counter > 0 ? `−${cur.counter}` : `+${-cur.counter}`} {m.counter?.label.toLowerCase() ?? ""}
                    </Chip>
                  ) : null}
                  {cur.evidence?.map((e) => (
                    <code key={e} className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {e}
                    </code>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="label">{flow.name}</p>
                <h2 className="text-[22px] leading-tight font-[650] tracking-[-0.018em]">Press play to follow one request through the system</h2>
                <p className="text-[14px] text-muted-foreground">Or step through it one hop at a time, or pick any step from the list.</p>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t bg-muted/60 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="label">Speed</span>
              <div className="flex overflow-hidden rounded-md border bg-card" role="group" aria-label="Speed">
                {[0.5, 1, 2].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setSpeed(v)}
                    aria-pressed={speed === v}
                    className={cn("px-2 py-0.5 font-mono text-xs text-muted-foreground", speed === v && "bg-accent text-accent-foreground")}
                  >
                    {v}×
                  </button>
                ))}
              </div>
            </div>
            {(flow.toggles ?? []).length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="label">What if</span>
                {flow.toggles!.map((t) => (
                  <label key={t.id} htmlFor={`t-${flow.id}-${t.id}`} className="flex cursor-pointer items-center gap-2 text-[13px]">
                    <Switch
                      id={`t-${flow.id}-${t.id}`}
                      checked={!!toggles[t.id]}
                      onCheckedChange={(v) => setToggles((o) => ({ ...o, [t.id]: v }))}
                      className="data-[state=checked]:bg-bad"
                    />
                    {t.label}
                    {t.hint && <span className="font-mono text-[11px] text-faint">{t.hint}</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="grid min-w-0 content-start gap-3">
          <div className="panel overflow-hidden">
            <div className="flex items-baseline justify-between border-b px-4 py-3">
              <span className="label">Steps</span>
              <span className="label">{steps.length}</span>
            </div>
            <ScrollArea className="h-[520px]">
              <ol ref={stepList} className="grid gap-0.5 p-2">
                {steps.map((s, i) => {
                  const state = i === shown ? (s.kind === "block" && moving === null ? "blocked" : "current") : i <= idx ? "done" : "todo"
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        data-current={i === shown}
                        onClick={() => jump(i)}
                        className={cn(
                          "grid w-full grid-cols-[22px_minmax(0,1fr)] gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-muted",
                          state === "current" && "bg-accent hover:bg-accent",
                          state === "blocked" && "bg-bad-soft hover:bg-bad-soft",
                          state === "todo" && "text-muted-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-px grid h-5 place-items-center rounded-md font-mono text-[10.5px] font-[650]",
                            state === "todo" ? "border text-faint" : cn(kindDot(s.kind), "text-white dark:text-background"),
                          )}
                        >
                          {state === "blocked" ? "×" : i + 1}
                        </span>
                        <span className="min-w-0">
                          {s.text}
                          <span className="block font-mono text-[10.5px] tracking-[0.03em] text-faint uppercase">
                            {s.from === s.to ? title(s.from) : `${title(s.from)} → ${title(s.to)}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </ScrollArea>
          </div>

          <details className="panel text-[13px]">
            <summary className="label cursor-pointer px-4 py-3 select-none">Request log</summary>
            <div className="grid gap-0.5 border-t px-4 py-3 font-mono text-[11.5px] leading-relaxed text-muted-foreground" aria-label="Request log">
              {done.length === 0 && <p>Fills in as steps arrive.</p>}
              {done.map((s, i) => {
                const at = steps.slice(0, i + 1).reduce((n, x) => n + (x.ms ?? 0), 0)
                return (
                  <p key={i} className="break-words">
                    <span className="text-primary">{hasTime ? `+${fmtTime(at)} ` : `${i + 1}. `}</span>
                    {s.from === s.to ? s.from : `${s.from}→${s.to}`} <span className={s.kind === "block" ? "text-bad" : "text-foreground"}>{s.text}</span>
                  </p>
                )
              })}
            </div>
          </details>
        </aside>
      </section>

      <Reference model={model} />

      <footer className="font-mono text-[11.5px] text-faint">
        Drawn from the code of {m.repo}
        {m.commit ? ` at ${m.commit.slice(0, 7)}` : ""}. Every step lists the files it was read from.
      </footer>
    </div>
  )
}

/**
 * A part's details, opened by clicking its box: its endpoints (the one in use highlighted, the ones
 * this flow calls marked), its evidence, and the steps of this flow that touch it.
 */
function PartPanel({
  node,
  kind,
  serving,
  inFlow,
  touching,
  tablesInFlow,
  steps,
  onJump,
  onClose,
}: {
  node: Model["nodes"][number]
  kind: NodeKind
  serving: string | null
  inFlow: Set<string>
  touching: string[]
  tablesInFlow: Set<string>
  steps: { s: Step; i: number }[]
  onJump: (i: number) => void
  onClose: () => void
}) {
  const Icon = KIND_ICON[kind]
  const c = KIND_COLOUR[kind]
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    list.current?.querySelector('[data-serving="true"]')?.scrollIntoView({ block: "nearest" })
  }, [serving])
  return (
    <div className="panel z-10 m-3 flex max-h-[520px] flex-col overflow-hidden sm:absolute sm:top-2 sm:right-2 sm:m-0 sm:w-[360px]" role="dialog" aria-label={`${node.title} details`}>
      <div className="flex items-start gap-3 border-b px-4 py-3" style={{ background: `var(--${c}-f)` }}>
        <Icon className="mt-0.5 size-4 shrink-0" style={{ color: `var(--${c}-s)` }} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-[650]" style={{ color: `var(--${c}-i)` }}>
            {node.title}
          </p>
          <p className="font-mono text-[10.5px] tracking-[0.04em] uppercase" style={{ color: `var(--${c}-i)`, opacity: 0.8 }}>
            {node.sub}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-6 place-items-center rounded-md hover:bg-card">
          <XIcon className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {node.endpoints?.length ? (
          <div className="grid gap-1.5 px-3 py-3">
            <p className="label px-1">
              {node.endpoints.length} endpoints{inFlow.size ? ` · ${inFlow.size} in this flow` : ""}
            </p>
            <ul ref={list} className="grid gap-0.5">
              {node.endpoints.map((e) => {
                const k = epKey(e)
                const now = serving === k
                const here = inFlow.has(k)
                return (
                  <li
                    key={k}
                    data-serving={now}
                    className={cn(
                      "grid grid-cols-[54px_minmax(0,1fr)] items-start gap-2 rounded-lg px-2 py-1.5 transition-colors",
                      now ? "bg-accent ring-1 ring-primary" : here ? "" : "opacity-45",
                    )}
                  >
                    <span className={cn("mt-px rounded px-1 py-0.5 text-center font-mono text-[10px] font-[650]", METHOD_TONE[e.method.toUpperCase()] ?? "bg-secondary text-muted-foreground")}>
                      {e.method.toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <code className={cn("truncate font-mono text-[12.5px]", now && "font-[650] text-primary")}>{e.path}</code>
                        {now && <span className="label shrink-0 rounded bg-primary px-1 text-[9.5px] text-primary-foreground">in use</span>}
                      </span>
                      {e.label && <span className="block text-[12px] text-muted-foreground">{e.label}</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
        {node.entities?.length ? <Tables entities={node.entities} touching={touching} inFlow={tablesInFlow} /> : null}
        {node.evidence?.length ? (
          <div className="flex flex-wrap gap-1 border-t px-4 py-2.5">
            {node.evidence.map((e) => (
              <code key={e} className="rounded border bg-muted px-1 font-mono text-[10.5px] text-muted-foreground">
                {e}
              </code>
            ))}
          </div>
        ) : null}
        <div className="grid gap-0.5 border-t px-3 py-2.5">
          <p className="label px-1">{steps.length ? `Steps in this flow (${steps.length})` : "Not part of this flow"}</p>
          {steps.map(({ s, i }) => (
            <button key={i} type="button" onClick={() => onJump(i)} className="flex items-baseline gap-2 rounded-md px-1 py-1 text-left text-[12.5px] hover:bg-muted">
              <span className="font-mono text-[10.5px] text-faint">{i + 1}</span>
              <span className="min-w-0 truncate">{s.text}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** A data box's tables: the ones this step works on are highlighted; click a table to see its columns. */
function Tables({ entities, touching, inFlow }: { entities: Entity[]; touching: string[]; inFlow: Set<string> }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    list.current?.querySelector('[data-touching="true"]')?.scrollIntoView({ block: "nearest" })
  }, [touching])
  const toggle = (n: string) =>
    setOpen((o) => {
      const next = new Set(o)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  return (
    <div className="grid gap-1.5 border-t px-3 py-3 first:border-t-0">
      <p className="label px-1">
        {entities.length} tables{inFlow.size ? ` · ${inFlow.size} in this flow` : ""} · click one for its columns
      </p>
      <ul ref={list} className="grid gap-0.5">
        {entities.map((e) => {
          const now = touching.includes(e.name)
          const here = inFlow.has(e.name)
          const isOpen = open.has(e.name)
          return (
            <li key={e.name} data-touching={now} className={cn("rounded-lg transition-colors", now ? "bg-accent ring-1 ring-primary" : !here && inFlow.size ? "opacity-55" : "")}>
              <button
                type="button"
                onClick={() => toggle(e.name)}
                aria-expanded={isOpen}
                className="grid w-full grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted/60"
              >
                <ChevronRightIcon className={cn("mt-0.5 size-3.5 text-faint transition-transform", isOpen && "rotate-90")} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <code className={cn("truncate font-mono text-[12.5px]", now && "font-[650] text-primary")}>{e.name}</code>
                    {now && <span className="label shrink-0 rounded bg-primary px-1 text-[9.5px] text-primary-foreground">in use</span>}
                  </span>
                  {e.label && <span className="block text-[12px] text-muted-foreground">{e.label}</span>}
                </span>
                <span className="font-mono text-[10.5px] text-faint">{e.columns.length} cols</span>
              </button>
              {isOpen && (
                <div className="mx-2 mb-2 overflow-hidden rounded-md border bg-card">
                  {e.columns.map((col) => (
                    <ColumnRow key={col.name} col={col} />
                  ))}
                  {e.evidence?.length ? (
                    <div className="flex flex-wrap gap-1 border-t bg-muted/50 px-2 py-1.5">
                      {e.evidence.map((x) => (
                        <code key={x} className="font-mono text-[10px] text-muted-foreground">
                          {x}
                        </code>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ColumnRow({ col }: { col: Column }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 border-b px-2 py-1 last:border-b-0" title={col.note}>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <code className={cn("font-mono text-[12px]", col.key === "pk" && "font-[650]")}>{col.name}</code>
        {col.key === "pk" && <span className="rounded bg-warn-soft px-1 font-mono text-[9px] font-[650] text-warn">PK</span>}
        {col.ref && (
          <span className="rounded bg-blue-soft px-1 font-mono text-[9px] font-[650] text-blue" title={`references ${col.ref}`}>
            FK → {col.ref}
          </span>
        )}
        {col.unique && <span className="rounded bg-secondary px-1 font-mono text-[9px] text-muted-foreground">unique</span>}
      </span>
      <span className="text-right font-mono text-[10.5px] text-muted-foreground">
        {col.type}
        {col.nullable ? <span className="text-faint">?</span> : null}
        {col.default ? <span className="block text-[9.5px] text-faint">= {col.default.length > 22 ? `${col.default.slice(0, 21)}…` : col.default}</span> : null}
      </span>
    </div>
  )
}

function Chip({ children, tone }: { children: ReactNode; tone?: "warn" | "ok" | "bad" }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 font-mono text-[11.5px]",
        tone === "warn" ? "bg-warn-soft text-warn" : tone === "ok" ? "bg-ok-soft text-ok" : tone === "bad" ? "bg-bad-soft text-bad" : "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </span>
  )
}

function Evidence({ items }: { items?: string[] }) {
  if (!items?.length) return null
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {items.map((e) => (
        <code key={e} className="rounded border bg-muted px-1 font-mono text-[10.5px] text-muted-foreground">
          {e}
        </code>
      ))}
    </span>
  )
}

function Sheet({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="panel grid gap-3 p-5">
      <div className="grid gap-1">
        <h3 className="text-[16px] font-[650] tracking-[-0.01em]">{title}</h3>
        {note && <p className="text-[13px] text-muted-foreground">{note}</p>}
      </div>
      {children}
    </div>
  )
}

/** The reference sheets: what runs where, the data, the guards, a funnel, and what wasn't found. */
function Reference({ model }: { model: Model }) {
  const tabs = [
    model.components?.length && { id: "components", label: "Components" },
    model.data?.length && { id: "data", label: "Data" },
    model.guards?.length && { id: "guards", label: "Guards" },
    model.funnel && { id: "funnel", label: model.funnel.title },
    model.unknowns?.length && { id: "unknowns", label: "Not found" },
  ].filter(Boolean) as { id: string; label: string }[]
  if (!tabs.length) return null
  const max = Math.max(...(model.funnel?.rows.map((r) => r.value) ?? [1]))
  return (
    <Tabs defaultValue={tabs[0].id} className="gap-3">
      <TabsList className="h-auto flex-wrap justify-start rounded-xl border bg-card p-1">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className="h-8 flex-none px-3 font-mono text-[11px] tracking-[0.06em] uppercase data-active:bg-accent data-active:text-accent-foreground">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {model.components?.length ? (
        <TabsContent value="components">
          <Sheet title="Where everything runs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part</TableHead>
                  <TableHead>Built with</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead>Job</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.components.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="font-[550] whitespace-nowrap">{c.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.tech}</TableCell>
                    <TableCell className="whitespace-nowrap">{c.where}</TableCell>
                    <TableCell className="min-w-[260px] whitespace-normal">
                      {c.role}
                      <Evidence items={c.evidence} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Sheet>
        </TabsContent>
      ) : null}
      {model.data?.length ? (
        <TabsContent value="data">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
            {model.data.map((d) => (
              <div key={d.name} className="panel grid gap-1 px-4 py-3">
                <code className="font-mono text-[13px] font-[550] text-primary">{d.name}</code>
                <span className="text-[13px] text-muted-foreground">{d.holds}</span>
                <Evidence items={d.evidence} />
              </div>
            ))}
          </div>
        </TabsContent>
      ) : null}
      {model.guards?.length ? (
        <TabsContent value="guards">
          <Sheet title="Guards and limits" note="What stops abuse, mistakes and runaway cost, as the code enforces it.">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Limit</TableHead>
                  <TableHead>Other checks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.guards.map((g) => (
                  <TableRow key={g.what}>
                    <TableCell className="font-[550] whitespace-nowrap">{g.what}</TableCell>
                    <TableCell className="font-mono text-xs">{g.limit}</TableCell>
                    <TableCell className="whitespace-normal">
                      {g.checks}
                      <Evidence items={g.evidence} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Sheet>
        </TabsContent>
      ) : null}
      {model.funnel ? (
        <TabsContent value="funnel">
          <Sheet title={model.funnel.title} note={model.funnel.note ? `${model.funnel.note} Bars are to scale.` : undefined}>
            <div className="grid gap-2">
              {model.funnel.rows.map((r) => (
                <div key={r.label} className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)_80px] items-center gap-3 text-[13px] max-sm:grid-cols-[minmax(0,1fr)_70px]">
                  <span>{r.label}</span>
                  <span className="relative h-2 overflow-hidden rounded-full bg-secondary max-sm:col-span-2 max-sm:row-start-2">
                    <i className="absolute inset-y-0 left-0 min-w-0.5 rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
                  </span>
                  <b className="figure text-right text-[14px]">{r.value.toLocaleString()}</b>
                </div>
              ))}
            </div>
          </Sheet>
        </TabsContent>
      ) : null}
      {model.unknowns?.length ? (
        <TabsContent value="unknowns">
          <Sheet title="Not found in the repository" note="Left out of the diagram rather than guessed.">
            <ul className="grid list-disc gap-1 pl-5 text-[13.5px]">
              {model.unknowns.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </Sheet>
        </TabsContent>
      ) : null}
    </Tabs>
  )
}
