/* 학생 활동지 — 틀 (worksheet.html)
 *
 * 문항은 worksheet/lessons.js 에서 읽어 그립니다. 이 파일은 문항 내용을 모릅니다.
 *
 * - 저장: 책장 코드마다 localStorage 한 덩어리(sih-ws-{code}). 로그인·네트워크 없이 동작합니다.
 *   { v:1, code, meta:{team,name}, answers:{key:value}, updatedAt }
 *   이 모양 그대로가 나중에 Firestore 에 올릴 문서입니다. 서버 저장을 붙일 때는 persist() 하나만 고칩니다.
 * - 나의 여정(?n=journey): lessons.js 에서 journey 표시가 붙은 문항의 답만 모아 읽기 전용으로 보여 줍니다.
 * - 안내 그림: worksheet/img/ 에 정해진 이름의 파일이 있으면 그림이, 없으면 "○○ 이미지 추가하세요" 칸이 보입니다.
 * - 이미지 저장: 단추를 누를 때만 html2canvas 를 CDN 에서 받아 현재 종이만 캡처합니다.
 * - 인쇄: window.print() + assets/worksheet.css 의 @media print
 */
import { codeEntryHtml, bindCodeEntry, rememberCode, lastCode } from "./code-entry.js";
import { DEMO, loadShelf } from "./shelf-data.js";
import { STEPS, LESSONS, JOURNEY } from "../worksheet/lessons.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const params = new URLSearchParams(location.search);
const code = (params.get("code") || "").trim().toUpperCase();
const suffix = DEMO ? "&demo=1" : "";
const H2C = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
const IMG_DIR = "worksheet/img/";
const IMG_EXTS = ["png", "jpg"];
const SITE_NAME = "우리가 만드는 디지털 과학책";
const CHECK_DEFAULT = ["잘 돼요", "조금 아쉬워요", "안 돼요"];
const ORD = ["", "1st", "2nd", "3rd", "4th", "5th"];
const NTH = ["", "첫 번째", "두 번째", "세 번째", "네 번째", "다섯 번째"];
const J = "j";            // 나의 여정 화면

let n = clampN(params.get("n"));   // 차시 번호 또는 J
let doc = null;           // 저장 덩어리
let saveTimer = null;

function clampN(v) {
  if (v === J || v === "journey") return J;
  const k = parseInt(v, 10);
  return LESSONS.some((l) => l.n === k) ? k : LESSONS[0].n;
}
const lesson = () => LESSONS.find((l) => l.n === n);
const pageUrl = (k) => `worksheet.html?code=${encodeURIComponent(code)}&n=${k === J ? "journey" : k}${suffix}`;
const ORDER = [...LESSONS.map((l) => l.n), J];
const navName = (k) => (k === J ? JOURNEY.label : `${k}차시 ${LESSONS.find((l) => l.n === k).step}`);

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
  saveTimer = setTimeout(() => { saveTimer = null; persist(doc); $("saveState").textContent = "자동 저장됨"; refreshProgress(); }, 200);
}
// 화면을 옮기거나 다른 쪽으로 나가기 전에, 기다리던 저장을 바로 끝낸다
function flush() {
  if (!saveTimer) return;
  clearTimeout(saveTimer); saveTimer = null;
  persist(doc); $("saveState").textContent = "자동 저장됨";
}

/* ---------- 문항 펼치기 (repeat 의 {i} {ord} {nth} 를 채운다) ---------- */
function fill(v, i) {
  if (typeof v === "string") return v.replace(/\{i\}/g, i).replace(/\{ord\}/g, ORD[i] || i + "th").replace(/\{nth\}/g, NTH[i] || i + "번째");
  if (Array.isArray(v)) return v.map((x) => fill(x, i));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, i)]));
  return v;
}
// 한 차시의 문항 묶음을 차례로 돈다. cb({ block, i, title, items })  repeat 는 i 번째로 펼친 것
function eachGroup(blocks, cb) {
  (blocks || []).forEach((b) => {
    if (b.type === "row") eachGroup(b.blocks, cb);
    else if (b.type === "section") cb({ block: b, title: b.title, items: b.items });
    else if (b.type === "repeat") for (let i = 1; i <= b.count; i++) cb({ block: b, i, title: fill(b.title, i), items: fill(b.items, i) });
  });
}
// 묶음 안의 "답이 들어가는" 문항을 차례로 돈다 (group 안쪽까지)
function eachItem(items, cb) {
  items.forEach((it) => { if (it.type === "group") eachItem(it.items, cb); else if (it.key) cb(it); });
}
// 진행률에 세는 key 목록. 필명·이름·날짜, optional 문항, repeat 의 need 를 넘는 묶음은 세지 않는다.
function answerKeys(les) {
  const keys = [];
  eachGroup(les.blocks, ({ block, i, items }) => {
    if (block.need && i > block.need) return;
    eachItem(items, (it) => { if (!it.optional) keys.push(it.key); });
  });
  return keys;
}
// 한 차시가 저장하는 모든 key (지우기에 씀)
function storedKeys(les) {
  const keys = [`n${les.n}.date`];
  eachGroup(les.blocks, ({ block, i, items }) => {
    if (block.nameKey) keys.push(fill(block.nameKey, i));
    eachItem(items, (it) => keys.push(it.key, it.key + ".memo", it.key + ".other", it.key + ".name"));
  });
  return keys;
}
function progressOf(les) {
  const keys = answerKeys(les);
  if (!keys.length) return null;
  const done = keys.filter((k) => String(get(k)).trim() !== "").length;
  return Math.round((done / keys.length) * 100);
}
// 화면에 보여 줄 답 (고르기 문항의 "기타" 는 적은 글로 바꾼다)
function shown(it) {
  const val = String(get(it.key)).trim();
  if (it.type === "multi") return val.split("\n").filter(Boolean).join(", ");
  if (it.type === "choice" && val === "기타") return `기타: ${String(get(it.key + ".other")).trim()}`.replace(/: $/, "");
  return val;
}

/* ---------- 그리기: 문항 ---------- */
// 칸은 글에 맞춰 늘어나므로(field-sizing), 비어 있을 때의 높이는 줄 수로 정해 준다
const rowsStyle = (rows) => `min-height:${((rows || 3) * 1.6 + 1.3).toFixed(1)}em`;
function itemHtml(it, no) {
  const num = no ? `<span class="q-no">${no}</span>` : "";
  const hint = it.hint ? `<span class="q-hint">${esc(it.hint)}</span>` : "";
  const val = get(it.key || "");
  switch (it.type) {
    case "note":
      return no ? `<p class="q-line">${num}${esc(it.text)}</p>` : `<p class="q-note">${esc(it.text)}</p>`;
    case "criteria":
      return `<ul class="criteria">${it.lines.map((l) => { const m = /^(\[[^\]]+\])\s*(.*)$/.exec(l); return `<li>${m ? `<b>${esc(m[1])}</b> ${esc(m[2])}` : esc(l)}</li>`; }).join("")}</ul>`;
    case "group":
      return `<div class="q q-group"><div class="q-label">${num}${esc(it.label)}${hint}</div><div class="group-box">${itemsHtml(it.items, { sub: true })}</div></div>`;
    case "short":
    case "url":
      return `<div class="q"><label class="q-label" for="f-${esc(it.key)}">${num}${esc(it.label)}${hint}</label>
        <input type="${it.type === "url" ? "url" : "text"}" id="f-${esc(it.key)}" data-key="${esc(it.key)}" value="${esc(val)}" placeholder="${esc(it.placeholder || "")}"${it.type === "url" ? ' inputmode="url" autocapitalize="off" spellcheck="false"' : ""}></div>`;
    case "long":
      return `<div class="q${it.copy ? " q-copy" : ""}"><label class="q-label" for="f-${esc(it.key)}">${num}${esc(it.label)}${hint}</label>
        <textarea id="f-${esc(it.key)}" data-key="${esc(it.key)}" rows="${it.rows || 3}" style="${rowsStyle(it.rows)}" placeholder="${esc(it.placeholder || "")}">${esc(val)}</textarea>
        ${it.copy ? `<div class="copy-row no-print"><button type="button" class="btn small copy" data-copy="${esc(it.key)}">복사</button><span class="count" data-count="${esc(it.key)}">${String(val).length}자</span></div>` : ""}</div>`;
    case "say":
      return `<div class="say ${it.side === "r" ? "r" : "l"}">
        <input type="text" class="say-name" data-key="${esc(it.key)}.name" value="${esc(get(it.key + ".name"))}" placeholder="이름" maxlength="12" aria-label="이름">
        <textarea data-key="${esc(it.key)}" rows="${it.rows || 3}" style="${rowsStyle(it.rows)}" placeholder="${esc(it.placeholder || "")}" aria-label="검토하며 발견한 내용">${esc(val)}</textarea></div>`;
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
      const named = it.label ? `aria-labelledby="l-${esc(it.key)}"` : `aria-label="${many ? "점검하기" : "고르기"}"`;
      return `<div class="q q-choice">${it.label ? `<div class="q-label" id="l-${esc(it.key)}">${num}${esc(it.label)}${hint}</div>` : ""}
        <div class="chips${it.list ? " list" : ""}" role="${many ? "group" : "radiogroup"}" ${named}>${it.options.map((o) => `
          <label class="chip-opt"><input type="${many ? "checkbox" : "radio"}" name="${esc(it.key)}" data-key="${esc(it.key)}" value="${esc(o)}"${chosen.includes(o) ? " checked" : ""}><span>${esc(o)}</span></label>`).join("")}
          ${it.other ? `<label class="chip-opt other"><input type="${many ? "checkbox" : "radio"}" name="${esc(it.key)}" data-key="${esc(it.key)}" value="기타"${chosen.includes("기타") ? " checked" : ""}><span>기타:</span></label>
          <input type="text" class="other-in" data-key="${esc(it.key)}.other" value="${esc(get(it.key + ".other"))}" placeholder="직접 적기" aria-label="기타 내용">` : ""}
        </div></div>`;
    }
    default:
      return "";
  }
}
// 번호는 답이 들어가는 문항·묶음 문항·no:true 인 안내문에 차례로 붙는다. { type:"break" } 는 단을 나눈다.
function itemsHtml(items, opt = {}) {
  let q = 0;
  const cols = [[]];
  items.forEach((it) => {
    if (it.type === "break") { cols.push([]); return; }
    const numbered = !opt.plain && it.no !== false && (it.no === true || it.type === "group" || (it.key && it.type !== "say"));
    cols[cols.length - 1].push(itemHtml(it, numbered ? ++q + (opt.sub ? ")" : ".") : ""));
  });
  return cols.length > 1 ? `<div class="cols">${cols.map((c) => `<div>${c.join("")}</div>`).join("")}</div>` : cols[0].join("");
}

/* ---------- 그리기: 묶음 ---------- */
let triId = 0;
// 화살표 (그라데이션 삼각형). dir: "r" 오른쪽, "d" 아래
function triSvg(dir, c1, c2) {
  const id = "tri" + (++triId);
  return `<svg class="tri ${dir}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="${dir === "r" ? 0 : 1}" y2="${dir === "r" ? 1 : 0}"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><polygon points="${dir === "r" ? "0,0 100,50 0,100" : "0,0 100,0 50,100"}" fill="url(#${id})"/></svg>`;
}
const flowHtml = () => `<div class="flow">${triSvg("d", "#C8F4DA", "#A3C2FA")}</div>`;

function repeatHtml(b) {
  let out = "";
  for (let i = 1; i <= b.count; i++) {
    const title = fill(b.title, i);
    let h3 = esc(title);
    if (b.nameKey) {
      const key = fill(b.nameKey, i);
      const [a, z = ""] = title.split("{name}");
      h3 = `${esc(a)}<input type="text" class="title-in" data-key="${esc(key)}" value="${esc(get(key))}" placeholder="이름" maxlength="12" aria-label="친구 이름">${esc(z)}`;
    }
    out += `<section class="sec rep${b.pick ? " pick" : ""}"><h3>${b.pick ? `<span>${h3}</span>` : h3}</h3>${itemsHtml(fill(b.items, i), { plain: b.plain })}</section>`;
  }
  return `<div class="reps c${b.cols || 1}">${out}</div>`;
}
function guideHtml(b) {
  const many = b.steps.length > 1;
  return `<section class="sec frame guide"><h3>${esc(b.title)}</h3>
    <ol class="steps c${b.cols || 1}">${b.steps.map((s, i) => `<li>
      <p class="cap">${many ? `<span class="cap-no">${i + 1}</span>` : ""}${esc(s.text)}</p>
      ${s.img ? `<figure class="fig no-print"><img alt="${esc(s.name || s.text)}" data-img="${esc(s.img)}"><figcaption>${esc(s.name || s.text)} 이미지 추가하세요</figcaption></figure>` : ""}</li>`).join("")}
    </ol>${b.note ? `<p class="guide-note">${esc(b.note)}</p>` : ""}</section>`;
}
function blockHtml(b, les) {
  switch (b.type) {
    case "meta":
      return `<div class="meta-row">
        <label>공동작가 필명 <input type="text" data-key="meta.team" value="${esc(get("meta.team"))}" placeholder="예: 별빛탐험대" maxlength="30"></label>
        <label>학번·이름 <input type="text" data-key="meta.name" value="${esc(get("meta.name"))}" placeholder="예: 20415 김하늘" maxlength="40"></label>
        <label>날짜 <input type="text" data-key="n${les.n}.date" value="${esc(get(`n${les.n}.date`))}" placeholder="월 / 일" maxlength="20"></label>
      </div>`;
    case "part":
      return `<p class="part"><span>${esc(b.label)}</span></p>`;
    case "section": {
      const body = itemsHtml(b.items, { plain: b.plain });
      return `<section class="sec frame${b.narrow ? " narrow" : ""}"><h3>${esc(b.title)}</h3>${b.intro ? `<p class="sec-intro">${esc(b.intro)}</p>` : ""}${b.grid ? `<div class="grid${b.grid}">${body}</div>` : body}</section>`;
    }
    case "repeat":
      return repeatHtml(b);
    case "row": {
      const tri = b.arrow ? triSvg("r", "#5CCFE9", "#8C6CF1") + triSvg("d", "#5CCFE9", "#8C6CF1") : "";
      return `<div class="row2${b.arrow ? " arrow" : ""}">${b.blocks.map((x) => blockHtml(x, les)).join(tri)}</div>`;
    }
    case "flow":
      return flowHtml();
    case "guide":
      return guideHtml(b);
    case "note":
      return `<p class="sheet-note">${esc(b.text)}</p>`;
    case "link": {
      if (b.view === "journey") return `<div class="linkrow no-print"><a class="btn go" href="${esc(pageUrl(J))}" data-go="${J}">${esc(b.label)}</a>${b.desc ? `<p>${esc(b.desc)}</p>` : ""}</div>`;
      const href = String(b.href).replace("{code}", encodeURIComponent(code)) + (DEMO && /\.html\?/.test(b.href) ? "&demo=1" : "");
      return `<div class="linkrow no-print"><a class="btn go" href="${esc(href)}"${b.prefill ? ` data-prefill="${esc(JSON.stringify(b.prefill))}"` : ""}>${esc(b.label)}</a>${b.desc ? `<p>${esc(b.desc)}</p>` : ""}</div>`;
    }
    default:
      return "";
  }
}

/* ---------- 안내 그림: 파일이 있으면 그림으로, 없으면 빈 칸 그대로 ---------- */
const figFound = new Map();   // 그림 이름 → 찾은 주소 (없으면 "")
function loadFigures() {
  $("sheet").querySelectorAll(".fig img[data-img]").forEach((img) => {
    const name = img.dataset.img;
    const show = (src) => { const f = img.closest(".fig"); f.classList.add("has-img"); f.classList.remove("no-print"); if (img.src !== src) img.src = src; };
    if (figFound.has(name)) { if (figFound.get(name)) show(figFound.get(name)); return; }
    let k = 0;
    const probe = new Image();
    probe.onload = () => { figFound.set(name, probe.src); if (img.isConnected) show(probe.src); };
    probe.onerror = () => { if (++k < IMG_EXTS.length) probe.src = `${IMG_DIR}${name}.${IMG_EXTS[k]}`; else figFound.set(name, ""); };
    probe.src = `${IMG_DIR}${name}.${IMG_EXTS[0]}`;
  });
}

/* ---------- 나의 여정: journey 표시가 붙은 문항만 모은다 ---------- */
function journeyData() {
  return LESSONS.map((les) => {
    const groups = [];
    eachGroup(les.blocks, ({ block, i, title, items }) => {
      const entries = [];
      eachItem(items, (it) => {
        if (it.journey) entries.push({ key: it.key, label: typeof it.journey === "string" ? it.journey : it.label, value: shown(it), long: !!it.copy });
      });
      if (!entries.length) return;
      const name = block.nameKey ? String(get(fill(block.nameKey, i))).trim() || "이름" : "";
      groups.push({ title: title.replace("{name}", name), entries, rep: block.type === "repeat" ? block : null, cols: block.cols || 1 });
    });
    return { les, groups };
  }).filter((x) => x.groups.length);
}
function journeyCount(data) {
  const all = data.flatMap((x) => x.groups.flatMap((g) => g.entries));
  return { done: all.filter((e) => e.value).length, total: all.length };
}
function journeyText() {
  const who = [get("meta.team"), get("meta.name")].map((s) => String(s).trim()).filter(Boolean).join(" · ");
  const lines = [JOURNEY.title + (who ? ` (${who})` : "")];
  journeyData().forEach(({ les, groups }) => {
    lines.push("", `[STEP. ${les.n} ${les.step}] ${les.title}`);
    groups.forEach((g) => {
      lines.push(`■ ${g.title}`);
      g.entries.forEach((e) => lines.push(`- ${e.label}: ${e.value || "(아직 쓰지 않음)"}`));
    });
  });
  return lines.join("\n");
}
function journeyGroupHtml(g) {
  return `<div class="jn-group${g.rep ? " jn-card" : ""}"><h4>${esc(g.title)}</h4><dl>${g.entries.map((e) => `
    <div class="jn-e${e.long ? " long" : ""}${e.value ? "" : " empty"}"><dt>${esc(e.label)}</dt><dd>${e.value ? esc(e.value) : "아직 쓰지 않았어요"}${e.long && e.value ? `<button type="button" class="btn small copy no-print" data-copy="${esc(e.key)}">복사</button>` : ""}</dd></div>`).join("")}</dl></div>`;
}
function journeySheetHtml() {
  const data = journeyData();
  const { done, total } = journeyCount(data);
  const body = data.map(({ les, groups }) => {
    let inner = "";
    for (let i = 0; i < groups.length;) {
      const g = groups[i];
      if (!g.rep) { inner += journeyGroupHtml(g); i++; continue; }
      let j = i; while (j < groups.length && groups[j].rep === g.rep) j++;
      inner += `<div class="reps c${g.cols}">${groups.slice(i, j).map(journeyGroupHtml).join("")}</div>`;
      i = j;
    }
    return `<section class="sec frame jn-les n${les.n}"><h3><span class="les-badge">${les.n}차시</span>${esc(les.step)}</h3>${inner}
      <p class="jn-more no-print"><a href="${esc(pageUrl(les.n))}" data-go="${les.n}">${les.n}차시 활동지에서 고치기</a></p></section>`;
  }).join(flowHtml());
  return `
    <header class="sheet-head">
      <div class="sheet-top"><span class="les-badge">${esc(JOURNEY.label)}</span><span class="sheet-kicker">${SITE_NAME}</span><span class="sheet-pct no-print">${done}/${total} 작성</span></div>
      <h2 class="ribbon"><span>${esc(JOURNEY.title)}</span></h2>
    </header>
    <div class="sheet-body">
      <div class="jn-intro"><p>${esc(JOURNEY.intro)}</p><button type="button" class="btn small no-print" id="jnCopy">전체 복사</button></div>
      ${body}
    </div>
    <footer class="sheet-foot">${esc(footText())}</footer>`;
}

/* ---------- 그리기: 여정 띠와 종이 ---------- */
function footText() {
  const head = n === J ? JOURNEY.label : `${n}차시 활동지 · ${lesson().step}`;
  return [head, get("meta.team"), get("meta.name")].map((s) => String(s).trim()).filter(Boolean).join(" · ");
}
function renderJourney() {
  $("journey").innerHTML = STEPS.map((s) => {
    const les = LESSONS.find((l) => l.n === s.n);
    const pct = les && !les.field ? progressOf(les) : null;
    const cur = s.n === n;
    return `<a class="step${cur ? " cur" : ""}${s.field ? " field" : ""}" href="${esc(pageUrl(s.n))}" data-n="${s.n}" aria-current="${cur ? "step" : "false"}">
      <span class="step-no">STEP ${s.n}</span><span class="step-name">${esc(s.step)}</span><span class="step-short">${esc(s.short)}</span>
      <span class="step-pct" data-pct="${s.n}">${s.field ? esc(s.fieldLabel || "안내") : pct + "%"}</span></a>`;
  }).join("") + `<a class="step jn${n === J ? " cur" : ""}" href="${esc(pageUrl(J))}" data-n="${J}" aria-current="${n === J ? "step" : "false"}">
      <span class="step-no">돌아보기</span><span class="step-name">${esc(JOURNEY.label)}</span><span class="step-short">${esc(JOURNEY.short)}</span></a>`;
}
function refreshProgress() {
  LESSONS.forEach((les) => {
    const el = document.querySelector(`[data-pct="${les.n}"]`);
    if (el && !les.field) el.textContent = progressOf(les) + "%";
  });
  const cur = lesson();
  if (cur && !cur.field) $("sheetPct").textContent = progressOf(cur) + "%";
}

function renderSheet() {
  const les = lesson();
  if (n === J) {
    document.title = `${JOURNEY.label} — 학생 활동지`;
    $("sheet").className = "sheet jn";
    $("sheet").innerHTML = journeySheetHtml();
  } else {
    document.title = `${les.n}차시 ${les.title} — 학생 활동지`;
    $("sheet").className = "sheet n" + les.n + (les.field ? " field" : "");
    $("sheet").innerHTML = `
      <header class="sheet-head">
        <div class="sheet-top"><span class="les-badge">&lt;${les.n}차시&gt;</span><span class="sheet-kicker">${SITE_NAME}</span>${les.field ? "" : `<span class="sheet-pct no-print" id="sheetPct">${progressOf(les)}%</span>`}</div>
        <h2 class="ribbon"><span>[STEP. ${les.n} ${esc(les.step)}] ${esc(les.title)}</span></h2>
        ${les.goal ? `<p class="sheet-goal">${esc(les.goal)}</p>` : ""}
      </header>
      <div class="sheet-body">${(les.blocks || []).map((b) => blockHtml(b, les)).join("")}</div>
      <footer class="sheet-foot">${esc(footText())}</footer>`;
    $("sheet").querySelectorAll("textarea").forEach(autosize);
    loadFigures();
  }
  const at = ORDER.indexOf(n), prev = ORDER[at - 1], next = ORDER[at + 1];
  $("prev").hidden = prev == null; $("next").hidden = next == null;
  if (prev != null) { $("prev").href = pageUrl(prev); $("prev").textContent = `‹ ${navName(prev)}`; }
  if (next != null) { $("next").href = pageUrl(next); $("next").textContent = `${navName(next)} ›`; }
  $("saveImg").hidden = $("print").hidden = !!(les && les.field);
  $("clear").hidden = n === J || !!les.field;
  $("confirmClear").hidden = true;
}
function autosize(t) { t.style.height = "auto"; t.style.height = Math.max(t.scrollHeight + 2, 0) + "px"; }

function go(k, push = true) {
  flush();
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
      if (f) f.textContent = footText();
    }
  }
}

/* ---------- 복사·지우기·출판 의뢰서 미리 채우기 ---------- */
async function copyText(text, btn, from) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
    if (from) { from.select(); try { ok = document.execCommand("copy"); } catch (e2) { /* 무시 */ } from.blur(); }
  }
  const was = btn.textContent; btn.textContent = ok ? "복사됨 ✓" : "복사 실패";
  setTimeout(() => (btn.textContent = was), 1400);
}
function clearLesson() {
  const les = lesson();
  storedKeys(les).forEach((k) => { delete doc.answers[k]; });
  doc.updatedAt = new Date().toISOString();
  persist(doc);
  renderSheet(); refreshProgress();
  $("saveState").textContent = `${les.n}차시 입력을 지웠어요`;
}
// 출판 의뢰서(submit.html)가 되살리는 초안(sih-submit-{code})에 제목·주소·공동작가 필명을 넣어 둔다
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
  return `${n === J ? "나의여정" : `활동지_${n}차시`}${team ? "_" + team : ""}.${ext}`;
}
async function saveImage() {
  const btn = $("saveImg");
  btn.disabled = true; const was = btn.textContent; btn.textContent = "그리는 중…";
  try {
    await loadH2C();
    $("sheet").querySelectorAll("textarea").forEach(autosize);
    const canvas = await window.html2canvas($("sheet"), {
      scale: 2, backgroundColor: "#FFFEFA", useCORS: true, logging: false, scrollX: 0, scrollY: -window.scrollY,
      ignoreElements: (el) => el.classList && el.classList.contains("no-export"),
      onclone: (cd) => {
        // 입력 칸은 글자로 바꿔 그린다 (캔버스가 입력 칸 안 글자를 빠뜨리는 일이 없게)
        cd.querySelectorAll("textarea, input[type=text], input[type=url]").forEach((el) => {
          const inline = el.classList.contains("title-in");
          const d = cd.createElement(inline ? "span" : "div");
          d.className = "as-text " + (el.className || "") + (el.tagName === "TEXTAREA" ? " ta" : " in");
          d.textContent = el.value;
          if (!el.value) { d.textContent = ""; d.classList.add("empty"); }
          if (!inline) d.style.minHeight = el.offsetHeight + "px";
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
    const c = e.target.closest("button[data-copy]");
    if (c) return copyText(String(get(c.dataset.copy)), c, document.querySelector(`textarea[data-key="${CSS.escape(c.dataset.copy)}"]`));
    if (e.target.closest("#jnCopy")) return copyText(journeyText(), e.target.closest("#jnCopy"));
    const g = e.target.closest("a[data-go]"); if (g) { e.preventDefault(); return go(g.dataset.go); }
    const a = e.target.closest("a[data-prefill]"); if (a) { flush(); try { prefillSubmit(JSON.parse(a.dataset.prefill)); } catch (e2) { /* 무시 */ } }
  });
  $("journey").addEventListener("click", (e) => { const a = e.target.closest("a.step"); if (a) { e.preventDefault(); go(a.dataset.n); } });
  $("prev").addEventListener("click", (e) => { e.preventDefault(); go(ORDER[ORDER.indexOf(n) - 1]); });
  $("next").addEventListener("click", (e) => { e.preventDefault(); go(ORDER[ORDER.indexOf(n) + 1]); });
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
