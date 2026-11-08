// Packs the Vite build (dist/) into one self-contained HTML file that opens
// by double-click: dist-single/Air Riders Tracker.html. The desktop app loads
// the same file (dist-single/index.html). Run after `vite build`
// (`npm run build:single` does both).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const outDir = join(root, "dist-single");
const outFile = join(outDir, "Air Riders Tracker.html");

if (!existsSync(join(dist, "index.html"))) {
  console.error("dist/index.html not found. Run `npm run build` first.");
  process.exit(1);
}

let html = readFileSync(join(dist, "index.html"), "utf8");
const read = href => readFileSync(join(dist, href.replace(/^\.?\//, "")), "utf8");

// The app is one entry chunk; anything else would need loading at runtime.
if (/<link[^>]+rel="modulepreload"/.test(html)) {
  console.error("The build has extra JS chunks (modulepreload). Single-file packing expects one bundle.");
  process.exit(1);
}

let scripts = 0, styles = 0;
html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (_tag, src) => {
  scripts++;
  // Keep "</script" inside the code from closing the tag early.
  return `<script type="module">${read(src).replace(/<\/script/gi, "<\\/script")}</script>`;
});
html = html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g, (_tag, href) => {
  styles++;
  return `<style>${read(href)}</style>`;
});

if (scripts !== 1) {
  console.error(`Expected exactly one script in dist/index.html, found ${scripts}.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html);
writeFileSync(join(outDir, "index.html"), html); // what the desktop app loads
console.log(`Wrote ${outFile} (${Math.round(html.length / 1024)} KB, ${styles} stylesheet${styles === 1 ? "" : "s"} inlined)`);
