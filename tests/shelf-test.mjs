// 산출물 책장 3개 화면을 1920/1200/380 에서 열고 동작·개인정보·콘솔 오류를 점검한다.
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
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const CODE = "DEMO-2026-BOOK";
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: !!ok, detail }); if (!ok) console.log("   ✗ " + name + (detail ? " — " + detail : "")); };

const browser = await chromium.launch();
async function open(ctx, url) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", (r) => errors.push(`[requestfailed] ${r.url().replace(BASE, "")} ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url().replace(BASE, "")}`); });
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return { page, errors };
}
const VIEWS = { classroom: { width: 1920, height: 1080 }, laptop: { width: 1200, height: 860 }, mobile: { width: 380, height: 820 } };

for (const [vn, vp] of Object.entries(VIEWS)) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, acceptDownloads: true });

  // 1) 공개 책장
  {
    const { page, errors } = await open(ctx, `/shelf.html?code=${CODE}&demo=1`);
    await page.waitForSelector(".book, .book-row", { timeout: 5000 }).catch(() => {});
    await page.screenshot({ path: `${OUT}/${vn}-shelf.png`, fullPage: vn === "mobile" });
    const info = await page.evaluate(() => ({
      books: document.querySelectorAll(".book[data-i]").length,
      rows: document.querySelectorAll(".row-label h2").length,
      labels: [...document.querySelectorAll(".row-label h2")].map((h) => h.textContent),
      html: document.body.innerHTML,
      scrollW: document.documentElement.scrollWidth, W: document.documentElement.clientWidth,
    }));
    check(`${vn}: 책장에 서가가 그려짐`, info.rows >= 3, info.labels.join(" | "));
    check(`${vn}: 선생님 예시 11권 + 학생 책 4권`, info.books === 15 || vn === "mobile", `${info.books}권`);
    check(`${vn}: 가로 넘침 없음`, info.scrollW <= info.W + 1, `${info.scrollW} > ${info.W}`);
    if (vn !== "mobile") {   // 표지 아래 학년반·모둠명 줄이 줄어들어 글자 아래가 잘리지 않는지
      const cut = await page.evaluate(() => [...document.querySelectorAll(".book .who")].filter((el) => el.scrollHeight > el.clientHeight + 1).map((el) => `${el.textContent} ${el.clientHeight}/${el.scrollHeight}`));
      check(`${vn}: 책 표지의 학년반·모둠명 줄이 잘리지 않음`, cut.length === 0, cut.join(" | "));
    }
    check(`${vn}: 승인 대기 책은 공개 책장에 없음`, !info.html.includes("우리 학교 기온 기록"));
    check(`${vn}: 모둠원 이름이 공개 화면에 없음`, !/김하늘|이서준|최민준|정수아/.test(info.html));
    check(`${vn}: 빈 서가 안내 문구`, info.html.includes("아직 꽂힌 책이 없어요"));
    // 한 서가는 칸 하나에 다 꽂고, 넘치는 만큼 옆으로 넘겨 본다 (예전에는 10권마다 "(이어서)" 칸이 생겼다)
    check(`${vn}: 서가를 나눠 "(이어서)" 칸을 만들지 않음`, !info.labels.some((t) => t.includes("이어서")), info.labels.join(" | "));
    if (vn !== "mobile") {
      const teacher = await page.evaluate(() => {
        const row = [...document.querySelectorAll(".row-inner")].find((r) => r.querySelectorAll(".book[data-i]").length);
        return { n: row.querySelectorAll(".book[data-i]").length, over: row.scrollWidth > row.clientWidth + 2, next: !row.closest(".bay").querySelector(".row-nav.next").hidden };
      });
      check(`${vn}: 선생님 예시 11권이 한 칸에 모두`, teacher.n === 11, `${teacher.n}권`);
      if (teacher.over) {
        const moved = await page.evaluate(async () => {
          // 책장은 자료가 들어오면 다시 그려지므로 그때마다 칸을 다시 찾는다
          const find = () => [...document.querySelectorAll(".row-inner")].find((r) => r.scrollWidth > r.clientWidth + 2);
          const a = find().scrollLeft;
          find().closest(".bay").querySelector(".row-nav.next").click();
          for (let i = 0; i < 30 && find().scrollLeft <= a + 50; i++) await new Promise((r) => setTimeout(r, 100));   // 부드러운 스크롤이 끝날 때까지
          const row = find();
          return { a, b: row.scrollLeft, prevShown: !row.closest(".bay").querySelector(".row-nav.prev").hidden };
        });
        check(`${vn}: 넘치면 › 단추로 옆으로 넘어가고 ‹ 단추가 나타남`, teacher.next && moved.b > moved.a + 50 && moved.prevShown, JSON.stringify(moved));
      }
    }

    // 책 펼치기
    const first = vn === "mobile" ? ".book-row" : ".book";
    await page.click(`${first}[data-i="11"]`);      // 학생 책 (선생님 예시 11권 다음) (산불 확산 시뮬레이션)
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/${vn}-reader.png` });
    const r = await page.evaluate(() => ({
      open: !document.getElementById("reader").hidden,
      title: document.getElementById("bkTitle").textContent,
      chips: [...document.querySelectorAll("#bkConcepts .chip")].map((c) => c.textContent),
      hash: location.hash,
      hasIframe: !!document.querySelector("#bkPreview iframe"),
      fallback: (document.getElementById("bkPreview").textContent || "").includes("바깥 사이트"),
      dim: getComputedStyle(document.getElementById("dim")).opacity,
    }));
    check(`${vn}: 책이 펼쳐짐`, r.open && r.title === "산불 확산 시뮬레이션", r.title);
    check(`${vn}: 개념 칩 표시`, r.chips.length === 4, r.chips.join(","));
    check(`${vn}: URL 해시 #book=`, r.hash.startsWith("#book="), r.hash);
    check(`${vn}: 바깥 링크는 iframe 대신 안내`, !r.hasIframe && r.fallback);
    // 키보드
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(1000);
    const t2 = await page.textContent("#bkTitle");
    check(`${vn}: → 키로 다음 책`, t2 === "달 위상 계산기", t2);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1100);       // 닫힘 모션(표지 덮기 → 책장으로 돌아가기)이 끝날 때까지
    check(`${vn}: Esc 로 닫힘`, await page.evaluate(() => document.getElementById("reader").hidden));
    // 선생님 예시는 iframe 으로
    await page.click(`${first}[data-i="0"]`);
    await page.waitForTimeout(1700);
    check(`${vn}: 선생님 예시는 iframe 으로 열림`, await page.evaluate(() => !!document.querySelector("#bkPreview iframe")));
    await page.keyboard.press("Escape");
    check(`${vn}: 공개 책장 콘솔 오류 없음`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // 2) 제출 폼
  {
    const { page, errors } = await open(ctx, `/submit.html?code=${CODE}&demo=1`);
    await page.waitForSelector("#form:not([hidden])");
    await page.screenshot({ path: `${OUT}/${vn}-submit.png`, fullPage: vn === "mobile" });
    // 빈 채로 제출 → 오류 표시
    await page.click("#send");
    const errShown = await page.evaluate(() => !document.getElementById("e-team").hidden && !document.getElementById("e-url").hidden);
    check(`${vn}: 빈 칸 제출 시 안내`, errShown);
    await page.fill("#team", "3모둠");
    await page.fill("#title", "테스트 산출물");
    await page.fill("#intent", "왜 만들었는지 적었습니다.");
    await page.fill("#url", "http://insecure.example.com");
    await page.click("#send");
    check(`${vn}: http 링크 거부`, await page.evaluate(() => !document.getElementById("e-url").hidden));
    await page.fill("#url", "https://example.com/mywork");
    await page.fill("#howto", "슬라이더를 움직여 보세요.");
    await page.fill("#concepts", "열평형, 대류");
    await page.fill("#members", "홍길동, 김영희");
    await page.click('#coverPick button[data-k="space"]');
    await page.click('#colorPick button[data-c="#8A5CD6"]');
    await page.click("#send");
    check(`${vn}: 동의 없으면 제출 안 됨`, await page.evaluate(() => !document.getElementById("e-agree").hidden));
    await page.check("#agree");
    await page.click("#send");
    await page.waitForSelector("#done:not([hidden])", { timeout: 5000 });
    await page.screenshot({ path: `${OUT}/${vn}-submit-done.png` });
    check(`${vn}: 제출 완료 안내`, (await page.textContent("#done")).includes("선생님 확인 후"));
    check(`${vn}: 제출 폼 콘솔 오류 없음`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // 3) 제출한 책은 승인 전에는 공개 책장에 안 보인다
  {
    const { page } = await open(ctx, `/shelf.html?code=${CODE}&demo=1`);
    await page.waitForTimeout(600);
    const html = await page.content();
    check(`${vn}: 방금 제출한 책은 승인 전 비공개`, !html.includes("테스트 산출물"));
    await page.close();
  }

  // 4) 교사 화면
  {
    const { page, errors } = await open(ctx, `/teacher.html?demo=1`);
    await page.waitForSelector(".shelf-card");
    await page.screenshot({ path: `${OUT}/${vn}-teacher.png`, fullPage: vn === "mobile" });
    const pend = await page.textContent('[role=tab][data-t="pending"]');
    check(`${vn}: 승인 대기 목록`, /승인 대기 [12]/.test(pend), pend);
    check(`${vn}: 교사 화면에는 모둠원 이름이 보임`, (await page.content()).includes("홍길동"));
    // QR
    await page.click('[data-a="qr"]');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${vn}-teacher-qr.png` });
    const qr = await page.evaluate(() => {
      const svg = document.querySelector("#qrHere svg");
      return { has: !!svg, w: svg ? svg.getAttribute("width") : null, text: document.getElementById("qrHere").textContent };
    });
    check(`${vn}: QR 이미지 생성`, qr.has, qr.text);
    await page.click("#qrClose");
    // 승인
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 4000 }).catch(() => null),
      page.click('[data-a="csv"]'),
    ]);
    check(`${vn}: CSV 내려받기`, dl && (await dl.suggestedFilename()).endsWith(".csv"));
    if (dl) {
      const p = await dl.path();
      const csv = fs.readFileSync(p, "utf8");
      check(`${vn}: CSV에 모둠원 포함`, csv.includes("홍길동") && csv.includes("모둠원"));
    }
    await page.click('[data-a="approveAll"]');
    await page.waitForTimeout(900);
    const approved = await page.textContent('[role=tab][data-t="approved"]');
    check(`${vn}: 모두 승인 후 승인됨 수 증가`, /승인됨 [56]/.test(approved), approved);
    // 책장 설정: 이름 바꾸기
    await page.click('[data-a="settings"]');
    await page.waitForTimeout(500);
    check(`${vn}: 책장 설정 창 열림`, await page.evaluate(() => document.getElementById("shelfDlg").open));
    await page.fill("#sh-title", "이름 바꾼 책장");
    await page.fill("#sh-school", "고친 중학교");
    await page.click("#sh-save");
    await page.waitForTimeout(1000);
    check(`${vn}: 책장 이름 바꾸기`, (await page.textContent(".shelf-card .hd h2")) === "이름 바꾼 책장");
    check(`${vn}: 관리자 승인 화면 표시`, !!(await page.$("#adminCard")));
    check(`${vn}: 승인 명단 표에 항목`, (await page.textContent("#adminCard")).includes("teacher@example.com"));
    check(`${vn}: 교사 화면 콘솔 오류 없음`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // 5) 승인 후 공개 책장에 보인다
  {
    const { page } = await open(ctx, `/shelf.html?code=${CODE}&demo=1`);
    await page.waitForTimeout(700);
    const html = await page.content();
    check(`${vn}: 승인 후 공개 책장에 꽂힘`, html.includes("테스트 산출물"));
    check(`${vn}: 승인 후에도 모둠원 이름 비공개`, !/홍길동|김영희/.test(html));
    await page.close();
  }
  await ctx.close();
}

// 6) 코드 없이 접속 / 없는 코드
{
  const ctx = await browser.newContext({ viewport: VIEWS.laptop });
  const { page, errors } = await open(ctx, "/shelf.html?demo=1");
  check("코드 없이 접속하면 안내", (await page.textContent("#notice")).includes("책장 코드를 받으세요"));
  await page.screenshot({ path: `${OUT}/laptop-shelf-nocode.png` });
  await page.close();
  const { page: p2 } = await open(ctx, "/shelf.html?code=NOPE-2026-XXXX&demo=1");
  await p2.waitForTimeout(500);
  check("없는 코드면 안내", (await p2.textContent("#notice")).includes("책장이 없어요"));
  await p2.screenshot({ path: `${OUT}/laptop-shelf-badcode.png` });
  await p2.close();
  check("코드 없음 화면 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// 6-1) 지우기 안전장치: 확인창에 이름·"삭제"를 적어야 하고, 지운 뒤에도 잠깐 되돌릴 수 있다
{
  const ctx = await browser.newContext({ viewport: VIEWS.laptop, acceptDownloads: true });
  const { page, errors } = await open(ctx, "/teacher.html?demo=1");
  await page.waitForSelector(".shelf-card");
  let nativeDialogs = 0;
  page.on("dialog", (d) => { if (d.type() !== "beforeunload") nativeDialogs++; d.accept(); });
  const bookCount = () => page.evaluate(() => document.querySelectorAll(".shelf-card[data-s] tr[data-b]").length);
  const undoCount = () => page.evaluate(() => document.querySelectorAll(".undo-toast").length);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("sih-demo-shelf-v1")));
  // 데모 저장소는 처음 쓰기 전까지 비어 있으므로, 같은 이름으로 한 번 저장해 실제 데이터를 채워 둔다
  await page.evaluate(async () => {
    const m = await import("/assets/shelf-data.js");
    const [s] = await m.myShelves("demo-uid");
    await m.renameShelf(s, { school: s.school, teacherName: s.teacherName, title: s.title });
  });

  // --- 책 삭제 ---
  await page.click('[role=tab][data-t="approved"]');
  await page.waitForTimeout(200);
  const before = await bookCount();
  const target = await page.$eval(".shelf-card[data-s] tr[data-b]", (tr) => tr.dataset.b);
  await page.click(`tr[data-b="${target}"] [data-a="edit"]`);
  await page.click("#ed-delete");
  await page.waitForSelector("#dangerDlg[open]");
  check("책 삭제: 확인창이 뜸 (브라우저 기본 확인창 아님)", nativeDialogs === 0);
  check("책 삭제: 적기 전에는 삭제 단추가 꺼져 있음", await page.isDisabled("#dg-ok"));
  await page.fill("#dg-type", "삭 제하");
  check("책 삭제: 틀리게 적으면 여전히 꺼져 있음", await page.isDisabled("#dg-ok"));
  await page.click("#dg-cancel");
  check("책 삭제: 취소하면 아무것도 지워지지 않음", (await bookCount()) === before && (await undoCount()) === 0);
  await page.click("#ed-delete");
  await page.waitForSelector("#dangerDlg[open]");
  check("책 삭제: 다시 열면 적은 글자가 비워져 있음", (await page.inputValue("#dg-type")) === "" && await page.isDisabled("#dg-ok"));
  await page.fill("#dg-type", "삭제");
  check("책 삭제: \"삭제\"라고 적으면 단추가 켜짐", !(await page.isDisabled("#dg-ok")));
  await page.screenshot({ path: `${OUT}/laptop-teacher-delete-book-confirm.png` });
  await page.click("#dg-ok");
  await page.waitForTimeout(300);
  check("책 삭제: 목록에서 바로 빠짐", (await bookCount()) === before - 1);
  check("책 삭제: 되돌리기 알림이 뜸", (await undoCount()) === 1);
  check("책 삭제: 아직 저장소에서는 지워지지 않음", (await stored()).books.demo.some((b) => b.id === target));
  await page.screenshot({ path: `${OUT}/laptop-teacher-delete-book-undo.png` });
  await page.click(".undo-toast button");
  await page.waitForTimeout(300);
  check("책 삭제: 되돌리기를 누르면 목록에 돌아옴", (await bookCount()) === before && (await undoCount()) === 0);
  await page.waitForTimeout(10500);
  check("책 삭제: 되돌린 책은 시간이 지나도 남아 있음", (await stored()).books.demo.some((b) => b.id === target));
  // 이번에는 기다려서 실제로 지운다
  await page.click(`tr[data-b="${target}"] [data-a="edit"]`);
  await page.click("#ed-delete");
  await page.fill("#dg-type", "삭제");
  await page.click("#dg-ok");
  await page.waitForTimeout(10800);
  check("책 삭제: 10초 뒤 저장소에서 지워짐", !(await stored()).books.demo.some((b) => b.id === target));
  check("책 삭제: 지운 뒤 알림이 사라지고 목록도 그대로 줄어 있음", (await undoCount()) === 0 && (await bookCount()) === before - 1);

  // --- 책장 삭제 ---
  await page.click('[data-a="settings"]');
  await page.waitForTimeout(300);
  check("삭제 안내에 책 권수 표시", /권/.test(await page.textContent("#sh-delnote")));
  await page.click("#sh-del");
  await page.waitForSelector("#dangerDlg[open]");
  check("책장 삭제: 확인창에 책장 이름과 권수가 보임", /2학년 책장/.test(await page.textContent("#dg-what")) && /권/.test(await page.textContent("#dg-what")));
  check("책장 삭제: 백업 내려받기가 기본으로 켜져 있음", await page.isChecked("#dg-backup"));
  await page.fill("#dg-type", "삭제");
  check("책장 삭제: \"삭제\"만 적어서는 안 켜짐 (책장 이름을 적어야 함)", await page.isDisabled("#dg-ok"));
  await page.fill("#dg-type", "2학년 책장");
  check("책장 삭제: 책장 이름을 적으면 켜짐", !(await page.isDisabled("#dg-ok")));
  await page.screenshot({ path: `${OUT}/laptop-teacher-delete-shelf-confirm.png` });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }).catch(() => null), page.click("#dg-ok")]);
  check("책장 삭제: 지우기 전에 CSV 백업을 내려받음", dl && /\.csv$/.test(dl.suggestedFilename()), dl && dl.suggestedFilename());
  await page.waitForTimeout(300);
  check("책장 삭제: 화면에서 바로 빠짐", (await page.textContent("#main")).includes("학교 책장 만들기"));
  check("책장 삭제: 아직 저장소에는 남아 있음", (await stored()).shelves.some((x) => x.id === "demo"));
  await page.click(".undo-toast button");
  await page.waitForTimeout(300);
  check("책장 삭제: 되돌리면 책장 화면으로 돌아옴", !!(await page.$(".shelf-card[data-s]")));
  await page.click('[data-a="settings"]');
  await page.click("#sh-del");
  await page.fill("#dg-type", "2학년 책장");
  await page.uncheck("#dg-backup");
  await page.click("#dg-ok");
  await page.waitForTimeout(10800);
  check("책장 삭제 후 첫 화면으로", (await page.textContent("#main")).includes("학교 책장 만들기"));
  check("책장 삭제: 10초 뒤 저장소에서 지워짐", !(await stored()).shelves.some((x) => x.id === "demo"));
  check("지우는 동안 브라우저 기본 확인창이 한 번도 뜨지 않음", nativeDialogs === 0, String(nativeDialogs));
  check("책장 삭제 중 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await page.close(); await ctx.close();
}

// 6-2) 휴대전화 폭에서 확인창과 되돌리기 알림이 넘치지 않음
{
  const ctx = await browser.newContext({ viewport: VIEWS.mobile });
  const { page, errors } = await open(ctx, "/teacher.html?demo=1");
  await page.evaluate(() => localStorage.removeItem("sih-demo-shelf-v1"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".shelf-card[data-s]");
  await page.click('[data-a="settings"]');
  await page.click("#sh-del");
  await page.waitForSelector("#dangerDlg[open]");
  const dlgBox = await page.$eval("#dangerDlg", (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, W: innerWidth }; });
  check("mobile: 확인창이 화면 폭 안에 들어옴", dlgBox.l >= 0 && dlgBox.r <= dlgBox.W, JSON.stringify(dlgBox));
  await page.screenshot({ path: `${OUT}/mobile-teacher-delete-shelf-confirm.png` });
  await page.fill("#dg-type", "2학년 책장");
  await page.uncheck("#dg-backup");
  await page.click("#dg-ok");
  await page.waitForTimeout(300);
  const t = await page.$eval(".undo-toast", (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, W: innerWidth }; });
  check("mobile: 되돌리기 알림이 화면 폭 안에 들어옴", t.l >= 0 && t.r <= t.W, JSON.stringify(t));
  await page.screenshot({ path: `${OUT}/mobile-teacher-delete-shelf-undo.png` });
  await page.click(".undo-toast button");
  await page.waitForTimeout(200);
  check("mobile: 되돌린 뒤 책장이 다시 보임", !!(await page.$(".shelf-card[data-s]")));
  check("mobile 지우기 안전장치 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// 7) 동작 줄이기
{
  const ctx = await browser.newContext({ viewport: VIEWS.laptop, reducedMotion: "reduce" });
  const { page, errors } = await open(ctx, `/shelf.html?code=${CODE}&demo=1`);
  await page.waitForSelector(".book");
  await page.click('.book[data-i="0"]');
  await page.waitForTimeout(400);
  const ok = await page.evaluate(() => {
    const r = document.getElementById("reader");
    return { open: !r.hidden, mover: getComputedStyle(document.getElementById("mover")).display, app: !!document.querySelector("#bkPreview iframe") };
  });
  check("동작 줄이기: 즉시 펼쳐지고 표지 애니메이션 없음", ok.open && ok.mover === "none" && ok.app, JSON.stringify(ok));
  check("동작 줄이기: 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await page.close(); await ctx.close();
}

await browser.close(); server.close();
console.log("\n=== 산출물 책장 점검 ===");
for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.detail && !c.ok ? "  — " + c.detail : ""}`);
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} 통과`);
fs.writeFileSync(`${OUT}/shelf-report.json`, JSON.stringify(checks, null, 2));
