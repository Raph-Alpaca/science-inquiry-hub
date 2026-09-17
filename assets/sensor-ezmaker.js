/* science-inquiry-hub — EZMaker 무선 보드 어댑터 (BLE, Nordic UART)
   무선 센서 실험실(Raph-Alpaca/sensor-lab)의 ezmaker/index.html 에서 옮겨 온 코드다. USB(Web Serial)는 넣지 않았다.
   프레임: C0 | PV cmd len16 payload CRC8 | C1  (바이트 스터핑 DB DC/DD/DE)
   보드는 꽂힌 센서를 스스로 알지 못한다. 그래서 앱이 원하는 물리량에 맞는 센서 번호를 호스트가 정해 준다.
   보드에 이미 설정된 센서가 원하는 값을 주면 그대로 두고, 아니면 물리량별 기본 센서로 바꾼다. */
(function () {
  const S = window.SIHSensor;
  const NUS_SVC = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // 호스트 → 기기 (write)
  const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // 기기 → 호스트 (notify)
  const NAME_PREFIX = "EZ";
  const PV = 0x11, SOP = 0xc0, EOP = 0xc1, ESC = 0xdb;
  const CMD = { SET_SENSOR: 2, TIME_SYNC: 3, START: 4, STOP: 5, GET_DEVICE_INFO: 11 };
  const NTF = { SAMPLE: 8, BURST: 9, SENSOR_ERROR: 0x86 };
  const RESP = { SET_NAME: 0x81, SET_SENSOR: 0x82, TIME_SYNC_MAC: 0x83, START: 0x84, STOP: 0x85, SET_LED: 0x88, SENSOR_RESET: 0x8a, DEVICE_INFO: 0x8b, SCHEDULE_START: 0x8c, SCHEDULE_CANCEL: 0x8d, TIME_SYNC_RTT: 0x8f };
  const RESP_SET = new Set(Object.values(RESP));
  const RESULT = { 0: "성공", 1: "일반 오류", 2: "알 수 없는 명령", 3: "길이 오류", 4: "센서 번호 오류", 5: "CRC 오류", 6: "프로토콜 버전 불일치", 7: "기기 사용 중", 8: "센서가 꽂혀 있지 않음", 9: "저장 공간 부족", 10: "잘못된 설정값" };

  /** CRC-8. 기본은 poly 0x31 MSB-first, 구형 펌웨어용으로 반전형(0x8C)도 지원한다. */
  function crc8(bytes, m) {
    let c = 0;
    if (m === "lsb8c") { for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? (c >> 1) ^ 0x8c : c >> 1; } return c & 0xff; }
    for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x31) & 0xff : (c << 1) & 0xff; }
    return c;
  }
  function stuff(bytes) {
    const out = [];
    for (const b of bytes) { if (b === SOP) out.push(ESC, 0xdc); else if (b === EOP) out.push(ESC, 0xdd); else if (b === ESC) out.push(ESC, 0xde); else out.push(b); }
    return Uint8Array.from(out);
  }
  function unstuff(bytes) {
    const out = [];
    for (let i = 0; i < bytes.length; i++) {
      let b = bytes[i];
      if (b === ESC) { const n = bytes[++i]; if (n === 0xdc) b = SOP; else if (n === 0xdd) b = EOP; else if (n === 0xde) b = ESC; else return null; }
      out.push(b);
    }
    return Uint8Array.from(out);
  }
  function wrapFrame(body, m) {
    const s = stuff(Uint8Array.from([...body, crc8(body, m)]));
    const out = new Uint8Array(s.length + 2);
    out[0] = SOP; out.set(s, 1); out[out.length - 1] = EOP;
    return out;
  }
  /** 명령/알림 프레임: PV cmd len16 payload CRC */
  const buildFrame = (cmd, payload = new Uint8Array(0), m = "msb31") => wrapFrame(Uint8Array.from([PV, cmd, payload.length & 0xff, (payload.length >> 8) & 0xff, ...payload]), m);
  /** 응답 프레임: PV cmd result len16 data CRC */
  const buildResponse = (cmd, result, data = new Uint8Array(0), m = "msb31") => wrapFrame(Uint8Array.from([PV, cmd, result, data.length & 0xff, (data.length >> 8) & 0xff, ...data]), m);

  function parseAsNotify(f, m) {
    if (f.length < 5) return null;
    const len = f[2] | (f[3] << 8);
    if (f.length !== 4 + len + 1 || f[f.length - 1] !== crc8(f.slice(0, -1), m)) return null;
    return { type: "notify", pv: f[0], cmd: f[1], len, data: f.slice(4, -1) };
  }
  function parseAsResponse(f, m) {
    if (f.length < 6) return null;
    const len = f[3] | (f[4] << 8);
    if (f.length !== 5 + len + 1 || f[f.length - 1] !== crc8(f.slice(0, -1), m)) return null;
    return { type: "response", pv: f[0], cmd: f[1], result: f[2], len, data: f.slice(5, -1) };
  }
  /** 바이트 스트림 → 프레임. 알림 한 건이 프레임 하나라는 보장이 없어 상태머신으로 받는다. CRC 방식은 자동 판별. */
  function makeParser(link, onFrame, onDrop) {
    let inFrame = false, data = [], startAt = 0;
    function parseFrame(f) {
      const order = link.crcMode === "msb31" ? ["msb31", "lsb8c"] : ["lsb8c", "msb31"];
      for (const m of order) {
        const r = RESP_SET.has(f[1]) ? parseAsResponse(f, m) || parseAsNotify(f, m) : parseAsNotify(f, m) || parseAsResponse(f, m);
        if (r) { if (m !== link.crcMode) { link.crcMode = m; onDrop(`CRC 방식을 ${m}로 전환했습니다`); } return r; }
      }
      return null;
    }
    return function push(bytes) {
      const now = performance.now();
      if (inFrame && startAt && now - startAt > 2000) { inFrame = false; data = []; onDrop("2초 초과로 프레임 버림"); }
      for (const b of bytes) {
        if (!inFrame) { if (b === SOP) { inFrame = true; data = []; startAt = now; } continue; }
        if (b === SOP) { data = []; startAt = now; continue; }
        if (b === EOP) {
          inFrame = false;
          const raw = unstuff(Uint8Array.from(data)); data = [];
          if (!raw) { onDrop("이스케이프 오류"); continue; }
          const f = parseFrame(raw);
          if (!f) { onDrop("CRC/길이 불일치 " + S.hex(raw)); continue; }
          if (f.pv !== PV) { onDrop("프로토콜 버전 불일치 0x" + f.pv.toString(16)); continue; }
          onFrame(f, raw);
          continue;
        }
        data.push(b);
        if (data.length > 1024) { inFrame = false; data = []; onDrop("프레임 1024B 초과"); }
      }
    };
  }
  const u16le = (v) => [v & 0xff, (v >> 8) & 0xff];
  const u32le = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  function timeSyncPayload(d) {
    return Uint8Array.from([...u16le(d.getUTCFullYear()), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), ...u16le(d.getUTCMilliseconds())]);
  }

  /* 무선 센서 번호표에서 표준 물리량으로 옮길 수 있는 것. min = 최소 측정 주기(ms), k = 표준 단위로 가는 배율.
     표에 없는 번호는 보드에 설정돼 있어도 "값 1, 값 2…" 로 그대로 보여 준다. */
  const SENSORS = {
    11: { n: "고온센서", min: 200, ch: [{ q: "temperature" }] },
    14: { n: "기압센서 (기압)", min: 100, ch: [{ q: "pressure", k: 0.1 }] },              // hPa → kPa
    15: { n: "기압센서 (온도)", min: 100, ch: [{ q: "temperature" }] },
    16: { n: "무게센서", min: 200, ch: [{ q: "force", k: 0.00980665, zeroable: true }] }, // g → N (g중)
    22: { n: "수중접촉온도센서", min: 1000, ch: [{ q: "temperature" }] },
    23: { n: "온습도센서", min: 1000, ch: [{ q: "temperature" }, { q: "humidity" }] },
    24: { n: "이산화탄소센서", min: 1000, ch: [{ q: "co2" }] },
    26: { n: "자이로 · 가속도", min: 10, ch: [{ q: "acceleration", axis: "x" }, { q: "acceleration", axis: "y" }, { q: "acceleration", axis: "z" }] },
    27: { n: "자이로 · 각속도", min: 10, ch: [{ q: "angularVelocity", axis: "x" }, { q: "angularVelocity", axis: "y" }, { q: "angularVelocity", axis: "z" }] },
    32: { n: "전류센서 (전류)", min: 10, ch: [{ q: "current", k: 0.001 }] },              // mA → A
    35: { n: "전압센서", min: 10, ch: [{ q: "voltage" }] },
    36: { n: "초음파 거리센서", min: 50, ch: [{ q: "distance", k: 0.01 }] },              // cm → m
  };
  const DEFAULT_FOR = { temperature: 22, humidity: 23, force: 16, acceleration: 26, angularVelocity: 27, co2: 24, pressure: 14, voltage: 35, current: 32, distance: 36 };
  const gives = (id, want) => !!SENSORS[id] && SENSORS[id].ch.some((c) => want.includes(c.q));

  async function open(device, ctx) {
    const link = { crcMode: "msb31", open: true, pending: [], sensorId: null, push: [], info: null };
    const gatt = await device.gatt.connect();
    const svc = await gatt.getPrimaryService(NUS_SVC);
    const rx = await svc.getCharacteristic(NUS_RX), tx = await svc.getCharacteristic(NUS_TX);

    const send = async (cmd, payload) => {
      const bytes = buildFrame(cmd, payload, link.crcMode);
      if (rx.writeValueWithoutResponse) await rx.writeValueWithoutResponse(bytes); else await rx.writeValue(bytes);
    };
    const expect = (respCmd, ms) => new Promise((resolve, reject) => {
      const w = { respCmd, resolve };
      w.timer = setTimeout(() => { link.pending = link.pending.filter((x) => x !== w); reject(new Error("응답 시간 초과")); }, ms);
      link.pending.push(w);
    });
    function setSensorChannels(id) {
      if (link.sensorId === id) return;
      if (link.sensorId !== null) ctx.clearChannels();   // 보드 쪽 센서가 바뀌면 보드를 따른다
      link.sensorId = id;
      const def = SENSORS[id];
      ctx.log(`측정 센서: ${def ? def.n : "번호 " + id + " (표준 물리량 표에 없음)"}`);
      link.def = def || null; link.push = [];   // 표에 없는 센서의 채널은 값이 올 때 개수에 맞춰 만든다
      if (def) link.push = def.ch.map((c) => ctx.channel({ quantity: c.q, axis: c.axis, zeroable: c.zeroable }));
    }
    function record(id, vals) {
      setSensorChannels(id);
      vals.forEach((v, i) => {
        if (!link.push[i] && !link.def) link.push[i] = ctx.channel({ quantity: "raw" + (i + 1), label: `값 ${i + 1}`, unit: "", verified: false });
        if (link.push[i]) link.push[i](v * ((link.def && link.def.ch[i] && link.def.ch[i].k) || 1), { raw: v });
      });
    }
    function handleSample(d) {
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), vals = [];
      let id, from;
      if (d.length >= 5 && d.length % 4 === 1) { id = dv.getUint8(0); from = 5; }
      else if (d.length >= 12 && d.length % 4 === 0) { id = dv.getUint8(3); from = 12; }
      else { ctx.log(`⚠ SAMPLE 길이 이상: ${d.length}B`); return; }
      for (let i = from; i + 4 <= d.length; i += 4) vals.push(dv.getFloat32(i, true));
      record(id, vals);
    }
    function handleBurst(d) {
      if (d.length < 13) return;
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      if (d.length === 13) { record(dv.getUint8(0), [dv.getFloat32(5, true)]); record(dv.getUint8(0), [dv.getFloat32(9, true)]); return; }
      if (d.length < 20) return;
      const id = dv.getUint8(3), nSample = dv.getUint8(18), nChan = dv.getUint8(19);
      if (20 + nSample * nChan * 4 !== d.length) { ctx.log(`⚠ BURST 길이 불일치 (${d.length}B)`); return; }
      let p = 20;
      for (let i = 0; i < nSample; i++) { const vals = []; for (let c = 0; c < nChan; c++) { vals.push(dv.getFloat32(p, true)); p += 4; } record(id, vals); }
    }
    const parser = makeParser(link, (f, raw) => {
      ctx.packet(raw);
      if (f.type === "response") {
        if (f.cmd === RESP.DEVICE_INFO && f.data.length >= 14) {
          const dv = new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength);
          link.info = { fw: `${f.data[3]}.${f.data[4]}.${f.data[5]}`, sensorId: f.data[6], intervalMs: dv.getUint32(7, true) };
          ctx.log(`펌웨어 ${link.info.fw} · 보드에 설정된 센서 번호 ${link.info.sensorId} · 주기 ${link.info.intervalMs}ms`);
        }
        const w = link.pending.find((x) => x.respCmd === f.cmd);
        if (w) { clearTimeout(w.timer); link.pending = link.pending.filter((x) => x !== w); w.resolve(f); }
        return;
      }
      if (f.cmd === NTF.SAMPLE) handleSample(f.data);
      else if (f.cmd === NTF.BURST) handleBurst(f.data);
      else if (f.cmd === NTF.SENSOR_ERROR) ctx.log(`⚠ 보드가 센서 오류를 알려 왔습니다 (센서 번호 ${f.data[0] ?? "?"}). 센서가 제대로 꽂혔는지 확인하세요.`);
    }, (why) => ctx.log("프레임: " + why));

    await tx.startNotifications();
    tx.addEventListener("characteristicvaluechanged", (e) => { const dv = e.target.value; parser(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)); });

    try { const p = expect(RESP.DEVICE_INFO, 3000); await send(CMD.GET_DEVICE_INFO); await p; }
    catch (e) { ctx.log("기기 정보 응답 없음 — 계속 진행합니다 (" + e.message + ")"); }
    try { await send(CMD.TIME_SYNC, timeSyncPayload(new Date())); } catch (e) { ctx.log("시간 동기화 실패: " + e.message); }

    // 센서 번호 정하기: 보드 설정이 원하는 값을 주면 그대로, 아니면 원하는 물리량의 기본 센서
    const want = ctx.want, cur = link.info ? link.info.sensorId : null;
    let id = cur;
    if (want.length && !gives(cur, want)) id = DEFAULT_FOR[want.find((q) => DEFAULT_FOR[q])] || cur;
    if (id == null) id = 22;
    const def = SENSORS[id], iv = Math.max(def ? def.min : 200, 100);
    try {
      const p = expect(RESP.SET_SENSOR, 1500);
      await send(CMD.SET_SENSOR, Uint8Array.from([id & 0xff, ...u32le(iv)]));
      const r = await p;
      if (r.result !== 0) throw new Error(RESULT[r.result] || `오류 ${r.result}`);
    } catch (e) { ctx.log("⚠ 센서 설정 응답 문제: " + e.message + " — 그대로 측정을 시도합니다."); }
    const p2 = expect(RESP.START, 1500);
    await send(CMD.START);
    const r2 = await p2.catch((e) => { ctx.log("⚠ 시작 응답 없음: " + e.message); return null; });
    if (r2 && r2.result !== 0) throw new Error("측정을 시작하지 못했습니다 — " + (RESULT[r2.result] || `오류 ${r2.result}`) + (r2.result === 8 ? ` (${def ? def.n : "센서"}를 보드에 꽂아 주세요)` : ""));
    setSensorChannels(id);
    ctx.log(`측정 시작 — ${def ? def.n : "번호 " + id} · ${iv}ms`);

    device.addEventListener("gattserverdisconnected", () => { if (link.open) { link.open = false; ctx.lost("연결이 끊겼습니다. 보드 전원을 확인하고 다시 연결해 주세요"); } });
    return {
      label: `${device.name || "EZMaker"} · ${def ? def.n : "센서 " + id}`,
      async close() { link.open = false; try { await send(CMD.STOP); } catch (e) { /* 무시 */ } try { device.gatt.disconnect(); } catch (e) { /* 무시 */ } },
    };
  }

  S.register({
    id: "ezmaker", label: "EZMaker",
    filters: [{ namePrefix: NAME_PREFIX }, { services: [NUS_SVC] }],
    services: [NUS_SVC],
    match: (d) => (d.name || "").startsWith(NAME_PREFIX),
    open,
  });
  S._ezmaker = { buildFrame, buildResponse, makeParser, crc8, SENSORS, RESP, NTF, CMD };
})();
