/* Firebase 웹 설정 값
 *
 * 여기 들어가는 값은 "공개용 키"입니다. 브라우저에 그대로 내려가는 값이라 숨길 수 없고,
 * 숨길 필요도 없습니다. 실제 보호는 저장소 규칙(firestore.rules, storage.rules)이 합니다.
 *
 * 채우는 곳: Firebase 콘솔 → 프로젝트 설정(톱니바퀴) → 내 앱 → 웹 앱 → "SDK 설정 및 구성" → 구성
 * 그 화면의 값을 아래 따옴표 안에 그대로 옮겨 적으면 됩니다.
 *
 * 값이 비어 있으면 모든 화면이 "미리보기(데모)" 모드로 동작합니다.
 * 데모 모드에서는 이 브라우저에만 저장되고, 다른 사람에게는 보이지 않습니다.
 */
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};
