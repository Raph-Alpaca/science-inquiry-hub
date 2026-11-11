// Netlify 가 배포할 때 _redirects 파일을 만든다. (netlify.toml 의 build.command)
//
// 환경 변수 SITE_ROLE 에 따라 첫 화면(/)만 달라지고, 짧은 주소는 모든 사이트에 똑같이 생긴다.
//   /shelf      → shelf.html          /teacher → teacher.html
//   /submit     → submit.html         /hub     → index.html
//   /worksheet  → worksheet.html (학생 활동지)
//   /privacy    → privacy.html (개인정보 처리방침)
//   /c/책장코드  → shelf.html?code=책장코드   (QR·칠판용 짧은 주소)
//   /s/책장코드  → submit.html?code=책장코드
//   /w/책장코드  → worksheet.html?code=책장코드
// 예외: 학생용 사이트(SITE_ROLE=student)의 /teacher, /teacher.html 은 교사용 사이트로 넘긴다.
//
// 저장소에서 직접 실행해 볼 수도 있다:  node deploy/netlify-redirects.mjs
// 만들어진 _redirects 는 저장소에 넣지 않는다 (.gitignore).
import { readFileSync, writeFileSync } from "node:fs";

const role = (process.env.SITE_ROLE || "hub").trim().toLowerCase();
const home = { student: "/shelf.html", teacher: "/teacher.html" }[role];

// 교사용 사이트 주소는 assets/site-config.js 의 teacherLink 한 곳에서만 관리한다.
let teacherSite = "";
try {
  const m = readFileSync("assets/site-config.js", "utf8").match(/^\s*teacherLink:\s*"(https:\/\/[^"\s]+)"/m);
  if (m) teacherSite = m[1];
} catch (e) { /* 파일이 없으면 넘기지 않는다 */ }

// 학생용 사이트에서는 선생님 화면을 열지 않고 교사용 사이트로 넘긴다. (구글 로그인도 교사용 주소에서만 됨)
const teacherRules = role === "student" && teacherSite
  ? [`/teacher       ${teacherSite}   302!`, `/teacher.html  ${teacherSite}   302!`]
  : [`/teacher    /teacher.html   200!`];

const rules = [
  `# 자동 생성: deploy/netlify-redirects.mjs (SITE_ROLE=${role})`,
  ...(home ? [`/           ${home}   200!`] : []),
  `/shelf      /shelf.html     200!`,
  ...teacherRules,
  `/submit     /submit.html    200!`,
  `/hub        /index.html     200!`,
  `/worksheet  /worksheet.html 200!`,
  `/privacy    /privacy.html   200!`,
  `/c/:code    /shelf.html?code=:code    302`,
  `/s/:code    /submit.html?code=:code   302`,
  `/w/:code    /worksheet.html?code=:code   302`,
];

writeFileSync("_redirects", rules.join("\n") + "\n");
console.log(`_redirects 작성 완료 (SITE_ROLE=${role}, 첫 화면=${home || "/index.html"})`);
