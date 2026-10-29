// Renders public/og.png (social share image) and src/app/apple-icon.png.
// Run after changing the brand name in src/config/site.ts:  npm run og
// Uses the Playwright Chromium (set PLAYWRIGHT_CHROMIUM_PATH if it isn't found).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = readFileSync(path.join(root, "src/config/site.ts"), "utf8");
const brand = /name:\s*"([^"]+)"/.exec(site)?.[1] ?? "SMART Voice";
const fonts = path.join(root, "node_modules/@fontsource-variable/heebo/files");
// Inline the fonts: a page loaded with setContent can't read file:// URLs.
const font = (file) => `data:font/woff2;base64,${readFileSync(path.join(fonts, file)).toString("base64")}`;
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

const bars = [40, 90, 150, 230, 170, 110, 200, 130, 70, 160, 90, 50]
  .map((h) => `<i style="height:${h}px;opacity:${(0.35 + h / 400).toFixed(2)}"></i>`)
  .join("");
const mark = `<svg viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#1f3a2a"/><g fill="#bfe08f"><rect x="7" y="12.5" width="3" height="7" rx="1.5"/><rect x="12" y="8.5" width="3" height="15" rx="1.5"/><rect x="17" y="11" width="3" height="10" rx="1.5"/><rect x="22" y="13.5" width="3" height="5" rx="1.5"/></g></svg>`;

const og = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
@font-face{font-family:H;src:url(${font("heebo-hebrew-wght-normal.woff2")}) format('woff2');font-weight:100 900}
@font-face{font-family:L;src:url(${font("heebo-latin-wght-normal.woff2")}) format('woff2');font-weight:100 900}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;font-family:H,L,sans-serif;background:radial-gradient(900px 500px at 85% -10%,rgba(191,224,143,.18),transparent 60%),radial-gradient(700px 400px at 0% 110%,rgba(143,207,116,.12),transparent 60%),#12221a;color:#eef3ea;position:relative;overflow:hidden}
.wrap{position:absolute;inset:0;padding:72px 80px;display:flex;flex-direction:column}
.logo{display:flex;align-items:center;gap:14px;font-weight:800;font-size:30px;font-family:L,H}.logo svg{width:52px;height:52px}
h1{margin-top:56px;font-size:84px;line-height:1.05;font-weight:800;letter-spacing:-1px}h1 span{color:#bfe08f}
p{margin-top:28px;font-size:30px;color:#b8c6b5;max-width:700px;line-height:1.4}
.chips{margin-top:auto;display:flex;gap:14px}.chip{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);border-radius:999px;padding:12px 24px;font-size:24px;color:#dfe7da}
.bars{position:absolute;left:90px;top:170px;display:flex;align-items:center;gap:12px;height:240px}.bars i{display:block;width:16px;border-radius:8px;background:#bfe08f}
</style></head><body><div class="bars">${bars}</div><div class="wrap">
<div class="logo">${mark}<span dir="ltr">${esc(brand)}</span></div>
<h1>הטלפון מצלצל.<br><span>הנציגה כבר עונה.</span></h1>
<p>נציגת AI טלפונית בעברית: עונה 24/7, קובעת תורים ומעדכנת יומן, וואטסאפ ו-CRM.</p>
<div class="chips"><div class="chip">מענה 24/7</div><div class="chip">מספר ישראלי</div><div class="chip">בלי דמי הקמה</div></div>
</div></body></html>`;

const icon = `<!doctype html><html><head><style>*{margin:0}body{width:180px;height:180px;background:#12221a;display:grid;place-items:center}</style></head><body>${mark.replace('<rect width="32" height="32" rx="9" fill="#1f3a2a"/>', "").replace("<svg ", '<svg width="120" height="120" ')}</body></html>`;

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
for (const [html, out, width, height] of [
  [og, "public/og.png", 1200, 630],
  [icon, "src/app/apple-icon.png", 180, 180],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(root, out) });
  console.log("wrote", out);
}
await browser.close();
