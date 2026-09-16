// 학생 화면의 책장 코드 입력 칸을 점검한다 (데모 모드, 1200/380).
import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const ROOT = path.resolve(process.argv[2]); const OUT = process.argv[3]; fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const checks = []; const check = (n, ok, d = "") => { checks.push({ n, ok: !!ok }); if (!ok) console.log("   ✗ " + n + (d ? " — " + d : "")); };
const browser = await chromium.launch();
for (const [vn, vp] of Object.entries({ laptop: { width: 1200, height: 860 }, mobile: { width: 380, height: 820 } })) {
  const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage(); const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });
  const noOverflow = async (n) => { const o = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); check(`${vn}: ${n} 가로 넘침 없음`, o[0] <= o[1] + 1, o.join(">")); };

  await page.goto(BASE + "/shelf.html?demo=1", { waitUntil: "networkidle" }); await page.waitForTimeout(300);
  check(`${vn}: 코드 없이 들어오면 입력 칸`, await page.$("#codeInput") !== null);
  check(`${vn}: 안내 제목 유지`, (await page.textContent("#notice")).includes("책장 코드를 받으세요"));
  await noOverflow("코드 입력 화면");
  await page.screenshot({ path: `${OUT}/${vn}-code-entry.png` });
  // 빈 채로 제출
  await page.click("#codeForm button"); await page.waitForTimeout(200);
  check(`${vn}: 빈 코드는 오류 안내`, !(await page.evaluate(() => document.getElementById("codeErr").hidden)) && page.url().includes("shelf.html?demo=1"));
  // 소문자·공백 섞어 입력
  await page.fill("#codeInput", " demo-2026-book "); await page.keyboard.press("Enter");
  await page.waitForURL(/code=DEMO-2026-BOOK/, { timeout: 5000 }).catch(() => {});
  check(`${vn}: 입력한 코드로 책장이 열림 (대문자 정리)`, page.url().includes("shelf.html?code=DEMO-2026-BOOK&demo=1"), page.url());
  await page.waitForSelector(".row-label h2", { timeout: 6000 }).catch(() => {});
  check(`${vn}: 책장이 그려짐`, (await page.$$(".row-label h2")).length >= 3);
  // 다시 코드 없이 들어오면 미리 채워짐
  await page.goto(BASE + "/shelf.html?demo=1", { waitUntil: "networkidle" }); await page.waitForTimeout(300);
  check(`${vn}: 지난 코드가 미리 채워짐`, (await page.inputValue("#codeInput")) === "DEMO-2026-BOOK");
  // 없는 코드
  await page.goto(BASE + "/shelf.html?code=NOPE-2026-XXXX&demo=1", { waitUntil: "networkidle" }); await page.waitForTimeout(400);
  check(`${vn}: 없는 코드면 안내 + 다시 입력 칸`, (await page.textContent("#notice")).includes("책장이 없어요") && (await page.getAttribute("#codeInput", "aria-invalid")) === "true");
  await page.screenshot({ path: `${OUT}/${vn}-code-wrong.png` });
  // 제출 폼도 같은 흐름
  await page.goto(BASE + "/submit.html?demo=1", { waitUntil: "networkidle" }); await page.waitForTimeout(300);
  check(`${vn}: 제출 폼도 코드 입력 칸`, await page.$("#codeInput") !== null && (await page.inputValue("#codeInput")) === "DEMO-2026-BOOK");
  await page.click("#codeForm button");
  await page.waitForURL(/submit\.html\?code=DEMO-2026-BOOK/, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  check(`${vn}: 제출 폼이 열림`, page.url().includes("submit.html?code=DEMO-2026-BOOK&demo=1") && !(await page.evaluate(() => document.getElementById("form").hidden)));
  check(`${vn}: 콘솔 오류 0`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
const fail = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - fail}/${checks.length} 통과`); process.exit(fail ? 1 : 0);
