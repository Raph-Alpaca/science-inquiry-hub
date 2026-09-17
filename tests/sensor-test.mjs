// 실시간 센서 모드 검사. 실물 센서 없이 두 가지로 확인한다.
//  1) 가상 센서(?sensor=virtual)로 네 앱의 센서 모드 시나리오를 끝까지 돌린다.
//  2) 가짜 navigator.bluetooth 에 업체별 패킷 바이트를 흘려, 기기 판별·연결·값 해석을 어댑터 네 개 모두 확인한다.
// 그리고 측정값이 페이지 밖으로 나가지 않는지(외부 요청·GET 이외 요청 0건) 본다.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2]);
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".txt": "text/plain; charset=utf-8" };
const served = [];
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  served.push(p);
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: !!ok, detail: String(detail) }); };

// 가짜 Web Bluetooth. window.__fakeNext 에 적힌 종류의 기기를 "사용자가 고른 것"처럼 돌려준다.
const FAKE_BLE = () => {
  const bytesOf = (v) => (v instanceof Uint8Array ? v : new Uint8Array(v.buffer || v, v.byteOffset || 0, v.byteLength));
  class Char extends EventTarget {
    constructor(uuid, props, onWrite) { super(); this.uuid = uuid; this.properties = props; this.onWrite = onWrite; this.written = []; }
    async startNotifications() { return this; }
    async writeValueWithoutResponse(v) { const b = bytesOf(v); this.written.push(b); if (this.onWrite) setTimeout(() => this.onWrite(b, this), 5); }
    async writeValue(v) { return this.writeValueWithoutResponse(v); }
    notify(bytes) { const u = Uint8Array.from(bytes); this.value = new DataView(u.buffer); this.dispatchEvent(new Event("characteristicvaluechanged")); }
  }
  function device(name, services) {
    const d = new EventTarget();
    d.name = name; d.id = "fake-" + name; d.services = services;
    d.gatt = {
      connected: false,
      async connect() { this.connected = true; return this; },
      disconnect() { if (!this.connected) return; this.connected = false; d.dispatchEvent(new Event("gattserverdisconnected")); },
      async getPrimaryServices() { return services; },
      async getPrimaryService(u) { const s = services.find((x) => x.uuid === u); if (!s) throw new Error("no service"); return s; },
    };
    return d;
  }
  const service = (uuid, chars) => ({ uuid, chars, async getCharacteristics() { return chars; }, async getCharacteristic(u) { const c = chars.find((x) => x.uuid === u); if (!c) throw new Error("no char"); return c; } });

  // PASCO: 채널마다 서비스 하나. 0002 에 [05, 크기] 를 쓰면 0003 으로 [C0 00 05 …원시값] 이 온다
  function pasco(name, raws) {
    const svcs = raws.map((raw, i) => {
      const s = i + 1, u = (c) => `4a5c000${s}-000${c}-0000-0000-5c1e741f1c00`;
      const rx = new Char(u(3), { notify: true });
      const tx = new Char(u(2), { writeWithoutResponse: true }, (b) => { if (b[0] === 0x05) rx.notify([0xc0, 0x00, 0x05, ...raw]); });
      return service(`4a5c000${s}-0000-0000-0000-5c1e741f1c00`, [tx, rx, new Char(u(5), { writeWithoutResponse: true })]);
    });
    return device(name, svcs);
  }
  // 사이언스큐브: REQ_NAME(4e) → ACK_NAME(6e, 길이+UID), REQ_SNAPSHOT(53) → 실기기에서 받은 그대로의 응답
  function sciencecube(name, uid, ackCmd, params) {
    const SC = () => window.SIHSensor._sciencecube;
    const rx = new Char("49535343-1e4d-4bd9-ba61-23c647249616", { notify: true });
    const tx = new Char("49535343-8841-43f4-a8d4-ecbe34729bb3", { writeWithoutResponse: true }, (b) => {
      const f = SC().feedFrames([], b)[0]; if (!f) return;
      if (f.cmd === 0x4e) rx.notify(SC().buildPacket(0x6e, [uid.length, ...Array.from(uid, (c) => c.charCodeAt(0))]));
      if (f.cmd === 0x53) { const p = SC().buildPacket(ackCmd, params); rx.notify(p.slice(0, 7)); rx.notify(p.slice(7)); }   // 패킷이 둘로 쪼개져 와도 되는지
    });
    return device(name, [service("49535343-fe7d-4ae5-8fa9-9fafd205e455", [rx, tx])]);
  }
  // EZMaker: 보드에 설정된 센서 번호를 알려 주고, SET_SENSOR 로 바뀌면 그 센서의 값을 보낸다
  function ezmaker(name, boardSensor, valuesById) {
    const EZ = () => window.SIHSensor._ezmaker;
    const st = { id: boardSensor, timer: null, setSensor: null };
    const tx = new Char("6e400003-b5a3-f393-e0a9-e50e24dcca9e", { notify: true });
    const f32 = (v) => Array.from(new Uint8Array(new Float32Array([v]).buffer));
    const rx = new Char("6e400002-b5a3-f393-e0a9-e50e24dcca9e", { writeWithoutResponse: true }, (b) => {
      const cmd = b[2];
      if (cmd === 11) tx.notify(EZ().buildResponse(0x8b, 0, Uint8Array.from([1, 2, 3, 1, 4, 0, st.id, 0xe8, 3, 0, 0, 0, 0, 0])));
      if (cmd === 2) { st.id = b[5]; st.setSensor = b[5]; tx.notify(EZ().buildResponse(0x82, 0)); }
      if (cmd === 4) {
        tx.notify(EZ().buildResponse(0x84, 0));
        st.timer = setInterval(() => tx.notify(EZ().buildFrame(8, Uint8Array.from([st.id, 1, 0, 0, 0, ...(valuesById[st.id] || [0]).flatMap(f32)]))), 120);
      }
      if (cmd === 5) clearInterval(st.timer);
    });
    const d = device(name, [service("6e400001-b5a3-f393-e0a9-e50e24dcca9e", [rx, tx])]);
    d.fake = st;
    return d;
  }
  const KINDS = {
    "pasco-temp": () => pasco("Temperature 201-761>18", [[26797 & 255, 26797 >> 8]]),                         // 0.00268127×26797−46.85 = 25.0 ℃
    "pasco-force": () => pasco("Force Accel 123-456>48", [[30000 & 255, 30000 >> 8], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]]),
    "sc-temp": () => sciencecube("SC:TEMP-742", "WL100T742", 0x74, [0x09, 0x00, 0x4e, 0x00, 0x00, 0xd4, 0x41, 0, 0, 0]),   // float32 26.5
    "sc-force": () => sciencecube("SC:FORCE-105", "WL105F105", 0x75, [0x09, 0x4e, 0xf4, 0xff, 0x02, 0x00, 0xe1, 0xff, 0xa2, 0xff]),
    "ez-light": () => ezmaker("EZ-0A1B", 20, { 22: [36.6], 20: [512] }),
    "ez-dht": () => ezmaker("EZ-0C2D", 23, { 23: [24.5, 61] }),
    "gdx-temp": () => device("GDX-TMP 0F1038K2", []),
    unknown: () => device("Mi Band 7", [service("0000fee0-0000-1000-8000-00805f9b34fb", [])]),
  };
  window.__fake = { requests: [], devices: [] };
  Object.defineProperty(Navigator.prototype, "bluetooth", { configurable: true, get: () => ({
    async requestDevice(o) { window.__fake.requests.push(o); const d = KINDS[window.__fakeNext](); window.__fake.devices.push(d); return d; },
  }) });
  // Go Direct 라이브러리 자리. 어댑터가 넘긴 기기로 createDevice 를 부르는지, 값이 전달되는지만 본다
  window.godirect = {
    async createDevice(native, opt) {
      window.__fake.gdxArgs = { name: native.name, opt };
      const sensor = { number: 1, name: "Temperature", unit: "°C", enabled: true, value: null, setEnabled(v) { this.enabled = v; }, on(ev, fn) { this.fn = fn; } };
      return { name: native.name, orderCode: "GDX-TMP", batteryLevel: 90, sensors: [sensor], handlers: {}, enableDefaultSensors() {}, on(ev, fn) { this.handlers[ev] = fn; },
        async stop() {}, async start(period) { window.__fake.gdxPeriod = period; setInterval(() => { sensor.value = 31.2; sensor.fn(sensor); }, 100); }, close() {} };
    },
  };
};
const NO_BLE = () => Object.defineProperty(Navigator.prototype, "bluetooth", { configurable: true, get: () => undefined });

const browser = await chromium.launch();
const external = [], nonGet = [];
async function open(p, query = "", init = null, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol === "blob:" || u.protocol === "data:") return;
    if (u.hostname !== "127.0.0.1" && !(u.hostname === "cdn.jsdelivr.net" && u.pathname.includes("/pretendard"))) external.push(r.url());
    if (r.method() !== "GET") nonGet.push(`${r.method()} ${r.url()}`);
  });
  await page.goto(`${BASE}/apps/${p}.html${query}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  return { page, errors, close: () => ctx.close() };
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const wantChannel = (page, n = 1) => page.waitForFunction((n) => window.SIHSensor && SIHSensor.channels.filter((c) => c.count > 0).length >= n, n, { timeout: 8000 });

// ---------- 0. 시뮬레이션만 쓸 때는 센서 코드를 내려받지 않는다 ----------
{
  served.length = 0;
  const { page, errors, close } = await open("g1-insulation");
  check("시뮬레이션 모드: 센서 스크립트를 불러오지 않음", !served.some((p) => p.includes("sensor")), served.filter((p) => p.includes("sensor")).join(","));
  check("센서가 없는 앱(g2-gas 등)은 센서 선택이 비활성", await (async () => { const g = await open("g2-gas"); const d = await g.page.$eval('#srcSel option[value="sensor"]', (o) => o.disabled); await g.close(); return d; })());
  check("센서를 쓰는 앱은 센서 선택이 활성", !(await page.$eval('#srcSel option[value="sensor"]', (o) => o.disabled)) && errors.length === 0, errors.join(" | "));
  await close();
}

// ---------- 1. 가상 센서 시나리오 ----------
{ // 단열: 두 센서가 컵 A·B, 실제 시간축, 이론 곡선 겹침, CSV 는 이 기기로만
  const { page, errors, close } = await open("g1-insulation", "?sensor=virtual&vspeed=120");
  await wantChannel(page, 2);
  check("단열·가상: 센서 모드로 열리고 가상 값임을 알림", (await page.evaluate(() => SIH.source)) === "sensor" && (await page.textContent("#sbNotice")).includes("가상 데이터"));
  await page.click("#run"); await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({ a: meas.A.length, b: meas.B.length, A: meas.A[meas.A.length - 1], B: meas.B[meas.B.length - 1], t, rec: SIHSensor.rec.rows.length }));
  check("단열·가상: 두 컵의 실측 곡선이 쌓임 (실제 분 단위 시간축)", r.a > 5 && r.b > 5 && r.t > 3 && r.t < 8, JSON.stringify(r));
  check("단열·가상: 스티로폼 컵 A 가 컵 B 보다 천천히 식음", r.A[1] > r.B[1] + 3, `${r.A[1]} vs ${r.B[1]}`);
  await page.fill("#memo", "차이 벌어짐"); await page.click("#addMemo");
  await page.click("#sbDiag > summary");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 4000 }).catch(() => null), page.click("#sbCsv")]);
  const csv = dl ? fs.readFileSync(await dl.path(), "utf8") : "";
  const lines = csv.trim().split("\n");
  check("단열·가상: CSV 로컬 내려받기 (머리글 + 두 열 + 여러 행)", dl && (await dl.suggestedFilename()).endsWith(".csv") && lines[0].includes("elapsed_s") && lines[0].split(",").length === 4 && lines.length > 10, lines[0]);
  check("단열·가상: 진단 표에 원시 값·속도 표시", (await page.textContent("#sbTable")).includes("Hz"));
  await page.screenshot({ path: `${OUT}/insulation-virtual.png`, fullPage: true });
  await page.click("#run");                                  // 멈추면 더 쌓이지 않는다
  const n1 = await page.evaluate(() => meas.A.length); await page.waitForTimeout(700);
  check("단열·가상: 측정을 멈추면 곡선·기록이 멈춤", (await page.evaluate(() => meas.A.length)) === n1);
  await page.selectOption("#srcSel", "sim"); await page.waitForTimeout(300);
  check("단열: 시뮬레이션으로 되돌리면 센서 연결이 풀리고 기존 동작", (await page.evaluate(() => SIHSensor.devices.length === 0 && SIH.source === "sim")) && (await page.isHidden("#sensorBar")));
  await page.click("#run"); await page.waitForTimeout(800);
  check("단열: 되돌린 뒤 시뮬레이션 냉각이 진행", (await page.evaluate(() => t)) > 1);
  check("단열·가상: 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await close();
}
{ // 가열: 실측 온도가 상태 표시를 움직이고, 0 ℃ 에 머문 구간을 찾아냄
  const { page, errors, close } = await open("g1-heating", "?sensor=virtual&vspeed=20");
  await wantChannel(page);
  await page.click("#heat"); await page.waitForTimeout(5500);
  const r = await page.evaluate(() => ({ n: mpts.length, t, liveT, pl: plateaus(), label: document.getElementById("state").textContent }));
  const p0 = r.pl.find((b) => b.at === 0);
  check("가열·가상: 실측 곡선이 쌓이고 상태 표시가 실측 온도를 따름", r.n > 8 && r.label === "액체(물)" && r.liveT > 5, JSON.stringify({ n: r.n, t: r.t, liveT: r.liveT, label: r.label }));
  check("가열·가상: 0 ℃ 근처에 머문 구간(약 60 s)을 실측에서 찾음", p0 && Math.abs(p0.x2 - p0.x1 - 66) < 20, JSON.stringify(r.pl));
  await page.screenshot({ path: `${OUT}/heating-virtual.png`, fullPage: true });
  check("가열·가상: 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await close();
}
{ // 이슬점: 온습도 센서가 공기를, 온도 센서가 컵을 맡는다
  const { page, errors, close } = await open("g3-dewpoint", "?sensor=virtual&vspeed=20");
  await wantChannel(page, 3);
  await page.waitForTimeout(700);
  const air = await page.evaluate(() => ({ T, w, probe, airMeasured, dis: document.getElementById("T").disabled, dp: dewOf(Math.min(w, sat(T))) }));
  check("이슬점·가상: 온습도 센서 값이 기온·수증기량 입력이 됨 (24 ℃·55 % → 약 12 g/m³)", air.airMeasured && air.probe && air.dis && Math.abs(air.T - 24) < 0.3 && Math.abs(air.w - 12) < 0.5, JSON.stringify(air));
  await page.fill("#pred", "15"); await page.click("#cool");
  await page.waitForFunction((dp) => cupT <= dp + 0.3, air.dp, { timeout: 15000 });
  await page.click("#sawDew");
  const res = await page.textContent("#res"), dewAt = await page.evaluate(() => dewAt);
  check("이슬점·가상: 실측 컵 온도에서 이슬 확인 → 이론 이슬점·예측과 비교", res.includes("이슬을 보았어요") && res.includes("예측") && Math.abs(dewAt - air.dp) < 1.5, `${res} / dp=${air.dp.toFixed(2)}`);
  await page.screenshot({ path: `${OUT}/dewpoint-virtual.png`, fullPage: true });
  check("이슬점·가상: 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await close();
}
{ // 진자: 장력 실측을 이론과 겹치고, 최대 장력에서 운동 에너지를 구함
  const { page, errors, close } = await open("g3-energy", "?sensor=virtual");
  await wantChannel(page);
  check("에너지·가상: 트랙 탭에서는 시뮬레이션 그대로 (힘 센서는 진자 탭 안내)", (await page.isHidden("#forceBox")) && (await page.textContent("#msg")).includes("진자 탭"));
  await page.click("#tabP");
  check("에너지·가상: 진자 탭에서 실제 질량·줄 길이 입력으로 바뀜", (await page.isVisible("#lenCm")) && (await page.isHidden("#len")) && (await page.evaluate(() => L === 0.5 && m === 0.2)));
  await page.click("#go"); await page.waitForTimeout(6000);
  const r = await page.evaluate(() => ({ n: fpts.length, meas, th: { Tmax: theory.Tmax, period: theory.period }, E0: Etotal() }));
  check("진자·가상: 실측 최대 장력 ≈ 이론 mg(3−2cosθ) (5 % 이내)", r.meas && Math.abs(r.meas.Tmax / r.th.Tmax - 1) < 0.05, `${r.meas?.Tmax} / ${r.th.Tmax}`);
  check("진자·가상: 실측 주기 ≈ 이론 주기 (5 % 이내)", r.meas && Math.abs(r.meas.period / r.th.period - 1) < 0.05, `${r.meas?.period} / ${r.th.period}`);
  check("진자·가상: 최대 장력으로 구한 운동 에너지 ≈ 처음 위치 에너지 (12 % 이내)", r.meas && Math.abs(r.meas.KE / r.E0 - 1) < 0.12, `${r.meas?.KE} / ${r.E0}`);
  await page.screenshot({ path: `${OUT}/energy-virtual.png`, fullPage: true });
  await page.click(".sb-zero"); await page.waitForTimeout(200);
  check("진자·가상: 영점 버튼이 보정값을 만듦", await page.evaluate(() => SIHSensor.channels[0].offset !== 0));
  check("진자·가상: 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await close();
}
for (const p of ["g1-insulation", "g1-heating", "g3-dewpoint", "g3-energy"]) { // 휴대폰 너비에서 센서 막대가 넘치지 않는지
  const { page, close } = await open(p, "?sensor=virtual", null, { width: 380, height: 800 });
  await wantChannel(page);
  if (p === "g3-energy") await page.click("#tabP");
  await page.click("#sbDiag > summary"); await page.waitForTimeout(400);
  check(`380px: ${p} 센서 막대·진단 가로 넘침 없음`, await noOverflow(page));
  await page.screenshot({ path: `${OUT}/mobile-${p}.png`, fullPage: true });
  await close();
}

// ---------- 2. 지원하지 않는 브라우저 ----------
{
  const { page, errors, close } = await open("g1-insulation", "", NO_BLE);
  await page.selectOption("#srcSel", "sensor"); await page.waitForTimeout(600);
  check("미지원 브라우저: 안내 문구를 보이고 시뮬레이션 모드 유지", (await page.textContent("#sbNotice")).includes("지원하지 않습니다") && (await page.evaluate(() => SIH.source)) === "sim" && (await page.inputValue("#srcSel")) === "sim" && (await page.isDisabled("#sbConnect")));
  await page.click("#run"); await page.waitForTimeout(800);
  check("미지원 브라우저: 시뮬레이션이 그대로 동작", (await page.evaluate(() => t)) > 1);
  await page.click("#reset"); await page.click("#sbVirtual"); await wantChannel(page);
  check("미지원 브라우저: 가상 센서 체험은 가능 (그때 센서 모드로)", (await page.evaluate(() => SIH.source)) === "sensor");
  check("미지원 브라우저: 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await close();
}

// ---------- 3. 가짜 블루투스로 어댑터 네 개 ----------
async function connectFake(app, kind) {
  const o = await open(app, "", FAKE_BLE);
  await o.page.selectOption("#srcSel", "sensor"); await o.page.waitForSelector("#sbConnect");
  await o.page.evaluate((k) => (window.__fakeNext = k), kind);
  await o.page.click("#sbConnect");
  return o;
}
const chan = (page) => page.evaluate(() => SIHSensor.channels.map((c) => ({ q: c.quantity, axis: c.axis, v: c.last, raw: c.raw, unit: c.unit, src: c.source, ok: c.verified })));
{
  const { page, errors, close } = await connectFake("g1-heating", "pasco-temp");
  await wantChannel(page);
  const req = await page.evaluate(() => window.__fake.requests[0]);
  const prefixes = (req.filters || []).map((f) => f.namePrefix).filter(Boolean);
  check("연결 버튼 하나: 기기 선택 창 한 번에 네 업체의 이름·서비스가 모두 들어감", ["Temperature", "Force Accel", "SC:", "EZ", "GDX"].every((p) => prefixes.includes(p)) && ["4a5c0001-0000-0000-0000-5c1e741f1c00", "49535343-fe7d-4ae5-8fa9-9fafd205e455", "6e400001-b5a3-f393-e0a9-e50e24dcca9e", "d91714ef-28b9-4f91-ba16-f0d9a604f112"].every((u) => req.optionalServices.includes(u)), prefixes.join(","));
  const c = await chan(page);
  check("PASCO 온도: 이름으로 판별, 원시값 26797 → 25.0 ℃", c.length === 1 && c[0].src === "pasco" && c[0].q === "temperature" && c[0].v === 25 && c[0].raw === 26797, JSON.stringify(c));
  check("PASCO 온도: 표준 스트림이 앱으로 전달 (상태 표시 = 액체)", (await page.evaluate(() => liveT)) === 25 && (await page.textContent("#state")) === "액체(물)");
  await page.click("#sbDiag > summary"); await page.waitForTimeout(400);
  const diag = await page.textContent("#sbDiag");
  check("진단: 연결 상태·마지막 패킷(16진수)·로그 표시", diag.includes("c0 00 05 ad 68") && diag.includes("연결됨") && diag.includes("인터페이스 1025"), diag.slice(0, 200));
  await page.evaluate(() => window.__fake.devices[0].gatt.disconnect()); await page.waitForTimeout(300);
  check("PASCO: 연결이 끊기면 목록에서 빠지고 안내", (await page.evaluate(() => SIHSensor.devices.length)) === 0 && (await page.textContent("#sbNotice")).includes("끊겼습니다"));
  check("PASCO 온도: 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await close();
}
{
  const { page, errors, close } = await connectFake("g3-energy", "pasco-force");
  await wantChannel(page);
  const c = await chan(page), want = +(50 * (32768 - 30000) / (32768 - 5000)).toFixed(2);
  check(`PASCO 힘·가속도: 힘 채널만 두드림, 원시값 30000 → ${want} N`, c.length === 1 && c[0].q === "force" && c[0].v === want, JSON.stringify(c));
  check("PASCO 힘: 가속도·자이로 채널에는 요청을 보내지 않음", await page.evaluate(() => window.__fake.devices[0].services.slice(1).every((s) => s.chars[0].written.length === 0)));
  check("PASCO 힘: 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await close();
}
{
  const { page, errors, close } = await connectFake("g1-insulation", "sc-temp");
  await wantChannel(page);
  const c = await chan(page);
  check("사이언스큐브 온도: UID WL100T → float32 26.5 ℃ (둘로 쪼개진 패킷 이어 붙임)", c.length === 1 && c[0].src === "sciencecube" && c[0].v === 26.5, JSON.stringify(c));
  check("사이언스큐브 온도 → 단열 앱의 컵 A", (await page.textContent("#tA")) === "26.5 ℃" && (await page.textContent("#tB")) === "센서 없음");
  check("사이언스큐브 온도: 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await close();
}
{
  const { page, errors, close } = await connectFake("g3-energy", "sc-force");
  await wantChannel(page, 4);
  const c = await chan(page), f = c.find((x) => x.q === "force"), z = c.find((x) => x.axis === "z");
  check("사이언스큐브 힘·가속도: int16 −12 → −0.12 N, 가속도 g → m/s² (−94 → −9.22)", f && Math.abs(f.v + 0.12) < 1e-9 && z && Math.abs(z.v + 9.218) < 0.01 && z.unit === "m/s²", JSON.stringify(c));
  check("사이언스큐브 힘: 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await close();
}
{
  const { page, errors, close } = await connectFake("g1-insulation", "ez-light");
  await wantChannel(page);
  const c = await chan(page), set = await page.evaluate(() => window.__fake.devices[0].fake.setSensor);
  check("EZMaker: 보드가 밝기센서(20)로 설정돼 있어도 앱이 온도를 원하면 수중접촉온도센서(22)로 지정", set === 22 && c.length === 1 && c[0].q === "temperature" && Math.abs(c[0].v - 36.6) < 0.01, `set=${set} ${JSON.stringify(c)}`);
  check("EZMaker 온도: 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await close();
}
{
  const { page, errors, close } = await connectFake("g3-dewpoint", "ez-dht");
  await wantChannel(page, 2); await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ set: window.__fake.devices[0].fake.setSensor, T, w, airMeasured, probe }));
  check("EZMaker 온습도(23): 보드 설정을 그대로 쓰고, 이슬점 앱의 기온·습도 입력이 됨", r.set === 23 && r.airMeasured && !r.probe && Math.abs(r.T - 24.5) < 0.01 && r.w > 12 && r.w < 15, JSON.stringify(r));
  check("EZMaker 온습도: 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await close();
}
{
  served.length = 0;
  const { page, errors, close } = await connectFake("g1-heating", "gdx-temp");
  await wantChannel(page);
  const c = await chan(page), g = await page.evaluate(() => ({ a: window.__fake.gdxArgs, p: window.__fake.gdxPeriod }));
  check("Vernier: 고른 기기를 godirect.createDevice 로 넘기고 값(31.2 ℃)을 받음", g.a.name.startsWith("GDX") && g.a.opt.startMeasurements === false && g.p === 500 && c[0].src === "vernier" && c[0].q === "temperature" && c[0].v === 31.2, JSON.stringify({ g, c }));
  check("Vernier: 콘솔 오류 없음", errors.length === 0, errors.join(" | "));
  await close();
}
{ // 저장소에 넣어 둔 Go Direct 라이브러리가 실제로 열리는지 (CDN 을 쓰지 않는다)
  const { page, close } = await open("g1-heating");
  const ok = await page.evaluate(() => new Promise((res) => { const s = document.createElement("script"); s.src = "../assets/vendor/godirect.min.umd.js"; s.onload = () => res(typeof godirect.createDevice === "function" && typeof godirect.selectDevice === "function"); s.onerror = () => res(false); document.head.appendChild(s); }));
  check("Vernier: assets/vendor 의 godirect 라이브러리가 열림", ok);
  await close();
}
{
  const { page, close } = await connectFake("g1-heating", "unknown");
  await page.waitForFunction(() => !document.getElementById("sbNotice").hidden, null, { timeout: 5000 });
  check("모르는 기기: 연결하지 않고 안내", (await page.textContent("#sbNotice")).includes("해석할 수 없는") && (await page.evaluate(() => SIHSensor.devices.length)) === 0);
  await close();
}

// ---------- 4. 외부 전송 없음 ----------
check("측정 데이터 외부 전송 없음: 글꼴 CDN 말고는 외부 요청 0건", external.length === 0, external.join(" | "));
check("측정 데이터 외부 전송 없음: GET 이외의 요청 0건", nonGet.length === 0, nonGet.join(" | "));
{
  const src = ["sensor.js", "sensor-pasco.js", "sensor-sciencecube.js", "sensor-ezmaker.js", "sensor-vernier.js", "sensor-virtual.js"].map((f) => fs.readFileSync(path.join(ROOT, "assets", f), "utf8")).join("\n");
  check("센서 코드에 전송 API 없음 (fetch·XMLHttpRequest·sendBeacon·WebSocket)", !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/.test(src));
}

await browser.close(); server.close();
console.log("=== 센서 모드 점검 ===");
for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.detail && !c.ok ? "  — " + c.detail : ""}`);
console.log(`\n점검 ${checks.filter((c) => c.ok).length}/${checks.length} 통과`);
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ checks }, null, 2));
if (checks.some((c) => !c.ok)) process.exitCode = 1;
