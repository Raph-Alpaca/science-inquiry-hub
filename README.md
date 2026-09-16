# 과학탐구 앱 허브 (science-inquiry-hub)

중학교 1~3학년(2022 개정 교육과정) 과학 단원별 탐구 시뮬레이션 9개와,
전국 교사가 학교별로 학생 산출물을 모으는 **산출물 책장**을 함께 담은 정적 웹앱입니다.

「2026 첨단과학기술 기반 과학탐구」 수업 1차시(교사 제작 웹앱 체험)에서 시연하고,
2차시 이후 학생들이 자기 앱을 설계할 때 참고 사례로 씁니다.

빌드 과정 없이 GitHub Pages나 Netlify에서 바로 동작합니다. 백엔드는 Firebase 하나만 씁니다.

**배포 주소: https://raph-alpaca.github.io/science-inquiry-hub/**

## 구성

```
index.html                  허브(메인) — 학년별 카드 9개 + 산출물 책장 입구
shelf.html                  공개 책장 (?code=책장코드)
submit.html                 학생 제출 폼 (?code=책장코드)
teacher.html                선생님 화면 (구글 로그인, 승인, QR, CSV, 학생 화면 보기)
shelf/teacher.json          모든 학교에 공통으로 보이는 "선생님 예시" 9권
assets/hub.css, hub.js      탐구 앱 9개의 공통 틀
assets/shelf.css            책장·제출·교사 화면 공통 스타일 (크림·나무 테마)
assets/shelf-data.js        Firebase 데이터 계층 + 미리보기(데모) 모드
assets/firebase-config.js   Firebase 웹 설정 (여기에 값을 채웁니다)
assets/site-config.js       학생용 사이트 주소 (Netlify 로 두 사이트를 쓸 때만 채움)
assets/code-entry.js        학생 화면의 책장 코드 입력 칸
assets/qr.js                QR 코드 생성기 (외부 라이브러리 없음)
assets/covers/*.svg         표지 일러스트 12종
apps/*.html                 탐구 시뮬레이션 9개 (중1·중2·중3)
firestore.rules             Firestore 보안 규칙
storage.rules               Storage 보안 규칙
firebase.json               규칙 배포·에뮬레이터 설정
netlify.toml, deploy/       Netlify 배포 설정 (사이트별 첫 화면과 짧은 주소)
docs/teacher-guide.md       선생님께 나눠 줄 한 쪽짜리 안내
docs/manual.html            운영 설명서 (수업 절차·문제 해결·고칠 파일 위치)
reference/                  무선 센서 연결 참고 코드 (이번 작업에서 건드리지 않음)
```

## 문서

- 선생님께 나눠 줄 안내: [docs/teacher-guide.md](docs/teacher-guide.md)
- 운영 설명서: https://raph-alpaca.github.io/science-inquiry-hub/docs/manual.html

## 산출물 책장

### 흐름

0. 관리자가 선생님 화면에서 그 선생님의 구글 계정을 **사용 승인** (승인된 계정만 책장을 만들 수 있음)
1. 선생님이 `teacher.html` 에서 구글 로그인 → 학교 책장 생성 → `SEO-2026-4K7Q` 같은 코드 발급
2. 학생은 로그인 없이 `shelf.html?code=…` 로 들어오거나 첫 화면에서 코드를 넣고, `submit.html` 에서 제출 (상태: 대기)
3. 선생님이 승인하면 공개 책장에 꽂힘
4. 학생 앱은 이 저장소에 올리지 않습니다. 제미나이·캔바·러버블 등의 **공유 링크만** 받습니다

### 개인정보

- 모둠원 이름은 `shelves/{id}/private/{bookId}` 에만 저장하고, 공개 화면 코드에서는 읽지 않습니다.
- 보안 규칙에서도 `private` 은 책장 주인 교사만 읽습니다. **관리자도 읽지 못합니다.**
- 공개 책장에는 학년·반·모둠명만 나옵니다.
- 관리자 이메일은 코드에 넣지 않고 Firestore `admins` 문서로 정합니다.

### Firestore 구조

```
admins/{이메일}                      관리자. Firebase 콘솔에서 직접 만든다
allowed/{이메일}                     관리자가 승인한 선생님. 관리자 화면에서 추가·삭제
  email, school, note, addedBy, addedAt
shelves/{shelfId}
  code, school, teacherName, title, teacherUid, createdAt, classes[]
shelves/{shelfId}/books/{bookId}
  grade, classNo, team, title, url, intent, howto, concepts[],
  coverKind, coverColor, coverPath, status(pending|approved|hidden),
  example, code, createdAt
shelves/{shelfId}/private/{bookId}
  memberNames, code, createdAt        ← 공개 화면에서 읽지 않음
```

Storage: `covers/{shelfId}/…` (2 MB 이하 이미지, 공개 읽기)

색인(index)을 따로 만들 필요는 없습니다. 목록은 `status` 조건만 걸고 정렬은 브라우저에서 합니다.

## Firebase 연결하기

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 프로젝트를 만듭니다.
2. **빌드 → Firestore Database → 데이터베이스 만들기** (프로덕션 모드, 위치 `asia-northeast3`).
3. (선택) 표지 캡처 업로드를 쓸 때만 **빌드 → Storage → 시작하기**. 지금은 쓰지 않습니다.
4. **빌드 → Authentication → Sign-in method → Google** 사용 설정.
5. **Authentication → Settings → 승인된 도메인**에 `raph-alpaca.github.io` 추가.
6. **프로젝트 설정 → 내 앱 → 웹 앱 추가** 후 나오는 `firebaseConfig` 값을
   `assets/firebase-config.js` 에 옮겨 적습니다. (공개되는 값입니다. 보호는 규칙이 합니다.)
7. **Firestore → 컬렉션 시작 → `admins`** 에 관리자 이메일(소문자)을 **문서 ID**로 하는 문서를
   하나 만듭니다. 필드는 `email`(문자열) 하나면 됩니다. 이 문서가 있는 계정이 관리자입니다.
8. 규칙을 올립니다.

```bash
npx firebase login
npx firebase deploy --only firestore:rules
```

`.firebaserc` 에 프로젝트가 고정되어 있어 `--project` 는 생략해도 됩니다.
Storage 를 켠 경우에만 `--only firestore:rules,storage` 로 함께 올립니다.

설정이 비어 있으면 모든 화면이 **미리보기(데모)** 로 열립니다. 주소에 `?demo=1` 을 붙여도 같습니다.
데모 모드는 그 브라우저에만 저장되고 다른 사람에게는 보이지 않습니다.

## 규칙 시험 (에뮬레이터)

Java 17 이상이 필요합니다.

```bash
npx firebase emulators:exec --project demo-sih --only firestore,storage "node rules-test.mjs"
```

승인 전 책 비공개, 모둠원 이름 차단, 틀린 코드 제출 차단, 남의 책장 수정 차단 등 40가지를 확인합니다.

## 탐구 앱의 뼈대

`apps/` 의 HTML 파일은 모두 아래 뼈대를 따릅니다.

```html
<link rel="stylesheet" href="../assets/hub.css">
<section class="lab">
  <div class="stage"> … 캔버스/모형 … </div>
  <aside class="controls"> … 슬라이더·버튼 … </aside>
</section>
<script src="../assets/hub.js"></script>
<script>
window.APP = { id, grade, unit, title, question, how, notes:[…], prompt, next, sensor };
SIH.shell();          // 상단 바·탐구 기록·프롬프트 보기 생성
// SIH.dpr / SIH.px / SIH.drawChart / SIH.bind / SIH.label / SIH.tabs / SIH.reduced
// window "sih:resize" 이벤트 → 창 크기가 바뀌면 다시 그리기
</script>
```

## 실시간 센서 연결 (다음 단계)

각 탐구 앱의 데이터 소스 선택에 `sensor` 옵션이 비활성 상태로 들어 있습니다.
`reference/` 의 무선 센서 실험실(Web Bluetooth / Web Serial) 코드를 공통 모듈로 옮긴 뒤,
앱별로 시뮬레이션 계산 함수 대신 센서 값을 넣는 방식으로 연결할 계획입니다.

## 배포

### GitHub Pages

GitHub 저장소 → Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)`.

### Netlify (학생용·교사용 주소를 따로 둘 때)

저장소 하나를 Netlify 사이트 **두 개**에 연결합니다. 두 사이트는 파일이 같고 첫 화면만 다릅니다.
GitHub 에 push 하면 두 사이트가 함께 다시 배포됩니다. 빌드 도구는 없습니다.

| 사이트 | 환경 변수 `SITE_ROLE` | 첫 화면 `/` |
|---|---|---|
| 학생용 (예: `sci-shelf.netlify.app`) | `student` | 공개 책장 |
| 교사용 (예: `sci-teacher.netlify.app`) | `teacher` | 선생님 화면 |

1. Netlify → **Add new site → Import an existing project → GitHub** → 이 저장소.
   Build command 와 Publish directory 는 `netlify.toml` 이 정하므로 그대로 둡니다.
2. **Site configuration → Environment variables** 에 `SITE_ROLE` = `student` 를 넣고 **Deploys → Trigger deploy**.
3. 같은 방법으로 사이트를 하나 더 만들고 `SITE_ROLE` = `teacher`.
4. Firebase 콘솔 → **Authentication → Settings → 승인된 도메인**에 교사용 사이트 주소를 추가합니다.
   학생용 사이트는 로그인이 없어 넣지 않아도 됩니다.
5. `assets/site-config.js` 의 `studentLink` 에 `"https://학생용주소/c/{code}"` 를 적고 push 합니다.
   선생님 화면의 **주소 복사**와 **QR** 이 이 짧은 주소로 바뀝니다.

Netlify 에서만 생기는 짧은 주소: `/shelf` `/teacher` `/submit` `/hub`,
`/c/책장코드` → 공개 책장, `/s/책장코드` → 제출 폼. (`deploy/netlify-redirects.mjs` 가 만듭니다)

## 주의

시뮬레이션 값은 교과서 수준의 단순화된 모형(뉴턴 냉각, 보일 법칙, 포화 수증기량 근사식 등)으로
계산한 것이며 실제 측정값과 다를 수 있습니다.
