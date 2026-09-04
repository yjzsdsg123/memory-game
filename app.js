/* ================= 工具 ================= */
const $ = (id) => document.getElementById(id);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getBest(key) {
  const v = localStorage.getItem('mem_' + key);
  return v === null ? null : Number(v);
}

function setBest(key, val, betterFn) {
  const cur = getBest(key);
  if (cur === null || betterFn(val, cur)) {
    localStorage.setItem('mem_' + key, String(val));
    return true;
  }
  return false;
}

function fmtTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/* ================= 主题 ================= */
const themeBtn = $('themeToggle');

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('mem_theme', t);
}

applyTheme(localStorage.getItem('mem_theme') || 'light');
themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

/* ================= 音效（Web Audio 合成，零依赖） ================= */
const soundToggle = $('soundToggle');

const sound = {
  ctx: null,
  enabled: localStorage.getItem('mem_sound') !== 'off',
};

function initSoundCtx() {
  if (!sound.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) sound.ctx = new AC();
  }
  if (sound.ctx && sound.ctx.state === 'suspended') sound.ctx.resume();
  return sound.ctx;
}

function playTone({ freq = 440, to = null, dur = 0.15, type = 'sine', vol = 0.15, delay = 0 }) {
  if (!sound.enabled) return;
  const ctx = initSoundCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const sndFlip = () => playTone({ freq: 320, to: 520, dur: 0.09, type: 'triangle', vol: 0.12 });
const sndDeal = (i) => playTone({ freq: 760, dur: 0.05, type: 'triangle', vol: 0.05, delay: i * 0.04 });
const sndMatch = () => {
  playTone({ freq: 523.25, dur: 0.12, type: 'sine', vol: 0.15 });
  playTone({ freq: 783.99, dur: 0.18, type: 'sine', vol: 0.15, delay: 0.1 });
};
const sndMiss = () => playTone({ freq: 220, to: 160, dur: 0.2, type: 'sawtooth', vol: 0.08 });
const sndWin = () => {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    playTone({ freq: f, dur: 0.22, type: 'triangle', vol: 0.14, delay: i * 0.13 })
  );
};
const sndHint = () => playTone({ freq: 660, to: 880, dur: 0.12, type: 'sine', vol: 0.1 });

function applySoundIcon() {
  soundToggle.textContent = sound.enabled ? '🔊' : '🔇';
}

applySoundIcon();
soundToggle.addEventListener('click', () => {
  sound.enabled = !sound.enabled;
  localStorage.setItem('mem_sound', sound.enabled ? 'on' : 'off');
  applySoundIcon();
  if (sound.enabled) sndFlip(); /* 开启时给一声反馈 */
});

/* ================= 视图切换 ================= */
/* 直接遍历 DOM 区块切换，避免依赖可被环境覆盖的数组字面量 */
const views = ['home', 'flip', 'digit', 'simon', 'rank'];

function showView(name) {
  stopAllGames();
  document.querySelectorAll('main > section[id^="view-"]').forEach((s) => {
    s.hidden = s.id !== 'view-' + name;
  });
  if (name === 'home') renderBest();
  window.scrollTo(0, 0);
}

/* ================= 最佳纪录展示 ================= */
function renderBest() {
  const bf = getBest('flip_moves');
  $('bestFlip').textContent = bf === null
    ? '最佳纪录：--'
    : `最佳纪录：${bf} 步 / ${fmtTime(getBest('flip_time') ?? 0)}`;
  const bd = getBest('digit_level');
  $('bestDigit').textContent = bd === null ? '最佳纪录：--' : `最佳纪录：${bd} 位`;
  const bs = getBest('simon_level');
  $('bestSimon').textContent = bs === null ? '最佳纪录：--' : `最佳纪录：${bs} 轮`;
  const rp = getRankPoints();
  const rt = rankTierOf(rp);
  $('bestRank').textContent = `段位：${rt.icon}${rt.name} · ${rp}分`;
  $('bestShop').textContent = `🪙 ${getCoins()} 金币`;
  $('bestBoard').textContent = rp > 0 ? `暂列第 ${localBoardRank()} 名（离线）` : '暂未上榜';
}

/* ================= 翻牌配对 ================= */
const FLIP_EMOJIS = ['🍎', '🚀', '🐱', '🌈', '⚽', '🎵', '🌻', '🐳'];
const flipGrid = $('flipGrid');

let flip = null;

function newFlip() {
  stopFlip();
  const deck = shuffle([...FLIP_EMOJIS, ...FLIP_EMOJIS]).map((e, i) => ({ e, done: false, open: false }));
  flip = { deck, open: [], matched: 0, moves: 0, startTs: null, timerId: null, lock: false, hints: 3 };
  ensureHints();
  $('flipMoves').textContent = '0';
  $('flipTime').textContent = '00:00';
  $('flipMatched').textContent = '0/8';
  setFlipMsg('', '');
  renderFlip();
  updateFlipHintBtn();
  dealAnimation();
}

/* 只构建一次 DOM，之后通过切换类名驱动动画（避免重建导致 3D 过渡丢失） */
function renderFlip() {
  flipGrid.innerHTML = '';
  flip.deck.forEach((card, i) => {
    const btn = document.createElement('button');
    btn.className = 'fcard';
    btn.innerHTML = `<div class="fcard-inner"><div class="face back"></div><div class="face front">${card.e}</div></div>`;
    btn.addEventListener('click', () => onFlipCard(i));
    flipGrid.appendChild(btn);
  });
}

function updateCard(i) {
  const card = flip.deck[i];
  const el = flipGrid.children[i];
  el.classList.toggle('open', card.open);
  el.classList.toggle('done', card.done);
}

function dealAnimation() {
  const cards = [...flipGrid.children];
  flip.lock = true;
  cards.forEach((el, i) => {
    el.classList.add('deal');
    el.style.animationDelay = `${i * 40}ms`;
    sndDeal(i);
  });
  setTimeout(() => {
    cards.forEach((el) => {
      el.classList.remove('deal');
      el.style.animationDelay = '';
    });
    flip.lock = false;
  }, cards.length * 40 + 450);
}

function onFlipCard(i) {
  const card = flip.deck[i];
  if (flip.lock || card.open || card.done) return;
  if (!flip.startTs) {
    flip.startTs = Date.now();
    flip.timerId = setInterval(() => {
      $('flipTime').textContent = fmtTime(Math.floor((Date.now() - flip.startTs) / 1000));
    }, 500);
  }
  card.open = true;
  flip.open.push(i);
  updateCard(i);
  sndFlip();

  if (flip.open.length === 2) {
    flip.moves++;
    $('flipMoves').textContent = flip.moves;
    const [a, b] = flip.open;
    if (flip.deck[a].e === flip.deck[b].e) {
      flip.deck[a].done = flip.deck[b].done = true;
      flip.open = [];
      flip.matched++;
      $('flipMatched').textContent = `${flip.matched}/8`;
      updateCard(a);
      updateCard(b); /* .done 触发弹跳动画 */
      sndMatch();
      if (flip.matched === FLIP_EMOJIS.length) winFlip();
    } else {
      flip.lock = true;
      /* 配错抖动 */
      flipGrid.children[a].classList.add('shake');
      flipGrid.children[b].classList.add('shake');
      sndMiss();
      setTimeout(() => {
        flip.deck[a].open = flip.deck[b].open = false;
        flip.open = [];
        flipGrid.children[a].classList.remove('shake');
        flipGrid.children[b].classList.remove('shake');
        updateCard(a);
        updateCard(b);
        flip.lock = false;
      }, 750);
    }
  }
}

function winFlip() {
  stopFlipTimer();
  const sec = Math.floor((Date.now() - flip.startTs) / 1000);
  const betterMoves = setBest('flip_moves', flip.moves, (v, c) => v < c);
  const betterTime = setBest('flip_time', sec, (v, c) => v < c);
  const extra = betterMoves || betterTime ? '，刷新最佳纪录！🏆' : '';
  setFlipMsg(`🎉 全部配对成功！用时 ${fmtTime(sec)}，共 ${flip.moves} 步${extra}`, 'ok');
  sndWin();
  /* 胜利波浪动画 */
  [...flipGrid.children].forEach((el, i) => {
    setTimeout(() => el.classList.add('wave'), i * 45);
  });
}

function stopFlipTimer() {
  if (flip && flip.timerId) {
    clearInterval(flip.timerId);
    flip.timerId = null;
  }
}

function stopFlip() {
  stopFlipTimer();
  flip = null;
}

function setFlipMsg(text, cls) {
  const el = $('flipMsg');
  el.textContent = text;
  el.className = 'game-msg' + (cls ? ' ' + cls : '');
}

/* 提示：每局 3 次，短暂亮出一对可配对的卡 */
const flipHintBtn = $('flipHint');

function updateFlipHintBtn() {
  const h = getHints();
  flipHintBtn.textContent = `提示（${h}）`;
  flipHintBtn.disabled = !flip || h <= 0;
}

function useFlipHint() {
  if (!flip || flip.lock || getHints() <= 0) return;
  const pool = flip.deck.map((c, i) => ({ c, i })).filter((x) => !x.c.done && !x.c.open);
  let pair = null;
  /* 优先：当前已翻开一张时，亮出它的另一半 */
  if (flip.open.length === 1) {
    const a = flip.open[0];
    const m = pool.find((x) => x.i !== a && flip.deck[x.i].e === flip.deck[a].e);
    if (m) pair = [a, m.i];
  }
  if (!pair) {
    const byEmoji = {};
    pool.forEach((x) => (byEmoji[x.c.e] = byEmoji[x.c.e] || []).push(x.i));
    const group = Object.values(byEmoji).find((g) => g.length >= 2);
    if (group) pair = [group[0], group[1]];
  }
  if (!pair) return;
  addHints(-1);
  updateFlipHintBtn();
  sndHint();
  pair.forEach((i) => flipGrid.children[i].classList.add('open', 'hint'));
  setTimeout(() => {
    pair.forEach((i) => {
      flipGrid.children[i].classList.remove('hint');
      /* 若玩家已真正翻开/配对该卡，则保留其翻开状态 */
      if (flip && !flip.deck[i].open) flipGrid.children[i].classList.remove('open');
    });
  }, 900);
}

flipHintBtn.addEventListener('click', useFlipHint);

$('flipRestart').addEventListener('click', newFlip);
$('flipBack').addEventListener('click', () => showView('home'));

/* ================= 数字记忆 ================= */
let digit = { level: 4, phase: 'idle', num: '', timers: [], hints: 3, hintUsed: 0 };

function digitClearTimers() {
  digit.timers.forEach(clearTimeout);
  digit.timers = [];
}

function newDigit() {
  digitClearTimers();
  digit = { level: 4, phase: 'idle', num: '', timers: [], hints: 3, hintUsed: 0 };
  updateDigitHintBtn();
  $('digitLevel').textContent = digit.level;
  $('digitDisplay').textContent = '?';
  $('digitInputRow').hidden = true;
  $('digitStart').hidden = false;
  setDigitMsg('');
  $('digitBest').textContent = getBest('digit_level') ?? '-';
}

function startDigitRound() {
  digitClearTimers();
  digit.phase = 'showing';
  digit.num = '';
  digit.hintUsed = 0; /* 每一轮提示进度重置，剩余次数跨轮保留 */
  $('digitStart').hidden = true;
  $('digitInputRow').hidden = true;
  setDigitMsg('');
  for (let i = 0; i < digit.level; i++) {
    digit.num += Math.floor(Math.random() * 10);
  }
  $('digitDisplay').textContent = digit.num;
  /* 显示时长可自定义：每位数秒 + 0.9s 基础缓冲 */
  const perMs = Math.max(100, (parseFloat(digitShowInput.value) || 0.5) * 1000);
  const showMs = digit.level * perMs + 900;
  digit.timers.push(setTimeout(() => {
    $('digitDisplay').textContent = '•'.repeat(digit.level);
    digit.phase = 'input';
    $('digitInputRow').hidden = false;
    $('digitInput').value = '';
    $('digitInput').focus();
    setDigitMsg(`数字已隐藏，凭记忆输入这 ${digit.level} 位数`);
  }, showMs));
}

function submitDigit() {
  if (digit.phase !== 'input') return;
  const val = $('digitInput').value.trim();
  if (!val) return;
  if (val === digit.num) {
    digit.phase = 'idle';
    setDigitMsg(`✅ 正确！进入 ${digit.level + 1} 位挑战…`, 'ok');
    $('digitDisplay').textContent = '👍';
    digit.timers.push(setTimeout(() => {
      digit.level++;
      $('digitLevel').textContent = digit.level;
      startDigitRound();
    }, 1100));
  } else {
    const done = digit.level - 1;
    const better = setBest('digit_level', done, (v, c) => v > c);
    digit.phase = 'over';
    setDigitMsg(`❌ 错误！正确答案是 ${digit.num}。你通过了 ${done} 位挑战${better ? '，刷新最佳纪录！🏆' : ''}`, 'bad');
    $('digitDisplay').textContent = digit.num;
    $('digitInputRow').hidden = true;
    $('digitStart').hidden = false;
    $('digitStart').textContent = '再来一轮';
    $('digitBest').textContent = getBest('digit_level') ?? '-';
  }
}

function setDigitMsg(text, cls) {
  const el = $('digitMsg');
  el.textContent = text;
  el.className = 'game-msg' + (cls ? ' ' + cls : '');
}

$('digitStart').addEventListener('click', () => {
  ensureHints(); /* 每局（一次完整挑战）保底 3 次提示 */
  updateDigitHintBtn();
  startDigitRound();
});
$('digitSubmit').addEventListener('click', submitDigit);
$('digitInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitDigit();
});
$('digitRestart').addEventListener('click', newDigit);
$('digitBack').addEventListener('click', () => showView('home'));

/* 数字显示时长设置（持久化到 localStorage） */
const digitShowInput = $('digitShowSec');
digitShowInput.value = localStorage.getItem('mem_digit_show') || '0.5';
digitShowInput.addEventListener('change', () => {
  let v = parseFloat(digitShowInput.value);
  if (!(v > 0)) v = 0.5;
  v = Math.min(5, Math.max(0.1, v));
  digitShowInput.value = v;
  localStorage.setItem('mem_digit_show', String(v));
});

/* 提示：每局 3 次，输入阶段按位补显数字（第1次显第1位…） */
const digitHintBtn = $('digitHint');

function updateDigitHintBtn() {
  const h = getHints();
  digitHintBtn.textContent = `提示（${h}）`;
  digitHintBtn.disabled = !digit || h <= 0;
}

function useDigitHint() {
  if (!digit || digit.phase !== 'input' || getHints() <= 0) return;
  addHints(-1);
  digit.hintUsed++;
  updateDigitHintBtn();
  sndHint();
  const k = Math.min(digit.hintUsed, digit.level);
  $('digitDisplay').textContent = digit.num.slice(0, k) + '•'.repeat(digit.level - k);
}

digitHintBtn.addEventListener('click', useDigitHint);

/* ================= 亮灯序列（Simon） ================= */
let simon = null;

function newSimon() {
  stopSimon();
  simon = { seq: [], idx: 0, phase: 'idle', timers: [], hints: 3 };
  ensureHints();
  $('simonLevel').textContent = '0';
  $('simonMsg').textContent = '点击“开始挑战”，记住灯光亮起的顺序';
  $('simonMsg').className = 'game-msg';
  $('simonStart').hidden = false;
  $('simonHint').hidden = true;
  setPadsEnabled(false);
}

function setPadsEnabled(on) {
  document.querySelectorAll('.pad').forEach((p) => (p.disabled = !on));
}

function stopSimon() {
  if (simon) {
    simon.timers.forEach(clearTimeout);
    simon.timers = [];
  }
  simon = null;
  setPadsEnabled(false);
}

function startSimon() {
  simon.seq = [];
  simon.timers = [];
  ensureHints(); /* 每局保底 3 次提示 */
  simonHintBtn.hidden = false;
  updateSimonHintBtn();
  simonNext();
}

function simonNext() {
  simon.seq.push(Math.floor(Math.random() * 4));
  simon.idx = 0;
  $('simonLevel').textContent = simon.seq.length;
  playSequence();
}

function playSequence() {
  simon.phase = 'showing';
  setPadsEnabled(false);
  setSimonMsg('👀 仔细看…');
  const gap = Math.max(240, 560 - simon.seq.length * 25);
  simon.seq.forEach((pad, i) => {
    simon.timers.push(setTimeout(() => flashPad(pad), 500 + i * (gap + 320)));
  });
  simon.timers.push(setTimeout(() => {
    simon.phase = 'input';
    setPadsEnabled(true);
    setSimonMsg('👆 轮到你了，按顺序点出来');
  }, 500 + simon.seq.length * (gap + 320)));
}

function flashPad(i) {
  const pad = document.querySelector(`.pad[data-pad="${i}"]`);
  pad.classList.add('lit');
  simon.timers.push(setTimeout(() => pad.classList.remove('lit'), 280));
}

function onPadClick(e) {
  if (!simon || simon.phase !== 'input') return;
  const i = Number(e.currentTarget.dataset.pad);
  flashPad(i);
  if (i === simon.seq[simon.idx]) {
    simon.idx++;
    if (simon.idx === simon.seq.length) {
      simon.phase = 'wait';
      setPadsEnabled(false);
      setSimonMsg(`✅ 第 ${simon.seq.length} 轮通过！`, 'ok');
      simon.timers.push(setTimeout(simonNext, 1000));
    }
  } else {
    const done = simon.seq.length - 1;
    const better = setBest('simon_level', done, (v, c) => v > c);
    simon.phase = 'over';
    setPadsEnabled(false);
    setSimonMsg(`❌ 顺序错了！你通过了 ${done} 轮${better ? '，刷新最佳纪录！🏆' : ''}`, 'bad');
    $('simonStart').hidden = false;
    $('simonStart').textContent = '再来一轮';
    $('simonBest').textContent = getBest('simon_level') ?? '-';
  }
}

function setSimonMsg(text, cls) {
  const el = $('simonMsg');
  el.textContent = text;
  el.className = 'game-msg' + (cls ? ' ' + cls : '');
}

$('simonStart').addEventListener('click', () => {
  $('simonStart').hidden = true;
  startSimon();
});
document.querySelectorAll('.pad').forEach((p) => p.addEventListener('click', onPadClick));

/* 提示：每局 3 次，重放本轮灯光顺序（不打断已按进度） */
const simonHintBtn = $('simonHint');

function updateSimonHintBtn() {
  const h = getHints();
  simonHintBtn.textContent = `提示（${simon ? h : 0}）`;
  simonHintBtn.disabled = !simon || h <= 0;
}

function useSimonHint() {
  if (!simon || simon.phase !== 'input' || getHints() <= 0) return;
  addHints(-1);
  updateSimonHintBtn();
  sndHint();
  const gap = Math.max(240, 560 - simon.seq.length * 25);
  simon.seq.forEach((pad, i) => {
    simon.timers.push(setTimeout(() => flashPad(pad), 200 + i * (gap + 320)));
  });
}

simonHintBtn.addEventListener('click', useSimonHint);

$('simonRestart').addEventListener('click', newSimon);
$('simonBack').addEventListener('click', () => showView('home'));

/* ================= 排位赛（人机翻牌对抗） ================= */
const RANK_TIERS = [
  { name: '青铜', icon: '🥉', min: 0, cap: 4, miss: 0.35, opp: '青铜守卫' },
  { name: '白银', icon: '🥈', min: 300, cap: 6, miss: 0.25, opp: '白银棋手' },
  { name: '黄金', icon: '🥇', min: 600, cap: 8, miss: 0.18, opp: '黄金专家' },
  { name: '铂金', icon: '💎', min: 900, cap: 12, miss: 0.12, opp: '铂金大师' },
  { name: '钻石', icon: '💠', min: 1200, cap: 16, miss: 0.07, opp: '钻石幽灵' },
  { name: '王者', icon: '👑', min: 1500, cap: 20, miss: 0.03, opp: '王者之脑' },
];

function getRankPoints() {
  return Number(localStorage.getItem('mem_rank_points')) || 0;
}

/* 排位赛战绩：胜/平/负、当前连胜、最高连胜、历史最高积分（集中存储） */
function getRankStats() {
  try {
    return Object.assign({ w: 0, d: 0, l: 0, streak: 0, bestStreak: 0, peak: 0 },
      JSON.parse(localStorage.getItem('mem_rank_stats')) || {});
  } catch {
    return { w: 0, d: 0, l: 0, streak: 0, bestStreak: 0, peak: 0 };
  }
}

function saveRankStats(s) {
  localStorage.setItem('mem_rank_stats', JSON.stringify(s));
}

function rankTierOf(points) {
  let t = RANK_TIERS[0];
  for (const tier of RANK_TIERS) if (points >= tier.min) t = tier;
  return t;
}

let rank = null;

function stopRank() {
  if (rank) rank.timers.forEach(clearTimeout);
  rank = null;
}

function newRank() {
  stopRank();
  $('rankResult').hidden = true;
  const deck = shuffle([...FLIP_EMOJIS, ...FLIP_EMOJIS]).map((e) => ({ e, done: false, open: false }));
  rank = { deck, open: [], you: 0, ai: 0, turn: 'you', busy: false, over: false, aiMem: [], timers: [] };
  renderRankGrid();
  renderRankHud();
  rankDeal();
  setRankMsg('你的回合：翻两张相同图案的牌，配对成功可连翻');
}

/* 发牌动画：依次入场，期间锁定点击 */
function rankDeal() {
  const cards = [...$('rankGrid').children];
  rank.busy = true;
  cards.forEach((el, i) => {
    el.classList.add('deal');
    el.style.animationDelay = `${i * 40}ms`;
    sndDeal(i);
  });
  rank.timers.push(setTimeout(() => {
    if (!rank) return;
    cards.forEach((el) => {
      el.classList.remove('deal');
      el.style.animationDelay = '';
    });
    rank.busy = false;
  }, cards.length * 40 + 450));
}

function renderRankGrid() {
  const grid = $('rankGrid');
  grid.innerHTML = '';
  rank.deck.forEach((card, i) => {
    const btn = document.createElement('button');
    btn.className = 'fcard';
    btn.innerHTML = `<div class="fcard-inner"><div class="face back"></div><div class="face front">${card.e}</div></div>`;
    btn.addEventListener('click', () => onRankCard(i));
    grid.appendChild(btn);
  });
}

function rankUpdateCard(i) {
  const card = rank.deck[i];
  const el = $('rankGrid').children[i];
  el.classList.toggle('open', card.open);
  el.classList.toggle('done', card.done);
}

function renderRankHud() {
  const pts = getRankPoints();
  const tier = rankTierOf(pts);
  const stats = getRankStats();
  $('rankBadge').textContent = tier.icon;
  $('rankName').textContent = tier.name;
  $('rankPoints').textContent = pts + ' 积分';
  $('rankOppName').textContent = tier.opp;
  $('rankYou').textContent = rank.you;
  $('rankAi').textContent = rank.ai;
  $('rankTurn').textContent = rank.over ? '本局结束' : (rank.turn === 'you' ? '你的回合' : `${tier.opp} 思考中…`);
  document.querySelector('.rank-score .side.you').classList.toggle('active', !rank.over && rank.turn === 'you');
  document.querySelector('.rank-score .side.ai').classList.toggle('active', !rank.over && rank.turn === 'ai');

  /* 道具按钮：仅你的回合且不忙碌时可用 */
  const items = getItems();
  $('cntFreeze').textContent = items.freeze;
  $('cntPeek').textContent = items.peek;
  const canAct = !rank.over && !rank.busy && rank.turn === 'you';
  $('useFreeze').disabled = !canAct || items.freeze <= 0;
  $('usePeek').disabled = !canAct || items.peek <= 0 || rank.frozen;

  /* 段位进度条 */
  const tierIdx = RANK_TIERS.indexOf(tier);
  const next = RANK_TIERS[tierIdx + 1];
  const fill = $('rankProgressFill');
  const ptext = $('rankProgressText');
  if (next) {
    const pct = Math.min(100, Math.round(((pts - tier.min) / (next.min - tier.min)) * 100));
    fill.style.width = pct + '%';
    ptext.textContent = `距${next.name}还需 ${next.min - pts} 分`;
  } else {
    fill.style.width = '100%';
    ptext.textContent = '👑 已达最高段位';
  }

  /* 战绩 */
  $('rankWins').textContent = stats.w;
  $('rankDraws').textContent = stats.d;
  $('rankLosses').textContent = stats.l;
  const total = stats.w + stats.d + stats.l;
  $('rankWinRate').textContent = total ? Math.round((stats.w / total) * 100) + '%' : '--';
  const streakEl = $('rankStreak');
  if (stats.streak >= 2) {
    streakEl.hidden = false;
    $('rankStreakNum').textContent = stats.streak;
  } else {
    streakEl.hidden = true;
  }
}

function setRankMsg(text, cls) {
  const el = $('rankMsg');
  el.textContent = text;
  el.className = 'game-msg' + (cls ? ' ' + cls : '');
}

/* AI 有限记忆：FIFO 队列，容量随段位提升 */
function rankAiLearn(i) {
  if (rank.deck[i].done) return;
  rank.aiMem = rank.aiMem.filter((x) => x.i !== i);
  rank.aiMem.push({ i, e: rank.deck[i].e });
  const cap = rankTierOf(getRankPoints()).cap;
  while (rank.aiMem.length > cap) rank.aiMem.shift();
}

function rankAiForgetDone(a, b) {
  rank.aiMem = rank.aiMem.filter((x) => x.i !== a && x.i !== b);
}

function onRankCard(i) {
  if (!rank || rank.busy || rank.over || rank.turn !== 'you') return;
  const card = rank.deck[i];
  if (card.open || card.done) return;
  card.open = true;
  rank.open.push(i);
  rankUpdateCard(i);
  rankAiLearn(i);
  sndFlip();
  if (rank.open.length < 2) return;
  rank.busy = true;
  const [a, b] = rank.open;
  rank.timers.push(setTimeout(() => {
    if (!rank) return;
    if (rank.deck[a].e === rank.deck[b].e) {
      rank.deck[a].done = rank.deck[b].done = true;
      rank.open = [];
      rank.you++;
      rankUpdateCard(a);
      rankUpdateCard(b);
      rankAiForgetDone(a, b);
      sndMatch();
      rank.busy = false;
      renderRankHud();
      if (rank.you + rank.ai === FLIP_EMOJIS.length) return settleRank();
      setRankMsg('👍 配对成功，继续你的回合！');
    } else {
      $('rankGrid').children[a].classList.add('shake');
      $('rankGrid').children[b].classList.add('shake');
      sndMiss();
      rank.timers.push(setTimeout(() => {
        if (!rank) return;
        rank.deck[a].open = rank.deck[b].open = false;
        rank.open = [];
        $('rankGrid').children[a].classList.remove('shake');
        $('rankGrid').children[b].classList.remove('shake');
        rankUpdateCard(a);
        rankUpdateCard(b);
        rank.busy = false;
        rank.turn = 'ai';
        renderRankHud();
        setRankMsg('❌ 没配上，轮到 AI');
        scheduleAiMove();
      }, 700));
    }
  }, 600));
}

function scheduleAiMove() {
  if (!rank || rank.over) return;
  /* 冻结卡生效：AI 下一回合被冰冻跳过 */
  if (rank.frozen) {
    rank.frozen = false;
    rank.busy = true;
    const aiSide = document.querySelector('.rank-score .side.ai');
    aiSide.classList.add('frozen');
    setRankMsg('❄️ 对手被冰冻，跳过回合！');
    sndMiss();
    rank.timers.push(setTimeout(() => {
      if (!rank) return;
      aiSide.classList.remove('frozen');
      rank.busy = false;
      rank.turn = 'you';
      renderRankHud();
      setRankMsg('❄️ AI 被冰冻，轮到你连翻！');
    }, 1100));
    return;
  }
  rank.timers.push(setTimeout(aiMove, 900));
}

/* ===== 排位赛道具：冻结卡 / 透视卡 ===== */
function useFreeze() {
  if (!rank || rank.over || rank.busy || rank.turn !== 'you') return;
  const items = getItems();
  if (items.freeze <= 0 || rank.frozen) return;
  addItem('freeze', -1);
  rank.frozen = true;
  sndMatch();
  renderRankHud();
  setRankMsg('❄️ 已使用冻结卡！对手下回合将被冰冻跳过');
}

function usePeek() {
  if (!rank || rank.over || rank.busy || rank.turn !== 'you') return;
  const items = getItems();
  if (items.peek <= 0) return;
  /* 随机选一张未配对、未翻开的牌 */
  const cand = rank.deck.map((c, i) => i).filter((i) => !rank.deck[i].done && !rank.deck[i].open);
  if (!cand.length) return;
  const idx = cand[Math.floor(Math.random() * cand.length)];
  addItem('peek', -1);
  rank.busy = true;
  const el = $('rankGrid').children[idx];
  el.classList.add('open', 'peek');
  sndFlip();
  renderRankHud();
  setRankMsg(`👁️ 透视卡发动！第 ${idx + 1} 号牌是「${rank.deck[idx].e}」`);
  rank.timers.push(setTimeout(() => {
    if (!rank) return;
    el.classList.remove('open', 'peek');
    rank.busy = false;
    renderRankHud();
    setRankMsg('轮到你了：记住位置，继续翻牌！');
  }, 1500));
}

function aiMove() {
  if (!rank || rank.over || rank.turn !== 'ai') return;
  const tier = rankTierOf(getRankPoints());
  const openIdx = (i) => {
    rank.deck[i].open = true;
    rank.open.push(i);
    rankUpdateCard(i);
    rankAiLearn(i);
    sndFlip();
  };
  const pickUnknown = () => {
    const cand = rank.deck.map((c, i) => ({ c, i })).filter((x) => !x.c.done && !x.c.open && !rank.aiMem.some((m) => m.i === x.i));
    const pool = cand.length ? cand : rank.deck.map((c, i) => ({ c, i })).filter((x) => !x.c.done && !x.c.open);
    return pool[Math.floor(Math.random() * pool.length)].i;
  };
  const pickKnownMate = (firstIdx) => {
    const e = rank.deck[firstIdx].e;
    const mate = rank.aiMem.find((x) => x.i !== firstIdx && rank.deck[x.i].e === e && !rank.deck[x.i].done && !rank.deck[x.i].open);
    return mate ? mate.i : null;
  };

  /* 第一步：记忆中有现成对子就直接开（miss 概率会失误） */
  const known = rank.aiMem.filter((x) => !rank.deck[x.i].done && !rank.deck[x.i].open);
  const byE = {};
  known.forEach((x) => (byE[x.e] = byE[x.e] || []).push(x.i));
  const pairE = Object.keys(byE).find((e) => byE[e].length >= 2);
  const first = pairE && Math.random() > tier.miss ? byE[pairE][0] : pickUnknown();
  openIdx(first);

  rank.busy = true;
  rank.timers.push(setTimeout(() => {
    if (!rank) return;
    /* 第二步：与刚翻的牌配对则开记忆中的另一半，否则随机猜 */
    let second = Math.random() > tier.miss ? pickKnownMate(first) : null;
    if (second === null) {
      const cand = rank.deck.map((c, i) => ({ c, i })).filter((x) => !x.c.done && !x.c.open && x.i !== first);
      second = cand[Math.floor(Math.random() * cand.length)].i;
    }
    openIdx(second);
    const a = first, b = second;
    rank.timers.push(setTimeout(() => {
      if (!rank) return;
      if (rank.deck[a].e === rank.deck[b].e) {
        rank.deck[a].done = rank.deck[b].done = true;
        rank.open = [];
        rank.ai++;
        rankUpdateCard(a);
        rankUpdateCard(b);
        rankAiForgetDone(a, b);
        sndMatch();
        rank.busy = false;
        renderRankHud();
        if (rank.you + rank.ai === FLIP_EMOJIS.length) return settleRank();
        setRankMsg('🤖 AI 配对成功，它继续翻…');
        scheduleAiMove();
      } else {
        $('rankGrid').children[a].classList.add('shake');
        $('rankGrid').children[b].classList.add('shake');
        sndMiss();
        rank.timers.push(setTimeout(() => {
          if (!rank) return;
          rank.deck[a].open = rank.deck[b].open = false;
          rank.open = [];
          $('rankGrid').children[a].classList.remove('shake');
          $('rankGrid').children[b].classList.remove('shake');
          rankUpdateCard(a);
          rankUpdateCard(b);
          rank.busy = false;
          rank.turn = 'you';
          renderRankHud();
          setRankMsg('❌ AI 没配上，轮到你了！');
        }, 700));
      }
    }, 600));
  }, 900));
}

function settleRank() {
  rank.over = true;
  const you = rank.you, ai = rank.ai;
  const result = you > ai ? 'win' : you < ai ? 'lose' : 'draw';

  /* ===== 集中更新：积分、战绩、连胜、峰值（单一状态出口） ===== */
  const stats = getRankStats();
  const oldStreak = stats.streak;
  let base, bonus = 0, coinsEarned;
  if (result === 'win') {
    base = 30;
    /* 连胜奖励：第 2 场连胜起每场 +5，封顶 +25 */
    bonus = oldStreak >= 1 ? Math.min(oldStreak, 5) * 5 : 0;
    coinsEarned = 50;
    stats.w += 1;
    stats.streak = oldStreak + 1;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    sndWin();
  } else if (result === 'lose') {
    base = -20;
    coinsEarned = 10;
    stats.l += 1;
    stats.streak = 0;
    sndMiss();
  } else {
    base = 10;
    coinsEarned = 20;
    stats.d += 1;
    stats.streak = 0;
    sndMatch();
  }
  const delta = base + bonus;
  const oldPts = getRankPoints();
  const oldTier = rankTierOf(oldPts);
  const pts = Math.max(0, oldPts + delta);
  localStorage.setItem('mem_rank_points', String(pts));
  stats.peak = Math.max(stats.peak, pts);
  saveRankStats(stats);
  addCoins(coinsEarned);
  renderCoins(true);

  const newTier = rankTierOf(pts);
  const promoted = newTier.min > oldTier.min;
  const demoted = newTier.min < oldTier.min;

  renderRankHud();
  let msg = result === 'win' ? `🎉 胜利 ${you} : ${ai}！积分 +${delta}`
    : result === 'lose' ? `😭 惜败 ${you} : ${ai}，积分 ${delta}`
    : `🤝 ${you} : ${ai} 战平，积分 +${delta}`;
  if (promoted) msg += `，晋级 ${newTier.icon}${newTier.name}！`;
  else if (demoted) msg += `，降级到 ${newTier.icon}${newTier.name}`;
  setRankMsg(msg, delta > 0 ? 'ok' : 'bad');

  /* 胜利波浪动画，随后弹出结算窗 */
  [...$('rankGrid').children].forEach((el, i) => rank.timers.push(setTimeout(() => el.classList.add('wave'), i * 45)));
  rank.timers.push(setTimeout(() => {
    if (!rank) return;
    showRankResult({ result, you, ai, delta, bonus, coins: coinsEarned, promoted, demoted, tier: newTier, stats });
  }, 1150));
  renderBest();
  submitScore(); /* 登录后自动提交成绩到全服排行榜（离线静默跳过） */
}

function showRankResult({ result, you, ai, delta, bonus, coins, promoted, demoted, tier, stats }) {
  const card = $('rankResultCard');
  card.className = 'rank-result-card ' + result + (promoted ? ' promote' : '');
  $('rrIcon').textContent = result === 'win' ? (promoted ? '🏆' : '🎉') : result === 'lose' ? '😢' : '🤝';
  $('rrTitle').textContent = result === 'win' ? (promoted ? '晋级胜利！' : '胜利！') : result === 'lose' ? '惜败' : '战平';
  $('rrScore').textContent = `${you} : ${ai}`;
  $('rrDelta').textContent = delta > 0 ? `+${delta} 积分` : `${delta} 积分`;
  $('rrDelta').style.color = delta > 0 ? 'var(--right)' : 'var(--wrong)';
  $('rrCoins').textContent = `🪙 +${coins} 金币`;
  $('rrTier').textContent = promoted
    ? `⬆ 晋级 ${tier.icon}${tier.name}！`
    : demoted ? `⬇ 降级 ${tier.icon}${tier.name}` : '';
  const total = stats.w + stats.d + stats.l;
  const winRate = Math.round((stats.w / total) * 100);
  let sub = `战绩 ${stats.w}胜 ${stats.d}平 ${stats.l}负 · 胜率 ${winRate}%`;
  if (bonus > 0) sub += `　连胜奖励 +${bonus}`;
  else if (stats.streak >= 2) sub += `　🔥 ${stats.streak} 连胜中`;
  $('rrSub').textContent = sub;
  $('rankResult').hidden = false;
}

$('rankRestart').addEventListener('click', newRank);
$('rankBack').addEventListener('click', () => showView('home'));
$('useFreeze').addEventListener('click', useFreeze);
$('usePeek').addEventListener('click', usePeek);
$('rrAgain').addEventListener('click', newRank);
$('rrHome').addEventListener('click', () => {
  $('rankResult').hidden = true;
  showView('home');
});

/* ================= 金币 & 装饰商店 ================= */
const CARDBACKS = [
  { id: 'default', name: '经典紫', symbol: '?', price: 0, desc: '最初的记忆卡背' },
  { id: 'starry', name: '星空', symbol: '⭐', price: 100, desc: '深邃夜空中的点点繁星' },
  { id: 'flame', name: '烈焰', symbol: '🔥', price: 150, desc: '燃烧吧，记忆之火' },
  { id: 'ocean', name: '海洋', symbol: '🌊', price: 150, desc: '清凉深邃的蓝色波涛' },
  { id: 'forest', name: '森林', symbol: '🌿', price: 200, desc: '生机勃勃的翠绿林间' },
  { id: 'neon', name: '霓虹', symbol: '💠', price: 300, desc: '赛博都市的炫彩灯光' },
  { id: 'rainbow', name: '彩虹', symbol: '🌈', price: 400, desc: '雨后天空的七色光芒' },
  { id: 'gold', name: '王者金', symbol: '👑', price: 800, desc: '最强王者的专属荣耀' },
];

function getCoins() {
  return Number(localStorage.getItem('mem_coins')) || 0;
}

function addCoins(n) {
  const c = Math.max(0, getCoins() + n);
  localStorage.setItem('mem_coins', String(c));
  return c;
}

/* ===== 提示道具：全局库存，三个游戏通用；每局保底 3 个，可金币购买叠加 ===== */
function getHints() {
  return Math.max(0, Number(localStorage.getItem('mem_hints')) || 0);
}

function addHints(n) {
  const v = Math.max(0, getHints() + n);
  localStorage.setItem('mem_hints', String(v));
  return v;
}

/* 新一局开始：库存不足 3 时补足（保底免费 3 个） */
function ensureHints() {
  if (getHints() < 3) localStorage.setItem('mem_hints', '3');
  return getHints();
}

/* ===== 排位赛道具：冻结卡 / 透视卡（金币购买） ===== */
function getItems() {
  try {
    const o = JSON.parse(localStorage.getItem('mem_items'));
    return { freeze: Number(o.freeze) || 0, peek: Number(o.peek) || 0 };
  } catch {
    return { freeze: 0, peek: 0 };
  }
}

function addItem(key, n) {
  const items = getItems();
  items[key] = Math.max(0, items[key] + n);
  localStorage.setItem('mem_items', JSON.stringify(items));
  return items[key];
}

/* 购买一个排位赛道具（price 金币） */
function buyItem(key, price) {
  if (getCoins() < price) {
    sndMiss();
    return;
  }
  addCoins(-price);
  addItem(key, 1);
  sndWin();
  renderCoins(true);
  renderShop();
}

function renderHintBtns() {
  if (typeof updateFlipHintBtn === 'function') updateFlipHintBtn();
  if (typeof updateDigitHintBtn === 'function') updateDigitHintBtn();
  if (typeof updateSimonHintBtn === 'function') updateSimonHintBtn();
}

function getOwnedBacks() {
  try {
    const arr = JSON.parse(localStorage.getItem('mem_owned_backs'));
    return Array.isArray(arr) && arr.length ? arr : ['default'];
  } catch {
    return ['default'];
  }
}

function getCardback() {
  return localStorage.getItem('mem_cardback') || 'default';
}

function setCardback(id) {
  localStorage.setItem('mem_cardback', id);
  document.body.dataset.cardback = id;
}

function renderCoins(pop) {
  const c = getCoins();
  $('navCoins').textContent = c;
  $('shopCoins').textContent = c;
  $('bestShop').textContent = `🪙 ${c} 金币`;
  if (pop) {
    document.querySelectorAll('.coins-pill').forEach((el) => {
      el.classList.remove('coin-pop');
      void el.offsetWidth;
      el.classList.add('coin-pop');
    });
  }
}

function renderShop() {
  const grid = $('shopGrid');
  const coins = getCoins();
  const owned = getOwnedBacks();
  const equipped = getCardback();

  /* 提示包：库存 + 购买按钮状态 */
  $('shopHints').textContent = getHints();
  const buyBtn = $('buyHints');
  if (coins >= 20) {
    buyBtn.textContent = '🪙 20 购买';
    buyBtn.disabled = false;
    buyBtn.classList.remove('poor');
  } else {
    buyBtn.textContent = '🪙 20（不足）';
    buyBtn.disabled = true;
    buyBtn.classList.add('poor');
  }

  /* 看广告：今日剩余次数 */
  const adLeft = getAdLeft();
  $('shopAdLeft').textContent = adLeft;
  const adBtn = $('watchAd');
  if (adLeft <= 0) {
    adBtn.textContent = '今日已看完';
    adBtn.disabled = true;
  } else {
    adBtn.textContent = '📺 观看广告';
    adBtn.disabled = false;
  }

  /* 排位赛道具：冻结卡 40 / 透视卡 30 */
  const items = getItems();
  $('shopFreeze').textContent = items.freeze;
  $('shopPeek').textContent = items.peek;
  const setUpBuy = (id, price, stock) => {
    const b = $(id);
    if (coins >= price) {
      b.textContent = `🪙 ${price} 购买`;
      b.disabled = false;
      b.classList.remove('poor');
    } else {
      b.textContent = `🪙 ${price}（不足）`;
      b.disabled = true;
      b.classList.add('poor');
    }
  };
  setUpBuy('buyFreeze', 40);
  setUpBuy('buyPeek', 30);

  grid.innerHTML = '';
  CARDBACKS.forEach((item) => {
    const isOwned = owned.includes(item.id);
    const isEquipped = equipped === item.id;
    const div = document.createElement('div');
    div.className = 'shop-item' + (isEquipped ? ' equipped' : '');
    div.innerHTML = `
      <div class="shop-preview cb-${item.id}">${item.symbol}</div>
      <b>${item.name}</b>
      <span class="shop-desc">${item.desc}</span>
      <button class="shop-buy"></button>`;
    const btn = div.querySelector('.shop-buy');
    if (isEquipped) {
      btn.textContent = '✓ 已装备';
      btn.disabled = true;
    } else if (isOwned) {
      btn.textContent = '装备';
      btn.classList.add('owned');
    } else if (coins >= item.price) {
      btn.textContent = `🪙 ${item.price} 购买`;
    } else {
      btn.textContent = `🪙 ${item.price}（不足）`;
      btn.classList.add('poor');
      btn.disabled = true;
    }
    btn.addEventListener('click', () => buyOrEquip(item));
    grid.appendChild(div);
  });
}

function buyOrEquip(item) {
  const owned = getOwnedBacks();
  if (!owned.includes(item.id)) {
    if (getCoins() < item.price) {
      sndMiss();
      return;
    }
    addCoins(-item.price);
    owned.push(item.id);
    localStorage.setItem('mem_owned_backs', JSON.stringify(owned));
    sndWin();
  } else {
    sndMatch();
  }
  setCardback(item.id);
  renderCoins(true);
  renderShop();
}

/* ================= 入口 ================= */
function stopAllGames() {
  stopFlip();
  if (digit) digitClearTimers();
  stopSimon();
  stopRank();
}

$('openFlip').addEventListener('click', () => {
  showView('flip');
  newFlip();
});
$('openDigit').addEventListener('click', () => {
  showView('digit');
  newDigit();
});
$('openSimon').addEventListener('click', () => {
  showView('simon');
  newSimon();
});
$('openRank').addEventListener('click', () => {
  showView('rank');
  newRank();
});
$('openShop').addEventListener('click', () => {
  showView('shop');
  renderShop();
});
$('coinsBtn').addEventListener('click', () => {
  showView('shop');
  renderShop();
});
$('shopBack').addEventListener('click', () => showView('home'));
$('buyHints').addEventListener('click', () => {
  if (getCoins() < 20) {
    sndMiss();
    return;
  }
  addCoins(-20);
  addHints(3);
  sndWin();
  renderCoins(true);
  renderShop();
  renderHintBtns();
});
$('buyFreeze').addEventListener('click', () => buyItem('freeze', 40));
$('buyPeek').addEventListener('click', () => buyItem('peek', 30));
$('navLogo').addEventListener('click', () => showView('home'));

/* ================= 排行榜 ================= */
/* 离线降级用的机器人种子（与后端 BOT_SEED 保持一致） */
const LB_BOTS = [
  { name: '记忆大师007', points: 1680, w: 142, l: 23 },
  { name: '过目不忘', points: 1590, w: 128, l: 30 },
  { name: '最强大脑', points: 1475, w: 116, l: 33 },
  { name: '卡牌仙人', points: 1320, w: 104, l: 41 },
  { name: '闪电快手', points: 1180, w: 96, l: 47 },
  { name: '专注之神', points: 1050, w: 88, l: 44 },
  { name: '记忆力爆棚', points: 940, w: 79, l: 52 },
  { name: '沉默配对王', points: 860, w: 72, l: 55 },
  { name: '翻牌小天才', points: 745, w: 63, l: 58 },
  { name: '青铜守门员', points: 620, w: 54, l: 61 },
  { name: '慢慢来比较快', points: 520, w: 46, l: 63 },
  { name: '随缘选手', points: 430, w: 38, l: 66 },
  { name: '三秒记忆', points: 350, w: 31, l: 70 },
  { name: '别翻我牌', points: 260, w: 24, l: 72 },
  { name: '萌新玩家', points: 180, w: 17, l: 75 },
  { name: '路过打酱油', points: 110, w: 10, l: 78 },
  { name: '第一次玩', points: 45, w: 4, l: 80 },
  { name: '人机友好大使', points: 10, w: 1, l: 83 },
];

function getToken() {
  return localStorage.getItem('mem_token') || '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* 每局结算后自动提交成绩（需登录；离线静默跳过，下局再试） */
async function submitScore() {
  const token = getToken();
  if (!token) return;
  try {
    const s = getRankStats();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 6000);
    await fetch(PAY_API_BASE + '/api/leaderboard/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
      body: JSON.stringify({ points: getRankPoints(), w: s.w, d: s.d, l: s.l }),
      signal: ctrl.signal,
    });
  } catch { /* 离线忽略 */ }
}

/* 离线模式下按机器人种子估算名次 */
function localBoardRank() {
  const pts = getRankPoints();
  let rank = 1;
  for (const b of LB_BOTS) if (b.points > pts) rank += 1;
  return rank;
}

async function loadBoard() {
  const tip = $('boardTip');
  const listEl = $('boardList');
  listEl.innerHTML = '<div class="board-loading">⏳ 榜单加载中…</div>';
  tip.textContent = '';
  const phone = localStorage.getItem('mem_user') || '';
  const token = getToken();
  let list, self, online = false;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 6000);
    const url = PAY_API_BASE + '/api/leaderboard' + (token ? '?token=' + encodeURIComponent(token) : '');
    const r = await fetch(url, { signal: ctrl.signal });
    const j = await r.json();
    if (!j.ok) throw new Error('bad');
    list = j.list;
    self = j.self;
    online = true;
  } catch {
    /* 离线降级：机器人 + 本机成绩 */
    const s = getRankStats();
    const played = s.w + s.d + s.l > 0 || getRankPoints() > 0;
    list = LB_BOTS.map((b, i) => ({ rank: 0, name: b.name, points: b.points, w: b.w, d: 0, l: b.l, bot: true, id: 'bot' + i }));
    if (played) {
      list.push({ rank: 0, name: phone ? maskPhone(phone) : '我', points: getRankPoints(), w: s.w, d: s.d, l: s.l, bot: false, id: 'me' });
    }
    list.sort((a, b) => b.points - a.points || b.w - a.w);
    list = list.slice(0, 50).map((e, i) => { e.rank = i + 1; return e; });
    self = played ? list.find((e) => e.id === 'me') : null;
    tip.textContent = '⚠️ 未连接到服务器，显示离线榜单；登录后打排位赛可参与全服排名';
  }
  renderBoard(list, self, online, phone);
  $('boardNick').style.display = token ? 'flex' : 'none';
}

function renderBoard(list, self, online, phone) {
  if (self) {
    $('boardSelfRank').textContent = self.rank <= 50 ? '#' + self.rank : '50+';
    $('boardSelfName').textContent = self.name;
    const tier = rankTierOf(self.points);
    $('boardSelfSub').textContent = `${tier.icon}${tier.name} · ${self.w}胜${self.d ? self.d + '平' : ''}${self.l}负`;
    $('boardSelfPts').textContent = self.points;
    $('boardSelf').classList.add('on');
  } else {
    $('boardSelfRank').textContent = '--';
    $('boardSelfName').textContent = getToken() ? '暂未上榜' : '未登录';
    $('boardSelfSub').textContent = getToken() ? '完成一局排位赛即可上榜' : '登录后成绩可进入全服榜单';
    $('boardSelfPts').textContent = getRankPoints();
    $('boardSelf').classList.remove('on');
  }
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  $('boardList').innerHTML = list.map((e) => {
    const tier = rankTierOf(e.points);
    const isSelf = (online && !e.bot && phone && e.id === phone) || (!online && e.id === 'me');
    return `<div class="board-row${isSelf ? ' self' : ''}">
      <span class="b-rank">${medals[e.rank] || '#' + e.rank}</span>
      <span class="b-name">${escapeHtml(e.name)}${e.bot ? '<em class="b-bot">AI</em>' : ''}${isSelf ? '<em class="b-me">我</em>' : ''}</span>
      <span class="b-tier">${tier.icon}</span>
      <span class="b-wl">${e.w}胜</span>
      <span class="b-pts">${e.points}</span>
    </div>`;
  }).join('');
  const pts = getRankPoints();
  boardOnline = online;
  boardSelfRank = self ? self.rank : null;
  $('bestBoard').textContent = pts > 0
    ? (online && self ? `全服第 ${self.rank} 名` : `暂列第 ${localBoardRank()} 名`)
    : '暂未上榜';
}

async function saveNickname() {
  const token = getToken();
  const nickname = $('nickInput').value.trim();
  if (!token) { $('boardTip').textContent = '请先登录后再设置昵称'; return; }
  if (!nickname) { $('boardTip').textContent = '昵称不能为空（最多 12 个字符）'; return; }
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(PAY_API_BASE + '/api/me/nickname', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
      body: JSON.stringify({ nickname }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (!j.ok) { $('boardTip').textContent = j.error || '保存失败'; sndMiss(); return; }
    $('nickInput').value = '';
    $('boardTip').textContent = '✅ 昵称已保存：' + j.nickname;
    sndMatch();
    await loadBoard();
  } catch {
    $('boardTip').textContent = '服务器未连接，暂时无法保存昵称';
  }
}

$('openBoard').addEventListener('click', () => { showView('board'); loadBoard(); });
$('boardBack').addEventListener('click', () => showView('home'));
$('boardRefresh').addEventListener('click', loadBoard);
$('nickSave').addEventListener('click', saveNickname);

/* ================= 后端服务地址（短信登录等接口使用） ================= */
const PAY_API_BASE = 'http://localhost:8080';

/* ================= 激励广告（模拟，每日限 3 次） ================= */
/* 真实环境替换为 AdSense/穿山甲/微信广告 SDK 的 rewarded video，
   在 onClose(isCompleted) 回调里发奖即可。 */
const AD_DAILY_LIMIT = 3;
const AD_SECONDS = 5;
let adTimer = null;
let adRewarded = false; /* 本次广告是否已领取，防重复发奖 */

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/* 今日剩余观看次数（跨天自动重置） */
function getAdLeft() {
  if (localStorage.getItem('mem_ad_date') !== todayStr()) return AD_DAILY_LIMIT;
  const used = Number(localStorage.getItem('mem_ad_count')) || 0;
  return Math.max(0, AD_DAILY_LIMIT - used);
}

function consumeAd() {
  if (localStorage.getItem('mem_ad_date') !== todayStr()) {
    localStorage.setItem('mem_ad_date', todayStr());
    localStorage.setItem('mem_ad_count', '0');
  }
  localStorage.setItem('mem_ad_count', String((Number(localStorage.getItem('mem_ad_count')) || 0) + 1));
}

function stopAdTimer() {
  if (adTimer) {
    clearInterval(adTimer);
    adTimer = null;
  }
}

function closeAd(rewarded) {
  stopAdTimer();
  $('adOverlay').hidden = true;
  $('adPlaying').hidden = false;
  $('adDone').hidden = true;
  $('adProgressBar').style.width = '0%';
  $('adCountdown').textContent = AD_SECONDS;
  if (!rewarded) renderShop(); /* 中途退出：刷新按钮（无变化） */
}

function startAd() {
  if (getAdLeft() <= 0) {
    sndMiss();
    return;
  }
  adRewarded = false; /* 每次播放重置领奖标记 */
  $('adOverlay').hidden = false;
  $('adPlaying').hidden = false;
  $('adDone').hidden = true;
  sndFlip();
  let left = AD_SECONDS;
  $('adCountdown').textContent = left;
  $('adProgressBar').style.width = '0%';
  const tickMs = 100;
  let elapsed = 0;
  stopAdTimer();
  adTimer = setInterval(() => {
    elapsed += tickMs;
    $('adProgressBar').style.width = Math.min(100, (elapsed / (AD_SECONDS * 1000)) * 100) + '%';
    const remain = Math.ceil((AD_SECONDS * 1000 - elapsed) / 1000);
    if (remain !== left) {
      left = remain;
      $('adCountdown').textContent = Math.max(0, left);
    }
    if (elapsed >= AD_SECONDS * 1000) {
      stopAdTimer();
      $('adPlaying').hidden = true;
      $('adDone').hidden = false;
      sndMatch();
    }
  }, tickMs);
}

/* 看完领取：+1 提示、今日次数 -1 */
$('adReward').addEventListener('click', () => {
  if (adRewarded) return; /* 防重复领取 */
  adRewarded = true;
  consumeAd();
  addHints(1);
  sndWin();
  closeAd(true);
  renderCoins();
  renderShop();
  renderHintBtns();
});
$('watchAd').addEventListener('click', startAd);
$('adClose').addEventListener('click', () => closeAd(false));

/* ================= 手机号登录（演示流程） ================= */
/* 真实环境：sendCode 改为请求后端 /api/sms/send（后端对接短信服务），
   doLogin 改为请求 /api/sms/verify 校验并返回 token，localStorage 存 token。 */
let loginCountdown = null;
let sentCode = '';

function getUser() {
  return localStorage.getItem('mem_user');
}

function maskPhone(p) {
  if (!p || p.length !== 11) return p || '';
  return p.slice(0, 3) + '****' + p.slice(7);
}

function setLoginMsg(text) {
  $('loginMsg').textContent = text || '';
}

function renderUser() {
  const p = getUser();
  const btn = $('userBtn');
  if (p) {
    btn.classList.add('logged');
    $('userLabel').textContent = maskPhone(p);
  } else {
    btn.classList.remove('logged');
    $('userLabel').textContent = '登录';
  }
}

function openLogin() {
  const p = getUser();
  $('loginOverlay').hidden = false;
  setLoginMsg('');
  $('loginDemoCode').hidden = true;
  if (p) {
    /* 已登录：显示账号信息 */
    $('loginForm').hidden = true;
    $('loginAccount').hidden = false;
    $('acctPhone').textContent = maskPhone(p);
  } else {
    $('loginForm').hidden = false;
    $('loginAccount').hidden = true;
    $('loginPhone').value = '';
    $('loginCode').value = '';
    resetSendBtn();
    setTimeout(() => $('loginPhone').focus(), 50);
  }
}

function closeLogin() {
  $('loginOverlay').hidden = true;
}

function resetSendBtn() {
  if (loginCountdown) {
    clearInterval(loginCountdown);
    loginCountdown = null;
  }
  const btn = $('loginSend');
  btn.disabled = false;
  btn.textContent = '获取验证码';
}

function validPhone(p) {
  return /^1[3-9]\d{9}$/.test(p);
}

/* 发码通道：'backend' 走后端短信服务；'demo' 后端不可达时本地降级 */
let smsMode = null;

function startCountdown() {
  let left = 60;
  const btn = $('loginSend');
  resetSendBtn(); /* 清掉可能存在的旧倒计时 */
  btn.disabled = true;
  btn.textContent = `${left}s 后重发`;
  loginCountdown = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      resetSendBtn();
    } else {
      btn.textContent = `${left}s 后重发`;
    }
  }, 1000);
}

async function sendCode() {
  const phone = $('loginPhone').value.trim();
  if (!validPhone(phone)) {
    setLoginMsg('请输入正确的 11 位手机号');
    sndMiss();
    return;
  }
  setLoginMsg('');

  let data = null;
  let netFailed = false;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(PAY_API_BASE + '/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
      signal: ctrl.signal,
    });
    data = await r.json();
  } catch {
    netFailed = true; /* 后端未启动/超时 */
  }

  if (netFailed || !data) {
    /* 降级：本地演示验证码（离线可玩） */
    sentCode = String(Math.floor(100000 + Math.random() * 900000));
    smsMode = 'demo';
    const demo = $('loginDemoCode');
    demo.hidden = false;
    demo.textContent = `演示验证码：${sentCode}（后端未连接，本地演示模式）`;
    sndMatch();
    startCountdown();
    return;
  }

  if (!data.ok) {
    /* 后端业务拒绝（频率限制/号码非法），直接展示原因 */
    setLoginMsg(data.error || '发送失败，请稍后再试');
    sndMiss();
    return;
  }

  smsMode = 'backend';
  sentCode = '';
  const demo = $('loginDemoCode');
  if (data.devCode) {
    /* 沙盒模式：后端返回开发验证码 */
    demo.hidden = false;
    demo.textContent = `演示验证码：${data.devCode}（沙盒环境，不真实发短信）`;
  } else {
    demo.hidden = true;
    setLoginMsg(`✅ 验证码已发送至 ${maskPhone(phone)}，5 分钟内有效`);
  }
  sndMatch();
  startCountdown();
}

async function doLogin() {
  const phone = $('loginPhone').value.trim();
  const code = $('loginCode').value.trim();
  if (!validPhone(phone)) {
    setLoginMsg('请输入正确的手机号');
    sndMiss();
    return;
  }
  if (code.length !== 6) {
    setLoginMsg('请输入 6 位验证码');
    sndMiss();
    return;
  }

  if (smsMode === 'backend') {
    let data = null;
    let netFailed = false;
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(PAY_API_BASE + '/api/sms/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
        signal: ctrl.signal,
      });
      data = await r.json();
    } catch {
      netFailed = true;
    }
    if (netFailed || !data) {
      setLoginMsg('后端连接中断，请稍后重试');
      sndMiss();
      return;
    }
    if (!data.ok) {
      setLoginMsg(data.error || '验证失败');
      sndMiss();
      return;
    }
    localStorage.setItem('mem_user', phone);
    localStorage.setItem('mem_token', data.token || '');
  } else {
    /* 演示降级：本地校验 */
    if (!sentCode) {
      setLoginMsg('请先获取验证码');
      sndMiss();
      return;
    }
    if (code !== sentCode) {
      setLoginMsg('验证码错误，请重新输入');
      sndMiss();
      return;
    }
    localStorage.setItem('mem_user', phone);
    localStorage.removeItem('mem_token');
  }
  sentCode = '';
  smsMode = null;
  resetSendBtn();
  renderUser();
  sndWin();
  closeLogin();
}

function logout() {
  localStorage.removeItem('mem_user');
  localStorage.removeItem('mem_token');
  renderUser();
  sndFlip();
  closeLogin();
}

$('userBtn').addEventListener('click', openLogin);
$('loginClose').addEventListener('click', closeLogin);
$('loginOverlay').addEventListener('click', (e) => {
  if (e.target === $('loginOverlay')) closeLogin();
});
$('loginSend').addEventListener('click', sendCode);
$('loginSubmit').addEventListener('click', doLogin);
$('loginLogout').addEventListener('click', logout);
/* 输入框只允许数字 */
$('loginPhone').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11);
});
$('loginCode').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
});

/* 初始化：保底 3 个提示 + 应用已装备的卡背 + 金币显示 + 登录态 */
ensureHints();
document.body.dataset.cardback = getCardback();
renderCoins();
renderBest();
renderUser();

/* PWA：仅 HTTP(S) 环境注册 Service Worker（双击 file:// 打开不受影响） */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
