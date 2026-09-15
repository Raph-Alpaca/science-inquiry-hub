# 과학탐구 앱 허브 (science-inquiry-hub)

중학교 1~3학년(2022 개정 교육과정) 과학 단원별 탐구 시뮬레이션 9개를 한 곳에 모은 정적 웹앱입니다.
「2026 첨단과학기술 기반 과학탐구」 수업 1차시(교사 제작 웹앱 체험)에서 시연하고, 2차시 이후 학생들이 자기 앱을 설계할 때 참고 사례로 씁니다.

빌드 과정 없이 GitHub Pages에서 바로 동작합니다.

**배포 주소: https://raph-alpaca.github.io/science-inquiry-hub/**

## 구성

```
index.html                  허브(메인) — 학년별 카드 9개
assets/hub.css              공통 스타일 (학년 색, 기록장, 휴대폰·교실 스크린 대응)
assets/hub.js               공통 틀과 도우미
apps/g1-insulation.html     중1 열 — 단열 재료 비교 (비교·기록)
apps/g1-heating.html        중1 물질의 상태 변화 — 가열 곡선 실험실 (조작·모형)
apps/g1-sound.html          중1 빛과 파동 — 소리 파형 관찰기 (파형)
apps/g2-gas.html            중2 기체의 성질 — 기체 압력 탐구실 (예측–측정)
apps/g2-photosynthesis.html 중2 식물과 에너지 — 광합성 CO₂ 측정소 (기울기 측정)
apps/g2-solar.html          중2 태양계 — 달의 위상·행성 공전 관찰기 (시간 스크러빙)
apps/g3-energy.html         중3 운동과 에너지 — 에너지 전환 시뮬레이터 (에너지 막대)
apps/g3-dewpoint.html       중3 날씨와 기후변화 — 이슬점·습도 예측기 (예측–확인)
apps/g3-equation.html       중3 화학 반응의 규칙성 — 화학 반응식 조립기 (계수 맞추기)
reference/                  무선 센서 연결 참고 코드 (이지메이커·PASCO·사이언스큐브·Vernier). 아직 연결하지 않음
```

## 모든 앱의 공통 틀

- 상단: 학년·단원, **데이터 소스 선택**(지금은 시뮬레이션만 활성. 실시간 센서 항목은 자리만 있음)
- 탐구 질문과 사용법
- 앱 본문(`.lab`): 왼쪽 무대(그래프·모형), 오른쪽 조작판. 좁은 화면에서는 위아래로 쌓임
- **탐구 기록**: 예측 → 관찰 → 설명 세 칸. 브라우저에 저장하거나 텍스트로 내려받기
- **이 앱은 어떤 프롬프트로 만들었을까?**: 2차시 프롬프트 설계의 참고 예시 + 다음 차시로 가져갈 질문

## 앱의 뼈대

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
// SIH.dpr(canvas, w, h)      → 고해상도 ctx (표시 크기에 맞춰 선명하게)
// SIH.px(ctx, 13, "bold")    → 화면 크기에 맞춘 캔버스 글꼴
// SIH.drawChart(ctx, {...})  → 선 그래프 (범례·표시점·색 띠)
// SIH.bind("sliderId", fn, " 단위") → 슬라이더 값 표시
// SIH.label(btn, "running")  → 시작/일시정지/계속/완료 버튼 문구 통일
// SIH.tabs([...])            → 탭 전환
// SIH.reduced                → 동작 줄이기 설정 여부
// window "sih:resize" 이벤트 → 창 크기가 바뀌면 다시 그리기
</script>
```

## 실시간 센서 연결 (다음 단계)

각 앱의 데이터 소스 선택에 `sensor` 옵션이 비활성 상태로 들어 있습니다.
`reference/` 의 무선 센서 실험실(Web Bluetooth / Web Serial) 코드를 공통 모듈로 옮긴 뒤,
앱별로 시뮬레이션 계산 함수 대신 센서 값을 넣는 방식으로 연결할 계획입니다.

## 배포

GitHub 저장소 → Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)`.
주소: https://raph-alpaca.github.io/science-inquiry-hub/

## 주의

시뮬레이션 값은 교과서 수준의 단순화된 모형(뉴턴 냉각, 보일 법칙, 포화 수증기량 근사식 등)으로 계산한 것이며 실제 측정값과 다를 수 있습니다.
