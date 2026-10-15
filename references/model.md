# architecture.json

One JSON file describes the system; the page draws everything from it. Types are in
`template/src/types.ts`. A complete example: `examples/full-stack-fastapi.architecture.json`.

```jsonc
{
  "meta": {
    "name": "Acme Shop",              // the system's own name; the page title adds "Architecture"
    "repo": "owner/repo",
    "url": "https://github.com/owner/repo", // optional: a Repository link
    "commit": "8c6e994",                     // from fetch-repo.sh
    "date": "15 Oct 2026",
    "summary": "Two or three sentences: what it does and how it's built.",
    "facts": [{ "label": "region", "value": "eu-west-1" }],  // 4–6 chips, each from the code
    "counter": { "label": "Stock" }        // optional: a running total some steps change
  },
  "zones": [{ "id": "clients", "label": "People & clients" }],   // columns, left to right, 3–5
  "nodes": [
    { "id": "api", "zone": "aws", "title": "Orders API", "sub": "Node · 9 routes",
      "kind": "service", "big": true, "evidence": ["src/routes/", "serverless.yml"] }
  ],
  "flows": [
    {
      "id": "order", "name": "Place an order",
      "summary": "Optional sentence shown before the flow starts.",
      "toggles": [{ "id": "declined", "label": "Card declined", "hint": "402" }],
      "steps": [
        { "from": "web", "to": "api", "kind": "req", "text": "POST /api/orders",
          "detail": "What the code does here.", "proto": "HTTPS · Bearer JWT",
          "ms": 120, "evidence": ["src/routes/orders.ts:42"] },
        { "from": "api", "to": "web", "kind": "block", "when": "declined",
          "text": "402 · Payment declined", "detail": "Why it stops." },
        { "from": "api", "to": "db", "kind": "check", "when": "!declined",
          "text": "Reserve stock", "counter": 1 }
      ]
    }
  ],
  "components": [{ "name": "API", "tech": "Node functions", "where": "AWS eu-west-1", "role": "…", "evidence": ["api/"] }],
  "data": [{ "name": "orders", "holds": "Orders and their status", "evidence": ["db/migrations/001_init.sql:12"] }],
  "guards": [{ "what": "Place an order", "limit": "10/min per user", "checks": "Stock, card", "evidence": ["src/middleware/limits.ts:8"] }],
  "funnel": { "title": "One checkout", "note": "Where the numbers come from.", "rows": [{ "label": "Carts started", "value": 1200 }] },
  "unknowns": ["No rate limiting found on the public API."]
}
```

## Fields that need care

| Field | Rule |
|---|---|
| `nodes[].title` | ≤ 22 characters. What people call it (`Postgres`, `Stripe`, `Worker`), not a class name. |
| `nodes[].kind` | Sets the box's colour and icon: `client` `cdn` `gateway` `service` `worker` `queue` `db` `cache` `storage` `cron` `ai` `auth` `payment` `email` `chat` `external`. Give it; when left out it's guessed from the title. |
| `nodes[].endpoints` | Routes the box serves: `{ "method": "POST", "path": "/api/orders", "label": "Place an order", "evidence": ["src/routes/orders.ts:42"] }`. Clicking the box lists them; the one the current step calls is highlighted. |
| `nodes[].entities` | Tables of a data box, from `scripts/schema.mjs`: `{ "name": "orders", "label": "Orders", "evidence": ["db/migrations/001_init.sql:12"], "columns": [{ "name": "id", "type": "uuid", "key": "pk", "default": "gen_random_uuid()" }, { "name": "user_id", "type": "uuid", "key": "fk", "ref": "users.id" }] }`. Column fields: `key` (`pk`/`fk`), `ref`, `nullable`, `default`, `unique`, `note`. |
| `steps[].entities` | Tables of the target box this step reads or writes. Needed only when their names aren't in `text`. |
| `steps[].endpoint` | `"METHOD /path"` of the target box's endpoint this step calls. Needed only when `text` doesn't start with it. |
| `nodes[].sub` | ≤ 30 characters. What it's built with or holds, separated by ` · `. |
| `steps[].from/to` | Box ids. The same id twice is a check inside one box (it pulses instead of sending). |
| `steps[].kind` | `req` call · `res` reply · `check` a decision · `block` a failure that ends the flow. |
| `steps[].when` | `"x"`: only with toggle x on. `"!x"`: only with it off. The first `block` reached ends the flow. |
| `steps[].ms`, `usd` | Only when the repository states them or they were measured. Omit otherwise. |
| `steps[].counter` | Positive spends from `meta.counter`, negative adds to it. |
| `steps[].evidence` | `path` or `path:line`, relative to the repository root. Checked by `validate.mjs --repo`. |
| `funnel` | Only real numbers. Bars are drawn to scale, so tiny values show as slivers. |
| `unknowns` | What you looked for and didn't find. It's a tab on the page; it tells the reader the gaps are known. |

## Choosing toggles

A toggle is worth adding when the code has a branch for it and the branch changes where the request
goes or stops: an auth check, a rate limit, input or file validation, a signature or HMAC check,
an idempotency key, a balance or quota, a feature flag that routes elsewhere. Put the `block` step
on the hop where the code returns the error (usually the service back to the caller), with the
status code in `text` when there is one.
