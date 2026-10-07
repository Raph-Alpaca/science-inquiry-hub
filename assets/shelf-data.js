/* 산출물 책장 — 데이터 계층 (Firebase 하나만 씁니다)
 *
 * 설정(assets/firebase-config.js)이 비어 있거나 주소에 ?demo=1 이 붙으면
 * "미리보기(데모)" 모드로 동작합니다. 데모 모드는 이 브라우저에만 저장됩니다.
 *
 * 공개 화면에서는 모둠원 학번(shelves/{id}/private)을 절대 읽지 않습니다.
 */
import { firebaseConfig, FEATURES } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.14.1";
const params = new URLSearchParams(location.search);

export const CONFIGURED = !!(firebaseConfig.apiKey && firebaseConfig.projectId);
export const CAN_UPLOAD = !!(FEATURES && FEATURES.coverUpload);
export const DEMO = params.get("demo") === "1" || !CONFIGURED;
// 검사용: 주소가 로컬(127.0.0.1·localhost)이고 ?emu=1 이 붙으면 Firebase 에뮬레이터에 붙는다.
const EMU = params.get("emu") === "1" && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);

export const COVERS = [
  { id: "heat", label: "열" }, { id: "state", label: "상태 변화" }, { id: "wave", label: "빛과 파동" },
  { id: "gas", label: "기체" }, { id: "plant", label: "식물" }, { id: "space", label: "태양계" },
  { id: "energy", label: "운동·에너지" }, { id: "weather", label: "날씨" }, { id: "reaction", label: "화학 반응" },
  { id: "life", label: "생물" }, { id: "electric", label: "전기·자기" }, { id: "earth", label: "지구" },
];
// 저장하는 값은 예전과 같은 6가지 코드이고, 화면에는 책다운 차분한 색(tone)으로 바꿔 그린다.
export const COVER_COLORS = ["#23A087", "#2C7FD1", "#EE6B57", "#8A5CD6", "#E29A2A", "#2E9E6B"];
const TONES = {
  "#23A087": { tone: "#2B8A7B", name: "청록" },
  "#2C7FD1": { tone: "#35649C", name: "남색" },
  "#EE6B57": { tone: "#C65A46", name: "주홍" },
  "#8A5CD6": { tone: "#72569E", name: "보라" },
  "#E29A2A": { tone: "#C68A30", name: "황토" },
  "#2E9E6B": { tone: "#5B8446", name: "풀색" },
};
const toneOf = (c) => TONES[String(c || "").toUpperCase()];
export const coverTone = (c) => (toneOf(c) ? toneOf(c).tone : /^#[0-9a-f]{3,8}$/i.test(c || "") ? c : TONES["#23A087"].tone);
export const coverColorName = (c) => (toneOf(c) ? toneOf(c).name : "색");
// 표지 그림은 검정 바탕에 흰 선으로 그린 흑백 그림이다. 화면에서 screen 합성으로 표지색 위에 입힌다
export const coverSrc = (kind) => `assets/covers/${COVERS.some((c) => c.id === kind) ? kind : "heat"}.jpg`;

/* ---------- 책장 코드 ---------- */
const CHO = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const JUNG = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
// 학교 이름 앞부분을 영문으로 옮겨 3글자 약칭을 만든다. (서울○○중학교 → SEO)
export function schoolAbbr(school) {
  let out = "";
  for (const ch of String(school || "")) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c >= 0 && c <= 11171) out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)];
    else if (/[A-Za-z]/.test(ch)) out += ch;
    if (out.length >= 3) break;
  }
  return (out.toUpperCase().replace(/[^A-Z]/g, "") || "SCH").slice(0, 3).padEnd(3, "X");
}
const RAND = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 헷갈리는 0·O·1·I·L 제외
const rand4 = () => Array.from({ length: 4 }, () => RAND[Math.floor(Math.random() * RAND.length)]).join("");
export const makeCode = (school) => `${schoolAbbr(school)}-${new Date().getFullYear()}-${rand4()}`;

/* ---------- Firebase 지연 로딩 ---------- */
let _fb = null;
async function fb() {
  if (_fb) return _fb;
  const [A, F, U] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-firestore.js`),
    import(`${SDK}/firebase-auth.js`),
  ]);
  const app = A.initializeApp(EMU ? { ...firebaseConfig, projectId: "demo-sih" } : firebaseConfig);
  // 일부 휴대폰 망·브라우저는 Firestore 의 스트리밍 연결을 막아 응답이 영영 오지 않는다. long polling 으로 붙는다.
  _fb = { F, U, db: F.initializeFirestore(app, { experimentalForceLongPolling: true }), auth: U.getAuth(app), app };
  if (EMU) {
    // 검사용: 로컬 에뮬레이터에 붙는다 (tests/ 의 검사 스크립트가 쓴다). 실제 데이터에는 손대지 않는다.
    F.connectFirestoreEmulator(_fb.db, "127.0.0.1", 8080);
    U.connectAuthEmulator(_fb.auth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  // Storage 는 표지 업로드를 켠 경우에만 불러온다 (안 쓰면 45 KB를 내려받지 않는다)
  if (CAN_UPLOAD) {
    const S = await import(`${SDK}/firebase-storage.js`);
    _fb.S = S;
    _fb.storage = S.getStorage(app);
  }
  return _fb;
}

/* ---------- 데모 저장소 ---------- */
const DEMO_KEY = "sih-demo-shelf-v1";
function demoSeed() {
  const now = Date.now();
  const mk = (i, o) => Object.assign({
    id: "d" + i, grade: 2, classNo: 3, team: `${i}모둠`, url: "https://example.com/demo",
    intent: "", howto: "", concepts: [], coverKind: "heat", coverColor: COVER_COLORS[0],
    coverPath: "", status: "approved", example: false, createdAt: now + i * 1000,
  }, o);
  return {
    shelves: [{
      id: "demo", code: "DEMO-2026-BOOK", school: "서울○○중학교", teacherName: "김선생",
      title: "2학년 책장", teacherUid: "demo-uid", createdAt: now, classes: ["2-3", "2-4"],
    }],
    books: {
      demo: [
        mk(1, {
          title: "산불 확산 시뮬레이션", team: "1모둠", coverKind: "weather", coverColor: "#EE6B57",
          intent: "바람의 세기와 방향에 따라 산불이 어떻게 번지는지 눈으로 확인하고 싶었습니다. 뉴스에서 본 강원도 산불이 계기였어요.",
          howto: "바람 방향 화살표를 돌리고 세기 슬라이더를 조절한 뒤 \"불 붙이기\"를 누르세요. 나무 밀도를 바꾸면 번지는 속도가 달라집니다.",
          concepts: ["연소의 조건", "열의 이동", "대류", "바람"],
        }),
        mk(2, {
          title: "달 위상 계산기", team: "2모둠", coverKind: "space", coverColor: "#2C7FD1",
          intent: "날짜를 넣으면 그날 달 모양을 알려 주는 것을 만들고 싶었습니다.",
          howto: "날짜를 고르면 달 모양과 뜨는 시각을 보여 줍니다.", concepts: ["달의 위상", "공전"],
        }),
        mk(3, {
          title: "물의 순환 이야기", team: "3모둠", coverKind: "plant", coverColor: "#2E9E6B",
          intent: "물이 어디로 가는지 그림으로 보여 주고 싶었어요.",
          howto: "화면을 눌러 증발·응결·강수를 차례로 봅니다.", concepts: ["증발", "응결", "강수"],
        }),
        mk(4, {
          title: "소리 높낮이 실험", team: "4모둠", coverKind: "wave", coverColor: "#8A5CD6",
          intent: "진동수를 바꾸면 소리가 어떻게 달라지는지 직접 들어 보게 만들었습니다.",
          howto: "슬라이더를 움직이고 소리 듣기를 누르세요.", concepts: ["진동수", "진폭"],
        }),
        mk(5, {
          title: "우리 학교 기온 기록", team: "1모둠", classNo: 4, status: "pending",
          coverKind: "heat", coverColor: "#E29A2A",
          intent: "한 달 동안 잰 기온을 그래프로 그렸습니다.", howto: "날짜를 누르면 그날 기온이 나옵니다.",
          concepts: ["기온", "일교차"],
        }),
      ],
    },
    priv: { d1: "20301, 20302, 20303", d2: "20304, 20305", d3: "20306, 20307", d4: "20308, 20309", d5: "20401, 20402" },
  };
}
function demoRead() {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* 저장소를 못 쓰는 환경 */ }
  return demoSeed();
}
function demoWrite(d) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch (e) { /* 무시 */ }
}
export function demoReset() {
  try { localStorage.removeItem(DEMO_KEY); } catch (e) { /* 무시 */ }
}

/* ---------- 공개 화면 ---------- */
// 예전에는 5분짜리 세션 캐시를 써서, 선생님이 승인한 책이 새로고침해도 한동안 안 보였다.
// 이제 캐시 없이 읽고, 책장 화면은 watchShelf 로 실시간 구독한다.
export async function loadShelf(code) {
  if (DEMO) return demoShelf(code);
  const { F, db } = await fb();
  const snap = await F.getDocs(F.query(F.collection(db, "shelves"), F.where("code", "==", code.toUpperCase()), F.limit(1)));
  if (snap.empty) return { shelf: null, books: [] };
  const shelf = docOf(snap.docs[0]);
  const bs = await F.getDocs(F.query(F.collection(db, "shelves", shelf.id, "books"), F.where("status", "==", "approved")));
  return { shelf, books: sortBooks(bs.docs.map(docOf)) };
}
function demoShelf(code) {
  const d = demoRead();
  const shelf = d.shelves.find((s) => s.code.toUpperCase() === code.toUpperCase());
  return shelf
    ? { shelf, books: (d.books[shelf.id] || []).filter((b) => b.status === "approved").sort((a, b) => a.createdAt - b.createdAt) }
    : { shelf: null, books: [] };
}
// 예전 캐시가 남아 있으면 지운다 (지금은 캐시를 쓰지 않는다)
export function clearShelfCache(code) {
  try { sessionStorage.removeItem("sih-shelf-" + code); } catch (e) { /* 무시 */ }
}

const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : 0);
const plain = (o) => ({ ...o, createdAt: ms(o.createdAt) });
// 방금 쓴 문서는 서버 시각이 아직 없으므로 추정값을 쓴다
const docOf = (d) => plain({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) });
const sortBooks = (list) => list.sort((a, b) => a.createdAt - b.createdAt);

/* ---------- 실시간 반영 ----------
 * 실제 모드: Firestore onSnapshot 으로 바로 반영한다. 학교망에서 실시간 연결이 막히거나
 *   처음 응답이 오지 않으면 POLL_MS 마다 다시 읽어서, 조금 늦더라도 새로고침 없이 반영되게 한다.
 * 데모 모드: 다른 탭의 변경(storage 이벤트)과 같은 탭의 변경을 짧은 간격으로 확인한다.
 * 돌려준 함수를 부르면 구독을 끊는다. */
const POLL_MS = 20 * 1000;
const FIRST_WAIT_MS = 8 * 1000;
const isDenied = (e) => e && (e.code === "permission-denied" || /insufficient permissions/i.test(e.message || ""));

function demoWatch(read, cb) {
  let last = "";
  const tick = () => {
    const v = read();
    const key = JSON.stringify(v);
    if (key !== last) { last = key; cb(v); }
  };
  tick();
  const t = setInterval(tick, 1500);
  const onStorage = (e) => { if (!e.key || e.key === DEMO_KEY) tick(); };
  addEventListener("storage", onStorage);
  return () => { clearInterval(t); removeEventListener("storage", onStorage); };
}

function liveOrPoll({ listen, fetchOnce, cb, onError }) {
  let stopped = false, got = false, unsub = null, poll = null, lastKey = "";
  const emit = (v) => {
    if (stopped) return;
    const key = JSON.stringify(v);
    if (key === lastKey) return;          // 바뀐 게 없으면 다시 그리지 않는다
    lastKey = key; cb(v);
  };
  const fail = (e) => { if (isDenied(e) && onError) onError(e); };
  const startPolling = () => {
    if (poll || stopped) return;
    const run = () => fetchOnce().then(emit).catch(fail);
    run();
    poll = setInterval(run, POLL_MS);
  };
  const guard = setTimeout(() => { if (!got) startPolling(); }, FIRST_WAIT_MS);
  // 탭으로 돌아오면 한 번 더 확인한다 (잠자기에서 깨어난 크롬북 대비)
  const onVisible = () => { if (document.visibilityState === "visible") fetchOnce().then(emit).catch(fail); };
  document.addEventListener("visibilitychange", onVisible);
  try {
    unsub = listen((v) => {
      got = true;
      if (poll) { clearInterval(poll); poll = null; }
      emit(v);
    }, (e) => {
      if (isDenied(e)) { fail(e); return; }
      console.warn("실시간 연결이 끊겨 주기적으로 다시 읽습니다:", e.code || e.message);
      startPolling();
    });
  } catch (e) { startPolling(); }
  return () => {
    stopped = true;
    clearTimeout(guard);
    if (poll) clearInterval(poll);
    document.removeEventListener("visibilitychange", onVisible);
    if (typeof unsub === "function") unsub();
  };
}

/* 공개 책장: 책장 정보와 승인된 책을 함께 구독한다. cb({ shelf, books }) */
export function watchShelf(code, cb, onError) {
  const CODE = code.toUpperCase();
  if (DEMO) return demoWatch(() => demoShelf(CODE), cb);
  let stop = () => {}, cancelled = false;
  fb().then(({ F, db }) => {
    if (cancelled) return;
    stop = liveOrPoll({
      cb, onError,
      fetchOnce: () => loadShelf(CODE),
      listen: (next, fail) => {
        let shelfId = null, shelf = null, books = null, unBooks = null;
        const push = () => { if (!shelf) next({ shelf: null, books: [] }); else if (books) next({ shelf, books }); };
        const unShelf = F.onSnapshot(
          F.query(F.collection(db, "shelves"), F.where("code", "==", CODE), F.limit(1)),
          (snap) => {
            if (snap.empty) {
              if (unBooks) { unBooks(); unBooks = null; }
              shelfId = null; shelf = null; books = null;
              push();
              return;
            }
            const d = snap.docs[0];
            shelf = docOf(d);
            if (d.id !== shelfId) {
              if (unBooks) unBooks();
              shelfId = d.id; books = null;
              unBooks = F.onSnapshot(
                F.query(F.collection(db, "shelves", d.id, "books"), F.where("status", "==", "approved")),
                (bs) => { books = sortBooks(bs.docs.map(docOf)); push(); },
                fail,
              );
            }
            push();
          },
          fail,
        );
        return () => { unShelf(); if (unBooks) unBooks(); };
      },
    });
  }).catch((e) => { if (onError) onError(e); });
  return () => { cancelled = true; stop(); };
}

/* 선생님 화면: 한 책장의 모든 책과 모둠원 학번을 구독한다. cb({ books, members }) */
export function watchShelfBooks(shelfId, cb, onError) {
  if (DEMO) {
    return demoWatch(() => {
      const d = demoRead();
      const books = (d.books[shelfId] || []).slice().sort((a, b) => a.createdAt - b.createdAt);
      const members = {};
      books.forEach((b) => (members[b.id] = d.priv[b.id] || ""));
      return { books, members };
    }, cb);
  }
  let stop = () => {}, cancelled = false;
  fb().then(({ F, db }) => {
    if (cancelled) return;
    stop = liveOrPoll({
      cb, onError,
      fetchOnce: async () => {
        const books = await listBooks(shelfId);
        return { books, members: await loadMembers(shelfId, books.map((b) => b.id)) };
      },
      listen: (next, fail) => {
        let books = null, members = null;
        const push = () => {
          if (!books || !members) return;
          const m = {};
          books.forEach((b) => (m[b.id] = members[b.id] || ""));
          next({ books, members: m });
        };
        const unB = F.onSnapshot(F.collection(db, "shelves", shelfId, "books"),
          (snap) => { books = sortBooks(snap.docs.map(docOf)); push(); }, fail);
        // 모둠원 학번은 책보다 한 박자 늦게 저장되므로 따로 구독해서 뒤따라 채운다
        const unP = F.onSnapshot(F.collection(db, "shelves", shelfId, "private"),
          (snap) => { members = {}; snap.docs.forEach((d) => (members[d.id] = d.data().memberNames || "")); push(); }, fail);
        return () => { unB(); unP(); };
      },
    });
  }).catch((e) => { if (onError) onError(e); });
  return () => { cancelled = true; stop(); };
}

export async function loadTeacherExamples() {
  const res = await fetch("shelf/teacher.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("선생님 예시를 불러오지 못했습니다");
  return res.json();
}

/* ---------- 학생 제출 ---------- */
export async function submitBook(shelf, data, coverFile) {
  const book = {
    grade: data.grade, classNo: data.classNo, team: data.team, title: data.title, url: data.url,
    intent: data.intent, howto: data.howto, concepts: data.concepts,
    coverKind: data.coverKind, coverColor: data.coverColor, coverPath: "",
    status: "pending", example: false, code: shelf.code,
  };
  if (!CAN_UPLOAD) coverFile = null;              // Storage 를 쓰지 않는 동안은 캡처 업로드를 건너뛴다
  if (DEMO) {
    const d = demoRead();
    const id = "u" + Date.now();
    if (coverFile) book.coverPath = await fileToDataUrl(coverFile);
    (d.books[shelf.id] = d.books[shelf.id] || []).push({ id, ...book, createdAt: Date.now() });
    d.priv[id] = data.memberNames;
    demoWrite(d);
    return id;
  }
  const { F, S, db, storage } = await fb();
  if (coverFile) {
    const ext = (coverFile.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const path = `covers/${shelf.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const snap = await S.uploadBytes(S.ref(storage, path), coverFile, { contentType: coverFile.type });
    book.coverPath = await S.getDownloadURL(snap.ref);
  }
  const ref = await F.addDoc(F.collection(db, "shelves", shelf.id, "books"), { ...book, createdAt: F.serverTimestamp() });
  await F.setDoc(F.doc(db, "shelves", shelf.id, "private", ref.id), {
    memberNames: data.memberNames, code: shelf.code, createdAt: F.serverTimestamp(),
  });
  return ref.id;
}
function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("이미지를 읽지 못했습니다"));
    r.readAsDataURL(file);
  });
}

/* ---------- 선생님 화면 ---------- */
export async function onUser(cb) {
  if (DEMO) { cb({ uid: "demo-uid", displayName: "김선생", email: "demo@example.com", demo: true }); return () => {}; }
  const { U, auth } = await fb();
  // 팝업이 막혀 같은 탭으로 로그인한 경우 돌아온 결과를 먼저 받는다
  try { await U.getRedirectResult(auth); } catch (e) { console.warn("로그인 결과를 받지 못했습니다:", e.code || e.message); }
  return U.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, displayName: u.displayName, email: u.email } : null));
}
export async function login() {
  if (DEMO) return;
  const { U, auth } = await fb();
  const provider = new U.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await U.signInWithPopup(auth, provider);
  } catch (e) {
    // 팝업 차단·미지원 환경에서는 같은 탭에서 로그인한다 (학교 크롬북·사내망 대비)
    const fallback = ["auth/popup-blocked", "auth/cancelled-popup-request", "auth/operation-not-supported-in-this-environment"];
    if (fallback.includes(e.code)) await U.signInWithRedirect(auth, provider);
    else throw e;
  }
}
export async function logout() {
  if (DEMO) return;
  const { U, auth } = await fb();
  await U.signOut(auth);
}
/* ---------- 사용 권한 ----------
 * admins/{이메일}  : 관리자 (Firebase 콘솔에서 직접 만든다)
 * allowed/{이메일} : 관리자가 승인한 선생님
 * 규칙상 본인 문서와 관리자만 읽을 수 있으므로, 못 읽으면 "승인 안 됨"으로 본다.
 *
 * 로그인 직후나 저장 직후에는 SDK 가 연결을 다시 맺는 동안 스스로를 "오프라인"으로 보고
 * 캐시(빈 값·옛 값)를 돌려줄 수 있다. 그러면 승인된 선생님이 대기 화면을 보거나 방금 승인한
 * 명단이 안 보이므로, 여기서는 서버가 확인해 준 값만 쓴다.
 */
const mailKey = (u) => String(u.email || "").trim().toLowerCase();
const isOffline = (e) => e && (e.code === "unavailable" || /offline/i.test(e.message || ""));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 꼭 서버에서 읽어야 하는 것: 연결이 잠시 끊긴 사이에는 캐시를 돌려주지 않고 잠깐 뒤 다시 읽는다
async function fromServer(run, tries = 6) {
  for (let i = 0; ; i++) {
    try { return await run(); }
    catch (e) { if (!isOffline(e) || i >= tries - 1) throw e; await wait((i + 1) * 1000); }
  }
}

// 한 번 확인 (승인 대기 화면의 "다시 확인" 단추). { admin, approved, denied, offline }
export async function checkAccess(user) {
  if (DEMO) return { admin: true, approved: true };
  const { F, db } = await fb();
  const key = mailKey(user);
  if (!key) return { admin: false, approved: false };
  // 규칙이 옛 버전이면(admins 항목이 없는 규칙) 읽기 자체가 거부된다. 그 경우를 denied 로 알려 준다.
  let denied = false, offline = false;
  const has = (col) => fromServer(() => F.getDocFromServer(F.doc(db, col, key))).then((d) => d.exists())
    .catch((e) => { if (isDenied(e)) denied = true; else if (isOffline(e)) offline = true; return false; });
  const admin = await has("admins");
  if (admin) return { admin: true, approved: true, denied: false, offline: false };
  const approved = await has("allowed");
  return { admin: false, approved, denied, offline };
}

/* 승인 여부를 계속 지켜본다. cb({ admin, approved, denied })
 * 서버가 확인해 준 값이 올 때까지는 부르지 않는다. 관리자가 승인(취소)하면 곧바로 다시 부른다.
 * 돌려준 함수를 부르면 그만 지켜본다. */
// SDK 연결과 상관없이 일반 웹 요청으로 문서가 있는지 본다. 규칙은 똑같이 적용된다. true·false, 거부되면 "denied"
async function restHas(col, key) {
  const { auth } = await fb();
  if (!auth.currentUser) throw new Error("로그인 전");
  const token = await auth.currentUser.getIdToken();
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/${col}/${encodeURIComponent(key)}?mask.fieldPaths=email`;
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  if (res.status === 403) return "denied";
  throw new Error("REST " + res.status);
}
export function watchAccess(user, cb) {
  if (DEMO) { cb({ admin: true, approved: true, denied: false }); return () => {}; }
  const key = mailKey(user);
  if (!key) { cb({ admin: false, approved: false, denied: false }); return () => {}; }
  let stop = () => {}, cancelled = false;
  fb().then(({ F, db }) => {
    if (cancelled) return;
    const st = { admin: null, allowed: null, denied: false };   // null = 서버 답이 아직 없다
    const emit = () => {
      if (st.admin === null || st.allowed === null) return;
      cb({ admin: st.admin, approved: st.admin || st.allowed, denied: st.denied });
    };
    const sub = (col, field) => F.onSnapshot(F.doc(db, col, key), { includeMetadataChanges: true },
      (snap) => { if (snap.metadata.fromCache) return; st[field] = snap.exists(); emit(); },   // 캐시 값은 믿지 않는다
      (e) => { if (isDenied(e)) st.denied = true; st[field] = false; emit(); });
    const unA = sub("admins", "admin"), unB = sub("allowed", "allowed");
    // 실시간 답이 FIRST_WAIT_MS 안에 오지 않으면(휴대폰 망 등) 웹 요청으로 직접 확인하고, 답을 얻을 때까지 되풀이한다
    let tries = 0, timer = null;
    const fallback = async () => {
      timer = null;
      if (cancelled || (st.admin !== null && st.allowed !== null)) return;
      try {
        const [a, b] = EMU ? [null, null] : await Promise.all([restHas("admins", key), restHas("allowed", key)]);
        if (a !== null && !cancelled && (st.admin === null || st.allowed === null)) {
          st.denied = a === "denied" || b === "denied";
          st.admin = a === true; st.allowed = b === true;
          emit();
          return;
        }
      } catch (e) { console.warn("승인 여부를 웹 요청으로 확인하지 못했습니다:", e.message); }
      if (++tries < 20) timer = setTimeout(fallback, 5000);
    };
    timer = setTimeout(fallback, FIRST_WAIT_MS);
    stop = () => { unA(); unB(); if (timer) clearTimeout(timer); };
  }).catch((e) => cb({ admin: false, approved: false, denied: false, error: e }));
  return () => { cancelled = true; stop(); };
}

const allowedOf = (d) => { const x = d.data({ serverTimestamps: "estimate" }); return { id: d.id, ...x, addedAt: ms(x.addedAt) }; };
const sortAllowed = (list) => list.sort((a, b) => (a.email || "").localeCompare(b.email || ""));
export async function listAllowed() {
  if (DEMO) return [{ id: "teacher@example.com", email: "teacher@example.com", school: "보기 학교", note: "", addedAt: Date.now() }];
  const { F, db } = await fb();
  const snap = await fromServer(() => F.getDocsFromServer(F.collection(db, "allowed")));
  return sortAllowed(snap.docs.map(allowedOf));
}
export async function addAllowed({ email, school, note, by }) {
  const key = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) throw new Error("이메일 형식이 아닙니다");
  if (DEMO) return key;
  const { F, db } = await fb();
  await F.setDoc(F.doc(db, "allowed", key), {
    email: key, school: school || "", note: note || "", addedBy: by || "", addedAt: F.serverTimestamp(),
  });
  return key;
}
export async function removeAllowed(key) {
  if (DEMO) return;
  const { F, db } = await fb();
  await F.deleteDoc(F.doc(db, "allowed", key));
}
/* 관리자 화면: 승인 명단을 구독한다. cb(목록). 방금 추가·취소한 것은 서버 응답을 기다리지 않고 바로 반영된다. */
export function watchAllowed(cb, onError) {
  if (DEMO) { listAllowed().then(cb); return () => {}; }
  return watchCollection("allowed", listAllowed, (docs) => sortAllowed(docs.map(allowedOf)), cb, onError);
}
/* ---------- 사용 신청 ----------
 * requests/{이메일} : 로그인한 선생님이 직접 내는 신청(학교·성함·연락처). 승인·거절하면 지워서 연락처를 남기지 않는다. */
const requestOf = (d) => { const x = d.data({ serverTimestamps: "estimate" }); return { id: d.id, ...x, createdAt: ms(x.createdAt) }; };
const sortRequests = (list) => list.sort((a, b) => a.createdAt - b.createdAt);
export async function submitRequest(user, { name, school, phone }) {
  if (DEMO) return;
  const { F, db } = await fb();
  const key = mailKey(user);
  await F.setDoc(F.doc(db, "requests", key), {
    email: key, name: String(name || "").trim(), school: String(school || "").trim(), phone: String(phone || "").trim(),
    createdAt: F.serverTimestamp(),
  });
}
/* 내 신청을 지켜본다. cb(신청 | null). 캐시 값은 믿지 않고 서버가 확인해 준 값만 넘긴다 (watchAccess 와 같은 이유) */
export function watchMyRequest(user, cb) {
  const key = mailKey(user);
  if (DEMO || !key) { cb(null); return () => {}; }
  let stop = () => {}, cancelled = false;
  fb().then(({ F, db }) => {
    if (cancelled) return;
    stop = F.onSnapshot(F.doc(db, "requests", key), { includeMetadataChanges: true },
      (snap) => { if (snap.metadata.fromCache) return; cb(snap.exists() ? requestOf(snap) : null); },
      () => cb(null));
  }).catch(() => cb(null));
  return () => { cancelled = true; stop(); };
}
export async function listRequests() {
  if (DEMO) return [];
  const { F, db } = await fb();
  const snap = await fromServer(() => F.getDocsFromServer(F.collection(db, "requests")));
  return sortRequests(snap.docs.map(requestOf));
}
export function watchRequests(cb, onError) {
  if (DEMO) { cb([]); return () => {}; }
  return watchCollection("requests", listRequests, (docs) => sortRequests(docs.map(requestOf)), cb, onError);
}
// 승인: 명단에 넣는 것과 신청서를 지우는 것을 한 번에 한다 (성함은 명단의 note 칸에 남긴다)
export async function approveRequest(req, by) {
  if (DEMO) return;
  const { F, db } = await fb();
  const batch = F.writeBatch(db);
  batch.set(F.doc(db, "allowed", req.id), {
    email: req.id, school: req.school || "", note: req.name || "", addedBy: by || "", addedAt: F.serverTimestamp(),
  });
  batch.delete(F.doc(db, "requests", req.id));
  await batch.commit();
}
// 거절·본인 취소
export async function removeRequest(key) {
  if (DEMO) return;
  const { F, db } = await fb();
  await F.deleteDoc(F.doc(db, "requests", key));
}
/* 관리자 화면: 전체 책장을 구독한다. cb(목록) */
export function watchAllShelves(cb, onError) {
  if (DEMO) return demoWatch(() => demoRead().shelves, cb);
  return watchCollection("shelves", listAllShelves, (docs) => docs.map(docOf).sort((a, b) => b.createdAt - a.createdAt), cb, onError);
}
function watchCollection(name, fetchOnce, map, cb, onError) {
  let stop = () => {}, cancelled = false;
  fb().then(({ F, db }) => {
    if (cancelled) return;
    stop = liveOrPoll({
      cb, onError, fetchOnce,
      listen: (next, fail) => F.onSnapshot(F.collection(db, name), (snap) => next(map(snap.docs)), fail),
    });
  }).catch((e) => { if (onError) onError(e); });
  return () => { cancelled = true; stop(); };
}
export async function listAllShelves() {
  if (DEMO) return demoRead().shelves;
  const { F, db } = await fb();
  const snap = await fromServer(() => F.getDocsFromServer(F.collection(db, "shelves")));
  return snap.docs.map(docOf).sort((a, b) => b.createdAt - a.createdAt);
}

/* ---------- 책장 이름 바꾸기·삭제 ---------- */
export async function renameShelf(shelf, { school, teacherName, title }) {
  if (DEMO) {
    const d = demoRead();
    const s = d.shelves.find((x) => x.id === shelf.id);
    if (s) Object.assign(s, { school, teacherName, title });
    demoWrite(d);
    return;
  }
  const { F, db } = await fb();
  await F.updateDoc(F.doc(db, "shelves", shelf.id), { school, teacherName, title });
}
export async function deleteShelf(shelf) {
  if (DEMO) {
    const d = demoRead();
    (d.books[shelf.id] || []).forEach((b) => delete d.priv[b.id]);
    delete d.books[shelf.id];
    d.shelves = d.shelves.filter((x) => x.id !== shelf.id);
    demoWrite(d);
    return;
  }
  const { F, db } = await fb();
  // 책과 모둠원 학번을 먼저 지우고 마지막에 책장을 지운다 (하위 문서는 자동으로 지워지지 않는다)
  const snap = await F.getDocs(F.collection(db, "shelves", shelf.id, "books"));
  for (const d of snap.docs) {
    await F.deleteDoc(F.doc(db, "shelves", shelf.id, "books", d.id));
    await F.deleteDoc(F.doc(db, "shelves", shelf.id, "private", d.id)).catch(() => {});
  }
  await F.deleteDoc(F.doc(db, "shelves", shelf.id));
}

export async function myShelves(uid) {
  if (DEMO) return demoRead().shelves;
  const { F, db } = await fb();
  // 로그인 직후 캐시(빈 목록)를 받으면 책장이 있는 선생님에게 "책장 만들기" 화면이 뜨므로 서버에서 읽는다
  const snap = await fromServer(() => F.getDocsFromServer(F.query(F.collection(db, "shelves"), F.where("teacherUid", "==", uid))));
  return snap.docs.map(docOf).sort((a, b) => a.createdAt - b.createdAt);
}
export async function createShelf({ school, teacherName, title, uid }) {
  if (DEMO) {
    const d = demoRead();
    const shelf = { id: "s" + Date.now(), code: makeCode(school), school, teacherName, title, teacherUid: uid, createdAt: Date.now(), classes: [] };
    d.shelves.push(shelf); d.books[shelf.id] = []; demoWrite(d);
    return shelf;
  }
  const { F, db } = await fb();
  let code = makeCode(school);
  for (let i = 0; i < 5; i++) {
    const dup = await F.getDocs(F.query(F.collection(db, "shelves"), F.where("code", "==", code), F.limit(1)));
    if (dup.empty) break;
    code = makeCode(school);
  }
  const ref = await F.addDoc(F.collection(db, "shelves"), {
    code, school, teacherName, title, teacherUid: uid, createdAt: F.serverTimestamp(),
  });
  return { id: ref.id, code, school, teacherName, title, teacherUid: uid, createdAt: Date.now() };
}
export async function regenerateCode(shelf) {
  const code = makeCode(shelf.school);
  if (DEMO) {
    const d = demoRead();
    const s = d.shelves.find((x) => x.id === shelf.id);
    if (s) s.code = code;
    demoWrite(d);
    return code;
  }
  const { F, db } = await fb();
  await F.updateDoc(F.doc(db, "shelves", shelf.id), { code });
  return code;
}
export async function listBooks(shelfId) {
  if (DEMO) return (demoRead().books[shelfId] || []).slice().sort((a, b) => a.createdAt - b.createdAt);
  const { F, db } = await fb();
  const snap = await F.getDocs(F.collection(db, "shelves", shelfId, "books"));
  return sortBooks(snap.docs.map(docOf));
}
export async function loadMembers(shelfId, ids) {
  const out = {};
  if (DEMO) { const d = demoRead(); ids.forEach((id) => (out[id] = d.priv[id] || "")); return out; }
  const { F, db } = await fb();
  await Promise.all(ids.map(async (id) => {
    const s = await F.getDoc(F.doc(db, "shelves", shelfId, "private", id));
    out[id] = s.exists() ? s.data().memberNames || "" : "";
  }));
  return out;
}
export async function setStatus(shelf, ids, status) {
  const classesOf = (books) => [...new Set(books.map((b) => `${b.grade}-${b.classNo}`))];
  if (DEMO) {
    const d = demoRead();
    const list = d.books[shelf.id] || [];
    list.forEach((b) => { if (ids.includes(b.id)) b.status = status; });
    const s = d.shelves.find((x) => x.id === shelf.id);
    if (s && status === "approved") s.classes = [...new Set([...(s.classes || []), ...classesOf(list.filter((b) => ids.includes(b.id)))])];
    demoWrite(d);
    return;
  }
  const { F, db } = await fb();
  await Promise.all(ids.map((id) => F.updateDoc(F.doc(db, "shelves", shelf.id, "books", id), { status })));
  if (status === "approved") {
    const all = await listBooks(shelf.id);
    const cls = classesOf(all.filter((b) => ids.includes(b.id)));
    if (cls.length) await F.updateDoc(F.doc(db, "shelves", shelf.id), { classes: F.arrayUnion(...cls) });
  }
}
export async function updateBook(shelfId, id, patch) {
  if (DEMO) {
    const d = demoRead();
    const b = (d.books[shelfId] || []).find((x) => x.id === id);
    if (b) Object.assign(b, patch);
    demoWrite(d);
    return;
  }
  const { F, db } = await fb();
  await F.updateDoc(F.doc(db, "shelves", shelfId, "books", id), patch);
}
export async function deleteBook(shelfId, id) {
  if (DEMO) {
    const d = demoRead();
    d.books[shelfId] = (d.books[shelfId] || []).filter((x) => x.id !== id);
    delete d.priv[id];
    demoWrite(d);
    return;
  }
  const { F, db } = await fb();
  await F.deleteDoc(F.doc(db, "shelves", shelfId, "books", id));
  await F.deleteDoc(F.doc(db, "shelves", shelfId, "private", id)).catch(() => {});
}

/* ---------- 활동지: 학생 확인·개인 칸 백업·모둠 칸 함께 쓰기 ----------
 * 학생은 로그인 계정이 없다. 학번(5자리) + 비밀번호(4자리)로 자기 활동지를 찾는다.
 *   shelves/{책장}/roster/{학번}        이 학번이 이미 쓰이고 있는지만 알려 준다 (이름 없음)
 *   shelves/{책장}/students/{해시}      해시 = sha256(책장id|학번|비밀번호). 주소를 아는 사람 = 본인
 *     { sid, grade, classNo, num, team(0 = 모둠 없음), answers(개인 칸), reset, code, createdAt, updatedAt }
 *     학생 이름은 받지 않는다(개인정보). 예전에 만든 문서의 name 은 학생이 들어올 때 지운다(dropName).
 *   shelves/{책장}/groups/{학년-반-모둠} { answers(모둠 칸), code, updatedAt }
 *   shelves/{책장}/groups/{학년-반-모둠}/posts/{학번-1|2} { sid, area, text, code, createdAt, updatedAt }  3차시 모둠 대화
 * 선생님(책장 주인)은 students 를 모두 읽고, 비밀번호를 0000 으로 되돌리거나 모둠에서 뺄 수 있다.
 */
export const RESET_PIN = "0000";
export const MAX_TEAM = 8;
export function parseSid(sid) {
  const m = /^([1-3])(\d{2})(\d{2})$/.exec(String(sid || "").trim());
  if (!m) return null;
  const grade = +m[1], classNo = +m[2], num = +m[3];
  if (classNo < 1 || classNo > 20 || num < 1) return null;
  return { sid: m[0], grade, classNo, num };
}
export const groupId = (s) => (s && s.team ? `${s.grade}-${s.classNo}-${s.team}` : "");
export async function studentKey(shelfId, sid, pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${shelfId}|${sid}|${pin}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const wsOf = (d, shelfId) => {
  d.ws = d.ws || {};
  return (d.ws[shelfId] = d.ws[shelfId] || { roster: {}, students: {}, groups: {} });
};
const stuOf = (id, x) => ({ id, ...x, createdAt: ms(x.createdAt), updatedAt: ms(x.updatedAt) });
const existsErr = () => Object.assign(new Error("이미 쓰이고 있는 학번이에요"), { code: "exists" });

/* 학생 문서 찾기. { status: "ok", student } | { status: "wrong" } (학번은 있는데 비밀번호가 다름) | { status: "new" } */
export async function findStudent(shelf, sid, pin) {
  const key = await studentKey(shelf.id, sid, pin);
  if (DEMO) {
    const w = wsOf(demoRead(), shelf.id);
    if (w.students[key]) return { status: "ok", student: stuOf(key, w.students[key]) };
    return { status: w.roster[sid] ? "wrong" : "new" };
  }
  const { F, db } = await fb();
  const s = await fromServer(() => F.getDocFromServer(F.doc(db, "shelves", shelf.id, "students", key)));
  if (s.exists()) return { status: "ok", student: stuOf(key, s.data({ serverTimestamps: "estimate" })) };
  const r = await fromServer(() => F.getDocFromServer(F.doc(db, "shelves", shelf.id, "roster", sid)));
  return { status: r.exists() ? "wrong" : "new" };
}
/* 이 기기에 기억해 둔 열쇠로 다시 열 때. 학생 | null (선생님이 비밀번호를 되돌렸거나 지웠으면 null) */
export async function getStudent(shelf, key) {
  if (DEMO) { const s = wsOf(demoRead(), shelf.id).students[key]; return s ? stuOf(key, s) : null; }
  const { F, db } = await fb();
  const s = await fromServer(() => F.getDocFromServer(F.doc(db, "shelves", shelf.id, "students", key)));
  return s.exists() ? stuOf(key, s.data({ serverTimestamps: "estimate" })) : null;
}
export async function createStudent(shelf, { sid, pin, answers = {} }) {
  const p = parseSid(sid);
  if (!p) throw new Error("학번은 5자리 숫자예요 (예: 20415)");
  const key = await studentKey(shelf.id, p.sid, pin);
  const base = { sid: p.sid, grade: p.grade, classNo: p.classNo, num: p.num, team: 0, answers, reset: false };
  if (DEMO) {
    const d = demoRead(), w = wsOf(d, shelf.id);
    if (w.roster[p.sid]) throw existsErr();
    w.roster[p.sid] = { createdAt: Date.now() };
    w.students[key] = { ...base, code: shelf.code, createdAt: Date.now(), updatedAt: Date.now() };
    demoWrite(d);
    return stuOf(key, w.students[key]);
  }
  const { F, db } = await fb();
  // 학번 자리(roster)는 한 번만 만들 수 있다. 이미 있으면 규칙이 거부한다
  const batch = F.writeBatch(db);
  batch.set(F.doc(db, "shelves", shelf.id, "roster", p.sid), { code: shelf.code, createdAt: F.serverTimestamp() });
  batch.set(F.doc(db, "shelves", shelf.id, "students", key), { ...base, code: shelf.code, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
  try { await batch.commit(); } catch (e) { if (isDenied(e)) throw existsErr(); throw e; }
  return stuOf(key, { ...base, createdAt: Date.now(), updatedAt: Date.now() });
}
/* 학생 문서 일부 고치기 (개인 칸 백업·모둠 고르기). answers 는 통째로 바꾼다 (지운 칸도 반영되게) */
export async function updateStudent(shelf, key, patch) {
  if (DEMO) {
    const d = demoRead(), w = wsOf(d, shelf.id);
    if (!w.students[key]) throw Object.assign(new Error("활동지를 찾지 못했어요"), { code: "not-found" });
    Object.assign(w.students[key], patch, { updatedAt: Date.now() });
    demoWrite(d);
    return;
  }
  const { F, db } = await fb();
  await F.updateDoc(F.doc(db, "shelves", shelf.id, "students", key), { ...patch, code: shelf.code, updatedAt: F.serverTimestamp() });
}
/* 예전에 받은 이름을 학생 문서에서 지운다 (이름은 더 받지 않는다) */
export async function dropName(shelf, key) {
  if (DEMO) {
    const d = demoRead(), s = wsOf(d, shelf.id).students[key];
    if (s && "name" in s) { delete s.name; demoWrite(d); }
    return;
  }
  const { F, db } = await fb();
  await F.updateDoc(F.doc(db, "shelves", shelf.id, "students", key), { name: F.deleteField(), code: shelf.code, updatedAt: F.serverTimestamp() });
}
/* 비밀번호 바꾸기: 새 주소로 옮기고 옛 문서를 지운다. 새 열쇠를 돌려준다 */
export async function changePin(shelf, student, newPin) {
  const key = await studentKey(shelf.id, student.sid, newPin);
  if (key === student.id) { await updateStudent(shelf, key, { reset: false }); return key; }
  if (DEMO) {
    const d = demoRead(), w = wsOf(d, shelf.id);
    const cur = w.students[student.id];
    if (!cur) throw Object.assign(new Error("활동지를 찾지 못했어요"), { code: "not-found" });
    w.students[key] = { ...cur, reset: false, updatedAt: Date.now() };
    delete w.students[student.id];
    demoWrite(d);
    return key;
  }
  const { F, db } = await fb();
  const cur = await fromServer(() => F.getDocFromServer(F.doc(db, "shelves", shelf.id, "students", student.id)));
  if (!cur.exists()) throw Object.assign(new Error("활동지를 찾지 못했어요"), { code: "not-found" });
  const x = cur.data();
  const batch = F.writeBatch(db);
  batch.set(F.doc(db, "shelves", shelf.id, "students", key), {
    sid: x.sid, grade: x.grade, classNo: x.classNo, num: x.num, team: x.team || 0,
    answers: x.answers || {}, reset: false, from: student.id,   // 규칙이 같은 학번의 옛 문서를 지우는지 확인한다
    code: shelf.code, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp(),
  });
  batch.delete(F.doc(db, "shelves", shelf.id, "students", student.id));
  await batch.commit();
  return key;
}
/* 내 학생 문서를 지켜본다 (선생님이 모둠에서 빼거나 비밀번호를 되돌리면 알기 위해). cb(학생 | null) */
export function watchStudent(shelf, key, cb, onError) {
  if (DEMO) return demoWatch(() => { const s = wsOf(demoRead(), shelf.id).students[key]; return s ? stuOf(key, s) : null; }, cb);
  let stop = () => {}, cancelled = false;
  fb().then(({ F, db }) => {
    if (cancelled) return;
    stop = F.onSnapshot(F.doc(db, "shelves", shelf.id, "students", key), { includeMetadataChanges: true },
      (snap) => { if (snap.metadata.fromCache) return; cb(snap.exists() ? stuOf(key, snap.data({ serverTimestamps: "estimate" })) : null); },
      (e) => { if (onError) onError(e); });
  }).catch((e) => { if (onError) onError(e); });
  return () => { cancelled = true; stop(); };
}
/* 모둠 칸을 지켜본다. cb({ answers, pending, offline }) */
export function watchGroup(shelf, gid, cb, onError) {
  if (DEMO) return demoWatch(() => ({ answers: { ...((wsOf(demoRead(), shelf.id).groups[gid] || {}).answers || {}) }, pending: false, offline: false }), cb);
  let stop = () => {}, cancelled = false;
  fb().then(({ F, db }) => {
    if (cancelled) return;
    stop = F.onSnapshot(F.doc(db, "shelves", shelf.id, "groups", gid), { includeMetadataChanges: true },
      (snap) => cb({ answers: (snap.exists() && snap.data().answers) || {}, pending: snap.metadata.hasPendingWrites, offline: snap.metadata.fromCache }),
      (e) => { if (onError) onError(e); });
  }).catch((e) => { if (onError) onError(e); });
  return () => { cancelled = true; stop(); };
}
/* 모둠 칸 몇 개를 저장한다. 칸마다 따로 합쳐지므로 다른 모둠원이 쓴 칸을 덮지 않는다 */
export async function saveGroup(shelf, gid, values) {
  if (DEMO) {
    const d = demoRead(), w = wsOf(d, shelf.id);
    const g = (w.groups[gid] = w.groups[gid] || { answers: {} });
    Object.assign(g.answers, values); g.updatedAt = Date.now();
    demoWrite(d);
    return;
  }
  const { F, db } = await fb();
  await F.setDoc(F.doc(db, "shelves", shelf.id, "groups", gid), { answers: values, code: shelf.code, updatedAt: F.serverTimestamp() }, { merge: true });
}

/* ---------- 3차시 모둠 대화 ----------
 * 글 주소는 {학번}-1, {학번}-2 둘뿐이다 → 한 학생은 3차시 전체에서 2개까지. 규칙도 같은 것을 확인한다. */
export const POST_MAX = 2;
export const POST_LEN = 300;
const postOf = (id, x) => ({ id, sid: x.sid, area: x.area, text: x.text, createdAt: ms(x.createdAt), updatedAt: ms(x.updatedAt) });
const sortPosts = (list) => list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
/* 한 모둠의 글을 지켜본다. cb(글 목록, { offline }) — 실시간 연결이 흔들릴 때 캐시로 지운 것처럼 보이지 않게 offline 을 함께 넘긴다 */
export function watchPosts(shelfId, gid, cb, onError) {
  if (DEMO) return demoWatch(() => sortPosts(Object.entries(((wsOf(demoRead(), shelfId).groups[gid] || {}).posts) || {}).map(([k, x]) => postOf(k, x))), (list) => cb(list, { offline: false }));
  let stop = () => {}, cancelled = false;
  fb().then(({ F, db }) => {
    if (cancelled) return;
    const col = F.collection(db, "shelves", shelfId, "groups", gid, "posts");
    stop = liveOrPoll({
      cb: (list) => cb(list, { offline: false }), onError,
      fetchOnce: async () => sortPosts((await fromServer(() => F.getDocsFromServer(col))).docs.map((d) => postOf(d.id, d.data({ serverTimestamps: "estimate" })))),
      listen: (next, fail) => F.onSnapshot(col, { includeMetadataChanges: true }, (snap) => {
        if (snap.metadata.fromCache && !snap.metadata.hasPendingWrites) return;   // 캐시만 있는 응답은 믿지 않는다
        next(sortPosts(snap.docs.map((d) => postOf(d.id, d.data({ serverTimestamps: "estimate" })))));
      }, fail),
    });
  }).catch((e) => { if (onError) onError(e); });
  return () => { cancelled = true; stop(); };
}
/* 글 올리기·고치기. slot 은 1 또는 2. 고칠 때는 처음 올린 때(createdAt)를 그대로 둔다 */
export async function savePost(shelf, gid, sid, slot, { area, text }, isNew) {
  const id = `${sid}-${slot}`;
  const body = { sid, area, text: String(text).trim().slice(0, POST_LEN) };
  if (!body.text) throw new Error("빈 글은 올릴 수 없어요");
  if (DEMO) {
    const d = demoRead(), w = wsOf(d, shelf.id);
    const g = (w.groups[gid] = w.groups[gid] || { answers: {} });
    g.posts = g.posts || {};
    const old = g.posts[id];
    g.posts[id] = { ...body, createdAt: isNew || !old ? Date.now() : old.createdAt, updatedAt: Date.now() };
    demoWrite(d);
    return;
  }
  const { F, db } = await fb();
  const ref = F.doc(db, "shelves", shelf.id, "groups", gid, "posts", id);
  if (isNew) await F.setDoc(ref, { ...body, code: shelf.code, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
  else await F.updateDoc(ref, { ...body, code: shelf.code, updatedAt: F.serverTimestamp() });
}
export async function deletePost(shelfId, gid, id) {
  if (DEMO) {
    const d = demoRead(), g = wsOf(d, shelfId).groups[gid];
    if (g && g.posts) { delete g.posts[id]; demoWrite(d); }
    return;
  }
  const { F, db } = await fb();
  await F.deleteDoc(F.doc(db, "shelves", shelfId, "groups", gid, "posts", id));
}

/* 선생님 화면: 활동지를 연 학생 명단. cb(학생 목록) — 개인 칸 내용은 빼고 칸 수만 넘긴다 */
const sortStudents = (list) => list.sort((a, b) => a.sid.localeCompare(b.sid));
const rosterRow = (id, x) => {
  const { answers, ...rest } = stuOf(id, x);
  return { ...rest, filled: Object.values(answers || {}).filter((v) => String(v).trim()).length };
};
// 학번 자리만 있고 활동지가 없는 것(만들다 끊긴 경우 등)도 { orphan: true } 로 넣어, 선생님이 풀어 줄 수 있게 한다
function mergeRoster(students, sids) {
  const have = new Set(students.map((s) => s.sid));
  const orphans = sids.filter((sid) => !have.has(sid)).map((sid) => ({ id: "", sid, ...parseSid(sid), name: "", team: 0, orphan: true, filled: 0 }));
  return sortStudents([...students, ...orphans]);
}
export function watchStudents(shelfId, cb, onError) {
  if (DEMO) return demoWatch(() => { const w = wsOf(demoRead(), shelfId); return mergeRoster(Object.entries(w.students).map(([k, s]) => rosterRow(k, s)), Object.keys(w.roster)); }, cb);
  let stop = () => {}, cancelled = false;
  fb().then(({ F, db }) => {
    if (cancelled) return;
    const col = (name) => F.collection(db, "shelves", shelfId, name);
    const rows = (snap) => snap.docs.map((d) => rosterRow(d.id, d.data({ serverTimestamps: "estimate" })));
    stop = liveOrPoll({
      cb, onError,
      fetchOnce: async () => {
        const [s, r] = await Promise.all([fromServer(() => F.getDocsFromServer(col("students"))), fromServer(() => F.getDocsFromServer(col("roster")))]);
        return mergeRoster(rows(s), r.docs.map((d) => d.id));
      },
      listen: (next, fail) => {
        let st = null, ro = null;
        const push = () => { if (st && ro) next(mergeRoster(st, ro)); };
        const a = F.onSnapshot(col("students"), (snap) => { st = rows(snap); push(); }, fail);
        const b = F.onSnapshot(col("roster"), (snap) => { ro = snap.docs.map((d) => d.id); push(); }, fail);
        return () => { a(); b(); };
      },
    });
  }).catch((e) => { if (onError) onError(e); });
  return () => { cancelled = true; stop(); };
}
/* 선생님: 모둠에서 빼기 */
export async function kickStudent(shelfId, key) {
  if (DEMO) {
    const d = demoRead(), s = wsOf(d, shelfId).students[key];
    if (s) { s.team = 0; demoWrite(d); }
    return;
  }
  const { F, db } = await fb();
  await F.updateDoc(F.doc(db, "shelves", shelfId, "students", key), { team: 0 });
}
/* 선생님: 비밀번호를 0000 으로 되돌린다. 학생은 0000 으로 들어와 새 비밀번호를 정한다 */
export async function resetStudentPin(shelfId, row) {
  const key = await studentKey(shelfId, row.sid, RESET_PIN);
  if (DEMO) {
    const d = demoRead(), w = wsOf(d, shelfId), s = w.students[row.id];
    if (!s) return;
    delete w.students[row.id];
    const { name, ...rest } = s;
    w.students[key] = { ...rest, reset: true, updatedAt: Date.now() };
    demoWrite(d);
    return;
  }
  const { F, db } = await fb();
  if (key === row.id) { await F.updateDoc(F.doc(db, "shelves", shelfId, "students", key), { reset: true }); return; }
  const cur = await fromServer(() => F.getDocFromServer(F.doc(db, "shelves", shelfId, "students", row.id)));
  if (!cur.exists()) return;
  const batch = F.writeBatch(db);
  const { name, ...rest } = cur.data();   // 예전 문서의 이름은 옮기지 않는다
  batch.set(F.doc(db, "shelves", shelfId, "students", key), { ...rest, reset: true });
  batch.delete(F.doc(db, "shelves", shelfId, "students", row.id));
  await batch.commit();
}
/* 선생님: 학번을 잘못 넣은 활동지를 지운다 (그 학번을 다시 쓸 수 있게 풀어 준다) */
export async function deleteStudent(shelfId, row) {
  if (DEMO) {
    const d = demoRead(), w = wsOf(d, shelfId);
    if (row.id) delete w.students[row.id];
    delete w.roster[row.sid];
    demoWrite(d);
    return;
  }
  const { F, db } = await fb();
  const batch = F.writeBatch(db);
  if (row.id) batch.delete(F.doc(db, "shelves", shelfId, "students", row.id));
  batch.delete(F.doc(db, "shelves", shelfId, "roster", row.sid));
  await batch.commit();
}
