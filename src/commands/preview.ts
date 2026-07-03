import { execFileSync } from "node:child_process";
import pc from "picocolors";
import { projectKey } from "../core/project.js";
import { getDoc, latestDoc } from "../core/store.js";
import { loadConfig, resolveTheme } from "../core/config.js";
import { buildSite } from "../render/renderer.js";

/** Build a doc with its resolved theme and open it locally (ADR-0001 §D24). */
export function preview(slug?: string): void {
  const { key } = projectKey();
  const meta = slug ? getDoc(key, slug) : latestDoc(key);
  if (!meta) {
    console.error(pc.red("No matching doc to preview."));
    process.exitCode = 1;
    return;
  }
  const cfg = loadConfig();
  const theme = resolveTheme(cfg, key, meta.theme);
  const out = buildSite({ doc: meta, theme, base: "/" });
  console.log(pc.green("Built preview: ") + out);
  openInBrowser(`file://${out}/index.html`);
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    execFileSync(cmd, [url], { stdio: "ignore" });
  } catch {
    /* headless / no browser */
  }
}
