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
}

/* ================= 翻牌配对 ================= */
const FLIP_EMOJIS = ['🍎', '🚀', '🐱', '🌈', '⚽', '🎵', '🌻', '🐳'];
const flipGrid = $('flipGrid');

let flip = null;

function newFlip() {
  stopFlip();
  const deck = shuffle([...FLIP_EMOJIS, ...FLIP_EMOJIS]).map((e, i) => ({ e, done: false, open: false }));
  flip = { deck, open: [], matched: 0, moves: 0, startTs: null, timerId: null, lock: false, hints: 3 };
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
  flipHintBtn.textContent = `提示（${flip ? flip.hints : 0}）`;
  flipHintBtn.disabled = !flip || flip.hints <= 0;
}

function useFlipHint() {
  if (!flip || flip.lock || flip.hints <= 0) return;
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
  flip.hints--;
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
  digit.hints = 3; /* 每局（一次完整挑战）共 3 次 */
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
  digitHintBtn.textContent = `提示（${digit.hints}）`;
  digitHintBtn.disabled = !digit || digit.hints <= 0;
}

function useDigitHint() {
  if (!digit || digit.phase !== 'input' || digit.hints <= 0) return;
  digit.hints--;
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
  simon.hints = 3; /* 每局 3 次 */
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
  simonHintBtn.textContent = `提示（${simon ? simon.hints : 0}）`;
  simonHintBtn.disabled = !simon || simon.hints <= 0;
}

function useSimonHint() {
  if (!simon || simon.phase !== 'input' || simon.hints <= 0) return;
  simon.hints--;
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
  $('rankBadge').textContent = tier.icon;
  $('rankName').textContent = tier.name;
  $('rankPoints').textContent = pts + ' 积分';
  $('rankOppName').textContent = tier.opp;
  $('rankYou').textContent = rank.you;
  $('rankAi').textContent = rank.ai;
  $('rankTurn').textContent = rank.over ? '本局结束' : (rank.turn === 'you' ? '你的回合' : `${tier.opp} 思考中…`);
  document.querySelector('.rank-score .side.you').classList.toggle('active', !rank.over && rank.turn === 'you');
  document.querySelector('.rank-score .side.ai').classList.toggle('active', !rank.over && rank.turn === 'ai');
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
  rank.timers.push(setTimeout(aiMove, 900));
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
  const oldMin = rankTierOf(getRankPoints()).min;
  let delta, msg;
  if (you > ai) {
    delta = 30;
    msg = `🎉 胜利 ${you} : ${ai}！积分 +30`;
    sndWin();
  } else if (you < ai) {
    delta = -20;
    msg = `😭 惜败 ${you} : ${ai}，积分 -20`;
    sndMiss();
  } else {
    delta = 10;
    msg = `🤝 ${you} : ${ai} 战平，积分 +10`;
    sndMatch();
  }
  const pts = Math.max(0, getRankPoints() + delta);
  localStorage.setItem('mem_rank_points', String(pts));
  const tier = rankTierOf(pts);
  if (tier.min > oldMin) msg += `，晋级 ${tier.icon}${tier.name}！`;
  else if (tier.min < oldMin) msg += `，降级到 ${tier.icon}${tier.name}`;
  renderRankHud();
  setRankMsg(msg, delta > 0 ? 'ok' : delta < 0 ? 'bad' : '');
  /* 胜利波浪动画 */
  [...$('rankGrid').children].forEach((el, i) => setTimeout(() => el.classList.add('wave'), i * 45));
  renderBest();
}

$('rankRestart').addEventListener('click', newRank);
$('rankBack').addEventListener('click', () => showView('home'));

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
$('navLogo').addEventListener('click', () => showView('home'));

renderBest();

/* PWA：仅 HTTP(S) 环境注册 Service Worker（双击 file:// 打开不受影响） */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
