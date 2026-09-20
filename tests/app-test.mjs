// 12개 페이지를 3개 화면 크기로 열고, 콘솔 오류·가로 넘침·과학 계산을 점검하고 스크린샷을 남긴다.
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

const PAGES = ["index", "g1-insulation", "g1-heating", "g1-sound", "g1-sound-lab", "g1-color", "g2-gas", "g2-photosynthesis", "g2-solar", "g3-energy", "g3-dewpoint", "g3-equation"];
const VIEWS = { mobile: { width: 380, height: 800 }, laptop: { width: 1280, height: 800 }, classroom: { width: 1920, height: 1080 } };
const url = p => p === "index" ? `${BASE}/index.html` : `${BASE}/apps/${p}.html`;
const results = [];
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: !!ok, detail }); };

const browser = await chromium.launch();
async function openPage(ctx, p) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", m => { if ((m.type() === "error" || m.type() === "warning") && !m.text().includes("willReadFrequently")) errors.push(`[${m.type()}] ${m.text()}`); });   // willReadFrequently: 이 검사가 화소를 여러 번 읽어서 나는 안내
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
  "g1-sound-lab": async pg => { await pg.click('.keys .btn[data-f="392"]'); await pg.click("#capA"); await pg.click("#tabSpec"); },
  "g1-color": async pg => { await pg.selectOption("#target", "100,100,100"); await pg.selectOption("#pred", "흰색"); await pg.click("#measure");
    await pg.click("#tabObj"); await pg.selectOption("#obj", "banana"); await pg.click('#lampBtns [data-l="100,0,0"]'); await pg.selectOption("#pred", "노랑"); await pg.click("#measure"); },
  "g2-gas": async pg => { for (const v of [60, 30, 20]) { await pg.$eval("#vol", (el, v) => { el.value = v; el.dispatchEvent(new Event("input")); }, v); await pg.selectOption("#pred", "up"); await pg.click("#measure"); } await pg.check("#curve"); await pg.waitForTimeout(2100);
    await pg.click("#tabTV"); for (const v of [0, 40, 80]) { await pg.$eval("#tmp", (el, v) => { el.value = v; el.dispatchEvent(new Event("input")); }, v); await pg.selectOption("#predV", "up"); await pg.click("#measureV"); } await pg.check("#line"); await pg.waitForTimeout(1500); },
  "g2-photosynthesis": async pg => { await pg.click("#run"); await pg.waitForTimeout(2500); await pg.click("#slopeAll"); await pg.click("#save"); },
  "g2-solar": async pg => { await pg.$eval("#day", el => { el.value = 7.4; el.dispatchEvent(new Event("input")); });
    await pg.click("#tabEcl"); await pg.$eval("#lun", el => { el.value = 2; el.dispatchEvent(new Event("input")); }); await pg.selectOption("#predE", "total"); await pg.click("#checkE"); await pg.waitForTimeout(2600); await pg.click("#addRow"); },
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
{ const { r } = await evalOn("g2-gas", "[VofT(0), VofT(20), VofT(80), VofT(40) - VofT(20), VofT(60) - VofT(40), speedOf(80) / speedOf(0)]");
  check("기체 온도–부피: 0/20/80 ℃ → 37.3/40.0/48.2 mL, 같은 온도 간격에 같은 부피 증가", Math.abs(r[0] - 37.3) < 0.05 && r[1] === 40 && Math.abs(r[2] - 48.2) < 0.05 && Math.abs(r[3] - r[4]) < 1e-9, r.slice(0, 5).map(v => v.toFixed(2)).join(", "));
  check("기체 온도–부피: 입자 빠르기는 과장 없이 절대 온도의 제곱근에 비례 (0→80 ℃ 약 1.14배)", Math.abs(r[5] - 1.137) < 0.002, r[5].toFixed(4)); }
{ const { r } = await evalOn("g3-dewpoint", "[sat(0), sat(10), sat(20), sat(25), sat(30), dewOf(sat(15))]");
  check("포화 수증기량 0/10/20/25/30 ℃ ≈ 4.8/9.4/17.3/23.0/30.4 g/m³", Math.abs(r[0] - 4.85) < .15 && Math.abs(r[1] - 9.4) < .2 && Math.abs(r[2] - 17.3) < .2 && Math.abs(r[3] - 23.0) < .2 && Math.abs(r[4] - 30.4) < .3, r.map(v => v.toFixed(2)).join(", "));
  check("이슬점 역산 (15 ℃ 포화량 → 15 ℃)", Math.abs(r[5] - 15) < 0.01, r[5].toFixed(3)); }
{ const { r } = await evalOn("g1-heating", "[Q_melt0, Q_melt1 - Q_melt0, Q_boil0 - Q_melt1, Q_boil1 - Q_boil0]");
  check("가열: 얼음 −20→0 4.2 kJ, 융해 33.4 kJ, 물 0→100 41.8 kJ, 기화 226 kJ", r[0] === 4200 && r[1] === 33400 && Math.abs(r[2] - 41800) < 1 && r[3] === 226000, r.join(", ")); }
{ const { r } = await evalOn("g1-sound", "[1000/262, 340/262*100]"); check("도(262 Hz) 주기 3.82 ms, 파장 130 cm", Math.abs(r[0] - 3.817) < .01 && Math.round(r[1]) === 130, r.join(", ")); }
{ const { r } = await evalOn("g2-photosynthesis", "d=30; dark=false; const a=rate(); d=10; const b=rate(); d=100; const c=rate(); dark=true; const e=rate(); [a,b,c,e]");
  check("광합성: 가까울수록 CO₂ 더 빨리 감소, 100 cm·어둠에서는 증가", r[1] < r[0] && r[0] < 0 && r[2] > 0 && r[3] > 0, r.map(v => v.toFixed(1)).join(", ")); }
{ const { r } = await evalOn("g2-photosynthesis", "[lampY(10), lampY(30), lampY(100)]");   // 그림 y 는 아래로 갈수록 크다 (식물은 아래쪽)
  check("광합성 그림: 전등이 가까울수록(10 cm) 식물 쪽으로 내려와 그려짐", r[0] > r[1] && r[1] > r[2] && r[0] < 160, r.map(v => v.toFixed(0)).join(", ")); }
await withPage("g1-color", async pg => {
  const mixAt = async (R, G, B) => { for (const [k, v] of [["lR", R], ["lG", G], ["lB", B]]) await pg.$eval("#" + k, (el, v) => { el.value = v; el.dispatchEvent(new Event("input")); }, v); return pg.evaluate(() => est.share.map(Math.round)); };
  const a = await mixAt(100, 50, 0), b = await mixAt(30, 60, 90);
  check("빛 섞기: 슬라이더 빛의 양 비율 = 막대 비율 (100:50:0 → 67:33:0, 30:60:90 → 17:33:50)", Math.abs(a[0] - 67) <= 1 && Math.abs(a[1] - 33) <= 1 && a[2] === 0 && Math.abs(b[0] - 17) <= 1 && Math.abs(b[1] - 33) <= 1 && Math.abs(b[2] - 50) <= 1, `${a} / ${b}`);
  const names = []; for (const m of [[100, 0, 0], [100, 100, 0], [100, 0, 100], [0, 100, 100], [100, 100, 100]]) { await mixAt(...m); names.push(await pg.textContent("#cname")); }
  check("빛 섞기: 빨강·노랑·자홍·청록·흰색", names.join(",") === "빨강,노랑,자홍,청록,흰색", names.join(","));
  // 물체의 색: 반사하는 빛만 눈에 들어온다
  await pg.click("#tabObj");
  check("물체의 색: 처음에는 흰 빛, 결과를 가리고 예측을 기다림", (await pg.inputValue("#lG")) === "100" && (await pg.textContent("#cname")) === "–" && (await pg.textContent("#measure")) === "확인해서 기록");
  const look = async (obj, lamp) => { await pg.selectOption("#obj", obj); await pg.click(`#lampBtns [data-l="${lamp}"]`); const hidden = (await pg.textContent("#cname")) === "–"; await pg.click("#measure"); return { name: await pg.textContent("#cname"), hidden }; };
  const cases = [["apple", "0,100,0", "검정"], ["apple", "100,100,100", "빨강"], ["banana", "100,0,0", "빨강"], ["banana", "0,100,0", "초록"], ["banana", "0,0,100", "검정"], ["banana", "100,100,0", "노랑"], ["paper", "100,0,100", "자홍"], ["cloth", "100,100,100", "검정"], ["leaf", "100,0,0", "검정"], ["ball", "0,100,100", "파랑"], ["paper", "100,100,100", "흰색"]];
  const got = []; let allHidden = true;
  for (const [o, l, want] of cases) { const r = await look(o, l); got.push(r.name); allHidden = allHidden && r.hidden; }
  check("물체의 색: 사과×초록=검정, 사과×흰=빨강, 바나나×빨/초/파/빨+초=빨강/초록/검정/노랑, 흰 종이×빨+파=자홍, 검은 천×흰=검정, 잎×빨=검정, 파란 공×초+파=파랑, 흰 종이×흰=흰색", got.every((n, i) => n === cases[i][2]), got.join(","));
  check("물체의 색: 조명·물체를 바꿀 때마다 결과를 다시 가림", allHidden);
  await pg.selectOption("#obj", "apple"); await pg.click('#lampBtns [data-l="0,100,0"]'); await pg.selectOption("#pred", "초록"); await pg.click("#measure");
  const why = await pg.textContent("#objWhy"), msg = await pg.textContent("#msg"), last = await pg.$$eval("#log tr", trs => [...trs.at(-1).children].map(td => td.textContent));
  check("물체의 색: 흡수되어 눈에 들어오는 빛이 없으면 검게 보인다고 설명, 틀린 예측 안내", why.includes("흡수되어 눈에 들어오는 빛이 없으므로 검게") && msg.includes("예측은 초록") && last[1] === "빨간 사과 + 초록 빛" && last[2] === "초록 → 검정", `${why} | ${msg} | ${last}`);
  await pg.selectOption("#obj", "banana"); await pg.check("#freeLook");
  const share = await (async () => { for (const [k, v] of [["lR", 100], ["lG", 50], ["lB", 0]]) await pg.$eval("#" + k, (el, v) => { el.value = v; el.dispatchEvent(new Event("input")); }, v); return pg.evaluate(() => est.share.map(Math.round)); })();
  check("물체의 색: '결과 바로 보기'에서 슬라이더를 움직이는 대로 바뀜 (바나나 × 빨강 100·초록 50 → 67:33:0)", Math.abs(share[0] - 67) <= 1 && Math.abs(share[1] - 33) <= 1 && share[2] === 0, share.join(":"));
  const px = await pg.evaluate(() => { const c = document.getElementById("view"), k = c.width / 480, d = c.getContext("2d").getImageData(Math.round(240 * k), Math.round(225 * k), 1, 1).data; return [...d]; });
  check("물체의 색 그림: 물체가 보이는 색(주황빛)으로 칠해짐", px[0] > 200 && px[1] > 120 && px[1] < 220 && px[2] < 40, px.join(","));
  await pg.click("#tabMix");
  check("물체의 색 → 빛 섞기로 돌아오면 고른 대상의 빛과 이름으로", (await pg.textContent("#cname")) !== "–" && (await pg.textContent("#measure")) === "측정해서 기록");
});
await withPage("g2-gas", async pg => {
  const at = async (v, pred) => { await pg.$eval("#vol", (el, v) => { el.value = v; el.dispatchEvent(new Event("input")); }, v); if (pred) await pg.selectOption("#pred", pred); await pg.click("#measure"); return pg.textContent("#cmp"); };
  const t1 = await at(30, "up"), t2 = await at(45, "up"), ref = await pg.textContent("#refTxt");
  check("기체: 압력 예측은 커진다/작아진다로 고르고 직전 측정과 비교해 판정", t1.includes("커졌어요") && t1.includes("맞았어요") && t2.includes("작아졌어요") && t2.includes("다시 생각") && ref.includes("45 mL"), `${t1} | ${t2} | ${ref}`);
  const pv = await pg.evaluate(() => recs.map(r => r.p * r.v));
  const pvCells = await pg.$$eval("#tb tr td:last-child", tds => tds.map(td => +td.textContent));
  check("기체: 표에 P×V 열이 있고 값은 60으로 일정", pv.every(x => Math.abs(x - 60) < 1e-9) && pvCells.length === pv.length && pvCells.every(x => x === 60), `${pv.map(x => x.toFixed(1)).join(", ")} / 표 ${pvCells.join(", ")}`);
  const sm = await pg.evaluate(() => { const s = smooth([[60, 1], [30, 2], [15, 4], [20, 3]]); return { mono: s.every((p, i) => !i || (p[0] >= s[i - 1][0] && p[1] <= s[i - 1][1] + 1e-9)), n: s.length }; });
  check("기체: 측정점을 잇는 선은 점 사이에서 굽이치지 않는 부드러운 곡선", sm.mono && sm.n > 40, JSON.stringify(sm));
  // 온도와 부피
  await pg.click("#tabTV");
  check("기체 온도–부피: 이 화면에서는 충돌 횟수를 감춤 (압력 일정)", (await pg.isHidden("#hitsRow")) && (await pg.isVisible("#tgRow")) && (await pg.isHidden("#pvCtl")));
  const atT = async (t, pred) => { await pg.$eval("#tmp", (el, v) => { el.value = v; el.dispatchEvent(new Event("input")); }, t); if (pred) await pg.selectOption("#predV", pred); await pg.click("#measureV"); return pg.textContent("#cmpV"); };
  const u1 = await atT(40, "up"), u2 = await atT(10, "up"), u3 = await atT(10, "same");
  check("기체 온도–부피: 부피 예측을 직전 측정과 비교해 판정 (올리면 커짐, 내리면 작아짐, 같으면 그대로)", u1.includes("커졌어요") && u1.includes("맞았어요") && u2.includes("작아졌어요") && u2.includes("다시 생각") && u3.includes("변하지 않았어요") && u3.includes("맞았어요"), `${u1} | ${u2} | ${u3}`);
  const head = await pg.textContent("#tvCtl thead"), body = await pg.textContent("#tvCtl");
  check("기체 온도–부피: 표·화면에 절대 온도(K)·V/T 계산이 없음 (정성적)", !/K\b|÷|V\/T|273/.test(head + body) && (await pg.$$("#tbV tr")).length === 3, head);
  await atT(80);
  await pg.waitForTimeout(3000);
  const vNow = await pg.evaluate(() => V);
  check("기체 온도–부피: 80 ℃ 물에 담그면 피스톤이 밀려 약 48 mL가 됨", Math.abs(vNow - 48.2) < 0.3, vNow.toFixed(2));
  const [dl] = await Promise.all([pg.waitForEvent("download", { timeout: 3000 }).catch(() => null), pg.click("#csvG")]);
  const csv = dl ? fs.readFileSync(await dl.path(), "utf8") : "";
  check("기체 온도–부피: 표를 CSV로 내려받기 (BOM·머리글·4행)", csv.startsWith("﻿") && csv.includes("온도(℃)") && csv.trim().split("\n").length === 5, csv.split("\n")[0]);
  // 성취기준 표시
  check("기체: 제목 위에 성취기준 [9과06-01] [9과06-02] [9과06-03]", (await pg.textContent(".ask .std")).replace(/\s/g, "") === "[9과06-01][9과06-02][9과06-03]");
});
await withPage("g2-solar", async pg => {
  const at = async d => { await pg.$eval("#day", (el, d) => { el.value = d; el.dispatchEvent(new Event("input")); }, d); return [await pg.textContent("#phaseNow"), await pg.textContent("#litSide")]; };
  const q1 = await at(7.4), full = await at(14.8), q3 = await at(22.1), cr = await at(3.5), wn = await at(26);
  check("달: 상현달(7.4일) 오른쪽 밝음", q1[0] === "상현달" && q1[1] === "오른쪽", q1.join("/"));
  check("달: 하현달(22.1일) 왼쪽 밝음", q3[0] === "하현달" && q3[1] === "왼쪽", q3.join("/"));
  check("달: 보름달(14.8일), 초승달 오른쪽, 그믐달 왼쪽", full[0] === "보름달" && cr[0] === "초승달" && cr[1] === "오른쪽" && wn[0] === "그믐달" && wn[1] === "왼쪽", [full, cr, wn].join(" | "));
  // 위에서 본 달 위치: 7.4일에 화면 아래(북극 위에서 본 반시계), 달 그림의 밝은 픽셀이 원 오른쪽에 있는지
  await at(7.4);
  const px = await pg.evaluate(() => { const c = document.getElementById("c2"), k = c.width / 300;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const lum = (x, y) => { const i = (Math.round(y * k) * c.width + Math.round(x * k)) * 4; return d[i] + d[i + 1] + d[i + 2]; };
    return { right: lum(150 + 60, 195), left: lum(150 - 60, 195) }; });
  check("달 그림: 상현달 픽셀이 오른쪽만 밝음", px.right > 600 && px.left < 300, JSON.stringify(px));
  // 재생하면 날짜가 실제로 앞으로 가는지
  await pg.$eval("#day", el => { el.value = 0; el.dispatchEvent(new Event("input")); });
  await pg.click("#playM"); await pg.waitForTimeout(1500); await pg.click("#playM");
  const d = +(await pg.inputValue("#day")); check("달 재생 시 날짜 진행", d > 1.5, `1.5초 후 ${d}일`);
  await pg.click("#tabPlanet"); await pg.click("#playP"); await pg.waitForTimeout(1500); await pg.click("#playP");
  const dd = +(await pg.inputValue("#days")); check("행성 재생 시 날짜 진행", dd > 30, `1.5초 후 ${dd}일`);
  check("달: 위상 화면 힌트에 일식·월식이 매달 일어나지 않는다는 안내", (await pg.textContent("#moonCtl")).includes("매달 일어나지 않습니다"));
  // 일식·월식
  await pg.click("#tabEcl");
  const survey = await pg.evaluate(() => {
    const out = { solar: [], lunar: [] };
    for (let n = 1; n <= 13; n++) { out.solar.push(kindOf(n, "solar")); out.lunar.push(kindOf(n, "lunar")); }
    return out;
  });
  const cnt = a => a.filter(x => x !== "none").length;
  check("일식·월식: 삭·망 13번 가운데 일식·월식은 몇 번만 일어남 (매달 일어나지 않음)", cnt(survey.solar) >= 1 && cnt(survey.solar) <= 4 && cnt(survey.lunar) >= 1 && cnt(survey.lunar) <= 4 && survey.solar.includes("total") && survey.lunar.includes("total") && survey.solar.includes("partial"), `일식 ${survey.solar.filter(x => x !== "none").join(",")} / 월식 ${survey.lunar.filter(x => x !== "none").join(",")}`);
  const nSolarTotal = survey.solar.indexOf("total") + 1, nSolarNone = survey.solar.indexOf("none") + 1, nLunarTotal = survey.lunar.indexOf("total") + 1;
  const eclAt = async (n, kd) => { await pg.click(kd === "solar" ? "#kindS" : "#kindL"); await pg.$eval("#lun", (el, n) => { el.value = n; el.dispatchEvent(new Event("input")); }, n); const hidden = (await pg.textContent("#eclNow")) === "?"; await pg.click("#checkE"); await pg.waitForFunction(() => playE === false, null, { timeout: 12000 }); return { hidden, now: await pg.textContent("#eclNow"), where: await pg.textContent("#eclWhere"), res: await pg.textContent("#resE") }; };
  const a1 = await eclAt(nSolarTotal, "solar");
  check("일식: 확인하기 전에는 결과를 가리고, 누르면 개기일식과 볼 수 있는 곳을 알려 줌", a1.hidden && a1.now === "개기일식" && a1.where.includes("좁은 지역"), JSON.stringify(a1));
  await pg.$eval("#ph", el => { el.value = 0; el.dispatchEvent(new Event("input")); });
  const sky = async () => pg.evaluate(() => { const c = document.getElementById("c2"), k = c.width / 300, d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const at = (x, y) => { const i = (Math.round(y * k) * c.width + Math.round(x * k)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    return { mid: at(150, 185), left: at(110, 185), right: at(190, 185) }; });
  const tot = await sky();
  check("일식 그림: 본그림자 안(가)에서는 태양이 모두 가려져 어두움", tot.mid[0] < 80 && tot.mid[1] < 80, JSON.stringify(tot.mid));
  await pg.click("#obsC"); await pg.waitForTimeout(150);
  const out = await sky();
  check("일식 그림: 그림자 밖(다)에서는 태양이 그대로 보임", out.mid[0] > 200 && out.mid[1] > 180, JSON.stringify(out.mid));
  const none = await eclAt(nSolarNone, "solar");
  check("일식: 달이 많이 벗어난 삭에는 일식이 일어나지 않는다고 설명", none.now === "일식 없음" && none.res.includes("비껴가요"), JSON.stringify(none));
  const l1 = await eclAt(nLunarTotal, "lunar");
  check("월식: 개기월식이고 밤인 곳이면 어디서나 볼 수 있음, 보는 곳 버튼은 잠김", l1.now === "개기월식" && l1.where.includes("어디서나") && (await pg.isDisabled("#obsA")), JSON.stringify(l1));
  await pg.$eval("#ph", el => { el.value = 0; el.dispatchEvent(new Event("input")); });
  const moonPx = await sky();
  check("월식 그림: 본그림자 안의 달이 검정이 아니라 붉은 구리색", moonPx.mid[0] > 80 && moonPx.mid[0] > moonPx.mid[1] + 40 && moonPx.mid[1] > moonPx.mid[2], JSON.stringify(moonPx.mid));
  for (let n = 1; n <= 13; n++) { await pg.$eval("#lun", (el, n) => { el.value = n; el.dispatchEvent(new Event("input")); }, n); await pg.click("#addRow"); }
  const sum = await pg.textContent("#surveySum");
  check("일식·월식: 13번을 표에 적으면 몇 번 일어났는지 세어 줌", (await pg.$$("#survey tr")).length === 13 && sum.includes(`일식 ${cnt(survey.solar)}번`) && sum.includes(`월식 ${cnt(survey.lunar)}번`), sum);
  const [dl2] = await Promise.all([pg.waitForEvent("download", { timeout: 3000 }).catch(() => null), pg.click("#csvE")]);
  check("일식·월식: 조사 표를 CSV로 내려받기", dl2 && (await dl2.suggestedFilename()).endsWith(".csv"));
  check("일식·월식: 그림에 기울기를 과장했다는 안내, 작도 없음", (await pg.textContent("#eclCtl")).includes("과장") && (await pg.textContent("#cap")).includes("실제 비율이 아닙니다"));
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
  check("에너지: 진자 화면은 없음 (트랙·자유 낙하 두 탭)", (await pg.$("#tabP")) === null && (await pg.$$(".tabs .btn")).length === 2);
  // 자유 낙하: 5 m → 약 1.01 s 뒤 9.9 m/s, 위치+운동 에너지 = 처음 에너지
  await pg.click("#tabF"); await pg.$eval("#hf", el => { el.value = 5; el.dispatchEvent(new Event("input")); });
  await pg.selectOption("#spd", "1"); await pg.click("#go");
  await pg.waitForFunction(() => state === "done", null, { timeout: 5000 });
  const fr = await pg.evaluate(() => { const land = { t, v: stateFall().v, msg: document.getElementById("msg").textContent };
    const errs = [0.2, 0.5, 0.9].map(tt => { t = tt; const s = stateFall(); return Math.abs(m * g * s.h + 0.5 * m * s.v * s.v - Etotal()) / Etotal(); });
    return { ...land, err: Math.max(...errs), box: !document.getElementById("fallBox").hidden }; });
  check("자유 낙하: 5 m → 1.01 s 뒤 바닥, 직전 속력 9.9 m/s", Math.abs(fr.t - 1.0102) < 0.01 && Math.abs(fr.v - 9.9) < 0.05 && fr.msg.includes("9.9"), JSON.stringify(fr));
  check("자유 낙하: 떨어지는 동안 위치+운동 에너지 = 처음 에너지, 속력·에너지 그래프 표시", fr.err < 1e-9 && fr.box, `${fr.err}`);
  check("자유 낙하: 1초마다 늘어나는 속력(그래프 기울기) 9.8 m/s 안내", (await pg.textContent("#fcap")).includes("9.8 m/s"));
});
await withPage("g3-equation", async pg => {
  const setC = async arr => { await pg.evaluate(a => { coef = a; render(); }, arr); return pg.textContent("#vd"); };
  check("반응식: 2H₂ + O₂ → 2H₂O 균형", (await setC([2, 1, 2])).includes("균형이 맞았어요"));
  check("반응식: 4H₂ + 2O₂ → 4H₂O 는 약분 안내", (await setC([4, 2, 4])).includes("나눌 수 있어요"));
  check("반응식: 균형이 맞으면 계수비를 입자 수의 비로 (수소 : 산소 : 물 = 2 : 1 : 2)", (await setC([2, 1, 2])).includes("수소 : 산소 : 물 = 2 : 1 : 2") && (await pg.textContent("#vd")).includes("입자 수의 비"));
  check("반응식: 원자량·질량 합·저울을 쓰지 않음 (중학교 범위)", (await pg.$("#scale")) === null && !(await pg.textContent("body")).match(/원자량|분자 모형/));
  await pg.selectOption("#rx", "4");
  check("반응식: CH₄ + 2O₂ → CO₂ + 2H₂O 균형", (await setC([1, 2, 1, 2])).includes("균형이 맞았어요"));
  check("반응식: 5CH₄ + 5O₂ → 3CO₂ + 6H₂O 는 원자 수가 달라 완성으로 보지 않음", (await setC([5, 5, 3, 6])).includes("달라요"));
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
  // 입자 모형: 녹는 중·액체·기체 어느 상태에서도 입자끼리 겹쳐 그려지지 않음
  const overlap = await pg.evaluate(async () => {
    const out = {};
    for (const [k, q] of [["녹는 중", (Q_melt0 + Q_melt1) / 2], ["액체 50 ℃", Q_melt1 + 100 * 4.18 * 50], ["기체", Q_END]]) {
      Q = q; await new Promise(r => setTimeout(r, 1000));
      let n = 0;
      for (let s = 0; s < 10; s++) {   // 한 순간만이 아니라 0.1초 간격으로 열 번
        await new Promise(r => setTimeout(r, 100));
        for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (Math.hypot(parts[i].x - parts[j].x, parts[i].y - parts[j].y) < 2 * PR - 0.5) n++;
      }
      out[k] = n;
    }
    return out;
  });
  check("가열 입자 모형: 녹는 중·액체·기체에서 입자가 서로 겹치지 않음", Object.values(overlap).every(n => n === 0), JSON.stringify(overlap));
});
await withPage("g3-dewpoint", async pg => {
  await pg.fill("#pred", "14"); await pg.click("#cool"); await pg.waitForTimeout(9000);
  const txt = await pg.textContent("#res"); const dp = await pg.evaluate(() => dewOf(12));
  check("이슬점: 25 ℃·12 g/m³ → 이슬점 약 14 ℃에서 이슬, 보고값 = 이슬점", txt.includes(dp.toFixed(1)) && Math.abs(dp - 14.1) < 0.4, `${txt} / dp=${dp.toFixed(2)}`);
  // 구름 만들기 (페트병 모형실험)
  await pg.click("#tabBottle");
  const run = async (water, smoke, n) => {
    await pg.click("#resetB");
    await pg.setChecked("#water", water); await pg.setChecked("#smoke", smoke);
    for (let i = 0; i < n; i++) await pg.click("#pump");
    await pg.click("#lid");
    return { fog: await pg.textContent("#fogTxt"), drop: await pg.textContent("#bDrop"), msg: await pg.textContent("#resB") };
  };
  const a = await run(true, true, 20);
  check("구름: 물+향 연기+펌프 20번 → 뚜껑을 열면 온도가 내려가고 병 속이 뚜렷하게 흐려짐", a.fog === "뚜렷함" && a.drop.startsWith("-") && a.msg.includes("내려갔어요"), JSON.stringify(a));
  const b = await run(true, false, 20);
  check("구름: 향 연기(응결핵)가 없으면 잘 흐려지지 않음", b.fog === "희미함" && b.drop.startsWith("-"), JSON.stringify(b));
  const c = await run(false, true, 5);
  check("구름: 물이 없으면 이슬점이 낮아 흐려지지 않음", c.fog === "맑음", JSON.stringify(c));
  await run(true, true, 20);
  await pg.click("#lid"); for (let i = 0; i < 5; i++) await pg.click("#pump");     // 뚜껑을 닫고 다시 누르면 맑아진다
  check("구름: 뚜껑을 닫고 다시 누르면 병 속이 맑아짐", (await pg.textContent("#fogTxt")) === "맑음");
  await pg.selectOption("#predBT", "down"); await pg.selectOption("#predFog", "yes");
  await pg.click("#lid");
  check("구름: 온도·흐려짐 예측을 각각 판정", (await pg.textContent("#resB")).includes("맞았어요"), await pg.textContent("#resB"));
  await pg.click("#saveB");
  const row = await pg.$$eval("#logB tr td", tds => tds.map(td => td.textContent));
  check("구름: 조건과 결과를 표에 기록", row.length === 5 && row[0] === "○" && row[1] === "○" && row[4] === "뚜렷함", row.join(" / "));
  const [dlB] = await Promise.all([pg.waitForEvent("download", { timeout: 3000 }).catch(() => null), pg.click("#csvB")]);
  check("구름: 표를 CSV로 내려받기", dlB && (await dlB.suggestedFilename()).endsWith(".csv"));
  // 공기가 올라가면
  await pg.click("#tabRise");
  await pg.$eval("#alt", el => { el.value = 100; el.dispatchEvent(new Event("input")); });
  const r = await pg.evaluate(() => { const p = parcel(+document.getElementById("alt").value), q = parcel(p.zcA); return { cloudT: q.t, dp: dewOf(12), cloud: p.cloud, state: document.getElementById("rState").textContent, chain: [...document.querySelectorAll("#chain li.on")].length, txt: document.getElementById("riseCtl").textContent + document.querySelector("#riseStage .cap").textContent }; });
  check("공기 상승: 구름이 생기기 시작하는 온도 = 이슬점", Math.abs(r.cloudT - r.dp) < 0.05 && r.cloud > 0 && r.state.includes("구름"), `${r.cloudT.toFixed(2)} / ${r.dp.toFixed(2)}`);
  check("공기 상승: 다섯 단계를 차례로 밝힘 (상승→팽창→기온 하강→이슬점→응결)", r.chain === 5, `${r.chain}단계`);
  check("공기 상승: 높이·감률 같은 수치를 화면에 내지 않음 (정성적)", !/\d+\s*(m|km|℃\s*\/)/.test(r.txt), r.txt.slice(0, 80));
  await pg.$eval("#alt", el => { el.value = 0; el.dispatchEvent(new Event("input")); });
  check("공기 상승: 지표로 내리면 구름이 사라짐", (await pg.textContent("#rState")) === "지표" && (await pg.$$("#chain li.on")).length === 0);
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
  // 동작 줄이기에서도 과학량은 같아야 한다: 60 mL 에서 초당 충돌 횟수가 일반 설정과 같은 범위
  {
    const hitsAt = async c => { const { page } = await openPage(c, "g2-gas"); await page.waitForTimeout(5500); const n = []; for (let i = 0; i < 5; i++) { n.push(+(await page.textContent("#hits"))); await page.waitForTimeout(300); } await page.close(); return n.reduce((s, x) => s + x, 0) / n.length; };
    const nctx = await browser.newContext({ viewport: VIEWS.laptop });
    const norm = await hitsAt(nctx), red = await hitsAt(rctx);
    await nctx.close();
    check("기체: 동작 줄이기에서도 초당 충돌 횟수가 같은 범위 (시간을 느리게 흘려도 값은 그대로)", norm >= 5 && norm <= 14 && red >= 5 && red <= 14, `일반 ${norm.toFixed(1)} / 줄이기 ${red.toFixed(1)}`);
  }
  // 휴대폰 폭에서 두 그림이 세로로 쌓여 충분히 커야 한다 (예전에는 한 캔버스에 둘을 붙여 그려 절반씩 작았다)
  {
    const mctx = await browser.newContext({ viewport: VIEWS.mobile });
    const { page } = await openPage(mctx, "g2-solar");
    const w1 = await page.evaluate(() => [document.getElementById("c").clientWidth, document.getElementById("c2").clientWidth]);
    await page.click("#tabPlanet");
    await page.waitForTimeout(300);
    const w2 = await page.evaluate(() => [document.getElementById("c").clientWidth, document.getElementById("c2").offsetParent === null]);
    check("달·일식 화면: 휴대폰 380px 에서 두 그림이 각각 300px 이상", w1[0] >= 300 && w1[1] >= 300, w1.join(" / "));
    check("행성 화면: 한 그림만 쓰므로 다른 캔버스는 숨김", w2[1] === true && w2[0] >= 300, JSON.stringify(w2));
    await page.close(); await mctx.close();
  }
  // 모든 앱에 성취기준 코드 표시
  for (const p of PAGES.filter(p => p !== "index")) {
    const { page } = await openPage(rctx, p);
    const t = await page.$eval(".ask .std", el => el.textContent).catch(() => "");
    check(`성취기준 표시: ${p}`, /^(\[9과\d{2}-\d{2}\])+$/.test(t.replace(/\s/g, "")), t);
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
