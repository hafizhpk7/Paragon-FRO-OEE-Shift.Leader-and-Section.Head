import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const outputDir = path.join(rootDir, ".output");
const outputPublicDir = path.join(outputDir, "public");
const distDir = path.join(rootDir, "dist");

console.log("Preparing build artifacts in dist/...");

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

// 4. Ensure an index.html exists in dist/ for static hosts / preview
const distIndexPath = path.join(distDir, "index.html");
if (!fs.existsSync(distIndexPath)) {
  // Find primary JS and CSS bundles in dist/assets
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

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Paragon OEE FRO Dashboard Prototype</title>
    <meta name="description" content="Clickable Paragon OEE FRO dashboard prototype for Shift Leader and Section Head." />
    <link rel="icon" href="/favicon.ico" type="image/x-icon" />
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

  fs.writeFileSync(distIndexPath, htmlContent, "utf-8");
  console.log("Created dist/index.html fallback for static deployment");
}

console.log("Build artifacts successfully prepared in dist/.");
