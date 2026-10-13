// 개인정보 처리방침과 실제 동작이 맞는지 Firebase 에뮬레이터(auth + firestore)로 확인한다.
//  - 선생님이 책장을 지우면 책·모둠원 학번·활동지(학번 자리, 학생 문서, 모둠 칸, 모둠 글)가 모두 지워진다.
//  - 공용 기기에서 다른 학생이 들어와도, 서버에 올라간 앞 학생의 기록은 기기에 남지 않는다.
//  - 처리방침 페이지가 휴대폰 폭에서 잘 보이고, 모든 화면 아래에 처리방침 링크가 있다.
// 실행: npm run privacy   (firebase emulators:exec 가 에뮬레이터를 띄우고 이 파일을 돌린다)
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
const AUTH = "http://127.0.0.1:9099";
const TEACHER = "teacher@school.kr";
const SHELF = "shelfP", CODE = "SEO-2026-PRIV";

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: !!ok }); console.log(`   ${ok ? "✓" : "✗"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const owner = { "content-type": "application/json", authorization: "Bearer owner" };   // 규칙을 건너뛰는 관리 토큰
const keyOf = (sid, pin) => crypto.createHash("sha256").update(`${SHELF}|${sid}|${pin}`).digest("hex");
const now = () => ({ timestampValue: new Date().toISOString() });
async function rest(method, p, body) {
  const r = await fetch(`${FS}/${p}`, { method, headers: owner, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok && r.status !== 404) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`);
  return r.status === 404 ? null : r.json();
}
const put = (p, fields) => rest("PATCH", p, { fields });
const count = async (p) => ((await rest("GET", p)) || {}).documents?.length || 0;

await fetch(`http://127.0.0.1:8080/emulator/v1/projects/demo-sih/databases/(default)/documents`, { method: "DELETE" });
await fetch(`${AUTH}/emulator/v1/projects/demo-sih/accounts`, { method: "DELETE" });
await put(`allowed/${TEACHER}`, { email: { stringValue: TEACHER }, school: { stringValue: "서울○○중학교" }, note: { stringValue: "" }, addedBy: { stringValue: "admin@example.com" }, addedAt: now() });
const shelfFields = (uid) => ({ code: { stringValue: CODE }, school: { stringValue: "서울○○중학교" }, teacherName: { stringValue: "김선생" }, title: { stringValue: "2학년 책장" }, teacherUid: { stringValue: uid }, createdAt: now() });
await put(`shelves/${SHELF}`, shelfFields("pending"));

const browser = await chromium.launch();

/* ---------- 1. 공용 기기: 앞 학생 기록이 남지 않는다 ---------- */
console.log("공용 기기");
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  const W = `${BASE}/worksheet.html?code=${CODE}&n=2&emu=1`;
  async function login(sid, pin, team) {
    await page.waitForSelector("#loginForm", { timeout: 15000 });
    await page.fill("#sidIn", sid); await page.fill("#pinIn", pin); await page.click("#loginBtn");
    await page.waitForFunction(() => !document.querySelector("#newRow")?.hidden || document.querySelector(".team-pick") || !document.getElementById("wsMain").hidden, null, { timeout: 15000 });
    if (await page.$("#newRow:not([hidden])")) await page.click("#loginBtn");
    await page.waitForSelector(".team-pick", { timeout: 15000 }); await page.click(`[data-team="${team}"]`);
    await page.waitForFunction(() => !document.getElementById("wsMain").hidden, null, { timeout: 15000 });
    await sleep(300);
  }
  await page.goto(W, { waitUntil: "load" });
  await page.waitForSelector("#loginForm", { timeout: 15000 });
  check("활동지 로그인 화면에 학번만 쓴다는 안내와 처리방침 링크", (await page.textContent("#notice")).includes("이름은 받지 않고") && !!(await page.$('#notice a[href="privacy.html"]')));
  await login("20418", "1357", 2);
  await page.fill('[data-key="n2.plan.name"]', "앞 학생의 기획");
  await sleep(3000);   // 0.2초 뒤 기기 저장, 1.5초 뒤 서버 백업
  const a = await rest("GET", `shelves/${SHELF}/students/${keyOf("20418", "1357")}`);
  check("앞 학생의 개인 칸이 서버에 백업됨", a?.fields.answers.mapValue.fields?.["n2.plan.name"]?.stringValue === "앞 학생의 기획");
  // 다음 학생이 '다른 학생으로 열기'를 누르지 않고 그냥 들어온 경우 (로그인 기억만 지운다). 다음 학생 몫의 옛 보관본도 하나 넣어 둔다
  await page.evaluate((c) => {
    localStorage.removeItem("sih-ws-login-" + c);
    localStorage.setItem(`sih-ws-${c}-20419`, JSON.stringify({ v: 1, code: c, sid: "20419", meta: {}, answers: { "n2.plan.goal": "예전에 이 기기에 남긴 기능" }, updatedAt: "2026-01-01T00:00:00.000Z" }));
  }, CODE);
  await page.reload({ waitUntil: "load" });
  await login("20419", "2468", 2);
  const left = await page.evaluate((c) => Object.keys(localStorage).filter((k) => k.startsWith(`sih-ws-${c}-`)), CODE);
  check("서버에 올라간 앞 학생 기록은 기기에 따로 남지 않음", !left.includes(`sih-ws-${CODE}-20418`), left.join(","));
  check("앞 학생의 답이 다음 학생 화면에 안 보임", await page.inputValue('[data-key="n2.plan.name"]') === "");
  check("이 기기에 남아 있던 내 옛 기록은 합쳐지고 보관본은 지워짐", await page.inputValue('[data-key="n2.plan.goal"]') === "예전에 이 기기에 남긴 기능" && !left.includes(`sih-ws-${CODE}-20419`), left.join(","));
  await sleep(2500);
  const b = await rest("GET", `shelves/${SHELF}/students/${keyOf("20419", "2468")}`);
  check("합친 옛 기록이 서버에도 올라감", b?.fields.answers.mapValue.fields?.["n2.plan.goal"]?.stringValue === "예전에 이 기기에 남긴 기능");
  check("공용 기기: 콘솔 오류 없음", !errors.length, errors.join(" | ").slice(0, 300));
  await ctx.close();
}

/* ---------- 2. 책장을 지우면 학생 기록도 모두 지워진다 ---------- */
console.log("책장 지우기");
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/teacher.html?emu=1`, { waitUntil: "load" });
  await page.waitForSelector("#loginBtn", { timeout: 15000 });
  const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 15000 }), page.click("#loginBtn")]);
  await popup.waitForLoadState("domcontentloaded");
  await popup.waitForTimeout(600);
  await popup.getByText("Add new account", { exact: false }).first().click();
  await popup.waitForTimeout(300);
  await popup.fill("#email-input", TEACHER);
  await popup.fill("#display-name-input", "김선생");
  await popup.click("#sign-in");
  await popup.waitForEvent("close", { timeout: 15000 }).catch(() => {});
  const uid = await page.waitForFunction(async () => {
    const U = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js");
    return U.getAuth().currentUser?.uid || null;
  }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
  check("선생님이 에뮬레이터로 로그인", !!uid);

  // 책장 주인을 이 선생님으로 바꾸고, 책·모둠원 학번·모둠 칸·모둠 글(모둠 문서가 없는 모둠 포함)을 넣는다
  await put(`shelves/${SHELF}`, shelfFields(uid));
  await put(`shelves/${SHELF}/books/b1`, { title: { stringValue: "빗면 실험" }, status: { stringValue: "approved" }, code: { stringValue: CODE }, createdAt: now() });
  await put(`shelves/${SHELF}/private/b1`, { memberNames: { stringValue: "20418, 20419" }, code: { stringValue: CODE }, createdAt: now() });
  await put(`shelves/${SHELF}/groups/2-4-2`, { answers: { mapValue: { fields: { "n2.prompt": { stringValue: "모둠 프롬프트" } } } }, code: { stringValue: CODE }, updatedAt: now() });
  await put(`shelves/${SHELF}/groups/2-4-2/posts/20418-1`, { sid: { stringValue: "20418" }, area: { stringValue: "sci" }, text: { stringValue: "대화 글" }, code: { stringValue: CODE }, createdAt: now(), updatedAt: now() });
  await put(`shelves/${SHELF}/groups/2-4-7/posts/20419-t1`, { sid: { stringValue: "20419" }, area: { stringValue: "talk1" }, text: { stringValue: "모둠 문서 없는 모둠의 글" }, code: { stringValue: CODE }, createdAt: now(), updatedAt: now() });
  const before = { students: await count(`shelves/${SHELF}/students`), roster: await count(`shelves/${SHELF}/roster`) };
  check("지우기 전: 학생 문서·학번 자리가 있음", before.students >= 2 && before.roster >= 2, JSON.stringify(before));

  const err = await page.evaluate(async (id) => {
    try { const m = await import("/assets/shelf-data.js"); await m.deleteShelf({ id }); return ""; }
    catch (e) { return e.code || e.message; }
  }, SHELF);
  check("선생님 권한으로 책장 지우기가 규칙에 막히지 않음", !err, err);
  const after = {
    shelf: !!(await rest("GET", `shelves/${SHELF}`)),
    books: await count(`shelves/${SHELF}/books`), private: await count(`shelves/${SHELF}/private`),
    roster: await count(`shelves/${SHELF}/roster`), students: await count(`shelves/${SHELF}/students`),
    groups: await count(`shelves/${SHELF}/groups`),
    posts: (await count(`shelves/${SHELF}/groups/2-4-2/posts`)) + (await count(`shelves/${SHELF}/groups/2-4-7/posts`)),
  };
  check("책장·책·모둠원 학번이 지워짐", !after.shelf && !after.books && !after.private, JSON.stringify(after));
  check("학번 자리·학생 문서·모둠 칸이 지워짐", !after.roster && !after.students && !after.groups, JSON.stringify(after));
  check("모둠 글이 지워짐 (모둠 문서가 없는 모둠의 글까지)", !after.posts, JSON.stringify(after));
  await ctx.close();
}

/* ---------- 3. 처리방침 페이지와 링크 ---------- */
console.log("처리방침 페이지");
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/privacy.html`, { waitUntil: "load" });
  const arts = await page.$$eval("main h2", (hs) => hs.map((h) => h.textContent));
  check("처리방침에 제1조~제13조가 차례대로 있음", arts.length === 13 && arts.every((t, i) => t.startsWith(`제${i + 1}조`)), arts.join(" / "));
  check("휴대폰 폭에서 가로로 넘치지 않음", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(OUT, "privacy-375.png"), fullPage: true });
  const r = await page.goto(`${BASE}/docs/consent-letter.html`, { waitUntil: "load" });
  check("보호자 안내·동의서 양식이 열림", r.ok() && (await page.textContent("h1")).includes("동의서"));
  for (const p of ["index.html", "shelf.html", "submit.html", "teacher.html", "worksheet.html", "apps/g1-heating.html"]) {
    await page.goto(`${BASE}/${p}?demo=1`, { waitUntil: "load" });
    const href = await page.waitForSelector('a[href$="privacy.html"]', { state: "attached", timeout: 8000 }).then((a) => a.getAttribute("href")).catch(() => null);
    const res = href ? await fetch(new URL(href, `${BASE}/${p}`)) : null;
    check(`${p}: 아래에 처리방침 링크가 있고 열림`, res?.ok, String(href));
  }
  await ctx.close();
}

await browser.close(); server.close();
const bad = checks.filter((c) => !c.ok);
console.log(`\n개인정보 검사: ${checks.length - bad.length}/${checks.length} 통과`);
process.exit(bad.length ? 1 : 0);
