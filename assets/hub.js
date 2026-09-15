/* science-inquiry-hub — 공통 틀
   각 앱은 window.APP = { id, grade, unit, title, question, how, notes, prompt, next, sensor } 를 정의한 뒤
   SIH.shell() 을 호출한다. 앱 본문(.lab)은 HTML에 직접 둔다.

   도우미:
     SIH.reduced                    prefers-reduced-motion 여부
     SIH.dpr(canvas, w, h)          고해상도 2D 컨텍스트 (표시 크기에 맞춰 오버샘플링)
     SIH.drawChart(ctx, opts)       선 그래프. 반환 {px, py, inv, box}
     SIH.canvasXY(canvas, ev, w, h) 클릭 위치 → 캔버스 논리 좌표
     SIH.bind(id, fn, unit)         슬라이더 값 표시 + 콜백
     SIH.tabs([{btn, panel, key}], onChange)
     SIH.fmt(v)                     눈금 숫자 표기
*/
(function () {
  const SIH = (window.SIH = {});
  SIH.reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // 파비콘(이모지)을 모든 페이지에 넣어 favicon.ico 404를 막는다
  SIH.favicon = function (emoji) {
    if (document.querySelector('link[rel="icon"]')) return;
    const l = document.createElement("link");
    l.rel = "icon";
    l.href = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${emoji || "🔬"}</text></svg>`);
    document.head.appendChild(l);
  };

  // ---------- 화면 틀 ----------
  SIH.shell = function () {
    const A = window.APP;
    const GRADE_ICON = { 1: "🧪", 2: "🔭", 3: "⚖️" };
    SIH.favicon(A.icon || GRADE_ICON[A.grade] || "🔬");
    document.body.dataset.grade = A.grade;
    document.title = `${A.title} · 과학탐구 앱 허브`;
    const lab = document.querySelector(".lab");
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    lab.parentNode.insertBefore(wrap, lab);

    wrap.innerHTML = `
      <header class="top">
        <a class="back" href="../index.html">← 탐구 허브</a>
        <span class="grade">중${A.grade}</span>
        <span class="unit">${esc(A.unit)}</span>
        <span class="grow"></span>
        <div class="source">
          <span class="dot" id="srcDot" aria-hidden="true"></span>
          <label for="srcSel">데이터</label>
          <select id="srcSel">
            <option value="sim">시뮬레이션</option>
            <option value="sensor" disabled>실시간 센서 (${esc(A.sensor || "준비 중")})</option>
          </select>
        </div>
      </header>
      <section class="ask">
        <h1>${esc(A.title)}</h1>
        <p class="q">${esc(A.question)}</p>
        ${A.how ? `<p class="how">${esc(A.how)}</p>` : ""}
      </section>`;
    wrap.appendChild(lab);

    const note = document.createElement("section");
    note.className = "note";
    note.setAttribute("aria-labelledby", "noteTitle");
    const n = A.notes || [];
    note.innerHTML = `
      <h2 id="noteTitle">탐구 기록</h2>
      <p class="lead">조작하기 전에 예측을 먼저 적고, 화면에서 본 것을 그대로 적은 뒤, 과학 개념으로 설명해 보세요.</p>
      <div class="cols">
        <div class="col"><label for="n1">예측</label><small>${esc(n[0] || "조작하면 어떻게 될 것 같나요? 이유도 함께.")}</small><textarea id="n1"></textarea></div>
        <div class="col"><label for="n2">관찰</label><small>${esc(n[1] || "그래프·모형에서 실제로 본 것. 숫자를 포함해서.")}</small><textarea id="n2"></textarea></div>
        <div class="col"><label for="n3">설명</label><small>${esc(n[2] || "예측과 결과가 왜 같았나요 / 달랐나요? 교과서 개념으로.")}</small><textarea id="n3"></textarea></div>
      </div>
      <div class="foot">
        <button class="btn" id="noteSave">이 기기에 저장</button>
        <button class="btn" id="noteDown">텍스트로 내려받기</button>
        <button class="btn" id="noteClear">지우기</button>
        <span class="status" id="noteStatus" role="status" aria-live="polite"></span>
      </div>`;
    wrap.appendChild(note);

    const details = document.createElement("details");
    details.className = "prompt";
    details.innerHTML = `<summary>이 앱은 어떤 프롬프트로 만들었을까?</summary><pre></pre><p class="next"></p>`;
    details.querySelector("pre").textContent = A.prompt || "";
    details.querySelector(".next").textContent = "다음 차시로 가져갈 질문: " + (A.next || "");
    wrap.appendChild(details);

    const foot = document.createElement("footer");
    foot.className = "app-foot";
    foot.textContent = "시뮬레이션 값은 교과서 수준의 단순화된 모형으로 계산한 것이며, 실제 측정값과 다를 수 있습니다. 실시간 센서 모드는 무선 센서 실험실 코드와 연결해 추가할 예정입니다.";
    wrap.appendChild(foot);

    // 기록 저장
    const key = "sih-note-" + A.id;
    const ids = ["n1", "n2", "n3"];
    const $ = (id) => document.getElementById(id);
    const status = $("noteStatus");
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved) ids.forEach((id, i) => ($(id).value = saved[i] || ""));
    } catch (e) { /* 저장소를 못 쓰는 환경 */ }
    $("noteSave").onclick = () => {
      try {
        localStorage.setItem(key, JSON.stringify(ids.map((id) => $(id).value)));
        status.textContent = "저장됨 · 이 브라우저에서만 보입니다";
      } catch (e) {
        status.textContent = "저장할 수 없는 환경입니다. 내려받기를 이용하세요";
      }
    };
    $("noteDown").onclick = () => {
      const t = `[${A.title}] 탐구 기록\n탐구 질문: ${A.question}\n\n■ 예측\n${$("n1").value}\n\n■ 관찰\n${$("n2").value}\n\n■ 설명\n${$("n3").value}\n`;
      const a = document.createElement("a");
      const url = URL.createObjectURL(new Blob([t], { type: "text/plain;charset=utf-8" }));
      a.href = url; a.download = `${A.id}-탐구기록.txt`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "텍스트 파일로 내려받았습니다";
    };
    $("noteClear").onclick = () => {
      ids.forEach((id) => ($(id).value = ""));
      try { localStorage.removeItem(key); } catch (e) { /* 무시 */ }
      status.textContent = "기록을 지웠습니다";
    };
  };

  // ---------- 캔버스 도우미 ----------
  // 캔버스는 논리 크기(w×h)로 그리고, 실제 표시 크기에 맞춰 해상도를 정한다.
  //  - 교실 스크린처럼 크게 보이면 더 촘촘히 그려 흐려지지 않게
  //  - 휴대폰처럼 작게 보이면 SIH.fs(ctx)만큼 글자를 키워 읽을 수 있게
  // 창 크기가 바뀌면 다시 계산하고 "sih:resize" 이벤트를 보낸다(정지 화면 앱은 이때 다시 그린다).
  const canvases = [];
  function fit(item) {
    const { canvas, w, h, ctx } = item;
    const shown = canvas.clientWidth || item.shown || w;
    item.shown = shown;
    const r = (window.devicePixelRatio || 1) * Math.min(2.5, Math.max(1, shown / w));
    canvas.width = Math.round(w * r); canvas.height = Math.round(h * r);
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx._fs = Math.min(2.2, Math.max(1, (w / shown) * 0.8));
  }
  SIH.dpr = function (canvas, w, h) {
    canvas.style.aspectRatio = `${w} / ${h}`;
    const ctx = canvas.getContext("2d");
    const item = { canvas, w, h, ctx };
    ctx._w = w; ctx._h = h;
    fit(item);
    canvases.push(item);
    return ctx;
  };
  SIH.fs = (ctx) => ctx._fs || 1;           // 글자 배율
  SIH.px = (ctx, size, weight) => `${weight ? weight + " " : ""}${Math.round(size * SIH.fs(ctx))}px ${FONT}`;
  let rsT = 0;
  SIH.refit = function () {
    canvases.forEach((it) => {
      const s = it.canvas.clientWidth;
      if (s && Math.abs(s - it.shown) > 1) fit(it);
      else if (s && !it.fitted) fit(it);
      if (s) it.fitted = true;
    });
    window.dispatchEvent(new Event("sih:resize"));
  };
  window.addEventListener("resize", () => { clearTimeout(rsT); rsT = setTimeout(SIH.refit, 120); });
  window.addEventListener("load", SIH.refit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => window.dispatchEvent(new Event("sih:resize")));

  // 클릭/터치 위치 → 캔버스 논리 좌표 [x, y]
  SIH.canvasXY = function (canvas, ev, w, h) {
    const r = canvas.getBoundingClientRect();
    return [((ev.clientX - r.left) * w) / r.width, ((ev.clientY - r.top) * h) / r.height];
  };

  const FONT = "Pretendard Variable, Pretendard, Malgun Gothic, sans-serif";
  SIH.font = FONT;
  const C = { tick: "#567370", label: "#3f5956", grid: "#e6eeeb", axis: "#9db3ae", ink: "#17302e" };

  /* 선 그래프
     drawChart(ctx, {x,y,w,h, xMin,xMax,yMin,yMax, xLabel,yLabel, xTicks,yTicks,
                     series:[{pts:[[x,y]...], color, width, dash, dots, noLine}],
                     marks:[{x,y,color,label}], bands:[{x1,x2,color}],
                     legend:[{label,color,dash,dot:"fill"|"open"}] })
     반환: {px(x), py(y), inv(px,py), box} */
  SIH.drawChart = function (ctx, o) {
    const k = SIH.fs(ctx), f = (s, wt) => SIH.px(ctx, s, wt);
    const padL = 58 * k, padB = 42 * k, padT = o.yLabel ? 32 * k : 14, padR = 16;
    const x0 = o.x + padL, y0 = o.y + padT, W = o.w - padL - padR, H = o.h - padT - padB;
    const px = (x) => x0 + ((x - o.xMin) / (o.xMax - o.xMin)) * W;
    const py = (y) => y0 + H - ((y - o.yMin) / (o.yMax - o.yMin)) * H;
    ctx.save();
    ctx.fillStyle = "#fff"; ctx.fillRect(o.x, o.y, o.w, o.h);
    (o.bands || []).forEach((b) => {
      ctx.fillStyle = b.color; ctx.fillRect(px(b.x1), y0, px(b.x2) - px(b.x1), H);
    });
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.fillStyle = C.tick; ctx.font = f(14);
    // 좁은 화면에서는 눈금 글자가 겹치지 않게 일부만 표시
    const xt = o.xTicks || 5, yt = o.yTicks || 5;
    const xEvery = W / xt < 34 * k ? Math.ceil((34 * k) / (W / xt)) : 1;
    const yEvery = H / yt < 22 * k ? Math.ceil((22 * k) / (H / yt)) : 1;
    for (let i = 0; i <= xt; i++) {
      const v = o.xMin + ((o.xMax - o.xMin) * i) / xt, X = px(v);
      ctx.beginPath(); ctx.moveTo(X, y0); ctx.lineTo(X, y0 + H); ctx.stroke();
      if (i % xEvery === 0) { ctx.textAlign = "center"; ctx.fillText(SIH.fmt(v), X, y0 + H + 19 * k); }
    }
    for (let i = 0; i <= yt; i++) {
      const v = o.yMin + ((o.yMax - o.yMin) * i) / yt, Y = py(v);
      ctx.beginPath(); ctx.moveTo(x0, Y); ctx.lineTo(x0 + W, Y); ctx.stroke();
      if (i % yEvery === 0) { ctx.textAlign = "right"; ctx.fillText(SIH.fmt(v), x0 - 7, Y + 5 * k); }
    }
    ctx.strokeStyle = C.axis; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + H); ctx.lineTo(x0 + W, y0 + H); ctx.stroke();
    ctx.fillStyle = C.label; ctx.font = f(14, 600);
    if (o.xLabel) { ctx.textAlign = "right"; ctx.fillText(o.xLabel, x0 + W, y0 + H + 37 * k); }
    if (o.yLabel) { ctx.textAlign = "left"; ctx.fillText(o.yLabel, o.x + 6, y0 - 12 * k); }
    // 범례 (오른쪽 위)
    if (o.legend && o.legend.length) {
      ctx.font = f(13); ctx.textAlign = "left";
      let lx = x0 + W - 10;
      const items = o.legend.slice().reverse();
      items.forEach((l) => {
        const tw = ctx.measureText(l.label).width;
        lx -= tw + 30;
        const ly = y0 + 14 * k;
        if (l.dot) {
          ctx.beginPath(); ctx.arc(lx + 8, ly, 5, 0, Math.PI * 2);
          ctx.fillStyle = l.dot === "open" ? "#fff" : l.color; ctx.fill();
          ctx.strokeStyle = l.color; ctx.lineWidth = 2; ctx.stroke();
        } else {
          ctx.strokeStyle = l.color; ctx.lineWidth = 3; ctx.setLineDash(l.dash || []);
          ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 18, ly); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.fillStyle = C.label; ctx.fillText(l.label, lx + 24, ly + 4);
        lx -= 4;
      });
    }
    ctx.beginPath(); ctx.rect(x0, y0, W, H); ctx.clip();
    (o.series || []).forEach((s) => {
      if (!s.pts || !s.pts.length) return;
      ctx.strokeStyle = s.color || C.ink; ctx.lineWidth = s.width || 2.4;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      s.pts.forEach((p, i) => (i ? ctx.lineTo(px(p[0]), py(p[1])) : ctx.moveTo(px(p[0]), py(p[1]))));
      if (!s.noLine) ctx.stroke();
      ctx.setLineDash([]);
      if (s.dots) {
        const rr = s.dots === true ? 4 : s.dots;
        s.pts.forEach((p) => {
          ctx.beginPath(); ctx.arc(px(p[0]), py(p[1]), rr, 0, Math.PI * 2);
          if (s.open) { ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = s.color || C.ink; ctx.lineWidth = 2; ctx.stroke(); }
          else { ctx.fillStyle = s.color || C.ink; ctx.fill(); }
        });
      }
    });
    (o.marks || []).forEach((m) => {
      ctx.fillStyle = m.color || "#e29a2a"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px(m.x), py(m.y), 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (m.label) {
        ctx.font = f(13, "bold"); ctx.textAlign = "left";
        const tw = ctx.measureText(m.label).width, th = 17 * k;
        let lx = px(m.x) + 10; if (lx + tw > x0 + W - 4) lx = px(m.x) - tw - 10;
        let ly = py(m.y) - 8; if (ly - th < y0) ly = py(m.y) + th + 6;
        ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(lx - 3, ly - th + 3, tw + 6, th);
        ctx.fillStyle = C.ink; ctx.fillText(m.label, lx, ly);
      }
    });
    ctx.restore();
    return { px, py, inv: (X, Y) => [o.xMin + ((X - x0) / W) * (o.xMax - o.xMin), o.yMin + ((y0 + H - Y) / H) * (o.yMax - o.yMin)], box: { x0, y0, W, H } };
  };
  SIH.fmt = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.abs(v) >= 10 ? +v.toFixed(1) : +v.toFixed(2)).toString();

  // 슬라이더 값 표시 바인딩: bind("id", fn(value), " 단위") → label의 <b> 갱신
  SIH.bind = function (id, fn, unit) {
    const el = document.getElementById(id);
    const b = document.querySelector(`label[for="${id}"] b`);
    const upd = () => { if (b) b.textContent = el.value + (unit || ""); fn && fn(+el.value); };
    el.addEventListener("input", upd); upd();
    return el;
  };
  // 슬라이더 값을 코드에서 바꿀 때 (재생 중 자동 진행 등)
  SIH.setRange = function (id, v) {
    const el = document.getElementById(id);
    el.value = v; el.dispatchEvent(new Event("input"));
  };

  // 탭: [{btn:"id", panel:"id", key:"track"}] — aria 속성과 표시를 함께 관리
  SIH.tabs = function (defs, onChange) {
    const set = (key) => {
      defs.forEach((d) => {
        const on = d.key === key;
        const b = document.getElementById(d.btn), p = document.getElementById(d.panel);
        b.setAttribute("aria-pressed", on ? "true" : "false");
        if (p) p.hidden = !on;
      });
      onChange && onChange(key);
    };
    defs.forEach((d) => (document.getElementById(d.btn).onclick = () => set(d.key)));
    set(defs[0].key);
    return set;
  };

  // 실행 버튼의 상태 표시를 통일: play(btn, {idle, running, paused, done})
  SIH.label = function (btn, state, words) {
    const w = Object.assign({ idle: "시작", running: "일시정지", paused: "계속", done: "완료" }, words || {});
    btn.textContent = w[state];
    btn.disabled = state === "done";
    btn.dataset.state = state;
  };
})();
