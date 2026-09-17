/* science-inquiry-hub — 센서 공통 계층
   탐구 앱은 업체를 모른다. 아래 모양의 표준 스트림만 받는다.

     { quantity, unit, value, t, axis, channel, device, source }
       quantity  "temperature" | "force" | "acceleration" | "humidity" | "pressure" | "co2" | …
       unit      표준 단위 (QUANTITY 표 참고). 어댑터가 업체 단위를 여기에 맞춰 바꿔서 보낸다
       t         초. SIHSensor.now() 와 같은 시계 (가상 센서는 배속된 시계를 쓴다 → 앱은 벽시계 대신 t 를 쓴다)
       axis      "x" | "y" | "z" | "abs" | ""
       channel   채널 키 (기기:물리량:축)
       source    어댑터 id ("pasco" | "sciencecube" | "ezmaker" | "vernier" | "virtual")

   업체별 차이는 어댑터(sensor-*.js)에 있다. 어댑터는 SIHSensor.register({...}) 로 등록한다.
     { id, label, filters:[{namePrefix}], services:[uuid], match(device), open(device, ctx) → {close()} }
     ctx = { want, log(msg), packet(bytes), channel(def) → push(value, {t, raw}), lost(msg), status(msg) }

   측정값은 페이지 밖으로 보내지 않는다. CSV 는 이 기기로 내려받기만 한다.

   앱에서 쓰는 것:
     SIHSensor.on(fn)            표본 구독. 반환값을 부르면 구독 해제
     SIHSensor.onChange(fn)      연결·해제·채널 변화
     SIHSensor.byQuantity(q)     연결 순서대로 채널 목록
     SIHSensor.record(on)        CSV 용 기록 켜기·끄기,  SIHSensor.clearRecord()
     SIHSensor.now()             표본 t 와 같은 시계의 현재 시각(초)
*/
(function () {
  const S = (window.SIHSensor = {});
  const adapters = [];
  const subs = new Set(), changeSubs = new Set();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const hex = (u8) => Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join(" ");
  S.hex = hex;

  S.QUANTITY = {
    temperature: { ko: "온도", unit: "℃", dec: 1 },
    force: { ko: "힘", unit: "N", dec: 2 },
    acceleration: { ko: "가속도", unit: "m/s²", dec: 1 },
    humidity: { ko: "습도", unit: "%", dec: 0 },
    pressure: { ko: "압력", unit: "kPa", dec: 1 },
    co2: { ko: "이산화 탄소", unit: "ppm", dec: 0 },
    angularVelocity: { ko: "각속도", unit: "rad/s", dec: 2 },
    illuminance: { ko: "조도", unit: "lx", dec: 0 },
    sound: { ko: "소리 세기", unit: "dB", dec: 1 },
    voltage: { ko: "전압", unit: "V", dec: 2 },
    current: { ko: "전류", unit: "A", dec: 3 },
    ph: { ko: "pH", unit: "pH", dec: 2 },
    distance: { ko: "거리", unit: "m", dec: 3 },
  };

  S.devices = [];   // { key, name, label, source, virtual, verified, conn, lastPacket, opened }
  S.channels = [];  // { key, deviceKey, quantity, unit, axis, label, last, raw, lastAt, count, rate, offset, verified, source }
  S.logLines = [];

  let clockOffset = 0, clockScale = 1;          // 가상 센서 배속용
  S.now = () => (performance.now() / 1000) * clockScale + clockOffset;
  S.setClockScale = (k) => { const n = S.now(); clockScale = k; clockOffset = n - (performance.now() / 1000) * k; };

  S.log = function (msg) {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    S.logLines.push(`${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${msg}`);
    if (S.logLines.length > 200) S.logLines.shift();
    S._dirtyLog = true;
  };
  const changed = () => changeSubs.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  S.register = (a) => { adapters.push(a); };
  S.adapters = adapters;
  S.on = (fn) => { subs.add(fn); return () => subs.delete(fn); };
  S.onChange = (fn) => { changeSubs.add(fn); return () => changeSubs.delete(fn); };
  S.byQuantity = (q) => S.channels.filter((c) => c.quantity === q);

  /** Web Bluetooth 를 쓸 수 있는 환경인지. 못 쓰면 이유를 돌려준다. */
  S.support = function () {
    if (!window.isSecureContext) return { ok: false, reason: "이 주소는 보안 연결(HTTPS)이 아니어서 브라우저가 블루투스를 열어 주지 않습니다." };
    if (!navigator.bluetooth) return { ok: false, reason: "이 브라우저는 무선 센서 연결(Web Bluetooth)을 지원하지 않습니다. 크롬북·안드로이드·윈도우의 Chrome 또는 Edge 에서 열어 주세요." };
    return { ok: true };
  };

  /* ---------- 채널 · 표본 ---------- */
  function makeCtx(dev, want) {
    return {
      want: want || [],
      log: (m) => S.log(`[${dev.label || dev.name}] ${m}`),
      status: (m) => { dev.state = m; changed(); },
      packet: (bytes) => { dev.lastPacket = hex(bytes); dev.packets = (dev.packets || 0) + 1; },
      channel(def) {
        const q = S.QUANTITY[def.quantity];
        const ch = {
          key: `${dev.key}:${def.quantity}:${def.axis || ""}`, deviceKey: dev.key, source: dev.source,
          quantity: def.quantity, unit: def.unit || (q ? q.unit : ""), axis: def.axis || "",
          label: def.label || (q ? q.ko : def.quantity) + (def.axis ? " " + def.axis.toUpperCase() : ""),
          verified: def.verified !== false, zeroable: !!def.zeroable,
          last: null, raw: null, lastAt: 0, count: 0, rate: 0, offset: 0, _win: [],
        };
        S.channels.push(ch);
        changed();
        return function push(value, o) {
          if (!Number.isFinite(value)) return;
          const t = o && o.t !== undefined ? o.t : S.now();
          ch.raw = o && o.raw !== undefined ? o.raw : value;
          ch.last = value - ch.offset; ch.lastAt = performance.now(); ch.count++;
          ch._win.push(ch.lastAt); while (ch._win.length > 1 && ch.lastAt - ch._win[0] > 3000) ch._win.shift();
          ch.rate = ch._win.length > 1 ? ((ch._win.length - 1) * 1000) / (ch.lastAt - ch._win[0]) : 0;
          const sample = { quantity: ch.quantity, unit: ch.unit, value: ch.last, t, axis: ch.axis, channel: ch.key, device: dev.key, source: dev.source };
          if (rec.on) recordSample(ch, sample);
          subs.forEach((fn) => { try { fn(sample); } catch (e) { console.error(e); } });
        };
      },
      clearChannels() { S.channels = S.channels.filter((c) => c.deviceKey !== dev.key); changed(); },
      lost(msg) { removeDevice(dev, msg || "연결이 끊겼습니다"); },
    };
  }
  /** 지금 값을 0 으로 (힘 센서 영점). 다시 부르면 새 값 기준으로 다시 맞춘다. */
  S.zero = function (key) {
    const ch = S.channels.find((c) => c.key === key);
    if (!ch || ch.last === null) return;
    ch.offset += ch.last; ch.last = 0;
    S.log(`${ch.label} 영점: 보정값 ${ch.offset.toFixed(3)} ${ch.unit}`);
  };

  function removeDevice(dev, why) {
    const i = S.devices.indexOf(dev);
    if (i < 0) return;
    S.devices.splice(i, 1);
    S.channels = S.channels.filter((c) => c.deviceKey !== dev.key);
    S.log(`${dev.label || dev.name}: ${why}`);
    S.lastNotice = `${dev.label || dev.name} — ${why}`;
    changed();
    if (!dev.virtual && dev.native) watchOne(dev.native, dev.want);   // 다시 켜지면 스스로 붙는다 (지원 환경만)
  }
  S.disconnect = async function (key) {
    const dev = S.devices.find((d) => d.key === key);
    if (!dev) return;
    dev.closing = true;
    try { await dev.conn.close(); } catch (e) { /* 이미 끊김 */ }
    removeDevice(dev, "연결을 해제했습니다");
  };
  S.disconnectAll = async () => { for (const d of [...S.devices]) await S.disconnect(d.key); };

  /* ---------- 연결 ---------- */
  function adapterFor(device) { return adapters.find((a) => a.match && a.match(device)) || null; }
  async function adapterByServices(device) {
    const server = await device.gatt.connect();
    const uuids = (await server.getPrimaryServices()).map((s) => s.uuid.toLowerCase());
    S.log(`서비스 ${uuids.length}개: ${uuids.join(", ") || "(없음)"}`);
    return adapters.find((a) => (a.services || []).some((u) => uuids.includes(u.toLowerCase()))) || null;
  }

  /** "센서 연결" 버튼 하나. 모든 어댑터의 이름 필터·서비스를 합쳐 기기 선택 창을 한 번만 띄운다. */
  S.connect = async function (want, all) {
    const sup = S.support();
    if (!sup.ok) throw new Error(sup.reason);
    const services = [...new Set(adapters.flatMap((a) => a.services || []))];
    const filters = adapters.flatMap((a) => a.filters || []);
    const options = all || !filters.length ? { acceptAllDevices: true, optionalServices: services } : { filters, optionalServices: services };
    let device;
    try { device = await navigator.bluetooth.requestDevice(options); }
    catch (e) {
      if (e.name === "NotFoundError") { S.log("기기 선택을 취소했거나 해당 이름의 기기가 없습니다"); return null; }
      throw e;
    }
    return S.openDevice(device, want);
  };

  S.openDevice = async function (device, want) {
    if (S.devices.some((d) => d.native === device)) { S.lastNotice = "이미 연결되어 있는 센서입니다."; changed(); return null; }
    S.log(`선택: "${device.name || "(이름 없음)"}"`);
    let adapter = adapterFor(device);
    if (!adapter) { try { adapter = await adapterByServices(device); } catch (e) { S.log("서비스 확인 실패: " + e.message); } }
    if (!adapter) {
      try { device.gatt.disconnect(); } catch (e) { /* 무시 */ }
      throw new Error(`"${device.name || "이 기기"}" 는 아직 이 앱이 해석할 수 없는 기기입니다. 진단 로그를 알려 주시면 추가하겠습니다.`);
    }
    const dev = { key: device.id || "dev" + Date.now(), name: device.name || "(이름 없음)", label: "", source: adapter.id, vendor: adapter.label, native: device, want, virtual: false, state: "연결 중…", opened: performance.now() };
    S.devices.push(dev); changed();
    try {
      dev.conn = await adapter.open(device, makeCtx(dev, want), dev);
      dev.label = dev.conn.label || dev.name; dev.verified = dev.conn.verified !== false;
      dev.state = "연결됨"; S.lastNotice = "";
      S.log(`${dev.label} 연결 완료 (${adapter.label}) — ${S.channels.filter((c) => c.deviceKey === dev.key).map((c) => c.label).join(", ")}`);
      changed();
      setTimeout(() => {
        const mine = S.channels.filter((c) => c.deviceKey === dev.key);
        if (S.devices.includes(dev) && mine.length && mine.every((c) => !c.count)) { S.lastNotice = `${dev.label}: 연결은 됐지만 4초 동안 값이 오지 않았습니다. 아래 진단 로그를 확인해 주세요.`; changed(); }
      }, 4000);
      return dev;
    } catch (e) {
      const i = S.devices.indexOf(dev); if (i >= 0) S.devices.splice(i, 1);
      S.channels = S.channels.filter((c) => c.deviceKey !== dev.key);
      try { device.gatt.disconnect(); } catch (_) { /* 무시 */ }
      S.log("연결 오류: " + e.message); changed();
      throw e;
    }
  };

  /** 가상 센서 (기기 없이 개발·시연·자동 검사). profile 은 sensor-virtual.js 참고 */
  S.connectVirtual = async function (profile, want) {
    const a = adapters.find((x) => x.id === "virtual");
    if (!a) throw new Error("가상 센서 모듈이 없습니다");
    const n = S.devices.filter((d) => d.virtual).length + 1;
    const dev = { key: "virtual-" + n + "-" + profile, name: "가상 센서 " + n, label: "", source: "virtual", vendor: "가상", virtual: true, want, state: "연결됨", opened: performance.now() };
    S.devices.push(dev);
    dev.conn = await a.open({ profile }, makeCtx(dev, want), dev);
    dev.label = dev.conn.label || dev.name;
    S.log(`${dev.label} 시작 — 실제 측정값이 아닙니다`);
    changed();
    return dev;
  };

  /* 한 번 허용한 기기의 자동 재연결 — 지원되는 환경에서만 쓰는 부가 기능 */
  const watching = new WeakSet();
  function watchOne(device, want) {
    if (!device || !device.watchAdvertisements || watching.has(device)) return;
    const ac = new AbortController();
    watching.add(device);
    device.addEventListener("advertisementreceived", async () => {
      ac.abort(); watching.delete(device);
      if (S.devices.some((d) => d.native === device) || !S.autoReconnectOn) return;
      S.log(`"${device.name}" 가 다시 보여 자동으로 연결합니다`);
      try { await S.openDevice(device, want); } catch (e) { S.log("자동 재연결 실패: " + e.message); }
    }, { once: true });
    device.watchAdvertisements({ signal: ac.signal }).catch(() => watching.delete(device));
  }
  S.autoReconnectOn = false;
  S.autoReconnect = async function (want) {
    S.autoReconnectOn = true;
    if (!navigator.bluetooth || !navigator.bluetooth.getDevices) return;
    try {
      const list = await navigator.bluetooth.getDevices();
      list.filter((d) => adapterFor(d)).forEach((d) => watchOne(d, want));
      if (list.length) S.log(`전에 허용한 기기 ${list.length}개 — 전원이 켜지면 자동으로 연결합니다 (지원 환경만)`);
    } catch (e) { /* 지원하지 않는 환경 */ }
  };

  /* ---------- 기록 · CSV (로컬 다운로드만) ---------- */
  const rec = (S.rec = { on: false, rows: [], cols: new Map(), t0: null, started: null });
  const MAX_ROWS = 200000;
  function recordSample(ch, s) {
    if (rec.t0 === null) { rec.t0 = s.t; rec.started = new Date(); }
    if (!rec.cols.has(ch.key)) rec.cols.set(ch.key, { key: ch.key, head: `${ch.label} ${labelOf(ch.deviceKey)} (${ch.unit})` });
    const et = s.t - rec.t0, row = rec.rows[rec.rows.length - 1];
    if (row && et - row.t < 0.02 && row.values[ch.key] === undefined) row.values[ch.key] = s.value;
    else if (rec.rows.length < MAX_ROWS) rec.rows.push({ t: et, iso: new Date().toISOString(), values: { [ch.key]: s.value } });
  }
  const labelOf = (deviceKey) => { const d = S.devices.find((x) => x.key === deviceKey); return d ? d.label || d.name : ""; };
  S.record = (on) => { rec.on = !!on; changed(); };
  S.clearRecord = () => { rec.rows = []; rec.cols = new Map(); rec.t0 = null; changed(); };
  S.csvText = function () {
    const cols = [...rec.cols.values()];
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [["elapsed_s", "timestamp_iso", ...cols.map((c) => q(c.head))].join(",")];
    for (const r of rec.rows) lines.push([r.t.toFixed(3), r.iso, ...cols.map((c) => (r.values[c.key] === undefined ? "" : (+r.values[c.key].toFixed(4)).toString()))].join(","));
    return lines.join("\n");
  };
  S.exportCsv = function (name) {
    if (!rec.rows.length) return false;
    const blob = new Blob(["﻿" + S.csvText()], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"), url = URL.createObjectURL(blob);
    a.href = url; a.download = `${name || "측정기록"}_${(rec.started || new Date()).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    S.log(`CSV 내려받기: ${rec.rows.length}행 × ${rec.cols.size}열 (이 기기에만 저장)`);
    return true;
  };

  /* ---------- 센서 막대 (연결 버튼 · 값 · 진단) ---------- */
  S.mount = function (el, opt) {
    opt = opt || {};
    const want = opt.want || [], max = opt.max || 1, profiles = opt.virtual || [];
    el.innerHTML = `
      <div class="sb-row">
        <button class="btn primary" id="sbConnect">센서 연결</button>
        <button class="btn" id="sbVirtual" title="기기 없이 가상 값으로 체험합니다">가상 센서로 체험</button>
        <span class="sb-status" id="sbStatus" role="status" aria-live="polite"></span>
      </div>
      <p class="sb-notice" id="sbNotice" hidden></p>
      <div class="sb-chips" id="sbChips"></div>
      <details class="sb-diag" id="sbDiag">
        <summary>진단 · 기록</summary>
        <div class="sb-row">
          <button class="btn small" id="sbCsv" disabled>CSV 내려받기</button>
          <button class="btn small" id="sbClear" disabled>기록 지우기</button>
          <button class="btn small" id="sbAll">목록에 없으면: 모든 블루투스 기기 보기</button>
        </div>
        <div class="sb-table" id="sbTable"></div>
        <pre class="sb-log" id="sbLog" tabindex="0" aria-label="진단 로그"></pre>
        <p class="hint">측정값은 이 기기 안에서만 처리하며 어디로도 전송하지 않습니다. CSV 는 이 기기에 파일로 내려받습니다.
        센서 통신 코드 일부는 각 제조사가 공개한 자료를 바탕으로 하며, 제조사가 보증·후원하는 것이 아닙니다 (assets/sensor-NOTICE.txt).</p>
      </details>`;
    const $ = (id) => el.querySelector("#" + id);
    const notice = (html) => { $("sbNotice").hidden = !html; $("sbNotice").innerHTML = html || ""; };
    const sup = S.support();
    if (!sup.ok) { $("sbConnect").disabled = true; $("sbAll").disabled = true; notice(esc(sup.reason) + " 지금은 <b>시뮬레이션</b>으로 계속 동작합니다. 기기가 없어도 <b>가상 센서로 체험</b>은 할 수 있습니다."); }
    else S.autoReconnect(want);

    async function go(all) {
      if (S.devices.length >= max) { notice(`이 앱은 센서를 ${max}개까지 씁니다.`); return; }
      $("sbConnect").disabled = true;
      try { notice(""); await S.connect(want, all); }
      catch (e) { notice("연결하지 못했습니다 — " + esc(e.message || e) + "<br><small>센서 전원이 켜져 있는지, 다른 기기·프로그램에 이미 연결돼 있지 않은지 확인해 주세요.</small>"); }
      chips();
    }
    $("sbConnect").onclick = () => go(false);
    $("sbAll").onclick = () => go(true);
    $("sbVirtual").onclick = async () => {
      const n = S.devices.filter((d) => d.virtual).length;
      if (S.devices.length >= max || !profiles.length) return;
      if (opt.onVirtual) await opt.onVirtual();      // 시뮬레이션에 머물러 있었다면 센서 모드로 바꾼 뒤 연결한다
      await S.connectVirtual(profiles[n % profiles.length], want);
    };
    $("sbCsv").onclick = () => S.exportCsv(opt.name);
    $("sbClear").onclick = () => S.clearRecord();

    function chips() {
      const box = $("sbChips");
      box.innerHTML = S.devices.map((d) => {
        const chs = S.channels.filter((c) => c.deviceKey === d.key && (!want.length || want.includes(c.quantity)));
        return `<div class="sb-dev${d.virtual ? " virtual" : ""}" data-key="${esc(d.key)}">
          <span class="sb-name">${esc(d.label || d.name)}${d.virtual ? ' <em>가상 값</em>' : ""}${d.verified === false ? ' <em class="warn">미확인 센서</em>' : ""}</span>
          ${chs.map((c) => `<span class="sb-val" data-ch="${esc(c.key)}"><small>${esc(c.label)}</small><b>–</b>${c.zeroable ? `<button class="btn small sb-zero" data-ch="${esc(c.key)}">영점</button>` : ""}</span>`).join("") || `<span class="sb-val"><small>${esc(d.state || "")}</small></span>`}
          <button class="x" aria-label="${esc(d.label || d.name)} 연결 해제">✕</button></div>`;
      }).join("");
      box.querySelectorAll(".sb-dev .x").forEach((b) => (b.onclick = () => S.disconnect(b.parentNode.dataset.key)));
      box.querySelectorAll(".sb-zero").forEach((b) => (b.onclick = () => S.zero(b.dataset.ch)));
      const real = S.devices.filter((d) => !d.virtual).length;
      $("sbStatus").textContent = S.devices.length ? `센서 ${S.devices.length}개 연결됨${real < S.devices.length ? " (가상 포함)" : ""}` : "연결된 센서 없음";
      $("sbConnect").textContent = S.devices.length ? "＋ 센서 추가" : "센서 연결";
      $("sbConnect").disabled = !S.support().ok || S.devices.length >= max;
      $("sbVirtual").hidden = !profiles.length || S.devices.length >= max;
      if (S.lastNotice) notice(esc(S.lastNotice));
      if (S.devices.some((d) => d.virtual)) notice("지금 값은 <b>가상 데이터</b>입니다 — 실제 센서 측정값이 아닙니다.");
    }
    function tick() {
      S.channels.forEach((c) => {
        const b = el.querySelector(`.sb-val[data-ch="${CSS.escape(c.key)}"] b`);
        if (!b) return;
        const q = S.QUANTITY[c.quantity], stale = performance.now() - c.lastAt > 6000;
        b.textContent = c.last === null ? "–" : `${c.last.toFixed(q ? q.dec : 2)} ${c.unit}`;
        b.parentNode.classList.toggle("stale", stale && c.last !== null);
      });
      $("sbCsv").disabled = $("sbClear").disabled = !rec.rows.length;
      if (!$("sbDiag").open) return;
      $("sbTable").innerHTML = `<table><thead><tr><th>기기 · 측정값</th><th>상태</th><th>원시 값</th><th>해석 값</th><th>속도</th></tr></thead><tbody>` +
        (S.devices.map((d) => `<tr><td><b>${esc(d.label || d.name)}</b> <small>${esc(d.vendor)}${d.verified === false ? " · 미확인" : ""}</small></td><td>${esc(d.state || "")}</td><td colspan="3"><code>${esc(d.lastPacket || "–")}</code></td></tr>` +
          S.channels.filter((c) => c.deviceKey === d.key).map((c) => `<tr><td>　${esc(c.label)}</td><td>${c.count}개</td><td>${c.raw === null ? "–" : +(+c.raw).toFixed(4)}</td><td>${c.last === null ? "–" : +c.last.toFixed(4)} ${esc(c.unit)}${c.offset ? ` <small>(영점 ${+c.offset.toFixed(3)})</small>` : ""}</td><td>${c.rate.toFixed(1)} Hz</td></tr>`).join("")).join("") ||
          `<tr><td colspan="5">연결된 센서가 없습니다. 브라우저: ${S.support().ok ? "Web Bluetooth 사용 가능" : "Web Bluetooth 사용 불가"}</td></tr>`) +
        `</tbody></table><p class="hint">기록: ${rec.on ? "켜짐" : "꺼짐"} · ${rec.rows.length}행</p>`;
      if (S._dirtyLog) { S._dirtyLog = false; const p = $("sbLog"); p.textContent = S.logLines.join("\n"); p.scrollTop = p.scrollHeight; }
    }
    const off = S.onChange(chips);
    const timer = setInterval(tick, 250);
    chips(); tick();
    return { notice, destroy() { off(); clearInterval(timer); el.innerHTML = ""; } };
  };
})();
