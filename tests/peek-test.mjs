// 선생님 화면의 "학생 화면 보기" 옆 패널을 1920/1200/380 에서 점검한다 (데모 모드).
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
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
for (const [vn, vp] of Object.entries({ classroom: { width: 1920, height: 1080 }, laptop: { width: 1200, height: 860 }, mobile: { width: 380, height: 820 } })) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage(); const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });
  await page.goto(BASE + "/teacher.html?demo=1", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  // 데모 로그인 → 책장 만들기
  if (await page.$("#loginBtn")) { await page.click("#loginBtn"); await page.waitForTimeout(800); }
  if (await page.$("#fr-school")) {
    await page.fill("#fr-school", "서울과학중학교"); await page.fill("#fr-name", "김선생"); await page.fill("#fr-title", "2학년 책장");
    await page.click("#fr-create"); await page.waitForTimeout(800);
  }
  await page.waitForSelector("[data-a=peek]", { timeout: 5000 });
  const url0 = await page.evaluate(() => document.querySelector(".shelf-card .meta").textContent);
  check(`${vn}: 공개 주소가 이 사이트의 shelf.html 을 가리킴`, /shelf\.html\?code=/.test(url0), url0);
  await page.click("[data-a=peek]"); await page.waitForTimeout(500);
  const s1 = await page.evaluate(() => ({ hidden: document.getElementById("peek").hidden, on: document.getElementById("peek").classList.contains("on"),
    src: document.getElementById("peekFrame").src, focus: document.activeElement && document.activeElement.id,
    w: document.getElementById("peek").getBoundingClientRect().width, W: innerWidth,
    wrapRight: document.querySelector(".wrap.narrow").getBoundingClientRect().right, scrollW: document.documentElement.scrollWidth }));
  check(`${vn}: 패널이 열림`, !s1.hidden && s1.on);
  check(`${vn}: 패널 iframe 이 shelf.html?code= 를 가리킴`, /shelf\.html\?code=[A-Z0-9-]+&demo=1$/.test(s1.src), s1.src);
  check(`${vn}: 닫기 단추에 포커스`, s1.focus === "peekClose", s1.focus);
  check(`${vn}: 가로 넘침 없음`, s1.scrollW <= s1.W + 1, `${s1.scrollW} > ${s1.W}`);
  if (vn === "mobile") check(`${vn}: 패널이 화면 전체`, Math.abs(s1.w - s1.W) < 2, `${s1.w}/${s1.W}`);
  if (vn === "classroom") check(`${vn}: 본문이 패널에 가려지지 않음`, s1.wrapRight <= s1.W - s1.w + 1, `${s1.wrapRight} vs ${s1.W - s1.w}`);
  // iframe 안에 책장이 그려졌는지
  const frame = page.frames().find((f) => f.url().includes("shelf.html"));
  await frame.waitForSelector(".row-label h2", { timeout: 6000 }).catch(() => {});
  const inner = await frame.evaluate(() => ({ rows: document.querySelectorAll(".row-label h2").length, html: document.body.innerHTML }));
  check(`${vn}: 패널 안에 책장 서가가 그려짐`, inner.rows >= 3, String(inner.rows));
  check(`${vn}: 패널 안에 모둠원 이름 없음`, !/김하늘|이서준/.test(inner.html));
  await page.screenshot({ path: `${OUT}/${vn}-peek.png` });
  if (vn !== "mobile") {
    await page.click("#peekWide"); await page.waitForTimeout(400);
    const w2 = await page.evaluate(() => document.getElementById("peek").getBoundingClientRect().width);
    check(`${vn}: 넓게 보기로 폭이 커짐`, w2 > s1.w + 100, `${s1.w} → ${w2}`);
    await page.screenshot({ path: `${OUT}/${vn}-peek-wide.png` });
    await page.click("#peekWide"); await page.waitForTimeout(300);
  }
  // 승인 뒤 자동 새로 고침: 대기 책 승인 → iframe 이 다시 로드됨
  const srcBefore = await page.evaluate(() => document.getElementById("peekFrame").src);
  let reloaded = false; page.on("framenavigated", (f) => { if (f.url().includes("shelf.html")) reloaded = true; });
  // 휴대전화에서는 패널이 화면 전체라 본문을 누를 수 없다(의도한 동작). 넓은 화면에서만 승인해 본다.
  const approve = vn === "mobile" ? null : await page.$("[data-a=approveAll]");
  if (approve) {
    const box = await approve.boundingBox(); const pw = await page.evaluate(() => document.getElementById("peek").getBoundingClientRect().left);
    check(`${vn}: 승인 단추가 패널에 가려지지 않음`, box && box.x + box.width <= pw + 1, `${box && (box.x + box.width)} vs ${pw}`);
    await approve.click(); await page.waitForTimeout(900);
  }
  check(`${vn}: 승인 뒤 패널이 다시 로드됨`, !approve || reloaded, srcBefore);
  // Esc 로 닫기
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  const s2 = await page.evaluate(() => ({ hidden: document.getElementById("peek").hidden, focus: document.activeElement && document.activeElement.dataset.a, peeking: document.body.classList.contains("peeking") }));
  check(`${vn}: Esc 로 닫힘`, s2.hidden && !s2.peeking);
  check(`${vn}: 닫으면 포커스가 단추로 돌아감`, s2.focus === "peek", String(s2.focus));
  check(`${vn}: 콘솔 오류 0`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
const fail = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - fail}/${checks.length} 통과`);
process.exit(fail ? 1 : 0);
