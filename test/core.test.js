// 고스트 릴레이 core 자동 테스트:  node test/core.test.js   (FULL=1 이면 난이도별 시드 1000개 공정성 검사)
'use strict';
const assert = require('assert');
const GR = require('../src/core.js');
const { C } = GR;

let passed = 0;
function test(name, fn) {
  const t0 = Date.now();
  try { fn(); passed++; console.log(`  ok  ${name} (${Date.now() - t0}ms)`); }
  catch (e) { console.log(`  FAIL ${name}\n       ${e && e.stack || e}`); process.exitCode = 1; }
}
function randInputs(rng) {
  const out = []; let t = rng() % 40;
  while (t < C.RUN_TICKS && out.length < 120) { out.push(t); t += 3 + rng() % 50; }
  return out;
}
// 실플레이처럼 무작위로 버튼을 눌러 기록을 만든다
function livePlay(seed, diff, rng, ctx) {
  const run = GR.createRun(GR.getMap(seed, diff), ctx);
  while (run.t < C.RUN_TICKS) GR.step(run, rng() % 14 === 0);
  return run;
}
const pick = r => ({ score: r.score, distance: r.distance, stars: r.stars, syncs: r.syncs, rescues: r.rescues, stumbles: r.stumbles, falls: r.falls, jumps: r.jumps, doubles: r.doubles });

console.log('고스트 릴레이 core 테스트 (v2)');

test('같은 시드·입력 → 100회 동일', () => {
  const rng = GR.mulberry32(7), inputs = randInputs(rng);
  const a = pick(GR.simulate(12345, inputs, null, false, 1));
  for (let i = 0; i < 100; i++) assert.deepStrictEqual(pick(GR.simulate(12345, inputs, null, false, 1)), a);
});

test('실플레이 기록 → 재생 결과 동일 (난이도별 100판)', () => {
  const rng = GR.mulberry32(99);
  for (let diff = 0; diff < 3; diff++) for (let i = 0; i < 100; i++) {
    const seed = rng(), run = livePlay(seed, diff, rng, null);
    const rep = GR.simulate(seed, run.rec.slice(), null, false, diff);
    assert.deepStrictEqual(pick(rep), pick(GR.summary(run)), 'seed ' + seed);
    assert.deepStrictEqual(rep.rec, run.rec);
  }
});

test('실플레이(유령 있음) → 릴레이 재생 점수 동일', () => {
  const rng = GR.mulberry32(5);
  for (let k = 0; k < 30; k++) {
    const seed = rng(), diff = k % 3;
    const relay = { seed, mapType: 1, diff, relayId: 1, runners: [] };
    for (let i = 0; i < 4; i++) {
      const ev = GR.evaluateRelay(relay);
      const run = livePlay(seed, diff, rng, ev.nextCtx);
      relay.runners.push({ name: 'R' + i, hat: i, inputs: run.rec.slice() });
      assert.strictEqual(GR.evaluateRelay(relay).results[i].score, GR.scoreOf(run));
    }
  }
});

test('2단 점프: 공중에서 한 번만, 땅·발판에서 다시 충전', () => {
  const map = GR.getMap(1, 1), run = GR.createRun(map, null);
  GR.step(run, true); assert.ok(!run.grounded);
  for (let i = 0; i < 5; i++) GR.step(run, false);
  GR.step(run, true); assert.strictEqual(run.doubles, 1);
  GR.step(run, true); assert.strictEqual(run.jumps, 2, '세 번째 누름은 무시');
  assert.strictEqual(run.rec.length, 2, '무시된 누름은 기록하지 않음');
});

test('높은 발판: 점프+2단 점프로 올라설 수 있음', () => {
  let lands = 0, maps = 0;
  for (let s = 0; s < 30; s++) {
    const map = GR.getMap(GR.hash32(s + 77), 1);
    if (map.plats.length) maps++;
    // 발판 바로 앞에서 점프 + 2단 점프를 시도하는 단순 플레이어
    const run = GR.createRun(map, null);
    let next = -1;
    while (run.t < C.RUN_TICKS) {
      const fx = (run.x >> 8) + 6, p = map.plats.find(q => q.x - fx > 34 && q.x - fx < 40);
      let press = false;
      if (p && GR.canJump(run)) { press = true; next = run.t + 14; }
      else if (run.t === next) press = true;
      GR.step(run, press);
    }
    lands += run.platLands;
  }
  assert.ok(maps > 20, '대부분 맵에 발판 있음');
  assert.ok(lands > 0, '발판 착지 0회');
});

test('인코딩 → 디코딩 1000개 원본과 동일', () => {
  const rng = GR.mulberry32(42), names = ['러너12', 'abc', '한글여섯글자', 'Z9', '유령'];
  for (let i = 0; i < 1000; i++) {
    const n = 1 + rng() % 10;
    const relay = { seed: rng(), mapType: rng() % 2, diff: rng() % 3, relayId: rng() & 0xFFFF, runners: [] };
    for (let r = 0; r < n; r++) relay.runners.push({ name: names[rng() % names.length], hat: rng() % 10, inputs: randInputs(rng) });
    const dec = GR.decodeRelay(GR.encodeRelay(relay));
    assert.ok(dec.ok, dec.error);
    assert.deepStrictEqual(dec.relay, relay);
    assert.strictEqual(dec.completed, n === 10);
  }
});

test('공유 문구째 / 공백 섞인 코드 해석, 예전 GR1 코드 안내', () => {
  const relay = { seed: 777, mapType: 0, diff: 1, relayId: 0xA7F2, runners: [{ name: '러너07', hat: 3, inputs: GR.botInputs(777, 1, 1) }] };
  const code = GR.encodeRelay(relay);
  assert.ok(GR.decodeRelay(`👻 고스트 릴레이 #A7F2 — 나 233점!\n${code}\n`).ok);
  assert.ok(GR.decodeRelay('GR2.' + code.slice(4).replace(/(.{4})/g, '$1 ')).ok);
  const old = GR.decodeRelay('GR1.AfH9slUAEt8BCOufrOuEiDM5ABQaS0tLS0ty');
  assert.ok(!old.ok && /예전 버전/.test(old.error));
});

test('한 글자 바꾸기·끝 자르기 → 거절', () => {
  const rng = GR.mulberry32(3);
  const relay = { seed: 9, mapType: 1, diff: 2, relayId: 5, runners: [{ name: 'abc', hat: 1, inputs: randInputs(rng) }, { name: '유령', hat: 2, inputs: randInputs(rng) }] };
  const code = GR.encodeRelay(relay);
  for (let i = 4; i < code.length; i++) {
    const bad = code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1);
    assert.ok(!GR.decodeRelay(bad).ok, 'pos ' + i);
  }
  for (let cut = 1; cut < 30; cut++) assert.ok(!GR.decodeRelay(code.slice(0, code.length - cut)).ok, 'cut ' + cut);
  assert.strictEqual(GR.decodeRelay('안녕하세요').ok, false);
});

test('닉네임 검사: 한글 6자 OK, 이모지·7자·특수문자 거절', () => {
  assert.ok(GR.validName('한글여섯글자')); assert.ok(GR.validName('Runner'));
  assert.ok(!GR.validName('일곱글자입니다')); assert.ok(!GR.validName('👻'));
  assert.ok(!GR.validName('<b>')); assert.ok(!GR.validName(''));
});

test('9명 유령 코드 길이 1000자 이하', () => {
  const relay = { seed: 2026, mapType: 0, diff: 2, relayId: 1, runners: [] };
  for (let i = 0; i < 10; i++) relay.runners.push({ name: '한글여섯글자', hat: i, inputs: GR.botInputs(2026 + i, i % 3, 2) });
  const code9 = GR.encodeRelay(Object.assign({}, relay, { runners: relay.runners.slice(0, 9) }));
  console.log(`       9명 ${code9.length}자, 10명 ${GR.encodeRelay(relay).length}자`);
  assert.ok(code9.length <= 1000);
});

test('봇 실력 차이 (느림 < 보통 < 빠름 ≤ 완벽), 난이도별 평균 점수', () => {
  for (let diff = 0; diff < 3; diff++) {
    const avg = [0, 0, 0, 0], N = 20;
    for (let s = 0; s < N; s++) for (let k = 0; k < 4; k++) avg[k] += GR.simulate(1000 + s, GR.botInputs(1000 + s, k, diff), null, false, diff).score / N;
    console.log(`       ${GR.DIFF[diff].name}: ` + avg.map(v => v.toFixed(0)).join(' / '));
    assert.ok(avg[0] < avg[1] && avg[1] < avg[2] && avg[2] <= avg[3]);
  }
});

for (let diff = 0; diff < 3; diff++) {
  const N = process.env.FULL ? 1000 : 150;
  test(`완벽 봇 [${GR.DIFF[diff].name}]: 시드 ${N}개 멈칫·낙하 0회`, () => {
    const bad = []; let dist = 0;
    for (let s = 0; s < N; s++) {
      const seed = GR.hash32(s + 1), r = GR.simulate(seed, GR.botInputs(seed, 3, diff), null, false, diff);
      dist += r.distance;
      if (r.stumbles || r.falls) bad.push(`${seed}(멈칫${r.stumbles}/낙하${r.falls})`);
    }
    console.log(`       평균 거리 ${(dist / N).toFixed(0)}m`);
    assert.strictEqual(bad.length, 0, `실패 ${bad.length}개: ` + bad.slice(0, 8).join(', '));
  });
}

console.log(`\n${passed}개 통과` + (process.exitCode ? ' — 실패 있음' : ''));
