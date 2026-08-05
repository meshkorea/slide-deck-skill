#!/usr/bin/env node
// 슬라이드 덱(자립형 HTML)을 헤드리스 Chrome으로 1280×720 PNG로 렌더링한다.
// 덱 제작 후 "실제로 어떻게 보이는지"를 눈으로 확인하는 유일한 경로 — 코드만 읽지 말 것.
//
// 사용법:
//   node render.mjs <deck.html> [--out DIR] [--slide N] [--range A-B] [--wait MS]
//   node render.mjs slides/foo.html                 # 전 슬라이드 → OUT/slide-01.png ...
//   node render.mjs slides/foo.html --slide 3        # 3번 슬라이드만
//   node render.mjs slides/foo.html --range 6-9      # 6~9번만
//   node render.mjs slides/foo.html --out /tmp/shots # 출력 폴더 지정
//   node render.mjs slides/foo.html --wait 12000     # 폰트 로드 대기 직접 지정(ms)
//
// 기본 출력 폴더: <deck와 같은 폴더>/.render/
// Chrome 경로: 환경변수 CHROME 우선, 없으면 macOS 기본 → 탐색.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";

function findChrome() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("Chrome를 못 찾음 — CHROME 환경변수로 실행 파일 경로를 지정하세요.");
}

const args = process.argv.slice(2);
const deckArg = args.find((a) => !a.startsWith("--"));
if (!deckArg) {
  console.error("사용법: node render.mjs <deck.html> [--out DIR] [--slide N] [--range A-B]");
  process.exit(1);
}
const deck = resolve(deckArg);
if (!existsSync(deck)) {
  console.error(`덱 파일 없음: ${deck}`);
  process.exit(1);
}

function opt(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

// 슬라이드 수 = <section class="slide"> 개수.
// HTML 주석을 먼저 걷어내야 주석 처리한 슬라이드(예: 안 쓰는 마무리 변형)가 안 잡힌다 —
// 브라우저 DOM(querySelectorAll)은 주석을 무시하므로 카운트도 맞춰야 팬텀 슬라이드가 안 생긴다.
const html = readFileSync(deck, "utf8");
const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, "");
const total = (htmlNoComments.match(/<section[^>]*class="[^"]*\bslide\b/g) || []).length;
if (total === 0) {
  console.error("슬라이드(<section class=\"slide\">)를 못 찾음 — 덱 구조를 확인하세요.");
  process.exit(1);
}

let targets = [];
const slideN = opt("--slide");
const range = opt("--range");
if (slideN) {
  targets = [parseInt(slideN, 10)];
} else if (range) {
  const [a, b] = range.split("-").map((s) => parseInt(s, 10));
  for (let i = a; i <= b; i++) targets.push(i);
} else {
  for (let i = 1; i <= total; i++) targets.push(i);
}
targets = targets.filter((n) => n >= 1 && n <= total);

const outDir = resolve(opt("--out") || join(dirname(deck), ".render"));
// 전체 렌더일 때만 폴더를 청소 — 부분 렌더는 기존 것 보존
if (!slideN && !range && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const chrome = findChrome();
const pad = (n) => String(n).padStart(2, "0");
const written = [];

// 폰트 로드 대기(가상 시간). 코드 스니펫 장이 있으면 고정폭 웹폰트가 웨이트당 ~800KB라
// 기본 4초로는 글리프가 못 도착해 시스템 폰트로 폴백된 스크린샷이 나온다 — 자동으로 늘린다.
const hasCode = /<pre[^>]*class="[^"]*\bcode\b/.test(htmlNoComments);
const wait = parseInt(opt("--wait") || (hasCode ? "12000" : "4000"), 10);

for (const n of targets) {
  const out = join(outDir, `slide-${pad(n)}.png`);
  const url = `file://${deck}#${n}`;
  execFileSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--window-size=1280,720",
      `--virtual-time-budget=${wait}`, // 폰트 로드 + fit() 대기
      `--screenshot=${out}`,
      url,
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  if (existsSync(out)) written.push(out);
}

console.log(
  `덱: ${basename(deck)} · 슬라이드 ${total}장 · 렌더 ${written.length}장 · 폰트 대기 ${wait}ms${hasCode ? " (코드 장 있음)" : ""}`,
);
console.log(`출력: ${outDir}`);
for (const w of written) console.log(`  ${w}`);
