# 검사

사이트를 돌리는 데는 필요 없고, 고친 뒤 깨진 곳이 없는지 볼 때 씁니다.

```bash
cd tests
npm install
npm run install-browser     # 처음 한 번, Playwright 용 Chromium
npm test                    # 화면 검사 + 규칙 검사
```

| 명령 | 내용 |
|---|---|
| `npm run app` | 탐구 앱 10쪽을 1920·1280·380 에서 열고 콘솔 오류·가로 넘침·조작을 확인 (53항목) |
| `npm run shelf` | 책장·제출·선생님 화면을 데모 모드로 끝까지 돌려 봄 (107항목) |
| `npm run peek` | 선생님 화면의 "학생 화면 보기" 옆 패널 (39항목) |
| `npm run code` | 책장 코드 입력 칸 (22항목) |
| `npm run rules` | Firestore·Storage 보안 규칙을 에뮬레이터에서 검증 (61항목). Java 17 이상 필요 |

스크린샷은 `shots/` 에 남습니다. 모두 데모 모드와 에뮬레이터만 쓰므로 실제 데이터에는 손대지 않습니다.
