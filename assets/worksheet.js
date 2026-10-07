/* 학생 활동지 — 틀 (worksheet.html)
 *
 * 문항은 worksheet/lessons.js 에서 읽어 그립니다. 이 파일은 문항 내용을 모릅니다.
 *
 * - 저장: 책장 코드마다 localStorage 한 덩어리(sih-ws-{code})에 먼저 저장합니다.
 *   { v:1, code, sid, meta:{team,name}, answers:{key:value}, groupSynced, updatedAt }   (meta.name 에는 학번만 들어간다)
 * - 학생 확인: 학번 + 비밀번호 4자리. 이름은 받지 않는다(개인정보)(shelf-data.js 의 활동지 부분). 이 기기에서는 기억해 둡니다(sih-ws-login-{code}).
 *   · 개인 칸은 잠시 뒤 서버의 내 문서에도 백업합니다 (기기가 바뀌어도 이어 쓰기).
 *   · 모둠 칸(lessons.js 에서 group:true 띠 아래 + 공동작가 필명)은 같은 학년·반·모둠 번호 학생들이 함께 씁니다.
 *   책장을 못 찾거나 인터넷이 없으면 예전처럼 이 기기에만 저장합니다.
 * - 나의 여정(?n=journey): lessons.js 에서 journey 표시가 붙은 문항의 답만 모아 읽기 전용으로 보여 줍니다.
 * - 안내 그림: worksheet/img/ 에 정해진 이름의 파일이 있으면 그림이, 없으면 "○○ 이미지 추가하세요" 칸이 보입니다.
 * - 이미지 저장: 단추를 누를 때만 html2canvas 를 CDN 에서 받아 현재 종이만 캡처합니다.
 * - 인쇄: window.print() + assets/worksheet.css 의 @media print. 캔바 활동지처럼 A4 가로 한 쪽을 꽉 채운다.
 *   차시를 printBreak 표시로 쪽(.print-page)으로 나누고, 여러 줄 칸은 rows 비율(--r)로 남는 높이를 나눠 가진다(손글씨 공간).
 *   안내 그림·단추·대화 올리기 칸은 인쇄하지 않고, 3차시 대화는 올린 글 + 빈 말풍선으로 나온다.
 */
import { codeEntryHtml, bindCodeEntry, rememberCode, lastCode } from "./code-entry.js";
import {
  DEMO, loadShelf, parseSid, groupId, RESET_PIN, MAX_TEAM,
  findStudent, getStudent, createStudent, updateStudent, changePin, watchStudent, watchGroup, saveGroup, dropName,
  watchPosts, savePost, deletePost, POST_MAX, POST_LEN,
} from "./shelf-data.js";
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
// 이 기기에 저장하고, 로그인했으면 잠시 뒤 서버의 내 문서에도 개인 칸을 백업한다
function persist(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* 저장 공간이 없어도 화면은 계속 */ }
  if (me) { clearTimeout(backupTimer); backupTimer = setTimeout(backup, 1500); }
}

/* ---------- 학생 확인 · 서버 백업 · 모둠 칸 ---------- */
const LOGIN_KEY = "sih-ws-login-" + code;
let shelf = null;         // 책장 (찾지 못했거나 인터넷이 없으면 null → 이 기기에만 저장)
let me = null;            // 로그인한 학생 { id, sid, grade, classNo, num, team, reset }
let gid = "";             // 모둠 문서 이름 (학년-반-모둠)
let groupVals = {};       // 서버에서 받은 모둠 칸
let groupPending = {};    // 아직 서버가 받지 않은 내 모둠 칸 입력
let groupTimer = null, backupTimer = null, groupSaving = false, groupOffline = false, groupReady = false;
let stopGroup = () => {}, stopMe = () => {}, stopPosts = () => {};

// 모둠 칸 key 목록: lessons.js 에서 group:true 띠부터 그 차시 끝(또는 다음 띠)까지 + 공동작가 필명
const GROUP_KEYS = (() => {
  const keys = new Set(["meta.team"]);
  LESSONS.forEach((les) => {
    let on = false;
    const span = [];
    (les.blocks || []).forEach((b) => { if (b.type === "part") on = !!b.group; else if (on) span.push(b); });
    eachGroup(span, ({ block, i, items }) => {
      if (block.nameKey) keys.add(fill(block.nameKey, i));
      eachItem(items, (it) => [it.key, it.key + ".memo", it.key + ".other", it.key + ".name"].forEach((k) => keys.add(k)));
    });
  });
  return keys;
})();
const isGroup = (key) => !!gid && GROUP_KEYS.has(key);
const myName = () => (me ? me.sid : "");

function rawGet(key) { return key.startsWith("meta.") ? (doc.meta[key.slice(5)] ?? "") : (doc.answers[key] ?? ""); }
function rawSet(key, value) { if (key.startsWith("meta.")) doc.meta[key.slice(5)] = value; else doc.answers[key] = value; }
function get(key) {
  if (key === "meta.name" && me) return myName();
  if (CHAT_KEYS.has(key)) return myPosts().map((x) => x.text).join("\n");   // 진행률: 3차시 대화에 내 글이 하나라도 있으면 채운 것
  if (isGroup(key)) return groupPending[key] ?? groupVals[key] ?? (groupReady ? "" : rawGet(key));
  return rawGet(key);
}
function set(key, value) {
  if (key === "meta.name" && me) return;
  rawSet(key, value);     // 모둠 칸도 이 기기에 사본을 둔다 (인터넷이 끊겨도 보이게)
  doc.updatedAt = new Date().toISOString();
  if (isGroup(key)) {
    groupPending[key] = value;
    clearTimeout(groupTimer);
    groupTimer = setTimeout(sendGroup, 600);
  }
  clearTimeout(saveTimer);
  showState("저장 중…");
  saveTimer = setTimeout(() => { saveTimer = null; persist(doc); showState(); refreshProgress(); }, 200);
}
// 화면을 옮기거나 다른 쪽으로 나가기 전에, 기다리던 저장을 바로 끝낸다
function flush() {
  if (groupTimer) { clearTimeout(groupTimer); groupTimer = null; sendGroup(); }
  if (!saveTimer) return;
  clearTimeout(saveTimer); saveTimer = null;
  persist(doc); showState();
}
function showState(text) {
  const el = $("saveState");
  if (!el) return;
  if (text) { el.textContent = text; return; }
  if (!gid) { el.textContent = me ? "자동 저장됨" : "자동 저장됨 (이 기기)"; return; }
  const waiting = Object.keys(groupPending).length > 0 || groupSaving;
  el.textContent = groupOffline && waiting ? "모둠 칸 연결 안 됨 · 다시 연결되면 저장돼요"
    : waiting ? "모둠 칸 저장 중…" : "자동 저장됨 · 모둠 칸은 모둠원과 함께 써요";
}
async function sendGroup() {
  groupTimer = null;
  if (!gid || !shelf) return;
  const vals = { ...groupPending };
  if (!Object.keys(vals).length) return;
  const at = gid;
  groupSaving = true; showState();
  try {
    await saveGroup(shelf, at, vals);
    if (at === gid) {
      Object.assign(groupVals, vals);
      Object.entries(vals).forEach(([k, v]) => { if (groupPending[k] === v) delete groupPending[k]; });
    }
  } catch (e) {
    console.warn("모둠 칸을 저장하지 못했습니다:", e.code || e.message);
    groupOffline = true;
    if (at === gid && !groupTimer) groupTimer = setTimeout(sendGroup, 5000);   // 잠시 뒤 다시
  } finally { groupSaving = false; showState(); }
}
// 개인 칸만 서버의 내 문서에 통째로 올린다 (모둠 칸·필명은 모둠 문서에 있다)
async function backup() {
  backupTimer = null;
  if (!me || !shelf) return true;
  const answers = {};
  Object.entries(doc.answers).forEach(([k, v]) => { if (!GROUP_KEYS.has(k) && String(v ?? "") !== "") answers[k] = String(v); });
  try { await updateStudent(shelf, me.id, { answers }); return true; }
  catch (e) { console.warn("개인 칸을 서버에 백업하지 못했습니다:", e.code || e.message); return false; }
}
// 다른 모둠원이 바꾼 칸을 화면에 반영한다. 지금 내가 쓰고 있는 칸은 건드리지 않는다
function applyRemote(key) {
  if (n === J) return;
  const v = String(get(key));
  $("sheet").querySelectorAll(`[data-key="${CSS.escape(key)}"]`).forEach((el) => {
    if (el === document.activeElement) return;
    if (el.type === "radio") { el.checked = el.value === v; el.toggleAttribute("checked", el.checked); }
    else if (el.type === "checkbox") { el.checked = v.split("\n").includes(el.value); el.toggleAttribute("checked", el.checked); }
    else if (el.value !== v) {
      el.value = v;
      if (el.tagName === "TEXTAREA") { autosize(el); const c = document.querySelector(`[data-count="${CSS.escape(key)}"]`); if (c) c.textContent = v.length + "자"; }
    }
  });
}
function onGroup({ answers, pending, offline }) {
  groupOffline = !!offline && !!pending;
  const before = groupVals;
  groupVals = { ...answers };
  if (!offline) {
    // 처음 모둠에 붙을 때: 이 기기에 먼저 적어 둔 모둠 칸이 있고 모둠 문서의 그 칸이 비어 있으면 올린다 (한 번만)
    if (doc.groupSynced !== gid) {
      if (!doc.groupSynced) GROUP_KEYS.forEach((k) => { const v = rawGet(k); if (String(v).trim() && !String(groupVals[k] ?? "").trim() && groupPending[k] == null) groupPending[k] = v; });
      doc.groupSynced = gid;
      if (Object.keys(groupPending).length) sendGroup();
    }
    groupReady = true;
    // 이 기기의 사본도 맞춰 둔다
    Object.entries(groupVals).forEach(([k, v]) => { if (groupPending[k] == null) rawSet(k, v); });
    try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch (e) { /* 무시 */ }
  }
  const changed = new Set([...Object.keys(before), ...Object.keys(groupVals)].filter((k) => before[k] !== groupVals[k]));
  if (n === J) { if (changed.size) renderSheet(); }
  else changed.forEach(applyRemote);
  if (n !== J && changed.has("meta.team")) {
    const f = $("sheet").querySelector(".sheet-foot");
    if (f) f.textContent = footText();
  }
  refreshProgress(); showState();
}
function joinGroup() {
  stopGroup(); stopPosts(); stopPosts = () => {};
  groupVals = {}; groupPending = {}; groupReady = false;
  posts = []; postsReady = false; chatEdit = null; chatDel = null;
  gid = groupId(me);
  if (!gid || !shelf) { gid = ""; return; }
  stopGroup = watchGroup(shelf, gid, onGroup, (e) => { console.warn("모둠 칸을 읽지 못했습니다:", e.code || e.message); groupOffline = true; showState(); });
  stopPosts = watchPosts(shelf.id, gid, (list) => { posts = list; postsReady = true; renderChats(); refreshProgress(); },
    (e) => console.warn("모둠 대화를 읽지 못했습니다:", e.code || e.message));
}

/* ---------- 3차시 모둠 대화 ----------
 * 말풍선 목록 + 올리기 칸. 글은 모둠 문서 아래 posts 에 {학번}-1, {학번}-2 로 저장된다 (3차시 전체에서 한 사람 2개).
 * 내 글은 오른쪽, 친구 글은 왼쪽. 내 글에만 고치기·지우기. 인쇄에는 올린 글 + 손으로 쓸 빈 말풍선이 나온다. */
const CHAT_PRINT_MIN = 4;     // 인쇄할 때 영역마다 최소 이만큼 말풍선을 둔다 (빈 것은 손으로 쓴다)
const CHAT = new Map();       // 대화 문항 key → 문항 (영역·안내 글)
LESSONS.forEach((les) => eachGroup(les.blocks, ({ items }) => eachItem(items, (it) => { if (it.type === "chat") CHAT.set(it.key, it); })));
const CHAT_KEYS = new Set(CHAT.keys());
let posts = [], postsReady = false;
let chatEdit = null;          // 고치는 중인 내 글 { id, text }
let chatDel = null;           // 지울지 묻는 중인 내 글 id
let chatBusy = false;
const chatOn = () => !!(me && gid && shelf);
const myPosts = () => (me ? posts.filter((x) => x.sid === me.sid) : []);
const freeSlot = () => Array.from({ length: POST_MAX }, (_, i) => i + 1).find((k) => !posts.some((x) => x.id === `${me.sid}-${k}`));
const hhmm = (t) => { if (!t) return ""; const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function chatHtml(it) {
  return `<div class="chat" data-chat-key="${esc(it.key)}">
    <div class="chat-list" aria-live="polite">${chatListHtml(it.area)}</div>
    <div class="chat-compose no-print">${chatComposeHtml(it)}</div>
  </div>`;
}
function bubbleHtml(x) {
  const mine = !!me && x.sid === me.sid;
  const editing = mine && chatEdit && chatEdit.id === x.id;
  const asking = mine && chatDel === x.id;
  const acts = !mine ? "" : editing
    ? `<button type="button" class="btn small dark" data-chat="save" data-id="${esc(x.id)}">저장</button><button type="button" class="btn small" data-chat="cancel">취소</button>`
    : asking
      ? `<span>지울까요?</span><button type="button" class="btn small dark" data-chat="delYes" data-id="${esc(x.id)}">지우기</button><button type="button" class="btn small" data-chat="delNo">아니요</button>`
      : `<button type="button" class="btn small" data-chat="edit" data-id="${esc(x.id)}">고치기</button><button type="button" class="btn small" data-chat="del" data-id="${esc(x.id)}">지우기</button>`;
  const body = editing
    ? `<textarea class="chat-edit" data-edit="${esc(x.id)}" maxlength="${POST_LEN}" rows="2" aria-label="내 글 고치기">${esc(chatEdit.text)}</textarea>`
    : `<p class="chat-text">${esc(x.text)}</p>`;
  const edited = x.updatedAt && x.createdAt && x.updatedAt - x.createdAt > 1500;
  return `<div class="bubble ${mine ? "r mine" : "l"}" data-post="${esc(x.id)}">
    <span class="who"><b>${esc(x.sid)}</b>${mine ? " (나)" : ""} <small>${esc(hhmm(x.updatedAt || x.createdAt))}${edited ? " · 고침" : ""}</small></span>
    <div class="say-box">${body}${acts ? `<span class="chat-acts no-print">${acts}</span>` : ""}</div></div>`;
}
function chatListHtml(area) {
  const list = chatOn() ? posts.filter((x) => x.area === area) : [];
  const empty = chatOn() && postsReady && !list.length ? `<p class="chat-empty no-print">아직 올린 글이 없어요. 점검하며 발견한 것을 올려 보세요.</p>` : "";
  // 빈 말풍선은 인쇄에서만 보인다 (종이에 손으로 쓰는 칸)
  const paper = Array.from({ length: Math.max(0, CHAT_PRINT_MIN - list.length) }, (_, i) =>
    `<div class="bubble ${(list.length + i) % 2 ? "r" : "l"} blank print-only"><span class="who"><b>학번</b></span><div class="say-box"></div></div>`).join("");
  return empty + list.map(bubbleHtml).join("") + paper;
}
function chatComposeHtml(it) {
  if (!chatOn()) return `<p class="chat-off">학번으로 로그인하면 이 칸에 모둠 친구들과 함께 글을 올려요. (지금은 로그인하지 않아 쓸 수 없어요)</p>`;
  const left = POST_MAX - myPosts().length;
  return `<textarea class="chat-in" maxlength="${POST_LEN}" rows="2" placeholder="${esc(left > 0 ? it.placeholder || "검토하며 발견한 내용을 써요." : "")}" aria-label="모둠 대화에 올릴 글"${left > 0 ? "" : " disabled"}></textarea>
    <div class="chat-row"><span class="chat-left">${left > 0
      ? `내 글 ${POST_MAX - left}/${POST_MAX}개 · 3차시 전체에서 ${POST_MAX}개까지 · 학번 <b>${esc(me.sid)}</b>가 자동으로 붙어요`
      : `글은 3차시 전체에서 ${POST_MAX}개까지예요. 내 글을 고치거나 지운 뒤 다시 올려요.`}</span>
    <button type="button" class="btn small dark" data-chat="post"${left > 0 ? "" : " disabled"}>올리기</button></div>`;
}
// 글이 바뀌면 목록을 다시 그린다. 올리기 칸에 쓰던 글과 고치던 글은 그대로 둔다
function renderChats() {
  if (n === J) return;
  document.querySelectorAll("#sheet .chat").forEach((box) => {
    const it = CHAT.get(box.dataset.chatKey);
    const ed = box.querySelector("textarea.chat-edit");
    const caret = ed && ed === document.activeElement ? ed.selectionStart : null;
    box.querySelector(".chat-list").innerHTML = chatListHtml(it.area);
    if (caret != null) { const e2 = box.querySelector("textarea.chat-edit"); if (e2) { e2.focus(); e2.setSelectionRange(caret, caret); } }
    const comp = box.querySelector(".chat-compose");
    const input = comp.querySelector("textarea.chat-in");
    const draft = input ? input.value : "", had = !!input && input === document.activeElement;
    comp.innerHTML = chatComposeHtml(it);
    const ni = comp.querySelector("textarea.chat-in");
    if (ni && !ni.disabled) { ni.value = draft; if (had) ni.focus(); }
  });
}
async function onChat(btn) {
  const act = btn.dataset.chat, id = btn.dataset.id;
  const focusEdit = () => { const e = document.querySelector(`textarea.chat-edit[data-edit="${CSS.escape(id)}"]`); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } };
  if (act === "edit") { const x = posts.find((p) => p.id === id); chatEdit = x ? { id, text: x.text } : null; chatDel = null; renderChats(); focusEdit(); return; }
  if (act === "cancel") { chatEdit = null; renderChats(); return; }
  if (act === "del") { chatDel = id; chatEdit = null; renderChats(); return; }
  if (act === "delNo") { chatDel = null; renderChats(); return; }
  if (chatBusy || !chatOn()) return;
  chatBusy = true; btn.disabled = true;
  try {
    if (act === "post") {
      const box = btn.closest(".chat"), input = box.querySelector("textarea.chat-in");
      const text = input.value.trim(), slot = freeSlot();
      if (!text) { input.focus(); return; }
      if (!slot) return;
      await savePost(shelf, gid, me.sid, slot, { area: CHAT.get(box.dataset.chatKey).area, text }, true);
      input.value = "";
      showState("모둠 대화에 올렸어요");
    } else if (act === "save") {
      const x = posts.find((p) => p.id === id);
      const text = String(chatEdit ? chatEdit.text : "").trim();
      if (!x || !text) { focusEdit(); return; }
      await savePost(shelf, gid, me.sid, id.split("-")[1], { area: x.area, text }, false);
      chatEdit = null;
      showState("글을 고쳤어요");
    } else if (act === "delYes") {
      await deletePost(shelf.id, gid, id);
      chatDel = null;
      showState("글을 지웠어요");
    }
  } catch (e) {
    showState("모둠 대화에 저장하지 못했어요. 인터넷을 확인하고 다시 눌러 주세요");
    console.warn(e);
  } finally {
    chatBusy = false;
    renderChats(); refreshProgress();
  }
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
      return `<div class="q q-group" style="--r:${it.items.reduce((t, x) => t + (x.type === "long" ? x.rows || 3 : 1), 0)}"><div class="q-label">${num}${esc(it.label)}${hint}</div><div class="group-box">${itemsHtml(it.items, { sub: true })}</div></div>`;
    case "short":
    case "url":
      return `<div class="q"><label class="q-label" for="f-${esc(it.key)}">${num}${esc(it.label)}${hint}</label>
        <input type="${it.type === "url" ? "url" : "text"}" id="f-${esc(it.key)}" data-key="${esc(it.key)}" value="${esc(val)}" placeholder="${esc(it.placeholder || "")}"${it.type === "url" ? ' inputmode="url" autocapitalize="off" spellcheck="false"' : ""}></div>`;
    case "long":
      return `<div class="q q-long${it.copy ? " q-copy" : ""}" style="--r:${it.rows || 3}"><label class="q-label" for="f-${esc(it.key)}">${num}${esc(it.label)}${hint}</label>
        <textarea id="f-${esc(it.key)}" data-key="${esc(it.key)}" rows="${it.rows || 3}" style="${rowsStyle(it.rows)}" placeholder="${esc(it.placeholder || "")}">${esc(val)}</textarea>
        ${it.copy ? `<div class="copy-row no-print"><button type="button" class="btn small copy" data-copy="${esc(it.key)}">복사</button><span class="count" data-count="${esc(it.key)}">${String(val).length}자</span></div>` : ""}</div>`;
    case "chat":
      return chatHtml(it);
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
  const cols = [[]], tpl = [[]];
  // 인쇄에서 단 안의 칸이 남는 높이를 줄 수 비율로 나눠 갖도록 grid 줄 틀(여러 줄 칸 = Nfr)을 함께 만든다
  const weight = (it) => (it.type === "long" ? `${it.rows || 3}fr` : it.type === "group" ? `${it.items.reduce((t, x) => t + (x.type === "long" ? x.rows || 3 : 1), 0)}fr` : "auto");
  items.forEach((it) => {
    if (it.type === "break") { cols.push([]); tpl.push([]); return; }
    const numbered = !opt.plain && it.no !== false && (it.no === true || it.type === "group" || (it.key && it.type !== "chat"));
    cols[cols.length - 1].push(itemHtml(it, numbered ? ++q + (opt.sub ? ")" : ".") : ""));
    tpl[tpl.length - 1].push(weight(it));
  });
  return cols.length > 1 ? `<div class="cols">${cols.map((c, i) => `<div style="--tpl:${tpl[i].join(" ")}">${c.join("")}</div>`).join("")}</div>` : cols[0].join("");
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
      h3 = `${esc(a)}<input type="text" class="title-in" data-key="${esc(key)}" value="${esc(get(key))}" placeholder="학번" maxlength="5" inputmode="numeric" aria-label="친구 학번">${esc(z)}`;
    }
    out += `<section class="sec rep${b.pick ? " pick" : ""}"><h3>${b.pick ? `<span>${h3}</span>` : h3}</h3>${itemsHtml(fill(b.items, i), { plain: b.plain })}</section>`;
  }
  return `<div class="reps c${b.cols || 1}">${out}</div>`;
}
function guideHtml(b) {
  const many = b.steps.length > 1;
  return `<section class="sec frame guide no-print"><h3>${esc(b.title)}</h3>
    <ol class="steps c${b.cols || 1}">${b.steps.map((s, i) => `<li${s.wide ? ' class="wide"' : ""}>
      <p class="cap">${many ? `<span class="cap-no">${i + 1}</span>` : ""}${esc(s.text)}</p>
      ${s.img ? `<figure class="fig no-print"><img alt="${esc(s.name || s.text)}" data-img="${esc(s.img)}" title="누르면 크게 보여요"><figcaption>${esc(s.name || s.text)} 이미지 추가하세요</figcaption></figure>` : ""}</li>`).join("")}
    </ol>${b.note ? `<p class="guide-note">${esc(b.note)}</p>` : ""}${b.tip ? `<div class="tip"><p class="tip-title">💡 ${esc(b.tip.title)}</p><ol>${b.tip.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol></div>` : ""}</section>`;
}
function blockHtml(b, les) {
  switch (b.type) {
    case "meta":
      return `<div class="meta-row">
        <label>공동작가 필명 <input type="text" data-key="meta.team" value="${esc(get("meta.team"))}" placeholder="예: 별빛탐험대" maxlength="30"></label>
        <label>학번 <input type="text" data-key="meta.name" value="${esc(get("meta.name"))}" placeholder="예: 20415" maxlength="5" inputmode="numeric"${me ? ' readonly title="로그인한 학번이에요"' : ""}></label>
        <label>날짜 <input type="text" data-key="n${les.n}.date" value="${esc(get(`n${les.n}.date`))}" placeholder="월 / 일" maxlength="20"></label>
      </div>`;
    case "part":
      return `<p class="part${b.group && gid ? " shared" : ""}"><span>${esc(b.label)}</span></p>${b.group && gid ? `<p class="shared-note no-print">이 아래 칸은 <b>${me.team}모둠</b> 친구들과 함께 써요. 한 명이 적으면 모두의 활동지에 보여요.</p>` : ""}`;
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
      return `<p class="sheet-note no-print">${esc(b.text)}</p>`;
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
        if (it.journey) entries.push({ key: it.key, label: typeof it.journey === "string" ? it.journey : it.label, value: shown(it), long: !!it.copy, group: isGroup(it.key) });
      });
      if (!entries.length) return;
      const name = block.nameKey ? String(get(fill(block.nameKey, i))).trim() || "학번" : "";
      groups.push({ title: title.replace("{name}", name), entries, rep: block.type === "repeat" ? block : null, cols: block.cols || 1, group: entries.some((e) => e.group) });
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
  return `<div class="jn-group${g.rep ? " jn-card" : ""}"><h4>${esc(g.title)}${g.group ? ` <span class="jn-team">우리 모둠</span>` : ""}</h4><dl>${g.entries.map((e) => `
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
  const cur = lesson(), pct = $("sheetPct");
  if (cur && !cur.field && pct) pct.textContent = progressOf(cur) + "%";
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
    // 인쇄할 쪽 나누기: printBreak 가 붙은 묶음부터 새 쪽. 화면에서는 그냥 차례로 이어진다
    const pages = [[]];
    (les.blocks || []).forEach((b) => { if (b.printBreak && pages[pages.length - 1].length) pages.push([]); pages[pages.length - 1].push(b); });
    $("sheet").innerHTML = `
      <div class="print-page">
      <header class="sheet-head">
        <div class="sheet-top"><span class="les-badge">&lt;${les.n}차시&gt;</span><span class="sheet-kicker">${SITE_NAME}</span>${les.field ? "" : `<span class="sheet-pct no-print" id="sheetPct">${progressOf(les)}%</span>`}</div>
        <h2 class="ribbon"><span>[STEP. ${les.n} ${esc(les.step)}] ${esc(les.title)}</span></h2>
        ${les.goal ? `<p class="sheet-goal">${esc(les.goal)}</p>` : ""}
      </header>
      ${pages.map((blocks, i) => `${i ? `</div><div class="print-page">` : ""}<div class="sheet-body">${blocks.map((b) => blockHtml(b, les)).join("")}</div>`).join("")}
      </div>
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
// 모둠 칸은 모둠원 모두의 것이므로 지우지 않는다 (내 개인 칸만 지운다)
function clearLesson() {
  const les = lesson();
  const keys = storedKeys(les);
  const kept = keys.some((k) => isGroup(k));
  keys.forEach((k) => { if (!isGroup(k)) delete doc.answers[k]; });
  doc.updatedAt = new Date().toISOString();
  persist(doc);
  renderSheet(); refreshProgress();
  showState(`${les.n}차시 입력을 지웠어요${kept ? " (모둠 칸은 그대로 두었어요)" : ""}`);
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
      <p>어느 반 활동지인지 알 수 있게 선생님이 알려 준 코드를 넣어 주세요.</p>
      ${codeEntryHtml({ value: lastCode(), page: "worksheet" })}</div>`;
    bindCodeEntry(DEMO);
    return;
  }
  doc = load();
  rememberCode(code);
  $("codeText").textContent = code; $("codeChip").hidden = false;
  $("sub").textContent = "활동지를 여는 중…";
  let offline = false;
  try {
    shelf = (await Promise.race([loadShelf(code), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000))])).shelf;
  } catch (e) { shelf = null; offline = true; }
  // 책장을 못 찾으면(또는 인터넷이 없으면) 예전처럼 이 기기에만 저장한다
  if (!shelf) return openSheet(offline ? "인터넷 연결이 없어 이 기기에만 저장돼요. 연결되면 새로고침해서 내 활동지를 여세요." : "");
  const saved = readLogin();
  if (!saved) return showLogin();
  try {
    const s = await getStudent(shelf, saved.key);
    if (!s) { forgetLogin(); return showLogin("이 기기에 기억해 둔 활동지가 바뀌었어요. 선생님이 비밀번호를 0000으로 바꿔 주었다면 0000으로 들어와요."); }
    enter(s);
  } catch (e) {
    // 인터넷이 잠시 없으면 이 기기에 기억해 둔 정보로 연다 (모둠 칸은 연결되면 맞춰진다)
    enter({ ...saved.profile, id: saved.key, reset: false });
  }
})();

/* 이 기기의 로그인 기억 */
function readLogin() { try { const o = JSON.parse(localStorage.getItem(LOGIN_KEY) || "null"); return o && o.key ? o : null; } catch (e) { return null; } }
function saveLogin() {
  const { id, sid, grade, classNo, num, team } = me;
  try { localStorage.setItem(LOGIN_KEY, JSON.stringify({ key: id, profile: { sid, grade, classNo, num, team } })); } catch (e) { /* 무시 */ }
}
function forgetLogin() { try { localStorage.removeItem(LOGIN_KEY); } catch (e) { /* 무시 */ } }

// 로그인한 학생으로 들어간다: 이 기기의 기록과 서버 백업을 합치고, 비밀번호·모둠을 확인한 뒤 활동지를 연다
function enter(s) {
  const { name, ...rest } = s;
  me = rest;
  // 예전에 받은 이름이 서버에 남아 있으면 지운다 (이름은 더 쓰지 않는다)
  if (name != null && shelf && !s.reset) dropName(shelf, s.id).catch((e) => console.warn("이름을 지우지 못했습니다:", e.code || e.message));
  if (doc.sid && doc.sid !== me.sid) {
    // 이 기기에 다른 학생의 기록이 있으면 따로 보관해 두고 새로 시작한다
    try { localStorage.setItem(`${KEY}-${doc.sid}`, JSON.stringify(doc)); } catch (e) { /* 무시 */ }
    doc = { v: 1, code, meta: {}, answers: {}, updatedAt: null };
  }
  doc.sid = me.sid;
  Object.entries(me.answers || {}).forEach(([k, v]) => { if (String(rawGet(k)).trim() === "") rawSet(k, v); });
  try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch (e) { /* 무시 */ }
  saveLogin();
  if (me.reset) return showPin(true);
  if (!me.team) return showTeam();
  openSheet();
}
function whoText() { return me ? `${me.grade}학년 ${me.classNo}반 ${me.num}번` : ""; }
function card(html) {
  stopMe(); stopMe = () => {};
  stopGroup(); stopGroup = () => {}; stopPosts(); stopPosts = () => {}; gid = ""; posts = [];
  $("wsMain").hidden = true; $("wsBar").hidden = true;
  $("notice").innerHTML = `<div class="notice ws-card">${html}</div>`;
  const f = $("notice").querySelector("input");
  if (f && !matchMedia("(pointer: coarse)").matches) f.focus();
}
const fail = (id, text) => { const e = $(id); e.textContent = text; e.hidden = false; };
const busy = (btn, on, text) => { btn.disabled = on; if (text) btn.textContent = text; };
const pinOk = (p) => /^\d{4}$/.test(p);

function showLogin(msg = "") {
  $("sub").textContent = `${shelf.school} · 학번과 비밀번호로 내 활동지를 열어요`;
  card(`<h2>내 활동지 열기</h2>
    <p>학번 5자리와 비밀번호 4자리를 넣어요. <b>처음이면 지금 정한 비밀번호를 꼭 기억해 두세요.</b></p>
    <form class="ws-form" id="loginForm" novalidate>
      <label>학번 <input id="sidIn" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="예: 20415"></label>
      <span class="sid-hint" id="sidHint"></span>
      <label>비밀번호 4자리 <input id="pinIn" type="password" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="●●●●"></label>
      <p class="ws-new" id="newRow" hidden>처음 왔네요! 이 학번과 비밀번호로 새 활동지를 시작해요. 비밀번호를 꼭 기억해 두세요.</p>
      <button class="btn primary" id="loginBtn" type="submit">열기</button>
      <p class="err" id="loginErr" role="alert"${msg ? "" : " hidden"}>${esc(msg)}</p>
    </form>
    <p class="links"><a href="#" id="localOnly">로그인하지 않고 이 기기에만 쓰기</a> <small>(모둠 칸이 친구들과 공유되지 않아요)</small></p>`);
  const sidIn = $("sidIn"), pinIn = $("pinIn"), btn = $("loginBtn");
  let isNew = false;
  sidIn.addEventListener("input", () => {
    sidIn.value = sidIn.value.replace(/\D/g, "");
    const p = parseSid(sidIn.value);
    $("sidHint").textContent = p ? `${p.grade}학년 ${p.classNo}반 ${p.num}번` : "";
    if (isNew) { isNew = false; $("newRow").hidden = true; btn.textContent = "열기"; }
  });
  pinIn.addEventListener("input", () => { pinIn.value = pinIn.value.replace(/\D/g, ""); });
  $("localOnly").addEventListener("click", (e) => { e.preventDefault(); shelf = null; openSheet("로그인하지 않아 이 기기에만 저장되고, 모둠 칸이 친구들과 공유되지 않아요."); });
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("loginErr").hidden = true;
    const p = parseSid(sidIn.value), pin = pinIn.value;
    if (!p) return fail("loginErr", "학번 5자리를 넣어 주세요. 예) 2학년 4반 15번 → 20415");
    if (!pinOk(pin)) return fail("loginErr", "비밀번호는 숫자 4자리예요.");
    busy(btn, true);
    try {
      if (isNew) {
        // 이 기기에 이미 적어 둔 개인 칸이 있으면(다른 학생 것이 아니면) 그대로 가져간다
        const mine = !doc.sid || doc.sid === p.sid;
        const answers = {};
        if (mine) Object.entries(doc.answers).forEach(([k, v]) => { if (!GROUP_KEYS.has(k) && String(v ?? "") !== "") answers[k] = String(v); });
        return enter(await createStudent(shelf, { sid: p.sid, pin, answers }));
      }
      const r = await findStudent(shelf, p.sid, pin);
      if (r.status === "ok") return enter(r.student);
      busy(btn, false);
      if (r.status === "wrong") return fail("loginErr", pin === RESET_PIN
        ? "비밀번호가 맞지 않아요. 선생님이 아직 0000으로 바꿔 주지 않았을 수 있어요."
        : "비밀번호가 맞지 않아요. 잊었으면 선생님께 “비밀번호를 0000으로 바꿔 주세요”라고 말해요.");
      if (pin === RESET_PIN) return fail("loginErr", "0000은 쓸 수 없어요. 다른 숫자 4자리를 정해 주세요.");
      isNew = true; $("newRow").hidden = false; btn.textContent = "시작하기"; btn.focus();
    } catch (err) {
      busy(btn, false);
      fail("loginErr", err.code === "exists" ? "방금 다른 기기에서 같은 학번으로 시작했어요. 비밀번호를 확인하고 다시 눌러 주세요."
        : "연결이 잠시 끊겼어요. 인터넷을 확인하고 다시 눌러 주세요.");
      console.warn(err);
    }
  });
}

function showTeam(msg = "") {
  const cur = me.team;
  card(`<h2>모둠 번호 고르기</h2>
    <p>${esc(whoText())} · 선생님이 정해 준 <b>모둠 번호</b>를 골라요. 같은 반에서 같은 번호를 고른 친구들과 <b>2차시 모둠별 칸</b>을 함께 써요.</p>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
    <div class="team-pick" role="group" aria-label="모둠 번호">${Array.from({ length: MAX_TEAM }, (_, i) => `<button type="button" class="btn${cur === i + 1 ? " primary" : ""}" data-team="${i + 1}">${i + 1}모둠</button>`).join("")}</div>
    <p class="err" id="teamErr" role="alert" hidden></p>
    ${cur ? `<p class="links"><a href="#" id="teamBack">바꾸지 않고 돌아가기</a></p>` : ""}`);
  if (cur) $("teamBack").addEventListener("click", (e) => { e.preventDefault(); openSheet(); });
  $("notice").querySelector(".team-pick").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-team]");
    if (!b) return;
    const team = +b.dataset.team;
    $("notice").querySelectorAll("[data-team]").forEach((x) => (x.disabled = true));
    try {
      await updateStudent(shelf, me.id, { team });
      me.team = team; saveLogin(); openSheet();
    } catch (err) {
      $("notice").querySelectorAll("[data-team]").forEach((x) => (x.disabled = false));
      fail("teamErr", "저장하지 못했어요. 인터넷을 확인하고 다시 눌러 주세요.");
      console.warn(err);
    }
  });
}

function showPin(forced) {
  card(`<h2>${forced ? "새 비밀번호 정하기" : "비밀번호 바꾸기"}</h2>
    <p>${esc(whoText())} · ${forced ? "선생님이 비밀번호를 0000으로 바꿔 주었어요. " : ""}새로 쓸 숫자 4자리를 정해요. 꼭 기억해 두세요.</p>
    <form class="ws-form" id="pinForm" novalidate>
      <label>새 비밀번호 <input id="pin1" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="●●●●"></label>
      <label>한 번 더 <input id="pin2" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="●●●●"></label>
      <button class="btn primary" id="pinBtn" type="submit">정하기</button>
      <p class="err" id="pinErr" role="alert" hidden></p>
    </form>
    ${forced ? "" : `<p class="links"><a href="#" id="pinBack">바꾸지 않고 돌아가기</a></p>`}`);
  if (!forced) $("pinBack").addEventListener("click", (e) => { e.preventDefault(); openSheet(); });
  ["pin1", "pin2"].forEach((id) => $(id).addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, ""); }));
  $("pinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = $("pin1").value, b = $("pin2").value;
    if (!pinOk(a)) return fail("pinErr", "숫자 4자리를 넣어 주세요.");
    if (a === RESET_PIN) return fail("pinErr", "0000은 쓸 수 없어요. 다른 숫자를 정해 주세요.");
    if (a !== b) return fail("pinErr", "두 칸의 숫자가 달라요. 다시 넣어 주세요.");
    busy($("pinBtn"), true);
    try {
      await backup();
      me.id = await changePin(shelf, me, a);
      me.reset = false; saveLogin();
      if (!me.team) showTeam(); else openSheet();
    } catch (err) {
      busy($("pinBtn"), false);
      fail("pinErr", "바꾸지 못했어요. 인터넷을 확인하고 다시 눌러 주세요.");
      console.warn(err);
    }
  });
}

async function logout() {
  flush();
  clearTimeout(backupTimer);
  const ok = await backup();
  stopMe(); stopGroup(); stopPosts(); posts = [];
  forgetLogin();
  // 서버에 백업했으므로 이 기기의 개인 기록은 지운다 (다음 학생에게 보이지 않게). 백업이 안 됐으면 따로 보관한다
  try {
    if (!ok) localStorage.setItem(`${KEY}-${doc.sid}`, JSON.stringify(doc));
    localStorage.removeItem(KEY);
  } catch (e) { /* 무시 */ }
  doc = load(); me = null; gid = "";
  showLogin();
}

// 활동지를 연다. note 가 있으면 이 기기에만 저장하는 상태를 알린다
let wired = false;
function openSheet(note = "") {
  if (me && shelf) {
    $("sub").textContent = `${shelf.school} · 입력하면 자동 저장돼요 · 다 쓰면 이미지로 저장하거나 인쇄해요`;
    $("notice").innerHTML = `<div class="who-bar no-print"><span><b>${esc(whoText())}</b> · <b>${me.team}모둠</b></span>
      <span class="grow"></span>
      <button type="button" class="btn small" id="chTeam">모둠 바꾸기</button>
      <button type="button" class="btn small" id="chPin">비밀번호 바꾸기</button>
      <button type="button" class="btn small" id="logout">다른 학생으로 열기</button></div>`;
    $("chTeam").addEventListener("click", () => { flush(); showTeam(); });
    $("chPin").addEventListener("click", () => { flush(); showPin(false); });
    $("logout").addEventListener("click", logout);
    joinGroup();
    // 선생님이 모둠에서 빼거나 비밀번호를 0000으로 되돌리면 바로 알아챈다
    stopMe();
    stopMe = watchStudent(shelf, me.id, (x) => {
      if (!me) return;
      if (!x) { stopMe(); stopGroup(); stopPosts(); forgetLogin(); me = null; gid = ""; showLogin("선생님이 비밀번호를 0000으로 바꿨어요. 0000으로 들어와 새 비밀번호를 정해요."); return; }
      if (x.team !== me.team) {
        me.team = x.team; saveLogin();
        if (!x.team) { flush(); showTeam("선생님이 모둠에서 뺐어요. 내 모둠 번호를 다시 골라요."); }
        else openSheet();
      }
    }, () => {});
  } else {
    $("sub").textContent = shelf ? `${shelf.school} · 입력하면 이 기기에 자동 저장돼요` : "입력하면 이 기기에 자동 저장돼요 · 다 쓰면 이미지로 저장하거나 인쇄해요";
    $("notice").innerHTML = note ? `<div class="who-bar no-print"><span>${esc(note)}</span></div>` : "";
  }
  $("wsMain").hidden = false; $("wsBar").hidden = false;
  renderJourney(); renderSheet(); showState();
  if (wired) return;
  wired = true;
  $("sheet").addEventListener("input", onInput);
  $("sheet").addEventListener("input", (e) => { if (e.target.matches("textarea.chat-edit") && chatEdit) chatEdit.text = e.target.value; });
  // 올리기 칸에서 Ctrl+Enter 로도 올린다
  $("sheet").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || !e.target.matches("textarea.chat-in")) return;
    e.preventDefault();
    const b = e.target.closest(".chat").querySelector('[data-chat="post"]');
    if (b && !b.disabled) onChat(b);
  });
  $("sheet").addEventListener("change", onInput);
  $("sheet").addEventListener("click", (e) => {
    const ch = e.target.closest("button[data-chat]"); if (ch) return onChat(ch);
    const c = e.target.closest("button[data-copy]");
    if (c) return copyText(String(get(c.dataset.copy)), c, document.querySelector(`textarea[data-key="${CSS.escape(c.dataset.copy)}"]`));
    if (e.target.closest("#jnCopy")) return copyText(journeyText(), e.target.closest("#jnCopy"));
    const g = e.target.closest("a[data-go]"); if (g) { e.preventDefault(); return go(g.dataset.go); }
    const fig = e.target.closest(".fig.has-img img"); if (fig) return window.open(fig.src, "_blank", "noopener");   // 안내 그림은 누르면 새 창에서 크게
    const a = e.target.closest("a[data-prefill]"); if (a) { flush(); try { prefillSubmit(JSON.parse(a.dataset.prefill)); } catch (e2) { /* 무시 */ } }
  });
  // 내가 쓰던 칸에서 벗어나면, 그사이 다른 모둠원이 바꾼 값을 반영한다
  $("sheet").addEventListener("focusout", (e) => {
    const el = e.target.closest("[data-key]");
    if (el && isGroup(el.dataset.key)) setTimeout(() => { if (groupPending[el.dataset.key] == null) applyRemote(el.dataset.key); }, 0);
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
  // 창을 닫거나 다른 앱으로 갈 때 기다리던 저장을 끝낸다
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { flush(); if (backupTimer) { clearTimeout(backupTimer); backup(); } } });
}
