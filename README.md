# repo-architecture

An AI agent skill that reads a code repository and makes an **interactive system-design page** for
it: one self-contained HTML file you can open, share or publish.

- **Architecture diagram:** the system's parts, grouped by where they run, coloured by kind
  (client, service, database, queue, AI, payments…).
- **Flow simulation:** real request flows (sign-in, the core feature, payments, webhooks,
  background jobs) play hop by hop, with a plain explanation of each step and the file and line it
  came from.
- **"What if" switches:** each failure case the code handles (rate limit, bad token, forged
  webhook…) shows exactly where the request is stopped.
- **Clickable boxes:**
  - A service lists its endpoints, with the one in use highlighted.
  - A database lists its tables; click one to see its columns, keys and defaults.
- **Movable boxes:** drag them around; the layout is remembered in your browser.
- **Reference tabs:** components, data, guards and limits, and what wasn't found in the code.

Everything on the page is read from the repository and checked: a validator confirms that every
cited file and line exists. Nothing is guessed, and nothing in the repository is ever run.

## What's inside

| Path | What it is |
|---|---|
| `SKILL.md` | The instructions the agent follows (Agent Skills format) |
| `scripts/fetch-repo.sh` | Shallow-clones a GitHub repo (or uses a local path) |
| `scripts/survey.mjs` | Maps a repo: languages, dependencies, services, deployment, routes, jobs, models, env var names |
| `scripts/schema.mjs` | Reads tables and columns from SQL migrations, Prisma, Alembic and SQLModel |
| `scripts/validate.mjs` | Checks a model, including every `file:line` it cites |
| `scripts/render.mjs` | Validates a model and writes it into the prebuilt page |
| `runtime/architecture.html` | The prebuilt page (React, Tailwind, shadcn/ui), about 700 KB |
| `references/model.md` | The `architecture.json` format, field by field |
| `examples/` | A complete model for `fastapi/full-stack-fastapi-template` |
| `template/` | The page's source, only needed to change the page itself |

**Requirements:** Node 18+, and git (or `gh` for private repos). Building a page installs nothing
and needs no network.

## Install

### Claude Code

Put the folder in your skills directory. For just you, in every project:

```bash
git clone <this repo> ~/.claude/skills/repo-architecture
```

For everyone working on one project (commit it):

```bash
git clone <this repo> .claude/skills/repo-architecture
```

Then ask: *"Make a system design page for https://github.com/owner/repo"*, or type
`/repo-architecture <repo>`.

### Claude.ai and the Claude desktop app

1. Turn on code execution and Skills in **Settings → Capabilities**.
2. Upload `repo-architecture.zip` (this folder, zipped, with `SKILL.md` at its top) under **Skills**.
3. Ask for a repo's system design.

Fetching from GitHub needs the sandbox to allow network access. If it doesn't, upload the repo as
a zip and ask Claude to use that.

### Codex CLI

Codex reads the same `SKILL.md` format. Put the folder in `~/.codex/skills/repo-architecture`
(or a project's `.codex/skills/`). If your Codex version doesn't load skills, add this to your
`AGENTS.md`:

```markdown
When asked for a repository's architecture or system design, follow
~/.codex/skills/repo-architecture/SKILL.md (its scripts are in the same folder).
```

### Cursor, Windsurf, GitHub Copilot, Gemini CLI and other agents

Any agent that can read files and run commands can follow it:

1. Copy the folder somewhere in your project or home, e.g. `tools/repo-architecture`.
2. Point the tool's instructions file at `SKILL.md`:
   - `AGENTS.md`
   - `.cursor/rules/architecture.mdc`
   - `.github/copilot-instructions.md`
   - `GEMINI.md`
3. Use the same sentence as in the Codex example, with your path.

### By hand

```bash
bash scripts/fetch-repo.sh owner/repo work/repos             # clone
node scripts/survey.mjs work/repos/owner_repo --md work/survey.md
node scripts/schema.mjs work/repos/owner_repo --out work/entities.json
# write work/architecture.json (see references/model.md and examples/)
node scripts/render.mjs work/architecture.json work/page.html --repo work/repos/owner_repo
```

## Safety

- **The scripts only read files.** They never install or run anything from the repository being
  studied.
- **Secret files are skipped.** Real `.env` files are never opened; the survey reads only
  `.env.example`-style templates and records variable names, never values.
- **The page is self-contained.** It loads nothing from the network and remembers only your box
  layout, in your own browser.

## Changing the page

Edit `template/` (Vite, React 19, Tailwind 4, shadcn/ui), then rebuild the runtime:

```bash
bash scripts/build-runtime.sh   # needs npm and network access once
```

## License

MIT. See `LICENSE`.
