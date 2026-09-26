// 홈 화면 앱(manifest·아이콘)과 선생님 첫 화면·둘러보기를 점검한다 (데모 모드).
import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const ROOT = path.resolve(process.argv[2]); const OUT = process.argv[3]; fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const checks = []; const check = (n, ok, d = "") => { checks.push({ n, ok: !!ok }); if (!ok) console.log("   ✗ " + n + (d ? " — " + d : "")); };
const browser = await chromium.launch();

/* 1) manifest 와 아이콘 */
{
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(BASE + "/index.html");
  for (const [role, pages, start] of [["student", ["shelf.html", "submit.html", "worksheet.html"], "shelf.html?source=pwa"], ["teacher", ["teacher.html"], "teacher.html"]]) {
    const file = `manifest-${role}.webmanifest`;
    let m = null; try { m = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")); } catch (e) { /* 아래에서 실패로 기록 */ }
    check(`${role}: manifest 가 JSON 으로 읽힘`, !!m);
    if (!m) continue;
    check(`${role}: 이름·시작 주소·표시 방식`, m.name && m.short_name && m.short_name.length <= 12 && m.start_url === start && m.display === "standalone" && m.scope === "./", JSON.stringify([m.short_name, m.start_url]));
    check(`${role}: 모든 경로가 상대 경로`, [m.start_url, m.scope, ...m.icons.map((i) => i.src)].every((u) => !/^(\/|https?:)/.test(u)));
    check(`${role}: 192·512 아이콘과 maskable 아이콘`, ["192x192", "512x512"].every((s) => m.icons.some((i) => i.sizes === s && i.purpose === "any")) && m.icons.some((i) => i.purpose === "maskable"));
    for (const ic of m.icons) {
      const w = await page.evaluate(async (src) => { const i = new Image(); i.src = src; try { await i.decode(); } catch (e) { return 0; } return i.naturalWidth === i.naturalHeight ? i.naturalWidth : -1; }, `${BASE}/${ic.src}`);
      check(`${role}: ${ic.src} 크기가 적힌 대로`, `${w}x${w}` === ic.sizes, String(w));
    }
    for (const pg of pages) {
      const html = fs.readFileSync(path.join(ROOT, pg), "utf8");
      check(`${pg}: ${role} manifest 연결`, html.includes(`<link rel="manifest" href="${file}">`));
      const touch = (html.match(/rel="apple-touch-icon" href="([^"]+)"/) || [])[1];
      check(`${pg}: 아이폰용 아이콘 파일이 있음`, touch && fs.existsSync(path.join(ROOT, touch)), touch);
      check(`${pg}: theme-color`, /<meta name="theme-color"/.test(html));
    }
  }
  // 크롬이 실제로 읽은 manifest 에 오류가 없는지
  for (const pg of ["shelf.html?demo=1", "teacher.html?demo=1"]) {
    await page.goto(`${BASE}/${pg}`, { waitUntil: "load" });
    const cdp = await ctx.newCDPSession(page);
    const got = await cdp.send("Page.getAppManifest").catch((e) => ({ errors: [{ message: e.message }] }));
    check(`${pg}: 브라우저가 manifest 를 오류 없이 읽음`, got.url && !(got.errors || []).length, JSON.stringify(got.errors || []).slice(0, 200));
  }
  await ctx.close();
}

/* 2) 앱 아이콘으로 열면 지난 책장이 바로 열린다 */
{
  const ctx = await browser.newContext({ viewport: { width: 380, height: 820 } }); const page = await ctx.newPage();
  await page.goto(BASE + "/shelf.html?source=pwa&demo=1", { waitUntil: "networkidle" }); await page.waitForTimeout(300);
  check("앱 첫 실행: 기억된 코드가 없으면 코드 입력 칸", await page.$("#codeInput") !== null && !page.url().includes("code="));
  await page.goto(BASE + "/shelf.html?code=DEMO-2026-BOOK&demo=1", { waitUntil: "networkidle" });
  await page.waitForSelector(".row-label h2", { timeout: 6000 }).catch(() => {});
  await page.goto(BASE + "/shelf.html?source=pwa&demo=1", { waitUntil: "load" });
  await page.waitForURL(/code=DEMO-2026-BOOK/, { timeout: 5000 }).catch(() => {});
  check("앱 다시 실행: 지난 책장이 바로 열림", page.url().includes("code=DEMO-2026-BOOK&demo=1"), page.url());
  await page.waitForSelector(".row-label h2", { timeout: 6000 }).catch(() => {});
  check("앱 다시 실행: 책장이 그려짐", (await page.$$(".row-label h2")).length >= 3);
  await page.goto(BASE + "/shelf.html?demo=1", { waitUntil: "networkidle" }); await page.waitForTimeout(300);
  check("브라우저로 코드 없이 오면 예전처럼 입력 칸", await page.$("#codeInput") !== null);
  check("학생 화면에는 선생님 화면 링크가 없음", !(await page.$('a[href^="teacher.html"]')));
  await ctx.close();
}

/* 3) 선생님 둘러보기 */
for (const [vn, vp] of Object.entries({ laptop: { width: 1200, height: 860 }, mobile: { width: 380, height: 820 } })) {
  const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage(); const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });
  const noOverflow = async (n) => { const o = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); check(`${vn}: ${n} 가로 넘침 없음`, o[0] <= o[1] + 1, o.join(">")); };
  await page.goto(BASE + "/teacher.html?demo=1&tour=1", { waitUntil: "networkidle" });
  await page.waitForSelector(".shelf-card[data-s]", { timeout: 8000 }).catch(() => {});
  check(`${vn}: 둘러보기는 로그인 없이 책장 화면이 뜸`, await page.$(".shelf-card[data-s]") !== null);
  check(`${vn}: 둘러보기 띠와 '내 책장 만들기'`, (await page.textContent("#demoBar")).includes("둘러보기") && (await page.getAttribute("#tourExit", "href")) === "teacher.html");
  check(`${vn}: 둘러보기에는 관리자 카드가 없음`, await page.$("#adminCard") === null);
  check(`${vn}: 둘러보기 끝 안내 카드`, (await page.textContent("#tourCard")).includes("사용 신청"));
  check(`${vn}: 로그아웃 단추가 '둘러보기 끝내기'`, (await page.textContent("#logout")).trim() === "둘러보기 끝내기");
  await noOverflow("둘러보기");
  await page.screenshot({ path: `${OUT}/${vn}-tour.png`, fullPage: true });
  // 승인 단추를 눌러 볼 수 있다
  const before = await page.$$eval('[data-a="approve"]', (b) => b.length);
  if (before) { await page.click('[data-a="approve"]'); await page.waitForTimeout(600); }
  check(`${vn}: 둘러보기에서 책 승인이 됨`, before > 0 && await page.$("#tourCard") !== null);
  await page.click("#logout"); await page.waitForLoadState("load");
  check(`${vn}: 끝내면 선생님 첫 화면으로`, /teacher\.html$/.test(page.url()), page.url());
  check(`${vn}: 둘러보기 콘솔 오류 없음`, !errors.length, errors.join(" | ").slice(0, 300));
  await ctx.close();
}

await browser.close(); server.close();
const bad = checks.filter((c) => !c.ok);
console.log(`\n홈 화면 앱·둘러보기 검사: ${checks.length - bad.length}/${checks.length} 통과`);
if (bad.length) process.exit(1);
