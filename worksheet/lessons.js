/* 학생 활동지 — 5차시 문항 데이터
 *
 * 화면을 그리는 틀(assets/worksheet.js)은 이 파일만 읽습니다. 문항이 바뀌면 이 파일만 고치면 됩니다.
 * 내용과 배치는 '활동지 version2' (8쪽) 를 따릅니다. 1차시 1쪽 · 2차시 2~3쪽 · 3차시 4~6쪽 · 4차시 7쪽 · 5차시 8쪽
 *
 * 차시(lesson) 하나의 모양
 *   { n, step, title, blocks[] }        field:true 이면 입력 칸 없이 안내만 있는 차시
 *
 * blocks[] 에 넣을 수 있는 것
 *   { type:"meta" }                                   공동작가 필명·이름·날짜 (필명·이름은 모든 차시가 같이 씀)
 *   { type:"part", label }                            큰 구분 띠 (개별 작성 / 모둠별 작성)
 *   { type:"section", title, intro?, items[] }        문항 묶음 (테두리 상자)
 *                                                     cols:2 면 items 의 { type:"break" } 에서 단을 나눔. grid:2 면 두 칸씩 나란히
 *                                                     plain:true 면 문항 번호를 붙이지 않음
 *   { type:"repeat", count, title, items[] }          같은 문항 묶음을 count 번. key 와 글에 {i}(1) {ord}(1st) {nth}(첫 번째) 를 쓸 수 있음
 *                                                     cols:3 은 나란히 놓을 칸 수, pick:true 는 'My 1st pick' 이름표
 *                                                     nameKey 를 주면 title 의 {name} 자리가 이름 적는 칸이 됨
 *                                                     need:2 면 진행률은 앞의 2묶음만 셈
 *   { type:"row", blocks:[a, b], arrow? }             두 묶음을 나란히. arrow:true 면 사이에 화살표
 *   { type:"flow" }                                   아래로 이어지는 화살표
 *   { type:"guide", title, cols?, steps[], note? }    그림 안내. steps: { text, img?, name?, wide? }  wide:true 면 한 줄을 다 써서 크게
 *                                                     img 는 worksheet/img/ 안의 파일 이름(확장자 빼고). 파일이 있으면 그림이, 없으면 "name 이미지 추가하세요" 가 보임
 *   { type:"note", text }                             안내문
 *   { type:"link", label, href, desc?, prefill? }     단추. href 의 {code} 는 책장 코드로 바뀜.
 *                                                     prefill:{team,title,url} 은 출판 의뢰서의 초안에 미리 채울 답의 key
 *   { type:"link", label, view:"journey", desc? }     '나의 여정' 을 여는 단추
 *
 * items[] (key 가 있어야 저장됨. key 는 활동지 전체에서 겹치지 않게)
 *   { key, type:"short", label, placeholder?, hint? }             한 줄
 *   { key, type:"url",   label, placeholder? }                    한 줄 (주소)
 *   { key, type:"long",  label, rows?, placeholder?, hint?, copy? }  여러 줄. copy:true 면 복사 단추와 글자 수
 *   { key, type:"choice", label, options[], other? }              하나 고르기. other:true 면 "기타" 적는 칸
 *   { key, type:"multi",  label?, options[], list? }              여러 개 고르기. list:true 면 한 줄에 하나씩
 *   { key, type:"check", label, options?, memo? }                 3단 고르기(잘 돼요·조금 아쉬워요·안 돼요)
 *   { key, type:"say", side:"l"|"r", placeholder? }               이름 + 말풍선 (이름은 key.name 에 저장)
 *   { type:"group", label, hint?, items[] }                       한 문항 아래 1) 2) 3) 으로 묶인 작은 문항들
 *   { type:"criteria", lines[] }                                  점검 기준 목록 (입력 없음)
 *   { type:"note", text, no? }                                    문항 사이 안내문. no:true 면 문항 번호를 받음
 *   공통: no:false 번호 없음 · optional:true 진행률에서 뺌
 *         journey:true 또는 journey:"짧은 이름" 이면 '나의 여정' 에 모아 보여 줌
 */

export const STEPS = [
  { n: 1, step: "기획", short: "선생님 과학책 언박싱" },
  { n: 2, step: "집필", short: "원리를 담은 첫 프롬프트" },
  { n: 3, step: "편집과 교정", short: "원리와 변인으로 오류 해결" },
  { n: 4, step: "출간", short: "출판 의뢰·우리 책 소개", field: true, fieldLabel: "출판 의뢰" },
  { n: 5, step: "북 페어", short: "친구 책 리뷰 남기기" },
];

/* 나의 여정: 1~3차시에서 journey 표시가 붙은 문항만 모아 보여 주는 화면 */
export const JOURNEY = {
  label: "나의 여정",
  short: "Talk Log 돌아보기",
  title: "Talk Log로 돌아보는 나의 여정",
  intro: "1~3차시에 쓴 것 가운데 생각이 자라난 흐름이 보이는 부분만 모았어요. 출판 의뢰서를 쓸 때 참고해요.",
};

const GRADES = ["중학교 1학년", "중학교 2학년", "중학교 3학년"];
const SUBMIT_PREFILL = { team: "meta.team", title: "n2.plan.name", url: "n3.url" };

export const LESSONS = [
  /* ---------- 1차시 (1쪽) ---------- */
  {
    n: 1, step: "기획",
    title: "선생님의 디지털 과학책 언박싱_책장에서 3권 pick!하기",
    blocks: [
      { type: "meta" },
      { type: "link", label: "📚 선생님 예시 책 보러 가기", href: "shelf.html?code={code}", desc: "책장 맨 윗줄이 선생님 예시예요. 가장 재미있는 3권을 골라 직접 조작해 보세요." },
      {
        type: "repeat", count: 3, cols: 3, pick: true, title: "My {ord} pick",
        items: [
          { key: "n1.b{i}.title", type: "short", label: "[책 펼치기] 내가 {nth}로 고른 책 제목은 무엇인가요?", journey: "고른 책" },
          { key: "n1.b{i}.topic", type: "long", rows: 2, label: "[생각 열기] 이 책에 관련된 과학 개념은 무엇인가요?" },
          { type: "note", no: true, text: "[수행 하기] 선생님의 의도를 따라 책에 담긴 콘텐츠를 하나하나 꼼꼼히 살펴봅시다." },
          {
            type: "group", label: "[분석 하기]",
            items: [
              { key: "n1.b{i}.iv", type: "long", rows: 2, label: "[조작] 내가 직접 올려 보고 내려 보고! 직접 조작한 것은 무엇인가요?", journey: "조작한 것" },
              { key: "n1.b{i}.dv", type: "long", rows: 2, label: "[결과] 조작하여 조건을 바꿔 보았을 때, 그림이나 그래프 또는 값이 어떻게 달라졌나요?", journey: "달라진 결과" },
              { key: "n1.b{i}.cv", type: "long", rows: 2, label: "[통제] 시뮬레이션이 수행될 때 변하지 않는 변인(같게 해야 하는 조건)은 무엇인가요?", journey: "같게 한 조건" },
            ],
          },
          { key: "n1.b{i}.principle", type: "long", rows: 7, label: "[원리 발견] 이 책에서 알게 된 핵심 과학 원리는 무엇인가요?", placeholder: "그림이나 글, 그래프 등 다양한 방법으로 표현해 보세요!" },
          { key: "n1.b{i}.idea", type: "long", rows: 3, label: "[생각 더하기] 업그레이드 아이디어! 어떤 기능을 추가하면 좋을까요?", journey: "업그레이드 아이디어" },
        ],
      },
    ],
  },

  /* ---------- 2차시 (2~3쪽) ---------- */
  {
    n: 2, step: "집필",
    title: "Talk Log로 그리는 탐구의 여정! 원리를 담은 첫 프롬프트!",
    blocks: [
      { type: "meta" },
      { type: "part", label: "개별 작성" },
      {
        type: "section", title: "나의 디지털 과학책 기획서", cols: 2,
        items: [
          { key: "n2.plan.question", type: "long", rows: 2, label: "[핵심 내용] 내가 다루고 싶은 과학적 질문은?", journey: "핵심 내용" },
          { key: "n2.plan.name", type: "short", label: "[표지 만들기] 책(콘텐츠) 이름은?", journey: "책 이름" },
          { key: "n2.plan.goal", type: "long", rows: 4, label: "[목표 설정] 독자의 탐구 목표 설정하기!", journey: "목표 설정",
            placeholder: "내가 디지털 과학책에서 구현하고자 하는 것은 무엇인가요?\n[어떤 조건]을 바꾸었을 때, [어떤 결과]가 나타났고, 그래서 독자들에게 과학적 원리를 확인하게 하여 알리고 싶은가요?" },
          { type: "break" },
          { key: "n2.plan.audience", type: "choice", label: "[사용자 분석] 내 책을 사용하는 대상은?", options: GRADES, other: true },
          {
            type: "group", label: "[핵심 기능] 디지털 과학책 속 기능 자세히 설계하기",
            items: [
              { key: "n2.plan.iv", type: "long", rows: 2, no: false, label: "다르게 하는 조건", placeholder: "독자가 슬라이더 등으로 직접 바꿀 값과 조작 범위", journey: "다르게 하는 조건" },
              { key: "n2.plan.dv", type: "long", rows: 2, no: false, label: "관찰 결과", placeholder: "화면에 실시간으로 표시될 수치, 움직임, 그래프, 나타나는 현상 등", journey: "관찰 결과" },
              { key: "n2.plan.cv", type: "long", rows: 2, no: false, label: "같게 해야 할 조건", placeholder: "공정한 비교를 위해 변하지 않도록 하는 기본 환경", journey: "같게 해야 할 조건" },
            ],
          },
        ],
      },
      { type: "part", label: "모둠별 작성" },
      {
        type: "repeat", count: 4, cols: 4, need: 2, title: "[ {name} ]의 IDEA에 대한 의견", nameKey: "n2.idea{i}.name",
        items: [
          { key: "n2.idea{i}.good", type: "long", rows: 4, label: "좋은 점" },
          { key: "n2.idea{i}.fix", type: "long", rows: 4, label: "개선할 점" },
        ],
      },
      {
        type: "row", arrow: true,
        blocks: [
          {
            type: "section", title: "Talk Log로 결정한 우리 모둠의 선택", grid: 2,
            items: [
              { key: "n2.team.role", type: "long", rows: 3, label: "역할(Role)", hint: "AI에게 어떤 역할과 전문성을 맡길까요?", placeholder: "너는 OO 분야의 최고의 전문가야.", journey: "역할(Role)" },
              { key: "n2.team.topic", type: "long", rows: 3, label: "주제(Topic)", hint: "어떤 주제와 내용을 다룰까요?", placeholder: "핵심 개념 · 내용 범위 · 핵심 내용", journey: "주제(Topic)" },
              {
                type: "group", label: "대상(Target)", hint: "대상과 난이도는 어떻게 설정할까요?",
                items: [
                  { key: "n2.team.target", type: "choice", no: false, label: "대상", options: GRADES, other: true, journey: "대상(Target)" },
                  { key: "n2.team.level", type: "choice", no: false, label: "난이도", options: ["기초", "보통", "심화"], journey: "난이도" },
                ],
              },
              { key: "n2.team.feat", type: "long", rows: 3, label: "기능(Features)", hint: "반드시 포함되어야 할 기능은 무엇인가요?", placeholder: "필수 기능 · 변인 통제", journey: "기능(Features)" },
            ],
          },
          {
            type: "section", title: "Talk Log로 완성한 우리 모둠의 [프롬프트]", plain: true,
            items: [
              { key: "n2.prompt", type: "long", rows: 9, copy: true, label: "역할·주제·대상·기능이 모두 들어가게 써요. 복사해서 AI에게 그대로 붙여 넣을 수 있어요.", journey: "우리 모둠의 프롬프트" },
              {
                key: "n2.promptCheck", type: "multi", list: true, optional: true,
                options: ["[역할] 역할이 명확한가요?", "[대상] 사용 대상의 수준을 설정하였나요?", "[주제] 주제가 구체적인가요?", "[기능] 필수 기능이 포함되어 있나요?"],
              },
            ],
          },
        ],
      },
      {
        type: "guide", title: "프롬프트 입력하기", cols: 2,
        steps: [
          { text: "제미나이 접속, + 버튼 클릭하여 Canvas 기능 켜기", img: "n2-1", name: "제미나이 Canvas 켜기" },
          { text: "모델 설정, 입력 창에 프롬프트 입력 및 제출", img: "n2-2", name: "프롬프트 입력·제출" },
        ],
      },
    ],
  },

  /* ---------- 3차시 (4~6쪽) ---------- */
  {
    n: 3, step: "편집과 교정",
    title: "Talk Log로 바로잡는 오류_원리와 변인으로 해결하기!",
    blocks: [
      { type: "meta" },
      {
        type: "row",
        blocks: [
          {
            type: "section", title: "[결과물 확인] 과학적 원리와 변인 점검하기", plain: true,
            items: [
              { type: "criteria", lines: [
                "[조작 검증] 조작할 버튼이나 슬라이더가 의도대로 잘 작동하나요?",
                "[통제 검증] 한 조건을 바꿀 때 고정되어 있어야 할 다른 조건이 변하지 않나요?",
                "[측정 검증] 조건 변화에 따른 결과(움직임, 실시간 수치, 그래프)가 정확히 관찰되나요?",
                "[원리 검증] 시뮬레이션의 움직임이 실제 교과서의 내용과 일치하나요?",
              ] },
              { key: "n3.sci.m1", type: "say", side: "l", placeholder: "검토하며 발견한 내용을 기록해요." },
              { key: "n3.sci.m2", type: "say", side: "r", optional: true },
              { key: "n3.sci.m3", type: "say", side: "l", optional: true },
              { key: "n3.sci.m4", type: "say", side: "r", optional: true },
              { key: "n3.talk1", type: "long", rows: 6, copy: true, label: "[Talk Log 수정] 과학적 오류 수정을 위한 추가 프롬프트", journey: "Talk Log 수정 (과학적 오류 수정)" },
            ],
          },
          {
            type: "section", title: "[결과물 확인] 독자를 위한 기능 추가 및 보완하기", plain: true,
            items: [
              { type: "criteria", lines: [
                "[시각화 보완] 결과를 쉽게 이해할 수 있도록 시각적으로 잘 구성되어 있나요?",
                "[편의성 보완] 처음 상태로 되돌려 다시 실험할 수 있는 '리셋 버튼'이 작동하나요?",
                "[데이터 비교] 이전 조건의 결과와 현재 결과를 한눈에 비교할 수 있나요?",
              ] },
              { key: "n3.ux.m1", type: "say", side: "l", placeholder: "검토하며 발견한 내용을 기록해요." },
              { key: "n3.ux.m2", type: "say", side: "r", optional: true },
              { key: "n3.ux.m3", type: "say", side: "l", optional: true },
              { key: "n3.ux.m4", type: "say", side: "r", optional: true },
              { key: "n3.talk2", type: "long", rows: 6, copy: true, label: "[Talk Log 고도화] 사용 편의 개선을 위한 추가 프롬프트", journey: "Talk Log 고도화 (사용 편의 개선)" },
            ],
          },
        ],
      },
      {
        type: "guide", title: "수정 프롬프트 입력하기",
        steps: [{ text: "수정 프롬프트 입력", img: "n3-1", name: "수정 프롬프트 입력" }],
        note: "시뮬레이션이 생성된 채팅방에 추가 프롬프트를 계속 입력하며 수정과 확인을 반복해요.\n더 이상 수정이나 보완할 사항이 없으면, 추가 프롬프트 입력을 멈춥니다.",
      },
      {
        type: "guide", title: "완성한 콘텐츠의 공유용 링크 생성하기", cols: 2,
        steps: [
          { text: "공유 클릭", img: "n3-2", name: "공유 단추" },
          { text: "공유 클릭", img: "n3-3", name: "공유 메뉴" },
          { text: "링크 복사", img: "n3-4", name: "링크 복사", wide: true },
        ],
      },
      { type: "flow" },
      {
        type: "section", title: "우리 모둠이 출간하는 디지털 과학책", plain: true, narrow: true,
        items: [
          { key: "n3.url", type: "url", label: "[미리보기] 공유용 링크 생성하기", placeholder: "https:// (복사한 공유 링크를 붙여 넣어요)", journey: "완성한 책의 공유 링크" },
        ],
      },
    ],
  },

  /* ---------- 4차시 (7쪽) ---------- */
  {
    n: 4, step: "출간", field: true,
    title: "출간 및 디지털 책장에 꽂고 우리 책 소개하기!",
    blocks: [
      { type: "note", text: "완성한 우리 책을 책장에 꽂을 차례예요. 모둠 친구들과 함께 출판 의뢰서를 써서 보내면, 선생님이 확인한 뒤 책장에 꽂아 줍니다." },
      {
        type: "guide", title: "출판 의뢰하는 방법", cols: 2,
        steps: [
          { text: "책장에서 '출판 의뢰하기' 클릭!", img: "n4-1", name: "책장의 출판 의뢰하기 단추", wide: true },
          { text: "모둠 친구들과 함께 출판 의뢰서 작성", img: "n4-2", name: "출판 의뢰서" },
          { text: "책 표지의 그림과 색을 고르고 출판 의뢰", img: "n4-3", name: "책 표지 고르기" },
        ],
      },
      { type: "link", label: "🧭 나의 여정 펼쳐 보기", view: "journey", desc: "1~3차시에 쓴 Talk Log를 한눈에 모아 봐요. 출판 의뢰서의 '개발자의 의도'와 '사용 방법'을 쓸 때 참고해요." },
      { type: "link", label: "📮 출판 의뢰하기", href: "submit.html?code={code}", desc: "책 제목·링크·공동작가 필명은 활동지에 쓴 대로 미리 채워 드려요.", prefill: SUBMIT_PREFILL },
      { type: "link", label: "📚 우리 반 책장 열기", href: "shelf.html?code={code}", desc: "선생님이 승인하면 책장에 꽂혀요. 책장에 꽂힌 우리 책을 친구들에게 소개해요." },
    ],
  },

  /* ---------- 5차시 (8쪽) ---------- */
  {
    n: 5, step: "북 페어",
    title: "친구들이 출간한 책 둘러보기_리뷰 남기기!",
    blocks: [
      { type: "meta" },
      { type: "link", label: "📚 우리 반 책장 열기", href: "shelf.html?code={code}", desc: "책장에 꽂힌 친구들의 책 가운데 3권을 골라 직접 조작해 보고 리뷰를 남겨요." },
      {
        type: "repeat", count: 3, cols: 3, pick: true, title: "My {ord} pick",
        items: [
          { key: "n5.r{i}.title", type: "short", label: "책 제목" },
          { key: "n5.r{i}.topic", type: "long", rows: 2, label: "관련 과학 개념" },
          { type: "note", no: true, text: "콘텐츠를 꼼꼼히 살펴보기" },
          { key: "n5.r{i}.feat", type: "long", rows: 6, label: "콘텐츠 기능 톺아보기" },
          { key: "n5.r{i}.learn", type: "long", rows: 5, label: "알게 된 내용 정리하기" },
          { key: "n5.r{i}.praise", type: "long", rows: 5, label: "친구의 책 칭찬하기" },
        ],
      },
      { type: "link", label: "📮 아직 못 했다면 — 출판 의뢰하기", href: "submit.html?code={code}", desc: "책 제목·링크·공동작가 필명은 미리 채워 드려요.", prefill: SUBMIT_PREFILL },
      { type: "note", text: "5차시 활동지 끝 · 우리 반이 만든 디지털 과학책, 완간을 축하합니다 🎉" },
    ],
  },
];
