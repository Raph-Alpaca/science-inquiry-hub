// Netlify 가 배포할 때 _redirects 파일을 만든다. (netlify.toml 의 build.command)
//
// 환경 변수 SITE_ROLE 에 따라 첫 화면(/)만 달라지고, 짧은 주소는 모든 사이트에 똑같이 생긴다.
//   /shelf      → shelf.html          /teacher → teacher.html
//   /submit     → submit.html         /hub     → index.html
//   /c/책장코드  → shelf.html?code=책장코드   (QR·칠판용 짧은 주소)
//   /s/책장코드  → submit.html?code=책장코드
//
// 저장소에서 직접 실행해 볼 수도 있다:  node deploy/netlify-redirects.mjs
// 만들어진 _redirects 는 저장소에 넣지 않는다 (.gitignore).
import { writeFileSync } from "node:fs";

const role = (process.env.SITE_ROLE || "hub").trim().toLowerCase();
const home = { student: "/shelf.html", teacher: "/teacher.html" }[role];

const rules = [
  `# 자동 생성: deploy/netlify-redirects.mjs (SITE_ROLE=${role})`,
  ...(home ? [`/           ${home}   200!`] : []),
  `/shelf      /shelf.html     200!`,
  `/teacher    /teacher.html   200!`,
  `/submit     /submit.html    200!`,
  `/hub        /index.html     200!`,
  `/c/:code    /shelf.html?code=:code    302`,
  `/s/:code    /submit.html?code=:code   302`,
];

writeFileSync("_redirects", rules.join("\n") + "\n");
console.log(`_redirects 작성 완료 (SITE_ROLE=${role}, 첫 화면=${home || "/index.html"})`);
