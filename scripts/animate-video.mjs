#!/usr/bin/env node
// Turns an animated SVG from animate.mjs into an MP4 (for LinkedIn, X, Instagram) and a GIF (for
// chats and anywhere video won't play). Optional: needs ffmpeg and playwright-core with a Chrome or
// Chromium; playwright-core is found in the folder you run this in, a global install, or
// PLAYWRIGHT_CORE (its path).
//   node animate-video.mjs <animated.svg> [--fps 30] [--gif-width 1100] [--chrome <path>]
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const svg = path.resolve(args.find((a) => a.endsWith(".svg")) ?? "")
if (!fs.existsSync(svg)) {
  console.error("usage: animate-video.mjs <animated.svg> [--fps 30] [--gif-width 1100] [--chrome <path>]")
  process.exit(2)
}
if (spawnSync("ffmpeg", ["-version"]).status !== 0) {
  console.error("ffmpeg isn't installed; the SVG itself is ready to use.")
  process.exit(1)
}
// playwright-core from PLAYWRIGHT_CORE, the folder you run this in, or a global install.
function findPlaywright() {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE
  const bases = [process.cwd()]
  const g = spawnSync("npm", ["root", "-g"], { encoding: "utf8", shell: process.platform === "win32" })
  if (g.status === 0) bases.push(g.stdout.trim())
  for (const b of bases) {
    try {
      return createRequire(path.join(b, "noop.js")).resolve("playwright-core")
    } catch {
      /* not here */
    }
  }
  return null
}
const found = findPlaywright()
if (!found) {
  console.error("playwright-core isn't installed (npm i playwright-core in this folder, or -g); the SVG itself is ready to use.")
  process.exit(1)
}
const pw = await import(pathToFileURL(found).href)
const chromium = pw.chromium ?? pw.default?.chromium
const fps = Number(opt("--fps", 30))
const gifWidth = Number(opt("--gif-width", 1100))
const text = fs.readFileSync(svg, "utf8")
const T = Number((/dur="([\d.]+)s"/.exec(text) ?? [])[1])
if (!T) {
  console.error("No animation length found in the SVG (was it made by animate.mjs?).")
  process.exit(1)
}
const chromePaths = [
  opt("--chrome"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean)
const executablePath = chromePaths.find((p) => fs.existsSync(p))
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto(pathToFileURL(svg).href)
await page.waitForTimeout(300)
await page.evaluate(() => document.documentElement.pauseAnimations())
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "architecture-frames-"))
const n = Math.round(T * fps)
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => document.documentElement.setCurrentTime(t), i / fps)
  await page.screenshot({ path: path.join(dir, `f${String(i).padStart(5, "0")}.png`) })
}
await browser.close()
const base = svg.replace(/\.svg$/, "")
const run = (a) => {
  const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", ...a], { stdio: "inherit" })
  if (r.status !== 0) process.exit(1)
}
run(["-framerate", String(fps), "-i", path.join(dir, "f%05d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", "-movflags", "+faststart", `${base}.mp4`])
run([
  "-framerate", String(fps), "-i", path.join(dir, "f%05d.png"),
  "-vf", `fps=12,scale=${gifWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  "-loop", "0", `${base}.gif`,
])
fs.rmSync(dir, { recursive: true, force: true })
for (const f of [`${base}.mp4`, `${base}.gif`]) console.log(`video=${f} (${Math.round(fs.statSync(f).size / 1024)} KB)`)
