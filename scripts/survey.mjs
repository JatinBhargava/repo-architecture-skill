#!/usr/bin/env node
// Surveys a repository and writes what it finds, each fact with the file (and line) it came from:
// languages, manifests and dependencies, services the code talks to, deployment and infrastructure,
// routes and handlers, scheduled jobs and queues, data models, environment variables, outside hosts.
// It only reads files; nothing in the repository is run.
//   node survey.mjs <repo path> [--json out.json] [--md out.md]
import fs from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
const root = path.resolve(args[0] ?? ".")
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null)
const jsonOut = opt("--json")
const mdOut = opt("--md")

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".turbo", ".vercel", ".output", "target", "vendor", "venv", ".venv", "env", "__pycache__", ".mypy_cache", ".pytest_cache", "coverage", ".gradle", ".idea", ".vscode", "bin", "obj", "Pods", ".expo", "storybook-static", "public/build"])
const TEXT_EXT = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".py", ".go", ".rb", ".java", ".kt", ".kts", ".scala", ".rs", ".php", ".cs", ".swift", ".dart", ".ex", ".exs", ".vue", ".svelte", ".astro", ".sql", ".prisma", ".graphql", ".gql", ".proto", ".yml", ".yaml", ".toml", ".json", ".tf", ".hcl", ".env", ".example", ".sh", ".md", ".gradle", ".xml", ".ini", ".cfg", ".conf"])
const MAX_FILES = 6000
const MAX_BYTES = 400_000

// ---- Walk ----
const files = []
function walk(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (files.length >= MAX_FILES) return
    const full = path.join(dir, e.name)
    const rel = path.relative(root, full)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || SKIP_DIRS.has(rel) || (e.name.startsWith(".") && ![".github", ".circleci", ".gitlab", ".devcontainer"].includes(e.name))) continue
      walk(full)
    } else if (e.isFile()) files.push(rel)
  }
}
walk(root)

const read = (rel) => {
  try {
    const st = fs.statSync(path.join(root, rel))
    if (st.size > MAX_BYTES) return null
    return fs.readFileSync(path.join(root, rel), "utf8")
  } catch {
    return null
  }
}
// Real .env files hold secrets: only their templates are read.
const ENV_TEMPLATE = /(^|\/)\.env\.(example|sample|template|dist)$|(^|\/)env\.example$/
const isSecretFile = (rel) => /(^|\/)\.env(\.[^/]*)?$/.test(rel) && !ENV_TEMPLATE.test(rel)
const isText = (rel) => !isSecretFile(rel) && (TEXT_EXT.has(path.extname(rel).toLowerCase()) || /(^|\/)(Dockerfile|Procfile|Makefile|Gemfile|Rakefile)$/.test(rel) || ENV_TEMPLATE.test(rel))
const lineOf = (text, index) => text.slice(0, index).split("\n").length

// ---- Languages ----
const LANG = { ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".py": "Python", ".go": "Go", ".rb": "Ruby", ".java": "Java", ".kt": "Kotlin", ".scala": "Scala", ".rs": "Rust", ".php": "PHP", ".cs": "C#", ".swift": "Swift", ".dart": "Dart", ".ex": "Elixir", ".exs": "Elixir", ".vue": "Vue", ".svelte": "Svelte", ".astro": "Astro", ".sql": "SQL", ".tf": "Terraform" }
const languages = {}
for (const f of files) {
  const l = LANG[path.extname(f).toLowerCase()]
  if (l) languages[l] = (languages[l] ?? 0) + 1
}

// ---- Manifests and dependencies ----
const manifests = []
const deps = new Map() // name -> first manifest
const addDep = (name, where) => deps.has(name) || deps.set(name, where)
for (const f of files) {
  const base = path.basename(f)
  const t = ["package.json", "requirements.txt", "pyproject.toml", "Pipfile", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "Cargo.toml", "Gemfile", "composer.json", "mix.exs", "pubspec.yaml", "*.csproj"].includes(base) || base.endsWith(".csproj")
  if (!t) continue
  const text = read(f)
  if (!text) continue
  const entry = { file: f, kind: base, scripts: null, deps: [] }
  try {
    if (base === "package.json") {
      const p = JSON.parse(text)
      entry.name = p.name
      entry.scripts = p.scripts ?? null
      entry.deps = [...Object.keys(p.dependencies ?? {}), ...Object.keys(p.devDependencies ?? {})]
      if (p.workspaces) entry.workspaces = p.workspaces
    } else if (base === "requirements.txt" || base === "Pipfile") {
      entry.deps = text.split("\n").map((l) => l.trim().split(/[<>=~!\[;\s]/)[0]).filter((l) => l && !l.startsWith("#") && !l.startsWith("-") && !l.startsWith("["))
    } else if (base === "pyproject.toml") {
      // PEP 621 lists ("fastapi[standard]>=0.1") and Poetry tables (fastapi = "^0.1").
      const listed = [...text.matchAll(/^\s*"([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*(?:[<>=~!;,][^"]*)?"\s*,?\s*$/gm)].map((x) => x[1])
      const poetry = text.split(/^\[/m).filter((sec) => /dependencies\]/.test(sec.split("\n")[0])).flatMap((sec) => [...sec.matchAll(/^([A-Za-z0-9_.\-]+)\s*=/gm)].map((x) => x[1]))
      entry.deps = [...new Set([...listed, ...poetry])].filter((d) => !["python", "name", "version"].includes(d))
    } else if (base === "go.mod") {
      entry.deps = [...text.matchAll(/^\s*([a-z0-9.\-]+\.[a-z]+\/[^\s]+)\s+v/gm)].map((x) => x[1])
    } else if (base === "pom.xml") {
      entry.deps = [...text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)].map((x) => x[1])
    } else if (base.startsWith("build.gradle")) {
      entry.deps = [...text.matchAll(/["']([\w.\-]+):([\w.\-]+)(?::[^"']*)?["']/g)].map((x) => `${x[1]}:${x[2]}`)
    } else if (base === "Cargo.toml") {
      const sec = text.split(/^\[/m).filter((s) => /^(dev-)?dependencies\]/.test(s)).join("\n")
      entry.deps = [...sec.matchAll(/^([A-Za-z0-9_\-]+)\s*=/gm)].map((x) => x[1])
    } else if (base === "Gemfile") {
      entry.deps = [...text.matchAll(/^\s*gem\s+["']([^"']+)/gm)].map((x) => x[1])
    } else if (base === "composer.json") {
      const p = JSON.parse(text)
      entry.deps = Object.keys({ ...(p.require ?? {}), ...(p["require-dev"] ?? {}) })
    } else if (base === "mix.exs") {
      entry.deps = [...text.matchAll(/\{:(\w+),/g)].map((x) => x[1])
    } else if (base === "pubspec.yaml") {
      entry.deps = [...text.matchAll(/^\s{2}([a-z_]+):/gm)].map((x) => x[1])
    } else if (base.endsWith(".csproj")) {
      entry.deps = [...text.matchAll(/PackageReference Include="([^"]+)"/g)].map((x) => x[1])
    }
  } catch {
    /* unreadable manifest: listed without dependencies */
  }
  entry.deps.forEach((d) => addDep(d, f))
  manifests.push(entry)
}

// ---- Services the code talks to (by dependency name, then by import text) ----
const SERVICES = [
  ["Next.js", /^next$/], ["Remix", /^@remix-run\//], ["Nuxt", /^nuxt$/], ["SvelteKit", /^@sveltejs\/kit$/], ["Astro", /^astro$/], ["Vite", /^vite$/], ["React", /^react$/], ["Vue", /^vue$/], ["Angular", /^@angular\/core$/], ["Svelte", /^svelte$/],
  ["Express", /^express$/], ["Fastify", /^fastify$/], ["Hono", /^hono$/], ["NestJS", /^@nestjs\/core$/], ["Koa", /^koa$/], ["tRPC", /^@trpc\/server$/], ["GraphQL (Apollo)", /^@apollo\/server$|^apollo-server/], ["GraphQL", /^graphql$/], ["Socket.IO", /^socket\.io$/],
  ["FastAPI", /^fastapi$/i], ["Django", /^django$/i], ["Flask", /^flask$/i], ["Celery", /^celery$/i], ["SQLAlchemy", /^sqlalchemy$/i], ["SQLModel", /^sqlmodel$/i], ["Alembic", /^alembic$/i], ["Pydantic", /^pydantic(-settings)?$/i], ["JWT auth", /^pyjwt$|^jsonwebtoken$|^jose$|^python-jose$|^jjwt/i], ["Email (Python)", /^emails$|^fastapi-mail$/],
  ["Spring Boot", /spring-boot/], ["Spring Kafka", /spring-kafka/], ["Hibernate/JPA", /hibernate|spring-boot-starter-data-jpa/], ["Gin", /gin-gonic\/gin/], ["Echo", /labstack\/echo/], ["Fiber", /gofiber\/fiber/], ["Rails", /^rails$/], ["Sidekiq", /^sidekiq$/], ["Laravel", /^laravel\/framework$/], ["Phoenix", /^phoenix$/], ["Actix", /^actix-web$/], ["Axum", /^axum$/],
  ["PostgreSQL", /^pg$|^postgres$|^psycopg|^asyncpg$|^pgx|jackc\/pgx|^postgresql$|lib\/pq|^@neondatabase\//], ["MySQL", /^mysql2?$|^pymysql$|mysql-connector|go-sql-driver\/mysql/], ["SQLite", /sqlite/], ["MongoDB", /^mongodb$|^mongoose$|^pymongo$|^motor$|mongo-driver/], ["Redis", /^redis$|^ioredis$|^@upstash\/redis$|go-redis|^redis-py$/], ["Prisma", /^prisma$|^@prisma\/client$/], ["Drizzle", /^drizzle-orm$/], ["TypeORM", /^typeorm$/], ["Sequelize", /^sequelize$/], ["Knex", /^knex$/],
  ["Supabase", /^@supabase\//], ["Firebase", /^firebase|^firebase-admin$/], ["Convex", /^convex$/], ["PlanetScale", /^@planetscale\//], ["Elasticsearch", /elasticsearch|^@elastic\//], ["Algolia", /algolia/], ["Pinecone", /pinecone/], ["Kafka", /^kafkajs$|kafka-python|confluent-kafka|sarama|spring-kafka|kafka-clients/], ["RabbitMQ", /^amqplib$|^pika$|amqp/], ["BullMQ", /^bullmq$|^bull$/], ["Temporal", /^@temporalio\/|temporal/], ["Inngest", /^inngest$/], ["Trigger.dev", /^@trigger\.dev\//],
  ["Anthropic", /^@anthropic-ai\/sdk$|^anthropic$/], ["OpenAI", /^openai$/], ["Vercel AI SDK", /^ai$|^@ai-sdk\//], ["LangChain", /langchain/], ["Google AI", /^@google\/genai$|^@google\/generative-ai$|google-generativeai/],
  ["Stripe", /stripe/], ["Dodo Payments", /^dodopayments$/], ["Razorpay", /razorpay/], ["Paddle", /paddle/], ["Lemon Squeezy", /lemonsqueezy/], ["PayPal", /paypal/],
  ["Auth0", /auth0/], ["Clerk", /^@clerk\//], ["NextAuth/Auth.js", /^next-auth$|^@auth\//], ["Passport", /^passport/], ["Lucia", /^lucia$/], ["Better Auth", /^better-auth$/],
  ["AWS SDK", /^@aws-sdk\/|^aws-sdk$|^boto3$|aws-sdk-go/], ["Google Cloud", /^@google-cloud\/|google-cloud-/], ["Azure", /^@azure\/|azure-/], ["Cloudflare", /^wrangler$|^@cloudflare\//], ["Vercel", /^@vercel\//],
  ["SendGrid", /sendgrid/], ["Resend", /^resend$/], ["Postmark", /postmark/], ["Mailgun", /mailgun/], ["Nodemailer", /^nodemailer$/], ["Twilio", /twilio/], ["Telegram", /telegraf|grammy|node-telegram-bot-api|python-telegram-bot|aiogram/], ["Slack", /^@slack\//], ["Discord", /^discord\.js$|discord\.py/],
  ["Sentry", /sentry/], ["PostHog", /posthog/], ["Segment", /segment/], ["Datadog", /datadog|dd-trace/], ["OpenTelemetry", /opentelemetry/], ["Mixpanel", /mixpanel/],
  ["Docker", /^dockerode$/], ["Tauri", /^@tauri-apps\//], ["Electron", /^electron$/], ["React Native", /^react-native$/], ["Expo", /^expo$/],
]
const services = {}
for (const [name, where] of deps) for (const [svc, re] of SERVICES) if (re.test(name)) (services[svc] ??= []).push(`${name} (${where})`)

// ---- Deployment and infrastructure ----
const infra = []
const add = (kind, file, detail = "") => infra.push({ kind, file, detail })
for (const f of files) {
  const b = path.basename(f)
  const text = () => read(f) ?? ""
  if (/^Dockerfile/.test(b)) add("Docker image", f, (text().match(/^FROM\s+(\S+)/m) ?? [])[1] ?? "")
  else if (/^(docker-)?compose\.ya?ml$|^docker-compose\.[\w.-]*ya?ml$/.test(b)) {
    // Keys directly under the top-level "services:" block only (not volumes or networks).
    const block = (text().split(/^services:\s*$/m)[1] ?? "").split(/^\S/m)[0]
    const svcs = [...block.matchAll(/^ {2}([a-zA-Z0-9_.-]+):\s*$/gm)].map((x) => x[1])
    add("Docker Compose", f, `services: ${svcs.join(", ")}`)
  } else if (b === "vercel.json" || b === "vercel.ts") {
    const t = text()
    const crons = [...t.matchAll(/"?path"?\s*:\s*["']([^"']+)["']\s*,\s*"?schedule"?\s*:\s*["']([^"']+)/g)].map((x) => `${x[1]} @ ${x[2]}`)
    const regions = (t.match(/"regions"\s*:\s*\[([^\]]*)\]/) ?? [])[1]
    add("Vercel", f, [regions && `regions ${regions.replace(/"/g, "")}`, crons.length && `crons ${crons.join("; ")}`].filter(Boolean).join(" · "))
  } else if (["netlify.toml", "fly.toml", "render.yaml", "railway.json", "railway.toml", "app.yaml", "Procfile", "wrangler.toml", "wrangler.jsonc", "serverless.yml", "serverless.yaml", "amplify.yml", "firebase.json", "supabase/config.toml", "apprunner.yaml", "skaffold.yaml", "Chart.yaml"].includes(b) || f === "supabase/config.toml")
    add(b.replace(/\.(toml|ya?ml|json|jsonc)$/, ""), f)
  else if (f.endsWith(".tf")) {
    const res = [...text().matchAll(/^resource\s+"([^"]+)"/gm)].map((x) => x[1])
    if (res.length) add("Terraform", f, [...new Set(res)].join(", "))
  } else if (/\.ya?ml$/.test(b) && /(^|\/)(k8s|kube|kubernetes|deploy|manifests|helm|charts)\//.test(f)) {
    const kinds = [...text().matchAll(/^kind:\s*(\w+)/gm)].map((x) => x[1])
    if (kinds.length) add("Kubernetes", f, [...new Set(kinds)].join(", "))
  } else if (/^\.github\/workflows\/.+\.ya?ml$/.test(f)) {
    const t = text()
    const name = (t.match(/^name:\s*(.+)$/m) ?? [])[1] ?? b
    const crons = [...t.matchAll(/cron:\s*["']([^"']+)/g)].map((x) => x[1])
    add("GitHub Actions", f, `${name}${crons.length ? ` · cron ${crons.join(", ")}` : ""}`)
  } else if (f === "supabase/migrations" || /^supabase\/migrations\//.test(f)) {
    /* counted under data models */
  }
}

// ---- Routes, handlers, jobs, models, env vars, hosts (scan text files once) ----
const routes = []
const jobs = []
const models = []
const env = new Map()
const hosts = new Map()
const ROUTE_RES = [
  [/\b(?:app|router|server|api|r|e|g|mux|v1|route)\.(get|post|put|patch|delete|all|use)\(\s*["'`](\/[^"'`]*)["'`]/g, (m) => `${m[1].toUpperCase()} ${m[2]}`],
  [/@(?:app|router|api|bp|blueprint)\.(get|post|put|patch|delete|route|websocket)\(\s*["']([^"']+)["']/g, (m) => `${m[1].toUpperCase()} ${m[2]}`],
  [/@(Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:value\s*=\s*|path\s*=\s*)?["']([^"']*)["']/g, (m) => `${m[1].toUpperCase()} ${m[2]}`],
  [/\.(?:HandleFunc|Handle)\(\s*"([^"]+)"/g, (m) => `ANY ${m[1]}`],
  [/\.(GET|POST|PUT|PATCH|DELETE)\(\s*"(\/[^"]*)"/g, (m) => `${m[1]} ${m[2]}`],
  [/^\s*(get|post|put|patch|delete)\s+["'](\/[^"']*)["']/gm, (m) => `${m[1].toUpperCase()} ${m[2]}`],
  [/\bpath\(\s*["']([^"']*)["']\s*,/g, (m) => `ANY /${m[1]}`],
]
const JOB_RES = [
  [/cron\.schedule\(\s*["']([^"']+)/g, "node-cron"], [/@Scheduled\(([^)]*)\)/g, "Spring @Scheduled"], [/crontab\(([^)]*)\)/g, "Celery beat"], [/new\s+(?:Queue|Worker)\(\s*["']([^"']+)/g, "BullMQ queue"],
  [/@(?:celery_app|app|shared)_?task|@shared_task|@app\.task/g, "Celery task"], [/\bsetInterval\(/g, "setInterval"], [/inngest\.createFunction\(/g, "Inngest function"], [/schedules?\s*:\s*\[/g, "schedule config"],
]
const MODEL_RES = [
  [/^model\s+(\w+)\s*\{/gm, "Prisma model"], [/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi, "SQL table"], [/mongoose\.model\(\s*["'](\w+)/g, "Mongoose model"], [/new\s+(?:mongoose\.)?Schema\(/g, "Mongoose schema"],
  [/__tablename__\s*=\s*["'](\w+)/g, "SQLAlchemy table"], [/class\s+(\w+)\((?:\w+\.)?Model\)/g, "Django/ORM model"], [/@Entity(?:\(\s*["']?(\w*)["']?\s*\))?/g, "Entity"], [/(?:pgTable|mysqlTable|sqliteTable)\(\s*["'](\w+)/g, "Drizzle table"],
  [/class\s+(\w+)\([^)]*table\s*=\s*True/g, "SQLModel table"], [/op\.create_table\(\s*["'](\w+)/g, "Alembic table"],
  [/^type\s+(\w+)\s+struct\s*\{[^}]*`(?:gorm|db|bson):/gm, "Go struct"], [/class\s+(\w+)\s*<\s*(?:ApplicationRecord|ActiveRecord::Base)/g, "Rails model"],
]
const ENV_RES = [/process\.env\.([A-Z][A-Z0-9_]+)/g, /process\.env\[["']([A-Z][A-Z0-9_]+)["']\]/g, /import\.meta\.env\.([A-Z][A-Z0-9_]+)/g, /os\.(?:environ\.get|getenv|environ\[)\(?\s*["']([A-Z][A-Z0-9_]+)/g, /System\.getenv\(\s*"([A-Z][A-Z0-9_]+)/g, /ENV\[["']([A-Z][A-Z0-9_]+)/g, /os\.Getenv\(\s*"([A-Z][A-Z0-9_]+)/g, /env\(\s*["']([A-Z][A-Z0-9_]+)/g]
const HOST_SKIP = /(^|\.)(w3\.org|schema\.org|json-schema\.org|example\.(com|org|invalid)|localhost|github\.com|githubusercontent\.com|npmjs\.(com|org)|unpkg\.com|jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|reactjs\.org|react\.dev|mozilla\.org|wikipedia\.org|shields\.io|opensource\.org|apache\.org|ui\.shadcn\.com|tailwindcss\.com|vitejs\.dev|nodejs\.org|typescriptlang\.org|openapi\.vercel\.sh|stackoverflow\.com|youtube\.com|twitter\.com|x\.com)$/

let scanned = 0
for (const f of files) {
  if (!isText(f) || /\.(lock|min\.js|map)$/.test(f) || /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum)$/.test(f)) continue
  const t = read(f)
  if (t == null) continue
  scanned++
  const isDoc = f.endsWith(".md")
  // File-system routes (Next.js, Remix, SvelteKit, Vercel api/).
  let fsPath = null
  let mt
  if ((mt = /(?:^|\/)app\/(?<p>.+)\/route\.[tj]sx?$/.exec(f))) fsPath = "/" + mt.groups.p.replace(/\([^)]*\)\//g, "") // Next.js app router (route groups dropped)
  else if ((mt = /(?:^|\/)pages\/api\/(?<p>.+)\.[tj]sx?$/.exec(f))) fsPath = "/api/" + mt.groups.p // Next.js pages router
  else if ((mt = /^api\/(?<p>.+)\.[tj]s$/.exec(f))) fsPath = "/api/" + mt.groups.p // Vercel functions
  else if ((mt = /(?:^|\/)routes\/(?<p>.+)\/\+server\.[tj]s$/.exec(f))) fsPath = "/" + mt.groups.p // SvelteKit
  if (fsPath && !isDoc) {
    const methods = [...t.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((x) => x[1])
    fsPath = fsPath.replace(/\/index$/, "").replace(/\[\.\.\.([^\]]+)\]/g, "*$1").replace(/\[([^\]]+)\]/g, ":$1")
    routes.push({ route: `${methods.length ? methods.join("|") : "ANY"} ${fsPath}`, at: f })
  }
  if (!isDoc) {
    // A router's own prefix (FastAPI APIRouter, NestJS @Controller), so its routes read in full.
    const prefix = ((t.match(/APIRouter\(\s*[^)]*prefix\s*=\s*["']([^"']+)/) ?? t.match(/@Controller\(\s*["']([^"']*)["']/) ?? [])[1] ?? "").replace(/\/$/, "")
    const withPrefix = (r) => {
      if (!prefix) return r
      const [method, p] = r.split(" ")
      return `${method} ${prefix}${p === "/" ? "" : p.startsWith("/") ? p : `/${p}`}`
    }
    for (const [re, fmt] of ROUTE_RES) for (const m of t.matchAll(re)) routes.push({ route: withPrefix(fmt(m)), at: `${f}:${lineOf(t, m.index)}` })
    for (const [re, kind] of JOB_RES) for (const m of t.matchAll(re)) jobs.push({ kind, detail: (m[1] ?? "").slice(0, 80), at: `${f}:${lineOf(t, m.index)}` })
    for (const [re, kind] of MODEL_RES) for (const m of t.matchAll(re)) models.push({ kind, name: (m[1] ?? "").replace(/"/g, ""), at: `${f}:${lineOf(t, m.index)}` })
  }
  for (const re of ENV_RES) for (const m of t.matchAll(re)) if (!env.has(m[1])) env.set(m[1], `${f}:${lineOf(t, m.index)}`)
  // pydantic-settings: upper-case fields of a BaseSettings class are environment variables.
  if (/BaseSettings\b/.test(t)) for (const m of t.matchAll(/^\s{4}([A-Z][A-Z0-9_]+)\s*:\s*[\w[|]/gm)) if (!env.has(m[1])) env.set(m[1], `${f}:${lineOf(t, m.index)}`)
  if (ENV_TEMPLATE.test(f))
    for (const m of t.matchAll(/^([A-Z][A-Z0-9_]+)\s*=/gm)) if (!env.has(m[1])) env.set(m[1], `${f}:${lineOf(t, m.index)}`)
  if (!isDoc)
    for (const m of t.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?=[/:"'`\s)]|$)/gi)) {
      const h = m[1].toLowerCase()
      if (HOST_SKIP.test(h)) continue
      const e = hosts.get(h) ?? { count: 0, at: `${f}:${lineOf(t, m.index)}` }
      e.count++
      hosts.set(h, e)
    }
}

// ---- Entry points and docs ----
const ENTRY = /(^|\/)(main|index|server|app|cli|manage|wsgi|asgi|program|Application)\.(ts|tsx|js|mjs|py|go|rb|java|kt|rs|cs|php)$/
const entries = files.filter((f) => ENTRY.test(f) && f.split("/").length <= 4).slice(0, 25)
const readme = files.find((f) => /^readme(\.md|\.rst|\.txt)?$/i.test(f))
const docs = files.filter((f) => /(^|\/)(docs?|architecture|adr|design)\//i.test(f) || /(ARCHITECTURE|DESIGN|DEPLOY|CONTRIBUTING|CLAUDE|AGENTS)\.md$/i.test(f)).slice(0, 25)
const migrations = files.filter((f) => /(migrations?|migrate|alembic\/versions)\//.test(f) && /\.(sql|ts|js|py|rb|go)$/.test(f))

const dedupe = (list, key) => {
  const seen = new Set()
  return list.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)))
}
const result = {
  root,
  files: files.length,
  scanned,
  languages: Object.entries(languages).sort((a, b) => b[1] - a[1]),
  manifests: manifests.map((m) => ({ file: m.file, name: m.name, scripts: m.scripts, deps: m.deps.length })),
  services,
  infra,
  routes: dedupe(routes, (r) => r.route + r.at.split(":")[0]).slice(0, 200),
  jobs: dedupe(jobs, (j) => j.kind + j.at).slice(0, 60),
  models: dedupe(models, (m) => m.kind + m.name).slice(0, 150),
  migrations: migrations.length,
  env: [...env].map(([name, at]) => ({ name, at })).slice(0, 150),
  hosts: [...hosts].sort((a, b) => b[1].count - a[1].count).slice(0, 40).map(([host, v]) => ({ host, ...v })),
  entries,
  readme,
  docs,
}

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 1))

// A short report to read first.
const L = []
const h = (s) => L.push(`\n## ${s}`)
L.push(`# Survey of ${path.basename(root)}`, `${result.files} files (${scanned} read). Facts carry the file they came from; confirm them in the code before using them.`)
h("Languages")
L.push(result.languages.map(([l, n]) => `${l} ${n}`).join(" · ") || "none recognised")
h("Manifests")
for (const m of result.manifests) L.push(`- ${m.file}${m.name ? ` (${m.name})` : ""}: ${m.deps} deps${m.scripts ? ` · scripts: ${Object.keys(m.scripts).slice(0, 10).join(", ")}` : ""}`)
h("Services and frameworks (from dependencies)")
for (const [s, list] of Object.entries(result.services)) L.push(`- ${s}: ${list.slice(0, 3).join("; ")}`)
h("Deployment and infrastructure")
for (const i of result.infra) L.push(`- ${i.kind}: ${i.file}${i.detail ? ` · ${i.detail}` : ""}`)
if (!result.infra.length) L.push("none found")
h(`Routes and handlers (${result.routes.length})`)
for (const r of result.routes.slice(0, 80)) L.push(`- ${r.route}  ← ${r.at}`)
h("Scheduled jobs and queues")
for (const j of result.jobs.slice(0, 30)) L.push(`- ${j.kind}${j.detail ? ` ${j.detail}` : ""}  ← ${j.at}`)
if (!result.jobs.length) L.push("none found in code (check deployment config above)")
h(`Data models (${result.models.length}; ${result.migrations} migration files)`)
for (const m of result.models.slice(0, 80)) L.push(`- ${m.kind} ${m.name}  ← ${m.at}`)
h(`Environment variables (${result.env.length})`)
L.push(result.env.map((e) => e.name).join(", "))
h("Outside hosts named in code")
for (const x of result.hosts) L.push(`- ${x.host} ×${x.count}  ← ${x.at}`)
h("Read next")
L.push([result.readme, ...result.docs, ...result.entries].filter(Boolean).map((f) => `- ${f}`).join("\n"))
const md = L.join("\n")
if (mdOut) fs.writeFileSync(mdOut, md)
console.log(md)
