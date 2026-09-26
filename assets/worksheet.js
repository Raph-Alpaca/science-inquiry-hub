/* 학생 활동지 — 틀 (worksheet.html)
 *
 * 문항은 worksheet/lessons.js 에서 읽어 그립니다. 이 파일은 문항 내용을 모릅니다.
 *
 * - 저장: 책장 코드마다 localStorage 한 덩어리(sih-ws-{code}). 로그인·네트워크 없이 동작합니다.
 *   { v:1, code, meta:{team,name}, answers:{key:value}, updatedAt }
 *   이 모양 그대로가 나중에 Firestore 에 올릴 문서입니다. 서버 저장을 붙일 때는 persist() 하나만 고칩니다.
 * - 이미지 저장: 단추를 누를 때만 html2canvas 를 CDN 에서 받아 현재 차시 종이만 캡처합니다.
 * - 인쇄: window.print() + assets/worksheet.css 의 @media print
 */
import { codeEntryHtml, bindCodeEntry, rememberCode, lastCode } from "./code-entry.js";
import { DEMO, loadShelf } from "./shelf-data.js";
import { STEPS, LESSONS } from "../worksheet/lessons.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const params = new URLSearchParams(location.search);
const code = (params.get("code") || "").trim().toUpperCase();
const suffix = DEMO ? "&demo=1" : "";
const H2C = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
const CHECK_DEFAULT = ["잘 돼요", "조금 아쉬워요", "안 돼요"];

let n = clampN(params.get("n"));
let doc = null;           // 저장 덩어리
let saveTimer = null;

function clampN(v) { const k = parseInt(v, 10); return LESSONS.some((l) => l.n === k) ? k : LESSONS[0].n; }
const lesson = () => LESSONS.find((l) => l.n === n);
const pageUrl = (k) => `worksheet.html?code=${encodeURIComponent(code)}&n=${k}${suffix}`;

/* ---------- 저장 ---------- */
const KEY = "sih-ws-" + code;
function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || "null");
    if (o && o.v === 1 && o.answers) return o;
  } catch (e) { /* 무시 */ }
  return { v: 1, code, meta: {}, answers: {}, updatedAt: null };
}
// 서버 저장을 붙일 때 고칠 곳은 여기 하나입니다.
function persist(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* 저장 공간이 없어도 화면은 계속 */ }
}
function get(key) { return key.startsWith("meta.") ? (doc.meta[key.slice(5)] ?? "") : (doc.answers[key] ?? ""); }
function set(key, value) {
  if (key.startsWith("meta.")) doc.meta[key.slice(5)] = value; else doc.answers[key] = value;
  doc.updatedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  $("saveState").textContent = "저장 중…";
  saveTimer = setTimeout(() => { persist(doc); $("saveState").textContent = "자동 저장됨"; refreshProgress(); }, 200);
}

/* ---------- 문항 펼치기 (repeat 의 {i} 를 채워 평평한 목록으로) ---------- */
function fill(s, i) { return typeof s === "string" ? s.replace(/\{i\}/g, i) : s; }
function expandItems(items, i) {
  return items.map((it) => Object.fromEntries(Object.entries(it).map(([k, v]) => [k, fill(v, i)])));
}
// 한 차시의 "답이 들어가는" key 목록 (진행률·지우기에 씀). 모둠·이름·날짜는 세지 않는다.
function answerKeys(les) {
  const keys = [];
  const push = (items) => items.forEach((it) => { if (it.key) keys.push(it.key); });
  (les.blocks || []).forEach((b) => {
    if (b.type === "section") push(b.items);
    if (b.type === "repeat") for (let i = 1; i <= b.count; i++) push(expandItems(b.items, i));
  });
  return keys;
}
function progressOf(les) {
  const keys = answerKeys(les);
  if (!keys.length) return null;
  const done = keys.filter((k) => String(get(k)).trim() !== "").length;
  return Math.round((done / keys.length) * 100);
}

/* ---------- 그리기 ---------- */
function itemHtml(it, idx) {
  const num = idx != null ? `<span class="q-no">${idx}</span>` : "";
  const hint = it.hint ? `<span class="q-hint">${esc(it.hint)}</span>` : "";
  const val = get(it.key || "");
  switch (it.type) {
    case "note":
      return `<p class="q-note">${esc(it.text)}</p>`;
    case "short":
    case "url":
      return `<div class="q"><label class="q-label" for="f-${esc(it.key)}">${num}${esc(it.label)}${hint}</label>
        <input type="${it.type === "url" ? "url" : "text"}" id="f-${esc(it.key)}" data-key="${esc(it.key)}" value="${esc(val)}" placeholder="${esc(it.placeholder || "")}"${it.type === "url" ? ' inputmode="url" autocapitalize="off" spellcheck="false"' : ""}></div>`;
    case "long":
      return `<div class="q${it.copy ? " q-copy" : ""}"><label class="q-label" for="f-${esc(it.key)}">${num}${esc(it.label)}${hint}</label>
        <textarea id="f-${esc(it.key)}" data-key="${esc(it.key)}" rows="${it.rows || 3}" placeholder="${esc(it.placeholder || "")}">${esc(val)}</textarea>
        ${it.copy ? `<div class="copy-row no-print"><button type="button" class="btn small copy" data-copy="${esc(it.key)}">복사</button><span class="count" data-count="${esc(it.key)}">${String(val).length}자</span></div>` : ""}</div>`;
    case "check": {
      const opts = it.options || CHECK_DEFAULT;
      const marks = ["✓", "△", "✕"];
      return `<div class="q q-check"><div class="q-label" id="l-${esc(it.key)}">${num}${esc(it.label)}${hint}</div>
        <div class="seg" role="radiogroup" aria-labelledby="l-${esc(it.key)}">${opts.map((o, i) => `
          <label class="seg-opt s${i}"><input type="radio" name="${esc(it.key)}" data-key="${esc(it.key)}" value="${esc(o)}"${val === o ? " checked" : ""}><span><b>${marks[i] || ""}</b>${esc(o)}</span></label>`).join("")}
        </div>
        ${it.memo ? `<input type="text" class="memo" data-key="${esc(it.key)}.memo" value="${esc(get(it.key + ".memo"))}" placeholder="발견한 문제나 확인한 내용을 적어 보세요 🔍" aria-label="${esc(it.label)} 메모">` : ""}</div>`;
    }
    case "choice":
    case "multi": {
      const many = it.type === "multi";
      const chosen = many ? String(val).split("\n").filter(Boolean) : [val];
      return `<div class="q q-choice"><div class="q-label" id="l-${esc(it.key)}">${num}${esc(it.label)}${hint}</div>
        <div class="chips" role="${many ? "group" : "radiogroup"}" aria-labelledby="l-${esc(it.key)}">${it.options.map((o) => `
          <label class="chip-opt"><input type="${many ? "checkbox" : "radio"}" name="${esc(it.key)}" data-key="${esc(it.key)}" value="${esc(o)}"${chosen.includes(o) ? " checked" : ""}><span>${esc(o)}</span></label>`).join("")}
          ${it.other ? `<label class="chip-opt other"><input type="${many ? "checkbox" : "radio"}" name="${esc(it.key)}" data-key="${esc(it.key)}" value="기타"${chosen.includes("기타") ? " checked" : ""}><span>기타:</span></label>
          <input type="text" class="other-in" data-key="${esc(it.key)}.other" value="${esc(get(it.key + ".other"))}" placeholder="직접 적기" aria-label="기타 내용">` : ""}
        </div></div>`;
    }
    default:
      return "";
  }
}
function itemsHtml(items) {
  let q = 0;
  return items.map((it) => itemHtml(it, it.key ? ++q : null)).join("");
}
function blockHtml(b, les) {
  switch (b.type) {
    case "meta":
      return `<div class="meta-row">
        <label>모둠 <input type="text" data-key="meta.team" value="${esc(get("meta.team"))}" placeholder="예: 1모둠" maxlength="30"></label>
        <label>학번·이름 <input type="text" data-key="meta.name" value="${esc(get("meta.name"))}" placeholder="예: 20415 김하늘" maxlength="40"></label>
        <label>날짜 <input type="text" data-key="n${les.n}.date" value="${esc(get(`n${les.n}.date`))}" placeholder="월 / 일" maxlength="20"></label>
      </div>`;
    case "section":
      return `<section class="sec"><h3>${esc(b.title)}</h3>${b.intro ? `<p class="sec-intro">${esc(b.intro)}</p>` : ""}${itemsHtml(b.items)}</section>`;
    case "repeat": {
      let out = "";
      for (let i = 1; i <= b.count; i++) out += `<section class="sec rep"><h3>${esc(fill(b.title, i))}</h3>${itemsHtml(expandItems(b.items, i))}</section>`;
      return out;
    }
    case "note":
      return `<p class="sheet-note">${esc(b.text)}</p>`;
    case "link": {
      const href = String(b.href).replace("{code}", encodeURIComponent(code)) + (DEMO && /\.html\?/.test(b.href) ? "&demo=1" : "");
      return `<div class="linkrow no-print"><a class="btn go" href="${esc(href)}" data-prefill="${b.prefill ? esc(JSON.stringify(b.prefill)) : ""}">${esc(b.label)}</a>${b.desc ? `<p>${esc(b.desc)}</p>` : ""}</div>`;
    }
    default:
      return "";
  }
}

function renderJourney() {
  $("journey").innerHTML = STEPS.map((s) => {
    const les = LESSONS.find((l) => l.n === s.n);
    const pct = les && !les.field ? progressOf(les) : null;
    const cur = s.n === n;
    return `<a class="step${cur ? " cur" : ""}${s.field ? " field" : ""}" href="${esc(pageUrl(s.n))}" data-n="${s.n}" aria-current="${cur ? "step" : "false"}">
      <span class="step-no">STEP ${s.n}</span><span class="step-name">${esc(s.step)}</span><span class="step-short">${esc(s.short)}</span>
      <span class="step-pct" data-pct="${s.n}">${s.field ? "현장 활동" : pct + "%"}</span></a>`;
  }).join("");
}
function refreshProgress() {
  LESSONS.forEach((les) => {
    const el = document.querySelector(`[data-pct="${les.n}"]`);
    if (el && !les.field) el.textContent = progressOf(les) + "%";
  });
  const cur = lesson();
  if (!cur.field) $("sheetPct").textContent = progressOf(cur) + "%";
}

function renderSheet() {
  const les = lesson();
  document.title = `${les.n}차시 ${les.title} — 학생 활동지`;
  $("sheet").className = "sheet n" + les.n + (les.field ? " field" : "");
  $("sheet").innerHTML = `
    <header class="sheet-head">
      <span class="sheet-kicker">우리가 만드는 디지털 과학 교과서 · 학생 활동지</span>
      <h2><span class="sheet-step">STEP ${les.n} · ${esc(les.step)}</span>${esc(les.title)}</h2>
      ${les.goal ? `<p class="sheet-goal">${esc(les.goal)}</p>` : ""}
      ${les.field ? "" : `<span class="sheet-pct no-print" id="sheetPct">${progressOf(les)}%</span>`}
    </header>
    <div class="sheet-body">${(les.blocks || []).map((b) => blockHtml(b, les)).join("")}</div>
    <footer class="sheet-foot">${les.n}차시 활동지 · ${esc(les.step)}${get("meta.team") ? " · " + esc(get("meta.team")) : ""}${get("meta.name") ? " · " + esc(get("meta.name")) : ""}</footer>`;
  $("sheet").querySelectorAll("textarea").forEach(autosize);
  const prev = LESSONS.find((l) => l.n === n - 1), next = LESSONS.find((l) => l.n === n + 1);
  $("prev").hidden = !prev; $("next").hidden = !next;
  if (prev) { $("prev").href = pageUrl(prev.n); $("prev").textContent = `‹ ${prev.n}차시 ${prev.step}`; }
  if (next) { $("next").href = pageUrl(next.n); $("next").textContent = `${next.n}차시 ${next.step} ›`; }
  $("saveImg").hidden = $("print").hidden = $("clear").hidden = !!les.field;
  $("confirmClear").hidden = true;
}
function autosize(t) { t.style.height = "auto"; t.style.height = Math.max(t.scrollHeight + 2, 0) + "px"; }

function go(k, push = true) {
  n = clampN(k);
  if (push) history.pushState({ n }, "", pageUrl(n));
  renderJourney(); renderSheet();
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ---------- 입력 → 저장 ---------- */
function onInput(e) {
  const el = e.target.closest("[data-key]");
  if (!el) return;
  const key = el.dataset.key;
  if (el.type === "radio") {
    if (!el.checked) return;
    // 인쇄·이미지에서도 고른 것이 보이게 속성으로도 남긴다
    document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`).forEach((r) => r.toggleAttribute("checked", r === el));
    set(key, el.value);
  } else if (el.type === "checkbox") {
    el.toggleAttribute("checked", el.checked);
    const all = [...document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)].filter((c) => c.checked).map((c) => c.value);
    set(key, all.join("\n"));
  } else {
    if (el.tagName === "TEXTAREA") { autosize(el); const c = document.querySelector(`[data-count="${CSS.escape(key)}"]`); if (c) c.textContent = el.value.length + "자"; }
    set(key, el.value);
    if (key === "meta.team" || key === "meta.name") {
      const f = $("sheet").querySelector(".sheet-foot");
      if (f) f.textContent = `${n}차시 활동지 · ${lesson().step}${get("meta.team") ? " · " + get("meta.team") : ""}${get("meta.name") ? " · " + get("meta.name") : ""}`;
    }
  }
}

/* ---------- 복사·지우기·제출 폼 미리 채우기 ---------- */
async function copyText(key, btn) {
  const text = get(key);
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
    const ta = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (ta) { ta.select(); try { ok = document.execCommand("copy"); } catch (e2) { /* 무시 */ } ta.blur(); }
  }
  const was = btn.textContent; btn.textContent = ok ? "복사됨 ✓" : "복사 실패";
  setTimeout(() => (btn.textContent = was), 1400);
}
function clearLesson() {
  const les = lesson();
  answerKeys(les).forEach((k) => { delete doc.answers[k]; delete doc.answers[k + ".memo"]; delete doc.answers[k + ".other"]; });
  delete doc.answers[`n${les.n}.date`];
  doc.updatedAt = new Date().toISOString();
  persist(doc);
  renderSheet(); refreshProgress();
  $("saveState").textContent = `${les.n}차시 입력을 지웠어요`;
}
// 제출 폼(submit.html)이 되살리는 초안(sih-submit-{code})에 제목·주소·모둠명을 넣어 둔다
function prefillSubmit(map) {
  try {
    const k = "sih-submit-" + code;
    const o = JSON.parse(localStorage.getItem(k) || "{}") || {};
    Object.entries(map).forEach(([field, key]) => { const v = String(get(key)).trim(); if (v && !String(o[field] || "").trim()) o[field] = v; });
    localStorage.setItem(k, JSON.stringify(o));
  } catch (e) { /* 무시 */ }
}

/* ---------- 이미지로 저장 ---------- */
function loadH2C() {
  if (window.html2canvas) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = H2C; s.onload = res; s.onerror = () => rej(new Error("html2canvas 를 받지 못했습니다"));
    document.head.appendChild(s);
  });
}
function fileName(ext) {
  const team = String(get("meta.team")).trim().replace(/[\\/:*?"<>|\s]+/g, "_");
  return `활동지_${n}차시${team ? "_" + team : ""}.${ext}`;
}
async function saveImage() {
  const btn = $("saveImg");
  btn.disabled = true; const was = btn.textContent; btn.textContent = "그리는 중…";
  try {
    await loadH2C();
    $("sheet").querySelectorAll("textarea").forEach(autosize);
    const canvas = await window.html2canvas($("sheet"), {
      scale: 2, backgroundColor: "#FFFDF8", useCORS: true, logging: false, scrollX: 0, scrollY: -window.scrollY,
      ignoreElements: (el) => el.classList && el.classList.contains("no-export"),
      onclone: (cd) => {
        // 입력 칸은 글자로 바꿔 그린다 (캔버스가 입력 칸 안 글자를 빠뜨리는 일이 없게)
        cd.querySelectorAll("textarea, input[type=text], input[type=url]").forEach((el) => {
          const d = cd.createElement("div");
          d.className = "as-text " + (el.className || "") + (el.tagName === "TEXTAREA" ? " ta" : " in");
          d.textContent = el.value;
          if (!el.value) { d.textContent = ""; d.classList.add("empty"); }
          d.style.minHeight = el.offsetHeight + "px";
          el.replaceWith(d);
        });
        cd.querySelectorAll(".no-print").forEach((el) => el.remove());
      },
    });
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const url = URL.createObjectURL(blob);
    if (/iP(hone|ad|od)/.test(navigator.userAgent) && !window.MSStream) {
      window.open(url, "_blank");
    } else {
      const a = document.createElement("a"); a.href = url; a.download = fileName("png"); document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    $("saveState").textContent = "이미지로 저장했어요";
  } catch (e) {
    $("saveState").textContent = "이미지 저장에 실패했어요. 인터넷 연결을 확인하고 다시 눌러 주세요";
    console.warn(e);
  } finally { btn.disabled = false; btn.textContent = was; }
}

/* ---------- 시작 ---------- */
(async function start() {
  if (DEMO) {
    $("demoBar").hidden = false;
    if (code) $("demoBar").insertAdjacentHTML("beforeend", ` <a href="shelf.html?code=${encodeURIComponent(code)}${suffix}">책장으로 →</a>`);
  }
  if (!code) {
    $("sub").textContent = "책장 코드를 넣으면 우리 반 활동지가 열립니다";
    $("notice").innerHTML = `<div class="notice"><h2>선생님께 책장 코드를 받으세요</h2>
      <p>활동지는 이 기기에만 저장돼요. 어느 반 활동지인지 알 수 있게 선생님이 알려 준 코드를 넣어 주세요.</p>
      ${codeEntryHtml({ value: lastCode(), page: "worksheet" })}</div>`;
    bindCodeEntry(DEMO);
    return;
  }
  doc = load();
  rememberCode(code);
  $("codeText").textContent = code; $("codeChip").hidden = false;
  $("sub").textContent = "입력하면 이 기기에 자동 저장돼요 · 다 쓰면 이미지로 저장하거나 인쇄해요";
  $("wsMain").hidden = false; $("wsBar").hidden = false;
  renderJourney(); renderSheet();

  $("sheet").addEventListener("input", onInput);
  $("sheet").addEventListener("change", onInput);
  $("sheet").addEventListener("click", (e) => {
    const c = e.target.closest("button[data-copy]"); if (c) return copyText(c.dataset.copy, c);
    const a = e.target.closest("a[data-prefill]"); if (a && a.dataset.prefill) { try { prefillSubmit(JSON.parse(a.dataset.prefill)); } catch (e2) { /* 무시 */ } }
  });
  $("journey").addEventListener("click", (e) => { const a = e.target.closest("a.step"); if (a) { e.preventDefault(); go(a.dataset.n); } });
  $("prev").addEventListener("click", (e) => { e.preventDefault(); go(n - 1); });
  $("next").addEventListener("click", (e) => { e.preventDefault(); go(n + 1); });
  window.addEventListener("popstate", () => go(new URLSearchParams(location.search).get("n"), false));
  $("saveImg").addEventListener("click", saveImage);
  $("print").addEventListener("click", () => { persist(doc); $("sheet").querySelectorAll("textarea").forEach(autosize); window.print(); });
  $("clear").addEventListener("click", () => { $("confirmClear").hidden = false; $("clearYes").focus(); });
  $("clearNo").addEventListener("click", () => { $("confirmClear").hidden = true; });
  $("clearYes").addEventListener("click", () => { $("confirmClear").hidden = true; clearLesson(); });
  window.addEventListener("beforeprint", () => $("sheet").querySelectorAll("textarea").forEach(autosize));
  window.addEventListener("resize", () => $("sheet").querySelectorAll("textarea").forEach(autosize));

  // 학교 이름은 되면 붙이고, 안 되어도 활동지는 그대로 연다
  try {
    const { shelf } = await loadShelf(code);
    if (shelf) $("sub").textContent = `${shelf.school} · 입력하면 이 기기에 자동 저장돼요`;
  } catch (e) { /* 네트워크가 없어도 됨 */ }
})();
