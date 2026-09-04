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
  if (name !== 'friends') stopFriendPoll();
  if (name !== 'world') stopWorld();
  document.querySelectorAll('main > section[id^="view-"]').forEach((s) => {
    s.hidden = s.id !== 'view-' + name;
  });
  if (name === 'home') { renderBest(); worldReturn = false; }
  if (name === 'friends') { loadFriends(); startFriendPoll(); }
  if (name === 'world') startWorld();
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
  $('bestFriends').textContent = friendData ? (friendData.friends || []).length + ' 位好友' : '--';
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

/* ================= 翻牌学院（关卡制 + 技能） ================= */
const ACADEM_EMOJIS = [
  '🍎', '🚀', '🐱', '🌈', '⚽', '🎵', '🌻', '🐳', '🍩', '🎈',
  '🦊', '🍉', '🎸', '🐧', '🌙', '🍦', '🚲', '🌈', '🍔', '🦄',
  '🎮', '🍀', '🐶', '🎯',
];

const ACADEM_SKILLS = {
  glass: { emoji: '🧐', name: '记忆眼镜', price: 80 },
  freeze: { emoji: '⏸️', name: '时间冻结', price: 100 },
  respin: { emoji: '🔄', name: '重洗卡', price: 50 },
};

/* 关卡规格：返回 {cols, rows, pairs, limitSec|null} */
function acadLevelSpec(n) {
  const table = [
    { cols: 4, rows: 4, pairs: 8, limitSec: null },   /* L1 */
    { cols: 5, rows: 4, pairs: 10, limitSec: null },  /* L2 */
    { cols: 6, rows: 4, pairs: 12, limitSec: null },  /* L3 */
    { cols: 6, rows: 6, pairs: 18, limitSec: 90 },     /* L4 */
    { cols: 6, rows: 6, pairs: 18, limitSec: 75 },    /* L5 */
  ];
  if (n <= table.length) return table[n - 1];
  const limit = Math.max(30, 90 - (n - 4) * 10);
  return { cols: 6, rows: 6, pairs: 18, limitSec: limit };
}

const acadGrid = $('acadGrid');
let acad = null;

function getAcadMax() { return Math.max(0, Number(localStorage.getItem('mem_acad_max')) || 0); }
function setAcadMax(n) { localStorage.setItem('mem_acad_max', String(n)); }
function getAcadCur() { return Math.max(1, Number(localStorage.getItem('mem_acad_cur')) || 1); }
function setAcadCur(n) { localStorage.setItem('mem_acad_cur', String(n)); }

function getAcadItems() {
  try {
    const o = JSON.parse(localStorage.getItem('mem_acad_items'));
    return { glass: Number(o.glass) || 0, freeze: Number(o.freeze) || 0, respin: Number(o.respin) || 0 };
  } catch { return { glass: 0, freeze: 0, respin: 0 }; }
}
function addAcadItem(key, n) {
  const items = getAcadItems();
  items[key] = Math.max(0, items[key] + n);
  localStorage.setItem('mem_acad_items', JSON.stringify(items));
  return items[key];
}
function buyAcadItem(key) {
  const price = ACADEM_SKILLS[key].price;
  if (getCoins() < price) { sndMiss(); return; }
  addCoins(-price);
  addAcadItem(key, 1);
  sndWin();
  openAcademy();
}

/* ---- 大厅 ---- */
function openAcademy() {
  stopAcad();
  $('acadLobby').hidden = false;
  $('acadArena').hidden = true;
  $('acadCoins').textContent = getCoins();
  const items = getAcadItems();
  document.querySelectorAll('.acad-skill').forEach((el) => {
    const k = el.dataset.skill;
    el.querySelector('[data-stock]').textContent = items[k];
    const btn = el.querySelector('[data-buy]');
    btn.disabled = getCoins() < ACADEM_SKILLS[k].price;
  });
  const cur = getAcadCur();
  const max = getAcadMax();
  $('acadCurLevel').textContent = cur;
  $('acadMaxLevel').textContent = max;
  const spec = acadLevelSpec(cur);
  const limitTxt = spec.limitSec ? `、限时 ${spec.limitSec} 秒` : '';
  $('acadRuleText').textContent = `第 ${cur} 关：${spec.cols}×${spec.rows} 牌桌、${spec.pairs} 对配对${limitTxt}。通关 +${cur * 15} 金币。`;
  $('acadStart').textContent = `🎯 开始第 ${cur} 关挑战`;
}

function renderAcadShop() { /* 大厅刷新在 openAcademy 内统一处理 */ }

/* ---- 关卡 ---- */
function acadStart() {
  const n = getAcadCur();
  const spec = acadLevelSpec(n);
  const pool = shuffle(ACADEM_EMOJIS).slice(0, spec.pairs);
  const deck = shuffle([...pool, ...pool]).map((e) => ({ e, done: false, open: false }));
  acad = {
    level: n, spec, deck, open: [], matched: 0, moves: 0,
    startTs: null, timerId: null, limitId: null, lock: false,
    glassMode: false, freezeUntil: 0, dead: false,
  };
  $('acadLobby').hidden = true;
  $('acadArena').hidden = false;
  $('acadMoves').textContent = '0';
  $('acadTime').textContent = '00:00';
  $('acadMatched').textContent = `0/${spec.pairs}`;
  $('acadMsg').textContent = '';
  $('acadMsg').className = 'game-msg';
  acadGrid.style.gridTemplateColumns = `repeat(${spec.cols}, 1fr)`;
  renderAcadGrid();
  acadDealAnimation();
  updateAcadSkillBtns();
  /* 限时条 */
  if (spec.limitSec) {
    $('acadLimitWrap').hidden = false;
    $('acadLimit').textContent = String(spec.limitSec);
    $('acadLimitWrap').classList.remove('danger');
  } else {
    $('acadLimitWrap').hidden = true;
  }
}

function renderAcadGrid() {
  acadGrid.innerHTML = '';
  acad.deck.forEach((card, i) => {
    const btn = document.createElement('button');
    btn.className = 'fcard';
    btn.innerHTML = `<div class="fcard-inner"><div class="face back"></div><div class="face front">${card.e}</div></div>`;
    btn.addEventListener('click', () => onAcadCard(i));
    acadGrid.appendChild(btn);
  });
}

function updateAcadCard(i) {
  const card = acad.deck[i];
  const el = acadGrid.children[i];
  el.classList.toggle('open', card.open);
  el.classList.toggle('done', card.done);
}

function acadDealAnimation() {
  const cards = [...acadGrid.children];
  acad.lock = true;
  cards.forEach((el, i) => {
    el.classList.add('deal');
    el.style.animationDelay = `${i * 40}ms`;
    sndDeal(i);
  });
  setTimeout(() => {
    cards.forEach((el) => { el.classList.remove('deal'); el.style.animationDelay = ''; });
    acad.lock = false;
  }, cards.length * 40 + 450);
}

function onAcadCard(i) {
  if (!acad || acad.dead) return;
  const card = acad.deck[i];
  /* 记忆眼镜选牌模式：透视一张 1.5s，不耗步数不触发配对 */
  if (acad.glassMode) {
    if (acad.lock || card.open || card.done) return;
    acad.glassMode = false;
    acadGrid.children[i].classList.add('open', 'hint');
    sndHint();
    setTimeout(() => {
      if (acad && !acad.deck[i].open) acadGrid.children[i].classList.remove('open', 'hint');
    }, 1500);
    return;
  }
  if (acad.lock || card.open || card.done) return;
  if (!acad.startTs) {
    acad.startTs = Date.now();
    acad.timerId = setInterval(acadTick, 500);
    if (acad.spec.limitSec) startAcadLimit();
  }
  card.open = true;
  acad.open.push(i);
  updateAcadCard(i);
  sndFlip();

  if (acad.open.length === 2) {
    acad.moves++;
    $('acadMoves').textContent = acad.moves;
    const [a, b] = acad.open;
    if (acad.deck[a].e === acad.deck[b].e) {
      acad.deck[a].done = acad.deck[b].done = true;
      acad.open = [];
      acad.matched++;
      $('acadMatched').textContent = `${acad.matched}/${acad.spec.pairs}`;
      updateAcadCard(a);
      updateAcadCard(b);
      sndMatch();
      if (acad.matched === acad.spec.pairs) winAcad();
    } else {
      acad.lock = true;
      acadGrid.children[a].classList.add('shake');
      acadGrid.children[b].classList.add('shake');
      sndMiss();
      setTimeout(() => {
        if (!acad || acad.dead) return;
        acad.deck[a].open = acad.deck[b].open = false;
        acad.open = [];
        acadGrid.children[a].classList.remove('shake');
        acadGrid.children[b].classList.remove('shake');
        updateAcadCard(a);
        updateAcadCard(b);
        acad.lock = false;
      }, 750);
    }
  }
}

function acadTick() {
  if (!acad || acad.dead) return;
  const sec = Math.floor((Date.now() - acad.startTs) / 1000);
  $('acadTime').textContent = fmtTime(sec);
}

function startAcadLimit() {
  const total = acad.spec.limitSec;
  const tick = () => {
    if (!acad || acad.dead) return;
    let elapsed = Math.floor((Date.now() - acad.startTs) / 1000);
    /* 冻结期内暂停扣减 */
    if (acad.freezeUntil > Date.now()) {
      /* 暂停期间延长 startTs 使倒计时不动 */
      acad.startTs += 500;
      elapsed = Math.floor((Date.now() - acad.startTs) / 1000);
    }
    const left = total - elapsed;
    $('acadLimit').textContent = String(Math.max(0, left));
    $('acadLimitWrap').classList.toggle('danger', left <= 10);
    if (left <= 0) { failAcad(); return; }
    acad.limitId = setTimeout(tick, 500);
  };
  tick();
}

function winAcad() {
  acad.dead = true;
  stopAcadTimers();
  const n = acad.level;
  const reward = n * 15;
  addCoins(reward);
  if (n > getAcadMax()) setAcadMax(n);
  const next = n + 1;
  setAcadCur(next);
  $('acadMsg').textContent = `🎉 通关第 ${n} 关！+${reward} 金币，已解锁第 ${next} 关。`;
  $('acadMsg').className = 'game-msg ok';
  sndWin();
  [...acadGrid.children].forEach((el, i) => setTimeout(() => el.classList.add('wave'), i * 45));
  $('acadStart').textContent = '🎯 继续第 ' + next + ' 关';
  $('acadStart').onclick = null;
  $('acadLobby').hidden = false;
  $('acadArena').hidden = true;
  $('acadCoins').textContent = getCoins();
  $('acadCurLevel').textContent = next;
  $('acadMaxLevel').textContent = getAcadMax();
  const spec = acadLevelSpec(next);
  const limitTxt = spec.limitSec ? `、限时 ${spec.limitSec} 秒` : '';
  $('acadRuleText').textContent = `第 ${next} 关：${spec.cols}×${spec.rows} 牌桌、${spec.pairs} 对配对${limitTxt}。通关 +${next * 15} 金币。`;
  updateAcadSkillBtns();
}

function failAcad() {
  acad.dead = true;
  stopAcadTimers();
  $('acadMsg').textContent = '⏱️ 时间到，本关挑战失败！';
  $('acadMsg').className = 'game-msg';
  sndMiss();
  $('acadStart').textContent = '🎯 重新挑战第 ' + acad.level + ' 关';
  $('acadStart').onclick = null;
  $('acadLobby').hidden = false;
  $('acadArena').hidden = true;
}

function stopAcadTimers() {
  if (acad && acad.timerId) { clearInterval(acad.timerId); acad.timerId = null; }
  if (acad && acad.limitId) { clearTimeout(acad.limitId); acad.limitId = null; }
}

function stopAcad() {
  stopAcadTimers();
  acad = null;
}

/* ---- 学院技能（关卡内） ---- */
function updateAcadSkillBtns() {
  const items = getAcadItems();
  const playing = !!(acad && !acad.dead);
  const setBtn = (id, k) => {
    const el = $(id);
    el.textContent = `${ACADEM_SKILLS[k].emoji} ${ACADEM_SKILLS[k].name.slice(0,2)}（${items[k]}）`;
    el.disabled = !playing || items[k] <= 0;
  };
  setBtn('acadUseGlass', 'glass');
  setBtn('acadUseFreeze', 'freeze');
  setBtn('acadUseRespin', 'respin');
}

function useAcadGlass() {
  if (!acad || acad.dead || acad.lock) return;
  if (getAcadItems().glass <= 0) return;
  addAcadItem('glass', -1);
  acad.glassMode = true;
  $('acadMsg').textContent = '🧐 点击任意一张牌透视 1.5 秒';
  $('acadMsg').className = 'game-msg';
  updateAcadSkillBtns();
  sndHint();
}

function useAcadFreeze() {
  if (!acad || acad.dead || !acad.spec.limitSec) return;
  if (getAcadItems().freeze <= 0) return;
  addAcadItem('freeze', -1);
  acad.freezeUntil = Date.now() + 5000;
  $('acadMsg').textContent = '⏸️ 倒计时暂停 5 秒！';
  $('acadMsg').className = 'game-msg ok';
  updateAcadSkillBtns();
  sndHint();
}

function useAcadRespin() {
  if (!acad || acad.dead || acad.lock) return;
  if (getAcadItems().respin <= 0) return;
  addAcadItem('respin', -1);
  /* 收集未配对且未翻开的牌位置与 emoji，重新洗牌位置 */
  const idxs = [];
  const emojis = [];
  acad.deck.forEach((c, i) => {
    if (!c.done && !c.open) { idxs.push(i); emojis.push(c.e); }
  });
  const shuffled = shuffle(emojis);
  idxs.forEach((pos, k) => { acad.deck[pos].e = shuffled[k]; });
  /* 重建 DOM 以更新正面 emoji */
  acad.deck.forEach((c, i) => {
    const el = acadGrid.children[i];
    const front = el.querySelector('.face.front');
    if (front) front.textContent = c.e;
  });
  $('acadMsg').textContent = '🔄 未配对的牌已重新洗牌！';
  $('acadMsg').className = 'game-msg ok';
  updateAcadSkillBtns();
  sndHint();
}

/* ---- 事件 ---- */
$('acadBack').addEventListener('click', backFromWorld);
$('acadStart').addEventListener('click', acadStart);
$('acadQuit').addEventListener('click', () => { stopAcad(); openAcademy(); });
$('acadUseGlass').addEventListener('click', useAcadGlass);
$('acadUseFreeze').addEventListener('click', useAcadFreeze);
$('acadUseRespin').addEventListener('click', useAcadRespin);
document.querySelectorAll('.acad-skill [data-buy]').forEach((btn) => {
  btn.addEventListener('click', () => buyAcadItem(btn.dataset.buy));
});

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
$('digitBack').addEventListener('click', backFromWorld);

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
$('rankBack').addEventListener('click', () => {
  if (!$('pvpArea').hidden) pvpLeave(true);
  backFromWorld();
});
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

/* 好友系统事件 */
$('openFriends').addEventListener('click', () => showView('friends'));
$('friendsBack').addEventListener('click', backFromWorld);
$('tabFriendsList').addEventListener('click', () => showFriendsView('list'));
$('tabFriendsAdd').addEventListener('click', () => showFriendsView('add'));
$('tabFriendsReq').addEventListener('click', () => showFriendsView('req'));
$('friendSearchBtn').addEventListener('click', searchFriends);
$('friendSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchFriends(); });
$('friendsList').addEventListener('click', handleFriendAction);
$('friendsReqList').addEventListener('click', handleFriendAction);
$('friendSearchResults').addEventListener('click', handleFriendAction);

/* ================= 真人对战（PvP，服务器权威牌桌） ================= */
let pvpPoll = null;
let pvpState = 'idle'; /* idle | waiting | playing | over */
let pvpLast = null;
let pvpBuilt = false;
let pvpPrevOpen = 0;
let pvpPrevDone = 0;

async function pvpPost(path, body) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 7000);
  const r = await fetch(PAY_API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
    body: JSON.stringify(body || {}),
    signal: ctrl.signal,
  });
  return r.json();
}

function pvpSetMode(isPvp) {
  $('aiArea').hidden = isPvp;
  $('pvpArea').hidden = !isPvp;
  $('tabAi').classList.toggle('active', !isPvp);
  $('tabPvp').classList.toggle('active', isPvp);
  $('rankRestart').style.visibility = isPvp ? 'hidden' : 'visible';
  if (isPvp) {
    stopRank();
    pvpReset();
  } else {
    pvpLeave(true);
    newRank();
  }
}

function pvpSetIdleMsg(msg) {
  const hint = document.querySelector('#pvpIdle .pvp-hint');
  if (hint) hint.textContent = msg;
}

function pvpReset() {
  stopPvpPoll();
  pvpState = 'idle';
  pvpLast = null;
  pvpBuilt = false;
  pvpPrevOpen = 0;
  pvpPrevDone = 0;
  $('pvpIdle').hidden = false;
  $('pvpWaiting').hidden = true;
  $('pvpGame').hidden = true;
  $('pvpActions').hidden = true;
  $('pvpGrid').innerHTML = '';
  $('pvpMsg').textContent = '';
  $('pvpMsg').className = 'game-msg';
  const tier = rankTierOf(getRankPoints());
  $('pvpBadge').textContent = tier.icon;
  $('pvpTierName').textContent = tier.name;
  $('pvpPoints').textContent = getRankPoints() + ' 积分';
}

function stopPvpPoll() {
  if (pvpPoll) {
    clearInterval(pvpPoll);
    pvpPoll = null;
  }
}

async function pvpJoin() {
  if (!getToken()) {
    $('userBtn').click();
    return;
  }
  $('pvpIdle').hidden = true;
  $('pvpWaiting').hidden = false;
  $('pvpGame').hidden = true;
  try {
    const j = await pvpPost('/api/match/join', {});
    if (!j.ok) throw new Error(j.error || '匹配失败');
    if (j.status === 'playing' && j.room) {
      pvpEnterRoom(j.room);
    } else {
      pvpState = 'waiting';
    }
    /* 无论等待匹配还是直接进房（第二个加入者/断线重连），都要轮询同步牌桌 */
    startPvpPoll();
  } catch {
    pvpReset();
    pvpSetIdleMsg('⚠️ 无法连接对战服务器，请确认电脑端后端正在运行；人机对战不受影响');
    sndMiss();
  }
}

function startPvpPoll() {
  stopPvpPoll();
  pvpPoll = setInterval(pvpPollOnce, 900);
  pvpPollOnce();
}

async function pvpPollOnce() {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 7000);
    const r = await fetch(PAY_API_BASE + '/api/match/status?token=' + encodeURIComponent(getToken()), { signal: ctrl.signal });
    const j = await r.json();
    if (!j.ok) return;
    if (j.status === 'idle') { pvpReset(); return; }
    if (j.status === 'waiting') { pvpState = 'waiting'; return; }
    if (j.room) pvpEnterRoom(j.room);
  } catch { /* 网络抖动，下次轮询重试 */ }
}

function buildPvpGrid() {
  const grid = $('pvpGrid');
  grid.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const btn = document.createElement('button');
    btn.className = 'fcard';
    btn.innerHTML = '<div class="fcard-inner"><div class="face back"></div><div class="face front"></div></div>';
    btn.addEventListener('click', () => onPvpCard(i));
    grid.appendChild(btn);
  }
}

function pvpEnterRoom(room) {
  pvpLast = room;
  $('pvpIdle').hidden = true;
  $('pvpWaiting').hidden = true;
  $('pvpGame').hidden = false;
  if (!pvpBuilt) { buildPvpGrid(); pvpBuilt = true; }
  $('pvpOppName').textContent = room.oppName;
  $('pvpYou').textContent = room.youScore;
  $('pvpOpp').textContent = room.oppScore;

  /* 音效：新翻开/新配对（结算瞬间只播一次） */
  if (room.status !== 'over' || pvpState !== 'over') {
    if (room.open.length > pvpPrevOpen) sndFlip();
    if (room.done.length > pvpPrevDone) sndMatch();
  }
  pvpPrevOpen = room.open.length;
  pvpPrevDone = room.done.length;

  pvpRenderBoard(room);

  if (room.status === 'over') {
    if (pvpState !== 'over') pvpFinish(room);
    pvpState = 'over';
    return;
  }
  pvpState = 'playing';
  $('pvpActions').hidden = true;
  $('pvpTurn').textContent = room.yourTurn ? '👉 你的回合，翻两张相同图案' : '⏳ 对手思考中…';
  $('pvpTurn').className = 'turn-indicator' + (room.yourTurn ? '' : ' waiting');
  $('pvpMsg').textContent = '';
}

function pvpRenderBoard(room) {
  const openMap = {};
  room.open.forEach((o) => { openMap[o.i] = o.e; });
  const doneMap = {};
  room.done.forEach((d) => { doneMap[d.i] = d.e; });
  const grid = $('pvpGrid');
  for (let i = 0; i < 16; i++) {
    const card = grid.children[i];
    const front = card.querySelector('.face.front');
    if (doneMap[i] !== undefined) {
      if (!front.textContent) front.textContent = doneMap[i];
      card.classList.add('flipped', 'done');
    } else if (openMap[i] !== undefined) {
      if (!front.textContent) front.textContent = openMap[i];
      card.classList.add('flipped');
      card.classList.remove('done');
    } else {
      card.classList.remove('flipped');
    }
    card.style.pointerEvents = room.canAct ? 'auto' : 'none';
  }
}

async function onPvpCard(i) {
  if (!pvpLast || pvpLast.status !== 'playing' || !pvpLast.canAct) return;
  const card = $('pvpGrid').children[i];
  if (card.classList.contains('flipped')) return;
  card.classList.add('flipped');
  try {
    const j = await pvpPost('/api/match/action', { index: i });
    if (j.ok && j.room) pvpEnterRoom(j.room);
    else card.classList.remove('flipped');
  } catch {
    card.classList.remove('flipped');
  }
}

function pvpFinish(room) {
  stopPvpPoll();
  const r = room.result;
  const left = room.reason === 'opponent_left';
  let msg, cls;
  if (r === 'win') {
    msg = left ? `🎉 对手已离开，你获胜！积分 +${room.delta}` : `🎉 战胜 ${room.oppName} ${room.youScore}:${room.oppScore}！积分 +${room.delta}`;
    cls = 'ok';
    sndWin();
  } else if (r === 'lose') {
    msg = `😢 ${room.youScore}:${room.oppScore} 惜败，积分 ${room.delta}`;
    cls = 'bad';
    sndMiss();
  } else {
    msg = `🤝 ${room.youScore}:${room.oppScore} 战平，积分 +${room.delta}`;
    cls = '';
    sndMatch();
  }
  $('pvpMsg').textContent = msg + `　🪙 +${room.coins} 金币`;
  $('pvpMsg').className = 'game-msg ' + cls;
  $('pvpTurn').textContent = '本局结束';
  $('pvpActions').hidden = false;

  /* 本地镜像：积分/战绩/金币与服务器保持一致 */
  const pts = Math.max(0, getRankPoints() + room.delta);
  localStorage.setItem('mem_rank_points', String(pts));
  const s = getRankStats();
  if (r === 'win') { s.w += 1; s.streak += 1; s.bestStreak = Math.max(s.bestStreak, s.streak); }
  else if (r === 'lose') { s.l += 1; s.streak = 0; }
  else { s.d += 1; s.streak = 0; }
  s.peak = Math.max(s.peak, pts);
  saveRankStats(s);
  addCoins(room.coins);
  renderCoins(true);
  renderBest();
  /* 同步刷新对战面板的段位/积分显示 */
  const tier = rankTierOf(pts);
  $('pvpBadge').textContent = tier.icon;
  $('pvpTierName').textContent = tier.name;
  $('pvpPoints').textContent = pts + ' 积分';
  pvpPrevOpen = 0;
  pvpPrevDone = 0;
}

async function pvpLeave(silent) {
  stopPvpPoll();
  try { await pvpPost('/api/match/leave', {}); } catch { /* 离线忽略 */ }
  if (!silent) pvpReset();
  else { pvpState = 'idle'; pvpLast = null; }
}

$('tabAi').addEventListener('click', () => pvpSetMode(false));
$('tabPvp').addEventListener('click', () => pvpSetMode(true));
$('pvpJoin').addEventListener('click', pvpJoin);
$('pvpCancel').addEventListener('click', () => pvpLeave(false));
$('pvpAgain').addEventListener('click', () => { pvpReset(); pvpJoin(); });
$('pvpHome').addEventListener('click', async () => { await pvpLeave(true); showView('home'); });
$('pvpLeave').addEventListener('click', () => pvpLeave(false));

/* ================= 后端服务地址（短信登录/排行榜/对战接口使用） ================= */
const PAY_API_BASE = 'http://localhost:8080';

/* ================= 好友系统 ================= */
let friendPoll = null;
let friendData = null; /* { friends, incoming, outgoing, challenges, challenge } */

async function friendGet(path) {
  const r = await fetch(PAY_API_BASE + path + '?token=' + encodeURIComponent(getToken()));
  return r.json();
}
async function friendPost(path, body) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 8000);
  const r = await fetch(PAY_API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
    body: JSON.stringify(body || {}),
    signal: ctrl.signal,
  });
  return r.json();
}

function stopFriendPoll() {
  if (friendPoll) { clearInterval(friendPoll); friendPoll = null; }
}

function friendTierIcon(points) {
  const t = rankTierOf(points || 0);
  return t.icon;
}

/* 加载好友列表 + 请求 + 对战邀请 */
async function loadFriends() {
  if (!getToken()) {
    $('friendsOffline').hidden = false;
    $('friendsOfflineSub').textContent = '请先登录账号';
    $('friendsListArea').style.display = 'none';
    $('friendsAddArea').style.display = 'none';
    $('friendsReqArea').style.display = 'none';
    $('bestFriends').textContent = '未登录';
    return;
  }
  try {
    const j = await friendGet('/api/friends');
    if (!j.ok) throw new Error(j.error);
    friendData = j;
    $('friendsOffline').hidden = true;
    $('friendsListArea').style.display = '';
    $('friendsAddArea').style.display = '';
    $('friendsReqArea').style.display = '';
    renderFriendList(j.friends || []);
    renderFriendRequests(j.incoming || [], j.outgoing || []);
    renderChallengeInvites(j.challenges || []);
    /* 请求标签角标 */
    const reqCount = (j.incoming || []).length + (j.challenges || []).length;
    $('reqBadge').textContent = reqCount;
    $('reqBadge').hidden = reqCount === 0;
    $('bestFriends').textContent = (j.friends || []).length + ' 位好友';
    /* 检查挑战被接受 → 自动进房间 */
    if (j.challenge && j.challenge.status === 'accepted' && j.challenge.room) {
      showView('rank');
      $('tabPvp').click();
      pvpEnterRoom(j.challenge.room);
      startPvpPoll();
      sndMatch();
    }
  } catch {
    friendData = null;
    $('friendsOffline').hidden = false;
    $('friendsOfflineSub').textContent = '无法连接服务器，请确认后端正在运行';
    $('friendsListArea').style.display = 'none';
    $('friendsAddArea').style.display = 'none';
    $('friendsReqArea').style.display = 'none';
    $('bestFriends').textContent = '--';
  }
}

function renderFriendList(friends) {
  const tip = $('friendsListTip');
  const list = $('friendsList');
  if (!friends.length) {
    tip.textContent = '还没有好友，去「添加好友」页搜索昵称加好友吧';
    list.innerHTML = '';
    return;
  }
  tip.textContent = friends.length + ' 位好友';
  list.innerHTML = friends.map((f) => {
    const icon = friendTierIcon(f.points);
    const dot = f.online ? '<span class="f-online" title="在线">●</span>' : '<span class="f-offline" title="离线">●</span>';
    return `<div class="friend-card">
      <div class="f-avatar">${dot}${escapeHtml(f.nickname.charAt(0))}</div>
      <div class="f-info">
        <b class="f-name">${escapeHtml(f.nickname)}</b>
        <span class="f-stats">${icon} ${f.points}分 · ${f.w}胜${f.l}负 · ${f.maskedPhone}</span>
      </div>
      <div class="f-actions">
        <button class="btn small primary" data-challenge="${f.phone}" ${f.online ? '' : 'disabled title="对方离线"'}>⚔️ 挑战</button>
        <button class="btn small ghost" data-remove="${f.phone}">删除</button>
      </div>
    </div>`;
  }).join('');
}

function renderFriendRequests(incoming, outgoing) {
  const tip = $('friendsReqTip');
  const list = $('friendsReqList');
  if (!incoming.length && !outgoing.length) {
    tip.textContent = '暂无好友请求';
    list.innerHTML = '';
    return;
  }
  tip.textContent = '';
  const incHtml = incoming.map((f) => {
    const icon = friendTierIcon(f.points);
    return `<div class="friend-card req-in">
      <div class="f-avatar">📥${escapeHtml(f.nickname.charAt(0))}</div>
      <div class="f-info">
        <b class="f-name">${escapeHtml(f.nickname)}</b>
        <span class="f-stats">${icon} ${f.points}分 · ${f.maskedPhone}</span>
      </div>
      <div class="f-actions">
        <button class="btn small primary" data-accept="${f.phone}">✅ 接受</button>
        <button class="btn small ghost" data-reject="${f.phone}">❌ 拒绝</button>
      </div>
    </div>`;
  }).join('');
  const outHtml = outgoing.map((f) => {
    return `<div class="friend-card req-out">
      <div class="f-avatar">📤${escapeHtml(f.nickname.charAt(0))}</div>
      <div class="f-info">
        <b class="f-name">${escapeHtml(f.nickname)}</b>
        <span class="f-stats">等待对方确认 · ${f.maskedPhone}</span>
      </div>
      <div class="f-actions"><span class="f-pending">等待中…</span></div>
    </div>`;
  }).join('');
  list.innerHTML = incHtml + outHtml;
}

function renderChallengeInvites(challenges) {
  if (!challenges || !challenges.length) return;
  /* 在请求列表顶部插入对战邀请 */
  const html = challenges.map((ch) => {
    return `<div class="friend-card challenge-invite">
      <div class="f-avatar">⚔️</div>
      <div class="f-info">
        <b class="f-name">${escapeHtml(ch.fromNickname)}</b>
        <span class="f-stats">向你发起对战挑战 · 60秒内有效</span>
      </div>
      <div class="f-actions">
        <button class="btn small primary" data-challenge-accept="${ch.id}">⚔️ 应战</button>
        <button class="btn small ghost" data-challenge-reject="${ch.id}">跳过</button>
      </div>
    </div>`;
  }).join('');
  const list = $('friendsReqList');
  list.insertAdjacentHTML('afterbegin', html);
  $('friendsReqTip').textContent = '';
}

/* 搜索用户 */
async function searchFriends() {
  const q = $('friendSearchInput').value.trim();
  const tip = $('friendSearchTip');
  const results = $('friendSearchResults');
  if (q.length < 1) { tip.textContent = ''; results.innerHTML = ''; return; }
  tip.textContent = '⏳ 搜索中…';
  results.innerHTML = '';
  try {
    const j = await friendPost('/api/friends/search', { nickname: q });
    if (!j.ok) throw new Error(j.error);
    if (!j.results.length) {
      tip.textContent = '未找到匹配的玩家（对方需先登录并设置昵称）';
      return;
    }
    tip.textContent = '找到 ' + j.results.length + ' 位玩家';
    results.innerHTML = j.results.map((r) => {
      const icon = friendTierIcon(r.points);
      let btn;
      if (r.isFriend) btn = '<span class="f-pending">已是好友</span>';
      else if (r.reqSent) btn = '<span class="f-pending">已发送</span>';
      else btn = `<button class="btn small primary" data-addfriend="${r.phone}">➕ 加好友</button>`;
      return `<div class="friend-card">
        <div class="f-avatar">🔍${escapeHtml(r.nickname.charAt(0))}</div>
        <div class="f-info">
          <b class="f-name">${escapeHtml(r.nickname)}</b>
          <span class="f-stats">${icon} ${r.points}分 · ${r.maskedPhone}</span>
        </div>
        <div class="f-actions">${btn}</div>
      </div>`;
    }).join('');
  } catch {
    tip.textContent = '搜索失败，请确认服务器正在运行';
  }
}

/* 事件处理 */
async function handleFriendAction(e) {
  const btn = e.target.closest('[data-challenge],[data-remove],[data-accept],[data-reject],[data-addfriend],[data-challenge-accept],[data-challenge-reject]');
  if (!btn) return;
  if (btn.dataset.challenge) {
    btn.disabled = true;
    btn.textContent = '发送中…';
    const j = await friendPost('/api/friends/challenge', { phone: btn.dataset.challenge });
    if (j.ok) { btn.textContent = '✅ 已发送'; btn.className = 'btn small ghost'; sndFlip(); }
    else { btn.disabled = false; btn.textContent = '⚔️ 挑战'; sndMiss(); alert(j.error); }
  } else if (btn.dataset.remove) {
    if (!confirm('确定删除这位好友？')) return;
    await friendPost('/api/friends/remove', { phone: btn.dataset.remove });
    sndFlip();
    loadFriends();
  } else if (btn.dataset.accept) {
    await friendPost('/api/friends/respond', { phone: btn.dataset.accept, accept: true });
    sndWin();
    loadFriends();
  } else if (btn.dataset.reject) {
    await friendPost('/api/friends/respond', { phone: btn.dataset.reject, accept: false });
    sndFlip();
    loadFriends();
  } else if (btn.dataset.addfriend) {
    btn.disabled = true;
    btn.textContent = '发送中…';
    const j = await friendPost('/api/friends/request', { phone: btn.dataset.addfriend });
    if (j.ok) {
      btn.textContent = j.mutual ? '✅ 已互加' : '✅ 已发送';
      btn.className = 'btn small ghost';
      sndFlip();
    } else {
      btn.disabled = false; btn.textContent = '➕ 加好友'; sndMiss(); alert(j.error);
    }
  } else if (btn.dataset.challengeAccept) {
    const j = await friendPost('/api/friends/challenge/respond', { challengeId: btn.dataset.challengeAccept, accept: true });
    if (j.ok && j.accepted && j.room) {
      showView('rank');
      $('tabPvp').click();
      pvpEnterRoom(j.room);
      startPvpPoll();
      sndWin();
    } else { sndMiss(); alert(j.error || '应战失败'); }
  } else if (btn.dataset.challengeReject) {
    await friendPost('/api/friends/challenge/respond', { challengeId: btn.dataset.challengeReject, accept: false });
    sndFlip();
    loadFriends();
  }
}

function startFriendPoll() {
  stopFriendPoll();
  friendPoll = setInterval(() => {
    if (!$('view-friends').hidden) loadFriends();
  }, 5000);
}

/* 视图切换 */
function showFriendsView(tab) {
  $('friendsListArea').hidden = tab !== 'list';
  $('friendsAddArea').hidden = tab !== 'add';
  $('friendsReqArea').hidden = tab !== 'req';
  $('tabFriendsList').classList.toggle('active', tab === 'list');
  $('tabFriendsAdd').classList.toggle('active', tab === 'add');
  $('tabFriendsReq').classList.toggle('active', tab === 'req');
}

/* ================= 大世界 · 记忆小镇 ================= */
const WORLD_W = 1000;
/* 3D 视角：地面绕 X 轴倾倒角度（度），立牌用反角立起 */
const WORLD_TILT = 52;
const WORLD_H = 680;
const WORLD_AVATARS = ['🧑‍🎨', '🧙‍♀️', '🧙‍♂️', '🦸‍♀️', '🦸‍♂️', '🥷', '🤖', '🐱', '🐰', '🦊', '🐼', '🐨', '🦁', '🐯', '🐧'];

/* 建筑（逻辑坐标 1000×680，view = 进入的功能视图） */
const WORLD_BUILDINGS = [
  { id: 'academy', emoji: '🎓', name: '翻牌学院',   x: 60,  y: 80,  w: 140, h: 104, view: 'academy' },
  { id: 'digit',   emoji: '🔢', name: '数字塔',     x: 300, y: 60,  w: 140, h: 104, view: 'digit' },
  { id: 'simon',   emoji: '🎨', name: '彩灯广场',   x: 540, y: 80,  w: 140, h: 104, view: 'simon' },
  { id: 'board',   emoji: '📊', name: '排行榜碑',   x: 790, y: 70,  w: 140, h: 104, view: 'board' },
  { id: 'rank',    emoji: '🏆', name: '排位竞技场', x: 80,  y: 330, w: 160, h: 118, view: 'rank' },
  { id: 'shop',    emoji: '🎁', name: '礼品商店',   x: 420, y: 350, w: 140, h: 104, view: 'shop' },
  { id: 'friends', emoji: '👥', name: '好友之家',   x: 720, y: 340, w: 140, h: 104, view: 'friends' },
];

/* 碰撞体：建筑外扩一圈 + 中央喷泉 */
const WORLD_SOLIDS = WORLD_BUILDINGS
  .map((b) => ({ x: b.x - 16, y: b.y - 8, w: b.w + 32, h: b.h + 26 }))
  .concat([{ x: 474, y: 486, w: 52, h: 48 }]);

const WORLD_NPCS = [
  {
    id: 'guide', emoji: '🧙‍♀️', name: '向导梅梅', x: 392, y: 585,
    text: '欢迎来到记忆小镇！用方向键（手机拖左下摇杆）走动，走近建筑点「进入」就能玩。镇里还有好多镇民在溜达，点他们可以聊天哦～',
    btn: { label: '知道啦', act: 'close' },
  },
  {
    id: 'judge', emoji: '⚖️', name: '裁判阿正', x: 285, y: 448,
    text: '排位竞技场今天开门！赢一局 +30 积分、+50 金币，连胜还能升段位。要去和对手过过招吗？',
    btn: { label: '🏆 去排位赛', act: 'view', view: 'rank' },
  },
  {
    id: 'keeper', emoji: '🛒', name: '商店老板', x: 622, y: 452,
    text: '新到了冻结卡和透视卡，排位赛里可好使了！看广告还能免费领提示，不来逛逛吗？',
    btn: { label: '🎁 逛商店', act: 'view', view: 'shop' },
  },
];

/* 机器人镇民（名字与排行榜种子呼应） */
const WORLD_BOTS = [
  { name: '记忆大师007', avatar: '🧙‍♂️', points: 1680 },
  { name: '过目不忘', avatar: '🦸‍♀️', points: 1590 },
  { name: '卡牌仙人', avatar: '🥷', points: 1320 },
  { name: '闪电快手', avatar: '🐱', points: 1180 },
  { name: '翻牌小天才', avatar: '🐰', points: 745 },
  { name: '萌新玩家', avatar: '🐧', points: 180 },
];

const BOT_LINES = [
  '我在这儿刷了一整天牌了，脑子快不够用啦！',
  '听说排位竞技场赢一把给 50 金币，心动了没？',
  '别光站着呀，去翻牌学院露两手？',
  '数字塔顶层的数字有 12 位那么长，你敢挑战吗？',
  '今天小镇来了好多新朋友，真热闹～',
  '彩灯广场的灯光节奏，我已经能闭着眼复现了！',
  '喷泉边风景好，我每天都来这儿散步。',
];

const WORLD_DECOS = [
  { t: '🌳', x: 24, y: 30 }, { t: '🌳', x: 945, y: 40 }, { t: '🌲', x: 18, y: 300 },
  { t: '🌲', x: 950, y: 290 }, { t: '🌻', x: 250, y: 220 }, { t: '🌻', x: 700, y: 225 },
  { t: '🪨', x: 340, y: 250 }, { t: '🪨', x: 640, y: 265 }, { t: '⛲', x: 500, y: 512 },
  { t: '🪧', x: 330, y: 628 }, { t: '🌷', x: 150, y: 610 }, { t: '🌷', x: 860, y: 610 },
  { t: '🦋', x: 610, y: 180 }, { t: '🐦', x: 200, y: 150 },
];

/* ---- 角色形象（localStorage） ---- */
function getAvatar() {
  return localStorage.getItem('mem_avatar') || '🧑‍🎨';
}
function getWorldName() {
  let n = localStorage.getItem('mem_world_name');
  if (!n) {
    n = '玩家' + Math.floor(1000 + Math.random() * 9000);
    localStorage.setItem('mem_world_name', n);
  }
  return n;
}

/* ---- 世界运行状态 ---- */
let worldReturn = false; /* 从世界进入游戏后，返回键回世界而非首页 */
const world = {
  running: false,
  built: false,
  me: { x: 500, y: 615, el: null },
  keys: { up: false, down: false, left: false, right: false },
  joy: { x: 0, y: 0 },
  bots: [],
  remotes: [],
  moveTimer: null,
  pollTimer: null,
  lastBeat: 0,
  nearId: null,
};

function wcClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function hitsSolid(x, y) {
  return WORLD_SOLIDS.some((s) => x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h);
}

function makeCharEl(cls, emoji, name) {
  const el = document.createElement('div');
  el.className = 'world-char ' + cls;
  el.innerHTML = '<span class="wc-emoji"></span><span class="wc-name"></span>';
  el.querySelector('.wc-emoji').textContent = emoji;
  el.querySelector('.wc-name').textContent = name;
  return el;
}

function placeChar(el, x, y) {
  el.style.transform = `translate(${x}px, ${y}px) rotateX(-${WORLD_TILT}deg)`;
  el.style.zIndex = String(Math.round(y) + 5);
}

/* ---- 一次性构建世界 DOM ---- */
function buildWorld() {
  if (world.built) return;
  world.built = true;
  $('worldGround').innerHTML =
    '<div class="world-path ph" style="top:560px"></div>' +
    '<div class="world-path pv" style="left:500px"></div>' +
    WORLD_DECOS.map((d) => `<span class="world-deco" style="left:${d.x}px;top:${d.y}px">${d.t}</span>`).join('');
  $('worldBuildings').innerHTML = WORLD_BUILDINGS.map((b) =>
    `<button class="world-building" id="wbld-${b.id}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px" data-view="${b.view}" type="button">
      <span class="wb-emoji">${b.emoji}</span><span class="wb-name">${b.name}</span>
    </button>`).join('');
  $('worldBuildings').addEventListener('click', (e) => {
    const btn = e.target.closest('.world-building');
    if (btn) enterWorldView(btn.dataset.view);
  });
  /* 自己 */
  world.me.el = makeCharEl('char-me', getAvatar(), getWorldName());
  $('worldChars').appendChild(world.me.el);
  placeChar(world.me.el, world.me.x, world.me.y);
  /* NPC */
  for (const n of WORLD_NPCS) {
    const el = makeCharEl('char-npc', n.emoji, n.name);
    el.dataset.npc = n.id;
    $('worldChars').appendChild(el);
    placeChar(el, n.x, n.y);
  }
  /* 机器人镇民 */
  world.bots = WORLD_BOTS.map((d, i) => {
    const b = { id: 'bot' + i, name: d.name, avatar: d.avatar, points: d.points, x: 500, y: 600, tx: 500, ty: 600, wait: 0, el: null };
    b.el = makeCharEl('char-bot', d.avatar, d.name);
    b.el.dataset.bot = b.id;
    $('worldChars').appendChild(b.el);
    pickBotTarget(b, true);
    b.x = b.tx; b.y = b.ty;
    placeChar(b.el, b.x, b.y);
    return b;
  });
  /* 人物点击事件委托 */
  $('worldChars').addEventListener('click', (e) => {
    const c = e.target.closest('.world-char');
    if (!c) return;
    if (c.dataset.npc) {
      const n = WORLD_NPCS.find((x) => x.id === c.dataset.npc);
      if (n) openNpc(n);
    } else if (c.dataset.bot) {
      const b = world.bots.find((x) => x.id === c.dataset.bot);
      if (b) openBot(b);
    } else if (c.dataset.pid) {
      const p = world.remotes.find((x) => x.id === c.dataset.pid);
      if (p) openRemote(p);
    }
  });
  bindJoystick();
  window.addEventListener('resize', () => { if (world.running) fitWorld(); });
}

function fitWorld() {
  const rect = $('worldWrap').getBoundingClientRect();
  /* 视觉高度 = 地面压扁(680×cos52°≈419) + 立牌余量；压扁后地面纵深感保留全图可见 */
  const visH = Math.round(WORLD_H * Math.cos(WORLD_TILT * Math.PI / 180)) + 140;
  const stage = $('worldStage');
  stage.style.setProperty('--tilt', WORLD_TILT + 'deg');
  const scale = Math.min(rect.width / WORLD_W, rect.height / visH);
  stage.style.transform = `translate(-50%, -50%) scale(${scale}) rotateX(${WORLD_TILT}deg)`;
}

/* ---- 从世界进入功能视图 ---- */
function enterWorldView(v) {
  hideBubble();
  worldReturn = true;
  if (v === 'academy') { showView('academy'); openAcademy(); }
  else if (v === 'flip') { showView('flip'); newFlip(); }
  else if (v === 'digit') { showView('digit'); newDigit(); }
  else if (v === 'simon') { showView('simon'); newSimon(); }
  else if (v === 'rank') { showView('rank'); newRank(); }
  else if (v === 'shop') { showView('shop'); renderShop(); }
  else if (v === 'board') { showView('board'); loadBoard(); }
  else if (v === 'friends') { showView('friends'); }
}

/* 游戏页返回键：从世界进来的回世界，否则回首页 */
function backFromWorld() {
  const back = worldReturn;
  worldReturn = false;
  showView(back ? 'world' : 'home');
}

/* ---- 对话气泡 ---- */
function hideBubble() { $('worldBubble').hidden = true; }
function showBubble(x, y, innerHtml) {
  const bub = $('worldBubble');
  bub.innerHTML = innerHtml + '<button class="wbub-close" title="关闭" type="button">×</button>';
  bub.style.left = wcClamp(x, 130, WORLD_W - 130) + 'px';
  bub.style.top = (y - 10) + 'px';
  bub.style.transform = `rotateX(-${WORLD_TILT}deg) translateZ(80px)`;
  bub.hidden = false;
  bub.querySelector('.wbub-close').onclick = hideBubble;
  const c2 = bub.querySelector('#wbubClose2');
  if (c2) c2.onclick = hideBubble;
  const go = bub.querySelector('[data-npcgo]');
  if (go) go.onclick = () => enterWorldView(go.dataset.npcgo);
  const ch = bub.querySelector('[data-challengep]');
  if (ch) ch.onclick = () => sendWorldChallenge(ch.dataset.challengep, ch);
}

function openNpc(n) {
  sndHint();
  const btns = n.btn.act === 'view'
    ? `<button class="btn small primary" data-npcgo="${n.btn.view}" type="button">${n.btn.label}</button>
       <button class="btn small ghost" id="wbubClose2" type="button">以后再说</button>`
    : `<button class="btn small primary" id="wbubClose2" type="button">${n.btn.label}</button>`;
  showBubble(n.x, n.y - 62,
    `<b>${n.emoji} ${escapeHtml(n.name)}</b><span class="wbub-text">${n.text}</span><div class="wbub-btns">${btns}</div>`);
}

function openBot(b) {
  sndFlip();
  const line = BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)];
  const tier = rankTierOf(b.points);
  showBubble(b.x, b.y - 62,
    `<b>${b.avatar} ${escapeHtml(b.name)}</b><span class="wbub-text">「${line}」</span>
     <div class="wbub-btns"><span class="wbub-rank">${tier.icon} ${b.points} 积分</span>
     <button class="btn small ghost" id="wbubClose2" type="button">拜拜</button></div>`);
}

function openRemote(p) {
  sndHint();
  if (!p.isFriend) {
    showBubble(p.x, p.y - 62,
      `<b>${p.avatar} ${escapeHtml(p.name)}</b><span class="wbub-text">一位来自远方的旅人也在小镇闲逛。加为好友后，就可以随时发起翻牌挑战啦！</span>
       <div class="wbub-btns"><button class="btn small ghost" id="wbubClose2" type="button">知道了</button></div>`);
    return;
  }
  showBubble(p.x, p.y - 62,
    `<b>👥 ${escapeHtml(p.name)}</b><span class="wbub-text">你的好友正在小镇里闲逛，要发起一局翻牌挑战吗？</span>
     <div class="wbub-btns"><button class="btn small primary" data-challengep="${p.id}" type="button">⚔️ 挑战</button>
     <button class="btn small ghost" id="wbubClose2" type="button">下次</button></div>`);
}

async function sendWorldChallenge(phone, btn) {
  btn.disabled = true;
  btn.textContent = '发送中…';
  try {
    const j = await friendPost('/api/friends/challenge', { phone });
    if (j.ok) {
      btn.textContent = '✅ 已发送';
      btn.className = 'btn small ghost';
      sndWin();
    } else {
      btn.disabled = false;
      btn.textContent = '⚔️ 挑战';
      sndMiss();
      alert(j.error || '挑战发送失败');
    }
  } catch {
    btn.disabled = false;
    btn.textContent = '⚔️ 挑战';
    sndMiss();
    alert('无法连接服务器');
  }
}

/* ---- 机器人镇民游走 ---- */
function pickBotTarget(b, first) {
  for (let tries = 0; tries < 24; tries++) {
    const x = 70 + Math.random() * (WORLD_W - 140);
    const y = 150 + Math.random() * (WORLD_H - 230);
    if (!hitsSolid(x, y)) { b.tx = x; b.ty = y; break; }
  }
  b.wait = first ? 0 : 40 + Math.random() * 200;
}

function tickBot(b) {
  const dx = b.tx - b.x;
  const dy = b.ty - b.y;
  const d = Math.hypot(dx, dy);
  if (d < 4) {
    b.wait -= 1;
    if (b.wait <= 0) pickBotTarget(b);
    return;
  }
  const sp = 1.3;
  const nx = b.x + dx / d * sp;
  const ny = b.y + dy / d * sp;
  if (!hitsSolid(nx, b.y)) b.x = nx; else b.tx = b.x;
  if (!hitsSolid(b.x, ny)) b.y = ny; else b.ty = b.y;
  placeChar(b.el, b.x, b.y);
}

/* ---- 在线玩家（后端在线时为真实好友/玩家；离线静默降级） ---- */
function setWorldNet(online) {
  $('worldNet').textContent = online
    ? '🟢 已连接服务器：小镇里可能遇到真实好友'
    : '🟡 离线模式：镇里是机器人镇民（连接服务器可见好友）';
}

async function worldPoll() {
  if (!getToken()) { syncRemotes([]); setWorldNet(false); return; }
  try {
    const j = await friendGet('/api/world/players');
    if (!j.ok) throw new Error('bad');
    syncRemotes(j.players || []);
    setWorldNet(true);
  } catch {
    syncRemotes([]);
    setWorldNet(false);
  }
}

function syncRemotes(players) {
  world.remotes = players;
  const layer = $('worldChars');
  layer.querySelectorAll('.char-remote').forEach((el) => el.remove());
  for (const p of players) {
    const el = makeCharEl(
      'char-remote ' + (p.isFriend ? 'char-friend' : 'char-guest'),
      p.avatar || '🧑‍🎨',
      (p.isFriend ? '👥 ' : '') + p.name
    );
    el.dataset.pid = p.id;
    layer.appendChild(el);
    placeChar(el, wcClamp(p.x, 24, WORLD_W - 24), wcClamp(p.y, 90, WORLD_H - 20));
  }
}

/* 位置心跳：登录时约 1.2s 上报一次 */
async function worldBeat(force) {
  if (!getToken()) return;
  const now = Date.now();
  if (!force && now - world.lastBeat < 1200) return;
  world.lastBeat = now;
  try {
    await friendPost('/api/world/presence', {
      x: Math.round(world.me.x),
      y: Math.round(world.me.y),
      avatar: getAvatar(),
    });
  } catch { /* 离线静默 */ }
}

/* ---- 靠近建筑 / NPC 提示 ---- */
function updatePrompt() {
  let near = null;
  for (const n of WORLD_NPCS) {
    if ((n.x - world.me.x) ** 2 + (n.y - world.me.y) ** 2 < 70 * 70) { near = { kind: 'npc', ref: n }; break; }
  }
  if (!near) {
    for (const b of WORLD_BUILDINGS) {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      if ((cx - world.me.x) ** 2 + (cy - world.me.y) ** 2 < 120 * 120) { near = { kind: 'building', ref: b }; break; }
    }
  }
  const nearId = near ? near.kind + ':' + near.ref.id : null;
  WORLD_BUILDINGS.forEach((b) => {
    const el = $('wbld-' + b.id);
    if (el) el.classList.toggle('near', !!(near && near.kind === 'building' && near.ref.id === b.id));
  });
  if (nearId === world.nearId) return;
  world.nearId = nearId;
  const p = $('worldPrompt');
  if (!near) { p.hidden = true; return; }
  if (near.kind === 'npc') {
    p.innerHTML = `<span>💬 ${near.ref.name} 想和你聊聊</span><button class="btn small primary" type="button">聊聊</button>`;
    p.querySelector('button').onclick = () => openNpc(near.ref);
  } else {
    p.innerHTML = `<span>${near.ref.emoji} ${near.ref.name}</span><button class="btn small primary" type="button">进入</button>`;
    p.querySelector('button').onclick = () => enterWorldView(near.ref.view);
  }
  p.hidden = false;
}

/* ---- 移动循环（50ms） ---- */
function worldTick() {
  if (!world.running) return;
  const sp = 3.4;
  let dx = (world.keys.right ? 1 : 0) - (world.keys.left ? 1 : 0) + world.joy.x;
  let dy = (world.keys.down ? 1 : 0) - (world.keys.up ? 1 : 0) + world.joy.y;
  const len = Math.hypot(dx, dy);
  if (len > 0.15) {
    if (len > 1) { dx /= len; dy /= len; }
    const nx = wcClamp(world.me.x + dx * sp, 26, WORLD_W - 26);
    const ny = wcClamp(world.me.y + dy * sp, 90, WORLD_H - 18);
    if (!hitsSolid(nx, world.me.y)) world.me.x = nx;
    if (!hitsSolid(world.me.x, ny)) world.me.y = ny;
    placeChar(world.me.el, world.me.x, world.me.y);
    updatePrompt();
    worldBeat(false);
  }
  for (const b of world.bots) tickBot(b);
}

function onWorldKey(e) {
  if ($('charOverlay') && !$('charOverlay').hidden) return; /* 角色弹窗打开时不抢按键 */
  const k = e.key.toLowerCase();
  const map = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', d: 'right' };
  const dir = map[k];
  if (dir) {
    world.keys[dir] = e.type === 'keydown';
    e.preventDefault();
  }
}

/* ---- 手机虚拟摇杆 ---- */
function bindJoystick() {
  const pad = $('worldJoystick');
  const knob = $('wjKnob');
  let active = false;
  let cx = 0;
  let cy = 0;
  const MAX = 30;
  const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
  const pt = (e) => (e.touches ? e.touches[0] : e);
  const start = (e) => {
    active = true;
    const t = pt(e);
    const r = pad.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    move(e);
  };
  const move = (e) => {
    if (!active) return;
    if (e.cancelable) e.preventDefault();
    const t = pt(e);
    let dx = t.clientX - cx;
    let dy = t.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > MAX) { dx = dx / d * MAX; dy = dy / d * MAX; }
    setKnob(dx, dy);
    world.joy.x = dx / MAX;
    world.joy.y = dy / MAX;
  };
  const end = () => {
    active = false;
    world.joy.x = 0;
    world.joy.y = 0;
    setKnob(0, 0);
  };
  pad.addEventListener('touchstart', start, { passive: false });
  pad.addEventListener('touchmove', move, { passive: false });
  pad.addEventListener('touchend', end);
  pad.addEventListener('touchcancel', end);
  pad.addEventListener('mousedown', start);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
}

/* ---- 世界生命周期 ---- */
function startWorld() {
  buildWorld();
  fitWorld();
  world.running = true;
  /* 刷新形象（可能在角色弹窗改过） */
  world.me.el.querySelector('.wc-emoji').textContent = getAvatar();
  world.me.el.querySelector('.wc-name').textContent = getWorldName();
  placeChar(world.me.el, world.me.x, world.me.y);
  window.addEventListener('keydown', onWorldKey);
  window.addEventListener('keyup', onWorldKey);
  world.moveTimer = setInterval(worldTick, 50);
  world.pollTimer = setInterval(worldPoll, 2000);
  world.nearId = null;
  updatePrompt();
  worldBeat(true);
  worldPoll();
  if (!localStorage.getItem('mem_avatar')) openCharEditor();
}

function stopWorld() {
  world.running = false;
  if (world.moveTimer) { clearInterval(world.moveTimer); world.moveTimer = null; }
  if (world.pollTimer) { clearInterval(world.pollTimer); world.pollTimer = null; }
  window.removeEventListener('keydown', onWorldKey);
  window.removeEventListener('keyup', onWorldKey);
  world.keys = { up: false, down: false, left: false, right: false };
  world.joy.x = 0;
  world.joy.y = 0;
  hideBubble();
  $('worldPrompt').hidden = true;
  WORLD_BUILDINGS.forEach((b) => {
    const el = $('wbld-' + b.id);
    if (el) el.classList.remove('near');
  });
}

/* ---- 角色创建 / 形象弹窗 ---- */
let charSel = '🧑‍🎨';
function openCharEditor() {
  charSel = getAvatar();
  const grid = $('charAvatarGrid');
  grid.innerHTML = WORLD_AVATARS.map((a) =>
    `<button data-av="${a}" class="${a === charSel ? 'sel' : ''}" type="button">${a}</button>`).join('');
  $('charPreview').textContent = charSel;
  $('charNameInput').value = getWorldName();
  $('charOverlay').hidden = false;
  grid.onclick = (e) => {
    const btn = e.target.closest('[data-av]');
    if (!btn) return;
    charSel = btn.dataset.av;
    $('charPreview').textContent = charSel;
    grid.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.av === charSel));
    sndFlip();
  };
}

function saveChar() {
  const name = ($('charNameInput').value || '').replace(/[<>&"'`]/g, '').trim().slice(0, 12)
    || ('玩家' + Math.floor(1000 + Math.random() * 9000));
  localStorage.setItem('mem_avatar', charSel);
  localStorage.setItem('mem_world_name', name);
  $('charOverlay').hidden = true;
  if (world.me.el) {
    world.me.el.querySelector('.wc-emoji').textContent = charSel;
    world.me.el.querySelector('.wc-name').textContent = name;
  }
  sndWin();
  worldBeat(true);
}

$('charSave').addEventListener('click', saveChar);
$('charClose').addEventListener('click', () => {
  if (!localStorage.getItem('mem_avatar')) saveChar(); /* 首次直接关闭也保存默认形象，不再反复弹 */
  else $('charOverlay').hidden = true;
});
$('worldCharBtn').addEventListener('click', openCharEditor);
$('worldBack').addEventListener('click', () => showView('home'));
$('openWorld').addEventListener('click', () => showView('world'));

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
    $('acctAvatar').textContent = getAvatar();
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
