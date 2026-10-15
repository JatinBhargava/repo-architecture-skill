#!/usr/bin/env node
// Turns a model into the finished page: validates it, then writes it into a copy of the prebuilt
// page (runtime/architecture.html). Needs only Node: no packages, no network.
//   node render.mjs <architecture.json> <out.html> [--repo <path>]
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const [modelPath, outPath] = process.argv.slice(2)
if (!modelPath || !outPath) {
  console.error("usage: render.mjs <architecture.json> <out.html> [--repo <path>]")
  process.exit(2)
}
const repo = process.argv.includes("--repo") ? ["--repo", process.argv[process.argv.indexOf("--repo") + 1]] : []
const check = spawnSync(process.execPath, [path.join(here, "validate.mjs"), modelPath, ...repo], { stdio: "inherit" })
if (check.status !== 0) process.exit(check.status ?? 1)

const model = JSON.parse(fs.readFileSync(modelPath, "utf8"))
const page = fs.readFileSync(path.join(here, "..", "runtime", "architecture.html"), "utf8")
const slot = '<script type="application/json" id="architecture-model"></script>'
if (!page.includes(slot)) {
  console.error("runtime/architecture.html has no model slot; rebuild it with scripts/build-runtime.sh")
  process.exit(1)
}
// "<" escaped so no string in the model can close the script tag.
const json = JSON.stringify(model).replace(/</g, "\\u003c")
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])
const html = page
  .replace(slot, `<script type="application/json" id="architecture-model">${json}</script>`)
  .replace(/<title>[^<]*<\/title>/, `<title>${esc(`${model.meta.name} Architecture`)}</title>`)
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(outPath, html)
console.log(`built=${path.resolve(outPath)} (${Buffer.byteLength(html)} bytes)`)
