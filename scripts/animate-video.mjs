#!/usr/bin/env node
// Turns an animated SVG from animate.mjs into an MP4 (for LinkedIn, X, Instagram), a GIF (for
// chats and anywhere video won't play) and a 1200 × 630 PNG (the link-preview image), written
// beside the SVG.
// It needs a browser (to play the SVG frame by frame) and ffmpeg. It uses what's installed: ffmpeg
// on the PATH, playwright-core in this folder or globally, and Chrome, Chromium or Edge. Whatever is
// missing it installs once into a cache folder (playwright-core, ffmpeg-static, and Playwright's own
// Chromium when there's no browser), so the first run needs network access and a minute or two.
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

const PINS = { "playwright-core": "1.64.0", "ffmpeg-static": "5.3.0" }
const CACHE =
  process.env.REPO_ARCHITECTURE_CACHE ??
  (process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "repo-architecture-skill")
    : path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "repo-architecture-skill"))
const fail = (why) => {
  console.error(`${why}\nThe animated SVG is ready to use; only the MP4 and GIF weren't made.`)
  process.exit(1)
}
const npm = (a) => spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

/** A package from this folder, a global install, or the cache; installed into the cache if missing. */
function need(name) {
  const bases = [process.cwd(), CACHE]
  const g = npm(["root", "-g"])
  if (g.status === 0) bases.push(path.dirname(g.stdout.trim()))
  const find = () => {
    for (const b of bases) {
      try {
        return createRequire(path.join(b, "noop.js")).resolve(name)
      } catch {
        /* not here */
      }
    }
    return null
  }
  let found = find()
  if (!found) {
    console.log(`Installing ${name} into ${CACHE} (once)…`)
    fs.mkdirSync(CACHE, { recursive: true })
    if (!fs.existsSync(path.join(CACHE, "package.json"))) fs.writeFileSync(path.join(CACHE, "package.json"), '{ "private": true }\n')
    const r = npm(["install", "--prefix", CACHE, "--no-audit", "--no-fund", "--loglevel=error", `${name}@${PINS[name]}`])
    if (r.status !== 0) fail(`Couldn't install ${name} (no network?): ${(r.stderr || "").trim().split("\n").pop()}`)
    found = find()
  }
  return found ?? fail(`${name} couldn't be loaded.`)
}

// ffmpeg: the one on the PATH, else ffmpeg-static's.
let ffmpeg = "ffmpeg"
if (spawnSync("ffmpeg", ["-version"]).status !== 0) {
  ffmpeg = createRequire(import.meta.url)(need("ffmpeg-static"))
  if (!ffmpeg || !fs.existsSync(ffmpeg)) fail("ffmpeg-static has no ffmpeg build for this machine.")
}

const pw = await import(pathToFileURL(need("playwright-core")).href)
const chromium = pw.chromium ?? pw.default?.chromium

// A browser: one that's installed, else Playwright's own Chromium (downloaded once).
const chromePaths = [
  opt("--chrome"),
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean)
async function launch() {
  const local = chromePaths.find((p) => fs.existsSync(p))
  if (local) return chromium.launch({ executablePath: local })
  try {
    return await chromium.launch()
  } catch {
    console.log("No Chrome found; downloading Playwright's Chromium (once)…")
    const cli = path.join(path.dirname(need("playwright-core")), "cli.js")
    const r = spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" })
    if (r.status !== 0) fail("Couldn't download Chromium (no network?).")
    return chromium.launch()
  }
}

const fps = Number(opt("--fps", 30))
const gifWidth = Number(opt("--gif-width", 1100))
const text = fs.readFileSync(svg, "utf8")
const T = Number((/dur="([\d.]+)s"/.exec(text) ?? [])[1])
if (!T) {
  console.error("No animation length found in the SVG (was it made by animate.mjs?).")
  process.exit(1)
}
const browser = await launch()
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
  const r = spawnSync(ffmpeg, ["-loglevel", "error", "-y", ...a], { stdio: "inherit" })
  if (r.status !== 0) process.exit(1)
}
run(["-framerate", String(fps), "-i", path.join(dir, "f%05d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", "-movflags", "+faststart", `${base}.mp4`])
run([
  "-framerate", String(fps), "-i", path.join(dir, "f%05d.png"),
  "-vf", `fps=12,scale=${gifWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  "-loop", "0", `${base}.gif`,
])
// The link-preview image: the closing card (the flow's summary, every part it uses lit), at the
// 1200 × 630 Open Graph size, padded with the diagram's paper colour rather than cropped.
const still = path.join(dir, `f${String(Math.max(0, Math.min(n - 1, Math.round((T - 0.8) * fps)))).padStart(5, "0")}.png`)
run(["-i", still, "-vf", "scale=1200:630:force_original_aspect_ratio=decrease:flags=lanczos,pad=1200:630:(ow-iw)/2:(oh-ih)/2:color=0xfaf7f3", "-frames:v", "1", `${base}.png`])
fs.rmSync(dir, { recursive: true, force: true })
for (const f of [`${base}.mp4`, `${base}.gif`, `${base}.png`]) console.log(`file=${f} (${Math.round(fs.statSync(f).size / 1024)} KB)`)
