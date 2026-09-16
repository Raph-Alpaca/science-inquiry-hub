/* Firebase 웹 설정 값
 *
 * 여기 들어가는 값은 "공개용 키"입니다. 브라우저에 그대로 내려가는 값이라 숨길 수 없고,
 * 숨길 필요도 없습니다. 실제 보호는 저장소 규칙(firestore.rules)이 합니다.
 *
 * 값을 바꿀 곳: Firebase 콘솔 → 프로젝트 설정(톱니바퀴) → 내 앱 → 웹 앱 → "SDK 설정 및 구성" → 구성
 * 값이 비어 있으면 모든 화면이 "미리보기(데모)" 모드로 열립니다.
 * 주소 끝에 ?demo=1 을 붙이면 설정이 있어도 미리보기로 열 수 있습니다. (수업 시연용)
 */
export const firebaseConfig = {
  apiKey: "AIzaSyAsN6P9_w-ocX0WzfVdXjkHgnabL3z-V7U",
  authDomain: "science-inquiry-hub.firebaseapp.com",
  projectId: "science-inquiry-hub",
  storageBucket: "science-inquiry-hub.firebasestorage.app",
  messagingSenderId: "847443394176",
  appId: "1:847443394176:web:8a942d145df6166958b065",
};

/* 켜고 끌 수 있는 기능
 *
 * coverUpload: 학생이 표지 캡처 이미지를 올리는 기능입니다.
 *   Firebase Storage 를 써야 하므로 지금은 꺼 두었습니다.
 *   나중에 Storage 를 시작하고 storage.rules 를 올린 뒤 true 로 바꾸면 바로 켜집니다.
 */
export const FEATURES = {
  coverUpload: false,
};
