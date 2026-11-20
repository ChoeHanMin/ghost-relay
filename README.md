# 고스트 릴레이 (GHOST RELAY)

친구의 유령과 함께 달리는 40초 릴레이 러너. 2026 saaskr 게임 어워드 출품작.
v2 변경 내역: [docs/feedback_v2.md](docs/feedback_v2.md)
설계 문서: [docs/ghost_relay_spec.md](docs/ghost_relay_spec.md)

## 출품 파일

`dist/ghost-relay.html` — 이 파일 하나만 saaskr에 올리면 됩니다 (약 130KB, 외부 파일·CDN·웹폰트 없음).

## 개발

```bash
node build.js              # src/ → dist/ghost-relay.html 로 합치기
node test/core.test.js     # 자동 테스트 (FULL=1 이면 난이도별 시드 1000개 공정성 검사)
```

- `src/core.js` — 순수 로직 (PRNG, 맵 생성, 결정적 시뮬레이션, 봇, 도전 코드). Node 테스트와 브라우저가 같은 파일을 씀
- `src/app.js` — 그리기, 소리, 저장, UI, 게임 루프
- `src/template.html`, `src/style.css` — 화면 뼈대와 스타일
- `test/iframe-test.html` — saaskr처럼 iframe(sandbox) 안에서 띄워 보는 페이지
- 브라우저 콘솔에서 `runSelfTests()` 로 기기 안 자체 검사

## 주의

- 물리값·맵 생성·코드 형식을 바꾸면 기존 도전 코드의 유령 재생이 달라집니다. 바꿀 때는 `C.VERSION`을 올리고, 이전 버전을 읽는 경로를 남겨 두세요.
- saaskr 게임 페이지 주소가 정해지면 `src/app.js`의 `GAME_URL`에 넣고 다시 빌드하세요 (공유 문구에 들어감).
