/** The architecture model the page draws: see references/model.md in the skill. */
export interface Model {
  meta: {
    name: string
    repo: string
    url?: string
    commit?: string
    date?: string
    summary: string
    facts?: { label: string; value: string }[]
    /** Optional running counter shown beside time and cost, e.g. { label: "Credits" }. */
    counter?: { label: string }
  }
  zones: { id: string; label: string }[]
  nodes: Node[]
  flows: Flow[]
  components?: { name: string; tech: string; where: string; role: string; evidence?: string[] }[]
  data?: { name: string; holds: string; evidence?: string[] }[]
  guards?: { what: string; limit: string; checks: string; evidence?: string[] }[]
  funnel?: { title: string; note?: string; rows: { label: string; value: number }[] }
  unknowns?: string[]
}

export interface Node {
  id: string
  zone: string
  title: string
  sub: string
  /** Taller box for a central service. */
  big?: boolean
  /** What kind of part it is; sets its colour and icon. Guessed from the title when left out. */
  kind?: NodeKind
  /** Routes this part serves; clicking the box lists them, with the one in use highlighted. */
  endpoints?: Endpoint[]
  /** Tables (or collections) this part stores; clicking the box lists them, and a table opens to its columns. */
  entities?: Entity[]
  evidence?: string[]
}

export interface Endpoint {
  /** GET, POST, PUT, PATCH, DELETE, or ANY / WS for others. */
  method: string
  path: string
  /** What it's for, in a few words. */
  label?: string
  evidence?: string[]
}

export interface Entity {
  name: string
  /** What it holds, in a few words. */
  label?: string
  evidence?: string[]
  columns: Column[]
}

export interface Column {
  name: string
  type: string
  /** "pk" primary key, "fk" foreign key (a primary key that's also a reference keeps "pk" and sets `ref`). */
  key?: "pk" | "fk"
  /** What a reference points at, e.g. "auth.users.id". */
  ref?: string
  nullable?: boolean
  default?: string
  unique?: boolean
  note?: string
}

export type NodeKind =
  | "client" | "cdn" | "gateway" | "service" | "worker" | "queue" | "db" | "cache"
  | "storage" | "cron" | "ai" | "auth" | "payment" | "email" | "chat" | "external"

export interface Flow {
  id: string
  name: string
  summary?: string
  toggles?: { id: string; label: string; hint?: string }[]
  steps: Step[]
}

export type StepKind = "req" | "res" | "check" | "block"

export interface Step {
  from: string
  to: string
  kind: StepKind
  text: string
  detail?: string
  /** Only when this toggle is on ("x") or off ("!x"). */
  when?: string
  ms?: number
  usd?: number
  /** Change to meta.counter: positive spends, negative adds. */
  counter?: number
  proto?: string
  /** The endpoint this step calls, as "METHOD /path" on the `to` box. Matched from the text when left out. */
  endpoint?: string
  /** Tables of the `to` box this step reads or writes. Matched from table names in the text when left out. */
  entities?: string[]
  evidence?: string[]
}
