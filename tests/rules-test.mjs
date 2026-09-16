// Firestore / Storage 보안 규칙을 에뮬레이터로 검증한다.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getBytes, deleteObject } from "firebase/storage";
import fs from "node:fs";
import path from "node:path";

const PROJ = path.resolve(process.argv[2]);
const results = [];
async function ok(name, p) { try { await assertSucceeds(p); results.push([true, name]); } catch (e) { results.push([false, name + " — 허용돼야 하는데 막힘: " + short(e)]); } }
async function no(name, p) { try { await assertFails(p); results.push([true, name]); } catch (e) { results.push([false, name + " — 막혀야 하는데 통과함"]); } }
const short = (e) => String(e.message || e).split("\n")[0].slice(0, 120);

const env = await initializeTestEnvironment({
  projectId: "demo-sih",
  firestore: { rules: fs.readFileSync(path.join(PROJ, "firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
  storage: { rules: fs.readFileSync(path.join(PROJ, "storage.rules"), "utf8"), host: "127.0.0.1", port: 9199 },
});
await env.clearFirestore();

const SHELF = "shelf1", CODE = "SEO-2026-4K7Q", TEACHER = "teacher-uid", OTHER = "other-uid";
const ADMIN_MAIL = "admin@example.com", TEACHER_MAIL = "teacher@school.kr", STRANGER_MAIL = "stranger@example.com";
const tok = (mail) => ({ email: mail, email_verified: true });
const bookBase = {
  grade: 2, classNo: 3, team: "1모둠", title: "산불 확산 시뮬레이션", url: "https://example.com/a",
  intent: "왜 만들었는지", howto: "어떻게 쓰는지", concepts: ["연소"], coverKind: "weather",
  coverColor: "#EE6B57", coverPath: "", status: "pending", example: false, code: CODE,
};

await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, "admins", ADMIN_MAIL), { email: ADMIN_MAIL });
  await setDoc(doc(db, "allowed", TEACHER_MAIL), { email: TEACHER_MAIL, school: "서울○○중학교", note: "", addedBy: ADMIN_MAIL, addedAt: new Date() });
  await setDoc(doc(db, "shelves", SHELF), { code: CODE, school: "서울○○중학교", teacherName: "김선생", title: "2학년 책장", teacherUid: TEACHER, createdAt: new Date() });
  await setDoc(doc(db, "shelves", SHELF, "books", "approved1"), { ...bookBase, status: "approved" });
  await setDoc(doc(db, "shelves", SHELF, "books", "pending1"), { ...bookBase });
  await setDoc(doc(db, "shelves", SHELF, "private", "approved1"), { memberNames: "김하늘, 이서준", code: CODE, createdAt: new Date() });
  await setDoc(doc(db, "shelves", SHELF, "private", "pending1"), { memberNames: "최민준", code: CODE, createdAt: new Date() });
});

const anon = env.unauthenticatedContext().firestore();
const mine = env.authenticatedContext(TEACHER, tok(TEACHER_MAIL)).firestore();
const others = env.authenticatedContext(OTHER, tok(STRANGER_MAIL)).firestore();
const admin = env.authenticatedContext("admin-uid", tok(ADMIN_MAIL)).firestore();
const stranger = env.authenticatedContext("new-uid", tok(STRANGER_MAIL)).firestore();

/* 공개 화면 */
await ok("비로그인: 코드로 책장 찾기", getDocs(query(collection(anon, "shelves"), where("code", "==", CODE))));
await ok("비로그인: 승인된 책 1권 읽기", getDoc(doc(anon, "shelves", SHELF, "books", "approved1")));
await no("비로그인: 승인 대기 책 읽기 차단", getDoc(doc(anon, "shelves", SHELF, "books", "pending1")));
await ok("비로그인: 승인된 책만 목록 조회", getDocs(query(collection(anon, "shelves", SHELF, "books"), where("status", "==", "approved"))));
await no("비로그인: 상태 조건 없이 전체 목록 차단", getDocs(collection(anon, "shelves", SHELF, "books")));
await no("비로그인: 대기 목록 조회 차단", getDocs(query(collection(anon, "shelves", SHELF, "books"), where("status", "==", "pending"))));
await no("비로그인: 모둠원 이름 읽기 차단", getDoc(doc(anon, "shelves", SHELF, "private", "approved1")));
await no("비로그인: 모둠원 이름 목록 조회 차단", getDocs(collection(anon, "shelves", SHELF, "private")));

/* 학생 제출 */
await ok("학생: 올바른 코드로 제출", addDoc(collection(anon, "shelves", SHELF, "books"), { ...bookBase, createdAt: serverTimestamp() }));
await no("학생: 틀린 코드로 제출 차단", addDoc(collection(anon, "shelves", SHELF, "books"), { ...bookBase, code: "XXX-2026-0000", createdAt: serverTimestamp() }));
await no("학생: 스스로 승인 상태로 제출 차단", addDoc(collection(anon, "shelves", SHELF, "books"), { ...bookBase, status: "approved", createdAt: serverTimestamp() }));
await no("학생: 예시로 올려 제출 차단", addDoc(collection(anon, "shelves", SHELF, "books"), { ...bookBase, example: true, createdAt: serverTimestamp() }));
await no("학생: http 링크 제출 차단", addDoc(collection(anon, "shelves", SHELF, "books"), { ...bookBase, url: "http://example.com", createdAt: serverTimestamp() }));
await no("학생: 너무 긴 제목 차단", addDoc(collection(anon, "shelves", SHELF, "books"), { ...bookBase, title: "가".repeat(61), createdAt: serverTimestamp() }));
await no("학생: 모둠원 이름을 책 문서에 넣으면 차단", addDoc(collection(anon, "shelves", SHELF, "books"), { ...bookBase, memberNames: "김하늘", createdAt: serverTimestamp() }));
await ok("학생: 모둠원 이름을 private 에 저장", setDoc(doc(anon, "shelves", SHELF, "private", "newbook"), { memberNames: "김하늘", code: CODE, createdAt: serverTimestamp() }));
await no("학생: 틀린 코드로 private 저장 차단", setDoc(doc(anon, "shelves", SHELF, "private", "newbook2"), { memberNames: "김하늘", code: "XXX-2026-0000", createdAt: serverTimestamp() }));
await no("비로그인: 책 수정 차단", updateDoc(doc(anon, "shelves", SHELF, "books", "approved1"), { title: "바꿔치기" }));
await no("비로그인: 책 삭제 차단", deleteDoc(doc(anon, "shelves", SHELF, "books", "approved1")));
await no("비로그인: 책장 수정 차단", updateDoc(doc(anon, "shelves", SHELF), { code: "HACK-2026-0000" }));

/* 책장 주인 선생님 */
await ok("교사: 대기 목록 조회", getDocs(query(collection(mine, "shelves", SHELF, "books"), where("status", "==", "pending"))));
await ok("교사: 전체 목록 조회", getDocs(collection(mine, "shelves", SHELF, "books")));
await ok("교사: 모둠원 이름 읽기", getDoc(doc(mine, "shelves", SHELF, "private", "pending1")));
await ok("교사: 승인 처리", updateDoc(doc(mine, "shelves", SHELF, "books", "pending1"), { status: "approved" }));
await ok("교사: 예시로 올리기", updateDoc(doc(mine, "shelves", SHELF, "books", "pending1"), { example: true }));
await ok("교사: 책 삭제", deleteDoc(doc(mine, "shelves", SHELF, "books", "approved1")));
await ok("교사: 코드 재발급", updateDoc(doc(mine, "shelves", SHELF), { code: "SEO-2026-NEW1" }));
await ok("교사: 자기 uid 로 책장 만들기", addDoc(collection(mine, "shelves"), { code: "SEO-2026-AAAA", school: "학교", teacherName: "김선생", title: "3학년 책장", teacherUid: TEACHER, createdAt: serverTimestamp() }));
await no("교사: 남의 uid 로 책장 만들기 차단", addDoc(collection(mine, "shelves"), { code: "SEO-2026-BBBB", school: "학교", teacherName: "김선생", title: "책장", teacherUid: OTHER, createdAt: serverTimestamp() }));

/* 다른 선생님 */
await no("다른 교사: 남의 책장 대기 목록 차단", getDocs(collection(others, "shelves", SHELF, "books")));
await no("다른 교사: 남의 모둠원 이름 차단", getDoc(doc(others, "shelves", SHELF, "private", "pending1")));
await no("다른 교사: 남의 책 승인 차단", updateDoc(doc(others, "shelves", SHELF, "books", "pending1"), { status: "hidden" }));
await no("다른 교사: 남의 책장 삭제 차단", deleteDoc(doc(others, "shelves", SHELF)));

/* 사용 승인 */
const newShelf = (code) => ({ code, school: "학교", teacherName: "김선생", title: "책장", createdAt: serverTimestamp() });
await no("승인 안 된 계정: 책장 만들기 차단", addDoc(collection(stranger, "shelves"), { ...newShelf("STR-2026-AAAA"), teacherUid: "new-uid" }));
await ok("승인된 선생님: 책장 만들기 허용", addDoc(collection(mine, "shelves"), { ...newShelf("SEO-2026-CCCC"), teacherUid: TEACHER }));
await ok("관리자: 책장 만들기 허용", addDoc(collection(admin, "shelves"), { ...newShelf("ADM-2026-DDDD"), teacherUid: "admin-uid" }));
await ok("선생님: 자기 승인 문서 읽기", getDoc(doc(mine, "allowed", TEACHER_MAIL)));
await no("선생님: 남의 승인 문서 읽기 차단", getDoc(doc(mine, "allowed", ADMIN_MAIL)));
await no("선생님: 승인 명단 전체 조회 차단", getDocs(collection(mine, "allowed")));
await no("선생님: 스스로 승인 명단에 추가 차단", setDoc(doc(mine, "allowed", STRANGER_MAIL), { email: STRANGER_MAIL, school: "", note: "", addedBy: "x", addedAt: serverTimestamp() }));
await no("승인 안 된 계정: 스스로 승인 추가 차단", setDoc(doc(stranger, "allowed", STRANGER_MAIL), { email: STRANGER_MAIL, school: "", note: "", addedBy: "x", addedAt: serverTimestamp() }));
await ok("관리자: 승인 명단 전체 조회", getDocs(collection(admin, "allowed")));
await ok("관리자: 선생님 승인 추가", setDoc(doc(admin, "allowed", "new@school.kr"), { email: "new@school.kr", school: "새학교", note: "", addedBy: ADMIN_MAIL, addedAt: serverTimestamp() }));
await ok("관리자: 승인 취소", deleteDoc(doc(admin, "allowed", "new@school.kr")));
await no("관리자: 관리자 명단 추가 차단 (콘솔에서만)", setDoc(doc(admin, "admins", "another@example.com"), { email: "another@example.com" }));
await no("선생님: 관리자 명단 조회 차단", getDocs(collection(mine, "admins")));

/* 관리자 권한 범위 */
await ok("관리자: 남의 책장 이름 바꾸기", updateDoc(doc(admin, "shelves", SHELF), { title: "관리자가 정리한 책장" }));
await no("관리자: 책장 주인 바꾸기 차단", updateDoc(doc(admin, "shelves", SHELF), { teacherUid: "admin-uid" }));
await no("관리자: 모둠원 이름 읽기 차단", getDoc(doc(admin, "shelves", SHELF, "private", "pending1")));
await ok("관리자: 남의 책 숨기기", updateDoc(doc(admin, "shelves", SHELF, "books", "pending1"), { status: "hidden" }));

/* 책장 이름 바꾸기·삭제 */
await ok("선생님: 자기 책장 이름 바꾸기", updateDoc(doc(mine, "shelves", SHELF), { school: "서울◇◇중학교", title: "2학년 책장" }));
await no("선생님: 엉뚱한 항목 추가 차단", updateDoc(doc(mine, "shelves", SHELF), { secret: "x" }));
await no("다른 선생님: 남의 책장 이름 바꾸기 차단", updateDoc(doc(others, "shelves", SHELF), { title: "가로채기" }));
await ok("선생님: 자기 책장 삭제", deleteDoc(doc(mine, "shelves", SHELF)));

/* Storage */
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const big = new Uint8Array(2 * 1024 * 1024 + 10);
const anonS = env.unauthenticatedContext().storage();
const mineS = env.authenticatedContext(TEACHER).storage();
await ok("학생: 표지 이미지 올리기", uploadBytes(ref(anonS, `covers/${SHELF}/a.png`), png, { contentType: "image/png" }));
await no("학생: 2 MB 넘는 이미지 차단", uploadBytes(ref(anonS, `covers/${SHELF}/big.png`), big, { contentType: "image/png" }));
await no("학생: 이미지가 아닌 파일 차단", uploadBytes(ref(anonS, `covers/${SHELF}/a.pdf`), png, { contentType: "application/pdf" }));
await no("학생: 다른 경로에 올리기 차단", uploadBytes(ref(anonS, `secret/${SHELF}/a.png`), png, { contentType: "image/png" }));
await ok("누구나: 표지 이미지 보기", getBytes(ref(anonS, `covers/${SHELF}/a.png`)));
await no("비로그인: 표지 이미지 삭제 차단", deleteObject(ref(anonS, `covers/${SHELF}/a.png`)));
await ok("교사: 표지 이미지 삭제", deleteObject(ref(mineS, `covers/${SHELF}/a.png`)));

await env.cleanup();
console.log("\n=== 보안 규칙 점검 (에뮬레이터) ===");
results.forEach(([okk, n]) => console.log(`${okk ? "✓" : "✗"} ${n}`));
const pass = results.filter((r) => r[0]).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
