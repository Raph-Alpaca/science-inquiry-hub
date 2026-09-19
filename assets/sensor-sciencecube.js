/* science-inquiry-hub — 사이언스큐브 무선 센서 어댑터
   무선 센서 실험실(Raph-Alpaca/sensor-lab)의 sciencecube/index.html 에서 옮겨 온 코드다.
   패킷: "{{" + base64(12바이트: CMD, 매개변수 10, 체크섬) + "}}" = 20바이트.
   CMD 는 ASCII 코드 체계로, 요청은 대문자 / 응답은 같은 문자의 소문자다.
   실기기로 확인된 것은 온도(WL100T)와 힘·가속도(WL105F)뿐이다. 나머지는 값 형식이 추정이라
   "미확인"으로 표시하고, 값이 예상 범위를 벗어나면 진단 로그로 알린다. */
(function () {
  const S = window.SIHSensor;
  const SVC = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
  const RX = "49535343-1e4d-4bd9-ba61-23c647249616";   // 기기 → 호스트 (notify)
  const TX = "49535343-8841-43f4-a8d4-ecbe34729bb3";   // 호스트 → 기기 (write)
  const SC_PREFIXES = ["SC:", "Smart", "KD"];
  const CMD = { NAME: 0x4e, SNAPSHOT: 0x53 };
  const ACK = { NAME: 0x6e, SNAPSHOT: 0x73, MEASURE: 0x6d, MULTI: 0x74, MULTI_UNIT: 0x75 };

  function buildPacket(cmd, params) {
    const body = new Uint8Array(12);
    body[0] = cmd;
    (params || []).slice(0, 10).forEach((v, i) => { body[i + 1] = v & 0xff; });
    let sum = 0;
    for (let i = 0; i < 11; i++) sum = (sum + body[i]) % 256;
    body[11] = sum;
    const b64 = btoa(String.fromCharCode.apply(null, body));
    return new Uint8Array([0x7b, 0x7b, ...Array.from(b64, (c) => c.charCodeAt(0)), 0x7d, 0x7d]);
  }
  /** 수신 바이트를 누적해 완성된 패킷만 잘라낸다. buf 는 기기별로 하나씩 둔다. */
  function feedFrames(buf, u8) {
    const out = [];
    for (const b of u8) buf.push(b);
    for (;;) {
      const i = buf.findIndex((b, k) => b === 0x7b && buf[k + 1] === 0x7b);
      if (i < 0) { if (buf.length > 64) buf.splice(0, buf.length - 64); return out; }
      if (buf.length < i + 20) { buf.splice(0, i); return out; }
      const pkt = buf.slice(i, i + 20);
      if (pkt[18] !== 0x7d || pkt[19] !== 0x7d) { buf.splice(0, i + 2); continue; }
      buf.splice(0, i + 20);
      let body;
      try { body = Uint8Array.from(atob(String.fromCharCode.apply(null, pkt.slice(2, 18))), (c) => c.charCodeAt(0)); }
      catch (e) { continue; }
      if (body.length < 12) continue;
      let sum = 0;
      for (let k = 0; k < 11; k++) sum = (sum + body[k]) % 256;
      out.push({ cmd: body[0], params: body.slice(1, 11), ok: sum === body[11], raw: pkt });
    }
  }

  /* 센서 표 — UID 접두어로 찾는다 (가장 긴 접두어가 이긴다). scales 는 네이티브 단위 배율,
     q/axis 는 표준 물리량, k 는 표준 단위로 가는 배율 (hPa → kPa 등) */
  const SC_SENSORS = [
    { id: "WL100T", ko: "온도", fmt: "float", verified: true, ch: [{ q: "temperature", min: -20, max: 125 }] },
    { id: "WL104P", ko: "pH", fmt: "float", ch: [{ q: "ph", min: 0, max: 14 }] },
    { id: "WL103P", ko: "압력", fmt: "float", ch: [{ q: "pressure", k: 0.1, min: 0, max: 120 }] },
    /* 값을 네이티브 단위의 100배로 보낸다 (실제 5.6 N 이 560). 가속도의 네이티브 단위는 g 라 m/s² 로 바꾼다. */
    { id: "WL105F", ko: "힘·가속도", verified: true, fast: true, scales: [0.01, 0.0980665, 0.0980665, 0.0980665],
      ch: [{ q: "force", min: -100, max: 100, zeroable: true }, { q: "acceleration", axis: "x", min: -40, max: 40 }, { q: "acceleration", axis: "y", min: -40, max: 40 }, { q: "acceleration", axis: "z", min: -40, max: 40 }] },
    { id: "WL125Y", ko: "조도·자외선", scales: [1, 0.1], ch: [{ q: "illuminance", min: 0, max: 32000 }, { q: "uvIndex", label: "자외선 지수", unit: "UVI", min: 0, max: 20 }] },
    { id: "WL133M", ko: "온습도·이산화탄소", scales: [0.1, 0.1, 1], ch: [{ q: "temperature", min: -20, max: 125 }, { q: "humidity", min: 0, max: 100 }, { q: "co2", min: 0, max: 10000 }] },
    { id: "WL134A", ko: "온도·압력", scales: [0.01, 0.1], ch: [{ q: "temperature", min: -20, max: 125 }, { q: "pressure", k: 0.1, min: 0, max: 120 }] },
    { id: "WL131", ko: "전력", scales: [0.001, 0.001, 0.001, 0.1],
      ch: [{ q: "voltage", min: -60, max: 60 }, { q: "current", min: -10, max: 10 }, { q: "power", label: "전력", unit: "W", min: -600, max: 600 }, { q: "energy", label: "전력량", unit: "Wh", min: 0, max: 100000 }] },
    { id: "WL001A", ko: "가속도", fast: true, scales: [0.01, 0.01, 0.01], ch: [{ q: "acceleration", axis: "x", min: -40, max: 40 }, { q: "acceleration", axis: "y", min: -40, max: 40 }, { q: "acceleration", axis: "z", min: -40, max: 40 }] },
    { id: "WCT100", ko: "스마트카트", fast: true, scales: [0.001, 0.001, 980665e-9],
      ch: [{ q: "distance", min: -10, max: 10 }, { q: "velocity", label: "속도", unit: "m/s", min: -20, max: 20 }, { q: "force", min: -100, max: 100, zeroable: true }] },
  ];
  function scLookup(uid) {
    let best = null;
    for (const s of SC_SENSORS) if (uid.startsWith(s.id) && (!best || s.id.length > best.id.length)) best = s;
    return best;
  }

  /* 값이 시작하는 자리는 ACK 종류마다 다르다 (실기기 두 대로 확인).
       0x75  09 | 4e | f4 ff 02 00 e1 ff a2 ff      힘 센서: len, 배터리, int16 4개
       0x74  09 | 00 4e | 00 00 d4 41 | 00 00 00    온도 센서: len, ?, 배터리, float32 26.5 */
  const SC_DATA_OFF = { 0x75: 2, 0x74: 3, 0x73: 3, 0x6d: 3 };   // 0x73·0x6d 는 미확인, 0x74 를 따랐다
  const scScale = (def, i) => (def.scales && def.scales[i] !== undefined ? def.scales[i] : 1);

  /** params 10바이트 → [{raw, value}] (표준 단위). 못 읽으면 null. */
  function scDecode(def, cmd, params) {
    const off = SC_DATA_OFF[cmd];
    if (off === undefined) return null;
    const len = params[0];
    const end = Math.min(1 + (len > 0 ? len : params.length - 1), params.length);
    const wide = def.fmt === "float" ? 4 : 2;
    if (end - off < wide) return null;
    const dv = new DataView(params.buffer, params.byteOffset, params.length);
    const out = [];
    for (let i = 0; i < def.ch.length; i++) {
      const at = off + i * wide;
      if (at + wide > end) { out.push({ raw: null, value: NaN }); continue; }
      const v = wide === 4 ? dv.getFloat32(at, true) : dv.getInt16(at, true);
      out.push({ raw: v, value: v * scScale(def, i) * (def.ch[i].k || 1) });
    }
    return out.some((o) => Number.isFinite(o.value)) ? out : null;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function open(device, ctx) {
    const nm = device.name || "";
    const dev = { buf: [], waiters: [], def: null, rxChar: null, txChar: null, seen: 0, open: true, opening: false, onValue: null, push: [] };
    const serial = (nm.match(/-(\w+)$/) || [, ""])[1] || (device.id || "").slice(0, 4);

    function send(cmd, params) {
      if (!dev.txChar) return Promise.resolve();
      const pkt = buildPacket(cmd, params);
      const p = dev.txChar.properties.writeWithoutResponse ? dev.txChar.writeValueWithoutResponse(pkt) : dev.txChar.writeValue(pkt);
      return p.catch((e) => ctx.log(`전송 실패: ${e.message}`));
    }
    function wait(cmd, ms) {
      return new Promise((resolve) => {
        const w = { cmd, resolve };
        w.timer = setTimeout(() => { dev.waiters = dev.waiters.filter((x) => x !== w); resolve(null); }, ms);
        dev.waiters.push(w);
      });
    }
    function onFrame(f) {
      dev.seen++; ctx.packet(f.raw);
      if (dev.seen <= 12) ctx.log(`◀ 0x${f.cmd.toString(16)}${f.ok ? "" : " (체크섬 불일치)"} ${S.hex(f.params)}`);
      if (!f.ok) return;
      const w = dev.waiters.find((x) => x.cmd === f.cmd);
      if (w) { clearTimeout(w.timer); dev.waiters = dev.waiters.filter((x) => x !== w); w.resolve(f); }
      if (f.cmd === ACK.NAME || !dev.def) return;
      if (f.cmd === ACK.SNAPSHOT || f.cmd === ACK.MEASURE || f.cmd === ACK.MULTI || f.cmd === ACK.MULTI_UNIT) {
        const vals = scDecode(dev.def, f.cmd, f.params);
        if (!vals) { if (dev.seen <= 12) ctx.log(`값 해석 실패: ${S.hex(f.params)}`); return; }
        if (!dev.shown) { dev.shown = true; ctx.log(`값 구조: ${dev.def.id} → ${dev.def.fmt === "float" ? "float32" : "int16"} [${vals.map((v) => v.raw).join(", ")}]${dev.def.verified ? "" : " · ⚠ 아직 실기기로 확인되지 않은 센서"}`); }
        vals.forEach((v, i) => {
          if (!dev.push[i] || !Number.isFinite(v.value)) return;
          const c = dev.def.ch[i], m = (c.max - c.min) * 0.25;
          // 형식이 틀리면 값이 터무니없이 나온다. 조용히 틀린 값을 쓰느니 크게 알린다
          if (!dev.warned && (v.value < c.min - m || v.value > c.max + m)) { dev.warned = true; ctx.log(`⚠ 값이 예상 범위(${c.min}~${c.max})를 벗어났습니다: ${v.value}. 값 형식이 다를 수 있습니다 — 이 로그를 알려 주세요.`); }
          dev.push[i](v.value, { raw: v.raw });
        });
      }
    }

    /* GATT 연결 + 특성 확보 + 구독. 윈도우 크롬은 connect() 직후 서비스를 묻는 사이에 끊기기도 해서
       연결부터 구독까지를 한 덩어리로 보고 통째로 다시 시도한다. */
    async function scOpen(tries) {
      let lastErr = null;
      dev.opening = true;
      try {
        for (let n = 1; n <= tries; n++) {
          try {
            if (!device.gatt.connected) await device.gatt.connect();
            await sleep(300);                   // 연결 직후 바로 물으면 끊기는 기기가 있다
            if (!device.gatt.connected) throw new Error("연결 직후 끊어졌습니다");
            const svc = await device.gatt.getPrimaryService(SVC);
            dev.rxChar = await svc.getCharacteristic(RX);
            dev.txChar = await svc.getCharacteristic(TX);
            dev.buf.length = 0;
            await dev.rxChar.startNotifications();
            if (dev.onValue) dev.rxChar.removeEventListener("characteristicvaluechanged", dev.onValue);
            dev.onValue = (ev) => { const dv = ev.target.value; for (const f of feedFrames(dev.buf, new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength))) onFrame(f); };
            dev.rxChar.addEventListener("characteristicvaluechanged", dev.onValue);
            if (n > 1) ctx.log(`${n}번째 시도에서 연결 성공`);
            return;
          } catch (e) {
            lastErr = e;
            ctx.log(`연결 시도 ${n}/${tries} 실패: ${e.message}`);
            dev.rxChar = null; dev.txChar = null;
            try { device.gatt.disconnect(); } catch (_) { /* 반쯤 열린 상태 정리 */ }
            if (n < tries) { ctx.status(`연결 중… (${n + 1}/${tries})`); await sleep(500 + n * 500); }
          }
        }
        throw lastErr || new Error("연결할 수 없습니다");
      } finally { dev.opening = false; }
    }
    /** REQ_NAME → ACK_NAME. params[0] 이 이름 길이, 그 뒤가 UID 문자열이다. */
    async function handshake() {
      for (let n = 1; n <= 3; n++) {
        const p = wait(ACK.NAME, 1500);
        await send(CMD.NAME);
        const f = await p;
        if (f) {
          const len = Math.min(f.params[0] || 9, 9);
          const uid = String.fromCharCode.apply(null, f.params.slice(1, 1 + len)).replace(/\0/g, "").trim();
          if (uid) return uid;
        }
        ctx.log(`이름 응답 없음 (${n}/3)`);
      }
      return null;
    }

    await scOpen(5);
    const uid = await handshake();
    if (!uid) throw new Error("연결은 됐지만 센서가 이름 요청에 응답하지 않았습니다. 전원을 껐다 켠 뒤 다시 시도해 주세요.");
    const known = scLookup(uid);
    const tag = nm.replace(/^SC:/, "").replace(/-\d+$/, "").trim();
    dev.def = known || { id: uid, ko: tag || "센서", unknown: true, ch: [{ q: "unknown", label: tag || "측정값", unit: "", min: -1e6, max: 1e6 }] };
    ctx.log(`센서 UID "${uid}" → ${dev.def.ko}${known ? "" : " (표에 없는 센서 — int16 첫 값을 그대로 보여 줍니다)"}`);
    dev.push = dev.def.ch.map((c) => ctx.channel({ quantity: c.q, axis: c.axis, label: c.label, unit: c.unit, zeroable: c.zeroable, verified: !!dev.def.verified }));

    // 0.5초마다(빠른 센서는 0.1초) 스냅샷을 요청한다
    const period = dev.def.fast && ctx.want.some((q) => q === "force" || q === "acceleration" || q === "distance") ? 100 : 500;
    (async () => { while (dev.open) { if (dev.txChar && device.gatt.connected && !dev.opening) await send(CMD.SNAPSHOT); await sleep(period); } })();

    /* 수업 중 끊기면 곤란하므로 스스로 다시 붙는다. 쉬지 않고 두드리면 윈도우 블루투스가 오히려 더 안 열려서
       짧게 세 번만, 간격을 크게 벌려 시도한다. */
    device.addEventListener("gattserverdisconnected", async () => {
      if (!dev.open || dev.opening || dev.retrying) return;
      dev.retrying = true; dev.rxChar = null; dev.txChar = null;
      const WAITS = [3000, 15000, 40000];
      for (let n = 0; n < WAITS.length && dev.open; n++) {
        ctx.status(`연결이 끊겨 ${Math.round(WAITS[n] / 1000)}초 뒤 다시 연결합니다… (${n + 1}/${WAITS.length})`);
        await sleep(WAITS[n]);
        if (!dev.open) return;
        try { await scOpen(2); ctx.status("다시 연결됨"); ctx.log("재연결 성공"); dev.retrying = false; return; }
        catch (e) { ctx.log(`재연결 ${n + 1}/${WAITS.length} 실패: ${e.message}`); }
      }
      dev.retrying = false;
      if (dev.open) { dev.open = false; ctx.lost("연결이 끊어졌습니다. 센서가 절전으로 꺼졌을 수 있습니다 — 전원을 켠 뒤 다시 연결해 주세요"); }
    });

    return { label: `${dev.def.ko} ${serial}`, verified: !!dev.def.verified, close() { dev.open = false; try { device.gatt.disconnect(); } catch (e) { /* 무시 */ } } };
  }

  S.register({
    id: "sciencecube", label: "사이언스큐브",
    filters: SC_PREFIXES.map((p) => ({ namePrefix: p })),
    services: [SVC],
    match: (d) => SC_PREFIXES.some((p) => (d.name || "").startsWith(p)),
    open,
  });
  S._sciencecube = { buildPacket, feedFrames, scDecode, scLookup };
})();
