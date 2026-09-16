/* 산출물 책장 — 데이터 계층 (Firebase 하나만 씁니다)
 *
 * 설정(assets/firebase-config.js)이 비어 있거나 주소에 ?demo=1 이 붙으면
 * "미리보기(데모)" 모드로 동작합니다. 데모 모드는 이 브라우저에만 저장됩니다.
 *
 * 공개 화면에서는 모둠원 이름(shelves/{id}/private)을 절대 읽지 않습니다.
 */
import { firebaseConfig, FEATURES } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.14.1";
const params = new URLSearchParams(location.search);

export const CONFIGURED = !!(firebaseConfig.apiKey && firebaseConfig.projectId);
export const CAN_UPLOAD = !!(FEATURES && FEATURES.coverUpload);
export const DEMO = params.get("demo") === "1" || !CONFIGURED;

export const COVERS = [
  { id: "heat", label: "열" }, { id: "state", label: "상태 변화" }, { id: "wave", label: "빛과 파동" },
  { id: "gas", label: "기체" }, { id: "plant", label: "식물" }, { id: "space", label: "태양계" },
  { id: "energy", label: "운동·에너지" }, { id: "weather", label: "날씨" }, { id: "reaction", label: "화학 반응" },
  { id: "life", label: "생물" }, { id: "electric", label: "전기·자기" }, { id: "earth", label: "지구" },
];
export const COVER_COLORS = ["#23A087", "#2C7FD1", "#EE6B57", "#8A5CD6", "#E29A2A", "#2E9E6B"];
export const coverSrc = (kind) => `assets/covers/${COVERS.some((c) => c.id === kind) ? kind : "heat"}.svg`;

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
  const app = A.initializeApp(firebaseConfig);
  _fb = { F, U, db: F.getFirestore(app), auth: U.getAuth(app), app };
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
    priv: { d1: "김하늘, 이서준, 박지우", d2: "최민준, 정수아", d3: "한예린, 오지호", d4: "강도윤, 임서연", d5: "문가온, 배시우" },
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
const CACHE_MS = 5 * 60 * 1000;

export async function loadShelf(code) {
  const key = "sih-shelf-" + code;
  try {
    const hit = JSON.parse(sessionStorage.getItem(key) || "null");
    if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
  } catch (e) { /* 무시 */ }

  let value;
  if (DEMO) {
    const d = demoRead();
    const shelf = d.shelves.find((s) => s.code.toUpperCase() === code.toUpperCase());
    value = shelf
      ? { shelf, books: (d.books[shelf.id] || []).filter((b) => b.status === "approved").sort((a, b) => a.createdAt - b.createdAt) }
      : { shelf: null, books: [] };
  } else {
    const { F, db } = await fb();
    const snap = await F.getDocs(F.query(F.collection(db, "shelves"), F.where("code", "==", code.toUpperCase()), F.limit(1)));
    if (snap.empty) value = { shelf: null, books: [] };
    else {
      const shelf = { id: snap.docs[0].id, ...snap.docs[0].data() };
      const bs = await F.getDocs(F.query(F.collection(db, "shelves", shelf.id, "books"), F.where("status", "==", "approved")));
      const books = bs.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
      value = { shelf: plain(shelf), books: books.map(plain) };
    }
  }
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value })); } catch (e) { /* 무시 */ }
  return value;
}
export function clearShelfCache(code) {
  try { sessionStorage.removeItem("sih-shelf-" + code); } catch (e) { /* 무시 */ }
}

const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : 0);
const plain = (o) => ({ ...o, createdAt: ms(o.createdAt) });

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
 */
const mailKey = (u) => String(u.email || "").trim().toLowerCase();

export async function checkAccess(user) {
  if (DEMO) return { admin: true, approved: true };
  const { F, db } = await fb();
  const key = mailKey(user);
  if (!key) return { admin: false, approved: false };
  // 규칙이 옛 버전이면(admins 항목이 없는 규칙) 읽기 자체가 거부된다. 그 경우를 denied 로 알려 준다.
  let denied = false;
  const isDeny = (e) => e && (e.code === "permission-denied" || /insufficient permissions/i.test(e.message || ""));
  const admin = await F.getDoc(F.doc(db, "admins", key)).then((d) => d.exists()).catch((e) => { if (isDeny(e)) denied = true; return false; });
  if (admin) return { admin: true, approved: true, denied: false };
  const approved = await F.getDoc(F.doc(db, "allowed", key)).then((d) => d.exists()).catch((e) => { if (isDeny(e)) denied = true; return false; });
  return { admin: false, approved, denied };
}
export async function listAllowed() {
  if (DEMO) return [{ id: "teacher@example.com", email: "teacher@example.com", school: "보기 학교", note: "", addedAt: Date.now() }];
  const { F, db } = await fb();
  const snap = await F.getDocs(F.collection(db, "allowed"));
  return snap.docs.map((d) => plain({ id: d.id, ...d.data() })).sort((a, b) => (a.email || "").localeCompare(b.email || ""));
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
export async function listAllShelves() {
  if (DEMO) return demoRead().shelves;
  const { F, db } = await fb();
  const snap = await F.getDocs(F.collection(db, "shelves"));
  return snap.docs.map((d) => plain({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt);
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
  // 책과 모둠원 이름을 먼저 지우고 마지막에 책장을 지운다 (하위 문서는 자동으로 지워지지 않는다)
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
  const snap = await F.getDocs(F.query(F.collection(db, "shelves"), F.where("teacherUid", "==", uid)));
  return snap.docs.map((d) => plain({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt - b.createdAt);
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
  return snap.docs.map((d) => plain({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt - b.createdAt);
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
