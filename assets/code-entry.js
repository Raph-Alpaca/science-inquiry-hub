/* 책장 코드 입력 칸 (학생 화면 공통: shelf.html, submit.html)
 *
 * 코드 없이 들어왔거나 없는 코드로 들어왔을 때, 학생이 코드를 직접 넣고 책장으로 갈 수 있게 한다.
 * 한 번 연 책장 코드는 이 기기에 기억해 두어 다음에 미리 채워 준다.
 */
const LAST = "sih-last-code";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function rememberCode(code) { try { localStorage.setItem(LAST, code); } catch (e) { /* 무시 */ } }
export function lastCode() { try { return localStorage.getItem(LAST) || ""; } catch (e) { return ""; } }
export function normalizeCode(v) { return String(v || "").toUpperCase().replace(/[^A-Z0-9-]/g, ""); }
/* 책장 코드를 표준 꼴(영문-연도 4자리-4글자, 예: SEO-2026-4K7Q)로 고친다.
 * '-' 를 빼거나 띄어 써도(SEO20264K7Q, seo 2026 4k7q) 같은 책장·같은 활동지로 모이게 한다.
 * 이 꼴이 아닌 코드는 대문자·앞뒤 공백 정리만 한다. */
export function canonCode(v) {
  const up = String(v || "").trim().toUpperCase();
  const m = up.replace(/[^A-Z0-9]/g, "").match(/^([A-Z]{2,6})(\d{4})([A-Z0-9]{4})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : up;
}
// 주소창의 code 가 표준 꼴과 다르면 표준 꼴로 바꿔 둔다 (새로고침·주소 공유 때 한 가지 주소만 남게)
export function fixCodeInUrl(code) {
  try {
    const p = new URLSearchParams(location.search);
    if (!p.has("code") || p.get("code") === code) return;
    p.set("code", code);
    history.replaceState(null, "", `${location.pathname}?${p}${location.hash}`);
  } catch (e) { /* 무시 */ }
}

/* page: "shelf" | "submit" | "worksheet"   wrong: 없는 코드로 들어와서 다시 넣게 할 때 */
export function codeEntryHtml({ value = "", wrong = false, page = "shelf" } = {}) {
  return `<form class="code-form" id="codeForm" data-page="${page}" novalidate>
    <label for="codeInput">책장 코드</label>
    <div class="row">
      <input type="text" id="codeInput" value="${esc(value)}" placeholder="예: SEO-2026-4K7Q" maxlength="24"
        autocomplete="off" autocapitalize="characters" spellcheck="false"${wrong ? ' aria-invalid="true" aria-describedby="codeErr"' : ""}>
      <button type="submit" class="btn primary">${{ submit: "출판 의뢰하러 가기", worksheet: "활동지 열기" }[page] || "책장 열기"}</button>
    </div>
    <p class="err" id="codeErr" role="alert"${wrong ? "" : " hidden"}>${wrong ? "이 코드로 된 책장이 없어요. 선생님께 다시 확인해 주세요." : ""}</p>
  </form>`;
}

export function bindCodeEntry(demo) {
  const f = document.getElementById("codeForm");
  if (!f) return;
  const inp = document.getElementById("codeInput"), err = document.getElementById("codeErr");
  f.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const c = normalizeCode(canonCode(inp.value));
    if (c.length < 4) {
      err.textContent = "선생님이 알려 준 책장 코드를 넣어 주세요."; err.hidden = false;
      inp.setAttribute("aria-invalid", "true"); inp.focus();
      return;
    }
    location.href = `${f.dataset.page}.html?code=${encodeURIComponent(c)}${demo ? "&demo=1" : ""}`;
  });
  inp.addEventListener("input", () => { err.hidden = true; inp.removeAttribute("aria-invalid"); });
  if (!matchMedia("(pointer: coarse)").matches) inp.focus();   // 휴대전화에서는 자판이 바로 튀어나오지 않게
}
