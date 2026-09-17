// 선생님 화면의 로그인·승인 흐름을 Firebase 에뮬레이터(auth + firestore)로 끝까지 돌려 본다.
//  - 승인된 선생님이 로그인하면 새로고침 없이 바로 책장 화면이 떠야 한다.
//  - 관리자가 선생님을 승인하면 새로고침 없이 바로 명단에 떠야 한다.
//  - 승인 대기 중인 선생님은 관리자가 승인하는 순간 화면이 넘어가야 한다.
// 실행: npm run login   (firebase emulators:exec 가 에뮬레이터를 띄우고 이 파일을 돌린다)
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2]);
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
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
const ADMIN = "admin@example.com", TEACHER = "teacher@school.kr", NEWBIE = "new.teacher@school.kr";

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: !!ok, detail }); console.log(`   ${ok ? "✓" : "✗"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 에뮬레이터 데이터 준비 (규칙 무시: owner 토큰)
async function seed(pathname, fields) {
  const r = await fetch(`${FS}/${pathname}`, {
    method: "PATCH", headers: { "content-type": "application/json", authorization: "Bearer owner" },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`seed ${pathname}: ${r.status} ${await r.text()}`);
}
await fetch(`http://127.0.0.1:8080/emulator/v1/projects/demo-sih/databases/(default)/documents`, { method: "DELETE" });
await fetch(`${AUTH}/emulator/v1/projects/demo-sih/accounts`, { method: "DELETE" });
await seed(`admins/${ADMIN}`, { email: { stringValue: ADMIN } });
await seed(`allowed/${TEACHER}`, { email: { stringValue: TEACHER }, school: { stringValue: "서울○○중학교" }, note: { stringValue: "" }, addedBy: { stringValue: ADMIN }, addedAt: { timestampValue: new Date().toISOString() } });

const browser = await chromium.launch();

async function openTeacher(ctx, tag) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(`${BASE}/teacher.html?emu=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("#loginBtn", { timeout: 15000 });
  page.tag = tag;
  return { page, errors };
}

// 에뮬레이터의 가짜 구글 로그인 창에서 계정을 만들어 로그인한다
async function loginAs(page, email, name) {
  const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 15000 }), page.click("#loginBtn")]);
  await popup.waitForLoadState("domcontentloaded");
  await popup.waitForTimeout(600);
  const add = popup.getByText("Add new account", { exact: false }).first();
  if (await add.count()) await add.click();
  else await popup.click("text=/add new account/i");
  await popup.waitForTimeout(300);
  await popup.fill("#email-input", email);
  await popup.fill("#display-name-input", name);
  await popup.click("#sign-in");
  await popup.waitForEvent("close", { timeout: 15000 }).catch(() => {});
}

// 화면이 어떤 상태인지 (login / pending / firstrun / shelves / error / blank)
async function state(page) {
  return page.evaluate(() => {
    const m = document.getElementById("main");
    if (document.getElementById("loginBtn")) return "login";
    if (document.getElementById("recheck")) return "pending";
    if (document.getElementById("nw-make")) return "firstrun";
    if (m.querySelector(".shelf-card[data-s]")) return "shelves";
    if (m.querySelector(".notice.bad")) return "error";
    return m.textContent.trim() ? "other" : "blank";
  });
}
async function waitState(page, want, ms) {
  const t0 = Date.now();
  let s = await state(page);
  while (Date.now() - t0 < ms) {
    s = await state(page);
    if ((Array.isArray(want) ? want : [want]).includes(s)) break;
    await sleep(150);
  }
  return { s, took: Date.now() - t0 };
}

/* 1) 승인된 선생님: 로그인하자마자 책장 화면이 떠야 한다 */
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  const { page, errors } = await openTeacher(ctx, "teacher");
  await loginAs(page, TEACHER, "김선생");
  const r = await waitState(page, ["firstrun", "shelves"], 10000);
  await page.screenshot({ path: `${OUT}/teacher-after-login.png`, fullPage: true });
  check("승인된 선생님: 로그인 직후 책장 화면 (새로고침 없이)", r.s === "firstrun" || r.s === "shelves", `state=${r.s} after ${r.took}ms`);
  check("승인된 선생님: 관리자 카드는 보이지 않음", !(await page.$("#adminCard")));
  // 책장을 만들어 본다
  if (r.s === "firstrun") {
    await page.fill("#nw-school", "서울○○중학교"); await page.fill("#nw-name", "김선생"); await page.fill("#nw-title", "2학년 책장");
    await page.click("#nw-make");
    const r2 = await waitState(page, "shelves", 10000);
    check("책장 만들기 후 바로 책장 카드가 뜸", r2.s === "shelves", `state=${r2.s}`);
  }
  // 새로고침해도 같은 화면
  await page.reload({ waitUntil: "load" });
  const r3 = await waitState(page, ["firstrun", "shelves"], 10000);
  check("새로고침 후에도 책장 화면", r3.s === "shelves" || r3.s === "firstrun", `state=${r3.s}`);
  check("선생님 흐름 콘솔 오류 없음", !errors.length, errors.join(" | ").slice(0, 300));
  await ctx.close();
}

/* 2) 관리자: 로그인 직후 관리자 카드가 뜨고, 승인 추가가 바로 명단에 보여야 한다 */
let adminCtx, adminPage;
{
  adminCtx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  const { page, errors } = await openTeacher(adminCtx, "admin");
  adminPage = page;
  await loginAs(page, ADMIN, "관리자");
  const r = await waitState(page, ["firstrun", "shelves"], 10000);
  await page.screenshot({ path: `${OUT}/admin-after-login.png`, fullPage: true });
  check("관리자: 로그인 직후 화면이 뜸 (새로고침 없이)", r.s === "firstrun" || r.s === "shelves", `state=${r.s} after ${r.took}ms`);
  check("관리자: 관리자 카드가 있음", !!(await page.$("#adminCard")));
  const listed = async () => page.evaluate(() => [...document.querySelectorAll("#adminCard tbody tr td:first-child")].map((td) => td.textContent.trim()));
  check("관리자: 기존 승인 명단(김선생)이 보임", (await listed()).includes(TEACHER), JSON.stringify(await listed()));

  await page.fill("#ad-mail", NEWBIE);
  await page.fill("#ad-school", "부산△△중학교");
  await page.click("#ad-add");
  const t0 = Date.now();
  let rows = [];
  while (Date.now() - t0 < 8000) { rows = await listed(); if (rows.includes(NEWBIE)) break; await sleep(150); }
  await page.screenshot({ path: `${OUT}/admin-after-add.png`, fullPage: true });
  check("관리자: 승인 추가 직후 명단에 새 선생님이 뜸 (새로고침 없이)", rows.includes(NEWBIE), `${Date.now() - t0}ms rows=${JSON.stringify(rows)}`);
  check("관리자: 입력 칸이 비워짐", (await page.inputValue("#ad-mail")) === "");
  check("관리자 흐름 콘솔 오류 없음", !errors.length, errors.join(" | ").slice(0, 300));
}

/* 3) 승인 대기 선생님: 관리자가 승인하면 화면이 저절로 넘어가야 한다 */
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  const { page, errors } = await openTeacher(ctx, "waiting");
  const WAITER = "waiting@school.kr";
  await loginAs(page, WAITER, "박선생");
  const r = await waitState(page, "pending", 10000);
  check("미승인 선생님: 승인 대기 화면", r.s === "pending", `state=${r.s}`);
  check("미승인 선생님: 규칙 오류 안내는 뜨지 않음", !(await page.$(".notice.bad")));
  // 관리자 화면에서 승인한다
  await adminPage.fill("#ad-mail", WAITER);
  await adminPage.click("#ad-add");
  const r2 = await waitState(page, ["firstrun", "shelves"], 12000);
  await page.screenshot({ path: `${OUT}/waiting-after-approve.png`, fullPage: true });
  check("승인되는 순간 대기 화면이 책장 화면으로 넘어감 (12초 안)", r2.s === "firstrun" || r2.s === "shelves", `state=${r2.s} after ${r2.took}ms`);
  // 관리자가 승인을 취소하면 대기 화면으로 돌아가는지는 다루지 않는다 (새로고침 시 반영)
  check("대기 선생님 흐름 콘솔 오류 없음", !errors.length, errors.join(" | ").slice(0, 300));
  await ctx.close();
}

/* 4) 관리자: 승인 취소도 바로 명단에서 빠져야 한다 */
{
  const page = adminPage;
  const btn = await page.$(`[data-ad="${NEWBIE}"]`);
  check("관리자: 새 선생님의 승인 취소 단추가 있음", !!btn);
  if (btn) {
    await btn.click();
    await page.waitForSelector("#dangerDlg[open]");
    check("관리자: 승인 취소 확인창에 이메일이 보임", (await page.textContent("#dg-what")).includes(NEWBIE));
    await page.click("#dg-ok");
    await sleep(300);
    const hidden = await page.evaluate(() => [...document.querySelectorAll("#adminCard tbody tr td:first-child")].map((td) => td.textContent.trim()));
    check("관리자: 확인하면 명단에서 바로 빠지고 되돌리기 알림이 뜸", !hidden.includes(NEWBIE) && !!(await page.$(".undo-toast")));
    // 되돌리기 → 명단에 돌아오고 저장소에서도 지워지지 않는다
    await page.click(".undo-toast button");
    await sleep(11000);
    const back = await page.evaluate(() => [...document.querySelectorAll("#adminCard tbody tr td:first-child")].map((td) => td.textContent.trim()));
    const still = await fetch(`${FS}/allowed/${NEWBIE}`, { headers: { authorization: "Bearer owner" } });
    check("관리자: 되돌리면 명단에 남고 저장소에서도 지워지지 않음", back.includes(NEWBIE) && still.ok, JSON.stringify(back));
    // 이번에는 기다려서 실제로 취소한다
    await page.click(`[data-ad="${NEWBIE}"]`);
    await page.waitForSelector("#dangerDlg[open]");
    await page.click("#dg-ok");
    await sleep(11000);
    const t0 = Date.now();
    let rows = [];
    while (Date.now() - t0 < 8000) {
      rows = await page.evaluate(() => [...document.querySelectorAll("#adminCard tbody tr td:first-child")].map((td) => td.textContent.trim()));
      if (!rows.includes(NEWBIE)) break;
      await sleep(150);
    }
    const gone = await fetch(`${FS}/allowed/${NEWBIE}`, { headers: { authorization: "Bearer owner" } });
    check("관리자: 10초 뒤 명단과 저장소에서 모두 빠짐", !rows.includes(NEWBIE) && gone.status === 404, `${JSON.stringify(rows)} http=${gone.status}`);
  }
  await adminCtx.close();
}

/* 5) 실제 사이트에서 보고된 상황: 로그인 직후 실시간 연결(Listen)이 잠시 막히면 SDK 가 "오프라인"으로 보고
 *    캐시(빈 값)를 돌려준다. 그래도 승인된 선생님에게 대기 화면이 떠서는 안 되고, 연결되면 저절로 넘어가야 한다. */
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  const { page, errors } = await openTeacher(ctx, "flaky");
  let block = true;
  await page.route("**/Listen/**", (route) => (block ? route.abort() : route.continue()));
  await loginAs(page, TEACHER, "김선생");
  const r = await waitState(page, ["pending", "firstrun", "shelves", "error"], 14000);
  await page.screenshot({ path: `${OUT}/flaky-while-blocked.png`, fullPage: true });
  check("연결이 막힌 동안: 승인된 선생님에게 대기 화면이나 오류가 뜨지 않음", r.s !== "pending" && r.s !== "error", `state=${r.s} after ${r.took}ms`);
  block = false;
  const r2 = await waitState(page, ["shelves"], 40000);
  await page.screenshot({ path: `${OUT}/flaky-after-reconnect.png`, fullPage: true });
  check("연결이 돌아오면 새로고침 없이 자기 책장 화면이 뜸", r2.s === "shelves", `state=${r2.s} after ${r2.took}ms`);
  // 연결을 일부러 끊었으므로 Firestore 의 연결 경고(transport errored, Could not reach, ERR_FAILED)는 정상이다
  const real = errors.filter((e) => !/net::ERR_FAILED|@firebase\/firestore/.test(e));
  check("흔들리는 연결 흐름: 연결 경고 말고는 콘솔 오류 없음", !real.length, real.join(" | ").slice(0, 300));
  await ctx.close();
}

/* 6) 관리자가 승인을 추가하는 순간 연결이 막혀 있어도, 새 선생님은 바로 명단에 떠야 한다 */
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  const { page } = await openTeacher(ctx, "admin-flaky");
  await loginAs(page, ADMIN, "관리자");
  await waitState(page, ["firstrun", "shelves"], 10000);
  await page.waitForFunction(() => !/불러오는 중/.test(document.querySelector("#adminCard tbody")?.textContent || ""), null, { timeout: 10000 }).catch(() => {});
  let block = true;
  await page.route("**/Listen/**", (route) => (block ? route.abort() : route.continue()));
  await sleep(500);
  const MAIL = "third@school.kr";
  await page.fill("#ad-mail", MAIL);
  await page.click("#ad-add");
  const t0 = Date.now();
  let rows = [];
  while (Date.now() - t0 < 8000) {
    rows = await page.evaluate(() => [...document.querySelectorAll("#adminCard tbody tr td:first-child")].map((td) => td.textContent.trim()));
    if (rows.includes(MAIL)) break;
    await sleep(150);
  }
  check("연결이 막힌 동안 승인해도 새 선생님이 바로 명단에 뜸", rows.includes(MAIL), `${Date.now() - t0}ms rows=${JSON.stringify(rows)}`);
  block = false;
  await ctx.close();
}

await browser.close();
server.close();
const bad = checks.filter((c) => !c.ok);
console.log(`\n로그인·승인 검사: ${checks.length - bad.length}/${checks.length} 통과`);
if (bad.length) { console.log(bad.map((b) => " - " + b.name + (b.detail ? " — " + b.detail : "")).join("\n")); process.exit(1); }
