/* 학생 활동지 — 5차시 문항 데이터
 *
 * 화면을 그리는 틀(assets/worksheet.js)은 이 파일만 읽습니다. 문항이 바뀌면 이 파일만 고치면 됩니다.
 * 지금 내용은 연구원 두 분의 활동지 사이트에 공통으로 들어 있던 문항을 합친 초안입니다.
 *
 * 차시(lesson) 하나의 모양
 *   { n, step, short, title, goal, blocks[] }        field:true 이면 활동지 없는 현장 활동
 *
 * blocks[] 에 넣을 수 있는 것
 *   { type:"meta" }                                   모둠·이름·날짜 (모둠·이름은 모든 차시가 같이 씀)
 *   { type:"section", title, intro?, items[] }        문항 묶음
 *   { type:"repeat", count, title:"리뷰 {i}", items[] }  같은 문항 묶음을 count 번. key 와 글에 {i} 를 쓸 수 있음
 *   { type:"note", text }                             안내문
 *   { type:"link", label, href, desc?, prefill? }     단추. href 의 {code} 는 책장 코드로 바뀜.
 *                                                     prefill:{team,title,url} 은 제출 폼의 초안에 미리 채울 답의 key
 *
 * items[] (모두 key 가 있어야 저장됨. key 는 차시 안에서 겹치지 않게)
 *   { key, type:"short", label, placeholder?, hint? }             한 줄
 *   { key, type:"url",   label, placeholder? }                    한 줄 (주소)
 *   { key, type:"long",  label, rows?, placeholder?, hint?, copy? }  여러 줄. copy:true 면 복사 단추와 글자 수
 *   { key, type:"check", label, options?, memo? }                 3단 고르기(잘 돼요·조금 아쉬워요·안 돼요). memo:true 면 메모 칸
 *   { key, type:"choice", label, options[], other? }              하나 고르기. other:true 면 "기타" 적는 칸
 *   { key, type:"multi",  label, options[] }                      여러 개 고르기
 *   { type:"note", text }                                         문항 사이 안내문
 */

export const STEPS = [
  { n: 1, step: "기획", short: "선생님 교과서 언박싱" },
  { n: 2, step: "집필", short: "첫 프롬프트 Talk Log" },
  { n: 3, step: "편집과 교정", short: "오류 찾아 바로잡기" },
  { n: 4, step: "출간", short: "발표·피드백 현장 활동", field: true },
  { n: 5, step: "BOOK FAIR", short: "친구 교과서 피어 리뷰" },
];

const CHECK3 = ["잘 돼요", "조금 아쉬워요", "안 돼요"];

export const LESSONS = [
  /* ---------- 1차시 ---------- */
  {
    n: 1, step: "기획",
    title: "선생님의 디지털 과학 교과서 언박싱",
    goal: "선생님이 만든 예시 교과서(웹앱) 가운데 가장 재미있는 3권을 골라 직접 조작해 보고, 조작·결과·통제 변인을 찾아 우리 교과서를 구상해요.",
    blocks: [
      { type: "meta" },
      { type: "link", label: "📚 선생님 예시 책 보러 가기", href: "shelf.html?code={code}", desc: "책장 맨 윗줄이 선생님 예시예요. 책을 펼쳐 시뮬레이션을 직접 조작해 보세요." },
      {
        type: "repeat", count: 3, title: "책 {i} 펼치기",
        items: [
          { key: "n1.b{i}.title", type: "short", label: "[책 펼치기] 내가 {i}번째로 고른 책 제목은 무엇인가요?", placeholder: "예) 이슬점·구름 실험실" },
          { key: "n1.b{i}.topic", type: "long", rows: 2, label: "[생각 열기] 이 책은 어떤 과학 주제를 다루고 있나요?", placeholder: "예) 빛이 물을 만나면 꺾여요 🔦" },
          { type: "note", text: "[수행하기] 선생님의 의도를 따라 책에 담긴 콘텐츠를 하나하나 꼼꼼히 조작해 봅시다." },
          { key: "n1.b{i}.iv", type: "long", rows: 2, label: "[조작] 내가 직접 올려 보고 내려 보고! 직접 조작한 것은 무엇인가요?", placeholder: "내가 바꿔 본 조건을 적어요 🎚️" },
          { key: "n1.b{i}.dv", type: "long", rows: 2, label: "[결과] 조건을 바꿔 보았을 때, 그림이나 그래프 또는 값이 어떻게 달라졌나요?", placeholder: "달라진 모습을 본 그대로! 👀" },
          { key: "n1.b{i}.cv", type: "long", rows: 2, label: "[통제] 시뮬레이션이 수행될 때 고정되어 있는, 변하지 않는 변인은 무엇이었나요?", placeholder: "끝까지 그대로였던 조건은? 🔒" },
          { key: "n1.b{i}.principle", type: "long", rows: 2, label: "[원리 발견] 이 책에서 알게 된 핵심 과학 원리는 무엇인가요?" },
          { key: "n1.b{i}.idea", type: "long", rows: 2, label: "[생각 더하기] 업그레이드 아이디어! 추가하면 좋을 기능은 무엇인가요?", placeholder: "이런 기능이 있으면 더 재밌겠다! 💡" },
        ],
      },
      {
        type: "section", title: "나의 디지털 과학 교과서 구상",
        items: [
          { key: "n1.plan.topic", type: "long", rows: 2, label: "나의 디지털 과학 교과서로 친구들에게 소개하고 싶은 주제는 무엇인가요?", placeholder: "예) 소리의 크기와 진동수의 관계 🎵" },
          { type: "note", text: "나만의 교과서에 꼭 넣고 싶은 기능 4가지를 하나씩 적어요." },
          { key: "n1.plan.f1", type: "short", label: "꼭 넣고 싶은 기능 — 첫 번째", placeholder: "예) 경사각을 바꾸는 슬라이더" },
          { key: "n1.plan.f2", type: "short", label: "두 번째" },
          { key: "n1.plan.f3", type: "short", label: "세 번째" },
          { key: "n1.plan.f4", type: "short", label: "네 번째" },
        ],
      },
    ],
  },

  /* ---------- 2차시 ---------- */
  {
    n: 2, step: "집필",
    title: "Talk Log로 그리는 탐구의 여정 — 원리를 담은 첫 프롬프트",
    goal: "우리 모둠이 만들 디지털 과학 교과서의 기획서를 쓰고, 조작·관찰·통제 조건을 담은 첫 프롬프트를 완성해요.",
    blocks: [
      { type: "meta" },
      {
        type: "section", title: "나의 디지털 과학 교과서 기획서",
        items: [
          { key: "n2.plan.question", type: "long", rows: 2, label: "[핵심 질문] 내가 다루고 싶은 과학적 질문은?", placeholder: "예) 빗면이 가파르면 더 빨라질까? 🤔" },
          { key: "n2.plan.name", type: "short", label: "[표지 만들기] 교과서(콘텐츠) 이름은?", placeholder: "예) 빗면 위의 레이서 🏁" },
          { key: "n2.plan.goal", type: "long", rows: 2, label: "[목표 설정] 구독자의 탐구 목표 정하기 — 이 교과서를 쓴 친구는 무엇을 알게 되나요?" },
          { key: "n2.plan.audience", type: "choice", label: "[구독자 분석] 내 책을 사용하는 구독자들은?", options: ["중학교 1학년", "중학교 2학년", "중학교 3학년"], other: true },
        ],
      },
      {
        type: "section", title: "핵심 기능 — 교과서 인터랙션 자세히 설계하기",
        items: [
          { key: "n2.plan.iv", type: "long", rows: 2, label: "[조작 조건] 독자가 슬라이더 등으로 직접 바꿀 값과 조작 범위", placeholder: "예) 경사각 0°~60°, 질량 1~5 kg" },
          { key: "n2.plan.dv", type: "long", rows: 2, label: "[관찰 결과] 화면에 실시간으로 표시될 수치·움직임·그래프·나타나는 현상", placeholder: "예) 속력 값, 위치–시간 그래프 📈" },
          { key: "n2.plan.cv", type: "long", rows: 2, label: "[통제 조건] 공정한 비교를 위해 고정해 둘 값", placeholder: "예) 질량 1 kg, 마찰 없음 🔒" },
        ],
      },
      {
        type: "section", title: "AI 상호 피어 리뷰",
        intro: "기획서를 친구와 바꿔 읽고, AI에게도 물어보며 다듬어요.",
        items: [
          { key: "n2.peer.fromFriends", type: "long", rows: 3, label: "친구가 내 기획서에 해 준 말", placeholder: "친구가 해 준 말을 그대로 적어요 💬" },
          { key: "n2.peer.toFriend", type: "long", rows: 3, label: "내가 친구 기획서에 해 준 말", placeholder: "좋은 점 + 아이디어를 따뜻하게 🌷" },
        ],
      },
      {
        type: "section", title: "우리 모둠의 선택",
        items: [
          { key: "n2.team.topic", type: "short", label: "모둠이 고른 주제", placeholder: "예) 빗면에서 물체의 운동" },
          { key: "n2.team.feat", type: "long", rows: 2, label: "모둠이 고른 핵심 기능", placeholder: "예) 경사각 슬라이더, 속력 그래프 🛠️" },
        ],
      },
      {
        type: "section", title: "프롬프트 완성",
        intro: "조작 조건·관찰 결과·통제 조건이 모두 들어가게 써요. 복사해서 AI에게 그대로 붙여 넣을 수 있어요.",
        items: [
          { key: "n2.prompt", type: "long", rows: 6, copy: true, label: "Talk Log #0 · 우리 교과서를 만드는 첫 프롬프트" },
        ],
      },
    ],
  },

  /* ---------- 3차시 ---------- */
  {
    n: 3, step: "편집과 교정",
    title: "Talk Log로 바로잡는 오류 — 원리와 변인으로 해결하기",
    goal: "AI가 만든 우리 교과서를 실행해 과학 원리와 변인을 점검하고, 오류 수정·기능 보완 프롬프트를 써요.",
    blocks: [
      { type: "meta" },
      {
        type: "section", title: "과학적 원리와 변인 점검하기",
        items: [
          { key: "n3.v1", type: "check", memo: true, label: "[조작 검증] 독자가 조작할 버튼이나 슬라이더가 의도한 수치 범위와 단위대로 잘 작동하나요?", options: CHECK3 },
          { key: "n3.v2", type: "check", memo: true, label: "[통제 검증] 한 조건을 바꿀 때 고정되어 있어야 할 다른 조건이 멋대로 변하지 않나요?", options: CHECK3 },
          { key: "n3.v3", type: "check", memo: true, label: "[측정 검증] 조건 변화에 따른 결과(움직임·실시간 수치·그래프)가 뚜렷하게 관찰되나요?", options: CHECK3 },
          { key: "n3.v4", type: "check", memo: true, label: "[원리 검증] 시뮬레이션의 움직임이 실제 교과서의 과학 법칙·공식과 일치하나요?", options: CHECK3 },
          { key: "n3.talk1", type: "long", rows: 5, copy: true, label: "🔧 Talk Log #1 · 과학적 오류 수정 프롬프트", hint: "AI에게 그대로 붙여 넣을 수 있어요" },
        ],
      },
      {
        type: "section", title: "독자를 위한 기능 추가·보완하기",
        items: [
          { key: "n3.f1", type: "check", memo: true, label: "[시각화 보완] 결과를 쉽게 이해할 수 있도록 눈금선이나 색상 구분이 되어 있나요?", options: CHECK3 },
          { key: "n3.f2", type: "check", memo: true, label: "[편의성 보완] 처음 상태로 되돌려 다시 실험할 수 있는 '리셋 버튼'이 작동하나요?", options: CHECK3 },
          { key: "n3.f3", type: "check", memo: true, label: "[데이터 비교] 이전 조건의 결과와 현재 결과를 한눈에 비교할 수 있나요?", options: CHECK3 },
          { key: "n3.talk2", type: "long", rows: 5, copy: true, label: "🚀 Talk Log #2 · 사용 편의 개선 프롬프트", hint: "AI에게 그대로 붙여 넣을 수 있어요" },
        ],
      },
      {
        type: "section", title: "우리 모둠이 출간하는 디지털 과학 교과서",
        items: [
          { key: "n3.url", type: "url", label: "📖 [교과서 펼쳐보기] 완성한 교과서(웹앱)의 공유 주소", placeholder: "https:// (제미나이·캔바·러버블 공유 링크)" },
        ],
      },
      { type: "link", label: "📚 과학 책장에 제출하러 가기", href: "submit.html?code={code}", desc: "링크를 확인했다면 책장에 우리 교과서를 꽂아 출간해요. 제목·주소·모둠명은 미리 채워 드려요.", prefill: { team: "meta.team", title: "n2.plan.name", url: "n3.url" } },
    ],
  },

  /* ---------- 4차시 ---------- */
  {
    n: 4, step: "출간", field: true,
    title: "출간 — 발표·피드백 현장 활동",
    goal: "완성된 교과서를 출판사(교실)에 의뢰해요. 모둠별로 발표하고, 개발자 회의 방식으로 서로 피드백을 주고받아요.",
    blocks: [
      { type: "note", text: "4차시는 현장 활동이라 활동지가 없어요. 3차시에서 제출한 교과서가 책장에 꽂혔는지 확인하고, 발표를 준비해요." },
      { type: "link", label: "📚 우리 반 책장 열기", href: "shelf.html?code={code}", desc: "선생님이 승인한 교과서부터 책장에 꽂혀요." },
    ],
  },

  /* ---------- 5차시 ---------- */
  {
    n: 5, step: "BOOK FAIR",
    title: "친구들의 교과서 둘러보기 — 피어 리뷰",
    goal: "책장에 꽂힌 친구들의 교과서를 3권 골라 직접 조작해 보고, 기능과 알게 된 점을 기록하며 칭찬해요.",
    blocks: [
      { type: "meta" },
      { type: "link", label: "📚 우리 반 책장 열기", href: "shelf.html?code={code}", desc: "친구들의 교과서를 하나씩 둘러보며 기록하세요. 책 3권을 둘러보면 완성!" },
      {
        type: "repeat", count: 3, title: "리뷰 {i}",
        items: [
          { key: "n5.r{i}.title", type: "short", label: "내가 고른 책 제목", placeholder: "친구 책의 제목을 적어요 📘" },
          { key: "n5.r{i}.topic", type: "long", rows: 2, label: "책의 주제는 무엇인가요?", placeholder: "어떤 과학 이야기를 담았나요? 🔬" },
          { key: "n5.r{i}.solve", type: "long", rows: 2, label: "책에 담긴 콘텐츠를 꼼꼼히 살펴보고, 관련된 질문들을 해결해 보세요.", placeholder: "책 속 질문에 도전! 내가 찾은 답은… ✍️" },
          { key: "n5.r{i}.feat", type: "long", rows: 2, label: "살펴본 콘텐츠에 담긴 기능들을 적어 봅시다. (변인 통제 포함)", placeholder: "조작·결과·통제 변인을 찾아봐요 🎛️" },
          { key: "n5.r{i}.learn", type: "long", rows: 2, label: "콘텐츠를 통해 알게 된 내용을 정리해 봅시다.", placeholder: "새롭게 알게 된 점을 차곡차곡 🌱" },
          { key: "n5.r{i}.praise", type: "long", rows: 2, label: "친구들의 결과물을 칭찬해 봅시다.", placeholder: "👍 칭찬은 배가 되어 돌아옵니다!" },
        ],
      },
      { type: "link", label: "📚 아직 못 올렸다면 — 우리 모둠 산출물 책장에 올리기", href: "submit.html?code={code}", desc: "제목·주소·모둠명은 미리 채워 드려요.", prefill: { team: "meta.team", title: "n2.plan.name", url: "n3.url" } },
      { type: "note", text: "5차시 활동지 끝 · 우리 반이 만든 디지털 과학 교과서, 완간을 축하합니다 🎉" },
    ],
  },
];
