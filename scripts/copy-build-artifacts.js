import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const outputDir = path.join(rootDir, ".output");
const outputPublicDir = path.join(outputDir, "public");
const distDir = path.join(rootDir, "dist");

console.log("Preparing build artifacts in dist/ for static hosting...");

// 1. Ensure dist directory exists
fs.mkdirSync(distDir, { recursive: true });

// 2. Copy all files and folders from .output/public into dist/
if (fs.existsSync(outputPublicDir)) {
  fs.cpSync(outputPublicDir, distDir, { recursive: true });
  console.log("Copied .output/public assets into dist/");
}

// 3. Copy full .output into dist/.output so full server/SSR artifacts are preserved
if (fs.existsSync(outputDir)) {
  const distOutputDir = path.join(distDir, ".output");
  fs.mkdirSync(distOutputDir, { recursive: true });
  fs.cpSync(outputDir, distOutputDir, { recursive: true });
  console.log("Copied .output into dist/.output");
}

// 4. Set up index.html and 404.html for static SPA export
const shellHtmlPath = path.join(outputPublicDir, "_shell.html");
const distIndexPath = path.join(distDir, "index.html");
const dist404Path = path.join(distDir, "404.html");

if (fs.existsSync(shellHtmlPath)) {
  // Use TanStack Start's prerendered SPA shell which contains full DOM, CSS, preloads, and $_TSR hydration
  const shellContent = fs.readFileSync(shellHtmlPath, "utf-8");
  fs.writeFileSync(distIndexPath, shellContent, "utf-8");
  fs.writeFileSync(dist404Path, shellContent, "utf-8");

  // Also ensure .output/public/index.html exists for Nitro previews
  fs.writeFileSync(path.join(outputPublicDir, "index.html"), shellContent, "utf-8");
  fs.writeFileSync(path.join(outputPublicDir, "404.html"), shellContent, "utf-8");

  console.log("Deployed prerendered SPA _shell.html to index.html and 404.html in dist/");
} else {
  // Fallback: Dynamically build index.html resolving actual asset hashes
  const assetsDir = path.join(distDir, "assets");
  let mainJs = "";
  let mainCss = "";

  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir);
    const jsFiles = files.filter((f) => f.startsWith("index-") && f.endsWith(".js"));
    if (jsFiles.length > 0) mainJs = `/assets/${jsFiles[0]}`;
    const cssFiles = files.filter((f) => f.startsWith("styles-") && f.endsWith(".css"));
    if (cssFiles.length > 0) mainCss = `/assets/${cssFiles[0]}`;
  }

  const fallbackHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Paragon OEE FRO Dashboard Prototype</title>
    <meta name="description" content="Clickable Paragon OEE FRO dashboard prototype for Shift Leader and Section Head." />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" />
    ${mainCss ? `<link rel="stylesheet" href="${mainCss}" />` : ""}
  </head>
  <body>
    <div id="root"></div>
    ${mainJs ? `<script type="module" src="${mainJs}"></script>` : ""}
  </body>
</html>
`;

  fs.writeFileSync(distIndexPath, fallbackHtml, "utf-8");
  fs.writeFileSync(dist404Path, fallbackHtml, "utf-8");
  console.log("Deployed fallback SPA HTML to index.html and 404.html in dist/");
}

// 5. Verification of key artifacts in dist/
const distFiles = fs.readdirSync(distDir);
console.log("dist/ root entries:", distFiles.join(", "));
if (!fs.existsSync(path.join(distDir, "index.html"))) {
  throw new Error("Verification failed: dist/index.html does not exist!");
}

console.log("Build artifacts successfully prepared and verified in dist/.");
