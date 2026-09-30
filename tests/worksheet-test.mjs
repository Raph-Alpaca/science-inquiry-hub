// 학생 활동지(worksheet.html)를 점검한다 (데모 모드, 네트워크는 이미지 저장의 html2canvas CDN 에만 쓴다).
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
const CODE = "DEMO-2026-BOOK";
const URL_ = (q) => `${BASE}/worksheet.html?${q}`;
const checks = []; const check = (n, ok, d = "") => { checks.push({ n, ok: !!ok }); if (!ok) console.log("   ✗ " + n + (d ? " — " + d : "")); };
const browser = await chromium.launch();

for (const [vn, vp] of [["넓은 화면", { width: 1280, height: 900 }], ["휴대폰", { width: 380, height: 760 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
  // 안내 그림(worksheet/img/)은 파일을 넣기 전에는 없는 것이 정상이라 404 를 오류로 세지 않는다
  page.on("console", (m) => { if (m.type() === "error" && !/html2canvas|cdnjs|ERR_|favicon/.test(m.text()) && !/\/worksheet\/img\//.test(m.location().url || "")) errors.push(m.text().slice(0, 120)); });

  /* 1) 코드 없이 → 코드 입력 안내 */
  await page.goto(URL_("demo=1"), { waitUntil: "networkidle" });
  check(`${vn}: 코드 없으면 코드 입력 안내`, await page.$("#codeForm") !== null && await page.$eval("#wsMain", (e) => e.hidden));
  check(`${vn}: 단추 글자가 '활동지 열기'`, (await page.textContent("#codeForm .btn")).includes("활동지 열기"));
  await page.fill("#codeInput", CODE.toLowerCase()); await page.click("#codeForm .btn"); await page.waitForLoadState("networkidle");
  check(`${vn}: 코드를 넣으면 활동지로`, new RegExp(`worksheet\\.html\\?code=${CODE}`).test(page.url()), page.url());

  /* 2) 1차시 화면 */
  check(`${vn}: 코드 칩 표시`, (await page.textContent("#codeText")).trim() === CODE);
  check(`${vn}: 여정 띠 5단계 + 나의 여정`, (await page.$$("#journey .step:not(.jn)")).length === 5 && (await page.$$("#journey .step.jn")).length === 1);
  check(`${vn}: 4단계는 입력 없는 출판 의뢰 안내`, (await page.textContent('[data-pct="4"]')).includes("출판 의뢰"));
  check(`${vn}: 1차시 제목`, /STEP\. 1 기획/.test(await page.textContent("#sheet h2")) && (await page.textContent("#sheet .sheet-kicker")).includes("디지털 과학책"));
  check(`${vn}: 1차시 My pick 3묶음, 분석 하기 아래 작은 문항 3개`, (await page.$$("#sheet .sec.rep.pick")).length === 3 && (await page.$$("#sheet .sec.rep.pick:first-child .group-box textarea")).length === 3);
  check(`${vn}: 필명 칸 이름`, (await page.textContent("#sheet .meta-row label")).includes("공동작가 필명"));
  const fields1 = await page.$$eval("#sheet [data-key]", (els) => els.length);
  check(`${vn}: 1차시에 입력 칸이 있음`, fields1 > 20, String(fields1));
  check(`${vn}: 진행률 0%`, (await page.textContent("#sheetPct")).trim() === "0%");
  check(`${vn}: 선생님 예시 책 링크가 책장으로`, (await page.getAttribute('#sheet a.btn', "href")).startsWith(`shelf.html?code=${CODE}`));
  await page.screenshot({ path: path.join(OUT, `ws-1-${vp.width}.png`), fullPage: vp.width > 600 });

  /* 3) 입력 → 자동 저장 → 새로고침 후 되살아남 */
  await page.fill('[data-key="meta.team"]', "3모둠");
  await page.fill('[data-key="meta.name"]', "20415 김하늘");
  await page.fill('[data-key="n1.b1.title"]', "이슬점·구름 실험실");
  await page.fill('[data-key="n1.b1.topic"]', "첫 줄\n둘째 줄\n셋째 줄");
  await page.waitForTimeout(400);
  check(`${vn}: 저장 표시`, (await page.textContent("#saveState")).includes("자동 저장됨"));
  const pct1 = (await page.textContent("#sheetPct")).trim();
  check(`${vn}: 진행률이 올라감`, pct1 !== "0%", pct1);
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), "sih-ws-" + CODE);
  check(`${vn}: 저장 덩어리 모양 (v·code·meta·answers)`, stored && stored.v === 1 && stored.code === CODE && stored.meta.team === "3모둠" && stored.answers["n1.b1.title"] === "이슬점·구름 실험실" && stored.updatedAt);
  const taH = await page.$eval('[data-key="n1.b1.topic"]', (t) => t.offsetHeight);
  check(`${vn}: 여러 줄 칸이 내용만큼 늘어남`, taH > 70, String(taH));
  await page.reload({ waitUntil: "networkidle" });
  check(`${vn}: 새로고침 후 되살아남`, await page.inputValue('[data-key="n1.b1.title"]') === "이슬점·구름 실험실" && await page.inputValue('[data-key="meta.team"]') === "3모둠");
  check(`${vn}: 발자국(필명·이름)이 종이 아래에`, (await page.textContent("#sheet .sheet-foot")).includes("3모둠"));
  check(`${vn}: 다른 코드에서는 비어 있음`, await (async () => {
    const p2 = await ctx.newPage(); await p2.goto(URL_("code=OTHER-2026-X1Y2&demo=1"), { waitUntil: "networkidle" });
    const v = await p2.inputValue('[data-key="n1.b1.title"]'); await p2.close(); return v === "";
  })());

  /* 4) 차시 이동 (띠·아래 단추·주소) */
  await page.click('#journey .step[data-n="2"]'); await page.waitForTimeout(150);
  check(`${vn}: 2차시로 이동, 주소에 n=2`, /n=2/.test(page.url()) && /STEP\. 2 집필/.test(await page.textContent("#sheet h2")));
  check(`${vn}: 필명은 차시가 바뀌어도 그대로`, await page.inputValue('[data-key="meta.team"]') === "3모둠");
  const parts = await page.$$eval("#sheet .part", (els) => els.map((e) => e.textContent.trim()));
  check(`${vn}: 2차시는 개별 작성·모둠별 작성으로 나뉨`, parts.join("|") === "개별 작성|모둠별 작성", parts.join("|"));
  check(`${vn}: IDEA 의견 4묶음과 그림 안내 2칸`, (await page.$$("#sheet .reps.c4 .sec.rep")).length === 4 && (await page.$$("#sheet .guide .fig")).length === 2);
  check(`${vn}: 그림 칸마다 '이미지 추가하세요' 글이 준비됨`, (await page.textContent("#sheet .guide .fig figcaption")).includes("이미지 추가하세요"));
  await page.waitForFunction(() => document.querySelectorAll("#sheet .guide .fig.has-img").length === 2, null, { timeout: 5000 }).catch(() => {});
  check(`${vn}: worksheet/img 에 파일이 있으면 그림으로 채워지고 글은 숨음`, await page.$$eval("#sheet .guide .fig", (els) => els.every((e) => e.classList.contains("has-img") && e.querySelector("img").naturalWidth > 600 && getComputedStyle(e.querySelector("figcaption")).display === "none")));
  await page.fill('[data-key="n2.plan.name"]', "빗면 위의 레이서");
  // 고르기 칸의 input 은 숨겨 두고 글자(span)를 누르게 되어 있다
  await page.click('label:has(input[name="n2.plan.audience"][value="중학교 2학년"]) span');
  await page.fill('[data-key="n2.idea1.name"]', "이서준");
  await page.fill('[data-key="n2.prompt"]', "너는 중학교 과학 시뮬레이션 전문가야. 경사각 슬라이더를 넣어 줘");
  await page.click('label:has(input[name="n2.promptCheck"][value="[역할] 역할이 명확한가요?"]) span');
  await page.waitForTimeout(400);
  check(`${vn}: 고르기가 저장·표시됨`, await page.$eval('input[name="n2.plan.audience"][value="중학교 2학년"]', (r) => r.checked && r.hasAttribute("checked")));
  check(`${vn}: 글자 수 표시`, /\d+자/.test(await page.textContent('[data-count="n2.prompt"]')));
  await page.reload({ waitUntil: "networkidle" });
  check(`${vn}: 새로고침해도 2차시(n=2)와 고른 값·이름 유지`, /STEP\. 2/.test(await page.textContent("#sheet h2")) && await page.$eval('input[name="n2.plan.audience"][value="중학교 2학년"]', (r) => r.checked)
    && await page.$eval('input[name="n2.promptCheck"]', (r) => r.checked) && await page.inputValue('[data-key="n2.idea1.name"]') === "이서준");
  await page.screenshot({ path: path.join(OUT, `ws-2-${vp.width}.png`), fullPage: vp.width > 600 });

  await page.click("#next"); await page.waitForTimeout(150);
  check(`${vn}: 다음 단추 → 3차시`, /n=3/.test(page.url()) && /STEP\. 3/.test(await page.textContent("#sheet h2")));
  check(`${vn}: 3차시 점검 기준 2묶음(4개·3개), 말풍선 8칸`, (await page.$$eval("#sheet .criteria", (els) => els.map((e) => e.children.length).join(","))) === "4,3" && (await page.$$("#sheet .say")).length === 8);
  await page.fill('[data-key="n3.sci.m1.name"]', "김하늘");
  await page.fill('[data-key="n3.sci.m1"]', "슬라이더 단위가 없음");
  await page.fill('[data-key="n3.talk1"]', "단위를 붙이고 범위를 0~60°로 고쳐 줘");
  await page.fill('[data-key="n3.url"]', "https://example.com/our-book");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `ws-3-${vp.width}.png`), fullPage: vp.width > 600 });
  await page.click("#next"); await page.waitForTimeout(150);
  check(`${vn}: 다음 단추 → 4차시 출판 의뢰 안내 (입력·저장 단추 없음)`, /n=4/.test(page.url()) && await page.$("#sheet.field") !== null && await page.$eval("#saveImg", (b) => b.hidden) && (await page.$$("#sheet .guide .fig")).length === 3);
  await page.screenshot({ path: path.join(OUT, `ws-4-${vp.width}.png`), fullPage: vp.width > 600 });
  await page.goBack(); await page.waitForTimeout(200);
  check(`${vn}: 뒤로 가기 → 3차시, 말풍선 이름·내용 유지`, /n=3/.test(page.url()) && /STEP\. 3/.test(await page.textContent("#sheet h2")) && await page.inputValue('[data-key="n3.sci.m1.name"]') === "김하늘" && await page.inputValue('[data-key="n3.sci.m1"]') === "슬라이더 단위가 없음");

  /* 5) 4차시 출판 의뢰하기 → 출판 의뢰서 미리 채우기 */
  await page.click('#journey .step[data-n="4"]'); await page.waitForTimeout(150);
  await page.evaluate((k) => localStorage.removeItem(k), "sih-submit-" + CODE);
  check(`${vn}: 4차시 단추 이름이 '출판 의뢰하기'`, (await page.textContent('#sheet a[data-prefill]')).includes("출판 의뢰하기"));
  await page.click('#sheet a[data-prefill]'); await page.waitForLoadState("networkidle");
  check(`${vn}: 출판 의뢰하기 → 출판 의뢰서`, /submit\.html\?code=/.test(page.url()), page.url());
  check(`${vn}: 출판 의뢰서에 필명·책 제목·주소가 미리 채워짐`, await page.inputValue("#team") === "3모둠" && await page.inputValue("#title") === "빗면 위의 레이서" && await page.inputValue("#url") === "https://example.com/our-book");
  await page.goBack(); await page.waitForLoadState("networkidle");

  /* 5-2) 나의 여정: 표시해 둔 문항만 모아 보기 */
  await page.click('#sheet a[data-go="j"]'); await page.waitForTimeout(150);
  const jn = await page.textContent("#sheet");
  check(`${vn}: 4차시 단추 → 나의 여정 (주소에 n=journey)`, /n=journey/.test(page.url()) && await page.$("#sheet.jn") !== null);
  check(`${vn}: 나의 여정에 1~3차시 답이 모임`, jn.includes("이슬점·구름 실험실") && jn.includes("빗면 위의 레이서") && jn.includes("경사각 슬라이더를 넣어 줘") && jn.includes("단위를 붙이고 범위를 0~60°로 고쳐 줘"));
  check(`${vn}: 표시하지 않은 문항은 빠지고, 빈 문항은 안내`, !jn.includes("슬라이더 단위가 없음") && !jn.includes("첫 줄") && jn.includes("아직 쓰지 않았어요"));
  check(`${vn}: 나의 여정에는 입력 칸·지우기 없음, 이미지·인쇄는 있음`, (await page.$$("#sheet [data-key]")).length === 0 && await page.$eval("#clear", (b) => b.hidden) && !(await page.$eval("#saveImg", (b) => b.hidden)) && await page.$("#jnCopy") !== null);
  await page.screenshot({ path: path.join(OUT, `ws-journey-${vp.width}.png`), fullPage: vp.width > 600 });
  await page.reload({ waitUntil: "networkidle" });
  check(`${vn}: 새로고침해도 나의 여정`, await page.$("#sheet.jn") !== null && await page.$eval("#journey .step.jn", (a) => a.classList.contains("cur")));
  await page.click('#sheet a[data-go="3"]'); await page.waitForTimeout(150);
  check(`${vn}: 여정에서 3차시 활동지로 돌아감`, /n=3/.test(page.url()) && /STEP\. 3/.test(await page.textContent("#sheet h2")));

  /* 6) 지우기 (확인 후 현재 차시만) */
  await page.click("#clear"); check(`${vn}: 지우기 확인이 뜸`, !(await page.$eval("#confirmClear", (e) => e.hidden)));
  await page.click("#clearNo"); check(`${vn}: 취소하면 그대로`, await page.inputValue('[data-key="n3.url"]') === "https://example.com/our-book");
  await page.click("#clear"); await page.click("#clearYes"); await page.waitForTimeout(200);
  check(`${vn}: 지우면 3차시만 비고(말풍선 이름까지) 필명은 남음`, await page.inputValue('[data-key="n3.url"]') === "" && await page.inputValue('[data-key="n3.sci.m1.name"]') === "" && await page.inputValue('[data-key="meta.team"]') === "3모둠");
  await page.click('#journey .step[data-n="1"]'); await page.waitForTimeout(150);
  check(`${vn}: 1차시 입력은 남아 있음`, await page.inputValue('[data-key="n1.b1.title"]') === "이슬점·구름 실험실");

  /* 7) 5차시 */
  await page.click('#journey .step[data-n="5"]'); await page.waitForTimeout(150);
  check(`${vn}: 5차시 리뷰 3개`, (await page.$$("#sheet .sec.rep")).length === 3);
  check(`${vn}: 5차시에 출판 의뢰하기 단추`, (await page.$$('#sheet a[href^="submit.html"]')).length === 1);

  /* 8) 이미지로 저장 (html2canvas 는 CDN 에서 받는다) */
  await page.click('#journey .step[data-n="1"]'); await page.waitForTimeout(150);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }).catch(() => null), page.click("#saveImg")]);
  if (dl) {
    const p = await dl.path(); const size = p ? fs.statSync(p).size : 0;
    check(`${vn}: 이미지 파일 이름`, /^활동지_1차시_3모둠\.png$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    check(`${vn}: PNG 가 비어 있지 않음`, size > 30000, String(size));
    if (p) fs.copyFileSync(p, path.join(OUT, `ws-image-${vp.width}.png`));
  } else {
    check(`${vn}: 이미지로 저장 (CDN 에서 html2canvas 를 받지 못하면 실패)`, false, await page.textContent("#saveState"));
  }
  check(`${vn}: 저장 뒤 단추가 다시 살아남`, await page.$eval("#saveImg", (b) => !b.disabled));

  /* 9) 인쇄 화면: 머리글·띠·바가 숨고 종이만 */
  await page.emulateMedia({ media: "print" });
  check(`${vn}: 인쇄에서 머리글·여정 띠·아래 바 숨김`, await page.$eval("body", () => ["header.head", "#journey", "#wsBar"].every((s) => getComputedStyle(document.querySelector(s)).display === "none")));
  check(`${vn}: 인쇄에서 종이는 보임`, await page.$eval("#sheet", (e) => getComputedStyle(e).display !== "none" && getComputedStyle(e).boxShadow === "none"));
  await page.screenshot({ path: path.join(OUT, `ws-print-${vp.width}.png`), fullPage: true });
  await page.emulateMedia({ media: "screen" });

  check(`${vn}: 콘솔 오류 없음`, !errors.length, errors.join(" | ").slice(0, 300));
  await ctx.close();
}

/* 책장 머리글의 활동지 링크 */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
  await page.goto(`${BASE}/shelf.html?code=${CODE}&demo=1`, { waitUntil: "networkidle" }); await page.waitForTimeout(500);
  check("책장: 머리글에 학생 활동지 링크", !(await page.$eval("#wsLink", (a) => a.hidden)) && (await page.getAttribute("#wsLink", "href")).startsWith(`worksheet.html?code=${CODE}`));
  await page.goto(`${BASE}/shelf.html?demo=1`, { waitUntil: "networkidle" });
  check("책장: 코드 없으면 활동지 링크 숨김", await page.$eval("#wsLink", (a) => a.hidden));
  await ctx.close();
}

await browser.close(); server.close();
const bad = checks.filter((c) => !c.ok);
console.log(`\n학생 활동지 검사: ${checks.length - bad.length}/${checks.length} 통과`);
if (bad.length) process.exit(1);
