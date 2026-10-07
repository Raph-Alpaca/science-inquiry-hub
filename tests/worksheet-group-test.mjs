// 활동지 모둠 칸 함께 쓰기를 Firebase 에뮬레이터(firestore)로 끝까지 돌려 본다. 브라우저 둘 = 학생 둘.
//  - 같은 모둠 학생 A 가 적으면 B 화면과 B 의 '나의 여정'에 바로 뜬다. 다른 모둠 C 에는 뜨지 않는다.
//  - 비밀번호가 틀리면 막힌다. 다른 기기에서 들어와도 개인 칸이 되살아난다.
//  - 선생님이 모둠에서 빼거나 비밀번호를 0000 으로 되돌리면 학생 화면이 바로 바뀐다 (선생님 쓰기는 관리 토큰으로 흉내).
//  - 연결이 잠시 끊겼다 돌아오면 그사이 적은 모둠 칸이 저장된다.
// 실행: npm run group
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(process.argv[2]);
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const FS = "http://127.0.0.1:8080/v1/projects/demo-sih/databases/(default)/documents";
const SHELF = "shelfG", CODE = "SEO-2026-GRP1";

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: !!ok }); console.log(`   ${ok ? "✓" : "✗"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const owner = { "content-type": "application/json", authorization: "Bearer owner" };   // 규칙을 건너뛰는 관리 토큰
const keyOf = (sid, pin) => crypto.createHash("sha256").update(`${SHELF}|${sid}|${pin}`).digest("hex");
async function rest(method, p, body) {
  const r = await fetch(`${FS}/${p}`, { method, headers: owner, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok && r.status !== 404) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`);
  return r.status === 404 ? null : r.json();
}

await fetch(`http://127.0.0.1:8080/emulator/v1/projects/demo-sih/databases/(default)/documents`, { method: "DELETE" });
await rest("PATCH", `shelves/${SHELF}`, { fields: {
  code: { stringValue: CODE }, school: { stringValue: "서울○○중학교" }, teacherName: { stringValue: "김선생" },
  title: { stringValue: "2학년 책장" }, teacherUid: { stringValue: "teacher-uid" }, createdAt: { timestampValue: new Date().toISOString() },
} });

const browser = await chromium.launch();
const W = (n = 2) => `${BASE}/worksheet.html?code=${CODE}&n=${n}&emu=1`;
async function student(tag) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/worksheet\/img|favicon|ERR_FAILED|net::/.test(m.text() + (m.location().url || ""))) errors.push(m.text().slice(0, 160)); });
  await page.goto(W(), { waitUntil: "load" });   // 실시간 연결(long polling)이 늘 열려 있어 networkidle 은 오지 않는다
  return { ctx, page, errors, tag };
}
async function login(page, { sid, pin, team }) {
  await page.waitForSelector("#loginForm", { timeout: 15000 });
  await page.fill("#sidIn", sid); await page.fill("#pinIn", pin); await page.click("#loginBtn");
  await page.waitForFunction(() => !document.querySelector("#newRow")?.hidden || document.querySelector(".team-pick") || document.querySelector("#pinForm") || !document.getElementById("wsMain").hidden || !document.getElementById("loginErr")?.hidden, null, { timeout: 15000 });
  if (await page.$("#newRow:not([hidden])")) await page.click("#loginBtn");   // 처음이면 [시작하기] (이름은 받지 않는다)
  if (team) { await page.waitForSelector(".team-pick", { timeout: 15000 }); await page.click(`[data-team="${team}"]`); }
  await page.waitForFunction(() => !document.getElementById("wsMain").hidden, null, { timeout: 15000 });
  await sleep(300);
}
const waitValue = (page, key, v, ms = 10000) => page.waitForFunction(([k, v]) => document.querySelector(`[data-key="${k}"]`)?.value === v, [key, v], { timeout: ms }).then(() => true).catch(() => false);

const A = await student("A"), B = await student("B"), C = await student("C");
await login(A.page, { sid: "20415", pin: "1234", team: 3 });
await login(B.page, { sid: "20416", pin: "5678", team: 3 });
await login(C.page, { sid: "20417", pin: "1111", team: 4 });
check("학생 셋이 학번·비밀번호로 들어와 모둠을 고름", (await A.page.textContent(".who-bar")).includes("3모둠") && (await C.page.textContent(".who-bar")).includes("4모둠"));

await A.page.fill('[data-key="n2.prompt"]', "너는 물리 선생님이야. 빗면 시뮬레이션을 만들어 줘");
await A.page.fill('[data-key="n2.plan.name"]', "알파카의 개인 기획");
check("A 가 쓴 모둠 칸이 B 화면에 새로고침 없이 뜸", await waitValue(B.page, "n2.prompt", "너는 물리 선생님이야. 빗면 시뮬레이션을 만들어 줘"));
check("A 의 개인 칸은 B 에게 안 보임", await B.page.inputValue('[data-key="n2.plan.name"]') === "");
await sleep(1500);
check("다른 모둠 C 에는 안 보임", await C.page.inputValue('[data-key="n2.prompt"]') === "");
await B.page.click('label:has(input[name="n2.team.level"][value="심화"]) span');
await sleep(300);
check("B 가 고른 난이도가 A 화면에 반영", await A.page.waitForFunction(() => document.querySelector('input[name="n2.team.level"][value="심화"]')?.checked, null, { timeout: 10000 }).then(() => true).catch(() => false));
await B.page.click('#journey .step[data-n="j"]');
await B.page.waitForFunction(() => document.getElementById("sheet").textContent.includes("빗면 시뮬레이션"), null, { timeout: 8000 }).catch(() => {});
check("B 의 나의 여정에 모둠 프롬프트가 '우리 모둠' 표시와 함께", (await B.page.textContent("#sheet")).includes("빗면 시뮬레이션") && (await B.page.$$("#sheet .jn-team")).length > 0);
await B.page.click('#journey .step[data-n="2"]');

// 쓰는 중인 칸은 덮지 않는다: B 가 프롬프트를 쓰는 동안 A 가 같은 칸을 바꿔도 B 의 입력이 남는다
await B.page.click('[data-key="n2.team.role"]'); await B.page.keyboard.type("B 가 쓰는 역할");
await A.page.fill('[data-key="n2.team.topic"]', "A 가 쓴 주제");
check("다른 칸은 쓰는 중에도 바로 반영", await waitValue(B.page, "n2.team.topic", "A 가 쓴 주제"));
check("내가 쓰고 있는 칸은 그대로", await B.page.inputValue('[data-key="n2.team.role"]') === "B 가 쓰는 역할");
await sleep(1200);
check("B 가 쓴 칸이 A 에게 반영", await waitValue(A.page, "n2.team.role", "B 가 쓰는 역할"));

// 3차시 모둠 대화: A 가 올린 글이 B 에게 실시간으로, 학번과 함께. C(다른 모둠)에는 안 보임
const SCI = '.chat[data-chat-key="n3.chat.sci"]', UX = '.chat[data-chat-key="n3.chat.ux"]';
for (const s of [A, B, C]) { await s.page.click('#journey .step[data-n="3"]'); await sleep(300); }
await A.page.fill(`${SCI} textarea.chat-in`, "슬라이더에 단위가 없어요"); await A.page.click(`${SCI} [data-chat="post"]`);
const seen = await B.page.waitForFunction(() => [...document.querySelectorAll('.chat .bubble.l:not(.blank) .chat-text')].some((e) => e.textContent === "슬라이더에 단위가 없어요"), null, { timeout: 10000 }).then(() => true).catch(() => false);
check("A 가 올린 대화 글이 B 화면에 새로고침 없이, 학번 20415 와 함께", seen && (await B.page.textContent(`${SCI} .bubble.l:not(.blank) .who`)).includes("20415"));
check("B 화면에서 친구 글에는 고치기·지우기 없음", (await B.page.$$(`${SCI} .bubble.l [data-chat]`)).length === 0);
await sleep(1000);
check("다른 모둠 C 에는 대화 글이 안 보임", (await C.page.$$(".chat .bubble:not(.blank)")).length === 0);
await A.page.fill(`${UX} textarea.chat-in`, "리셋 단추가 필요해요"); await A.page.click(`${UX} [data-chat="post"]`);
await A.page.waitForSelector(`${UX} .bubble.mine`, { timeout: 10000 }).catch(() => {});
check("A 가 3차시 전체 2개를 다 쓰면 올리기가 잠김", await A.page.$eval(`${SCI} [data-chat="post"]`, (b) => b.disabled));
const third = await rest("GET", `shelves/${SHELF}/groups/2-4-3/posts/20415-2`);
check("서버에 글이 학번-번호 주소로 저장됨", !!third && third.fields.sid.stringValue === "20415" && third.fields.area.stringValue === "ux");
await A.page.click(`${SCI} [data-chat="edit"]`); await A.page.fill(`${SCI} textarea.chat-edit`, "슬라이더에 단위(°)가 없어요"); await A.page.click(`${SCI} [data-chat="save"]`);
check("A 가 고친 글이 B 에게 반영", await B.page.waitForFunction(() => [...document.querySelectorAll(".chat-text")].some((e) => e.textContent === "슬라이더에 단위(°)가 없어요"), null, { timeout: 10000 }).then(() => true).catch(() => false));
await A.page.click(`${UX} [data-chat="del"]`); await A.page.click(`${UX} [data-chat="delYes"]`);
check("A 가 지운 글이 B 화면에서 사라짐", await B.page.waitForFunction(() => ![...document.querySelectorAll(".chat-text")].some((e) => e.textContent === "리셋 단추가 필요해요"), null, { timeout: 10000 }).then(() => true).catch(() => false));
check("지운 뒤 A 는 다시 올릴 수 있음", await A.page.waitForFunction(() => !document.querySelector('.chat[data-chat-key="n3.chat.sci"] [data-chat="post"]').disabled, null, { timeout: 5000 }).then(() => true).catch(() => false));
const studentDoc = await rest("GET", `shelves/${SHELF}/students/${keyOf("20415", "1234")}`);
check("학생 문서에 이름이 없음", studentDoc && !studentDoc.fields.name);
for (const s of [A, B, C]) { await s.page.click('#journey .step[data-n="2"]'); await sleep(200); }

// 서버 확인
await sleep(1800);
const g = await rest("GET", `shelves/${SHELF}/groups/2-4-3`);
check("모둠 문서(2-4-3)에 모둠 칸이 저장됨", g && g.fields.answers.mapValue.fields["n2.prompt"].stringValue.includes("빗면"));
const sa = await rest("GET", `shelves/${SHELF}/students/${keyOf("20415", "1234")}`);
check("A 의 개인 칸이 A 문서에 백업됨 (모둠 칸은 빠짐)", sa && sa.fields.answers.mapValue.fields["n2.plan.name"].stringValue === "알파카의 개인 기획" && !sa.fields.answers.mapValue.fields["n2.prompt"]);

// 다른 기기에서 A 로 들어오기
const A2 = await student("A2");
await A2.page.fill("#sidIn", "20415"); await A2.page.fill("#pinIn", "9999"); await A2.page.click("#loginBtn");
await A2.page.waitForFunction(() => !document.getElementById("loginErr").hidden, null, { timeout: 10000 }).catch(() => {});
check("비밀번호가 틀리면 막힘", (await A2.page.textContent("#loginErr")).includes("비밀번호가 맞지 않아요"));
await login(A2.page, { sid: "20415", pin: "1234" });
check("다른 기기에서 들어와도 개인 칸·모둠 칸이 보임", await A2.page.inputValue('[data-key="n2.plan.name"]') === "알파카의 개인 기획" && await A2.page.inputValue('[data-key="n2.prompt"]') !== "");
await A2.ctx.close();

// 선생님: 모둠에서 빼기 (관리 토큰으로 team 을 0 으로)
await rest("PATCH", `shelves/${SHELF}/students/${keyOf("20417", "1111")}?updateMask.fieldPaths=team`, { fields: { team: { integerValue: "0" } } });
check("선생님이 모둠에서 빼면 C 화면이 모둠 고르기로", await C.page.waitForSelector(".team-pick", { timeout: 10000 }).then(() => true).catch(() => false)
  && (await C.page.textContent("#notice")).includes("선생님이 모둠에서 뺐어요"));

// 선생님: 비밀번호 0000 (옮기기)
const bOld = keyOf("20416", "5678"), bNew = keyOf("20416", "0000");
const bd = await rest("GET", `shelves/${SHELF}/students/${bOld}`);
await rest("PATCH", `shelves/${SHELF}/students/${bNew}`, { fields: { ...bd.fields, reset: { booleanValue: true } } });
await rest("DELETE", `shelves/${SHELF}/students/${bOld}`);
check("선생님이 0000으로 되돌리면 B 화면이 로그인으로", await B.page.waitForSelector("#loginForm", { timeout: 10000 }).then(() => true).catch(() => false));
await B.page.fill("#sidIn", "20416"); await B.page.fill("#pinIn", "0000"); await B.page.click("#loginBtn");
check("0000으로 들어오면 새 비밀번호 정하기", await B.page.waitForSelector("#pinForm", { timeout: 10000 }).then(() => true).catch(() => false));
await B.page.fill("#pin1", "2468"); await B.page.fill("#pin2", "2468"); await B.page.click("#pinBtn");
await B.page.waitForFunction(() => !document.getElementById("wsMain").hidden, null, { timeout: 10000 }).catch(() => {});
check("새 비밀번호를 정하면 같은 모둠으로 활동지가 열림", (await B.page.textContent(".who-bar")).includes("3모둠") && await B.page.inputValue('[data-key="n2.prompt"]') !== "");
check("옛 0000 문서는 지워지고 새 문서가 생김", !(await rest("GET", `shelves/${SHELF}/students/${bNew}`)) && !!(await rest("GET", `shelves/${SHELF}/students/${keyOf("20416", "2468")}`)));

// 연결이 잠시 끊겼다 돌아오면
await A.page.route("**/google.firestore.v1.Firestore/**", (r) => r.abort());
await A.page.fill('[data-key="n2.team.feat"]', "끊긴 사이에 쓴 기능");
await sleep(4000);
const offText = await A.page.textContent("#saveState");
await A.page.unroute("**/google.firestore.v1.Firestore/**");
check("다시 연결되면 끊긴 사이에 쓴 모둠 칸이 B 에게 도착", await waitValue(B.page, "n2.team.feat", "끊긴 사이에 쓴 기능", 30000), `끊긴 동안 표시: ${offText}`);
console.log(`   (끊긴 동안 저장 표시: "${offText}")`);

await A.page.screenshot({ path: path.join(OUT, "group-A.png") });
await B.page.screenshot({ path: path.join(OUT, "group-B.png") });
for (const s of [A, B, C]) check(`${s.tag}: 콘솔 오류 없음`, !s.errors.length, s.errors.join(" | ").slice(0, 300));

await browser.close(); server.close();
const bad = checks.filter((c) => !c.ok);
console.log(`\n모둠 칸 함께 쓰기 검사: ${checks.length - bad.length}/${checks.length} 통과`);
process.exit(bad.length ? 1 : 0);
