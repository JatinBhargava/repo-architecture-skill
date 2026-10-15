#!/usr/bin/env node
// Turns a model into the finished page: validates it, then writes it into a copy of the prebuilt
// page (runtime/architecture.html). Needs only Node: no packages, no network.
// It also writes the link-preview tags (Open Graph and Twitter) from the model's name and summary.
// Previews need absolute addresses: --url is where the page will live, --image a picture of it
// (the PNG animate-video.mjs writes, once hosted).
//   node render.mjs <architecture.json> <out.html> [--repo <path>] [--url <page url>] [--image <image url>]
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const [modelPath, outPath] = process.argv.slice(2)
if (!modelPath || !outPath) {
  console.error("usage: render.mjs <architecture.json> <out.html> [--repo <path>] [--url <page url>] [--image <image url>]")
  process.exit(2)
}
const opt = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined)
const repo = opt("--repo") ? ["--repo", opt("--repo")] : []
for (const k of ["--url", "--image"]) {
  if (opt(k) && !/^https?:\/\//.test(opt(k))) {
    console.error(`${k} must be an absolute http(s) address; link previews can't load a local file.`)
    process.exit(2)
  }
}
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
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
const title = `${model.meta.name} Architecture`
const description =
  model.meta.summary ?? `How ${model.meta.name} works: its parts, the calls between them, and its request flows, each tied to the code.`
const image = opt("--image")
const tags = [
  ["name", "description", description],
  ["property", "og:type", "website"],
  ["property", "og:title", title],
  ["property", "og:description", description],
  ...(opt("--url") ? [["property", "og:url", opt("--url")]] : []),
  ...(image ? [["property", "og:image", image], ["property", "og:image:alt", `${model.meta.name} architecture diagram`]] : []),
  ["name", "twitter:card", image ? "summary_large_image" : "summary"],
  ["name", "twitter:title", title],
  ["name", "twitter:description", description],
  ...(image ? [["name", "twitter:image", image]] : []),
]
  .map(([attr, key, value]) => `<meta ${attr}="${key}" content="${esc(value)}" />`)
  .join("\n    ")
// A function replacement, so "$" in the model's text is written as-is.
const html = page
  .replace(slot, () => `<script type="application/json" id="architecture-model">${json}</script>`)
  .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`)
  // After the charset, which browsers look for in the first 1024 bytes.
  .replace(/(<meta name="viewport"[^>]*>)/, (m) => `${m}\n    ${tags}`)
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(outPath, html)
console.log(`built=${path.resolve(outPath)} (${Buffer.byteLength(html)} bytes)`)
