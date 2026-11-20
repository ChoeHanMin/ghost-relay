/* =====================================================================
 * GHOST RELAY — core v2 (util · constants · map · sim · bot · codec)
 * DOM 없이 동작하는 순수 코드. Node 테스트와 브라우저가 같은 파일을 쓴다.
 * 시뮬레이션 안에서는 정수 연산만 쓴다 (Math.random / Date / 실수 금지).
 * v2: 2단 점프, 높은 발판, 난이도(하/중/상), 40초, 별 판정 여유, 코드 GR2
 * ===================================================================== */
'use strict';
var GR = (function () {

  /* ---------- 1. util ---------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    };
  }
  function rint(rng, n) { return rng() % n; }
  function hash32(x) {
    x = x >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  }
  function crc16(bytes, len) { // CRC-16/CCITT-FALSE
    var crc = 0xFFFF;
    for (var i = 0; i < len; i++) {
      crc ^= bytes[i] << 8;
      for (var k = 0; k < 8; k++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc;
  }
  function writeVar(out, n) { // LEB128
    n = n >>> 0;
    do { var b = n & 127; n >>>= 7; out.push(n ? b | 128 : b); } while (n);
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var B64R = {}; for (var bi = 0; bi < 64; bi++) B64R[B64[bi]] = bi;
  function b64urlEncode(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var rem = bytes.length - i;
      var n = (bytes[i] << 16) | ((rem > 1 ? bytes[i + 1] : 0) << 8) | (rem > 2 ? bytes[i + 2] : 0);
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
      if (rem > 1) s += B64[(n >> 6) & 63];
      if (rem > 2) s += B64[n & 63];
    }
    return s;
  }
  function b64urlDecode(str) {
    if (str.length % 4 === 1) return null;
    var out = [];
    for (var i = 0; i < str.length; i += 4) {
      var c = str.substr(i, 4), v = [];
      for (var k = 0; k < c.length; k++) { var d = B64R[c[k]]; if (d === undefined) return null; v.push(d); }
      var n = (v[0] << 18) | (v[1] << 12) | ((v[2] || 0) << 6) | (v[3] || 0);
      out.push((n >> 16) & 255);
      if (c.length > 2) out.push((n >> 8) & 255);
      if (c.length > 3) out.push(n & 255);
    }
    return out;
  }
  function utf8Encode(s) { return Array.prototype.slice.call(new TextEncoder().encode(s)); }
  function utf8Decode(bytes) { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); }

  /* ---------- 2. constants ---------- */
  var C = {
    VERSION: 2,            // 코드 형식 + 물리값 버전 (물리값을 바꾸면 반드시 올릴 것)
    FP: 256,               // 1px = 256 단위
    TPS: 60, RUN_TICKS: 2400,             // 40초
    GROUND_Y: 320,
    P_W: 12, P_H: 16, HB_X: 1, HB_Y: 2, HB_W: 10, HB_H: 14,
    START_X: 16,
    GRAVITY: 64,                          // 0.25 px/틱²
    JUMP_V: -1075,                        // 1단: -4.2 px/틱 (높이 약 35px)
    DOUBLE_V: -960,                       // 2단: -3.75 px/틱 (+약 28px)
    STUMBLE_TICKS: 45, FALL_TICKS: 60,
    PX_PER_M: 16, SYNC_WINDOW: 4, STAR_PAD: 3,
    MAX_RUNNERS: 10, MAX_JUMPS: 400, NAME_MAX_BYTES: 18, NAME_MAX_CHARS: 6,
    MAP_LEN: 9600,
    PTS_STAR: 5, PTS_SYNC: 3, PTS_RESCUE: 10
  };
  // 난이도: 속도(px/틱×256)와 구간 경계(px)
  var DIFF = [
    { name: '쉬움', short: '하', s0: 448, s1: 704, tiers: [900, 3200, 6200] },
    { name: '보통', short: '중', s0: 512, s1: 819, tiers: [600, 2300, 4600] },
    { name: '어려움', short: '상', s0: 576, s1: 922, tiers: [400, 1500, 3300] }
  ];
  var F = { JUMP: 1, LAND: 2, STUMBLE: 4, FALL: 8, STAR: 16, RESCUE: 32, SYNC: 64, RESPAWN: 128, DOUBLE: 256, PLAT: 512 };
  var S = { GROUND: 1, STUMBLE: 2, FALL: 4, RISING: 8, DOUBLE: 16 };
  var FP = C.FP;

  /* ---------- 3. map ---------- */
  var mapCache = {};
  function getMap(seed, diff) {
    seed = seed >>> 0; diff = diff === undefined ? 1 : diff;
    var key = seed + ':' + diff;
    if (!mapCache[key]) mapCache[key] = generateMap(seed, diff);
    return mapCache[key];
  }
  function generateMap(seed, diff) {
    var rng = mulberry32((seed ^ 0x9E3779B9 ^ Math.imul(diff + 1, 0x85EBCA6B)) >>> 0);
    var G = C.GROUND_Y, obs = [], stars = [], holes = [], plats = [];
    function star(x, y) { stars.push({ x: x, y: y }); }
    function box(x, w, h, type) { obs.push({ x: x, y: G - h, w: w, h: h, type: type }); }
    function lead(x) { return x + 110 + rint(rng, 30); }
    function tail() { return 100 + rint(rng, 40); }
    var chunk = {
      flat: function (x) {
        if (rint(rng, 3)) { var n = 3 + rint(rng, 3); for (var i = 0; i < n; i++) star(x + 40 + i * 16, G - 12); }
        return 160 + rint(rng, 64);
      },
      low: function (x) {
        var b = lead(x); box(b, 16, 16, 'low'); star(b + 4, G - 44);
        if (rint(rng, 2)) { star(b - 18, G - 36); star(b + 26, G - 36); }
        return b - x + 16 + tail();
      },
      spike: function (x) {
        var b = lead(x); box(b, 32, 8, 'spike'); star(b + 12, G - 42);
        return b - x + 32 + tail();
      },
      hole: function (x, wide) {
        var w = wide ? 44 + rint(rng, 13) : 32 + rint(rng, 9), b = lead(x);
        holes.push({ x0: b, x1: b + w });
        star(b + (w >> 1) - 4, G - 40);
        return b - x + w + tail();
      },
      tall: function (x) { // 2단 점프 필요
        var b = lead(x); box(b, 16, 32, 'tall');
        star(b + 4, G - 66); star(b - 20, G - 52); star(b + 28, G - 52);
        return b - x + 16 + tail();
      },
      dbl: function (x) {
        var b = lead(x); box(b, 16, 16, 'low'); box(b + 56, 16, 16, 'low');
        star(b + 32, G - 56);
        return b - x + 72 + 110 + rint(rng, 30);
      },
      sign: function (x) { // 2단 점프 필요
        var b = lead(x); box(b, 20, 36, 'sign'); star(b + 6, G - 70);
        return b - x + 20 + tail();
      },
      air: function (x) { // 높은 별 묶음: 2단 점프로만 먹을 수 있음
        var hs = [40, 54, 62, 54, 40];
        for (var i = 0; i < 5; i++) star(x + 60 + i * 20, G - hs[i]);
        return 230 + rint(rng, 40);
      },
      plat: function (x) { // 높은 발판: 2단 점프로 올라가면 별 줄
        var b = x + 90 + rint(rng, 30), w = 64 + rint(rng, 4) * 16, h = 44 + rint(rng, 3) * 4;
        plats.push({ x: b, y: G - h, w: w });
        for (var i = 8; i + 8 <= w - 4; i += 16) star(b + i, G - h - 12);
        if (rint(rng, 2)) star(b + (w >> 1) - 4, G - 12);
        return b - x + w + 120 + rint(rng, 40);
      },
      lowspike: function (x) {
        var b = x + 100 + rint(rng, 20); box(b, 16, 16, 'low'); star(b + 4, G - 44);
        var s2 = b + 16 + 170; box(s2, 32, 8, 'spike'); star(s2 + 12, G - 42);
        return s2 - x + 32 + tail();
      },
      holelow: function (x) {
        var b = x + 100 + rint(rng, 20), w = 36 + rint(rng, 9);
        holes.push({ x0: b, x1: b + w }); star(b + (w >> 1) - 4, G - 40);
        var b2 = b + w + 170; box(b2, 16, 16, 'low'); star(b2 + 4, G - 44);
        return b2 - x + 16 + tail();
      }
    };
    var tiers = [
      [['flat', 3], ['low', 2], ['plat', 1]],
      [['flat', 1], ['low', 3], ['spike', 2], ['hole', 2], ['tall', 1], ['plat', 2]],
      [['low', 1], ['spike', 1], ['holeW', 2], ['tall', 2], ['dbl', 2], ['sign', 1], ['air', 1], ['plat', 2]],
      [['lowspike', 2], ['holelow', 2], ['dbl', 1], ['tall', 1], ['sign', 1], ['air', 2], ['holeW', 1], ['plat', 2]]
    ];
    var th = DIFF[diff].tiers, x = 200;
    x += chunk.flat(x);
    while (x < C.MAP_LEN) {
      var tier = x < th[0] ? 0 : x < th[1] ? 1 : x < th[2] ? 2 : 3;
      var list = tiers[tier], total = 0, i;
      for (i = 0; i < list.length; i++) total += list[i][1];
      var r = rint(rng, total), name = list[0][0];
      for (i = 0; i < list.length; i++) { if (r < list[i][1]) { name = list[i][0]; break; } r -= list[i][1]; }
      x += name === 'holeW' ? chunk.hole(x, true) : chunk[name](x, false);
    }
    var byXY = function (a, b) { return a.x - b.x || a.y - b.y; };
    obs.sort(byXY); stars.sort(byXY);
    return { seed: seed, diff: diff, obs: obs, stars: stars, holes: holes, plats: plats, length: x };
  }
  var ADJ = ['네온', '젖은', '조용한', '반짝이는', '새벽의', '비 오는', '잠든', '깜빡이는', '안개 낀', '한밤의', '푸른', '오래된'];
  var PLACE = ['골목', '옥상', '지하철', '놀이터', '항구', '시장', '다리', '정류장', '공터', '상가', '육교', '터널'];
  function mapName(seed) { var h = hash32(seed ^ 0x51ED); return ADJ[h % ADJ.length] + ' ' + PLACE[(h >>> 8) % PLACE.length]; }
  function seedForDate(ymd) { return hash32(Math.imul(ymd >>> 0, 0x9E3779B1) ^ 0x6A09E667); }

  /* ---------- 4. sim ---------- */
  function createRun(map, ctx) {
    return {
      map: map, ctx: ctx || null, t: 0,
      x: C.START_X * FP, y: (C.GROUND_Y - C.P_H) * FP, vy: 0, grounded: true, plat: -1, dblAvail: false,
      stumble: 0, fall: 0, fallTo: 0,
      obsIdx: 0, starIdx: 0, holeIdx: 0, platIdx: 0,
      hit: new Uint8Array(map.obs.length), got: new Uint8Array(map.stars.length),
      rec: [], stars: 0, syncs: 0, rescues: 0, stumbles: 0, falls: 0, jumps: 0, doubles: 0, platLands: 0,
      flags: 0, lastSync: 0, probe: false, failed: false
    };
  }
  function canJump(run) { return run.grounded && run.stumble === 0 && run.fall === 0 && run.t < C.RUN_TICKS; }
  function canDouble(run) { return !run.grounded && run.dblAvail && run.fall === 0 && run.t < C.RUN_TICKS; }
  function speedAt(t, diff) {
    var d = DIFF[diff === undefined ? 1 : diff];
    return d.s0 + Math.floor((d.s1 - d.s0) * t / C.RUN_TICKS);
  }
  function holeUnder(run, footPx) {
    var H = run.map.holes;
    while (run.holeIdx < H.length && H[run.holeIdx].x1 <= footPx) run.holeIdx++;
    var h = H[run.holeIdx];
    return (h && h.x0 <= footPx) ? h : null;
  }
  function platUnder(run, footPx) {
    var P = run.map.plats;
    while (run.platIdx < P.length && P[run.platIdx].x + P[run.platIdx].w <= footPx) run.platIdx++;
    var p = P[run.platIdx];
    return (p && p.x <= footPx) ? run.platIdx : -1;
  }
  /* press: 이번 틱에 버튼을 눌렀는가 (땅이면 점프, 공중이면 2단 점프) */
  function step(run, press) {
    if (run.t >= C.RUN_TICKS) return;
    var t = run.t, map = run.map, groundTop = (C.GROUND_Y - C.P_H) * FP;
    run.flags = 0;
    var speed = speedAt(t, map.diff);

    if (press) {
      var jumped = false;
      if (canJump(run)) {
        run.vy = C.JUMP_V; run.grounded = false; run.plat = -1; run.dblAvail = true; jumped = true;
      } else if (canDouble(run)) {
        run.vy = C.DOUBLE_V; run.dblAvail = false; jumped = true; run.doubles++; run.flags |= F.DOUBLE;
      }
      if (jumped) {
        run.jumps++; run.flags |= F.JUMP;
        if (run.rec) run.rec.push(t);
        if (run.ctx && run.ctx.syncArr[t]) { run.lastSync = run.ctx.syncArr[t]; run.syncs += run.lastSync; run.flags |= F.SYNC; }
      }
    }

    if (run.fall > 0) {
      run.fall--;
      if (run.vy < 6 * FP) run.vy += C.GRAVITY;
      if (run.y < 520 * FP) run.y += run.vy;
      if (run.fall === 0) {
        run.x = run.fallTo; run.y = groundTop; run.vy = 0; run.grounded = true; run.plat = -1;
        run.flags |= F.RESPAWN;
      }
    } else {
      var oldFeet = run.y + C.P_H * FP;
      if (!run.grounded) { run.y += run.vy; run.vy += C.GRAVITY; }
      if (run.stumble > 0) run.stumble--; else run.x += speed;

      var footPx = (run.x >> 8) + 6;
      var hole = holeUnder(run, footPx), pi = platUnder(run, footPx);
      if (run.grounded) {
        if (run.plat >= 0) { if (pi !== run.plat) { run.grounded = false; run.vy = 0; run.plat = -1; run.dblAvail = true; } }
        else if (hole) { run.grounded = false; run.vy = 0; run.dblAvail = false; }
      } else {
        var feet = run.y + C.P_H * FP, landed = false;
        if (pi >= 0 && feet > oldFeet) {
          var top = map.plats[pi].y * FP;
          if (oldFeet <= top && feet >= top) {
            run.y = top - C.P_H * FP; run.vy = 0; run.grounded = true; run.plat = pi; run.dblAvail = false;
            run.platLands++; run.flags |= F.LAND | F.PLAT; landed = true;
          }
        }
        if (!landed && run.y >= groundTop) {
          if (!hole) {
            run.y = groundTop; run.vy = 0; run.grounded = true; run.plat = -1; run.dblAvail = false;
            run.flags |= F.LAND;
          } else if (run.y >= groundTop + 4 * FP) {
            if (run.probe) { run.failed = true; run.t++; return; }
            run.fall = C.FALL_TICKS; run.fallTo = hole.x1 * FP; run.falls++;
            run.stumble = 0; run.dblAvail = false;
            run.flags |= F.FALL;
          }
        }
      }
    }

    if (run.fall === 0) {
      var hx0 = run.x + C.HB_X * FP, hx1 = hx0 + C.HB_W * FP, hy0 = run.y + C.HB_Y * FP, hy1 = hy0 + C.HB_H * FP;
      var O = map.obs, i, o;
      while (run.obsIdx < O.length && (O[run.obsIdx].x + O[run.obsIdx].w) * FP <= hx0) run.obsIdx++;
      for (i = run.obsIdx; i < O.length && O[i].x * FP < hx1; i++) {
        if (run.hit[i]) continue;
        o = O[i];
        if (hx1 > o.x * FP && hx0 < (o.x + o.w) * FP && hy1 > o.y * FP && hy0 < (o.y + o.h) * FP) {
          if (run.probe) { run.failed = true; run.t++; return; }
          run.hit[i] = 1; run.stumble = C.STUMBLE_TICKS; run.stumbles++;
          run.flags |= F.STUMBLE;
          break;
        }
      }
      if (!run.probe) {
        var St = map.stars, pad = C.STAR_PAD * FP;
        while (run.starIdx < St.length && (St[run.starIdx].x + 8) * FP + pad <= hx0) run.starIdx++;
        for (i = run.starIdx; i < St.length && St[i].x * FP - pad < hx1; i++) {
          if (run.got[i]) continue;
          o = St[i];
          if (hy1 > o.y * FP - pad && hy0 < (o.y + 8) * FP + pad && hx1 > o.x * FP - pad && hx0 < (o.x + 8) * FP + pad) {
            run.got[i] = 1; run.stars++; run.flags |= F.STAR;
            if (run.ctx && !run.ctx.priorStars[i]) { run.rescues++; run.flags |= F.RESCUE; }
          }
        }
      }
    }
    run.t++;
  }
  function distanceM(run) { return Math.max(0, Math.floor((run.x - C.START_X * FP) / (C.PX_PER_M * FP))); }
  function scoreOf(run) {
    return distanceM(run) + run.stars * C.PTS_STAR + run.syncs * C.PTS_SYNC + run.rescues * C.PTS_RESCUE;
  }
  function stateBits(run) {
    return (run.grounded ? S.GROUND : 0) | (run.stumble > 0 ? S.STUMBLE : 0) | (run.fall > 0 ? S.FALL : 0) |
      (run.vy < 0 ? S.RISING : 0) | (!run.grounded && !run.dblAvail ? S.DOUBLE : 0);
  }
  function summary(run) {
    return { score: scoreOf(run), distance: distanceM(run), stars: run.stars, syncs: run.syncs, rescues: run.rescues,
      stumbles: run.stumbles, falls: run.falls, jumps: run.jumps, doubles: run.doubles, platLands: run.platLands };
  }
  function simulate(mapOrSeed, inputs, ctx, wantFrames, diff) {
    var map = typeof mapOrSeed === 'object' ? mapOrSeed : getMap(mapOrSeed, diff);
    var run = createRun(map, ctx), p = 0, N = C.RUN_TICKS, fr = null;
    if (wantFrames) {
      fr = { x: new Int32Array(N + 1), y: new Int32Array(N + 1), st: new Uint8Array(N + 1), fl: new Uint16Array(N + 1) };
      fr.x[0] = run.x; fr.y[0] = run.y; fr.st[0] = stateBits(run);
    }
    while (run.t < N) {
      var press = false;
      if (p < inputs.length && inputs[p] === run.t) { press = true; p++; }
      step(run, press);
      if (fr) { var k = run.t; fr.x[k] = run.x; fr.y[k] = run.y; fr.st[k] = stateBits(run); fr.fl[k] = run.flags; }
    }
    var res = summary(run);
    res.rec = run.rec; res.got = run.got; res.frames = fr;
    return res;
  }
  function emptyCtx(map) { return { syncArr: new Uint8Array(C.RUN_TICKS), priorStars: new Uint8Array(map.stars.length) }; }
  function addToCtx(ctx, res) {
    for (var j = 0; j < res.rec.length; j++) {
      var g = res.rec[j];
      for (var d = -C.SYNC_WINDOW; d <= C.SYNC_WINDOW; d++) { var k = g + d; if (k >= 0 && k < C.RUN_TICKS && ctx.syncArr[k] < 255) ctx.syncArr[k]++; }
    }
    for (var i = 0; i < res.got.length; i++) if (res.got[i]) ctx.priorStars[i] = 1;
  }
  function copyCtx(ctx) { return { syncArr: ctx.syncArr.slice(), priorStars: ctx.priorStars.slice() }; }
  /* 릴레이 전체를 달린 순서대로 재생해 각 주자의 점수를 계산한다 (점수는 코드에 없다). */
  function evaluateRelay(relay, wantFrames) {
    var map = getMap(relay.seed, relay.diff), ctx = emptyCtx(map), results = [];
    for (var i = 0; i < relay.runners.length; i++) {
      var ru = relay.runners[i];
      var res = simulate(map, ru.inputs, i === 0 ? null : copyCtx(ctx), wantFrames);
      res.name = ru.name; res.hat = ru.hat; res.index = i;
      results.push(res);
      addToCtx(ctx, res);
    }
    return { map: map, results: results, nextCtx: relay.runners.length ? ctx : null };
  }
  function rankOrder(results) {
    return results.slice().sort(function (a, b) { return b.score - a.score || b.distance - a.distance || a.index - b.index; });
  }

  /* ---------- 5. bot ---------- */
  function probeClone(run) { var p = Object.assign({}, run); p.probe = true; p.rec = null; p.failed = false; return p; }
  function firstHazard(run, n) {
    var p = probeClone(run);
    for (var i = 0; i < n && p.t < C.RUN_TICKS; i++) { step(p, false); if (p.failed) return { t: p.t, x: p.x }; }
    return null;
  }
  // 점프(+d틱 뒤 2단 점프) 후 안전하게 착지한 상태. 실패하면 null
  function jumpLanding(state, d) {
    var p = probeClone(state), t0 = state.t;
    step(p, true);
    for (var i = 0; i < 160 && !p.failed && p.t < C.RUN_TICKS; i++) {
      if (p.grounded) return (d && p.t <= t0 + d) ? null : p;
      step(p, d > 0 && p.t === t0 + d);
    }
    return p.failed ? null : p;
  }
  var BOT_OPTS = [0, 8, 12, 16, 20, 26];
  function planJump(run, hz) {
    var states = [], p = probeClone(run), k, i, r;
    states.push(probeClone(p));
    for (k = run.t + 1; k < hz.t; k++) { step(p, false); if (p.failed) break; states.push(probeClone(p)); }
    for (k = states.length - 1; k >= 0; k--) {
      if (!canJump(states[k])) continue;
      for (i = 0; i < BOT_OPTS.length; i++) {
        r = jumpLanding(states[k], BOT_OPTS[i]);
        if (r && (r.x > hz.x || r.t >= C.RUN_TICKS)) return { t: states[k].t, d: BOT_OPTS[i] };
      }
    }
    for (k = 0; k < states.length; k++) {
      if (!canJump(states[k])) continue;
      for (i = 0; i < BOT_OPTS.length; i++) if (jumpLanding(states[k], BOT_OPTS[i])) return { t: states[k].t, d: BOT_OPTS[i] };
    }
    return { t: run.t, d: 14 };
  }
  /* skill: 0 느림, 1 보통, 2 빠름, 3 완벽 */
  var BOT_MISTAKE = [600, 350, 150, 0];
  function botInputs(seed, skill, diff) {
    var map = getMap(seed, diff), run = createRun(map, null);
    var rng = mulberry32(hash32((seed ^ (0xB0770000 + skill * 7919 + (map.diff << 4))) >>> 0));
    var plan = null, second = -1, mistake = BOT_MISTAKE[skill];
    while (run.t < C.RUN_TICKS) {
      var press = false;
      if (plan && plan.t < run.t) plan = null;
      if (!plan && second < 0 && canJump(run)) {
        var hz = firstHazard(run, 60);
        if (hz) {
          plan = planJump(run, hz);
          if (mistake && rint(rng, 1000) < mistake) {
            if (rint(rng, 2) === 0) plan.t += 3 + rint(rng, 6);
            else plan.d = plan.d ? 0 : 10;
          }
        }
      }
      if (plan && plan.t === run.t) { press = true; second = plan.d ? run.t + plan.d : -1; plan = null; }
      else if (second === run.t) { press = true; second = -1; }
      else if (second >= 0 && second < run.t) second = -1;
      step(run, press);
    }
    return run.rec.slice();
  }

  /* ---------- 6. codec ---------- */
  var PREFIX = 'GR2.';
  var NAME_RE = /^[가-힣A-Za-z0-9]{1,6}$/;
  function encodeRelay(r) {
    var b = [C.VERSION, (r.seed >>> 24) & 255, (r.seed >>> 16) & 255, (r.seed >>> 8) & 255, r.seed & 255,
      r.mapType & 255, r.diff & 255, (r.relayId >> 8) & 255, r.relayId & 255, r.runners.length];
    for (var i = 0; i < r.runners.length; i++) {
      var ru = r.runners[i], nb = utf8Encode(ru.name);
      if (nb.length > C.NAME_MAX_BYTES) throw new Error('name too long');
      b.push(nb.length); for (var k = 0; k < nb.length; k++) b.push(nb[k]);
      b.push(ru.hat & 255);
      writeVar(b, ru.inputs.length);
      var prev = 0;
      for (var j = 0; j < ru.inputs.length; j++) { writeVar(b, ru.inputs[j] - prev); prev = ru.inputs[j]; }
    }
    var crc = crc16(b, b.length);
    b.push(crc >> 8, crc & 255);
    return PREFIX + b64urlEncode(b);
  }
  var ERR = {
    NOT_CODE: '고스트 릴레이 코드가 아니에요. GR2. 로 시작하는 코드를 붙여넣어 주세요.',
    OLD: '예전 버전(길게 누르기 점프) 코드예요. 새 버전에서는 재생할 수 없어서, 새 릴레이를 시작해 주세요.',
    TRUNC: '코드가 잘렸어요. 끝부분까지 모두 복사했는지 확인해 주세요.',
    BROKEN: '코드가 잘렸거나 바뀌었어요. 끝부분까지 모두 복사했는지 확인해 주세요.',
    VERSION: '더 새로운 버전의 코드예요. 게임을 새로고침해 주세요.',
    BAD: '코드 내용이 올바르지 않아요.'
  };
  function decodeRelay(text) {
    text = text || '';
    var m = /GR2\.([A-Za-z0-9_-]+)/.exec(text);
    if (!m) return { ok: false, error: /GR1\.[A-Za-z0-9_-]{8,}/.test(text) ? ERR.OLD : ERR.NOT_CODE };
    var cands = [m[1]];
    var m2 = /GR2\.([A-Za-z0-9_\-\s]+)/.exec(text);
    if (m2) { var c2 = m2[1].replace(/\s+/g, ''); if (c2 !== m[1]) cands.push(c2); }
    var first = null;
    for (var c = 0; c < cands.length; c++) {
      var r = decodeBody(cands[c]);
      if (r.ok) return r;
      if (!first) first = r;
    }
    return first;
  }
  function decodeBody(body) {
    var b = b64urlDecode(body);
    if (!b || b.length < 13) return { ok: false, error: ERR.TRUNC };
    if (b[0] > C.VERSION) return { ok: false, error: ERR.VERSION };
    var crc = (b[b.length - 2] << 8) | b[b.length - 1];
    if (crc16(b, b.length - 2) !== crc) return { ok: false, error: ERR.BROKEN };
    var end = b.length - 2, p = 0;
    function u8() { if (p >= end) throw 'TRUNC'; return b[p++]; }
    function vint() { var n = 0, sh = 0, x; do { x = u8(); n += (x & 127) * Math.pow(2, sh); sh += 7; if (sh > 28) throw 'BAD'; } while (x & 128); return n; }
    try {
      if (u8() !== 2) throw 'OLD';
      var seed = ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
      var mapType = u8(), diff = u8(), relayId = (u8() << 8) | u8(), N = u8();
      if (N < 1 || N > C.MAX_RUNNERS || mapType > 1 || diff > 2) throw 'BAD';
      var runners = [];
      for (var i = 0; i < N; i++) {
        var nl = u8(); if (nl < 1 || nl > C.NAME_MAX_BYTES) throw 'BAD';
        var nb = []; for (var k = 0; k < nl; k++) nb.push(u8());
        var name;
        try { name = utf8Decode(nb); } catch (e) { throw 'BAD'; }
        name = name.replace(/[\u0000-\u001f\u007f<>&"']/g, '');
        if (!name || Array.from(name).length > C.NAME_MAX_CHARS) throw 'BAD';
        var hat = u8(); if (hat > 9) throw 'BAD';
        var J = vint(); if (J > C.MAX_JUMPS) throw 'BAD';
        var inputs = [], t = 0, prevT = -1;
        for (var j = 0; j < J; j++) { t += vint(); if (t <= prevT || t >= C.RUN_TICKS) throw 'BAD'; inputs.push(t); prevT = t; }
        runners.push({ name: name, hat: hat, inputs: inputs });
      }
      if (p !== end) throw 'BAD';
      return { ok: true, relay: { seed: seed, mapType: mapType, diff: diff, relayId: relayId, runners: runners }, completed: N >= C.MAX_RUNNERS };
    } catch (e) {
      return { ok: false, error: ERR[e] || ERR.BAD };
    }
  }
  function relayIdText(id) { return '#' + ('000' + id.toString(16).toUpperCase()).slice(-4); }
  function validName(s) { return NAME_RE.test(s); }

  return {
    C: C, F: F, S: S, DIFF: DIFF,
    mulberry32: mulberry32, hash32: hash32, crc16: crc16, b64urlEncode: b64urlEncode, b64urlDecode: b64urlDecode,
    getMap: getMap, generateMap: generateMap, mapName: mapName, seedForDate: seedForDate,
    createRun: createRun, step: step, canJump: canJump, canDouble: canDouble, speedAt: speedAt, scoreOf: scoreOf, distanceM: distanceM,
    summary: summary, stateBits: stateBits, simulate: simulate, evaluateRelay: evaluateRelay, rankOrder: rankOrder,
    botInputs: botInputs, encodeRelay: encodeRelay, decodeRelay: decodeRelay, relayIdText: relayIdText, validName: validName
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = GR;
