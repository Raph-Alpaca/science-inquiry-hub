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
// 학번·비밀번호로 활동지 열기 (처음이면 [시작하기]를 한 번 더 누르고, 모둠 번호를 고른다). 이름은 받지 않는다
async function login(page, { sid, pin, team }) {
  await page.waitForSelector("#loginForm");
  await page.fill("#sidIn", sid); await page.fill("#pinIn", pin); await page.click("#loginBtn");
  await page.waitForFunction(() => !document.querySelector("#newRow")?.hidden || document.querySelector(".team-pick") || !document.getElementById("wsMain").hidden || !document.getElementById("loginErr")?.hidden);
  if (await page.$("#newRow:not([hidden])")) await page.click("#loginBtn");
  if (team) { await page.waitForSelector(".team-pick"); await page.click(`[data-team="${team}"]`); }
  await page.waitForFunction(() => !document.getElementById("wsMain").hidden);
  await page.waitForTimeout(200);
}

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
  check(`${vn}: 책장이 있으면 학번·비밀번호 카드가 먼저`, await page.$("#loginForm") !== null && await page.$eval("#wsMain", (e) => e.hidden));
  await page.fill("#sidIn", "123"); await page.fill("#pinIn", "1234"); await page.click("#loginBtn");
  check(`${vn}: 학번이 5자리가 아니면 안내`, (await page.textContent("#loginErr")).includes("5자리"));
  await page.fill("#sidIn", "20415");
  check(`${vn}: 학번을 풀어서 보여 줌`, (await page.textContent("#sidHint")).includes("2학년 4반 15번"));
  await page.fill("#pinIn", "0000"); await page.click("#loginBtn"); await page.waitForTimeout(200);
  check(`${vn}: 처음 학생은 0000을 쓸 수 없음`, (await page.textContent("#loginErr")).includes("0000"));
  await page.fill("#sidIn", "20415"); await page.fill("#pinIn", "1234"); await page.click("#loginBtn");
  await page.waitForSelector("#newRow:not([hidden])");
  check(`${vn}: 처음 학생에게 이름을 묻지 않음`, await page.$("#nameIn") === null && (await page.textContent("#loginForm")).includes("처음 왔네요") && !(await page.textContent("#notice")).includes("이름"));
  await login(page, { sid: "20415", pin: "1234", team: 3 });
  check(`${vn}: 로그인 뒤 학번·모둠 띠 (이름 없음)`, (await page.textContent(".who-bar")).includes("2학년 4반 15번") && (await page.textContent(".who-bar")).includes("3모둠"));
  check(`${vn}: 서버 학생 문서에 이름 없음`, await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("sih-demo-shelf-v1")).ws.demo.students).every((x) => !("name" in x))));

  check(`${vn}: 맨 아래 저작권·생성형 AI 안내`, (await page.textContent(".site-note")).includes("저작권") && (await page.textContent(".site-note")).includes("생성형 AI"));
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
  check(`${vn}: 학번 칸은 로그인한 학번으로 채워지고 잠김`, await page.inputValue('[data-key="meta.name"]') === "20415" && await page.$eval('[data-key="meta.name"]', (e) => e.readOnly)
    && (await page.textContent("#sheet .meta-row")).includes("학번") && !(await page.textContent("#sheet .meta-row")).includes("이름"));
  await page.fill('[data-key="n1.b1.title"]', "이슬점·구름 실험실");
  await page.fill('[data-key="n1.b1.topic"]', "첫 줄\n둘째 줄\n셋째 줄");
  await page.waitForTimeout(900);   // 모둠 칸(필명)은 0.6초 쉬었다가 저장한다
  check(`${vn}: 저장 표시`, (await page.textContent("#saveState")).includes("자동 저장됨"));
  const pct1 = (await page.textContent("#sheetPct")).trim();
  check(`${vn}: 진행률이 올라감`, pct1 !== "0%", pct1);
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), "sih-ws-" + CODE);
  check(`${vn}: 저장 덩어리 모양 (v·code·meta·answers)`, stored && stored.v === 1 && stored.code === CODE && stored.meta.team === "3모둠" && stored.answers["n1.b1.title"] === "이슬점·구름 실험실" && stored.updatedAt);
  const taH = await page.$eval('[data-key="n1.b1.topic"]', (t) => t.offsetHeight);
  check(`${vn}: 여러 줄 칸이 내용만큼 늘어남`, taH > 70, String(taH));
  await page.reload({ waitUntil: "networkidle" });
  check(`${vn}: 새로고침 후 되살아남`, await page.inputValue('[data-key="n1.b1.title"]') === "이슬점·구름 실험실" && await page.inputValue('[data-key="meta.team"]') === "3모둠");
  check(`${vn}: 발자국(필명·학번)이 종이 아래에`, (await page.textContent("#sheet .sheet-foot")).includes("3모둠"));
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
  check(`${vn}: 모둠별 작성 아래에 '함께 써요' 안내`, (await page.textContent("#sheet .shared-note")).includes("3모둠"));
  check(`${vn}: IDEA 의견 4묶음과 그림 안내 2칸`, (await page.$$("#sheet .reps.c4 .sec.rep")).length === 4 && (await page.$$("#sheet .guide .fig")).length === 2);
  check(`${vn}: 2차시 그림 안내 아래 제미나이 도움말(교육용 웹 애플리케이션)`, (await page.textContent("#sheet .guide .tip")).includes("교육용 웹 애플리케이션") && (await page.textContent("#sheet .guide .tip")).includes("만 18세 미만"));
  check(`${vn}: IDEA 의견 제목 칸은 친구 학번`, await page.getAttribute('[data-key="n2.idea1.name"]', "placeholder") === "학번");
  check(`${vn}: 그림 칸마다 '이미지 추가하세요' 글이 준비됨`, (await page.textContent("#sheet .guide .fig figcaption")).includes("이미지 추가하세요"));
  await page.waitForFunction(() => document.querySelectorAll("#sheet .guide .fig.has-img").length === 2, null, { timeout: 5000 }).catch(() => {});
  check(`${vn}: worksheet/img 에 파일이 있으면 그림으로 채워지고 글은 숨음`, await page.$$eval("#sheet .guide .fig", (els) => els.every((e) => e.classList.contains("has-img") && e.querySelector("img").naturalWidth > 600 && getComputedStyle(e.querySelector("figcaption")).display === "none")));
  await page.fill('[data-key="n2.plan.name"]', "빗면 위의 레이서");
  // 고르기 칸의 input 은 숨겨 두고 글자(span)를 누르게 되어 있다
  await page.click('label:has(input[name="n2.plan.audience"][value="중학교 2학년"]) span');
  await page.fill('[data-key="n2.idea1.name"]', "20416");
  await page.fill('[data-key="n2.prompt"]', "너는 중학교 과학 시뮬레이션 전문가야. 경사각 슬라이더를 넣어 줘");
  await page.click('label:has(input[name="n2.promptCheck"][value="[역할] 역할이 명확한가요?"]) span');
  await page.waitForTimeout(400);
  check(`${vn}: 고르기가 저장·표시됨`, await page.$eval('input[name="n2.plan.audience"][value="중학교 2학년"]', (r) => r.checked && r.hasAttribute("checked")));
  check(`${vn}: 글자 수 표시`, /\d+자/.test(await page.textContent('[data-count="n2.prompt"]')));
  await page.reload({ waitUntil: "networkidle" });
  check(`${vn}: 새로고침해도 2차시(n=2)와 고른 값·이름 유지`, /STEP\. 2/.test(await page.textContent("#sheet h2")) && await page.$eval('input[name="n2.plan.audience"][value="중학교 2학년"]', (r) => r.checked)
    && await page.$eval('input[name="n2.promptCheck"]', (r) => r.checked) && await page.inputValue('[data-key="n2.idea1.name"]') === "20416");
  await page.screenshot({ path: path.join(OUT, `ws-2-${vp.width}.png`), fullPage: vp.width > 600 });

  await page.click("#next"); await page.waitForTimeout(150);
  check(`${vn}: 다음 단추 → 3차시`, /n=3/.test(page.url()) && /STEP\. 3/.test(await page.textContent("#sheet h2")));
  check(`${vn}: 3차시 점검 기준 2묶음(4개·3개), 모둠 대화창 2개`, (await page.$$eval("#sheet .criteria", (els) => els.map((e) => e.children.length).join(","))) === "4,3" && (await page.$$("#sheet .chat")).length === 2 && (await page.$$("#sheet .say")).length === 0);
  check(`${vn}: 3차시 수정 안내에도 제미나이 도움말`, (await page.$$("#sheet .guide .tip")).length === 1);
  // 대화: 올리기 → 학번이 붙은 말풍선, 2개까지
  const sci = '.chat[data-chat-key="n3.chat.sci"]', ux = '.chat[data-chat-key="n3.chat.ux"]';
  await page.fill(`${sci} textarea.chat-in`, "슬라이더 단위가 없음"); await page.click(`${sci} [data-chat="post"]`);
  await page.waitForSelector(`${sci} .bubble.mine`);
  check(`${vn}: 대화에 올린 글에 학번이 자동으로 붙음`, (await page.textContent(`${sci} .bubble.mine .who`)).includes("20415") && (await page.textContent(`${sci} .bubble.mine .chat-text`)) === "슬라이더 단위가 없음");
  check(`${vn}: 남은 글 1/2 표시`, (await page.textContent(`${sci} .chat-left`)).includes("1/2"));
  await page.fill(`${ux} textarea.chat-in`, "리셋 단추가 필요해요"); await page.click(`${ux} [data-chat="post"]`);
  await page.waitForSelector(`${ux} .bubble.mine`);
  check(`${vn}: 3차시 전체 2개를 다 쓰면 두 칸 모두 올리기 잠김`, await page.$eval(`${sci} [data-chat="post"]`, (b) => b.disabled) && await page.$eval(`${ux} textarea.chat-in`, (t) => t.disabled) && (await page.textContent(`${sci} .chat-left`)).includes("2개까지"));
  await page.click(`${ux} [data-chat="edit"]`); await page.fill(`${ux} textarea.chat-edit`, "처음으로 되돌리는 리셋 단추가 필요해요"); await page.click(`${ux} [data-chat="save"]`);
  await page.waitForFunction((s) => document.querySelector(`${s} .bubble.mine .chat-text`)?.textContent.startsWith("처음으로"), ux);
  check(`${vn}: 내 글 고치기`, (await page.textContent(`${ux} .bubble.mine .chat-text`)) === "처음으로 되돌리는 리셋 단추가 필요해요");
  await page.click(`${ux} [data-chat="del"]`); await page.click(`${ux} [data-chat="delYes"]`);
  await page.waitForFunction((s) => !document.querySelector(`${s} .bubble.mine`), ux);
  check(`${vn}: 내 글 지우면 다시 올릴 수 있음`, !(await page.$eval(`${ux} [data-chat="post"]`, (b) => b.disabled)));
  // 맨 위 첫 결과물 링크(모둠 칸): https 주소일 때만 [열기]
  check(`${vn}: 3차시 맨 위(점검 기준보다 앞)에 첫 결과물 링크 칸`, await page.evaluate(() => { const a = document.querySelector('#sheet [data-key="n3.proto"]'), c = document.querySelector("#sheet .criteria"); return !!a && !!(a.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  const openOf = (k) => page.$eval(`a[data-open="${k}"]`, (a) => ({ href: a.getAttribute("href"), off: a.getAttribute("aria-disabled") === "true", tgt: a.target, rel: a.rel }));
  check(`${vn}: 링크가 비어 있으면 [열기] 꺼짐`, (await openOf("n3.proto")).off);
  await page.fill('[data-key="n3.proto"]', "javascript:alert(1)");
  check(`${vn}: https 가 아닌 주소는 [열기] 꺼짐`, (await openOf("n3.proto")).off && (await openOf("n3.proto")).href === null);
  await page.fill('[data-key="n3.proto"]', "https://gemini.google.com/share/abc123");
  const op = await openOf("n3.proto");
  check(`${vn}: https 주소면 [열기]가 새 창으로 그 주소를 엶`, !op.off && op.href === "https://gemini.google.com/share/abc123" && op.tgt === "_blank" && op.rel.includes("noopener"), JSON.stringify(op));
  // Talk Log 모둠에 올리기: Talk Log 마다 1인 1개, 대화 2개 제한과 따로
  const t1 = '.talk[data-talk-key="n3.talk1"]';
  check(`${vn}: Talk Log 칸이 비어 있으면 올리기 꺼짐`, await page.$eval(`${t1} [data-talk="post"]`, (b) => b.disabled));
  await page.fill('[data-key="n3.talk1"]', "단위를 붙이고 범위를 0~60°로 고쳐 줘");
  check(`${vn}: Talk Log 를 쓰면 [모둠에 올리기] 켜짐`, !(await page.$eval(`${t1} [data-talk="post"]`, (b) => b.disabled)) && (await page.textContent(`${t1} [data-talk="post"]`)).includes("모둠에 올리기"));
  await page.click(`${t1} [data-talk="post"]`);
  await page.waitForSelector(`${t1} .talk-item.mine`);
  check(`${vn}: 올린 Talk Log 에 학번이 붙고 올림 표시`, (await page.textContent(`${t1} .talk-item.mine .who`)).includes("20415") && (await page.textContent(`${t1} .talk-item.mine .chat-text`)) === "단위를 붙이고 범위를 0~60°로 고쳐 줘"
    && (await page.textContent(`${t1} .talk-bar`)).includes("올렸어요") && !(await page.$(`${t1} [data-talk="post"]`)));
  check(`${vn}: Talk Log 를 올려도 대화 글 수(1/2)는 그대로`, (await page.textContent(`${sci} .chat-left`)).includes("1/2"));
  check(`${vn}: Talk Log 2 에는 Talk Log 1 글이 안 섞임`, (await page.$$('.talk[data-talk-key="n3.talk2"] .talk-item')).length === 0);
  await page.fill('[data-key="n3.talk1"]', "단위를 붙이고 범위를 0~60°로 고쳐 줘. 그래프도 넣어 줘");
  check(`${vn}: 칸을 고치면 [고친 글 다시 올리기]`, (await page.textContent(`${t1} [data-talk="post"]`)).includes("다시 올리기"));
  await page.click(`${t1} [data-talk="post"]`);
  await page.waitForFunction((s) => document.querySelector(`${s} .talk-item.mine .chat-text`)?.textContent.endsWith("그래프도 넣어 줘"), t1);
  check(`${vn}: 다시 올리면 새 글이 아니라 고쳐짐 (내 글 1개)`, (await page.$$(`${t1} .talk-item.mine`)).length === 1);
  await page.click(`${t1} [data-talk="del"]`); await page.click(`${t1} [data-talk="delYes"]`);
  await page.waitForFunction((s) => !document.querySelector(`${s} .talk-item.mine`), t1);
  check(`${vn}: 내리면 목록에서 사라지고 다시 올릴 수 있음`, !(await page.$eval(`${t1} [data-talk="post"]`, (b) => b.disabled)));
  await page.fill('[data-key="n3.talk1"]', "단위를 붙이고 범위를 0~60°로 고쳐 줘");
  await page.click(`${t1} [data-talk="post"]`); await page.waitForSelector(`${t1} .talk-item.mine`);
  await page.fill('[data-key="n3.url"]', "https://example.com/our-book");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `ws-3-${vp.width}.png`), fullPage: vp.width > 600 });
  await page.click("#next"); await page.waitForTimeout(150);
  check(`${vn}: 다음 단추 → 4차시 출판 의뢰 안내 (입력·저장 단추 없음)`, /n=4/.test(page.url()) && await page.$("#sheet.field") !== null && await page.$eval("#saveImg", (b) => b.hidden) && (await page.$$("#sheet .guide .fig")).length === 3);
  await page.screenshot({ path: path.join(OUT, `ws-4-${vp.width}.png`), fullPage: vp.width > 600 });
  await page.goBack(); await page.waitForTimeout(200);
  await page.waitForSelector('.chat[data-chat-key="n3.chat.sci"] .bubble.mine');
  check(`${vn}: 뒤로 가기 → 3차시, 대화 글 유지`, /n=3/.test(page.url()) && /STEP\. 3/.test(await page.textContent("#sheet h2")) && (await page.textContent('.chat[data-chat-key="n3.chat.sci"] .chat-text')) === "슬라이더 단위가 없음");

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
  check(`${vn}: 지우면 3차시 개인 칸(Talk Log)만 비고 필명·모둠 링크·모둠 대화·올린 Talk Log 는 남음`, await page.inputValue('[data-key="n3.talk1"]') === "" && await page.inputValue('[data-key="n3.url"]') === "https://example.com/our-book"
    && await page.inputValue('[data-key="n3.proto"]') === "https://gemini.google.com/share/abc123" && await page.inputValue('[data-key="meta.team"]') === "3모둠" && (await page.$$(".chat .bubble.mine")).length === 1 && (await page.$$(".talk .talk-item.mine")).length === 1);
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
  check(`${vn}: 맨 아래 저작권·생성형 AI 안내는 인쇄에서 숨김`, await page.$eval(".site-note", (e) => getComputedStyle(e).display === "none"));
  check(`${vn}: 인쇄에서 안내 그림·단추 숨김`, await page.$$eval("#sheet .guide, #sheet .linkrow", (els) => els.every((e) => getComputedStyle(e).display === "none")));
  await page.screenshot({ path: path.join(OUT, `ws-print-${vp.width}.png`), fullPage: true });
  await page.emulateMedia({ media: "screen" });
  // 실제 인쇄(A4 가로): 1차시 1쪽 · 2차시 2쪽 · 3차시 1쪽 · 5차시 1쪽
  if (vp.width > 600) {
    await page.emulateMedia({ media: null });   // 화면 미디어를 강제하면 page.pdf 도 화면 모양으로 찍힌다
    for (const [k, want] of [[1, 1], [2, 2], [3, 1], [5, 1]]) {
      await page.click(`#journey .step[data-n="${k}"]`); await page.waitForTimeout(200);
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
      check(`${vn}: ${k}차시 인쇄가 A4 가로 ${want}쪽`, pages === want, String(pages));
      if (k === 3) fs.writeFileSync(path.join(OUT, "ws-print-3.pdf"), pdf);
    }
    await page.click('#journey .step[data-n="3"]'); await page.waitForTimeout(200);
    await page.emulateMedia({ media: "print" });
    check(`${vn}: 3차시 인쇄에 올린 글 + 손으로 쓸 빈 말풍선(영역마다 4칸), 올리기 칸은 숨김`, await page.evaluate(() => [...document.querySelectorAll(".chat")].every((c) => [...c.querySelectorAll(".bubble")].filter((b) => getComputedStyle(b).display !== "none").length === 4)
      && [...document.querySelectorAll(".chat-compose, .talk, .url-open")].every((e) => getComputedStyle(e).display === "none")));
    await page.emulateMedia({ media: "screen" });
    check(`${vn}: 화면에서는 빈 말풍선이 안 보임`, await page.$$eval(".bubble.blank", (els) => els.every((e) => getComputedStyle(e).display === "none")));
  }

  check(`${vn}: 콘솔 오류 없음`, !errors.length, errors.join(" | ").slice(0, 300));
  await ctx.close();
}

/* 모둠 칸 함께 쓰기 · 선생님 활동지 명단 (데모: 같은 브라우저 안에서 학생을 바꿔 가며 확인) */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
  const W = (n) => URL_(`code=${CODE}&n=${n}&demo=1`);
  await page.goto(W(2), { waitUntil: "networkidle" });
  await login(page, { sid: "20415", pin: "1234", team: 3 });
  await page.fill('[data-key="n2.plan.name"]', "알파카의 개인 책 이름");
  await page.fill('[data-key="n2.prompt"]', "우리 모둠 프롬프트입니다");
  await page.fill('[data-key="meta.team"]', "별빛탐험대");
  await page.waitForTimeout(2200);   // 모둠 칸 0.6초, 개인 칸 백업 1.5초
  await page.click("#logout"); await page.waitForSelector("#loginForm");
  check("모둠: 다른 학생으로 열기 → 이 기기의 개인 기록을 지우고 로그인 카드", await page.evaluate((k) => localStorage.getItem(k), "sih-ws-" + CODE) === null);

  await login(page, { sid: "20416", pin: "5678", team: 3 });
  check("모둠: 같은 모둠 친구 화면에 모둠 칸(프롬프트·필명)이 보임", await page.inputValue('[data-key="n2.prompt"]') === "우리 모둠 프롬프트입니다" && await page.inputValue('[data-key="meta.team"]') === "별빛탐험대");
  check("모둠: 개인 칸은 보이지 않음", await page.inputValue('[data-key="n2.plan.name"]') === "");
  await page.fill('[data-key="n2.team.role"]', "너는 물리 선생님이야");
  await page.waitForTimeout(900);
  await page.click('#journey .step[data-n="j"]'); await page.waitForTimeout(200);
  const jn = await page.textContent("#sheet");
  check("모둠: 나의 여정에 모둠 칸이 '우리 모둠' 표시와 함께", jn.includes("우리 모둠 프롬프트입니다") && jn.includes("너는 물리 선생님이야") && (await page.$$("#sheet .jn-team")).length > 0);

  await page.click("#logout"); await page.waitForSelector("#loginForm");
  await login(page, { sid: "20417", pin: "1111", team: 4 });
  await page.goto(W(2), { waitUntil: "networkidle" }); await page.waitForTimeout(300);
  check("모둠: 다른 모둠에는 보이지 않음", await page.inputValue('[data-key="n2.prompt"]') === "");

  // 처음 학생이 다시 들어오면 개인 칸이 서버 백업에서 되살아난다
  await page.click("#logout"); await page.waitForSelector("#loginForm");
  await page.fill("#sidIn", "20415"); await page.fill("#pinIn", "9999"); await page.click("#loginBtn"); await page.waitForTimeout(300);
  check("모둠: 비밀번호가 틀리면 막고 선생님께 0000 요청 안내", (await page.textContent("#loginErr")).includes("0000"));
  await login(page, { sid: "20415", pin: "1234" });
  check("모둠: 다시 들어오면 개인 칸이 서버 백업에서 되살아나고 모둠 칸도 보임",
    await page.inputValue('[data-key="n2.plan.name"]') === "알파카의 개인 책 이름" && await page.inputValue('[data-key="n2.team.role"]') === "너는 물리 선생님이야");
  // 3차시 대화: 같은 모둠 친구 글이 보이고, 친구 글에는 고치기·지우기가 없다
  await page.goto(W(3), { waitUntil: "networkidle" }); await page.waitForFunction(() => !document.getElementById("wsMain").hidden);
  await page.fill('.chat[data-chat-key="n3.chat.sci"] textarea.chat-in', "20415가 올린 글"); await page.click('.chat[data-chat-key="n3.chat.sci"] [data-chat="post"]');
  await page.waitForSelector(".chat .bubble.mine");
  await page.fill('[data-key="n3.proto"]', "https://gemini.google.com/share/team3");
  await page.fill('[data-key="n3.talk2"]', "20415의 고도화 프롬프트\n리셋 단추를 넣어 줘");
  await page.click('.talk[data-talk-key="n3.talk2"] [data-talk="post"]'); await page.waitForSelector('.talk[data-talk-key="n3.talk2"] .talk-item.mine');
  await page.waitForTimeout(900);
  await page.click("#logout"); await page.waitForSelector("#loginForm");
  await login(page, { sid: "20416", pin: "5678" });
  await page.waitForSelector(".chat .bubble.l:not(.blank)", { timeout: 5000 }).catch(() => {});
  check("모둠: 3차시 대화에 같은 모둠 친구 글이 학번과 함께 보이고, 고치기·지우기는 없음",
    (await page.textContent(".chat .bubble.l:not(.blank)")).includes("20415") && (await page.textContent(".chat .bubble.l:not(.blank) .chat-text")) === "20415가 올린 글" && (await page.$$(".chat .bubble.l [data-chat]")).length === 0);
  check("모둠: 친구가 붙여 넣은 첫 결과물 링크가 보이고 [열기]가 켜짐", await page.inputValue('[data-key="n3.proto"]') === "https://gemini.google.com/share/team3" && await page.getAttribute('a[data-open="n3.proto"]', "href") === "https://gemini.google.com/share/team3");
  const fr = '.talk[data-talk-key="n3.talk2"] .talk-item:not(.mine)';
  check("모둠: 친구가 올린 Talk Log 가 학번·줄바꿈과 함께 보이고, [복사]만 있고 [내리기]는 없음",
    (await page.textContent(`${fr} .who`)).includes("20415") && (await page.textContent(`${fr} .chat-text`)) === "20415의 고도화 프롬프트\n리셋 단추를 넣어 줘"
    && (await page.$$(`${fr} [data-talk="copy"]`)).length === 1 && (await page.$$(`${fr} [data-talk="del"]`)).length === 0);
  await page.click("#logout"); await page.waitForSelector("#loginForm");
  await login(page, { sid: "20415", pin: "1234" });
  await page.goto(W(2), { waitUntil: "networkidle" }); await page.waitForFunction(() => !document.getElementById("wsMain").hidden);

  // 선생님: 활동지 명단 → 모둠에서 빼기, 비밀번호 0000
  const t = await ctx.newPage();
  await t.goto(`${BASE}/teacher.html?demo=1`, { waitUntil: "networkidle" }); await t.waitForTimeout(500);
  await t.click('.shelf-card [data-a="worksheets"]'); await t.waitForSelector("#wsDlg[open]"); await t.waitForTimeout(1700);
  const list = await t.textContent("#ws-list");
  check("선생님: 활동지 명단에 반·모둠별로 학번이 보임 (이름 열 없음)", list.includes("3모둠") && list.includes("4모둠") && list.includes("20415") && list.includes("20416") && list.includes("20417") && !(await t.textContent("#ws-list thead")).includes("이름"));
  await t.click('details.ws-chat[data-g="2-4-3"] summary'); await t.waitForTimeout(300);
  check("선생님: 모둠마다 3차시 대화 글을 펼쳐 봄", (await t.textContent('details.ws-chat[data-g="2-4-3"]')).includes("20415가 올린 글"));
  check("선생님: 모둠에 올린 Talk Log 도 따로 묶여 보임", (await t.textContent('details.ws-chat[data-g="2-4-3"]')).includes("Talk Log 고도화") && (await t.textContent('details.ws-chat[data-g="2-4-3"]')).includes("20415의 고도화 프롬프트"));
  await t.click('tr[data-sid="20415"] [data-w="kick"]'); await t.click('.ws-confirm [data-c="1"]');
  await page.waitForSelector(".team-pick", { timeout: 6000 }).catch(() => {});
  check("선생님이 모둠에서 빼면 학생 화면이 모둠을 다시 고르게 함", await page.$(".team-pick") !== null && (await page.textContent("#notice")).includes("선생님이 모둠에서 뺐어요"));
  await page.click('[data-team="3"]'); await page.waitForFunction(() => !document.getElementById("wsMain").hidden);
  await t.waitForTimeout(1700);
  await t.click('tr[data-sid="20415"] [data-w="reset"]'); await t.click('.ws-confirm [data-c="1"]');
  await page.waitForSelector("#loginForm", { timeout: 6000 }).catch(() => {});
  check("선생님이 비밀번호를 0000으로 바꾸면 학생 화면이 로그인으로", await page.$("#loginForm") !== null);
  await page.fill("#sidIn", "20415"); await page.fill("#pinIn", "0000"); await page.click("#loginBtn");
  await page.waitForSelector("#pinForm");
  check("0000으로 들어오면 새 비밀번호를 정하게 함", (await page.textContent("#notice")).includes("새 비밀번호"));
  await page.fill("#pin1", "2468"); await page.fill("#pin2", "2468"); await page.click("#pinBtn");
  await page.waitForFunction(() => !document.getElementById("wsMain").hidden);
  check("새 비밀번호를 정하면 기록 그대로 활동지로", await page.inputValue('[data-key="n2.plan.name"]') === "알파카의 개인 책 이름");
  await page.click("#logout"); await page.waitForSelector("#loginForm");
  await login(page, { sid: "20415", pin: "2468" });
  check("새 비밀번호로 다시 들어옴", (await page.textContent(".who-bar")).includes("2학년 4반 15번"));
  await t.screenshot({ path: path.join(OUT, "teacher-worksheets.png") });
  check("모둠·명단: 콘솔 오류 없음", !errors.length, errors.join(" | "));
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
