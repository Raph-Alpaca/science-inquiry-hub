/* science-inquiry-hub — Vernier Go Direct 어댑터
   무선 센서 실험실(Raph-Alpaca/sensor-lab)의 vernier/index.html 방식을 따른다.
   통신은 Vernier 가 공개한 @vernier/godirect 1.8.3 (BSD-3-Clause) 에 맡긴다. 수업 중 CDN 이 막혀도 되도록
   라이브러리를 assets/vendor/ 에 넣어 두었고, Go Direct 기기를 골랐을 때만 불러온다. */
(function () {
  const S = window.SIHSensor;
  const GDX_SVC = "d91714ef-28b9-4f91-ba16-f0d9a604f112";   // Go Direct GATT 서비스
  const LIB = new URL("vendor/godirect.min.umd.js", document.currentScript.src).href;

  let loading = null;
  function loadGodirect() {
    if (window.godirect) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = LIB; s.onload = res; s.onerror = () => { loading = null; rej(new Error("Go Direct 라이브러리를 불러오지 못했습니다.")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  /** 라이브러리가 알려 주는 이름·단위 → 표준 물리량. 모르는 단위는 이름과 단위를 그대로 보여 준다. */
  function mapSensor(s) {
    const u = (s.unit || "").trim(), n = s.name || "";
    const axis = (n.match(/\b([XYZ])\b|([xyz])[- ]?(axis|축)/) || [])[1] || (n.match(/([xyz])[- ]?axis/i) || [])[1] || "";
    const ax = axis ? axis.toLowerCase() : "";
    if (/^°?C$|^℃$/.test(u)) return { q: "temperature" };
    if (u === "N") return { q: "force", zeroable: true };
    if (/^m\/s(²|\^2|2)$/.test(u)) return { q: "acceleration", axis: ax };
    if (u === "g" && /accel/i.test(n)) return { q: "acceleration", axis: ax, k: 9.80665 };
    if (/^rad\/s$/.test(u)) return { q: "angularVelocity", axis: ax };
    if (/^(°|deg)\/s$/.test(u)) return { q: "angularVelocity", axis: ax, k: Math.PI / 180 };
    if (/%/.test(u) && /humid|습도|RH/i.test(n + u)) return { q: "humidity" };
    if (u === "kPa") return { q: "pressure" };
    if (/^(hPa|mbar)$/.test(u)) return { q: "pressure", k: 0.1 };
    if (u === "atm") return { q: "pressure", k: 101.325 };
    if (/^mm ?Hg$/.test(u)) return { q: "pressure", k: 0.133322 };
    if (u === "ppm" && /CO2|CO₂|carbon/i.test(n)) return { q: "co2" };
    if (/^(lux|lx)$/.test(u)) return { q: "illuminance" };
    if (u === "V") return { q: "voltage" };
    if (u === "A") return { q: "current" };
    if (u === "mA") return { q: "current", k: 0.001 };
    if (u === "m") return { q: "distance" };
    if (u === "cm") return { q: "distance", k: 0.01 };
    if (/^pH$/i.test(u) || /^pH$/i.test(n)) return { q: "ph" };
    return { q: "gdx" + s.number, label: n, unit: u, unknown: true };
  }

  async function open(device, ctx) {
    await loadGodirect();
    const gdx = await window.godirect.createDevice(device, { open: true, startMeasurements: false });
    if (!gdx) throw new Error("기기를 열지 못했습니다.");
    ctx.log(`${gdx.name} (주문코드 ${gdx.orderCode || "?"}, 배터리 ${gdx.batteryLevel ?? "?"}%) · 센서 ${gdx.sensors.length}개: ${gdx.sensors.map((s) => `${s.name}[${s.unit}]`).join(", ")}`);

    // 앱이 원하는 물리량을 주는 센서를 켠다. 없으면 기기의 기본 센서
    const wanted = gdx.sensors.filter((s) => ctx.want.includes(mapSensor(s).q));
    if (wanted.length) gdx.sensors.forEach((s) => s.setEnabled && s.setEnabled(wanted.includes(s)));
    else if (!gdx.sensors.some((s) => s.enabled)) gdx.enableDefaultSensors();

    const st = { open: true };
    gdx.sensors.filter((s) => s.enabled).forEach((sensor) => {
      const m = mapSensor(sensor);
      const push = ctx.channel({ quantity: m.q, axis: m.axis, label: m.label, unit: m.unit, zeroable: m.zeroable, verified: !m.unknown });
      sensor.on("value-changed", (s) => { if (s.value !== null && isFinite(s.value)) push(s.value * (m.k || 1), { raw: s.value }); });
    });
    gdx.on("device-closed", () => { if (st.open) { st.open = false; ctx.lost("연결이 끊겼습니다. 전원을 확인하고 다시 연결해 주세요"); } });

    const fast = ctx.want.some((q) => q === "force" || q === "acceleration");
    const period = fast ? 50 : 500;
    try { await gdx.stop(); } catch (e) { /* 측정 중이 아니면 무시 */ }
    await gdx.start(period);
    ctx.log(`측정 시작: ${period}ms 주기`);
    return { label: gdx.name || device.name, close() { st.open = false; try { gdx.close(); } catch (e) { /* 무시 */ } } };
  }

  S.register({
    id: "vernier", label: "Vernier Go Direct",
    filters: [{ namePrefix: "GDX" }],
    services: [GDX_SVC],
    match: (d) => (d.name || "").startsWith("GDX"),
    open,
  });
  S._vernier = { mapSensor };
})();
