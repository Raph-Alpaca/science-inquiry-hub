/* 배포 주소 설정
 *
 * 학생용 사이트와 교사용 사이트를 따로 두었을 때(예: Netlify 두 사이트)만 채웁니다.
 * 선생님 화면의 "주소 복사"와 QR 이 여기 적은 주소로 학생 링크를 만듭니다.
 *
 * studentLink: 학생에게 알려 줄 책장 주소의 모양. {code} 자리에 책장 코드가 들어갑니다.
 *   예) "https://sci-shelf.netlify.app/c/{code}"
 *   비워 두면 지금 열려 있는 사이트의 shelf.html?code=코드 를 씁니다. (GitHub Pages 처럼 한 주소로 쓸 때)
 *   /c/{code} 모양은 Netlify 에서만 동작합니다. (deploy/netlify-redirects.mjs 가 만드는 짧은 주소)
 */
export const SITE = {
  studentLink: "https://sci-shelf.netlify.app/c/{code}",
};
