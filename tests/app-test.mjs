// 10개 페이지를 3개 화면 크기로 열고, 콘솔 오류·가로 넘침·과학 계산을 점검하고 스크린샷을 남긴다.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2]);
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".md": "text/plain" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

const PAGES = ["index", "g1-insulation", "g1-heating", "g1-sound", "g2-gas", "g2-photosynthesis", "g2-solar", "g3-energy", "g3-dewpoint", "g3-equation"];
const VIEWS = { mobile: { width: 380, height: 800 }, laptop: { width: 1280, height: 800 }, classroom: { width: 1920, height: 1080 } };
const url = p => p === "index" ? `${BASE}/index.html` : `${BASE}/apps/${p}.html`;
const results = [];
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: !!ok, detail }); };

const browser = await chromium.launch();
async function openPage(ctx, p) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
  page.on("pageerror", e => errors.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", r => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", r => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });
  await page.goto(url(p), { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  return { page, errors };
}
async function overflow(page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")].filter(el => {
      const r = el.getBoundingClientRect(); return r.width > 0 && r.right > W + 1 && getComputedStyle(el).position !== "fixed";
    }).slice(0, 5).map(el => `${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].join(".")} right=${Math.round(el.getBoundingClientRect().right)}`);
    return { scroll: document.documentElement.scrollWidth, W, wide };
  });
}

// 페이지별 조작 시나리오 (조작 후 스크린샷)
const ACT = {
  "g1-insulation": async pg => { await pg.click("#run"); await pg.waitForTimeout(2500); await pg.fill("#memo", "차이 벌어짐"); await pg.click("#addMemo"); },
  "g1-heating": async pg => { await pg.selectOption("#spd", "60"); await pg.click("#heat"); await pg.waitForTimeout(3500); },
  "g1-sound": async pg => { await pg.check("#use2"); await pg.click(".keys .btn >> nth=3"); },
  "g2-gas": async pg => { for (const v of [60, 30, 20]) { await pg.$eval("#vol", (el, v) => { el.value = v; el.dispatchEvent(new Event("input")); }, v); await pg.fill("#pred", String(60 / v + 0.2)); await pg.click("#measure"); } await pg.check("#curve"); await pg.waitForTimeout(2100); },
  "g2-photosynthesis": async pg => { await pg.click("#run"); await pg.waitForTimeout(2500); await pg.click("#slopeAll"); await pg.click("#save"); },
  "g2-solar": async pg => { await pg.$eval("#day", el => { el.value = 7.4; el.dispatchEvent(new Event("input")); }); },
  "g3-energy": async pg => { await pg.click("#go"); await pg.waitForTimeout(1800); },
  "g3-dewpoint": async pg => { await pg.fill("#pred", "14"); await pg.click("#cool"); await pg.waitForTimeout(8500); },
  "g3-equation": async pg => { await pg.click('.st button[data-i="0"][data-d="1"]'); await pg.click('.st button[data-i="2"][data-d="1"]'); await pg.waitForTimeout(600); },
};

for (const [vname, vp] of Object.entries(VIEWS)) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, acceptDownloads: true });
  for (const p of PAGES) {
    const { page, errors } = await openPage(ctx, p);
    const ov = await overflow(page);
    await page.screenshot({ path: `${OUT}/${vname}-${p}.png`, fullPage: vname === "mobile" });
    if (ACT[p]) { try { await ACT[p](page); } catch (e) { errors.push("[act] " + e.message.split("\n")[0]); } await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${vname}-${p}-after.png`, fullPage: false }); }
    // 기록장 저장·내려받기
    if (p !== "index" && vname === "laptop") {
      await page.fill("#n1", "예측 테스트"); await page.click("#noteSave");
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 3000 }).catch(() => null), page.click("#noteDown")]);
      check(`${p}: 기록 내려받기`, dl && (await dl.suggestedFilename()).endsWith(".txt"));
      await page.reload({ waitUntil: "networkidle" });
      check(`${p}: 기록 저장 후 새로고침 유지`, (await page.inputValue("#n1")) === "예측 테스트");
      await page.click("#noteClear");
    }
    const ov2 = await overflow(page);
    results.push({ view: vname, page: p, errors: [...errors], overflow: ov.scroll > ov.W || ov2.scroll > ov2.W ? [ov, ov2] : null });
    await page.close();
  }
  await ctx.close();
}

// ---------- 과학 계산 점검 ----------
const ctx = await browser.newContext({ viewport: VIEWS.laptop });
async function evalOn(p, fn) { const { page, errors } = await openPage(ctx, p); const r = await page.evaluate(fn); await page.close(); return { r, errors }; }
async function withPage(p, fn) { const { page, errors } = await openPage(ctx, p); let r; try { r = await fn(page); } catch (e) { check(`${p}: 시나리오 실행`, false, e.message.split("\n")[0]); } await page.close(); if (errors.length) check(`${p}: 시나리오 중 오류 없음`, false, errors.join(" | ")); return r; }

{ const { r } = await evalOn("g2-gas", "[P(60), P(30), P(15)]"); check("보일 법칙 60→30→15 mL = 1→2→4기압", r[0] === 1 && r[1] === 2 && r[2] === 4, JSON.stringify(r)); }
{ const { r } = await evalOn("g3-dewpoint", "[sat(0), sat(10), sat(20), sat(25), sat(30), dewOf(sat(15))]");
  check("포화 수증기량 0/10/20/25/30 ℃ ≈ 4.8/9.4/17.3/23.0/30.4 g/m³", Math.abs(r[0] - 4.85) < .15 && Math.abs(r[1] - 9.4) < .2 && Math.abs(r[2] - 17.3) < .2 && Math.abs(r[3] - 23.0) < .2 && Math.abs(r[4] - 30.4) < .3, r.map(v => v.toFixed(2)).join(", "));
  check("이슬점 역산 (15 ℃ 포화량 → 15 ℃)", Math.abs(r[5] - 15) < 0.01, r[5].toFixed(3)); }
{ const { r } = await evalOn("g1-heating", "[Q_melt0, Q_melt1 - Q_melt0, Q_boil0 - Q_melt1, Q_boil1 - Q_boil0]");
  check("가열: 얼음 −20→0 4.2 kJ, 융해 33.4 kJ, 물 0→100 41.8 kJ, 기화 226 kJ", r[0] === 4200 && r[1] === 33400 && Math.abs(r[2] - 41800) < 1 && r[3] === 226000, r.join(", ")); }
{ const { r } = await evalOn("g1-sound", "[1000/262, 340/262*100]"); check("도(262 Hz) 주기 3.82 ms, 파장 130 cm", Math.abs(r[0] - 3.817) < .01 && Math.round(r[1]) === 130, r.join(", ")); }
{ const { r } = await evalOn("g2-photosynthesis", "d=30; dark=false; const a=rate(); d=10; const b=rate(); d=100; const c=rate(); dark=true; const e=rate(); [a,b,c,e]");
  check("광합성: 가까울수록 CO₂ 더 빨리 감소, 100 cm·어둠에서는 증가", r[1] < r[0] && r[0] < 0 && r[2] > 0 && r[3] > 0, r.map(v => v.toFixed(1)).join(", ")); }
await withPage("g2-solar", async pg => {
  const at = async d => { await pg.$eval("#day", (el, d) => { el.value = d; el.dispatchEvent(new Event("input")); }, d); return [await pg.textContent("#phaseNow"), await pg.textContent("#litSide")]; };
  const q1 = await at(7.4), full = await at(14.8), q3 = await at(22.1), cr = await at(3.5), wn = await at(26);
  check("달: 상현달(7.4일) 오른쪽 밝음", q1[0] === "상현달" && q1[1] === "오른쪽", q1.join("/"));
  check("달: 하현달(22.1일) 왼쪽 밝음", q3[0] === "하현달" && q3[1] === "왼쪽", q3.join("/"));
  check("달: 보름달(14.8일), 초승달 오른쪽, 그믐달 왼쪽", full[0] === "보름달" && cr[0] === "초승달" && cr[1] === "오른쪽" && wn[0] === "그믐달" && wn[1] === "왼쪽", [full, cr, wn].join(" | "));
  // 위에서 본 달 위치: 7.4일에 화면 아래(북극 위에서 본 반시계), 달 그림의 밝은 픽셀이 원 오른쪽에 있는지
  await at(7.4);
  const px = await pg.evaluate(() => { const c = document.getElementById("c"), k = c.width / 760;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const lum = (x, y) => { const i = (Math.round(y * k) * c.width + Math.round(x * k)) * 4; return d[i] + d[i + 1] + d[i + 2]; };
    return { right: lum(600 + 60, 195), left: lum(600 - 60, 195) }; });
  check("달 그림: 상현달 픽셀이 오른쪽만 밝음", px.right > 600 && px.left < 300, JSON.stringify(px));
  // 재생하면 날짜가 실제로 앞으로 가는지
  await pg.$eval("#day", el => { el.value = 0; el.dispatchEvent(new Event("input")); });
  await pg.click("#playM"); await pg.waitForTimeout(1500); await pg.click("#playM");
  const d = +(await pg.inputValue("#day")); check("달 재생 시 날짜 진행", d > 1.5, `1.5초 후 ${d}일`);
  await pg.click("#tabPlanet"); await pg.click("#playP"); await pg.waitForTimeout(1500); await pg.click("#playP");
  const dd = +(await pg.inputValue("#days")); check("행성 재생 시 날짜 진행", dd > 30, `1.5초 후 ${dd}일`);
});
await withPage("g3-energy", async pg => {
  // 마찰 없음: 역학적 에너지 보존, 언덕이 더 높으면 넘지 못함
  await pg.$eval("#hh", el => { el.value = 9; el.dispatchEvent(new Event("input")); });
  await pg.selectOption("#spd", "1"); await pg.click("#go");
  let maxX = 0, maxErr = 0;
  for (let i = 0; i < 25; i++) { await pg.waitForTimeout(120); const s = await pg.evaluate(() => { const st = stateTrack(); return { x, E: m * g * st.h + 0.5 * m * st.v * st.v, E0: Etotal() }; }); maxX = Math.max(maxX, s.x); maxErr = Math.max(maxErr, Math.abs(s.E - s.E0) / s.E0); }
  check("트랙: 마찰 없을 때 역학적 에너지 보존 (오차 0.5% 미만)", maxErr < 0.005, `최대 오차 ${(maxErr * 100).toFixed(3)}%`);
  check("트랙: 출발 8 m < 언덕 9 m → 언덕 꼭대기(12 m)를 넘지 못함", maxX < 12, `최대 x = ${maxX.toFixed(2)} m`);
  // 마찰: 멈추지 않고 출발, 에너지 합(역학적+열) 보존
  await pg.click("#reset"); await pg.check("#fric"); await pg.click("#go"); await pg.waitForTimeout(1500);
  const f = await pg.evaluate(() => { const st = stateTrack(); return { x, sum: m * g * st.h + 0.5 * m * st.v * st.v + st.heat, E0: Etotal(), heat: st.heat }; });
  check("트랙: 마찰 켜도 출발하고, 역학적+열 에너지 = 처음 에너지", f.x > 1 && f.heat > 0 && Math.abs(f.sum - f.E0) / f.E0 < 0.005, JSON.stringify(f));
  // 진자
  await pg.click("#tabP"); await pg.selectOption("#spd", "1"); await pg.click("#go");
  let pErr = 0; for (let i = 0; i < 15; i++) { await pg.waitForTimeout(150); const s = await pg.evaluate(() => { const st = statePend(); return (m * g * st.h + 0.5 * m * st.v * st.v) / Etotal(); }); pErr = Math.max(pErr, Math.abs(s - 1)); }
  check("진자: 공기 저항 없을 때 역학적 에너지 보존 (오차 1% 미만)", pErr < 0.01, `최대 오차 ${(pErr * 100).toFixed(3)}%`);
});
await withPage("g3-equation", async pg => {
  const setC = async arr => { await pg.evaluate(a => { coef = a; render(); }, arr); return pg.textContent("#vd"); };
  check("반응식: 2H₂ + O₂ → 2H₂O 균형", (await setC([2, 1, 2])).includes("균형이 맞았어요"));
  check("반응식: 4H₂ + 2O₂ → 4H₂O 는 약분 안내", (await setC([4, 2, 4])).includes("나눌 수 있어요"));
  await pg.selectOption("#rx", "4");
  check("반응식: CH₄ + 2O₂ → CO₂ + 2H₂O 균형", (await setC([1, 2, 1, 2])).includes("균형이 맞았어요"));
  await pg.selectOption("#rx", "2");
  check("반응식: N₂ + 3H₂ → 2NH₃ 균형", (await setC([1, 3, 2])).includes("균형이 맞았어요"));
  // 키보드로 계수 조작 (포커스 유지)
  await pg.selectOption("#rx", "0"); await pg.focus('.st button[data-i="0"][data-d="1"]'); await pg.keyboard.press("Enter"); await pg.keyboard.press("Enter");
  check("반응식: 키보드 Enter 연속 조작 시 포커스 유지", (await pg.evaluate(() => coef[0])) === 3);
});
await withPage("g1-heating", async pg => {
  await pg.selectOption("#spd", "60"); await pg.$eval("#pw", el => { el.value = 300; el.dispatchEvent(new Event("input")); });
  await pg.click("#heat"); await pg.waitForTimeout(4000); await pg.click("#heat");
  const r = await pg.evaluate(() => ({ marks, pts: pts.filter(p => p[0] > marks.m0 + 2 && p[0] < (marks.m1 ?? t) - 2).map(p => p[1]) }));
  check("가열: 융해 구간 동안 온도 0 ℃ 유지, 구간 길이 = 33400 J / 300 W ≈ 111 s", r.marks.m1 != null && r.pts.every(T => T === 0) && Math.abs(r.marks.m1 - r.marks.m0 - 111.3) < 1, JSON.stringify(r.marks));
});
await withPage("g3-dewpoint", async pg => {
  await pg.fill("#pred", "14"); await pg.click("#cool"); await pg.waitForTimeout(9000);
  const txt = await pg.textContent("#res"); const dp = await pg.evaluate(() => dewOf(12));
  check("이슬점: 25 ℃·12 g/m³ → 이슬점 약 14 ℃에서 이슬, 보고값 = 이슬점", txt.includes(dp.toFixed(1)) && Math.abs(dp - 14.1) < 0.4, `${txt} / dp=${dp.toFixed(2)}`);
});
await withPage("g1-insulation", async pg => {
  await pg.click("#run"); await pg.waitForTimeout(1500);
  await pg.selectOption("#selB", "wool");
  check("단열: 실험 중 조건을 바꾸면 처음부터", (await pg.evaluate(() => t)) === 0);
});
await ctx.close();

// 동작 줄이기 설정에서도 오류 없이 열리는지
{
  const rctx = await browser.newContext({ viewport: VIEWS.laptop, reducedMotion: "reduce" });
  for (const p of PAGES) {
    const { page, errors } = await openPage(rctx, p);
    const red = p === "index" ? true : await page.evaluate(() => SIH.reduced);
    check(`동작 줄이기: ${p} 오류 없음·감지`, errors.length === 0 && red, errors.join(" | "));
    await page.close();
  }
  // 키보드 포커스 표시
  const { page } = await openPage(rctx, "g1-sound");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  const fo = await page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, outline: getComputedStyle(a).outlineStyle + " " + getComputedStyle(a).outlineWidth }; });
  check("키보드 Tab 이동 시 포커스 테두리 표시", fo.outline.startsWith("solid") && fo.outline.includes("3px"), JSON.stringify(fo));
  await page.screenshot({ path: `${OUT}/focus-g1-sound.png` });
  await rctx.close();
}

await browser.close(); server.close();
const errCount = results.reduce((s, r) => s + r.errors.length, 0);
console.log("=== 페이지 × 화면 ===");
for (const r of results) console.log(`${r.errors.length ? "✗" : "✓"} ${r.view.padEnd(9)} ${r.page.padEnd(18)} 오류 ${r.errors.length}${r.overflow ? "  가로넘침 " + JSON.stringify(r.overflow) : ""}${r.errors.length ? "\n    " + r.errors.join("\n    ") : ""}`);
console.log(`\n콘솔·페이지 오류 합계: ${errCount}, 가로 넘침: ${results.filter(r => r.overflow).length}`);
console.log("\n=== 기능·과학 점검 ===");
for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? "  — " + c.detail : ""}`);
console.log(`\n점검 ${checks.filter(c => c.ok).length}/${checks.length} 통과`);
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ results, checks }, null, 2));
