/* =====================================================================
 * GHOST RELAY — app v2 (render · audio · storage · progress · ui · main · selftest)
 * 그리기·소리·UI는 시뮬레이션 상태를 읽기만 한다.
 * ===================================================================== */
(function () {
  'use strict';
  var C = GR.C, F = GR.F, S = GR.S, FP = C.FP, GY = C.GROUND_Y, DIFF = GR.DIFF;
  var GAME_URL = 'https://choehanmin.github.io/ghost-relay/'; // 공유 문구에 들어가는 게임 주소
  var FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
  var HAT_COLORS = ['#FF5A5A', '#4D8BFF', '#FFE14D', '#4CD964', '#FF9F43', '#A66BFF', '#FF7AC6', '#FFFFFF', '#3D4BB8', '#9C6B3E'];
  var HAT_NAMES = ['빨강', '파랑', '노랑', '초록', '주황', '보라', '분홍', '흰색', '남색', '갈색'];
  var TICK_MS = 1000 / C.TPS;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- storage (막혀도 메모리로 동작) ---------- */
  var store = (function () {
    var mem = {};
    return {
      get: function (k, d) {
        try { var v = window.localStorage.getItem('gr_' + k); if (v !== null) return v; } catch (e) { /* blocked */ }
        return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : d;
      },
      set: function (k, v) {
        mem[k] = String(v);
        try { window.localStorage.setItem('gr_' + k, String(v)); } catch (e) { /* blocked */ }
      }
    };
  })();

  /* ---------- 8. audio (Web Audio 합성) ---------- */
  var Sound = (function () {
    var ac = null, sfxBus = null, musicBus = null, noiseBuf = null, voices = 0, bgmTimer = null, nextT = 0, stepI = 0;
    var on = store.get('sound', '1') === '1';
    function init() {
      if (ac) return ac;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        var comp = ac.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 8; comp.connect(ac.destination);
        var master = ac.createGain(); master.gain.value = 0.7; master.connect(comp);
        sfxBus = ac.createGain(); sfxBus.gain.value = 0.45; sfxBus.connect(master);
        musicBus = ac.createGain(); musicBus.gain.value = 0.14; musicBus.connect(master);
        noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.2, ac.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ac = null; }
      return ac;
    }
    function ready() { return on && ac && ac.state === 'running'; }
    function tone(type, f0, f1, dur, vol, delay, bus) {
      if (!ready() || voices > 12) return;
      var t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(bus || sfxBus);
      o.start(t); o.stop(t + dur + 0.03);
      voices++; o.onended = function () { voices--; };
    }
    function noise(dur, vol, delay) {
      if (!ready() || voices > 12) return;
      var t = ac.currentTime + (delay || 0), s = ac.createBufferSource(), g = ac.createGain();
      s.buffer = noiseBuf;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + dur + 0.02);
      voices++; s.onended = function () { voices--; };
    }
    var SFX = {
      jump: function () { tone('square', 280, 620, 0.08, 0.18); },
      double: function () { tone('square', 520, 1180, 0.09, 0.16); tone('triangle', 1400, 0, 0.06, 0.12, 0.04); },
      plat: function () { tone('triangle', 660, 0, 0.05, 0.18); tone('triangle', 990, 0, 0.08, 0.18, 0.05); },
      land: function () { noise(0.04, 0.12); },
      star: function () { tone('triangle', 1320, 0, 0.06, 0.25); tone('triangle', 1760, 0, 0.08, 0.25, 0.05); },
      sync: function () { tone('triangle', 1320, 0, 0.06, 0.22); tone('triangle', 1660, 0, 0.07, 0.22, 0.04); tone('triangle', 1980, 0, 0.1, 0.22, 0.08); },
      rescue: function () { tone('square', 784, 0, 0.07, 0.14); tone('square', 988, 0, 0.07, 0.14, 0.07); tone('square', 1319, 0, 0.12, 0.14, 0.14); },
      stumble: function () { tone('square', 220, 90, 0.2, 0.2); noise(0.08, 0.15); },
      beep: function () { tone('square', 660, 0, 0.12, 0.16); },
      go: function () { tone('square', 990, 0, 0.25, 0.18); },
      tick: function () { tone('square', 1500, 0, 0.03, 0.12); },
      ui: function () { tone('triangle', 880, 0, 0.05, 0.12); },
      win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone('square', f, 0, 0.14, 0.13, i * 0.1); }); }
    };
    function sfx(name) { if (SFX[name]) SFX[name](); }
    function midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }
    var BASS = [45, 41, 48, 43];
    var LEAD = [69, -1, 72, -1, 76, -1, 74, 72, 69, -1, -1, 65, 69, -1, 72, -1, 67, -1, 72, -1, 76, -1, 79, 76, 74, -1, 71, -1, 67, -1, -1, -1];
    var STEP = 60 / 140 / 2;
    function schedule() {
      if (!ready()) return;
      while (nextT < ac.currentTime + 0.25) {
        var d = nextT - ac.currentTime, i = stepI % 32, root = BASS[i >> 3];
        tone('triangle', midi(i % 2 ? root + 12 : root), 0, STEP * 0.9, 0.5, d, musicBus);
        if (LEAD[i] > 0) tone('square', midi(LEAD[i]), 0, STEP * 0.85, 0.22, d, musicBus);
        nextT += STEP; stepI++;
      }
    }
    function startBgm() {
      if (bgmTimer || !ready()) return;
      nextT = ac.currentTime + 0.05; stepI = 0;
      bgmTimer = setInterval(schedule, 60);
    }
    function stopBgm() { if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } }
    function unlock() {
      if (!on) return;
      init();
      if (!ac) return;
      if (ac.state === 'suspended') ac.resume().then(startBgm).catch(function () {});
      else startBgm();
    }
    function setOn(v) { on = v; store.set('sound', v ? '1' : '0'); if (!v) stopBgm(); else unlock(); }
    return { sfx: sfx, unlock: unlock, setOn: setOn, isOn: function () { return on; } };
  })();



  /* ---------- 날짜·맵 ---------- */
  function kstYmd() {
    var d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }
  function dailySeed() { return GR.seedForDate(kstYmd()); }
  function randId() { return Math.floor(Math.random() * 65536); }
  function mapKey(relay) { return (relay.mapType === 0 ? 'm' + relay.seed : 'free') + '_' + relay.diff; }
  function mapLabel(relay) {
    return (relay.mapType === 0 ? (relay.seed === dailySeed() ? '오늘의 맵' : '날짜 맵') + ' · ' + GR.mapName(relay.seed) : '자유 맵') + ' · ' + DIFF[relay.diff].name;
  }

  /* ---------- 성장: 레벨 · 미션 · 모자 · 기록 ---------- */
  var MISSIONS = [
    { id: 'stars', n: [12, 16, 20], text: function (n) { return '한 판에 별 ' + n + '개 먹기'; }, ok: function (r, i, n) { return r.stars >= n; } },
    { id: 'dbl', n: [6, 10, 14], text: function (n) { return '한 판에 2단 점프 ' + n + '번'; }, ok: function (r, i, n) { return r.doubles >= n; } },
    { id: 'plat', n: [1, 2, 3], text: function (n) { return '높은 발판에 ' + n + '번 올라서기'; }, ok: function (r, i, n) { return r.platLands >= n; } },
    { id: 'clean', n: [0], text: function () { return '멈칫 없이 끝까지 달리기'; }, ok: function (r) { return r.stumbles + r.falls === 0; } },
    { id: 'dist', n: [280, 320, 360], text: function (n) { return '한 판에 ' + n + 'm 달리기'; }, ok: function (r, i, n) { return r.distance >= n; } },
    { id: 'sync', n: [2, 3, 5], text: function (n) { return '유령과 싱크 ' + n + '회'; }, ok: function (r, i, n) { return r.syncs >= n; } },
    { id: 'rescue', n: [1, 2], text: function (n) { return '금색 별 구조 ' + n + '회'; }, ok: function (r, i, n) { return r.rescues >= n; } },
    { id: 'join', n: [0], text: function () { return '친구 릴레이에 이어 달리기'; }, ok: function (r, i) { return i.joined; } },
    { id: 'hard', n: [0], text: function () { return '어려움 난이도로 달리기'; }, ok: function (r, i) { return i.diff === 2; } }
  ];
  var MISSION_XP = 120;
  var Prog = (function () {
    function fresh() { return { xp: 0, runs: 0, stars: 0, dist: 0, syncs: 0, rescues: 0, doubles: 0, best: {}, hat: 0, mis: { d: 0, done: [] }, hist: [] }; }
    var p = fresh();
    try { var raw = store.get('prog', ''); if (raw) p = Object.assign(fresh(), JSON.parse(raw)); } catch (e) { p = fresh(); }
    function save() { store.set('prog', JSON.stringify(p)); }
    function lvInfo(xp) { var lv = 1, need = 300; while (xp >= need) { xp -= need; lv++; need = 300 + (lv - 1) * 150; } return { lv: lv, cur: xp, need: need }; }
    function hatLv(i) { return Math.max(1, i - 1); }
    function missions(ymd) {
      var rng = GR.mulberry32(GR.hash32(ymd ^ 0x3A5C)), pool = MISSIONS.slice(), out = [];
      while (out.length < 3) {
        var m = pool.splice(rng() % pool.length, 1)[0], n = m.n[rng() % m.n.length];
        out.push({ id: m.id, n: n, text: m.text(n), ok: (function (mm, nn) { return function (r, info) { return mm.ok(r, info, nn); }; })(m, n) });
      }
      return out;
    }
    function today() { var y = kstYmd(); if (p.mis.d !== y) p.mis = { d: y, done: [] }; return p.mis; }
    function addRun(res, info) {
      var before = lvInfo(p.xp).lv, gain = Math.max(0, res.score), done = [], st = today();
      missions(st.d).forEach(function (m) {
        if (st.done.indexOf(m.id) < 0 && m.ok(res, info)) { st.done.push(m.id); gain += MISSION_XP; done.push(m.text); }
      });
      p.xp += gain; p.runs++; p.stars += res.stars; p.dist += res.distance; p.syncs += res.syncs; p.rescues += res.rescues; p.doubles += res.doubles;
      var prev = p.best[info.key] ? p.best[info.key].s : 0, newBest = res.score > prev;
      if (newBest) p.best[info.key] = { s: res.score, label: info.label };
      var after = lvInfo(p.xp).lv, hats = [];
      for (var i = 0; i < 10; i++) if (hatLv(i) > before && hatLv(i) <= after) hats.push(i);
      save();
      return { gain: gain, done: done, levelUp: after > before, lv: after, newHats: hats, newBest: newBest, prevBest: prev };
    }
    function addHist(h) {
      p.hist = p.hist.filter(function (x) { return x.code !== h.code; });
      p.hist.unshift(h); p.hist = p.hist.slice(0, 12); save();
    }
    return { p: p, save: save, lvInfo: lvInfo, hatLv: hatLv, missions: missions, today: today, addRun: addRun, addHist: addHist };
  })();
  function myLevel() { return Prog.lvInfo(Prog.p.xp).lv; }
  function myHat() { var h = Prog.p.hat | 0; return Prog.hatLv(h) <= myLevel() ? h : 0; }

  /* ---------- 화면 크기 (세로·가로 모두 지원) ---------- */
  var cv = $('game'), cx = cv.getContext('2d');
  var BS = 2, L = { W: 256, H: 448, GSY: 327, PSX: 64, land: false };
  function computeLayout() {
    var vw = window.innerWidth || 390, vh = window.innerHeight || 844, a = vw / vh;
    if (a >= 1.05) {
      L.land = true; L.H = 288; L.W = Math.max(420, Math.min(620, Math.round(288 * a)));
      L.GSY = L.H - 58; L.PSX = Math.round(L.W * 0.22);
    } else {
      L.land = false; L.W = 256; L.H = Math.max(380, Math.min(560, Math.round(256 / a)));
      L.GSY = L.H - Math.max(112, Math.round(L.H * 0.27)); L.PSX = 64;
    }
  }

  /* ---------- 스프라이트 · 폰트 ---------- */
  var TOP_HAT = ['............', '...HHHHHH...', '..HHHHHHHHH.'];
  var BODY = ['...BBBBBB...', '..BBBBBBBB..', '.BBFFFFFFBB.', '.BFFWWFWWFB.', '.BFFWPFWPFB.', '.BFFFFFFFFB.',
    '..BBFFFFBB..', '..bBBBBBBb..', '.bBBBBBBBBb.', '..BBBBBBBB..'];
  var LEGS = {
    run0: ['...LL..LL...', '...LL..LL...', '..LLL..LLL..'],
    run1: ['..LL....LL..', '.LL......LL.', '.L........L.'],
    run2: ['....LLLL....', '....LL.LL...', '...LLL.LLL..'],
    run3: ['...LL..LL...', '..LL....LLL.', '.LLL........'],
    jump: ['..LL...LL...', '..L.....LL..', '............'],
    fall: ['...LL..LL...', '...L....L...', '..LL....LL..'],
    spin: ['.LL......LL.', '..LL....LL..', '............']
  };
  var PAL = {
    me: { B: '#C6F432', b: '#7A9A1C', F: '#1E2A0A', W: '#FFFFFF', P: '#0B0D0A', L: '#7A9A1C' },
    ghost: { B: '#7FE7FF', b: '#3FA8C8', F: '#123C48', W: '#FFFFFF', P: '#0B0D0A', L: '#3FA8C8' },
    gold: { B: '#FFD34D', b: '#C99A1E', F: '#4A3A0A', W: '#FFFFFF', P: '#0B0D0A', L: '#C99A1E' },
    bot: { B: '#8A8F85', b: '#5E625A', F: '#2A2C28', W: '#D8DAD5', P: '#0B0D0A', L: '#5E625A' }
  };
  var STAR = ['...YY...', '..YYYY..', 'YYYYYYYY', '.YYYYYY.', '..YYYY..', '.YY..YY.', 'YY....YY', '........'];
  var sprites = {}, starSprite = null, starGold = null;
  function paint(rows, pal) {
    var c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length;
    var g = c.getContext('2d');
    for (var y = 0; y < rows.length; y++) for (var x = 0; x < rows[y].length; x++) {
      var col = pal[rows[y][x]];
      if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
    }
    return c;
  }
  function getSprite(kind, hat, pose) {
    var key = kind + ':' + hat + ':' + pose;
    if (!sprites[key]) {
      var pal = Object.assign({}, PAL[kind]);
      pal.H = kind === 'bot' ? '#5E625A' : (HAT_COLORS[hat] || HAT_COLORS[0]);
      sprites[key] = paint(TOP_HAT.concat(BODY, LEGS[pose]), pal);
    }
    return sprites[key];
  }
  function ensureStars() { if (!starSprite) { starSprite = paint(STAR, { Y: '#C6F432' }); starGold = paint(STAR, { Y: '#FFD34D' }); } }

  /* 5×7 픽셀 폰트 (숫자·영문 로고·HUD용) */
  var GLYPHS = {
    '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110',
    '2': '01110100010000100010001000100011111', '3': '11110000010000101110000010000111110',
    '4': '00010001100101010010111110001000010', '5': '11111100001111000001000011000101110',
    '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000',
    '8': '01110100011000101110100011000101110', '9': '01110100011000101111000010001001100',
    A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110',
    C: '01110100011000010000100001000101110', D: '11110100011000110001100011000111110',
    E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
    G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
    I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100',
    K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
    M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001',
    O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
    Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
    S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
    U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100',
    W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
    Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111',
    ':': '00000011000110000000011000110000000', '!': '00100001000010000100001000000000100',
    '+': '00000001000010011111001000010000000', '-': '00000000000000011111000000000000000',
    '/': '00001000100001000100010000100010000', '.': '00000000000000000000000000110001100',
    '#': '01010010101111101010111110101001010', 'x': '00000000001000101010001000101010001', ' ': ''
  };
  function pxText(str, x, y, sc, color, align) {
    str = String(str);
    var w = str.length * 6 * sc - sc;
    if (align === 'center') x -= Math.floor(w / 2); else if (align === 'right') x -= w;
    cx.fillStyle = color;
    for (var i = 0; i < str.length; i++) {
      var g = GLYPHS[str[i]] || GLYPHS[str[i].toUpperCase()];
      if (g) for (var p = 0; p < 35; p++) if (g.charCodeAt(p) === 49) cx.fillRect(x + (p % 5) * sc, y + Math.floor(p / 5) * sc, sc, sc);
      x += 6 * sc;
    }
    return w;
  }
  function krText(str, x, y, size, color, align, outline) {
    cx.font = '800 ' + size + 'px ' + FONT;
    cx.textAlign = align || 'left'; cx.textBaseline = 'middle';
    if (outline) { cx.lineWidth = 2.5; cx.strokeStyle = 'rgba(11,13,10,0.9)'; cx.strokeText(str, x, y); }
    cx.fillStyle = color; cx.fillText(str, x, y);
  }

  /* ---------- 월드 그리기 (월드 좌표, 변환은 drawScene이 설정) ---------- */
  var VIS = { w: 256 };
  var FAR = [], MID = [], FAR_P = 1024, MID_P = 768;
  (function () {
    var r = GR.mulberry32(20261113), x = 0, i;
    while (x < FAR_P) { var w = 24 + r() % 40, h = 50 + r() % 110; FAR.push({ x: x, w: w, h: h, win: r() }); x += w + 2 + r() % 10; }
    var cols = ['#FF4FD8', '#7FE7FF', '#C6F432', '#FFD34D', '#A66BFF'];
    for (i = 0, x = 20; x < MID_P; i++) { MID.push({ x: x, y: 150 + r() % 110, w: 10 + r() % 22, h: 4 + r() % 8, c: cols[r() % cols.length], ph: r() % 100 }); x += 30 + r() % 60; }
  })();
  function drawBackground(camX, time, yTop, yBot) {
    var Wv = VIS.w, x, i, rep;
    cx.fillStyle = '#0B0D0A'; cx.fillRect(0, yTop, Wv, yBot - yTop);
    cx.fillStyle = 'rgba(198,244,50,0.03)';
    var off = -(Math.floor(camX * 0.5) % 16);
    for (x = off; x < Wv; x += 16) cx.fillRect(x, yTop, 1, yBot - yTop);
    for (var y = Math.floor(yTop / 16) * 16; y < yBot; y += 16) cx.fillRect(0, y, Wv, 1);
    var fo = Math.floor(camX * 0.2) % FAR_P;
    for (rep = 0; rep < 2; rep++) for (i = 0; i < FAR.length; i++) {
      var b = FAR[i], bx = b.x - fo + rep * FAR_P;
      if (bx > Wv || bx + b.w < 0) continue;
      cx.fillStyle = '#121710'; cx.fillRect(bx, GY - b.h, b.w, b.h);
      cx.fillStyle = 'rgba(255,211,77,0.10)';
      for (var wy = GY - b.h + 6; wy < GY - 10; wy += 8) for (var wx = bx + 4; wx < bx + b.w - 4; wx += 6)
        if (((b.win >>> ((wx - bx + wy) % 29)) & 3) === 0) cx.fillRect(wx, wy, 2, 3);
    }
    var mo = Math.floor(camX * 0.5) % MID_P;
    for (rep = 0; rep < 2; rep++) for (i = 0; i < MID.length; i++) {
      var m = MID[i], mx = m.x - mo + rep * MID_P;
      if (mx > Wv || mx + m.w < 0) continue;
      var flick = ((Math.floor(time / 90) + m.ph) % 37) === 0 ? 0.15 : 0.5;
      cx.globalAlpha = flick * 0.5; cx.fillStyle = m.c; cx.fillRect(mx - 1, m.y - 1, m.w + 2, m.h + 2);
      cx.globalAlpha = flick; cx.fillRect(mx, m.y, m.w, m.h);
      cx.globalAlpha = 1; cx.fillStyle = '#1A1F16'; cx.fillRect(mx + (m.w >> 1), m.y + m.h, 1, GY - m.y - m.h);
    }
  }
  function drawGround(map, camX, yBot) {
    var Wv = VIS.w, x0 = Math.floor(camX);
    cx.fillStyle = '#141A10'; cx.fillRect(0, GY, Wv, yBot - GY);
    cx.fillStyle = '#1C2416';
    for (var tx = -(x0 % 16); tx < Wv; tx += 16) cx.fillRect(tx, GY + 2, 1, yBot - GY);
    for (var ty = GY + 10; ty < yBot; ty += 12) cx.fillRect(0, ty, Wv, 1);
    cx.fillStyle = '#4C5E22'; cx.fillRect(0, GY, Wv, 2);
    var hs = map.holes;
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i]; if (h.x1 < camX || h.x0 > camX + Wv) continue;
      var sx = Math.round(h.x0 - camX), w = h.x1 - h.x0;
      cx.fillStyle = '#050605'; cx.fillRect(sx, GY, w, yBot - GY);
      cx.fillStyle = '#2A3418'; cx.fillRect(sx - 1, GY, 1, yBot - GY); cx.fillRect(sx + w, GY, 1, yBot - GY);
      cx.fillStyle = 'rgba(255,107,107,0.35)'; cx.fillRect(sx, GY + 2, w, 1);
    }
  }
  function drawPlats(map, camX) {
    var P = map.plats;
    for (var i = 0; i < P.length; i++) {
      var p = P[i]; if (p.x + p.w < camX || p.x > camX + VIS.w) continue;
      var x = Math.round(p.x - camX);
      cx.fillStyle = 'rgba(127,231,255,0.10)'; cx.fillRect(x + 4, p.y + 4, 2, GY - p.y - 4); cx.fillRect(x + p.w - 6, p.y + 4, 2, GY - p.y - 4);
      cx.fillStyle = '#16303A'; cx.fillRect(x, p.y, p.w, 4);
      cx.fillStyle = '#7FE7FF'; cx.fillRect(x, p.y, p.w, 1);
      cx.fillStyle = '#3FA8C8'; for (var k = x + 3; k < x + p.w - 2; k += 6) cx.fillRect(k, p.y + 2, 2, 1);
    }
  }
  function drawObstacles(map, camX, time) {
    var O = map.obs;
    for (var i = 0; i < O.length; i++) {
      var o = O[i]; if (o.x + o.w < camX - 4 || o.x > camX + VIS.w + 4) continue;
      var x = Math.round(o.x - camX), y = o.y;
      if (o.type === 'low' || o.type === 'tall') {
        cx.fillStyle = '#1A0F2A'; cx.fillRect(x, y, o.w, o.h);
        cx.fillStyle = '#6E3FA0';
        for (var k = 2; k < o.h - 2; k += 2) { cx.fillRect(x + 2 + Math.floor((k - 2) * (o.w - 4) / (o.h - 4)), y + k, 1, 1); cx.fillRect(x + o.w - 3 - Math.floor((k - 2) * (o.w - 4) / (o.h - 4)), y + k, 1, 1); }
        if (o.type === 'tall') cx.fillRect(x + 1, y + 15, o.w - 2, 1);
        cx.fillStyle = o.type === 'tall' ? '#FF9FE8' : '#C77DFF';
        cx.fillRect(x, y, o.w, 1); cx.fillRect(x, y + o.h - 1, o.w, 1); cx.fillRect(x, y, 1, o.h); cx.fillRect(x + o.w - 1, y, 1, o.h);
      } else if (o.type === 'spike') {
        for (var t = 0; t < o.w; t += 8) for (var r = 0; r < 8; r++) {
          var w = Math.min(8, 2 * (r >> 1) + 2);
          cx.fillStyle = r === 7 ? '#8A2F2F' : '#FF6B6B';
          cx.fillRect(x + t + ((8 - w) >> 1), y + r, w, 1);
        }
      } else if (o.type === 'sign') {
        cx.fillStyle = '#3A3F35'; cx.fillRect(x + 8, y + 14, 4, o.h - 14);
        cx.fillStyle = '#2A0F22'; cx.fillRect(x, y, o.w, 14);
        var on = (Math.floor(time / 120) % 13) !== 0;
        cx.fillStyle = on ? '#FF4FD8' : '#7A2A66';
        cx.fillRect(x, y, o.w, 1); cx.fillRect(x, y + 13, o.w, 1); cx.fillRect(x, y, 1, 14); cx.fillRect(x + o.w - 1, y, 1, 14);
        cx.fillStyle = on ? '#FFC2F0' : '#7A2A66';
        cx.fillRect(x + 4, y + 4, 4, 2); cx.fillRect(x + 10, y + 4, 6, 2); cx.fillRect(x + 4, y + 8, 12, 2);
      }
    }
  }
  /* 별: 깜빡임 없이 항상 같은 모습. 금색 = 앞 주자 아무도 못 먹은 별(구조 가능) */
  function drawStars(map, camX, got, prior) {
    ensureStars();
    var St = map.stars;
    for (var i = 0; i < St.length; i++) {
      var s = St[i]; if (s.x + 8 < camX || s.x > camX + VIS.w) continue;
      if (got && got[i]) continue;
      var x = Math.round(s.x - camX), gold = prior && !prior[i];
      cx.fillStyle = gold ? 'rgba(255,211,77,0.22)' : 'rgba(198,244,50,0.16)';
      cx.fillRect(x - 2, s.y - 2, 12, 12);
      cx.drawImage(gold ? starGold : starSprite, x, s.y);
    }
  }
  function poseFor(st, wx) {
    if (st & S.FALL) return 'fall';
    if (!(st & S.GROUND)) return (st & S.RISING) ? ((st & S.DOUBLE) ? 'spin' : 'jump') : 'fall';
    return 'run' + ((Math.floor(wx / 7)) % 4);
  }
  function drawRunner(kind, hat, wx, wy, st, camX, alpha) {
    if ((st & S.STUMBLE) && (G.frameNo >> 2) % 2) alpha *= 0.35;
    var sx = Math.round(wx - camX), sy = Math.round(wy);
    if (sx < -16 || sx > VIS.w + 4) return;
    cx.globalAlpha = alpha;
    cx.drawImage(getSprite(kind, hat, poseFor(st, wx)), sx, sy);
    cx.globalAlpha = 1;
  }
  function nameTag(text, sx, sy, color, bg) {
    cx.font = '700 7px ' + FONT;
    var w = Math.ceil(cx.measureText(text).width) + 6;
    sx = Math.max(w / 2 + 1, Math.min(VIS.w - w / 2 - 1, sx)); // 화면 밖으로 잘리지 않게
    cx.fillStyle = bg || 'rgba(11,13,10,0.62)';
    cx.fillRect(Math.round(sx - w / 2), sy - 5, w, 10);
    cx.fillStyle = color; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(text, Math.round(sx), sy);
  }
  function frameAt(fr, i) { i = Math.max(0, Math.min(C.RUN_TICKS, i)); return { x: fr.x[i] / FP, y: fr.y[i] / FP, st: fr.st[i] }; }
  function ghostColor(g) { return g.kind === 'gold' ? '#FFD34D' : g.kind === 'bot' ? '#8A8F85' : '#7FE7FF'; }
  function drawGhosts(list, t, camX, showTags, tags) {
    for (var gi = list.length - 1; gi >= 0; gi--) {
      var g = list[gi], f = frameAt(g.frames, t), alpha = g.kind === 'bot' ? 0.45 : 0.55;
      var a1 = frameAt(g.frames, t - 3), a2 = frameAt(g.frames, t - 6);
      drawRunner(g.kind, g.hat, a2.x, a2.y, a2.st, camX, alpha * 0.22);
      drawRunner(g.kind, g.hat, a1.x, a1.y, a1.st, camX, alpha * 0.4);
      drawRunner(g.kind, g.hat, f.x, f.y, f.st, camX, alpha);
      if (!showTags) continue;
      var sx = Math.round(f.x - camX) + 6, label = g.kind === 'bot' ? g.name.replace('연습봇 ', 'BOT ') : g.name, col = ghostColor(g);
      if (sx < -4) { edgeArrow(2, 1, f.y, col); tags.push({ key: 'g' + gi, x: 6, y: f.y + 8, text: '◀ ' + label, color: col, pri: 3, fixed: true }); }
      else if (sx > VIS.w + 4) { edgeArrow(VIS.w - 3, -1, f.y, col); tags.push({ key: 'g' + gi, x: VIS.w - 6, y: f.y + 8, text: label + ' ▶', color: col, pri: 3, fixed: true }); }
      else tags.push({ key: 'g' + gi, x: sx, y: f.y - 6, text: label, color: col, pri: g.kind === 'gold' ? 1 : 2 });
    }
  }
  function edgeArrow(x, dir, y, col) {
    cx.fillStyle = col; cx.globalAlpha = 0.8;
    cx.fillRect(x, y + 4, 1, 7); cx.fillRect(x + dir, y + 5, 1, 5); cx.fillRect(x + 2 * dir, y + 6, 1, 3);
    cx.globalAlpha = 1;
  }
  // 닉네임 태그: 겹치지 않게 최대 4줄. 지난 프레임 줄을 먼저 써서 깜빡이지 않게 하고, 자리가 없어도 숨기지 않는다.
  var tagRows = {};
  function drawTags(tags) {
    cx.font = '700 7px ' + FONT;
    tags.sort(function (a, b) { return a.pri - b.pri; });
    var placed = [];
    for (var i = 0; i < tags.length; i++) {
      var tg = tags[i], w = Math.ceil(cx.measureText(tg.text).width) + 6;
      var cxp = tg.fixed ? (tg.x < VIS.w / 2 ? tg.x + w / 2 : tg.x - w / 2) : Math.max(w / 2 + 1, Math.min(VIS.w - w / 2 - 1, tg.x));
      var order = [0, 1, 2, 3], last = tagRows[tg.key];
      if (last !== undefined) { order.splice(order.indexOf(last), 1); order.unshift(last); }
      var chosen = -1;
      for (var oi = 0; oi < order.length; oi++) {
        var row = order[oi], y = tg.y - row * 10, x0 = cxp - w / 2, x1 = cxp + w / 2, hit = false;
        for (var k = 0; k < placed.length; k++) { var q = placed[k]; if (x0 < q.x1 + 1 && x1 > q.x0 - 1 && Math.abs(y - q.y) < 10) { hit = true; break; } }
        if (!hit) { chosen = row; break; }
      }
      var faded = chosen < 0;
      if (faded) chosen = last !== undefined ? last : 0;
      tagRows[tg.key] = chosen;
      var yy = tg.y - chosen * 10;
      placed.push({ x0: cxp - w / 2, x1: cxp + w / 2, y: yy });
      cx.globalAlpha = faded ? 0.5 : (tg.pri === 0 ? 1 : 0.88);
      nameTag(tg.text, cxp, yy, tg.color, tg.pri === 0 ? 'rgba(11,13,10,0.8)' : null);
      cx.globalAlpha = 1;
    }
  }

  /* 이펙트 (그리기 전용, 줄마다 따로) */
  function makeFx() { return { parts: [], pops: [] }; }
  function puff(fx, wx, wy, color, n, spread) {
    for (var i = 0; i < n; i++) fx.parts.push({ x: wx, y: wy, vx: (Math.random() - 0.5) * spread, vy: -Math.random() * spread * 0.6, life: 1, color: color });
  }
  function popup(fx, wx, wy, text, color, big) { fx.pops.push({ x: wx, y: wy, text: text, color: color, life: 1, big: !!big }); }
  function updateFx(fx, dt) {
    var k = dt / 1000, i;
    for (i = fx.parts.length - 1; i >= 0; i--) {
      var p = fx.parts[i]; p.x += p.vx * k * 60; p.y += p.vy * k * 60; p.vy += 0.05 * k * 60; p.life -= k * 2.2;
      if (p.life <= 0) fx.parts.splice(i, 1);
    }
    for (i = fx.pops.length - 1; i >= 0; i--) { fx.pops[i].life -= k * 1.1; fx.pops[i].y -= k * 22; if (fx.pops[i].life <= 0) fx.pops.splice(i, 1); }
  }
  function drawFx(fx, camX) {
    for (var i = 0; i < fx.parts.length; i++) {
      var p = fx.parts[i]; cx.globalAlpha = Math.max(0, p.life); cx.fillStyle = p.color;
      cx.fillRect(Math.round(p.x - camX), Math.round(p.y), 2, 2);
    }
    cx.globalAlpha = 1;
    for (i = 0; i < fx.pops.length; i++) {
      var q = fx.pops[i]; cx.globalAlpha = Math.min(1, q.life * 2);
      krText(q.text, Math.round(q.x - camX), Math.round(q.y), q.big ? 10 : 8, q.color, 'center', true);
    }
    cx.globalAlpha = 1;
  }

  /* 한 장면(또는 한 줄)을 그린다: 줄 영역 [y0, y0+h], 배율 k, 줄 안 땅 높이 gsy */
  function drawScene(sc) {
    var k = sc.k || 1, y0 = sc.y0 || 0, h = sc.h || L.H, offY = sc.gsy - GY * k;
    cx.save();
    cx.setTransform(BS, 0, 0, BS, 0, 0);
    cx.beginPath(); cx.rect(0, y0, L.W, h); cx.clip();
    cx.setTransform(BS * k, 0, 0, BS * k, 0, BS * offY);
    VIS.w = L.W / k;
    var yTop = (y0 - offY) / k, yBot = (y0 + h - offY) / k, tags = [];
    drawBackground(sc.camX, G.time, yTop, yBot);
    if (sc.speedT !== undefined) speedLines(sc.speedT, sc.camX, sc.map.diff);
    drawGround(sc.map, sc.camX, yBot);
    drawPlats(sc.map, sc.camX);
    drawObstacles(sc.map, sc.camX, G.time);
    if (sc.ghosts) drawGhosts(sc.ghosts, sc.t, sc.camX, sc.tags, tags);
    if (sc.others) sc.others.forEach(function (o) { drawRunner('ghost', o.hat, o.x, o.y, o.st, sc.camX, 0.3); });
    drawStars(sc.map, sc.camX, sc.got, sc.prior);
    if (sc.me) {
      drawRunner('me', sc.me.hat, sc.me.x, sc.me.y, sc.me.st, sc.camX, 1);
      if (sc.tags) tags.push({ key: 'me', x: sc.me.x - sc.camX + 6, y: sc.me.y - 7, text: sc.me.name, color: '#C6F432', pri: 0 });
    }
    if (tags.length) drawTags(tags);
    if (sc.fx) drawFx(sc.fx, sc.camX);
    cx.restore();
    VIS.w = L.W;
  }
  function speedLines(t, camX, diff) {
    if (GR.speedAt(Math.min(t, C.RUN_TICKS - 1), diff) < 700) return;
    cx.fillStyle = 'rgba(242,242,242,0.10)';
    for (var i = 0; i < 7; i++) { var y = 180 + ((i * 53) % 130), x = VIS.w - ((Math.floor(camX * 2) + i * 97) % (VIS.w + 40)); cx.fillRect(x, y, 18 + (i % 3) * 8, 1); }
  }
  function screenMode() { cx.setTransform(BS, 0, 0, BS, 0, 0); cx.imageSmoothingEnabled = false; }

  /* ---------- 게임 상태 ---------- */
  var G = {
    mode: 'title', kind: 'solo', view: 'demo', name: store.get('name', ''), runName: '',
    base: null, map: null, ghosts: [], ctx: null, prior: null, run: null, fx: makeFx(), maxX: 6000 * FP,
    cdStart: 0, cdPhase: -1, acc: 0, demo: null, demoT: 0, watch: null, watchT: 0, result: null, frameNo: 0, time: 0,
    multi: null, joined: false, myHat: 0
  };
  var botCache = {};
  var BOT_DEF = [{ name: '연습봇 느림', skill: 0 }, { name: '연습봇 보통', skill: 1 }, { name: '연습봇 빠름', skill: 2 }];
  function practiceBots(seed, diff) {
    var key = seed + ':' + diff;
    if (!botCache[key]) botCache[key] = BOT_DEF.map(function (b) {
      var r = GR.simulate(seed, GR.botInputs(seed, b.skill, diff), null, true, diff);
      return { name: b.name, hat: -1, kind: 'bot', frames: r.frames, score: r.score, distance: r.distance, isBot: true };
    });
    return botCache[key];
  }
  function setupDemo() {
    var seed = dailySeed();
    var hero = GR.simulate(seed, GR.botInputs(seed, 3, 1), null, true, 1);
    G.demo = { seed: seed, map: GR.getMap(seed, 1), hero: hero.frames, ghosts: practiceBots(seed, 1) };
    G.demoT = 0;
  }

  /* ---------- HUD ---------- */
  function timeText(t) { var left = Math.max(0, C.RUN_TICKS - t), secs = Math.ceil(left / C.TPS); return { s: '00:' + (secs < 10 ? '0' : '') + secs, red: left > 0 && secs <= 5 }; }
  function drawHUD(t, score, rank, dots) {
    var tt = timeText(t), W = L.W;
    cx.fillStyle = 'rgba(11,13,10,0.55)'; cx.fillRect(0, 0, W, 50);
    pxText(tt.s, W / 2, 9, 3, tt.red ? '#FF6B6B' : '#F2F2F2', 'center');
    pxText(score === null ? 'REPLAY' : 'SCORE', 10, 9, 1, '#8A8F85');
    if (score !== null) pxText(score, 10, 19, 2, '#C6F432');
    if (rank) { pxText('RANK', W - 10, 9, 1, '#8A8F85', 'right'); pxText(rank, W - 10, 19, 2, '#7FE7FF', 'right'); }
    var bx = 16, bw = W - 32, by = 40;
    cx.fillStyle = '#1E2618'; cx.fillRect(bx, by, bw, 3);
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i], px = bx + Math.min(bw - 1, Math.floor((d.x / G.maxX) * bw));
      cx.fillStyle = d.c; cx.fillRect(px - 1, by - 1, 3, 5);
    }
  }
  function ghostDots(list, t) {
    var out = [];
    for (var i = 0; i < list.length; i++) out.push({ x: list[i].frames.x[Math.min(C.RUN_TICKS, t)], c: ghostColor(list[i]) });
    out.sort(function (a, b) { return (a.c === '#FFD34D') - (b.c === '#FFD34D'); });
    return out;
  }
  function drawLogo() {
    var W = L.W, sc = L.land ? 3 : 4, y0 = L.land ? 18 : Math.max(36, L.GSY - 262);
    pxText('GHOST', W / 2 + 2, y0 + 2, sc, 'rgba(127,231,255,0.35)', 'center');
    pxText('GHOST', W / 2, y0, sc, '#C6F432', 'center');
    var y1 = y0 + sc * 9;
    pxText('RELAY', W / 2 + 3, y1 + 2, sc, 'rgba(198,244,50,0.25)', 'center');
    pxText('RELAY', W / 2, y1, sc, '#7FE7FF', 'center');
    var y2 = y1 + sc * 7 + (L.land ? 12 : 16);
    krText('고스트 릴레이', W / 2, y2, L.land ? 10 : 11, '#F2F2F2', 'center');
    krText('친구의 유령과 함께 달리는 40초 릴레이', W / 2, y2 + 14, 7.5, '#8A8F85', 'center');
  }
  function drawCountdown(label, top) {
    var el = performance.now() - G.cdStart, ph = Math.floor(el / 600), W = L.W, H = L.H;
    var big = ph < 3 ? String(3 - ph) : 'GO!', sc = ph < 3 ? 9 : 7, cyy = Math.round(H * 0.4);
    krText(top, W / 2, L.land ? 64 : 66, 9, '#F2F2F2', 'center', true);
    pxText(big, W / 2 + 2, cyy + 2, sc, 'rgba(11,13,10,0.8)', 'center');
    pxText(big, W / 2, cyy, sc, ph < 3 ? '#F2F2F2' : '#C6F432', 'center');
    krText(label, W / 2, H - (L.land ? 34 : 46), 9, '#C6F432', 'center', true);
    krText(G.kind === 'multi' ? '자기 줄을 탭하거나 자기 키를 누르세요' : 'PC: 스페이스 / ↑ / 클릭', W / 2, H - (L.land ? 20 : 30), 7.5, '#8A8F85', 'center', true);
  }
  function drawParade() {
    var rs = G.result ? G.result.relay.runners : [], W = L.W;
    var n = rs.length, gap = Math.min(22, Math.floor((W - 24) / Math.max(1, n)));
    var x0 = Math.floor((W - gap * (n - 1) - 12) / 2);
    for (var i = 0; i < n; i++) {
      var hop = Math.max(0, Math.sin(G.time / 140 - i * 0.6)) * 10;
      var kind = G.result.mineIdx === i ? 'me' : (G.result.leader === i ? 'gold' : 'ghost');
      cx.globalAlpha = kind === 'me' ? 1 : 0.85;
      cx.drawImage(getSprite(kind, rs[i].hat, hop > 1 ? 'jump' : 'run' + ((G.frameNo >> 3) + i) % 4), x0 + i * gap, Math.round(46 - hop));
    }
    cx.globalAlpha = 1;
    pxText('RELAY COMPLETE!', W / 2, 16, 2, '#FFD34D', 'center');
    cx.fillStyle = '#4C5E22'; cx.fillRect(x0 - 8, 62, gap * (n - 1) + 28, 1);
  }

  /* ---------- 한 화면 같이 달리기: 줄(레인) 배치 ---------- */
  var MKEYS = { KeyQ: 0, KeyP: 1, KeyZ: 2, KeyM: 3 };
  var MKEY_LABEL = ['Q', 'P', 'Z', 'M'];
  var HUD_M = 24;
  function pLabel(i, name) { return name === (i + 1) + 'P' ? name : (i + 1) + 'P ' + name; }
  function laneRect(i, n) { var h = Math.floor((L.H - HUD_M) / n); return { y0: HUD_M + i * h, h: h, k: Math.min(1, h / 150) }; }

  /* ---------- 렌더 ---------- */
  function render(dt) {
    G.frameNo++; G.time += dt;
    screenMode();
    updateFx(G.fx, dt);
    var t, camX, run;
    if (G.view === 'demo' && G.demo) {
      var d = G.demo, hf; t = Math.min(G.demoT, C.RUN_TICKS); hf = frameAt(d.hero, t);
      drawScene({ map: d.map, camX: hf.x - L.PSX, gsy: L.GSY, t: t, ghosts: d.ghosts, me: { x: hf.x, y: hf.y, st: hf.st, hat: myHat() } });
      screenMode();
      cx.fillStyle = 'rgba(11,13,10,0.35)'; cx.fillRect(0, 0, L.W, L.H);
      drawLogo();
    } else if (G.view === 'game' && G.kind === 'solo' && G.run) {
      run = G.run; t = run.t; camX = run.x / FP - L.PSX;
      var live = G.mode !== 'result';
      drawScene({ map: G.map, camX: camX, gsy: L.GSY, t: t, speedT: t, ghosts: G.ghosts, tags: live, got: run.got, prior: G.prior, fx: G.fx,
        me: { x: run.x / FP, y: run.y / FP, st: GR.stateBits(run), hat: G.myHat, name: G.runName } });
      screenMode();
      if (live) {
        var dots = ghostDots(G.ghosts, t), ahead = 0;
        dots.push({ x: run.x, c: '#C6F432' });
        for (var i = 0; i < G.ghosts.length; i++) if (G.ghosts[i].frames.x[t] > run.x) ahead++;
        drawHUD(t, GR.scoreOf(run), G.ghosts.length ? (ahead + 1) + '/' + (G.ghosts.length + 1) : '', dots);
      }
      if (G.mode === 'countdown') drawCountdown('탭: 점프 · 공중에서 한 번 더: 2단 점프', '주자 ' + (G.base.runners.length + 1) + ' / 10 · ' + mapLabel(G.base));
      if (G.mode === 'result' || G.mode === 'void') { cx.fillStyle = 'rgba(11,13,10,0.5)'; cx.fillRect(0, 0, L.W, L.H); }
      if (G.mode === 'result' && G.result && G.result.completed) drawParade();
    } else if (G.view === 'game' && G.kind === 'multi' && G.multi) {
      renderMulti(dt);
    } else if (G.view === 'watch' && G.watch) {
      var wv = G.watch; t = Math.min(G.watchT, C.RUN_TICKS); camX = watchCam(t);
      drawScene({ map: wv.map, camX: camX, gsy: L.GSY, t: t, ghosts: wv.ghosts, tags: G.mode === 'watch', fx: G.fx });
      screenMode();
      if (G.mode === 'watch') {
        drawHUD(t, null, '', ghostDots(wv.ghosts, t));
        krText('완주 기록 다시보기 ' + GR.relayIdText(wv.relay.relayId), L.W / 2, 62, 8, '#7FE7FF', 'center', true);
      } else { cx.fillStyle = 'rgba(11,13,10,0.5)'; cx.fillRect(0, 0, L.W, L.H); drawParade(); }
    } else {
      cx.fillStyle = '#0B0D0A'; cx.fillRect(0, 0, L.W, L.H);
    }
  }
  function renderMulti(dt) {
    var M = G.multi, n = M.players.length, t = M.players[0].run.t, i;
    var order = M.players.map(function (p, k) { return { k: k, x: p.run.x }; }).sort(function (a, b) { return b.x - a.x; });
    var place = []; order.forEach(function (o, r) { place[o.k] = r + 1; });
    for (i = 0; i < n; i++) {
      var p = M.players[i], lr = laneRect(i, n), r = p.run, k = lr.k;
      updateFx(p.fx, dt);
      var others = M.players.filter(function (q, j) { return j !== i; }).map(function (q) { return { x: q.run.x / FP, y: q.run.y / FP, st: GR.stateBits(q.run), hat: q.hat }; });
      drawScene({ map: M.map, camX: r.x / FP - (L.W / k) * 0.22, gsy: lr.y0 + lr.h - 14, y0: lr.y0, h: lr.h, k: k, t: t, speedT: t, got: r.got, fx: p.fx, others: others,
        me: { x: r.x / FP, y: r.y / FP, st: GR.stateBits(r), hat: p.hat, name: p.name }, tags: false });
      screenMode();
      cx.fillStyle = HAT_COLORS[p.hat]; cx.fillRect(0, lr.y0, 3, lr.h);
      cx.fillStyle = 'rgba(11,13,10,0.6)'; cx.fillRect(3, lr.y0 + 3, 150, 14);
      krText(pLabel(i, p.name) + '  ' + GR.scoreOf(r) + '점  ' + place[i] + '위', 8, lr.y0 + 10, 8, '#F2F2F2', 'left');
      krText(MKEY_LABEL[i] + '키 · 이 줄 탭', L.W - 6, lr.y0 + 10, 7, '#8A8F85', 'right', true);
      cx.fillStyle = '#2A3322'; cx.fillRect(0, lr.y0 + lr.h - 1, L.W, 1);
    }
    cx.fillStyle = '#0B0D0A'; cx.fillRect(0, 0, L.W, HUD_M);
    var tt = timeText(t);
    pxText(tt.s, L.W / 2, 5, 2, tt.red ? '#FF6B6B' : '#F2F2F2', 'center');
    krText(mapLabel(M.relay), 8, 12, 7, '#8A8F85', 'left');
    if (G.mode === 'countdown') drawCountdown('탭: 점프 · 공중에서 한 번 더: 2단 점프', n + '명 같이 달리기');
    if (G.mode === 'result' || G.mode === 'void') { cx.fillStyle = 'rgba(11,13,10,0.55)'; cx.fillRect(0, 0, L.W, L.H); }
  }
  function watchCam(t) {
    var lead = 0, gs = G.watch.ghosts; t = Math.min(t, C.RUN_TICKS);
    for (var i = 0; i < gs.length; i++) lead = Math.max(lead, gs[i].frames.x[t]);
    return lead / FP - L.W * 0.58;
  }

  /* ---------- ui 도우미 ---------- */
  function show(name) {
    var list = document.querySelectorAll('.screen');
    for (var i = 0; i < list.length; i++) list[i].classList.remove('on');
    if (name) $('scr-' + name).classList.add('on');
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2400);
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function face(kind, hat) {
    var c = document.createElement('canvas'); c.width = 12; c.height = 16;
    c.getContext('2d').drawImage(getSprite(kind, hat, 'run0'), 0, 0);
    return c;
  }
  function hatDot(hat) { var s = el('span', 'hatdot'); s.style.background = HAT_COLORS[hat] || '#8A8F85'; return s; }
  function policyAllows(f) { var fp = document.permissionsPolicy || document.featurePolicy; return !fp || !fp.allowsFeature || fp.allowsFeature(f); }
  async function copyText(text, box) {
    try { if (policyAllows('clipboard-write') && navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* blocked */ }
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
      var ok = document.execCommand('copy'); document.body.removeChild(ta);
      if (ok) return true;
    } catch (e) { /* fallback below */ }
    if (box) { box.focus(); box.select(); try { box.setSelectionRange(0, box.value.length); } catch (e) { /* ignore */ } }
    return false;
  }
  function segValue(id) { var b = $(id).querySelector('button.on'); return b ? parseInt(b.getAttribute('data-v'), 10) : 0; }
  function segSet(id, v) { $(id).querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', parseInt(b.getAttribute('data-v'), 10) === v); }); }
  function segBind(id, cb) {
    $(id).addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      segSet(id, parseInt(b.getAttribute('data-v'), 10)); Sound.unlock(); Sound.sfx('ui'); if (cb) cb();
    });
  }

  /* ---------- 타이틀 ---------- */
  function refreshTitle() {
    var seed = dailySeed(), li = Prog.lvInfo(Prog.p.xp), st = Prog.today();
    $('today-badge').textContent = '오늘의 맵 · ' + GR.mapName(seed);
    $('title-level').textContent = 'Lv ' + li.lv + ' · 오늘 미션 ' + st.done.length + '/3';
    $('btn-sound').classList.toggle('off', !Sound.isOn());
  }
  function enterTitle() {
    G.mode = 'title'; G.view = 'demo'; G.kind = 'solo'; G.run = null; G.multi = null;
    if (!G.demo || G.demo.seed !== dailySeed()) setupDemo();
    refreshTitle(); show('title');
  }

  /* ---------- 닉네임 (잘림·중복 처리) ---------- */
  var nickOpts = null;
  function nameLen(s) { return Array.from(s).length; }
  function openNick(opts) {
    nickOpts = opts;
    $('nick-title').textContent = opts.title || '닉네임 정하기';
    $('nick-msg').textContent = opts.msg || '유령 머리 위에 표시돼요. 한글·영문·숫자 1~6글자.';
    var inp = $('nick-input');
    inp.value = opts.value || ('러너' + (10 + Math.floor(Math.random() * 90)));
    $('nick-err').textContent = ''; nickCount();
    show('nick');
    setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) { /* ignore */ } }, 50);
  }
  function nickCount() {
    var v = $('nick-input').value.trim(), n = nameLen(v), c = $('nick-count');
    c.textContent = n + '/6'; c.classList.toggle('over', n > 6);
  }
  function nickProblem(v) {
    if (!v) return '닉네임을 입력해 주세요.';
    if (nameLen(v) > 6) return '6글자까지만 쓸 수 있어요. (지금 ' + nameLen(v) + '글자)';
    if (!GR.validName(v)) return '한글·영문·숫자만 쓸 수 있어요. 띄어쓰기·특수문자·이모지는 안 돼요.';
    if (nickOpts && nickOpts.exclude && nickOpts.exclude.indexOf(v) >= 0) return '이 릴레이에 이미 있는 닉네임이에요. 다른 닉네임을 써 주세요.';
    return '';
  }
  function submitNick() {
    var v = $('nick-input').value.trim(), pr = nickProblem(v);
    if (pr) { $('nick-err').textContent = pr; return; }
    var o = nickOpts; nickOpts = null;
    if (o && o.save) { G.name = v; store.set('name', v); }
    if (o && o.onOk) o.onOk(v);
  }
  function suggestName(base, exclude) {
    var stem = Array.from(base).slice(0, 5).join('');
    for (var i = 2; i < 10; i++) { var s = stem + i; if (exclude.indexOf(s) < 0) return s; }
    return '러너' + (10 + Math.floor(Math.random() * 90));
  }
  function ensureName(cb, onCancel) {
    if (GR.validName(G.name)) cb();
    else openNick({ save: true, onOk: function () { cb(); }, onCancel: onCancel || enterTitle });
  }

  /* ---------- 새 릴레이 설정 (맵·난이도·기록 안내) ---------- */
  function openSetup() {
    segSet('seg-diff', parseInt(store.get('diff', '1'), 10) || 0);
    refreshSetup(); show('setup');
  }
  function refreshSetup() {
    var mt = segValue('seg-map'), df = segValue('seg-diff'), seed = dailySeed();
    $('map-info').textContent = mt === 0
      ? '오늘의 맵: ' + GR.mapName(seed) + ' — 오늘 하루 모두가 같은 맵이에요. 한국 시간 자정에 바뀌어요. 기록은 맵·난이도별로 「내 기록」에 남아요.'
      : '자유 맵: 시작할 때마다 새 맵이 만들어져요. 친구는 코드를 받으면 같은 맵을 달려요. 최고 점수는 「자유 맵」 기록으로 모여요.';
    var d = DIFF[df];
    $('diff-info').textContent = d.name + ': 속도 ' + (d.s0 / 256).toFixed(1) + '→' + (d.s1 / 256).toFixed(1) + (df === 0 ? ' · 장애물 적음' : df === 2 ? ' · 연속 장애물이 빨리 나와요' : ' · 기본');
    var key = mapKey({ mapType: mt, seed: seed, diff: df }), b = Prog.p.best[key];
    $('setup-best').textContent = b ? '이 맵·난이도 내 최고 점수: ' + b.s + '점' : '아직 기록 없음 — 첫 기록을 만들어 보세요!';
  }

  /* ---------- 친구 코드 ---------- */
  var parsed = null;
  function openCode(prefill) {
    show('code'); parsed = null;
    $('code-input').value = prefill || ''; renderCodePreview();
    $('btn-paste').classList.toggle('hidden', !(policyAllows('clipboard-read') && navigator.clipboard && navigator.clipboard.readText));
  }
  function renderCodePreview() {
    var text = $('code-input').value, err = $('code-err'), pv = $('code-preview');
    ['btn-code-go', 'btn-code-watch', 'btn-code-newsame'].forEach(function (id) { $(id).classList.add('hidden'); });
    pv.classList.add('hidden'); err.textContent = ''; parsed = null;
    if (!text.trim()) return;
    var res = GR.decodeRelay(text);
    if (!res.ok) { err.textContent = res.error; return; }
    parsed = res;
    var relay = res.relay, ev = GR.evaluateRelay(relay, false), order = GR.rankOrder(ev.results);
    pv.textContent = '';
    pv.appendChild(el('div', 'pv-head', '릴레이 ' + GR.relayIdText(relay.relayId) + ' · 주자 ' + relay.runners.length + '명 / 10'));
    pv.appendChild(el('div', 'pv-map', mapLabel(relay)));
    var ul = el('ul', 'pv-list');
    ev.results.forEach(function (r) {
      var li = el('li'), nm = el('span', 'nm');
      nm.appendChild(hatDot(r.hat)); nm.appendChild(el('span', '', r.name));
      if (order[0].index === r.index) nm.appendChild(el('span', 'crown', '♛'));
      li.appendChild(nm); li.appendChild(el('span', '', r.score + '점'));
      ul.appendChild(li);
    });
    pv.appendChild(ul);
    var slots = el('div', 'slots');
    for (var i = 0; i < 10; i++) { var s = el('span'); if (i < relay.runners.length) s.className = 'f'; else if (i === relay.runners.length) s.className = 'me'; slots.appendChild(s); }
    pv.appendChild(slots);
    var mine = Prog.p.hist.filter(function (h) { return h.id === relay.relayId && h.seed === relay.seed; });
    if (mine.length) {
      var maxN = Math.max.apply(null, mine.map(function (h) { return h.n; }));
      pv.appendChild(el('div', 'pv-note', '이 릴레이는 이 기기에서 이미 ' + maxN + '번째 주자까지 달렸어요. 같은 코드로 또 달리면 다른 갈래의 릴레이가 돼요.'));
    }
    if (res.completed) {
      pv.appendChild(el('div', 'pv-note', '이 릴레이는 이미 10명이 완주했어요. 다시보기나 같은 맵으로 새 릴레이를 할 수 있어요.'));
      $('btn-code-watch').classList.remove('hidden'); $('btn-code-newsame').classList.remove('hidden');
    } else {
      pv.appendChild(el('div', 'pv-next', '다음 주자: 나 (' + (relay.runners.length + 1) + '번째)'));
      if (relay.runners.some(function (r) { return r.name === G.name; })) pv.appendChild(el('div', 'pv-note', '이 릴레이에 내 닉네임(' + G.name + ')이 이미 있어요. 출발하면 이번 판에 쓸 다른 닉네임을 물어볼게요.'));
      $('btn-code-go').classList.remove('hidden');
    }
    pv.classList.remove('hidden');
  }

  /* ---------- 혼자 달리기: 한 판 진행 ---------- */
  var input = { pending: false, mp: [false, false, false, false] };
  function resetInput() { input.pending = false; input.mp = [false, false, false, false]; }
  /* base 릴레이에 runName으로 이어 달린다. 이름이 겹치면 먼저 다른 이름을 받는다. */
  function attempt(base, runName, joined) {
    var names = base.runners.map(function (r) { return r.name; });
    if (names.indexOf(runName) >= 0) {
      openNick({
        title: '이번 판 닉네임', exclude: names, save: false, value: suggestName(runName, names),
        msg: '이 릴레이에 「' + runName + '」이(가) 이미 있어요. 헷갈리지 않게 이번 판은 다른 닉네임으로 달려요.',
        onOk: function (v) { beginAttempt(base, v, joined); }, onCancel: enterTitle
      });
      return;
    }
    beginAttempt(base, runName, joined);
  }
  function beginAttempt(base, runName, joined) {
    G.kind = 'solo'; G.base = base; G.runName = runName; G.joined = !!joined;
    G.myHat = runName === G.name ? myHat() : (base.runners.length + 3) % 10;
    G.map = GR.getMap(base.seed, base.diff); G.ctx = null; G.prior = null;
    if (base.runners.length === 0) {
      G.ghosts = practiceBots(base.seed, base.diff);
    } else {
      var ev = GR.evaluateRelay(base, true), leader = GR.rankOrder(ev.results)[0].index;
      G.ctx = ev.nextCtx; G.prior = ev.nextCtx.priorStars;
      G.ghosts = ev.results.map(function (r) { return { name: r.name, hat: r.hat, kind: r.index === leader ? 'gold' : 'ghost', frames: r.frames, score: r.score }; });
    }
    G.maxX = 6000 * FP;
    G.ghosts.forEach(function (g) { G.maxX = Math.max(G.maxX, g.frames.x[C.RUN_TICKS]); });
    G.run = GR.createRun(G.map, G.ctx);
    G.fx = makeFx(); tagRows = {};
    G.mode = 'countdown'; G.view = 'game'; G.cdStart = performance.now(); G.cdPhase = -1;
    resetInput(); show(null);
  }
  function fxForRun(fx, run, withSound) {
    var fl = run.flags, px = run.x / FP, py = run.y / FP;
    if (fl & F.JUMP) { if (withSound) Sound.sfx(fl & F.DOUBLE ? 'double' : 'jump'); puff(fx, px + 6, py + 16, fl & F.DOUBLE ? '#7FE7FF' : '#C6F432', fl & F.DOUBLE ? 7 : 4, 1.3); }
    if (fl & F.SYNC) { if (withSound) Sound.sfx('sync'); popup(fx, px + 6, py - 14, run.lastSync > 1 ? '싱크 x' + run.lastSync + '! +' + run.lastSync * C.PTS_SYNC : '싱크! +' + C.PTS_SYNC, '#7FE7FF', true); }
    if (fl & F.PLAT) { if (withSound) Sound.sfx('plat'); popup(fx, px + 6, py - 6, '높은 발판!', '#7FE7FF'); }
    else if (fl & F.LAND) { if (withSound) Sound.sfx('land'); }
    if (fl & F.RESCUE) { if (withSound) Sound.sfx('rescue'); popup(fx, px + 6, py - 24, '구조! +' + C.PTS_RESCUE, '#FFD34D', true); }
    else if (fl & F.STAR) { if (withSound) Sound.sfx('star'); popup(fx, px + 6, py - 4, '별 +' + C.PTS_STAR, '#C6F432'); }
    if (fl & (F.STUMBLE | F.FALL)) { if (withSound) Sound.sfx('stumble'); puff(fx, px + 8, py + 12, '#F2F2F2', 8, 2); }
  }
  function gameTick() {
    var run = G.run, press = input.pending;
    input.pending = false;
    GR.step(run, press);
    fxForRun(G.fx, run, true);
    if (run.t >= C.RUN_TICKS - 300 && run.t < C.RUN_TICKS && run.t % 60 === 0) Sound.sfx('tick');
    var camX = run.x / FP - L.PSX;
    for (var i = 0; i < G.ghosts.length; i++) ghostFx(G.ghosts[i], run.t, camX);
    if (run.t >= C.RUN_TICKS) finishRun();
  }
  function ghostFx(g, t, camX) {
    var gf = g.frames.fl[t]; if (!gf) return;
    var gx = g.frames.x[t] / FP, gy = g.frames.y[t] / FP;
    if (gx < camX - 20 || gx > camX + L.W + 20) return;
    var col = g.kind === 'bot' ? '#8A8F85' : '#7FE7FF';
    if (gf & F.JUMP) puff(G.fx, gx + 6, gy + 16, col, 3, 1);
    if (gf & (F.STUMBLE | F.FALL)) { puff(G.fx, gx + 8, gy + 12, col, 7, 1.8); popup(G.fx, gx + 6, gy - 2, '꽈당', col); }
  }
  function finishRun() {
    var base = G.base, rec = G.run.rec.slice();
    var relay = { seed: base.seed, mapType: base.mapType, diff: base.diff, relayId: base.relayId, runners: base.runners.concat([{ name: G.runName, hat: G.myHat, inputs: rec }]) };
    var ev = GR.evaluateRelay(relay, false), mine = ev.results[ev.results.length - 1];
    if (mine.score !== GR.scoreOf(G.run)) console.warn('[ghost-relay] 재생 점수 불일치', mine.score, GR.scoreOf(G.run));
    var order = GR.rankOrder(ev.results), code = GR.encodeRelay(relay);
    var owner = G.runName === G.name, xp = null;
    if (owner) xp = Prog.addRun(mine, { joined: G.joined, diff: relay.diff, key: mapKey(relay), label: mapLabel(relay) });
    Prog.addHist({ code: code, id: relay.relayId, seed: relay.seed, n: relay.runners.length, score: mine.score, label: (owner ? '' : G.runName + ' · ') + mapLabel(relay), date: kstYmd() });
    G.result = {
      relay: relay, ev: ev, mine: mine, mineIdx: relay.runners.length - 1, leader: order[0].index, xp: xp, owner: owner,
      completed: relay.runners.length >= C.MAX_RUNNERS, code: code, watch: false, multi: false,
      bots: base.runners.length === 0 ? G.ghosts : [],
      prevBest: G.ghosts.filter(function (g) { return !g.isBot; }).reduce(function (m, g) { return Math.max(m, g.score); }, -1)
    };
    Sound.sfx(G.result.completed ? 'win' : 'go');
    showResult();
  }
  function voidRun() { G.mode = 'void'; resetInput(); show('void'); }
  function retry() {
    if (G.kind === 'multi' && G.multi) startMulti(G.multi.cfg);
    else attempt(G.base, G.runName, G.joined);
  }

  /* ---------- 한 화면 같이 달리기 ---------- */
  function openMulti() {
    renderMultiNames(); $('multi-err').textContent = ''; show('multi');
  }
  function renderMultiNames() {
    var n = segValue('seg-players'), box = $('multi-names'), old = [];
    box.querySelectorAll('input').forEach(function (inp) { old.push(inp.value); });
    box.textContent = '';
    for (var i = 0; i < n; i++) {
      var lb = el('label'), head = el('span', '', (i + 1) + 'P ');
      head.appendChild(el('span', 'key', '· ' + MKEY_LABEL[i] + '키 / ' + (i + 1) + '번째 줄 탭'));
      var inp = el('input'); inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.value = old[i] || (i === 0 && GR.validName(G.name) ? G.name : (i + 1) + 'P');
      lb.appendChild(head); lb.appendChild(inp); box.appendChild(lb);
    }
  }
  function goMulti() {
    var names = [], err = '';
    $('multi-names').querySelectorAll('input').forEach(function (inp, i) {
      var v = inp.value.trim();
      if (!err && !GR.validName(v)) err = (i + 1) + 'P 닉네임: 한글·영문·숫자 1~6글자로 써 주세요.';
      if (!err && names.indexOf(v) >= 0) err = (i + 1) + 'P 닉네임이 다른 사람과 같아요.';
      names.push(v);
    });
    if (err) { $('multi-err').textContent = err; return; }
    var mt = segValue('seg-mmap');
    startMulti({ names: names, mapType: mt, seed: mt === 0 ? dailySeed() : (Math.random() * 4294967296) >>> 0, diff: segValue('seg-mdiff'), relayId: randId() });
  }
  function startMulti(cfg) {
    var map = GR.getMap(cfg.seed, cfg.diff);
    G.kind = 'multi'; G.view = 'game';
    G.multi = {
      cfg: cfg, map: map,
      relay: { seed: cfg.seed, mapType: cfg.mapType, diff: cfg.diff, relayId: cfg.relayId, runners: [] },
      players: cfg.names.map(function (nm, i) { return { name: nm, hat: (nm === G.name ? myHat() : [0, 1, 3, 5][i]), run: GR.createRun(map, null), fx: makeFx() }; })
    };
    G.mode = 'countdown'; G.cdStart = performance.now(); G.cdPhase = -1;
    resetInput(); show(null);
  }
  function multiTick() {
    var M = G.multi, done = true;
    for (var i = 0; i < M.players.length; i++) {
      var p = M.players[i], press = input.mp[i];
      input.mp[i] = false;
      GR.step(p.run, press);
      fxForRun(p.fx, p.run, true);
      if (p.run.t < C.RUN_TICKS) done = false;
    }
    var t = M.players[0].run.t;
    if (t >= C.RUN_TICKS - 300 && t < C.RUN_TICKS && t % 60 === 0) Sound.sfx('tick');
    if (done) finishMulti();
  }
  function finishMulti() {
    var M = G.multi, relay = Object.assign({}, M.relay, { runners: M.players.map(function (p) { return { name: p.name, hat: p.hat, inputs: p.run.rec.slice() }; }) });
    var ev = GR.evaluateRelay(relay, false), order = GR.rankOrder(ev.results), code = GR.encodeRelay(relay);
    var ownerIdx = M.players.findIndex(function (p) { return p.name === G.name; }), xp = null;
    if (ownerIdx >= 0) {
      xp = Prog.addRun(ev.results[ownerIdx], { joined: false, diff: relay.diff, key: mapKey(relay), label: mapLabel(relay) });
    }
    Prog.addHist({ code: code, id: relay.relayId, seed: relay.seed, n: relay.runners.length, score: order[0].score, label: '같이 달리기 · ' + mapLabel(relay), date: kstYmd() });
    G.result = { relay: relay, ev: ev, mine: ownerIdx >= 0 ? ev.results[ownerIdx] : null, mineIdx: ownerIdx, leader: order[0].index, xp: xp, owner: ownerIdx >= 0,
      completed: relay.runners.length >= C.MAX_RUNNERS, code: code, watch: false, multi: true, bots: [], prevBest: -1 };
    Sound.sfx('win');
    showResult();
  }

  /* ---------- 결과 ---------- */
  function showResult() {
    var R = G.result, relay = R.relay, n = relay.runners.length, order = GR.rankOrder(R.ev.results);
    G.mode = 'result';
    $('scr-result').classList.toggle('complete', R.completed);
    if (R.multi) {
      $('res-title').textContent = order[0].name + ' 우승!';
      $('res-sub').textContent = n + '명 같이 달리기 · ' + mapLabel(relay);
    } else if (R.watch) {
      $('res-title').textContent = '완주 기록';
      $('res-sub').textContent = GR.relayIdText(relay.relayId) + ' · ' + mapLabel(relay) + ' · 10명';
    } else {
      $('res-title').textContent = R.completed ? '릴레이 완주!' : '완주!';
      $('res-sub').textContent = R.mine.name + ' ' + R.mine.score + '점 · 릴레이 ' + n + ' / 10 · ' + GR.relayIdText(relay.relayId);
    }
    var rank = $('res-rank'); rank.textContent = '';
    var rows = R.ev.results.map(function (r) { return { r: r, bot: false }; });
    R.bots.forEach(function (b) { rows.push({ r: { name: b.name, score: b.score, distance: b.distance, index: 99 }, bot: true }); });
    rows.sort(function (a, b) { return b.r.score - a.r.score || b.r.distance - a.r.distance || a.r.index - b.r.index; });
    var no = 0;
    rows.forEach(function (row) {
      var r = row.r, li = el('li'), isMe = !row.bot && r.index === R.mineIdx && !R.multi, isNew = isMe && !R.watch;
      if (!row.bot) no++;
      if (!row.bot && no === 1) li.classList.add('first');
      if (isMe) li.classList.add('me');
      if (row.bot) li.classList.add('bot');
      li.appendChild(el('span', 'no', row.bot ? '-' : String(no)));
      li.appendChild(face(row.bot ? 'bot' : (isMe || R.multi) ? 'me' : (r.index === R.leader ? 'gold' : 'ghost'), r.hat));
      var nm = el('span', 'nm', R.multi ? pLabel(r.index, r.name) : r.name);
      if (isNew) nm.appendChild(el('span', 'tag new', 'NEW'));
      if (row.bot) nm.appendChild(el('span', 'tag bot', 'BOT'));
      li.appendChild(nm); li.appendChild(el('span', 'sc', r.score + '점'));
      rank.appendChild(li);
    });
    var bd = $('res-badges'); bd.textContent = '';
    if (!R.watch && R.mine) {
      var m = R.mine;
      if (m.syncs) bd.appendChild(el('span', 'b-sync', '싱크 ' + m.syncs + '회'));
      if (m.rescues) bd.appendChild(el('span', 'b-res', '구조 ' + m.rescues + '회'));
      if (m.platLands) bd.appendChild(el('span', 'b-sync', '높은 발판 ' + m.platLands + '회'));
      if (m.stumbles + m.falls === 0) bd.appendChild(el('span', 'b-safe', '무사고 질주'));
      if (R.prevBest >= 0 && m.score > R.prevBest) bd.appendChild(el('span', 'b-rev', '역전! 유령 1등을 이김'));
    }
    var xb = $('res-xp'); xb.textContent = '';
    if (R.xp) {
      var x = R.xp, line = el('div', 'xp-line'); line.appendChild(el('span', '', '경험치')); line.appendChild(el('b', '', '+' + x.gain + ' XP'));
      xb.appendChild(line);
      var li2 = Prog.lvInfo(Prog.p.xp), bar = el('div', 'bar'), fill = el('i'); fill.style.width = Math.round(li2.cur / li2.need * 100) + '%';
      bar.appendChild(fill); xb.appendChild(bar);
      xb.appendChild(el('div', 'muted small-p', 'Lv ' + li2.lv + ' · 다음 레벨까지 ' + (li2.need - li2.cur) + ' XP'));
      if (x.levelUp) xb.appendChild(el('div', 'lvup', '레벨 업! Lv ' + x.lv + (x.newHats.length ? ' · 새 모자: ' + x.newHats.map(function (h) { return HAT_NAMES[h]; }).join(', ') + ' (내 기록에서 바꾸기)' : '')));
      x.done.forEach(function (t2) { xb.appendChild(el('div', 'mdone', '미션 완료: ' + t2 + ' +' + MISSION_XP + ' XP')); });
      if (x.newBest) xb.appendChild(el('div', 'mdone', '이 맵·난이도 최고 기록 갱신!' + (x.prevBest ? ' (이전 ' + x.prevBest + '점)' : '')));
      xb.classList.remove('hidden');
    } else xb.classList.add('hidden');
    var sl = $('res-slots'); sl.textContent = '';
    for (var i = 0; i < 10; i++) { var s = el('span'); if (i < n) s.className = (i === R.mineIdx && !R.multi) ? 'me' : 'f'; sl.appendChild(s); }
    $('res-slots-cap').textContent = R.completed ? '10명이 모두 달렸어요. 릴레이 완주!' : '10명이 모이면 릴레이 완주! (' + (10 - n) + '명 남음)';
    $('btn-next').classList.toggle('hidden', R.completed || R.watch);
    $('res-code').value = R.code;
    $('res-code-label').textContent = R.completed ? '완주 기록 코드 (다시보기용)' : (R.multi ? '우리 ' + n + '명의 릴레이 코드 — 다른 친구에게 보내면 이어 달려요' : '내 릴레이 코드 — 다음 주자에게 보내면 내 유령과 함께 달려요');
    $('res-code-tip').classList.toggle('hidden', R.completed);
    $('btn-share').classList.toggle('hidden', !navigator.share);
    $('btn-retry').classList.toggle('hidden', R.watch);
    $('btn-retry').textContent = R.multi ? '같은 멤버로 다시 달리기' : '다시 달리기 (내 기록 바꾸기)';
    $('btn-res-newsame').classList.toggle('hidden', !R.completed);
    show('result');
    $('result-card').scrollTop = 0;
  }
  function shareText() {
    var R = G.result, id = GR.relayIdText(R.relay.relayId), n = R.relay.runners.length, how = "saaskr 게임에서 '고스트 릴레이' 검색 → 친구 코드 넣기";
    var who = R.mine ? R.mine.name + ' ' + R.mine.score + '점' : GR.rankOrder(R.ev.results)[0].name + ' 1등';
    var head = R.completed ? '👻 고스트 릴레이 ' + id + ' — 10명 릴레이 완주! ' + who
      : '👻 고스트 릴레이 ' + id + ' — ' + who + ', ' + n + '/10번째 주자까지 달렸어! (' + DIFF[R.relay.diff].name + ')';
    var line = (R.completed ? '완주 기록 다시보기: ' : '다음 주자는 너! 우리 유령 이길 수 있어? ') + (GAME_URL ? '아래 주소에서 「친구 코드 넣기」' : how);
    return head + '\n' + line + (GAME_URL ? '\n' + GAME_URL : '') + '\n' + R.code;
  }
  function nextRunner() {
    var R = G.result, names = R.relay.runners.map(function (r) { return r.name; });
    openNick({
      title: '다음 주자', exclude: names, save: false, value: suggestName('러너', names),
      msg: (R.relay.runners.length + 1) + '번째 주자의 닉네임을 써 주세요. 앞 ' + R.relay.runners.length + '명의 유령과 함께 이 기기에서 바로 달려요.',
      onOk: function (v) { attempt(R.relay, v, true); }, onCancel: showResult
    });
  }
  function startWatch(relay) {
    var ev = GR.evaluateRelay(relay, true), order = GR.rankOrder(ev.results), leader = order[0].index;
    G.watch = { relay: relay, map: ev.map, ev: ev, ghosts: ev.results.map(function (r) { return { name: r.name, hat: r.hat, kind: r.index === leader ? 'gold' : 'ghost', frames: r.frames, score: r.score }; }) };
    G.result = { relay: relay, ev: ev, mine: null, mineIdx: -1, leader: leader, completed: true, code: GR.encodeRelay(relay), watch: true, multi: false, bots: [], prevBest: -1, xp: null };
    G.maxX = 6000 * FP; G.watch.ghosts.forEach(function (g) { G.maxX = Math.max(G.maxX, g.frames.x[C.RUN_TICKS]); });
    G.watchT = 0; G.mode = 'watch'; G.view = 'watch'; G.kind = 'solo'; G.fx = makeFx(); tagRows = {};
    show(null);
  }
  function newSameMap(relay) {
    ensureName(function () { attempt({ seed: relay.seed, mapType: relay.mapType, diff: relay.diff, relayId: randId(), runners: [] }, G.name, false); });
  }

  /* ---------- 내 기록 ---------- */
  function openMe() {
    var p = Prog.p, li = Prog.lvInfo(p.xp);
    $('me-level').textContent = 'Lv ' + li.lv + (GR.validName(G.name) ? ' · ' + G.name : '');
    $('me-xp').textContent = '총 ' + p.xp + ' XP';
    $('me-bar').style.width = Math.round(li.cur / li.need * 100) + '%';
    var nextHat = -1; for (var h = 0; h < 10; h++) if (Prog.hatLv(h) > li.lv) { nextHat = h; break; }
    $('me-next').textContent = '다음 레벨까지 ' + (li.need - li.cur) + ' XP · 점수만큼 XP를 받아요' + (nextHat >= 0 ? ' · Lv ' + Prog.hatLv(nextHat) + '에 ' + HAT_NAMES[nextHat] + ' 모자' : '');
    var st = Prog.today(), ms = Prog.missions(st.d), ul = $('me-missions'); ul.textContent = '';
    $('me-mis-sub').textContent = '매일 자정(한국 시간)에 바뀌어요 · ' + st.done.length + '/3 완료';
    ms.forEach(function (m) {
      var done = st.done.indexOf(m.id) >= 0, li3 = el('li', done ? 'done' : '');
      li3.appendChild(el('span', '', (done ? '✓ ' : '') + m.text)); li3.appendChild(el('span', 'rw', done ? '완료' : '+' + MISSION_XP + ' XP'));
      ul.appendChild(li3);
    });
    var hb = $('me-hats'); hb.textContent = '';
    for (var i = 0; i < 10; i++) {
      var b = el('button'), need = Prog.hatLv(i), locked = need > li.lv;
      b.appendChild(face('me', i)); b.title = HAT_NAMES[i] + ' 모자';
      if (locked) { b.classList.add('locked'); b.appendChild(el('span', 'lk', 'Lv ' + need)); }
      if (i === myHat()) b.classList.add('on');
      (function (idx, lk, nd) {
        b.addEventListener('click', function () {
          if (lk) { toast('Lv ' + nd + '이 되면 열려요'); return; }
          Prog.p.hat = idx; Prog.save(); Sound.sfx('ui'); openMe(); toast(HAT_NAMES[idx] + ' 모자로 바꿨어요');
        });
      })(i, locked, need);
      hb.appendChild(b);
    }
    var sbox = $('me-stats'); sbox.textContent = '';
    [['판', p.runs], ['총 거리', p.dist + 'm'], ['별', p.stars], ['2단 점프', p.doubles], ['싱크', p.syncs], ['구조', p.rescues]].forEach(function (s2) {
      var d = el('div'); d.appendChild(el('b', '', String(s2[1]))); d.appendChild(el('span', '', s2[0])); sbox.appendChild(d);
    });
    var bl = $('me-bests'); bl.textContent = '';
    var keys = Object.keys(p.best).sort(function (a, b) { return p.best[b].s - p.best[a].s; }).slice(0, 8);
    if (!keys.length) bl.appendChild(el('li', 'empty', '아직 기록이 없어요.'));
    keys.forEach(function (k) { var li4 = el('li'); li4.appendChild(el('span', '', p.best[k].label)); li4.appendChild(el('b', '', p.best[k].s + '점')); bl.appendChild(li4); });
    var hl = $('me-hist'); hl.textContent = '';
    if (!p.hist.length) hl.appendChild(el('li', 'empty', '아직 달린 릴레이가 없어요.'));
    p.hist.forEach(function (h2) {
      var li5 = el('li'), meta = el('span', 'hmeta');
      meta.appendChild(el('span', '', GR.relayIdText(h2.id) + ' · ' + h2.n + '/10 · ' + h2.score + '점'));
      var ds = String(h2.date); meta.appendChild(el('small', '', h2.label + ' · ' + ds.slice(4, 6) + '/' + ds.slice(6, 8)));
      var btn = el('button', '', '코드 복사');
      btn.addEventListener('click', async function () { toast(await copyText(h2.code) ? '코드를 복사했어요' : '복사가 막혀 있어요. 결과 화면에서 길게 눌러 복사하세요'); });
      li5.appendChild(meta); li5.appendChild(btn); hl.appendChild(li5);
    });
    show('me');
  }

  /* ---------- 하는 법 그림 ---------- */
  function drawHowto() {
    ensureStars();
    function prep(id) { var c = $(id), g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.fillStyle = '#0B0D0A'; g.fillRect(0, 0, 96, 48); g.fillStyle = '#4C5E22'; g.fillRect(0, 40, 96, 1); g.fillStyle = '#141A10'; g.fillRect(0, 41, 96, 7); return g; }
    var g = prep('how1'), i, t;
    g.fillStyle = '#FF9FE8'; g.fillRect(58, 24, 8, 16); g.fillStyle = '#1A0F2A'; g.fillRect(59, 25, 6, 14);
    g.fillStyle = 'rgba(198,244,50,0.7)'; for (i = 0; i < 10; i++) { t = i / 9; g.fillRect(Math.round(10 + t * 30), Math.round(34 - 16 * 4 * t * (1 - t)), 1, 1); }
    g.fillStyle = 'rgba(127,231,255,0.9)'; for (i = 0; i < 12; i++) { t = i / 11; g.fillRect(Math.round(40 + t * 44), Math.round(26 - 22 * 4 * t * (1 - t) + t * 8), 1, 1); }
    g.font = '700 7px sans-serif'; g.fillStyle = '#C6F432'; g.fillText('1', 22, 22); g.fillStyle = '#7FE7FF'; g.fillText('2', 38, 22);
    g.drawImage(getSprite('me', myHat(), 'spin'), 50, 2);
    g = prep('how2');
    g.globalAlpha = 0.55; g.drawImage(getSprite('ghost', 4, 'run1'), 22, 24); g.drawImage(getSprite('ghost', 0, 'run3'), 8, 24); g.globalAlpha = 1;
    g.drawImage(getSprite('me', myHat(), 'run0'), 38, 24);
    g.fillStyle = '#7FE7FF'; g.font = '700 9px monospace'; g.fillText('GR2.', 58, 20); g.fillStyle = '#8A8F85'; g.fillText('x9', 70, 34);
    g = prep('how3');
    g.drawImage(starSprite, 10, 20); g.drawImage(starGold, 40, 12);
    g.globalAlpha = 0.55; g.drawImage(getSprite('ghost', 2, 'jump'), 62, 14); g.globalAlpha = 1; g.drawImage(getSprite('me', myHat(), 'jump'), 76, 14);
    g.font = '700 8px sans-serif'; g.fillStyle = '#C6F432'; g.fillText('+5', 10, 38); g.fillStyle = '#FFD34D'; g.fillText('+10', 38, 34); g.fillStyle = '#7FE7FF'; g.fillText('+3', 72, 10);
  }

  /* ---------- 이벤트 ---------- */
  function on(id, fn) { $(id).addEventListener('click', function (e) { Sound.unlock(); Sound.sfx('ui'); fn(e); }); }
  on('btn-new', openSetup);
  segBind('seg-map', refreshSetup); segBind('seg-diff', refreshSetup);
  on('btn-setup-go', function () {
    var mt = segValue('seg-map'), df = segValue('seg-diff');
    store.set('diff', df);
    ensureName(function () { attempt({ seed: mt === 0 ? dailySeed() : (Math.random() * 4294967296) >>> 0, mapType: mt, diff: df, relayId: randId(), runners: [] }, G.name, false); }, openSetup);
  });
  on('btn-setup-cancel', enterTitle);
  on('btn-code', function () { openCode(''); });
  on('btn-multi', openMulti);
  segBind('seg-players', renderMultiNames); segBind('seg-mmap'); segBind('seg-mdiff');
  on('btn-multi-go', goMulti);
  on('btn-multi-cancel', enterTitle);
  on('btn-me', openMe);
  on('btn-me-back', enterTitle);
  on('btn-me-nick', function () { openNick({ save: true, value: G.name, onOk: openMe, onCancel: openMe }); });
  on('btn-howto', function () { drawHowto(); show('howto'); });
  on('btn-howto-ok', enterTitle);
  on('btn-sound', function () { Sound.setOn(!Sound.isOn()); refreshTitle(); toast(Sound.isOn() ? '소리 켬' : '소리 끔'); });
  on('btn-nick-ok', submitNick);
  on('btn-nick-cancel', function () { var o = nickOpts; nickOpts = null; ((o && o.onCancel) || enterTitle)(); });
  $('nick-input').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) submitNick(); });
  $('nick-input').addEventListener('input', function () { nickCount(); var v = $('nick-input').value.trim(); $('nick-err').textContent = v ? nickProblem(v) : ''; });
  $('code-input').addEventListener('input', renderCodePreview);
  on('btn-paste', async function () {
    try { var t = await navigator.clipboard.readText(); $('code-input').value = t; renderCodePreview(); }
    catch (e) { $('btn-paste').classList.add('hidden'); toast('입력칸을 길게 눌러 직접 붙여넣어 주세요'); }
  });
  on('btn-code-go', function () { if (parsed) { var r = parsed.relay; ensureName(function () { attempt(r, G.name, true); }, function () { openCode($('code-input').value); }); } });
  on('btn-code-watch', function () { if (parsed) startWatch(parsed.relay); });
  on('btn-code-newsame', function () { if (parsed) newSameMap(parsed.relay); });
  on('btn-code-back', enterTitle);
  on('btn-next', nextRunner);
  on('btn-copy-share', async function () { toast(await copyText(shareText(), $('res-code')) ? '코드와 공유 문구를 복사했어요. 다음 주자에게 보내세요!' : '코드가 선택됐어요. 길게 눌러 복사하세요'); });
  on('btn-copy-code', async function () { toast(await copyText(G.result.code, $('res-code')) ? '코드를 복사했어요' : '코드가 선택됐어요. 길게 눌러 복사하세요'); });
  on('btn-share', async function () { try { await navigator.share({ title: '고스트 릴레이', text: shareText() }); } catch (e) { /* 취소 */ } });
  on('btn-retry', retry);
  on('btn-res-newsame', function () { newSameMap(G.result.relay); });
  on('btn-res-code', function () { openCode(''); });
  on('btn-res-title', enterTitle);
  on('btn-void-retry', retry);
  on('btn-void-title', enterTitle);

  var stage = $('stage');
  function gameInput() { return G.mode === 'play' || G.mode === 'countdown'; }
  // 어디서든 코드 붙여넣기 → 바로 미리보기 (홈으로 돌아가 버튼을 찾을 필요 없음)
  document.addEventListener('paste', function (e) {
    if (gameInput()) return;
    var tg = e.target && e.target.tagName;
    if (tg === 'INPUT' || tg === 'TEXTAREA') return;
    var text = (e.clipboardData || window.clipboardData).getData('text');
    if (text && /GR[12]\./.test(text)) { e.preventDefault(); openCode(text); }
  });
  function laneAt(clientY) {
    var r = cv.getBoundingClientRect(), y = (clientY - r.top) / r.height * L.H, n = G.multi.players.length;
    for (var i = 0; i < n; i++) { var lr = laneRect(i, n); if (y >= lr.y0 && y < lr.y0 + lr.h) return i; }
    return y < HUD_M ? 0 : n - 1;
  }
  stage.addEventListener('pointerdown', function (e) {
    Sound.unlock();
    if (!gameInput()) return;
    e.preventDefault();
    if (G.mode !== 'play') return;
    if (G.kind === 'multi') input.mp[laneAt(e.clientY)] = true;
    else input.pending = true;
  }, { passive: false });
  var KEYS = { Space: 1, ArrowUp: 1, KeyW: 1 };
  window.addEventListener('keydown', function (e) {
    Sound.unlock();
    if (!gameInput()) return;
    if (G.kind === 'multi') {
      var idx = MKEYS[e.code];
      if (idx === undefined || idx >= G.multi.players.length) return;
      e.preventDefault(); if (!e.repeat && G.mode === 'play') input.mp[idx] = true;
      return;
    }
    if (!KEYS[e.code]) return;
    e.preventDefault();
    if (!e.repeat && G.mode === 'play') input.pending = true;
  });
  document.addEventListener('contextmenu', function (e) { if (!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) e.preventDefault(); });
  document.addEventListener('touchmove', function (e) { if (!e.target.closest || !e.target.closest('.scroll')) e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && gameInput()) voidRun(); });
  window.addEventListener('pagehide', function () { if (gameInput()) voidRun(); });

  function resize() {
    computeLayout();
    var vw = window.innerWidth, vh = window.innerHeight, dpr = window.devicePixelRatio || 1;
    var s = Math.min(vw / L.W, vh / L.H);
    BS = Math.max(1, Math.ceil(s * dpr));
    cv.width = L.W * BS; cv.height = L.H * BS;
    var cw = Math.floor(L.W * s), ch = Math.floor(L.H * s);
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    var ui = $('ui'); ui.style.width = cw + 'px'; ui.style.height = ch + 'px';
    ui.classList.toggle('land', L.land);
    ui.style.setProperty('--u', (cw / L.W) + 'px');
    document.documentElement.style.setProperty('--u', (cw / L.W) + 'px');
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });

  /* ---------- 게임 루프: 시뮬레이션은 고정 60틱, 그리기는 rAF ---------- */
  var last = performance.now();
  function loop(now) {
    var dt = Math.min(now - last, 250); last = now;
    if (G.mode === 'countdown') {
      var el2 = now - G.cdStart, ph = Math.floor(el2 / 600);
      if (ph !== G.cdPhase) { G.cdPhase = ph; Sound.sfx(ph < 3 ? 'beep' : 'go'); }
      if (el2 >= 2400) { G.mode = 'play'; G.acc = 0; resetInput(); }
    } else if (G.mode === 'play' || G.mode === 'watch' || G.view === 'demo') {
      G.acc += dt;
      var n = 0;
      while (G.acc >= TICK_MS && n < 5) {
        if (G.mode === 'play') { if (G.kind === 'multi') multiTick(); else gameTick(); if (G.mode !== 'play') break; }
        else if (G.mode === 'watch') {
          G.watchT++;
          if (G.watchT <= C.RUN_TICKS) { var wl = G.watch.ghosts, wc = watchCam(G.watchT); for (var i = 0; i < wl.length; i++) ghostFx(wl[i], G.watchT, wc); }
          if (G.watchT >= C.RUN_TICKS + 45) { showResult(); break; }
        } else { G.demoT++; if (G.demoT > C.RUN_TICKS + 60) G.demoT = 0; }
        G.acc -= TICK_MS; n++;
      }
      if (n >= 5) G.acc = Math.min(G.acc, TICK_MS);
    }
    render(dt);
    requestAnimationFrame(loop);
  }

  /* ---------- selftest (콘솔에서 runSelfTests()) ---------- */
  window.runSelfTests = function () {
    var out = [], rng = GR.mulberry32(1), seed = dailySeed();
    function ok(name, cond) { out.push((cond ? 'ok   ' : 'FAIL ') + name); }
    var inp = GR.botInputs(seed, 1, 1), a = GR.simulate(seed, inp, null, false, 1), b = GR.simulate(seed, inp, null, false, 1);
    ok('결정적 재생', a.score === b.score && a.distance === b.distance);
    var run = GR.createRun(GR.getMap(seed, 2), null);
    while (run.t < C.RUN_TICKS) GR.step(run, rng() % 12 === 0);
    ok('실플레이 → 재생 일치', GR.simulate(seed, run.rec, null, false, 2).score === GR.scoreOf(run));
    var relay = { seed: seed, mapType: 0, diff: 1, relayId: 0xA7F2, runners: [{ name: '테스트', hat: 1, inputs: inp }] };
    var dec = GR.decodeRelay(GR.encodeRelay(relay));
    ok('코드 왕복', dec.ok && JSON.stringify(dec.relay) === JSON.stringify(relay));
    ok('변조 거절', !GR.decodeRelay(GR.encodeRelay(relay).slice(0, -3)).ok);
    console.log(out.join('\n'));
    return out.every(function (l) { return l.indexOf('ok') === 0; });
  };
  window.__gr = { G: G, Prog: Prog, L: L };

  resize();
  enterTitle();
  requestAnimationFrame(loop);
})();
