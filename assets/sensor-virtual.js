/* science-inquiry-hub — 가상 센서 어댑터
   기기 없이 개발·시연·자동 검사를 하기 위한 것. 실제 어댑터와 똑같이 표준 스트림으로 값을 낸다.
   주소에 ?sensor=virtual 을 붙이면 센서 모드로 열리며 가상 센서가 바로 연결된다.
   &vspeed=60 을 붙이면 가상 시계가 60배로 흐른다 (한 시간짜리 냉각을 1분에 보기). 표본의 t 도 그 시계를 따른다.

   profile
     cooling-a / cooling-b   뜨거운 물 78 ℃ → 교실 22 ℃, 냉각 상수 0.020 / 0.055 (1/분)
     heating                 얼음 −8 ℃ → 0 ℃에서 60초 머묾 → 100 ℃에서 머묾
     cup                     25 ℃ 컵이 1초에 0.12 ℃씩 식음
     air                     기온 24 ℃, 습도 55 %
     freefall                바닥에서 150 cm 높이에 아래를 향해 둔 거리 센서 (20 Hz). 센서 30 cm 아래에 1.5초 들고 있던 공을 놓아
                             공기 저항 없이 떨어뜨리고, 바닥(센서에서 145 cm)에 닿으면 멈췄다가 4초마다 다시 들어 올린다 */
(function () {
  const S = window.SIHSensor;
  const vs = +new URLSearchParams(location.search).get("vspeed");
  if (vs > 0 && vs <= 600) S.setClockScale(vs);
  const noise = (a) => (Math.random() - 0.5) * 2 * a;

  const PROFILES = {
    "cooling-a": { label: "가상 온도 센서 A", ms: 250, ch: [{ quantity: "temperature" }], f: (s) => [22 + 56 * Math.exp(-0.02 * s / 60) + noise(0.08)] },
    "cooling-b": { label: "가상 온도 센서 B", ms: 250, ch: [{ quantity: "temperature" }], f: (s) => [22 + 56 * Math.exp(-0.055 * s / 60) + noise(0.08)] },
    heating: { label: "가상 온도 센서", ms: 250, ch: [{ quantity: "temperature" }],
      f: (s) => [(s < 20 ? -8 + 0.4 * s : s < 80 ? 0 : s < 280 ? (s - 80) * 0.5 : 100) + noise(0.1)] },
    cup: { label: "가상 온도 센서 (컵)", ms: 250, ch: [{ quantity: "temperature" }], f: (s) => [Math.max(3, 25 - 0.12 * s) + noise(0.05)] },
    air: { label: "가상 온습도 센서", ms: 500, ch: [{ quantity: "temperature" }, { quantity: "humidity" }], f: () => [24 + noise(0.05), 55 + noise(0.3)] },
    freefall: { label: "가상 거리 센서", ms: 50, ch: [{ quantity: "distance" }],
      f(s) {
        const u = s % 4 - 1.5;                                   // 놓은 뒤 시간 (음수면 아직 들고 있음)
        return [(u <= 0 ? 0.3 : Math.min(1.45, 0.3 + 0.5 * 9.8 * u * u)) + noise(0.003)];
      } },
  };

  S.register({
    id: "virtual", label: "가상",
    async open(o, ctx) {
      const p = PROFILES[o.profile];
      if (!p) throw new Error("모르는 가상 센서: " + o.profile);
      const push = p.ch.map((c) => ctx.channel(c)), st = p.init ? p.init() : {}, t0 = S.now();
      const timer = setInterval(() => { const t = S.now(); p.f(t - t0, st).forEach((v, i) => push[i](Math.round(v * 1000) / 1000, { t })); }, p.ms);
      return { label: p.label, close() { clearInterval(timer); } };
    },
  });
  S.virtualProfiles = Object.keys(PROFILES);
})();
