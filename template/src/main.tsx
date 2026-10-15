import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import sample from "./architecture.json"
import type { Model } from "./types"
import "./index.css"

/**
 * Light or dark: an explicit data-theme on <html> wins (artifact viewers set one), otherwise the
 * system setting. shadcn's tokens switch on the .dark class.
 */
function followTheme() {
  const root = document.documentElement
  const media = matchMedia("(prefers-color-scheme: dark)")
  const apply = () => {
    const chosen = root.dataset.theme
    root.classList.toggle("dark", chosen ? chosen === "dark" : media.matches)
  }
  apply()
  media.addEventListener("change", apply)
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["data-theme"] })
}

followTheme()
// The model written into the page by scripts/render.mjs; the bundled sample when there's none.
const embedded = document.getElementById("architecture-model")?.textContent?.trim()
const m = (embedded ? JSON.parse(embedded) : sample) as unknown as Model
document.title = `${m.meta.name} Architecture`
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App model={m} />
  </StrictMode>,
)
