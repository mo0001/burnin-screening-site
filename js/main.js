import { esc } from "./util.js";

const PAGES = {
  "": { title: "Home", load: () => import("./pages/home.js") },
  explorer: { title: "Explorer", load: () => import("./pages/explorer.js") },
  results: { title: "Results", load: () => import("./pages/results.js") },
  try: { title: "Try it", load: () => import("./pages/try.js") },
  about: { title: "About", load: () => import("./pages/about.js") },
};
const SITE = "Burn-in Anomaly Screening · Team CTRL + Win";

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs] = raw.split("?");
  return { route: path.replace(/\/$/, ""), params: new URLSearchParams(qs || "") };
}

// Update the query part of the current route without re-rendering.
export function setQuery(obj) {
  const { route, params } = parseHash();
  for (const [k, v] of Object.entries(obj)) (v === null || v === undefined || v === "") ? params.delete(k) : params.set(k, v);
  const q = params.toString();
  history.replaceState(null, "", `#/${route}${q ? "?" + q : ""}`);
}

let cleanup = null;
let current = null;

async function render() {
  const { route, params } = parseHash();
  const page = PAGES[route] ? route : null;
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.route === (page ?? "__none")) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const app = document.getElementById("app");
  if (page === null) {
    document.title = `Not found · ${SITE}`;
    app.innerHTML = `<div class="wrap section"><span class="eyebrow">404</span><h1>Page not found</h1>
      <p class="muted">No page called “${esc(route)}”.</p><p><a class="btn" href="#/">Back home</a></p></div>`;
    return;
  }
  const routeChanged = page !== current;
  if (cleanup) { cleanup(); cleanup = null; }
  current = page;
  document.title = page ? `${PAGES[page].title} · ${SITE}` : SITE;
  try {
    const mod = await PAGES[page].load();
    cleanup = (await mod.render(app, params)) || null;
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="wrap section"><h2>Something went wrong</h2><p class="error">${esc(err.message)}</p>
      <p class="muted">If you opened this file directly, serve the folder over HTTP (e.g. <code>python -m http.server</code>).</p></div>`;
  }
  if (routeChanged) { window.scrollTo(0, 0); app.focus({ preventScroll: true }); }
}

function initTheme() {
  const btn = document.querySelector(".theme-toggle");
  const root = document.documentElement;
  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const sync = () => btn.setAttribute("aria-pressed", String(isDark()));
  btn.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem("theme", next);
    sync();
    window.dispatchEvent(new Event("themechange"));
  });
  sync();
}

window.addEventListener("hashchange", render);
initTheme();
render();
