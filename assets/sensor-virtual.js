/* science-inquiry-hub — 가상 센서 어댑터
   기기 없이 개발·시연·자동 검사를 하기 위한 것. 실제 어댑터와 똑같이 표준 스트림으로 값을 낸다.
   주소에 ?sensor=virtual 을 붙이면 센서 모드로 열리며 가상 센서가 바로 연결된다.
   &vspeed=60 을 붙이면 가상 시계가 60배로 흐른다 (한 시간짜리 냉각을 1분에 보기). 표본의 t 도 그 시계를 따른다.

   profile
     cooling-a / cooling-b   뜨거운 물 78 ℃ → 교실 22 ℃, 냉각 상수 0.020 / 0.055 (1/분)
     heating                 얼음 −8 ℃ → 0 ℃에서 60초 머묾 → 100 ℃에서 머묾
     cup                     25 ℃ 컵이 1초에 0.12 ℃씩 식음
     air                     기온 24 ℃, 습도 55 %
     pendulum                질량 200 g, 줄 50 cm, 45°에서 놓은 진자의 장력 (25 Hz) */
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
    pendulum: { label: "가상 힘 센서", ms: 40, ch: [{ quantity: "force", zeroable: true }], init: () => ({ th: Math.PI / 4, om: 0, last: null }),
      f(s, st) {
        const g = 9.8, L = 0.5, m = 0.2;
        let dt = st.last === null ? 0 : s - st.last; st.last = s;
        for (let n = Math.ceil(dt / 0.002), h = n ? dt / n : 0, i = 0; i < n; i++) { st.om += (-(g / L) * Math.sin(st.th) - 0.02 * st.om) * h; st.th += st.om * h; }
        return [m * (g * Math.cos(st.th) + L * st.om * st.om) + noise(0.01)];
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
