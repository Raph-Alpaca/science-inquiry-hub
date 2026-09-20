// 기기 마이크·카메라 앱 검사 (소리 측정실, 빛의 색 측정기). 실제 기기 없이 세 가지로 확인한다.
//  1) 앱의 계산 함수(진동수 찾기, 색 분석)에 만든 신호·화소를 넣어 본다.
//  2) 크롬의 가짜 마이크·카메라에 우리가 만든 WAV·Y4M 파일을 흘려 실제 입력 경로를 끝까지 돌린다.
//  3) 권한 거부·미지원 브라우저, 색 화면 모드, CSV, 외부 전송 0건.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: !!ok, detail: String(detail) }); };

// ---------- 가짜 입력 파일 ----------
function wav(file, f0, harm, amp = 0.5, sr = 48000, sec = 2) {
  const n = sr * sec, data = Buffer.alloc(n * 2);
  const norm = Math.sqrt(harm.reduce((s, v) => s + v * v, 0));
  // 파일이 되풀이될 때 끊기지 않게 정수 주기로 맞춘다
  const f = Math.round(f0 * sec) / sec;
  for (let i = 0; i < n; i++) {
    let v = 0; for (let k = 0; k < harm.length; k++) v += harm[k] * Math.sin(2 * Math.PI * f * (k + 1) * i / sr);
    data.writeInt16LE(Math.round(32767 * amp * v / norm), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
function y4m(file, [r, g, b], W = 320, H = 240, frames = 10) {
  // BT.601 제한 범위 YUV
  const Y = Math.round(16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255);
  const U = Math.round(128 + (-37.797 * r - 74.203 * g + 112 * b) / 255);
  const V = Math.round(128 + (112 * r - 93.786 * g - 18.214 * b) / 255);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), Buffer.alloc(W * H, Y), Buffer.alloc((W / 2) * (H / 2), U), Buffer.alloc((W / 2) * (H / 2), V)]);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`), ...Array(frames).fill(frame)]));
}
const F = n => path.join(OUT, n);
wav(F("sine440.wav"), 440, [1]);
wav(F("recorder262.wav"), 262, [1, 0.32, 0.14, 0.06, 0.03]);
y4m(F("yellow.y4m"), [255, 255, 0]);
y4m(F("blue.y4m"), [0, 0, 255]);

// ---------- 공통 ----------
const external = [], nonGet = [];
async function launch(extra = []) {
  return chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", ...extra] });
}
async function open(browser, app, { init, permissions = ["microphone", "camera"], viewport = { width: 1280, height: 860 } } = {}) {
  const ctx = await browser.newContext({ viewport, permissions, acceptDownloads: true });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push("[pageerror] " + e.message));
  page.on("request", r => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:") && !u.includes("cdn.jsdelivr.net/gh/orioncactus/pretendard")) external.push(u);
    if (r.method() !== "GET") nonGet.push(r.method() + " " + u);
  });
  await page.goto(`${BASE}/apps/${app}.html`, { waitUntil: "networkidle" });
  return { page, errors, close: () => ctx.close() };
}
const num = s => parseFloat(String(s).replace(/[^\d.\-]/g, ""));

// ---------- 1. 계산 함수 ----------
{
  const b = await launch();
  const { page, errors, close } = await open(b, "g1-sound-lab");
  const r = await page.evaluate(() => {
    const make = (f, harm, sr, n = 8192, amp = 0.5, noise = 0) => {
      const x = new Float32Array(n), norm = Math.hypot(...harm);
      for (let i = 0; i < n; i++) { let v = 0; harm.forEach((h, k) => (v += h * Math.sin(2 * Math.PI * f * (k + 1) * i / sr + k))); x[i] = amp * v / norm + (Math.random() - 0.5) * noise; }
      return x;
    };
    const saw = Array.from({ length: 14 }, (_, k) => 1 / (k + 1));
    const cases = [[100, [1], 48000], [262, [1], 48000], [440, [1], 44100], [1000, [1], 48000], [1500, [1], 44100], [262, [1, 0.32, 0.14, 0.06, 0.03], 48000], [196, saw, 48000], [330, saw, 44100], [523, [1, 0.8, 0.6, 0.4], 48000, 8192, 0.3, 0.05]];
    const out = cases.map(([f, h, sr, n, a, nz]) => ({ want: f, got: detectPitch(make(f, h, sr, n, a, nz), sr).f }));
    const noise = new Float32Array(8192).map(() => (Math.random() - 0.5) * 0.6);
    const quiet = make(440, [1], 48000, 8192, 0.002);
    const sine60 = detectPitch(make(440, [1], 48000, 8192, 0.6), 48000).a;
    const spec = spectrum(make(440, [1], 48000), 48000);
    const top = spec.reduce((m, p) => (p[1] > m[1] ? p : m));
    return { out, noise: detectPitch(noise, 48000).f, quiet: detectPitch(quiet, 48000), sine60, top: top[0], note: [noteName(262), noteName(440)] };
  });
  const bad = r.out.filter(c => !c.got || Math.abs(c.got - c.want) / c.want > 0.01);
  check("소리: 진동수 찾기 100~1500 Hz 사인파, 44.1·48 kHz (오차 1% 미만)", bad.filter(c => c.want !== 262 && c.want !== 196 && c.want !== 330 && c.want !== 523).length === 0 && r.out.slice(0, 5).every(c => c.got), JSON.stringify(r.out));
  check("소리: 배음이 센 리코더·바이올린 파형도 한 옥타브 틀리지 않음", bad.length === 0, JSON.stringify(bad));
  check("소리: 잡음은 진동수를 내지 않고, 아주 작은 소리는 '조용함'", r.noise === null && r.quiet.quiet === true && r.quiet.f === null, `${r.noise} / ${JSON.stringify(r.quiet)}`);
  check("소리: 진폭 0.6 사인파 → 진폭 표시 60", Math.abs(r.sine60 - 60) < 0.5, r.sine60);
  check("소리: 진동수 분석 그래프의 가장 큰 봉우리가 440 Hz 근처", Math.abs(r.top - 440) < 6, r.top);
  check("소리: 음 이름 262 Hz = 도(C4), 440 Hz = 라(A4)", r.note[0] === "도 (C4)" && r.note[1] === "라 (A4)", r.note.join(", "));

  // 연습용 소리 화면
  await page.click('.keys .btn[data-f="523"]');
  check("소리: 연습용 '높은 도' → 진동수 523 Hz·주기 1.91 ms", Math.abs(num(await page.textContent("#fNow")) - 523) <= 1 && (await page.textContent("#tNow")) === "1.91 ms", await page.textContent("#fNow"));
  await page.selectOption("#timbre", "violin");
  check("소리: 바이올린 느낌으로 바꿔도 523 Hz", Math.abs(num(await page.textContent("#fNow")) - 523) <= 1, await page.textContent("#fNow"));
  await page.fill("#lbl", "높은 도"); await page.click("#capA");
  await page.click('.keys .btn[data-f="262"]'); await page.$eval("#amp", el => { el.value = 30; el.dispatchEvent(new Event("input")); });
  await page.fill("#lbl", "=작은 도"); await page.click("#capB");
  const t = await page.evaluate(() => ({ fA: fA.textContent, fB: fB.textContent, aA: +aA.textContent, aB: +aB.textContent, logs: document.querySelectorAll("#log li").length }));
  check("소리: A·B에 담으면 표에 진동수·진폭, 기록에 2줄", t.fA === "523 Hz" && t.fB === "262 Hz" && Math.abs(t.aA - 60) < 1.5 && Math.abs(t.aB - 30) < 1.5 && t.logs === 2, JSON.stringify(t));
  await page.click("#tabSpec"); await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/sound-sim-spectrum.png` });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#csv")]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  check("소리: CSV 에 머리글과 담은 두 소리, '='로 시작하는 이름은 수식이 되지 않게 ' 를 붙임", dl.suggestedFilename().endsWith(".csv") && csv.includes("진동수(Hz)") && csv.includes("높은 도") && csv.includes(`"'=작은 도"`), csv.slice(0, 200));
  check("소리 (계산·연습용): 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await close();

  const c = await open(b, "g1-color");
  const cr = await c.page.evaluate(() => {
    const px = (r, g, bb) => { const a = new Uint8ClampedArray(64); for (let i = 0; i < 64; i += 4) { a[i] = r; a[i + 1] = g; a[i + 2] = bb; a[i + 3] = 255; } return analyzePixels(a); };
    const cases = { 빨강: [255, 0, 0], 초록: [0, 255, 0], 파랑: [0, 0, 255], 노랑: [255, 255, 0], 청록: [0, 255, 255], 자홍: [255, 0, 255], 흰색: [255, 255, 255], 회색: [128, 128, 128], 검정: [10, 10, 10], 주황: [255, 128, 0], 보라: [128, 0, 255], 연두: [128, 255, 0] };
    const names = Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, px(...v).name]));
    // 반은 빨강, 반은 초록인 네모: 빛의 양으로 평균하면 노랑 쪽(빨강:초록 = 50:50)
    const half = new Uint8ClampedArray(64); for (let i = 0; i < 64; i += 4) { const red = i < 32; half[i] = red ? 255 : 0; half[i + 1] = red ? 0 : 255; half[i + 3] = 255; }
    return { names, y: px(255, 255, 0).share, w: px(255, 255, 255).share, half: analyzePixels(half) };
  });
  const wrong = Object.entries(cr.names).filter(([k, v]) => k !== v);
  check("색: 빨강·초록·파랑·노랑·청록·자홍·흰색·회색·검정·주황·보라·연두 이름", wrong.length === 0, JSON.stringify(wrong));
  check("색: 노랑 = 빨강 50% + 초록 50%, 흰색 = 세 빛 33%씩", Math.round(cr.y[0]) === 50 && Math.round(cr.y[1]) === 50 && cr.y[2] < 0.5 && cr.w.every(v => Math.abs(v - 33.3) < 0.2), JSON.stringify([cr.y, cr.w]));
  check("색: 빨강·초록 화소가 반씩이면 빛의 양으로 평균해 빨강:초록 50:50", Math.abs(cr.half.share[0] - 50) < 0.5 && Math.abs(cr.half.share[1] - 50) < 0.5, JSON.stringify(cr.half));

  // 시뮬레이션: 대상 고르기 → 빛 섞기 → 예측 → 측정 기록
  await c.page.selectOption("#target", "100,100,0");
  check("색 시뮬레이션: '빨강 + 초록 빛'을 고르면 슬라이더가 맞춰지고 노랑으로 측정", (await c.page.inputValue("#lG")) === "100" && (await c.page.textContent("#cname")) === "노랑", await c.page.textContent("#cname"));
  await c.page.selectOption("#pred", "노랑"); await c.page.click("#measure");
  await c.page.selectOption("#target", "0,100,100"); await c.page.selectOption("#pred", "파랑"); await c.page.click("#measure");
  const rows = await c.page.$$eval("#log tr", trs => trs.map(tr => [...tr.children].map(td => [td.textContent, td.className])));
  check("색 시뮬레이션: 예측이 맞으면 초록 글씨, 틀리면 빨강 글씨로 기록", rows.length === 2 && rows[0][2][0] === "노랑 → 노랑" && rows[0][2][1] === "yes" && rows[1][2][0] === "파랑 → 청록" && rows[1][2][1] === "no", JSON.stringify(rows));
  check("색 시뮬레이션: 틀린 예측에 안내 문장", (await c.page.textContent("#msg")).includes("청록"));
  await c.page.selectOption("#target", "free");
  check("색: '직접 적기'를 고르면 이름 칸이 보임", await c.page.isVisible("#freeText"));
  const [dl2] = await Promise.all([c.page.waitForEvent("download"), c.page.click("#csv")]);
  const csv2 = fs.readFileSync(await dl2.path(), "utf8");
  check("색: CSV 에 대상·예측·측정·빛의 비율", csv2.includes("빨강 빛(%)") && csv2.includes("빨강 + 초록 빛") && csv2.includes("청록"), csv2.slice(0, 160));
  await c.page.screenshot({ path: `${OUT}/color-sim.png` });

  // 색 화면
  await c.page.click("#screenBtn");
  const s1 = await c.page.evaluate(() => ({ vis: !document.getElementById("screen").hidden, bg: getComputedStyle(document.getElementById("screen")).backgroundColor }));
  for (let i = 0; i < 10; i++) await c.page.keyboard.press("Tab");
  const trapped = await c.page.evaluate(() => document.getElementById("bar2").contains(document.activeElement) && document.getElementById("screen").getAttribute("role") === "dialog");
  check("색 화면: 대화상자로 표시되고 Tab 을 눌러도 포커스가 버튼 줄 안에 머묾", trapped);
  await c.page.click('#bar2 [data-c="#ffff00"]');
  const bg2 = await c.page.evaluate(() => getComputedStyle(document.getElementById("screen")).backgroundColor);
  await c.page.screenshot({ path: `${OUT}/color-screen.png` });
  await c.page.keyboard.press("Escape");
  await c.page.waitForFunction(() => document.activeElement.id === "screenBtn", null, { timeout: 2000 }).catch(() => {});
  const s3 = await c.page.evaluate(() => ({ hidden: document.getElementById("screen").hidden, focus: document.activeElement.id }));
  check("색 화면: 열면 빨강 전체 화면, 빨+초 → 노랑, Esc 로 닫고 버튼에 포커스 복귀", s1.vis && s1.bg === "rgb(255, 0, 0)" && bg2 === "rgb(255, 255, 0)" && s3.hidden && s3.focus === "screenBtn", JSON.stringify({ s1, bg2, s3 }));
  check("색 (계산·시뮬레이션): 콘솔 오류 없음", c.errors.length === 0, c.errors.join(" | "));
  await c.close();
  await b.close();
}

// ---------- 2. 가짜 마이크 ----------
for (const [file, want, label] of [["sine440.wav", 440, "사인파 440 Hz"], ["recorder262.wav", 262, "리코더 느낌 262 Hz"]]) {
  const b = await launch([`--use-file-for-fake-audio-capture=${F(file)}`]);
  const { page, errors, close } = await open(b, "g1-sound-lab");
  await page.click("#micBtn");
  let f = NaN;
  try {
    await page.waitForFunction(w => { const v = parseFloat(document.getElementById("fNow").textContent); return Math.abs(v - w) / w < 0.01; }, want, { timeout: 8000 });
    f = num(await page.textContent("#fNow"));
  } catch { f = await page.textContent("#fNow"); }
  const st = await page.evaluate(() => ({ src: SIH.source, sel: srcSel.value, live: srcDot.classList.contains("live"), simHidden: simBox.hidden, btn: micBtn.textContent, a: +aNow.textContent, msg: msg.textContent }));
  check(`가짜 마이크 ${label}: 진동수 ${want} Hz 로 읽음`, Math.abs(f - want) / want < 0.01, `${f} ${JSON.stringify(st)}`);
  check(`가짜 마이크 ${label}: 데이터 칸·버튼·연습용 소리 숨김이 마이크 상태로 바뀜`, st.src === "sensor" && st.sel === "sensor" && st.live && st.simHidden && st.btn === "마이크 끄기" && st.a > 5, JSON.stringify(st));
  if (want === 440) {
    await page.check("#freeze"); const fr1 = await page.evaluate(() => frame[100]); await page.waitForTimeout(300); const fr2 = await page.evaluate(() => frame[100]);
    check("가짜 마이크: '화면 멈추기'를 켜면 파형이 멈춤", fr1 === fr2);
    await page.fill("#lbl", "소리굽쇠 라"); await page.click("#capA");
    check("가짜 마이크: 멈춘 소리를 A에 담음", (await page.textContent("#fA")) === "440 Hz", await page.textContent("#fA"));
    await page.uncheck("#freeze");
    await page.screenshot({ path: `${OUT}/sound-mic.png` });
    await page.click("#micBtn");
    const off = await page.evaluate(() => ({ stream, src: SIH.source, btn: micBtn.textContent, simHidden: simBox.hidden, f: fNow.textContent }));
    check("가짜 마이크: 끄면 마이크를 닫고 연습용 소리로 돌아감", off.stream === null && off.src === "sim" && off.btn === "마이크 켜기" && !off.simHidden && off.f === "262 Hz", JSON.stringify(off));
    // 상단 데이터 칸으로도 켜고 끌 수 있는지
    await page.selectOption("#srcSel", "sensor");
    await page.waitForFunction(() => stream && stream.getAudioTracks()[0].readyState === "live", null, { timeout: 5000 });
    const track = await page.evaluateHandle(() => stream.getAudioTracks()[0]);
    await page.selectOption("#srcSel", "sim");
    check("가짜 마이크: 데이터 칸으로 켜고 끄기, 끄면 마이크 트랙이 끝남", (await track.evaluate(t => t.readyState)) === "ended");
  }
  check(`가짜 마이크 ${label}: 콘솔 오류 없음`, errors.length === 0, errors.join(" | "));
  await close(); await b.close();
}

// ---------- 2-1. 빠르게 켜고 끄기 (권한 창을 기다리는 사이에 다시 누르는 경우) ----------
{
  const b = await launch([`--use-file-for-fake-audio-capture=${F("sine440.wav")}`, `--use-file-for-fake-video-capture=${F("yellow.y4m")}`]);
  // getUserMedia 를 늦게 끝나게 만들고, 돌려준 스트림을 모두 기록한다
  const slow = () => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__streams = [];
    navigator.mediaDevices.getUserMedia = async (c) => { const s = await real(c); await new Promise(r => setTimeout(r, 400)); window.__streams.push(s); return s; };
  };
  for (const [app, btn, word] of [["g1-sound-lab", "#micBtn", "마이크"], ["g1-color", "#camBtn", "카메라"]]) {
    const { page, errors, close } = await open(b, app, { init: slow });
    const cleared = await page.evaluate(sel => { document.querySelector(sel).click(); return typeof est === "undefined" ? null : est; }, btn);
    await page.click(btn); await page.click(btn);           // 켬 → 끔 → 다시 켬 (첫 요청은 아직 기다리는 중)
    await page.waitForFunction(() => window.__streams.length >= 2, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    const mid = await page.evaluate(() => ({ live: window.__streams.filter(s => s.getTracks().some(t => t.readyState === "live")).length, src: SIH.source, msg: msg.textContent }));
    await page.click(btn);                                    // 끔
    await page.waitForTimeout(200);
    const end = await page.evaluate(() => ({ live: window.__streams.filter(s => s.getTracks().some(t => t.readyState === "live")).length, n: window.__streams.length, videos: document.querySelectorAll("video").length }));
    check(`${word} 빠르게 켜고 끄기: 켜진 스트림은 하나뿐이고, 끄면 모두 닫힘`, mid.live === 1 && mid.src === "sensor" && !mid.msg.includes("못했") && end.live === 0 && end.n === 2 && end.videos === 0, JSON.stringify({ mid, end }));
    if (app === "g1-color") check("카메라: 켜는 즉시 이전 시뮬레이션 색을 지워 카메라 값으로 잘못 기록되지 않음", cleared === null, JSON.stringify(cleared));
    check(`${word} 빠르게 켜고 끄기: 콘솔 오류 없음`, errors.length === 0, errors.join(" | "));
    await close();
  }
  await b.close();
}

// ---------- 3. 가짜 카메라 ----------
for (const [file, want, label, rgb] of [["yellow.y4m", "노랑", "노랑 화면", "RG"], ["blue.y4m", "파랑", "파랑 화면", "B"]]) {
  const b = await launch([`--use-file-for-fake-video-capture=${F(file)}`]);
  const { page, errors, close } = await open(b, "g1-color");
  await page.click("#camBtn");
  let name = "";
  try { await page.waitForFunction(w => document.getElementById("cname").textContent === w, want, { timeout: 8000 }); } catch { /* 아래 점검에서 드러남 */ }
  name = await page.textContent("#cname");
  const share = await page.evaluate(() => est.share.map(Math.round));
  const okShare = rgb === "RG" ? Math.abs(share[0] - share[1]) < 12 && share[2] < 10 : share[2] > 80;
  check(`가짜 카메라 ${label}: '${want}'으로 읽고 빛의 비율이 맞음`, name === want && okShare, `${name} ${share}`);
  const st = await page.evaluate(() => ({ src: SIH.source, btn: camBtn.textContent, simHidden: simBox.hidden, cap: cap.textContent.includes("같은 폰") }));
  check(`가짜 카메라 ${label}: 버튼·빛 섞기 숨김·안내 문구가 카메라 상태로 바뀜`, st.src === "sensor" && st.btn === "카메라 끄기" && st.simHidden && st.cap, JSON.stringify(st));
  if (want === "노랑") {
    await page.selectOption("#target", "100,100,0"); await page.selectOption("#pred", "노랑"); await page.click("#measure");
    const row = await page.$$eval("#log tr td", tds => tds.map(td => td.textContent));
    check("가짜 카메라: 카메라로 측정한 값이 기록되고, 대상을 골라도 카메라 모드는 그대로", row[2] === "노랑 → 노랑" && (await page.evaluate(() => SIH.source)) === "sensor", row.join(" / "));
    const px = await page.evaluate(() => { const c = document.getElementById("view"); const d = c.getContext("2d").getImageData(c.width / 4, c.height / 4, 1, 1).data; return [...d]; });
    check("가짜 카메라: 카메라 영상이 미리보기에 그려짐", px[0] > 180 && px[1] > 180 && px[2] < 80, px.join(","));
    await page.screenshot({ path: `${OUT}/color-camera.png` });
    // 물체의 색 탭: 카메라는 그대로 켜 두고, 기록에 같은 조건의 모형 결과를 함께 남긴다
    await page.click("#tabObj"); await page.selectOption("#obj", "banana"); await page.click('#lampBtns [data-l="0,100,0"]');
    await page.selectOption("#pred", "초록"); await page.click("#measure");
    const orow = await page.$$eval("#log tr", trs => [...trs.at(-1).children].map(td => td.textContent));
    check("가짜 카메라 · 물체의 색: 카메라 측정값과 같은 조건의 모형 색을 함께 기록", (await page.evaluate(() => SIH.source)) === "sensor" && orow[1] === "노란 바나나 + 초록 빛" && orow[2] === "초록 → 노랑 (모형: 초록)" && (await page.textContent("#objWhy")).startsWith("모형으로 보면"), orow.join(" / "));
    await page.click("#tabMix");
    const track = await page.evaluateHandle(() => stream.getVideoTracks()[0]);
    await page.click("#camBtn");
    const off = await page.evaluate(() => ({ stream, src: SIH.source, name: cname.textContent }));
    check("가짜 카메라: 끄면 카메라 트랙이 끝나고 빛 섞기로 돌아감", (await track.evaluate(t => t.readyState)) === "ended" && off.stream === null && off.src === "sim", JSON.stringify(off));
  }
  check(`가짜 카메라 ${label}: 콘솔 오류 없음`, errors.length === 0, errors.join(" | "));
  await close(); await b.close();
}

// ---------- 4. 권한 거부·미지원 ----------
{
  const b = await chromium.launch();
  const deny = () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError")); };
  for (const [app, btn, word] of [["g1-sound-lab", "#micBtn", "마이크"], ["g1-color", "#camBtn", "카메라"]]) {
    const d = await open(b, app, { init: deny, permissions: [] });
    await d.page.click(btn); await d.page.waitForTimeout(300);
    const r = await d.page.evaluate(() => ({ src: SIH.source, sel: srcSel.value, msg: msg.textContent, live: srcDot.classList.contains("live") }));
    check(`${word} 권한 거부: 안내 문장을 남기고 시뮬레이션으로 되돌아감`, r.src === "sim" && r.sel === "sim" && !r.live && r.msg.includes("허용"), JSON.stringify(r));
    check(`${word} 권한 거부: 콘솔 오류 없음`, d.errors.length === 0, d.errors.join(" | "));
    await d.close();
    const u = await open(b, app, { init: () => { Object.defineProperty(navigator, "mediaDevices", { value: undefined }); } });
    await u.page.click(btn); await u.page.waitForTimeout(200);
    const r2 = await u.page.evaluate(() => ({ src: SIH.source, msg: msg.textContent }));
    check(`${word} 미지원 브라우저: 안내하고 시뮬레이션 유지`, r2.src === "sim" && r2.msg.includes("지원하지"), JSON.stringify(r2));
    await u.close();
  }
  // 휴대폰 폭에서 가로 넘침 없음 (색 화면 포함)
  for (const app of ["g1-sound-lab", "g1-color"]) {
    const m = await open(b, app, { viewport: { width: 380, height: 800 } });
    const ov = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`휴대폰 380px: ${app} 가로 넘침 없음`, ov <= 0, ov);
    await m.page.screenshot({ path: `${OUT}/mobile-${app}.png`, fullPage: true });
    await m.close();
  }
  await b.close();
}

// ---------- 5. 외부 전송 없음 ----------
check("외부 전송 없음: 글꼴 CDN 말고는 외부 요청 0건", external.length === 0, external.join(" | "));
check("외부 전송 없음: GET 이외의 요청 0건", nonGet.length === 0, nonGet.join(" | "));
{
  const src = ["g1-sound-lab.html", "g1-color.html"].map(f => fs.readFileSync(path.join(ROOT, "apps", f), "utf8")).join("\n");
  check("두 앱 코드에 전송·녹음 저장 API 없음 (fetch·XMLHttpRequest·sendBeacon·WebSocket·MediaRecorder)", !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|MediaRecorder/.test(src));
}

server.close();
console.log("=== 마이크·카메라 앱 점검 ===");
for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.detail && !c.ok ? "  — " + c.detail : ""}`);
console.log(`\n점검 ${checks.filter(c => c.ok).length}/${checks.length} 통과`);
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ checks }, null, 2));
if (checks.some(c => !c.ok)) process.exitCode = 1;
