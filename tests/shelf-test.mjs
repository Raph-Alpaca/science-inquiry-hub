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
    check(`${vn}: 선생님 예시 9권 + 학생 책 4권`, info.books === 13 || vn === "mobile", `${info.books}권`);
    check(`${vn}: 가로 넘침 없음`, info.scrollW <= info.W + 1, `${info.scrollW} > ${info.W}`);
    check(`${vn}: 승인 대기 책은 공개 책장에 없음`, !info.html.includes("우리 학교 기온 기록"));
    check(`${vn}: 모둠원 이름이 공개 화면에 없음`, !/김하늘|이서준|최민준|정수아/.test(info.html));
    check(`${vn}: 빈 서가 안내 문구`, info.html.includes("아직 꽂힌 책이 없어요"));

    // 책 펼치기
    const first = vn === "mobile" ? ".book-row" : ".book";
    await page.click(`${first}[data-i="9"]`);       // 학생 책 (산불 확산 시뮬레이션)
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
    await page.waitForTimeout(500);
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

// 6-1) 책장 설정에서 삭제
{
  const ctx = await browser.newContext({ viewport: VIEWS.laptop });
  const { page, errors } = await open(ctx, "/teacher.html?demo=1");
  await page.waitForSelector(".shelf-card");
  page.on("dialog", (d) => d.accept());
  await page.click('[data-a="settings"]');
  await page.waitForTimeout(500);
  check("삭제 안내에 책 권수 표시", /권/.test(await page.textContent("#sh-delnote")));
  await page.click("#sh-del");
  await page.waitForTimeout(1500);
  check("책장 삭제 후 첫 화면으로", (await page.textContent("#main")).includes("학교 책장 만들기"));
  check("책장 삭제 중 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await page.close(); await ctx.close();
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
