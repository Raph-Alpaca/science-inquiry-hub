/* qr.js — 의존성 없는 QR 코드 생성기 (science-inquiry-hub 공용)

   왜 직접 만들었나:
     책장/앱 링크를 종이에 붙이려면 QR이 필요한데, 이 프로젝트는 빌드 도구도
     npm 패키지도 쓰지 않는다(정적 HTML + ES 모듈만). 그래서 외부 라이브러리 없이
     브라우저에서 바로 도는 최소 구현을 둔다.

   규격 (ISO/IEC 18004):
     · 인코딩 모드 : 바이트 모드(0100), 입력 문자열은 UTF-8로 변환
     · 오류정정    : M 레벨 (약 15% 복원)
     · 버전        : 1~10 중 들어가는 가장 작은 것을 자동 선택
                     (10-M 바이트 용량 213바이트를 넘으면 한국어 오류를 던진다)
     · 마스크      : 8가지를 모두 만들어 벌점(N1=3, N2=3, N3=40, N4=10)이
                     가장 낮은 것을 고른다
     · 형식 정보   : BCH(15,5) + 0x5412 마스크
     · 버전 정보   : 버전 7 이상에서 BCH(18,6) 18비트 블록

   공개 API:
     qrMatrix(text)        → { size, modules }   modules[행][열] === true 면 검은 칸
     qrSvg(text, options)  → SVG 문자열
                             options = { size, margin, dark, light, title }

   사용 예:
     import { qrSvg } from "./assets/qr.js";
     box.innerHTML = qrSvg(location.href, { size: 180, title: "책장 링크" });
*/

// ────────────────────────────────────────────────────────────────────────────
// 1. 버전별 표 (버전 1~10, 오류정정 M 레벨)
// ────────────────────────────────────────────────────────────────────────────

/** 버전별 전체 코드워드 수(데이터 + 오류정정). 인덱스 0 = 버전 1. */
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/** M 레벨의 [블록 하나당 오류정정 코드워드 수, 블록 개수]. 인덱스 0 = 버전 1. */
const EC_BLOCKS_M = [
  [10, 1], [16, 1], [26, 1], [18, 2], [24, 2],
  [16, 4], [18, 4], [22, 4], [22, 5], [26, 5],
];

/** 정렬 패턴 중심 좌표(행=열 공통). 버전 1은 정렬 패턴이 없다. */
const ALIGNMENT_POSITIONS = [
  [],            // v1
  [6, 18],       // v2
  [6, 22],       // v3
  [6, 26],       // v4
  [6, 30],       // v5
  [6, 34],       // v6
  [6, 22, 38],   // v7
  [6, 24, 42],   // v8
  [6, 26, 46],   // v9
  [6, 28, 50],   // v10
];

/** 이 구현이 지원하는 가장 높은 버전. */
const MAX_VERSION = 10;

/** 벌점 가중치 (규격 표 11). */
const N1 = 3, N2 = 3, N3 = 40, N4 = 10;

// ────────────────────────────────────────────────────────────────────────────
// 2. GF(256) 갈루아 체 — 리드-솔로몬 오류정정의 바탕
//    원시 다항식 x^8 + x^4 + x^3 + x^2 + 1 (0x11D)
// ────────────────────────────────────────────────────────────────────────────

const GF_EXP = new Uint8Array(512); // α^i
const GF_LOG = new Uint8Array(256); // log_α(x)

(function buildGaloisTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // 8비트를 넘으면 원시 다항식으로 되접는다
  }
  // 지수를 더할 때 255로 나머지 연산을 하지 않아도 되도록 표를 두 바퀴 깔아 둔다
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

/** GF(256) 곱셈. 0을 곱하면 0. */
function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * 차수가 degree인 생성 다항식 (x - α^0)(x - α^1)…(x - α^(degree-1)).
 * 계수는 높은 차수부터 담는다. 항상 첫 계수는 1.
 */
function makeGeneratorPoly(degree) {
  let poly = [1];
  for (let d = 0; d < degree; d++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i++) {
      next[i] ^= poly[i];                        // × x^0
      next[i + 1] ^= gfMul(poly[i], GF_EXP[d]);  // × α^d
    }
    poly = next;
  }
  return poly;
}

/** 데이터 코드워드 블록 하나에 대한 오류정정 코드워드(= 다항식 나눗셈의 나머지). */
function makeEcCodewords(dataBlock, ecCount) {
  const gen = makeGeneratorPoly(ecCount);
  const work = new Uint8Array(dataBlock.length + ecCount);
  work.set(dataBlock, 0);

  for (let i = 0; i < dataBlock.length; i++) {
    const coef = work[i];
    if (coef === 0) continue;
    // gen[0]은 항상 1이므로 work[i]는 이 줄에서 0이 된다
    for (let j = 0; j < gen.length; j++) work[i + j] ^= gfMul(gen[j], coef);
  }
  return work.slice(dataBlock.length);
}

// ────────────────────────────────────────────────────────────────────────────
// 3. 용량 계산과 데이터 코드워드 만들기
// ────────────────────────────────────────────────────────────────────────────

/** 해당 버전(M 레벨)의 데이터 코드워드 수. */
function dataCodewordCount(version) {
  const [ecPerBlock, blocks] = EC_BLOCKS_M[version - 1];
  return TOTAL_CODEWORDS[version - 1] - ecPerBlock * blocks;
}

/** 바이트 모드의 문자 개수 지시자 비트 수. 버전 1~9는 8비트, 10 이상은 16비트. */
function charCountBits(version) {
  return version < 10 ? 8 : 16;
}

/** 해당 버전(M 레벨, 바이트 모드)에 담을 수 있는 최대 바이트 수. */
function byteCapacity(version) {
  const usable = dataCodewordCount(version) * 8 - 4 - charCountBits(version);
  return Math.floor(usable / 8);
}

/** 바이트 수를 담을 수 있는 가장 작은 버전. 없으면 0. */
function chooseVersion(byteLength) {
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (byteLength <= byteCapacity(v)) return v;
  }
  return 0;
}

/**
 * 모드 지시자 + 문자 개수 + 본문 + 종단 패턴 + 채움 코드워드까지 채운
 * 데이터 코드워드 배열을 만든다.
 */
function buildDataCodewords(bytes, version) {
  const total = dataCodewordCount(version);
  const out = new Uint8Array(total); // 0으로 초기화 → 종단 패턴/패딩 비트는 그냥 두면 된다
  let bitPos = 0;

  const put = (value, length) => {
    for (let i = length - 1; i >= 0; i--) {
      if ((value >>> i) & 1) out[bitPos >> 3] |= 0x80 >> (bitPos & 7);
      bitPos++;
    }
  };

  put(0b0100, 4);                       // 바이트 모드 지시자
  put(bytes.length, charCountBits(version)); // 문자(바이트) 개수
  for (let i = 0; i < bytes.length; i++) put(bytes[i], 8);

  // 종단 패턴 0000 (남는 자리가 4비트보다 적으면 그만큼만) → 바이트 경계까지 0으로 맞춤
  bitPos = Math.min(bitPos + 4, total * 8);
  bitPos = Math.ceil(bitPos / 8) * 8;

  // 남은 자리는 0xEC, 0x11을 번갈아 채운다
  for (let i = bitPos >> 3, k = 0; i < total; i++, k++) out[i] = k % 2 ? 0x11 : 0xec;

  return out;
}

/**
 * 데이터 코드워드를 블록으로 나눠 오류정정을 붙이고, 규격대로 교차 배치(interleave)한다.
 * 블록 구성은 "총 코드워드 수 % 블록 수" 개의 블록이 한 코드워드씩 더 갖는 방식.
 */
function interleaveCodewords(dataCodewords, version) {
  const [ecPerBlock, blockCount] = EC_BLOCKS_M[version - 1];
  const total = TOTAL_CODEWORDS[version - 1];
  const dataTotal = total - ecPerBlock * blockCount;

  const group2Blocks = total % blockCount;              // 한 칸 더 긴 블록의 개수
  const group1Blocks = blockCount - group2Blocks;
  const group1Size = Math.floor(dataTotal / blockCount);

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  let maxDataSize = 0;

  for (let b = 0; b < blockCount; b++) {
    const size = b < group1Blocks ? group1Size : group1Size + 1;
    const block = dataCodewords.slice(offset, offset + size);
    dataBlocks.push(block);
    ecBlocks.push(makeEcCodewords(block, ecPerBlock));
    offset += size;
    if (size > maxDataSize) maxDataSize = size;
  }

  const result = new Uint8Array(total);
  let idx = 0;
  // 데이터 코드워드: 블록을 가로질러 한 개씩 번갈아
  for (let i = 0; i < maxDataSize; i++) {
    for (let b = 0; b < blockCount; b++) {
      if (i < dataBlocks[b].length) result[idx++] = dataBlocks[b][i];
    }
  }
  // 오류정정 코드워드: 마찬가지로 번갈아
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < blockCount; b++) result[idx++] = ecBlocks[b][i];
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. 기능 패턴 배치
//    modules[i]  : 0/1 (검은 칸 = 1)
//    reserved[i] : 1이면 기능 패턴/형식·버전 정보 자리 → 마스크와 데이터에서 제외
// ────────────────────────────────────────────────────────────────────────────

function createGrid(version) {
  const size = version * 4 + 17;
  return {
    size,
    modules: new Uint8Array(size * size),
    reserved: new Uint8Array(size * size),
  };
}

function setModule(grid, row, col, dark, isFunction) {
  const i = row * grid.size + col;
  grid.modules[i] = dark ? 1 : 0;
  if (isFunction) grid.reserved[i] = 1;
}

const getModule = (grid, row, col) => grid.modules[row * grid.size + col];
const isReserved = (grid, row, col) => grid.reserved[row * grid.size + col] === 1;

/** 위치 검출 패턴(7×7) 3개와 그 둘레의 분리자. */
function placeFinderPatterns(grid) {
  const size = grid.size;
  const origins = [[0, 0], [0, size - 7], [size - 7, 0]];

  for (const [row, col] of origins) {
    // -1 ~ 7 범위를 훑으면서 분리자(흰 테두리)까지 한 번에 채운다
    for (let r = -1; r <= 7; r++) {
      if (row + r < 0 || row + r >= size) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c < 0 || col + c >= size) continue;
        const dark =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) || // 바깥 테두리 세로
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) || // 바깥 테두리 가로
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);       // 가운데 3×3
        setModule(grid, row + r, col + c, dark, true);
      }
    }
  }
}

/** 타이밍 패턴 — 6행과 6열에 검/흰이 번갈아 놓인 줄. */
function placeTimingPatterns(grid) {
  const size = grid.size;
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    setModule(grid, i, 6, dark, true);
    setModule(grid, 6, i, dark, true);
  }
}

/** 정렬 패턴(5×5). 위치 검출 패턴과 겹치는 세 모서리는 건너뛴다. 타이밍 패턴보다 나중에 찍는다. */
function placeAlignmentPatterns(grid, version) {
  const pos = ALIGNMENT_POSITIONS[version - 1];
  const last = pos.length - 1;

  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      const row = pos[i], col = pos[j];
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const dark = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
          setModule(grid, row + r, col + c, dark, true);
        }
      }
    }
  }
}

/** 형식 정보 15비트를 BCH(15,5)로 만들고 0x5412로 마스크한다. */
function formatInfoBits(maskPattern) {
  const G15 = 0b101_0011_0111; // x^10+x^8+x^5+x^4+x^2+x+1
  const data = (0b00 << 3) | maskPattern; // M 레벨의 지시자는 00
  // data를 10칸 왼쪽으로 민 값을 G15로 나눈 나머지를 구한다
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ ((rem >>> 9) * G15); // 최상위 비트가 서면 생성 다항식으로 지운다
  }
  return (((data << 10) | (rem & 0x3ff)) ^ 0b101_0100_0001_0010) & 0x7fff;
}

/**
 * 형식 정보를 두 벌 배치한다(왼쪽 위 모서리, 그리고 오른쪽 위 + 왼쪽 아래).
 * 비트 i는 최하위 비트부터 센다. 항상 검은 칸인 고정 모듈도 여기서 찍는다.
 */
function placeFormatInfo(grid, maskPattern) {
  const size = grid.size;
  const bits = formatInfoBits(maskPattern);

  for (let i = 0; i < 15; i++) {
    const dark = ((bits >> i) & 1) === 1;

    // 첫 번째 사본 — 8열 세로줄 + 8행 가로줄의 왼쪽/아래쪽
    if (i < 6) setModule(grid, i, 8, dark, true);
    else if (i < 8) setModule(grid, i + 1, 8, dark, true); // 6행은 타이밍 패턴이라 한 칸 건너뜀
    else setModule(grid, size - 15 + i, 8, dark, true);

    // 두 번째 사본
    if (i < 8) setModule(grid, 8, size - i - 1, dark, true);
    else if (i === 8) setModule(grid, 8, 7, dark, true);   // 여기도 6열을 건너뜀
    else setModule(grid, 8, 14 - i, dark, true);
  }

  // 고정 검은 모듈
  setModule(grid, size - 8, 8, true, true);
}

/** 버전 정보 18비트 = 버전 6비트 + BCH(18,6) 12비트. 버전 7 이상에서만 쓴다. */
function versionInfoBits(version) {
  const G18 = 0b1_1111_0010_0101; // x^12+x^11+x^10+x^9+x^8+x^5+x^2+1
  // 마찬가지로 version을 12칸 민 값의 G18 나머지
  let rem = version;
  for (let i = 0; i < 12; i++) {
    rem = (rem << 1) ^ ((rem >>> 11) * G18);
  }
  return ((version << 12) | (rem & 0xfff)) & 0x3ffff;
}

/** 버전 정보 블록(3×6) 두 개를 오른쪽 위와 왼쪽 아래에 배치한다. */
function placeVersionInfo(grid, version) {
  if (version < 7) return;
  const size = grid.size;
  const bits = versionInfoBits(version);

  for (let i = 0; i < 18; i++) {
    const dark = ((bits >> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = size - 11 + (i % 3);
    setModule(grid, a, b, dark, true); // 오른쪽 위
    setModule(grid, b, a, dark, true); // 왼쪽 아래 (전치)
  }
}

/**
 * 데이터 비트를 오른쪽 아래에서 시작해 두 열씩 지그재그로 채운다.
 * 6열(타이밍 패턴)은 건너뛴다. 남는 잔여 비트는 0(흰 칸) 그대로 둔다.
 */
function placeData(grid, codewords) {
  const size = grid.size;
  let bitIndex = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // 타이밍 패턴 열은 건너뛴다
    const upward = ((right + 1) & 2) === 0;

    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const row = upward ? size - 1 - vert : vert;
        if (isReserved(grid, row, col)) continue;

        let dark = false;
        if (bitIndex < codewords.length * 8) {
          dark = ((codewords[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1) === 1;
        }
        setModule(grid, row, col, dark, false);
        bitIndex++;
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 5. 마스크 8종과 벌점 계산
// ────────────────────────────────────────────────────────────────────────────

/** 마스크 조건식. true면 그 칸의 색을 뒤집는다. i = 행, j = 열. */
function maskAt(pattern, i, j) {
  switch (pattern) {
    case 0: return (i + j) % 2 === 0;
    case 1: return i % 2 === 0;
    case 2: return j % 3 === 0;
    case 3: return (i + j) % 3 === 0;
    case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    default: return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
  }
}

/** 기능 패턴이 아닌 칸에만 마스크를 XOR한다. 한 번 더 부르면 되돌아간다. */
function applyMask(grid, pattern) {
  const size = grid.size;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (isReserved(grid, row, col)) continue;
      if (maskAt(pattern, row, col)) grid.modules[row * size + col] ^= 1;
    }
  }
}

/** 벌점 1 — 같은 색이 가로/세로로 5칸 이상 이어지는 구간. */
function penaltyN1(grid) {
  const size = grid.size;
  let points = 0;

  for (let a = 0; a < size; a++) {
    let rowColor = -1, rowRun = 0;
    let colColor = -1, colRun = 0;
    for (let b = 0; b < size; b++) {
      const rowCell = getModule(grid, a, b);
      if (rowCell === rowColor) rowRun++;
      else {
        if (rowRun >= 5) points += N1 + (rowRun - 5);
        rowColor = rowCell;
        rowRun = 1;
      }

      const colCell = getModule(grid, b, a);
      if (colCell === colColor) colRun++;
      else {
        if (colRun >= 5) points += N1 + (colRun - 5);
        colColor = colCell;
        colRun = 1;
      }
    }
    if (rowRun >= 5) points += N1 + (rowRun - 5);
    if (colRun >= 5) points += N1 + (colRun - 5);
  }
  return points;
}

/** 벌점 2 — 같은 색 2×2 덩어리 하나당 N2점. */
function penaltyN2(grid) {
  const size = grid.size;
  let blocks = 0;
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const sum =
        getModule(grid, row, col) +
        getModule(grid, row, col + 1) +
        getModule(grid, row + 1, col) +
        getModule(grid, row + 1, col + 1);
      if (sum === 0 || sum === 4) blocks++;
    }
  }
  return blocks * N2;
}

/** 벌점 3 — 위치 검출 패턴과 헷갈리는 1:1:3:1:1 무늬(앞이나 뒤에 흰 4칸)가 있을 때. */
function penaltyN3(grid) {
  const size = grid.size;
  let found = 0;

  for (let a = 0; a < size; a++) {
    let rowBits = 0, colBits = 0;
    for (let b = 0; b < size; b++) {
      // 11비트짜리 창을 밀면서 10111010000 / 00001011101 을 찾는다
      rowBits = ((rowBits << 1) & 0x7ff) | getModule(grid, a, b);
      if (b >= 10 && (rowBits === 0x5d0 || rowBits === 0x05d)) found++;

      colBits = ((colBits << 1) & 0x7ff) | getModule(grid, b, a);
      if (b >= 10 && (colBits === 0x5d0 || colBits === 0x05d)) found++;
    }
  }
  return found * N3;
}

/* 벌점 4 — 검은 칸 비율이 50%에서 5%씩 벗어날 때마다 N4점.

   참고: 규격(ISO/IEC 18004)과 ZXing은 floor(|비율-50| / 5)로 센다. 여기서도 그렇게 한다.
   npm qrcode 패키지는 |ceil(비율/5) - 10| 을 쓰는데, 검은 칸이 50%를 넘을 때 값이 달라져서
   가끔 다른 마스크를 고른다. 어느 쪽을 고르든 마스크 번호는 형식 정보에 적히므로
   판독에는 아무 지장이 없다(대조 시험에서 약 3%가 이 이유로 다른 마스크를 골랐고,
   마스크를 맞춰 고정하면 3000건 모두 완전히 같았다). */
function penaltyN4(grid) {
  let dark = 0;
  for (let i = 0; i < grid.modules.length; i++) dark += grid.modules[i];
  const percent = (dark * 100) / grid.modules.length;
  const k = Math.floor(Math.abs(percent - 50) / 5);
  return k * N4;
}

const totalPenalty = (grid) => penaltyN1(grid) + penaltyN2(grid) + penaltyN3(grid) + penaltyN4(grid);

// ────────────────────────────────────────────────────────────────────────────
// 6. 공개 API
// ────────────────────────────────────────────────────────────────────────────

/**
 * 문자열을 QR 코드 모듈 배열로 만든다.
 * @param {string} text  담을 내용 (UTF-8 바이트 모드로 인코딩)
 * @returns {{ size: number, modules: boolean[][] }} true인 칸이 검은 칸
 */
export function qrMatrix(text) {
  const source = typeof text === "string" ? text : String(text ?? "");
  if (source.length === 0) {
    throw new Error("QR 코드로 만들 내용이 비어 있습니다.");
  }

  const bytes = new TextEncoder().encode(source);
  const version = chooseVersion(bytes.length);
  if (version === 0) {
    throw new Error(
      `QR 코드에 담기에 내용이 너무 깁니다. ` +
      `버전 10·오류정정 M 기준 최대 ${byteCapacity(MAX_VERSION)}바이트인데 ` +
      `${bytes.length}바이트입니다. 주소를 줄여 주세요.`
    );
  }

  const codewords = interleaveCodewords(buildDataCodewords(bytes, version), version);

  // 기능 패턴 → 형식/버전 정보 자리 확보 → 데이터 순서로 채운다
  const grid = createGrid(version);
  placeFinderPatterns(grid);
  placeTimingPatterns(grid);
  placeAlignmentPatterns(grid, version);
  placeFormatInfo(grid, 0); // 값은 뒤에서 덮어쓰고, 지금은 자리만 예약한다
  placeVersionInfo(grid, version);
  placeData(grid, codewords);

  // 마스크 8종을 씌워 보고 벌점이 가장 낮은 것을 고른다
  let bestMask = 0;
  let bestScore = Infinity;
  for (let pattern = 0; pattern < 8; pattern++) {
    placeFormatInfo(grid, pattern); // 벌점은 형식 정보까지 포함한 전체 심볼로 센다
    applyMask(grid, pattern);
    const score = totalPenalty(grid);
    applyMask(grid, pattern); // 원상 복구
    if (score < bestScore) {
      bestScore = score;
      bestMask = pattern;
    }
  }

  applyMask(grid, bestMask);
  placeFormatInfo(grid, bestMask);

  // 2차원 boolean 배열로 바꿔 돌려준다
  const size = grid.size;
  const modules = new Array(size);
  for (let row = 0; row < size; row++) {
    const line = new Array(size);
    for (let col = 0; col < size; col++) line[col] = grid.modules[row * size + col] === 1;
    modules[row] = line;
  }
  return { size, modules };
}

/** SVG 속성에 넣을 수 있게 XML 특수문자를 바꾼다. */
function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]
  ));
}

/**
 * 문자열을 QR 코드 SVG 문자열로 만든다.
 * 검은 칸은 <rect>를 칸마다 두지 않고, 가로로 이어지는 구간을 한 덩어리로 묶어
 * <path> 하나에 모은다(문서가 훨씬 가볍다).
 *
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.size=160]      완성된 <svg>의 가로·세로 픽셀
 * @param {number} [options.margin=4]      여백(조용한 구역)을 모듈 단위로
 * @param {string} [options.dark="#3A2A1D"]  검은 칸 색
 * @param {string} [options.light="#FFFFFF"] 바탕 색
 * @param {string} [options.title=""]      주면 <title>로 넣어 읽어 준다. 없으면 장식으로 처리
 * @returns {string} SVG 문자열
 */
export function qrSvg(text, options = {}) {
  const {
    size = 160,
    margin = 4,
    dark = "#3A2A1D",
    light = "#FFFFFF",
    title = "",
  } = options;

  const qr = qrMatrix(text);
  const span = qr.size + margin * 2; // viewBox 한 변의 길이(모듈 단위)

  let path = "";
  for (let row = 0; row < qr.size; row++) {
    const line = qr.modules[row];
    let col = 0;
    while (col < qr.size) {
      if (!line[col]) { col++; continue; }
      let run = 1;
      while (col + run < qr.size && line[col + run]) run++;
      // 가로로 이어진 검은 칸 한 줄 = 직사각형 하나
      path += `M${col + margin} ${row + margin}h${run}v1h-${run}z`;
      col += run;
    }
  }

  const label = title ? `<title>${xmlEscape(title)}</title>` : "";
  const a11y = title ? ' role="img"' : ' aria-hidden="true" focusable="false"';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"` +
    ` viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges"${a11y}>` +
    label +
    `<rect width="${span}" height="${span}" fill="${xmlEscape(light)}"/>` +
    `<path d="${path}" fill="${xmlEscape(dark)}"/>` +
    `</svg>`
  );
}
