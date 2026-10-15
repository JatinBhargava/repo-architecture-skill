#!/usr/bin/env node
// Installs the repo-architecture skill into your AI tools.
//   npx github:JatinBhargava/repo-architecture-skill            install for every tool found
//   npx github:JatinBhargava/repo-architecture-skill --help     all options
// Copies the skill's files only; installs and runs nothing else.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const NAME = "repo-architecture"
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const home = os.homedir()
const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f) => (has(f) ? args[args.indexOf(f) + 1] : null)

// What gets installed (the source, the prebuilt page, examples and docs).
const PARTS = ["SKILL.md", "README.md", "LICENSE", "scripts", "runtime", "references", "examples", "template"]

const TOOLS = [
  { flag: "--claude", name: "Claude Code", dir: path.join(home, ".claude", "skills"), present: () => fs.existsSync(path.join(home, ".claude")) },
  { flag: "--codex", name: "Codex", dir: path.join(home, ".codex", "skills"), present: () => fs.existsSync(path.join(home, ".codex")) },
]

if (has("--help") || has("-h")) {
  console.log(`repo-architecture: interactive system-design pages from any code repository

Usage: npx github:JatinBhargava/repo-architecture-skill [options]

With no options, installs for every tool found on this machine (Claude Code, Codex).

  --claude          Claude Code, for you (~/.claude/skills/${NAME})
  --codex           Codex CLI, for you (~/.codex/skills/${NAME})
  --project         this project, shared through git (./.claude/skills/${NAME})
  --dir <path>      any folder (for Cursor, Copilot, Gemini CLI and others)
  --zip             make ${NAME}.zip here, to upload to Claude.ai or the Claude desktop app
  --uninstall       remove it from the places above (pick them with the same flags)
  --force           replace a folder that wasn't installed by this tool (for example a git clone)
`)
  process.exit(0)
}

/** Where to act: the flags given, or every tool found. */
function targets() {
  const out = []
  for (const t of TOOLS) if (has(t.flag)) out.push({ name: t.name, dir: path.join(t.dir, NAME) })
  if (has("--project")) out.push({ name: "this project", dir: path.resolve(".claude", "skills", NAME) })
  if (val("--dir")) out.push({ name: "your folder", dir: path.resolve(val("--dir"), NAME) })
  if (out.length || has("--zip")) return out
  const found = TOOLS.filter((t) => t.present()).map((t) => ({ name: t.name, dir: path.join(t.dir, NAME) }))
  if (!found.length) {
    console.log("No Claude Code or Codex found here. Choose a place: --claude, --codex, --project, --dir <path>, or --zip.")
    process.exit(1)
  }
  return found
}

const MARK = ".installed-by-repo-architecture"
const ours = (dir) => fs.existsSync(path.join(dir, MARK))

function install(t, quiet = false) {
  if (fs.existsSync(t.dir)) {
    if (fs.existsSync(path.join(t.dir, ".git")) && !has("--force")) {
      console.log(`· ${t.name}: ${t.dir} is a git clone; update it with git pull (or use --force to replace it).`)
      return
    }
    if (!ours(t.dir) && !has("--force")) {
      console.log(`· ${t.name}: ${t.dir} already exists and wasn't installed by this tool; left as it is (use --force to replace it).`)
      return
    }
    fs.rmSync(t.dir, { recursive: true, force: true })
  }
  fs.mkdirSync(t.dir, { recursive: true })
  for (const part of PARTS) {
    const from = path.join(here, part)
    // Skips a node_modules inside the skill (e.g. template/node_modules), judged below the skill's own
    // folder: npx itself unpacks this package inside a node_modules.
    if (fs.existsSync(from))
      fs.cpSync(from, path.join(t.dir, part), { recursive: true, filter: (src) => !path.relative(here, src).split(path.sep).includes("node_modules") })
  }
  if (!fs.existsSync(path.join(t.dir, "SKILL.md"))) {
    console.error(`✗ ${t.name}: nothing was copied into ${t.dir}`)
    process.exit(1)
  }
  fs.writeFileSync(path.join(t.dir, MARK), `${new Date().toISOString()}\n`)
  if (!quiet) console.log(`✓ ${t.name}: installed in ${t.dir}`)
}

function uninstall(t) {
  if (!fs.existsSync(t.dir)) return console.log(`· ${t.name}: not installed`)
  if (!ours(t.dir) && !has("--force")) return console.log(`· ${t.name}: ${t.dir} wasn't installed by this tool; left as it is (use --force).`)
  fs.rmSync(t.dir, { recursive: true, force: true })
  console.log(`✓ ${t.name}: removed ${t.dir}`)
}

function zip() {
  const out = path.resolve(`${NAME}.zip`)
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "repo-architecture-"))
  install({ name: "zip", dir: path.join(stage, NAME) }, true)
  fs.rmSync(path.join(stage, NAME, MARK), { force: true })
  fs.rmSync(out, { force: true })
  const r =
    process.platform === "win32"
      ? spawnSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${path.join(stage, NAME)}' -DestinationPath '${out}'`], { stdio: "inherit" })
      : spawnSync("zip", ["-qr", out, NAME], { cwd: stage, stdio: "inherit" })
  fs.rmSync(stage, { recursive: true, force: true })
  if (r.status !== 0) {
    console.log("Couldn't make the zip here. Download it instead: https://github.com/JatinBhargava/repo-architecture-skill/archive/refs/heads/main.zip")
    process.exit(1)
  }
  console.log(`✓ zip: ${out}\n  Upload it in Claude.ai or the Claude desktop app: Settings → Capabilities → Skills (with code execution on).`)
}

const list = targets()
for (const t of list) (has("--uninstall") ? uninstall : install)(t)
if (has("--zip") && !has("--uninstall")) zip()
if (!has("--uninstall") && list.length) {
  console.log(`
Next: ask your agent, for example
  "Make a system design page for https://github.com/owner/repo"
In Claude Code you can also type /${NAME} <repo>. Needs Node 18+.
For Cursor, Copilot, Gemini CLI and others, install with --dir and point AGENTS.md (or the tool's
rules file) at <that folder>/${NAME}/SKILL.md.`)
}
