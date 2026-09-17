/* science-inquiry-hub — PASCO 무선 센서 어댑터
   무선 센서 실험실(Raph-Alpaca/sensor-lab)의 pasco/index.html 에서 옮겨 온 코드다.
   프로토콜·보정식은 PASCO 가 공개한 파이썬 라이브러리 pasco 0.3.66
   (pasco_ble_device.py, datasheets.py) 를 따른다. 데이터시트는 쓰는 센서 것만 추렸다.

   Copyright (c) 2021 PASCO Scientific — 비상업·교육 목적의 수정·재배포 허용 (EULA).
   THIS SOURCE CODE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
   IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
   FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. 전문은 assets/sensor-NOTICE.txt.
   이 앱은 PASCO 가 만들거나 보증·후원하는 것이 아니다. */
(function () {
  const S = window.SIHSensor;
  const svcUuid = (s) => `4a5c000${s}-0000-0000-0000-5c1e741f1c00`;
  const chrUuid = (s, c) => `4a5c000${s}-000${c}-0000-0000-5c1e741f1c00`;
  const PASCO = { SEND_CMD_CHAR_ID: 2, RECV_CMD_CHAR_ID: 3, SEND_ACK_CHAR_ID: 5, GCMD_READ_ONE_SAMPLE: 0x05, GRSP_RESULT: 0xc0 };

  // 기기 이름 앞부분. 아래 INTERFACES 에 있는 센서만 고를 수 있게 한다
  const DEVICE_PREFIXES = ["Temperature", "Temp", "Force Accel"];
  const INTERFACES = {
    1025: { name: "WirelessTemperature", ko: "온도", channels: [{ id: 0, sensorId: 2020 }] },
    1028: { name: "WirelessForceAccel", ko: "힘·가속도", channels: [{ id: 0, sensorId: 2023 }, { id: 1, sensorId: 2024 }, { id: 2, sensorId: 2028 }] },
    1046: { name: "WirelessFastRespTemp", ko: "고속 온도", channels: [{ id: 0, sensorId: 2052 }] },
  };
  // datasheets.py 에서 추린 측정값 정의. q/axis/k 는 표준 스트림으로 바꾸기 위해 덧붙인 것 (k = 표준 단위로 가는 배율)
  const SENSORS = {
    2020: { model: "PS-3201", period: 500, measurements: [
      { id: 0, tag: "RawTemperature", type: "RawDigital", dataSize: 2 },
      { id: 1, tag: "Temperature", type: "UserCal", inputs: "2", params: [0, 0, 100, 100], precision: 1, visible: 1, q: "temperature" },
      { id: 2, tag: "UncalTemperature", type: "LinearConv", inputs: "0", params: [0.00268127, -46.85] }] },
    2052: { model: "PS-3222", period: 250, measurements: [
      { id: 0, tag: "RawTemperature", type: "RawDigital", dataSize: 2 },
      { id: 1, tag: "UncalTemperature", type: "Equation", equation: "([0]/172.463)-40" },
      { id: 2, tag: "Temperature", type: "UserCal", inputs: "1", params: [0, 0, 100, 100], precision: 1, visible: 1, q: "temperature" }] },
    2023: { model: "PS-3202", period: 40, measurements: [
      { id: 0, tag: "RawForce", type: "RawDigital", dataSize: 2 },
      { id: 1, tag: "ForceFCal", type: "FactoryCal", inputs: "0", params: [32768, 0, 5000, 50] },
      { id: 4, tag: "Force", type: "UserCal", inputs: "1", params: [0, 0, 50, 50], precision: 2, visible: 1, q: "force", zeroable: true }] },
    2024: { model: "PS-3202", period: 40, measurements: [
      { id: 0, tag: "X", type: "RawDigital", dataSize: 2, twosComp: 1 }, { id: 1, tag: "Y", type: "RawDigital", dataSize: 2, twosComp: 1 }, { id: 2, tag: "Z", type: "RawDigital", dataSize: 2, twosComp: 1 },
      { id: 3, tag: "Accelerationx", type: "FactoryCal", inputs: "0", params: [0, 0, 1, 0.004787], precision: 1, visible: 1, q: "acceleration", axis: "x" },
      { id: 4, tag: "Accelerationy", type: "FactoryCal", inputs: "1", params: [0, 0, 1, 0.004787], precision: 1, visible: 1, q: "acceleration", axis: "y" },
      { id: 5, tag: "Accelerationz", type: "FactoryCal", inputs: "2", params: [0, 0, 1, 0.004787], precision: 1, visible: 1, q: "acceleration", axis: "z" },
      { id: 6, tag: "AccelerationResultant", type: "ThreeInputVector", inputs: "3,4,5", precision: 1, visible: 1, q: "acceleration", axis: "abs" }] },
    2028: { model: "PS-3202", period: 40, measurements: [
      { id: 0, tag: "X", type: "RawDigital", dataSize: 2, twosComp: 1 }, { id: 1, tag: "Y", type: "RawDigital", dataSize: 2, twosComp: 1 }, { id: 2, tag: "Z", type: "RawDigital", dataSize: 2, twosComp: 1 },
      { id: 3, tag: "AngularVelocityx", type: "FactoryCal", inputs: "0", params: [0, 0, 1, 0.07], precision: 1, visible: 1, q: "angularVelocity", axis: "x", k: Math.PI / 180 },
      { id: 4, tag: "AngularVelocityy", type: "FactoryCal", inputs: "1", params: [0, 0, 1, 0.07], precision: 1, visible: 1, q: "angularVelocity", axis: "y", k: Math.PI / 180 },
      { id: 5, tag: "AngularVelocityz", type: "FactoryCal", inputs: "2", params: [0, 0, 1, 0.07], precision: 1, visible: 1, q: "angularVelocity", axis: "z", k: Math.PI / 180 }] },
  };

  function decode64(ch) {
    if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
    if (ch >= "K" && ch <= "Z") return ch.charCodeAt(0) - 65;
    if (ch >= "A" && ch <= "J") return ch.charCodeAt(0) - 65 + 26;
    if (ch >= "a" && ch <= "z") return ch.charCodeAt(0) - 97 + 36;
    if (ch === "*") return 62;
    if (ch === "#") return 63;
    return -1;
  }
  /** 광고 이름 예: "Temperature 201-761>18" → {type, serial, interfaceId:1025} */
  function parseDeviceName(name) {
    const i = name.lastIndexOf(" ");
    const type = i > 0 ? name.slice(0, i) : name;
    const tail = i > 0 ? name.slice(i + 1) : "";
    const code = tail.length > 8 ? tail[8] : "";
    const dec = code ? decode64(code) : -1;
    return { type, serial: tail.slice(0, 7), interfaceId: dec >= 0 ? dec + 1024 : null, raw: name };
  }

  const twosComp = (v, bytes) => (v > (1 << (bytes * 8 - 1)) ? v - Math.pow(2, bytes * 8) : v);
  function calc4(raw, x1, y1, x2, y2) {
    const b = (x1 * y2 - x2 * y1) / (x1 - x2);
    let m = 0;
    if (x1 !== 0) m = (y1 - b) / x1;
    if (x2 !== 0) m = (y2 - b) / x2;
    return m * raw + b;
  }
  function evalEquation(expr, vals) {
    const filled = expr.replace(/\[(\d+)\]/g, (_, id) => {
      const v = vals[Number(id)];
      if (v === null || v === undefined || !isFinite(v)) throw new Error("missing " + id);
      return "(" + v + ")";
    });
    if (!/^[-+*/(). 0-9eE]+$/.test(filled)) throw new Error("unsafe");
    return Function('"use strict";return (' + filled + ")")();
  }
  const packetSize = (def) => def.measurements.reduce((s, m) => s + (m.dataSize || 0), 0);

  /** 한 샘플 패킷 → { 측정ID: 값 } (보이는 측정값만) */
  function decodePacket(def, bytes) {
    const V = {};
    let p = 0;
    for (const m of def.measurements) {
      if (m.type === "RawDigital" || m.type === "Direct") {
        let v = 0;
        for (let d = 0; d < (m.dataSize || 0); d++) { if (p >= bytes.length) break; v += bytes[p++] * Math.pow(2, 8 * d); }
        if (m.dataSize === 4 || m.twosComp) v = twosComp(v, m.dataSize);
        if (m.type === "Direct" && m.dataSize === 4) v = (v >> 16) + (v & 0xffff) / 65536;
        V[m.id] = v;
      } else if (m.type === "Constant") V[m.id] = Number(m.value);
      else V[m.id] = null;
    }
    const resolve = (id, depth) => {
      if (depth > 10) return null;
      if (V[id] !== null && V[id] !== undefined) return V[id];
      const m = def.measurements.find((x) => x.id === id);
      if (!m) return null;
      let out = null;
      try {
        if (m.type === "Equation") {
          const inputs = {};
          for (const ref of (m.equation.match(/\[(\d+)\]/g) || [])) { const rid = Number(ref.slice(1, -1)); inputs[rid] = resolve(rid, depth + 1); }
          out = evalEquation(m.equation, inputs);
        } else if (m.type === "ThreeInputVector") {
          const [a, b, c] = String(m.inputs).split(",").map((x) => resolve(Number(x), depth + 1));
          if ([a, b, c].some((x) => x === null)) return null;
          out = Math.sqrt(a * a + b * b + c * c);
        } else if (m.type === "Select") {
          out = resolve(Number(String(m.inputs).split(",")[0]), depth + 1);
        } else if (m.inputs !== undefined) {
          const iv = resolve(Number(m.inputs), depth + 1);
          if (iv === null) return null;
          if (m.type === "LinearConv") out = m.params[0] * iv + m.params[1];
          else if (m.type === "UserCal" || m.type === "FactoryCal") out = calc4(iv, m.params[0], m.params[1], m.params[2], m.params[3]);
          else out = iv;
        }
      } catch (e) { return null; }
      if (out !== null && isFinite(out)) {
        if (m.limits) out = Math.max(m.limits[0], Math.min(m.limits[1], out));
        if (m.precision !== undefined) out = Number(out.toFixed(m.precision));
      }
      V[id] = out;
      return out;
    };
    const res = {};
    for (const m of def.measurements) { const v = resolve(m.id, 0); if (m.visible && v !== null && isFinite(v)) res[m.id] = v; }
    res._raw = V[def.measurements[0].id];
    return res;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function open(device, ctx) {
    const info = parseDeviceName(device.name || "");
    const iface = INTERFACES[info.interfaceId];
    ctx.log(`${info.type} / ${info.serial} / 인터페이스 ${info.interfaceId} ${iface ? "(" + iface.name + ")" : "(표에 없음)"}`);
    if (!iface) throw new Error(`${info.type} 는 아직 이 앱이 해석할 수 없는 센서입니다 (인터페이스 ${info.interfaceId}).`);

    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    ctx.log(`서비스 ${services.length}개`);
    if (!services.length) throw new Error("연결은 됐지만 센서 서비스를 찾지 못했습니다.");

    const st = { channels: [], pending: null, resolve: null, seen: 0, open: true };
    const charByUuid = {};
    for (const svc of services) {
      for (const ch of await svc.getCharacteristics()) {
        charByUuid[ch.uuid.toLowerCase()] = ch;
        if (ch.properties.notify) {
          await ch.startNotifications();
          const sid = Number(ch.uuid[7]);
          ch.addEventListener("characteristicvaluechanged", (ev) => { const dv = ev.target.value; onNotify(sid, new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)); });
        }
      }
    }
    for (const c of iface.channels) {
      const def = SENSORS[c.sensorId];
      if (!def) continue;
      const vis = def.measurements.filter((m) => m.visible);
      // 앱이 요청한 물리량이 없는 채널은 두드리지 않는다 (채널을 늘리면 그만큼 느려진다)
      if (ctx.want.length && !vis.some((m) => ctx.want.includes(m.q))) continue;
      const cmd = charByUuid[chrUuid(c.id + 1, PASCO.SEND_CMD_CHAR_ID)];
      if (!cmd) { ctx.log(`채널 ${c.id}: 명령 특성을 찾지 못해 건너뜁니다.`); continue; }
      const push = {};
      vis.forEach((m) => { push[m.id] = ctx.channel({ quantity: m.q, axis: m.axis, zeroable: m.zeroable }); });
      st.channels.push({ id: c.id, def, cmdChar: cmd, ackChar: charByUuid[chrUuid(c.id + 1, PASCO.SEND_ACK_CHAR_ID)] || null, stream: [], ackCount: 0, push });
    }
    if (!st.channels.length) throw new Error("데이터 요청용 특성을 찾지 못했습니다.");

    function emit(ch, bytes) {
      const res = decodePacket(ch.def, Uint8Array.from(bytes));
      let any = false;
      for (const m of ch.def.measurements) if (res[m.id] !== undefined && ch.push[m.id]) { ch.push[m.id](res[m.id] * (m.k || 1), { raw: res._raw }); any = true; }
      if (!any && st.seen < 40) ctx.log(`패킷 해석 실패: ${S.hex(bytes)}`);
    }
    function onNotify(serviceId, data) {
      st.seen++; ctx.packet(data);
      if (st.seen <= 12) ctx.log(`◀ svc${serviceId} [${data.length}B] ${S.hex(data)}`);
      if (data[0] === PASCO.GRSP_RESULT && data[2] === PASCO.GCMD_READ_ONE_SAMPLE) {
        const ch = st.pending || st.channels[0];
        if (data[1] === 0x00 && ch) emit(ch, data.slice(3));
        else if (data[1] !== 0x00) ctx.log(`오류 응답 0x${data[1].toString(16)}`);
        if (st.resolve) { const r = st.resolve; st.resolve = null; r(); }
        return;
      }
      if (data[0] <= 0x1f) {                                   // 연속 전송
        const ch = st.channels.find((c) => c.id + 1 === serviceId);
        if (!ch) return;
        for (let i = 1; i < data.length; i++) ch.stream.push(data[i]);
        const size = packetSize(ch.def);
        while (ch.stream.length >= size) emit(ch, ch.stream.splice(0, size));
        if (++ch.ackCount > 8 && ch.ackChar) { ch.ackCount = 0; try { ch.ackChar.writeValueWithoutResponse(new Uint8Array([data[0]])); } catch (e) { /* 무시 */ } }
      }
    }
    function requestChannel(ch) {
      return new Promise((resolve) => {
        st.pending = ch; st.resolve = resolve;
        const cmd = new Uint8Array([PASCO.GCMD_READ_ONE_SAMPLE, packetSize(ch.def)]);
        if (st.seen < 3) ctx.log(`▶ ch${ch.id} 요청 ${S.hex(cmd)}`);
        const w = ch.cmdChar.properties.writeWithoutResponse ? ch.cmdChar.writeValueWithoutResponse(cmd) : ch.cmdChar.writeValue(cmd);
        w.catch((e) => ctx.log(`요청 실패: ${e.message}`));
        setTimeout(() => { if (st.resolve === resolve) { st.resolve = null; resolve(); } }, 900);
      });
    }
    // 한 번 읽기(GCMD_READ_ONE_SAMPLE)를 응답이 오는 대로 되풀이한다. 빠른 채널일수록 짧게 쉰다
    const period = Math.min(...st.channels.map((c) => c.def.period || 500));
    (async () => {
      while (st.open && device.gatt.connected) {
        const t0 = performance.now();
        for (const ch of st.channels) { if (!st.open) break; await requestChannel(ch); }
        await sleep(Math.max(5, period - (performance.now() - t0)));
      }
    })();
    device.addEventListener("gattserverdisconnected", () => { if (st.open) { st.open = false; ctx.lost("연결이 끊겼습니다. 센서 전원을 확인하고 다시 연결해 주세요"); } });

    return { label: `${iface.ko} ${info.serial}`, close() { st.open = false; try { device.gatt.disconnect(); } catch (e) { /* 무시 */ } } };
  }

  S.register({
    id: "pasco", label: "PASCO",
    filters: DEVICE_PREFIXES.map((p) => ({ namePrefix: p })),
    services: [0, 1, 2, 3, 4, 5, 6, 7].map(svcUuid),
    match: (d) => { const n = d.name || ""; return DEVICE_PREFIXES.some((p) => n.startsWith(p)) && parseDeviceName(n).interfaceId !== null; },
    open,
  });
  S._pasco = { parseDeviceName, decodePacket, SENSORS, INTERFACES };
})();
