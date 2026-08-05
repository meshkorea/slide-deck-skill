# slide-deck-skill

발표 슬라이드 덱을 **자립형 HTML 한 장**으로 만드는 Claude Code 스킬.

`1280×720` 스테이지를 뷰포트에 맞춰 스케일하고 `.slide.active` 토글로 한 장씩 넘긴다. 폰트·CSS·내비게이션 스크립트가 전부 파일 안에 인라인이라 **빌드 단계가 없다** — 만든 HTML 파일 하나를 브라우저로 열면 끝. 만든 뒤에는 헤드리스 Chrome으로 PNG를 뽑아 에이전트가 직접 눈으로 확인한다.

특징:

- **큰 타이포** — 본문 32px 기준(@1280×720). 제목만 크고 본문이 문서 크기인 덱을 만들지 않는다
- **딥 네이비 프라이머리 + 포인트 3색** — 프라이머리는 oklch 색상값 하나만 바꿔 덱마다 교체. 포인트는 형광펜식 밑줄로만
- **음슴체·명사형 말투** — 어미·마침표 최소
- **사각 틀에 가두지 않는 레이아웃** — 구획은 카드·패널이 아니라 가는 줄(hairline)과 여백으로
- **손그림 스케치 레이어** — 링·밑줄 스와시·유도 화살표·배경 필러를 연필 톤 SVG로
- **무료 폰트 선택** — noonnu 무료 글꼴 7종 프리셋(기본 Asta Sans)에서 덱마다 하나
- **코드 스니펫 장** — 고정폭(Monoplex KR Wide Nerd) + Catppuccin 톤 구문 색. 페이퍼 배경에 맞춰 **라이트가 기본**이고 다크 필드는 요청 시에만. 강조(`.hl`)·물림(`.dim`)·diff(`.add`/`.del`)로 "여기만 보세요"가 되는 코드 슬라이드. 모노스페이스와 글자색이 허용되는 유일한 자리
- **발표자용 개요 추출** — 덱 HTML에서 발표 중 참고할 개요 마크다운을 뽑는다(흐름 표 + 장별 상세 + 코드 펜스)

스타일 규약 전문은 [SKILL.md](plugins/slide-deck/skills/slide-deck/SKILL.md)에 있다.

## 설치

Claude Code에서 한 번만:

```
/plugin marketplace add meshkorea/slide-deck-skill
```

```
/plugin install slide-deck@slide-deck-skill
```

설치 후 어느 프로젝트에서든 `/slide-deck` 으로 호출된다(덱/슬라이드/발표자료 요청 시 자동 로드도 됨).

### 프로젝트 단위로 고정하고 싶으면

특정 저장소에서 팀 전원이 쓰게 하려면 그 저장소에서:

```
/plugin install slide-deck@slide-deck-skill --scope project
```

그 뒤 생성된 `.claude/settings.json`을 커밋하면, 클론한 사람은 신뢰 승인 시 마켓플레이스·플러그인을 자동으로 받는다.

## 요구 환경

- **Node ≥18**
- **Google Chrome** — 헤드리스 렌더용. macOS 기본 경로와 Linux 후보(`/usr/bin/google-chrome`, `chromium`)를 자동 탐색하고, 다른 위치면 `CHROME=/path/to/chrome`으로 지정
- 폰트를 jsdelivr CDN에서 불러오므로 **렌더 확인 시 네트워크 필요**(오프라인이면 시스템 폰트로 폴백돼 자간이 달라 보인다)
- `outline.mjs`는 Node만 있으면 되고 Chrome도 네트워크도 필요 없다

별도 설치 단계는 없다. npm 의존성도 없다.

## 렌더 확인

```bash
node "$SD/render.mjs" slides/my-deck.html            # 전 슬라이드
node "$SD/render.mjs" slides/my-deck.html --slide 3  # 특정 장만
node "$SD/render.mjs" slides/my-deck.html --range 1-5
```

출력은 `<덱과 같은 폴더>/.render/slide-NN.png`(`--out DIR`로 변경). `$SD`는 스킬이 설치된 디렉토리 — 에이전트가 `$CLAUDE_PLUGIN_ROOT`에서 잡는다.

폰트 로드 대기는 자동으로 정해진다 — 코드 장이 있는 덱은 고정폭 웹폰트(웨이트당 ~800KB)까지 받아야 해서 12초, 없으면 4초. 느린 회선이면 `--wait 20000`.

## 발표 개요 뽑기

기획 문서 없이 덱만 만든 경우, 발표 중 손에 들고 볼 개요를 덱에서 직접 뽑는다.

```bash
node "$SD/outline.mjs" slides/my-deck.html            # → slides/my-deck-outline.md
node "$SD/outline.mjs" slides/my-deck.html --stdout   # 파일로 안 쓰고 미리보기
node "$SD/outline.mjs" slides/my-deck.html --force    # 덱을 고쳐 다시 뽑을 때
```

덱 제목·장수 요약, 흐름 한눈에 표, 장별 상세(맥락 라벨·제목·불릿·표·코드 펜스·각주·한 줄 결론)가 나온다. 코드 장은 강조 줄과 diff 증감까지 따라붙는다. 기존 개요 파일은 `--force` 없이 덮어쓰지 않는다 — 손으로 덧붙인 발표 포인트를 지키기 위함.

## 구조

```
.claude-plugin/marketplace.json      # 마켓플레이스 매니페스트
plugins/
  slide-deck/
    .claude-plugin/plugin.json       # 플러그인 매니페스트
    skills/slide-deck/
      SKILL.md                       # 스킬 지침 (스타일 규약 전문)
      render.mjs                     # 헤드리스 Chrome 렌더 드라이버
      outline.mjs                    # 덱 → 발표자용 개요 마크다운 추출기
      reference/deck-template.html   # 시작 템플릿 (원형 슬라이드 11종 + 전 CSS)
```

## 라이선스

[MIT](LICENSE).

단, **폰트는 여기에 포함되지 않는다** — 덱은 [fonts-archive](https://cdn.jsdelivr.net/gh/fonts-archive/) CDN에서 웹폰트를 링크로 불러올 뿐이고, 각 폰트는 **해당 폰트의 라이선스**를 따른다(대부분 [noonnu.cc](https://noonnu.cc)에 정리돼 있다). 코드 스니펫용 고정폭 [Monoplex KR](https://github.com/y-kim/monoplex)도 마찬가지다. 상업적 이용·임베딩 조건은 쓰려는 폰트별로 직접 확인할 것.
