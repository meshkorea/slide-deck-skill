#!/usr/bin/env node
// 덱(자립형 HTML)에서 발표자용 개요를 마크다운으로 뽑는다.
// 기획 md 없이 덱만 먼저 만든 경우, 발표 중 손에 들고 볼 참고 문서를 여기서 만든다.
// 덱 HTML이 유일한 원본이므로 개요는 항상 덱에서 되뽑는다 — 따로 손으로 관리하지 않는다.
//
// 사용법:
//   node outline.mjs <deck.html> [--out FILE] [--stdout] [--force]
//   node outline.mjs slides/foo.html            # → slides/foo-outline.md
//   node outline.mjs slides/foo.html --stdout    # 파일로 안 쓰고 표준출력으로
//   node outline.mjs slides/foo.html --force     # 이미 있는 개요 파일을 덮어씀
//
// 기본 출력: <덱과 같은 폴더>/<덱파일명>-outline.md
// 이미 파일이 있으면 --force 없이는 쓰지 않는다 — 손으로 덧붙인 발표 포인트를 지키기 위함.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const deckArg = args.find((a) => !a.startsWith("--"));
if (!deckArg) {
  console.error(
    "사용법: node outline.mjs <deck.html> [--out FILE] [--stdout] [--force]",
  );
  process.exit(1);
}
const deck = resolve(deckArg);
if (!existsSync(deck)) {
  console.error(`덱 파일 없음: ${deck}`);
  process.exit(1);
}
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const has = (name) => args.includes(name);

// ─────────────────────────────────────────────────────────────
// HTML 훑기 — 의존성 없이 쓰는 최소 스캐너.
// 덱은 우리가 만든 템플릿 구조(section > 알려진 클래스)라 완전한 파서가 필요 없다.
// ─────────────────────────────────────────────────────────────

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);
// 태그 속성 — 따옴표 안의 > 를 삼키게(스타일 문자열에 > 가 들어와도 안 깨지게)
const ATTRS = `(?:"[^"]*"|'[^']*'|[^>"'])*`;

/** 주어진 HTML의 **직속** 자식 엘리먼트를 순서대로 돌려준다. */
function children(html) {
  const out = [];
  const open = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)(${ATTRS})(/?)>`, "g");
  let m;
  while ((m = open.exec(html))) {
    const tag = m[1].toLowerCase();
    if (VOID.has(tag) || m[3] === "/") continue; // 자립 태그는 자식으로 안 셈
    const both = new RegExp(`<${tag}\\b${ATTRS}>|</${tag}\\s*>`, "gi");
    both.lastIndex = m.index;
    let depth = 0;
    let end = -1;
    let closeLen = 0;
    let t;
    while ((t = both.exec(html))) {
      if (t[0][1] === "/") {
        depth -= 1;
        if (depth === 0) {
          end = t.index;
          closeLen = t[0].length;
          break;
        }
      } else if (!/\/>$/.test(t[0])) {
        depth += 1;
      }
    }
    if (end < 0) continue; // 짝이 안 맞으면 건너뜀
    out.push({
      tag,
      attrs: m[2],
      inner: html.slice(m.index + m[0].length, end),
    });
    open.lastIndex = end + closeLen;
  }
  return out;
}

const hasClass = (attrs, name) =>
  new RegExp(`class="[^"]*\\b${name}\\b`).test(attrs || "");

const decode = (s) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

// <br> 자리표시자 — 원문 텍스트에 나올 수 없는 제어문자를 잠깐 끼워 줄을 가른다
const BR = "\u0001";

/** 태그를 걷어낸 텍스트. <b>·<em> 은 마크다운 굵게로 살리고 <br> 은 sep 으로 잇는다.
    (<i> 는 flow 의 연결자 → 나 사분면의 ①②③ 라 강조가 아니므로 그냥 텍스트로 둔다) */
function txt(html, sep = " ") {
  return decode(
    String(html)
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, "")
      .replace(/<br\s*\/?>/gi, BR)
      // 강조는 ** 로만 — _..._ 는 한글 어절 안(예: _한 줄_로)에서 마크다운이 안 닫는다
      .replace(/<\/?(?:b|strong|em)\b[^>]*>/gi, "**")
      .replace(/<[^>]+>/g, ""),
  )
    .split(BR)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(sep)
    // 강조 구분자 안쪽 공백은 마크다운에서 안 먹으니 밖으로 밀어낸다
    .replace(/(\*\*|_)(\s*)(.*?)(\s*)\1/g, (all, d, a, body, b) =>
      body ? `${a}${d}${body}${d}${b}` : `${a}${b}`,
    );
}

/** li 자기 텍스트만 — 중첩된 하위 목록은 뺀다. */
const ownText = (inner) =>
  txt(inner.replace(/<ul\b[\s\S]*<\/ul>/gi, "").replace(/<ol\b[\s\S]*<\/ol>/gi, ""));

/** pre.code 내부를 줄 단위로 — 각 줄에 걸린 클래스(hl/dim/add/del)까지 같이. */
function codeLines(inner) {
  const lines = [];
  let cur = { text: "", cls: new Set() };
  const stack = [];
  const re = new RegExp(
    `</span\\s*>|<span(${ATTRS})>|</?[a-zA-Z][^>]*>|[^<]+|<`,
    "g",
  );
  let m;
  while ((m = re.exec(inner))) {
    const tok = m[0];
    if (tok.startsWith("</span")) {
      stack.pop();
    } else if (tok.startsWith("<span")) {
      const cm = /class="([^"]*)"/.exec(m[1] || "");
      stack.push(cm ? cm[1].trim().split(/\s+/) : []);
    } else if (tok.startsWith("<")) {
      continue; // span 밖의 태그는 코드 텍스트가 아니니 건너뜀
    } else {
      const open = stack.flat();
      const parts = decode(tok).split("\n");
      parts.forEach((p, i) => {
        if (i > 0) {
          lines.push(cur);
          cur = { text: "", cls: new Set() };
        }
        open.forEach((c) => cur.cls.add(c));
        cur.text += p;
      });
    }
  }
  lines.push(cur);
  // 첫/끝 빈 줄은 pre 서식 때문에 생긴 것 — 떼어낸다
  while (lines.length && !lines[0].text.trim()) lines.shift();
  while (lines.length && !lines.at(-1).text.trim()) lines.pop();
  return lines;
}

const LANG = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", py: "python",
  go: "go", java: "java", kt: "kotlin", rb: "ruby", rs: "rust", php: "php",
  cs: "csharp", swift: "swift", sql: "sql", sh: "bash", bash: "bash",
  zsh: "bash", json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  css: "css", html: "html", proto: "proto", tf: "hcl", gradle: "groovy",
};
const langOf = (label) => {
  const ext = (label || "").split(".").pop()?.toLowerCase();
  return (ext && LANG[ext]) || "";
};

// ─────────────────────────────────────────────────────────────
// 장별 내용 뽑기
// ─────────────────────────────────────────────────────────────

/** 한 장의 본문 블록들을 마크다운 조각 배열로. label 은 바로 앞 .lbl 캡션. */
function blocks(html, ctx) {
  const out = [];
  let pendingLabel = null;

  const push = (s) => {
    if (s && s.trim()) out.push(s.trim());
  };

  for (const el of children(html)) {
    const { tag, attrs, inner } = el;
    if (tag === "svg" || tag === "script" || tag === "style") continue;

    // ── 메타 역할 — 본문 블록이 아니라 장 헤더/푸터로 따로 모은다
    if (hasClass(attrs, "ctx")) {
      ctx.label = txt(inner);
      continue;
    }
    if (tag === "h1" || hasClass(attrs, "title")) {
      ctx.title = txt(inner);
      continue;
    }
    if (hasClass(attrs, "take")) {
      ctx.take = txt(inner);
      continue;
    }
    if (hasClass(attrs, "fn")) {
      ctx.fn = txt(inner, " / ");
      continue;
    }
    if (hasClass(attrs, "lbl")) {
      pendingLabel = txt(inner);
      continue;
    }

    // ── 코드 블록
    if (tag === "pre" && hasClass(attrs, "code")) {
      const lines = codeLines(inner);
      const lang = langOf(pendingLabel);
      if (pendingLabel) push(`파일 — \`${pendingLabel}\``);
      pendingLabel = null;
      push(
        "```" + lang + "\n" + lines.map((l) => l.text.replace(/\s+$/, "")).join("\n") + "\n```",
      );
      const hl = lines.filter((l) => l.cls.has("hl")).map((l) => l.text.trim());
      const add = lines.filter((l) => l.cls.has("add")).length;
      const del = lines.filter((l) => l.cls.has("del")).length;
      const dim = lines.filter((l) => l.cls.has("dim")).length;
      if (hl.length) push(hl.map((h) => `강조 — \`${h}\``).join("\n"));
      if (add || del) push(`변경 — 추가 ${add}줄 · 삭제 ${del}줄`);
      if (dim) push(`맥락용으로 물린 줄 ${dim}개 — 발표 중 다루지 않음`);
      continue;
    }
    if (pendingLabel) {
      push(pendingLabel);
      pendingLabel = null;
    }

    // ── 목록 세 결
    if (tag === "ul" && (hasClass(attrs, "bul") || hasClass(attrs, "pl"))) {
      push(
        children(inner)
          .filter((li) => li.tag === "li")
          .map((li) => {
            const sub = children(li.inner)
              .filter((u) => u.tag === "ul")
              .flatMap((u) => children(u.inner).filter((x) => x.tag === "li"))
              .map((x) => `  - ${txt(x.inner)}`);
            return [`- ${ownText(li.inner)}`, ...sub].join("\n");
          })
          .join("\n"),
      );
      continue;
    }
    if (tag === "ol" && hasClass(attrs, "num")) {
      push(
        children(inner)
          .filter((li) => li.tag === "li")
          .map((li, i) => `${i + 1}. ${txt(li.inner)}`)
          .join("\n"),
      );
      continue;
    }

    // ── 표
    if (tag === "table") {
      const rows = children(inner)
        .flatMap((n) => (n.tag === "tbody" ? children(n.inner) : [n]))
        .filter((tr) => tr.tag === "tr")
        .map((tr) => ({
          head: hasClass(tr.attrs, "hd"),
          cells: children(tr.inner)
            .filter((td) => td.tag === "td" || td.tag === "th")
            .map((td) => txt(td.inner).replace(/\|/g, "\\|")),
        }))
        .filter((r) => r.cells.length);
      if (!rows.length) continue;
      const width = Math.max(...rows.map((r) => r.cells.length));
      const head = rows[0].head ? rows.shift() : { cells: Array(width).fill("") };
      const line = (c) => `| ${Array.from({ length: width }, (_, i) => c[i] ?? "").join(" | ")} |`;
      push(
        [line(head.cells), `|${" --- |".repeat(width)}`, ...rows.map((r) => line(r.cells))].join("\n"),
      );
      continue;
    }

    // ── 구조 블록
    if (hasClass(attrs, "rows")) {
      push(
        children(inner)
          .filter((r) => hasClass(r.attrs, "r"))
          .map((r) => {
            const kids = children(r.inner);
            const h = kids.find((k) => k.tag === "h3");
            const p = kids.filter((k) => k.tag === "p").map((k) => txt(k.inner));
            return `- **${h ? txt(h.inner) : ""}** — ${p.join(" / ")}`.replace(/ — $/, "");
          })
          .join("\n"),
      );
      continue;
    }
    if (hasClass(attrs, "quad")) {
      push(
        children(inner)
          .filter((q) => hasClass(q.attrs, "q"))
          .map((q) => {
            const kids = children(q.inner);
            const h = kids.find((k) => k.tag === "h3");
            const p = kids.filter((k) => k.tag === "p").map((k) => txt(k.inner));
            return `- **${h ? txt(h.inner) : ""}** — ${p.join(" / ")}`.replace(/ — $/, "");
          })
          .join("\n"),
      );
      continue;
    }
    if (hasClass(attrs, "band")) {
      const kids = children(inner);
      const who = kids.find((k) => hasClass(k.attrs, "who"));
      const items = kids
        .filter((k) => k.tag === "ul")
        .flatMap((u) => children(u.inner).filter((li) => li.tag === "li"))
        .map((li) => `  - ${txt(li.inner)}`);
      push([`- **${who ? txt(who.inner, " · ") : ""}**`, ...items].join("\n"));
      continue;
    }
    if (hasClass(attrs, "journey")) {
      push(
        children(inner)
          .filter((s) => hasClass(s.attrs, "jstep"))
          .map((s) => {
            const kids = children(s.inner);
            const w = kids.find((k) => hasClass(k.attrs, "w"));
            const d = kids.find((k) => hasClass(k.attrs, "s"));
            return `**${w ? txt(w.inner) : ""}**${d ? `(${txt(d.inner)})` : ""}`;
          })
          .join(" → "),
      );
      continue;
    }
    if (hasClass(attrs, "stats")) {
      push(
        children(inner)
          .filter((s) => hasClass(s.attrs, "stat"))
          .map((s) => {
            const kids = children(s.inner);
            const n = kids.find((k) => hasClass(k.attrs, "n"));
            const d = kids.find((k) => hasClass(k.attrs, "d"));
            return `- **${n ? txt(n.inner) : ""}** — ${d ? txt(d.inner) : ""}`;
          })
          .join("\n"),
      );
      continue;
    }
    if (hasClass(attrs, "flow")) {
      push(txt(inner));
      continue;
    }

    // ── 컨테이너(2단·코드+설명 등)는 그대로 파고든다.
    // 엘리먼트 자식이 있는 div 는 구획일 뿐이므로 한 단계 더 들어간다.
    if (tag === "div" && children(inner).length) {
      blocks(inner, ctx).forEach(push);
      continue;
    }

    // ── 그 밖의 텍스트(표지 소제목·날짜·초점 단어 등)
    if (tag === "h3") {
      push(`**${txt(inner)}**`);
      continue;
    }
    push(txt(inner));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 덱 → 개요
// ─────────────────────────────────────────────────────────────

const html = readFileSync(deck, "utf8");
const deckTitle = txt(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] || basename(deck));

// 주석과 슬라이드 여는 태그를 한 정규식으로 훑는다 — 주석 안의 <section> 은 주석 쪽이
// 먼저 삼키므로 자동으로 걸러진다(주석 처리해 둔 마무리 변형이 팬텀 장으로 안 잡힘).
const scan = new RegExp(`<!--[\\s\\S]*?-->|<section(${ATTRS})>`, "g");
const slides = [];
let m;
while ((m = scan.exec(html))) {
  const attrs = m[1];
  if (attrs === undefined) continue; // 주석 — 삼키고 지나감
  if (!hasClass(attrs, "slide")) continue;
  const both = /<section\b|<\/section\s*>/gi;
  both.lastIndex = m.index;
  let depth = 0;
  let end = -1;
  let t;
  while ((t = both.exec(html))) {
    if (t[0][1] === "/") {
      depth -= 1;
      if (depth === 0) {
        end = t.index;
        break;
      }
    } else depth += 1;
  }
  if (end < 0) continue;
  // 장 안의 주석은 걷어낸다 — 주석 예시 안의 <pre>·<svg> 가 실제 내용으로 잡히면 안 된다
  slides.push({
    attrs,
    inner: html.slice(m.index + m[0].length, end).replace(/<!--[\s\S]*?-->/g, ""),
  });
  scan.lastIndex = end;
}

if (!slides.length) {
  console.error('슬라이드(<section class="slide">)를 못 찾음 — 덱 구조를 확인하세요.');
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, "0");

const parsed = slides.map((s, i) => {
  const ctx = { label: "", title: "", take: "", fn: "" };
  const body = blocks(s.inner, ctx);
  const oneLiner = hasClass(s.attrs, "one-liner");
  const isCode = /<pre[^>]*class="[^"]*\bcode\b/.test(s.inner);
  const last = i === slides.length - 1;
  const kind = i === 0
    ? "표지"
    : last
      ? "마무리"
      : oneLiner
        ? "섹션 브레이크"
        : isCode
          ? "코드"
          : "본문";
  return { n: i + 1, kind, ctx, body, note: s.note };
});

const count = (k) => parsed.filter((p) => p.kind === k).length;
const md = [];

md.push(`# 발표 개요 — ${deckTitle}`);
md.push("");
md.push(
  `<!-- slide-deck 스킬이 ${basename(deck)} 에서 뽑은 발표 참고용 개요.\n` +
    `     덱을 고치면 \`node outline.mjs ${basename(deck)} --force\` 로 다시 뽑는다.\n` +
    `     손으로 덧붙인 발표 포인트는 재추출 시 사라지니, 덱을 먼저 확정하고 채울 것. -->`,
);
md.push("");
md.push(`덱 파일 — \`${relative(process.cwd(), deck) || basename(deck)}\``);
md.push("");
md.push(
  `총 **${parsed.length}장** · ` +
    ["표지", "섹션 브레이크", "본문", "코드", "마무리"]
      .map((k) => `${k} ${count(k)}`)
      .filter((s) => !/ 0$/.test(s))
      .join(" · "),
);
md.push("");
md.push("## 흐름 한눈에");
md.push("");
md.push("| # | 결 | 제목 |");
md.push("| --- | --- | --- |");
for (const p of parsed) {
  const title = (p.ctx.title || p.body[0] || "").replace(/\|/g, "\\|");
  md.push(`| ${pad(p.n)} | ${p.kind} | ${title} |`);
}
md.push("");
md.push("---");

for (const p of parsed) {
  md.push("");
  md.push(`## S${pad(p.n)} · ${p.kind}${p.ctx.label ? ` — ${p.ctx.label}` : ""}`);
  md.push("");
  if (p.ctx.title) {
    md.push(`### ${p.ctx.title}`);
    md.push("");
  }
  for (const b of p.body) {
    md.push(b);
    md.push("");
  }
  if (p.ctx.fn) {
    md.push(`각주 — ${p.ctx.fn}`);
    md.push("");
  }
  if (p.ctx.take) {
    // 장 하단 테이크어웨이 — 안쪽 <em> 강조가 이미 ** 로 살아 있으니 겹쳐 싸지 않는다
    md.push(`→ ${p.ctx.take}`);
    md.push("");
  }
}

const out = md.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

if (has("--stdout")) {
  process.stdout.write(out);
  process.exit(0);
}

const target = resolve(
  opt("--out") ||
    join(dirname(deck), `${basename(deck, extname(deck))}-outline.md`),
);
if (existsSync(target) && !has("--force")) {
  console.error(`이미 있음: ${target}`);
  console.error("덮어쓰려면 --force (손으로 덧붙인 발표 포인트가 사라진다), 미리보려면 --stdout");
  process.exit(1);
}
writeFileSync(target, out, "utf8");
console.log(`개요: ${target}`);
console.log(`덱 ${parsed.length}장 → ${out.split("\n").length}줄`);
