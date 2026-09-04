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
const WORLD_W = 1500;
/* 3D 视角：地面绕 X 轴倾倒角度（度），立牌用反角立起（旧 CSS 模式，3D 模式已不用） */
const WORLD_TILT = 52;
const WORLD_H = 1100;
const WORLD_AVATARS = ['🧑‍🎨', '🧙‍♀️', '🧙‍♂️', '🦸‍♀️', '🦸‍♂️', '🥷', '🤖', '🐱', '🐰', '🦊', '🐼', '🐨', '🦁', '🐯', '🐧'];

/* 建筑（逻辑坐标 1500×1100，view = 进入的功能视图） */
const WORLD_BUILDINGS = [
  { id: 'academy', emoji: '🎓', name: '翻牌学院',   x: 150,  y: 130, w: 150, h: 110, view: 'academy' },
  { id: 'digit',   emoji: '🔢', name: '数字塔',     x: 520,  y: 120, w: 150, h: 110, view: 'digit' },
  { id: 'simon',   emoji: '🎨', name: '彩灯广场',   x: 890,  y: 130, w: 150, h: 110, view: 'simon' },
  { id: 'board',   emoji: '📊', name: '排行榜碑',   x: 1260, y: 120, w: 150, h: 110, view: 'board' },
  { id: 'rank',    emoji: '🏆', name: '排位竞技场', x: 170,  y: 560, w: 170, h: 125, view: 'rank' },
  { id: 'shop',    emoji: '🎁', name: '礼品商店',   x: 480,  y: 570, w: 150, h: 110, view: 'shop' },
  { id: 'friends', emoji: '👥', name: '好友之家',   x: 1150, y: 560, w: 150, h: 110, view: 'friends' },
];

/* 碰撞体：建筑外扩一圈 + 环岛喷泉（交叉口 750,850） */
const WORLD_SOLIDS = WORLD_BUILDINGS
  .map((b) => ({ x: b.x - 16, y: b.y - 8, w: b.w + 32, h: b.h + 26 }))
  .concat([{ x: 720, y: 820, w: 60, h: 60 }]);

const WORLD_NPCS = [
  {
    id: 'guide', emoji: '🧙‍♀️', name: '向导梅梅', x: 640, y: 950,
    text: '欢迎来到记忆小镇！用方向键（手机拖左下摇杆）走动，走近建筑点「进入」就能玩。镇里还有好多镇民在溜达，点他们可以聊天哦～',
    btn: { label: '知道啦', act: 'close' },
  },
  {
    id: 'judge', emoji: '⚖️', name: '裁判阿正', x: 360, y: 760,
    text: '排位竞技场今天开门！赢一局 +30 积分、+50 金币，连胜还能升段位。要去和对手过过招吗？',
    btn: { label: '🏆 去排位赛', act: 'view', view: 'rank' },
  },
  {
    id: 'keeper', emoji: '🛒', name: '商店老板', x: 620, y: 760,
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
  /* 大树（3D 真模型）：四角 + 建筑间隙 + 路侧 */
  { t: '🌳', x: 60, y: 120 }, { t: '🌳', x: 1440, y: 120 }, { t: '🌳', x: 420, y: 90 },
  { t: '🌳', x: 1080, y: 90 }, { t: '🌳', x: 60, y: 830 }, { t: '🌳', x: 1430, y: 860 },
  { t: '🌲', x: 770, y: 60 }, { t: '🌲', x: 370, y: 480 }, { t: '🌲', x: 1070, y: 470 },
  { t: '🌲', x: 260, y: 960 }, { t: '🌲', x: 1250, y: 970 },
  /* 花卉石头 */
  { t: '🌻', x: 380, y: 300 }, { t: '🌻', x: 1100, y: 300 }, { t: '🌻', x: 520, y: 830 }, { t: '🌻', x: 980, y: 830 },
  { t: '🪨', x: 470, y: 440 }, { t: '🪨', x: 1020, y: 440 }, { t: '🪨', x: 130, y: 1010 },
  { t: '🌷', x: 180, y: 900 }, { t: '🌷', x: 1320, y: 900 }, { t: '🌷', x: 880, y: 900 }, { t: '🌷', x: 700, y: 1040 },
  /* 中央环岛喷泉（横路 y=850 与竖路 x=750 交叉口）+ 出生点路牌 */
  { t: '⛲', x: 750, y: 850, fx: true },
  { t: '🪧', x: 600, y: 920 },
  /* 飞舞 */
  { t: '🦋', x: 950, y: 380, fly: true }, { t: '🐦', x: 350, y: 200, fly: true },
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
  me: { x: 750, y: 1010, el: null },
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
  /* 贴地影子：挂在地面平面上，随 placeChar 同步移动 */
  const sh = document.createElement('i');
  sh.className = 'wshadow wchar-shadow';
  $('worldGround').appendChild(sh);
  el._shadow = sh;
  return el;
}

function placeChar(el, x, y) {
  el.style.transform = `translate(${x}px, ${y}px) rotateX(-${WORLD_TILT}deg)`;
  if (el._shadow) el._shadow.style.transform = `translate(${x}px, ${y}px)`;
  el.style.zIndex = String(Math.round(y) + 5);
}

/* ---- 一次性构建世界 DOM ---- */
function buildWorld() {
  if (world.built) return;
  world.built = true;
  $('worldGround').innerHTML =
    '<div class="world-path ph" style="top:560px"></div>' +
    '<div class="world-path pv" style="left:500px"></div>' +
    WORLD_BUILDINGS.map((b) => `<i class="wshadow" style="left:${b.x - 14}px;top:${b.y + b.h - 12}px;width:${b.w + 28}px"></i>`).join('') +
    WORLD_DECOS.filter((d) => !d.fly).map((d) => `<i class="wshadow wshadow-s" style="left:${d.x - 14}px;top:${d.y - 6}px;width:28px"></i>`).join('') +
    WORLD_DECOS.map((d) => `<span class="world-deco${d.fly ? ' world-flyer' : ''}${d.fx ? ' fountain' : ''}" style="left:${d.x}px;top:${d.y}px"><i class="de-t">${d.t}</i>${d.fx ? '<i class="fsp f1"></i><i class="fsp f2"></i><i class="fsp f3"></i>' : ''}</span>`).join('');
  $('worldBuildings').innerHTML = WORLD_BUILDINGS.map((b) =>
    `<button class="world-building" id="wbld-${b.id}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px" data-view="${b.view}" type="button">
      <i class="wbb-side l"></i><i class="wbb-side r"></i><i class="wbb-roof"></i>
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
    const b = { id: 'bot' + i, name: d.name, avatar: d.avatar, points: d.points, x: 750, y: 980, tx: 750, ty: 980, wait: 0, el: null };
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
  window.addEventListener('resize', () => {
    if (!world.running) return;
    fitWorld();
    if (fp.scene) fpResize();
  });
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
    const y = 160 + Math.random() * (WORLD_H - 250);
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
  layer.querySelectorAll('.char-remote').forEach((el) => { if (el._shadow) el._shadow.remove(); el.remove(); });
  for (const p of players) {
    const el = makeCharEl(
      'char-remote ' + (p.isFriend ? 'char-friend' : 'char-guest'),
      p.avatar || '🧑‍🎨',
      (p.isFriend ? '👥 ' : '') + p.name
    );
    el.dataset.pid = p.id;
    layer.appendChild(el);
    placeChar(el, wcClamp(p.x, 30, WORLD_W - 30), wcClamp(p.y, 110, WORLD_H - 30));
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
    const nx = wcClamp(world.me.x + dx * sp, 30, WORLD_W - 30);
    const ny = wcClamp(world.me.y + dy * sp, 110, WORLD_H - 30);
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
  const map = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
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
  /* ---- 第一人称 3D 初始化 ---- */
  initFirstPerson();
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
  /* ---- 第一人称资源清理 ---- */
  disposeFirstPerson();
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

/* ================================================================
   第一人称 3D 世界（Three.js WebGL，覆盖旧 CSS 3D）
   坐标约定：World 坐标系 X:0..1000（东）、Y:0..680（北）；
   Three.js 世界：地面位于 z=0；world(x,y) → 3D 坐标=(x - 500, 0, 340 - y)
   （即 world 原点 0,0 对应 3D x=-500,z=+340；北=z-方向）
   ================================================================ */
const fp = {
  scene: null, camera: null, renderer: null, controls: null,
  clock: null, animId: null,
  buildingMeshes: [],    // [{ mesh, b:building }] 用于 raycast 进入建筑
  npcMeshes: [],         // [{ sprite, n:NPC }]
  charMeshes: new Map(), // botId/remoteId → { sprite, nameTag }
  decoSprites: [],       // 用于清理
  meHeight: 1.75,        // 眼睛高度 1.75m（每个 world 单位 = 5cm；1.75m = 35 单位？不：1 world 单位=1px，统一比例=1 world 单位=0.08m，680 高≈54m，1.75m≈22 单位）
  meEye: 22,             // 眼睛相对地面的 world 单位高度（约 1.76m）
  vel: { x: 0, y: 0, z: 0 },
  onGround: true,
  raycaster: null,
  mouseVec: null,
  locked: false,
  /* 自写 PointerLock（yaw=绕 y、pitch=绕 x，Euler YXZ 顺序） */
  yaw: 0, pitch: 0,
  yawObj: null,   /* THREE.Object3D 作 yaw 容器，camera 挂其下并设置 pitch */
  pitchObj: null, /* THREE.Object3D 作 pitch 容器（yawObj→pitchObj→camera） */
  onMouseMove: null,  /* 绑定函数引用，释放时移除 */
  onLockChange: null,
};
/* world(x, y) → THREE.Vector3(x', y', z')，y 为离地高度（单位=world 单位） */
function to3(x, y, h = 0) {
  /* 比例：1 world 单位 = 0.08 米；场景整体缩放到 Three.js 合理尺寸 */
  const S = 0.08;
  return { x: (x - WORLD_W / 2) * S, y: h * S, z: (WORLD_H / 2 - y) * S, S };
}
function colorFromTheme(lightMix, darkMix) {
  const dark = document.body.dataset.theme === 'dark';
  return new THREE.Color(dark ? darkMix : lightMix);
}

/* 创建带 emoji 的 Sprite（贴脸板） */
function makeEmojiSprite(emoji, opts = {}) {
  const size = opts.size || 34;
  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size * 2;
  const ctx = canvas.getContext('2d');
  if (opts.bubble) {
    /* 标签背景 */
    const w = Math.max(size * 3.4, emoji.length * 20 + 40);
    canvas.width = w; canvas.height = size + 8;
    ctx.fillStyle = opts.bubble.bg || 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = opts.bubble.border || 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 2;
    roundRect(ctx, 2, 2, w - 4, size + 4, 14);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = opts.bubble.color || '#23203a';
    ctx.font = `700 ${size * 0.52}px "Segoe UI","PingFang SC","Microsoft YaHei"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, w / 2, size / 2 + 4);
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${size}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(emoji, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  return sp;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---- 天空渐变背景 ---- */
function makeSkyTexture(dark) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 512);
  if (dark) { g.addColorStop(0, '#0a0f2e'); g.addColorStop(0.7, '#1b2550'); g.addColorStop(1, '#2c3a6e'); }
  else { g.addColorStop(0, '#2f9df0'); g.addColorStop(0.55, '#7cc6f8'); g.addColorStop(1, '#d9f1ff'); }
  x.fillStyle = g; x.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---- 草地地面纹理（程序生成：草色 + 噪点 + 小花） ---- */
function makeGrassTexture(dark) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = dark ? '#244a29' : '#86cf72';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1100; i++) {
    const gx = Math.random() * 256, gy = Math.random() * 256;
    x.fillStyle = Math.random() > 0.5
      ? (dark ? 'rgba(52,98,58,0.9)' : 'rgba(110,196,92,0.9)')
      : (dark ? 'rgba(28,60,34,0.9)' : 'rgba(150,224,124,0.9)');
    x.fillRect(gx, gy, 2, 3 + Math.random() * 3);
  }
  const flowers = ['#ffffff', '#ffe066', '#ff9ec4', '#c5b3ff'];
  for (let i = 0; i < 16; i++) {
    x.fillStyle = flowers[i % flowers.length];
    x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, 1.8, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(16, 12);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---- 土路纹理（横竖路径） ---- */
function makePathTexture(dark) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = dark ? '#3a3426' : '#e6d3a3';
  x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 380; i++) {
    x.fillStyle = Math.random() > 0.5
      ? (dark ? 'rgba(255,255,255,0.05)' : 'rgba(146,110,60,0.18)')
      : (dark ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.35)');
    const r = 1 + Math.random() * 2.4;
    x.beginPath(); x.arc(Math.random() * 128, Math.random() * 128, r, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 4);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---- 建筑正面纹理（墙 + 屋檐阴影 + 门 + 窗户 + 招牌底） ---- */
function makeWallTexture(b, dark) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const x = c.getContext('2d');
  /* 墙 */
  x.fillStyle = dark ? '#332c58' : '#f7f3ff';
  x.fillRect(0, 0, 512, 512);
  /* 屋檐下阴影条 */
  x.fillStyle = dark ? 'rgba(0,0,0,0.35)' : 'rgba(111,75,204,0.15)';
  x.fillRect(0, 0, 512, 64);
  /* 墙脚线 */
  x.fillStyle = dark ? 'rgba(0,0,0,0.3)' : 'rgba(111,75,204,0.10)';
  x.fillRect(0, 452, 512, 60);
  /* 窗户：2×2 共 4 扇（蓝玻璃 + 白框 + 十字格） */
  const drawWin = (wx, wy) => {
    x.fillStyle = dark ? '#26304d' : '#bfe6ff';
    roundRect(x, wx, wy, 96, 96, 10); x.fill();
    x.fillStyle = dark ? '#4a5d8f' : '#8fcdf5';
    roundRect(x, wx + 8, wy + 8, 80, 80, 6); x.fill();
    x.strokeStyle = dark ? '#93a5d6' : '#ffffff';
    x.lineWidth = 6;
    x.beginPath(); x.moveTo(wx + 48, wy + 10); x.lineTo(wx + 48, wy + 86);
    x.moveTo(wx + 10, wy + 48); x.lineTo(wx + 86, wy + 48); x.stroke();
  };
  drawWin(60, 130); drawWin(356, 130);
  drawWin(60, 260); drawWin(356, 260);
  /* 门：中央拱门（深棕 + 把手 + 台阶） */
  x.fillStyle = dark ? '#5b4a6e' : '#d9cdb8';
  roundRect(x, 196, 300, 120, 16, 6); x.fill(); /* 台阶 */
  x.fillStyle = dark ? '#6d4a2f' : '#8b5a2b';
  x.beginPath();
  x.moveTo(206, 452); x.lineTo(206, 360);
  x.arc(256, 360, 50, Math.PI, 0);
  x.lineTo(306, 452);
  x.closePath(); x.fill();
  x.strokeStyle = dark ? '#3a2718' : '#6e431f';
  x.lineWidth = 6; x.stroke();
  x.fillStyle = '#ffd97a';
  x.beginPath(); x.arc(290, 405, 5, 0, 7); x.fill();
  /* 门牌招牌（紫色底，名字由 3D 标签浮于其上，这里画个装饰横幅） */
  x.fillStyle = dark ? '#4c3d99' : '#6f4bcc';
  roundRect(x, 136, 76, 240, 52, 12); x.fill();
  x.fillStyle = '#ffd97a';
  x.font = '700 34px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(b.emoji, 256, 103);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---- 3D 树木（真模型：树干 + 树冠） ---- */
function makeTree(kind, dark) {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: dark ? 0x6b4423 : 0x8b5a2b, roughness: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.22, 1.4, 7), trunkMat);
  trunk.position.y = 0.7;
  trunk.castShadow = true;
  g.add(trunk);
  if (kind === '🌲') {
    const mat = new THREE.MeshStandardMaterial({ color: dark ? 0x1c4a2e : 0x2e8b46, roughness: 0.9 });
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.15 - i * 0.24, 1.35, 9), mat);
      cone.position.y = 1.55 + i * 0.72;
      cone.castShadow = true;
      g.add(cone);
    }
  } else {
    const mat = new THREE.MeshStandardMaterial({ color: dark ? 0x285f33 : 0x54b45f, roughness: 0.9 });
    const s1 = new THREE.Mesh(new THREE.SphereGeometry(1.05, 10, 8), mat);
    s1.position.y = 2.15; s1.scale.set(1.05, 0.95, 1.05); s1.castShadow = true; g.add(s1);
    const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.72, 10, 8), mat);
    s2.position.set(0.5, 1.8, 0.25); s2.castShadow = true; g.add(s2);
    const s3 = new THREE.Mesh(new THREE.SphereGeometry(0.66, 10, 8), mat);
    s3.position.set(-0.45, 1.85, -0.2); s3.castShadow = true; g.add(s3);
  }
  return g;
}

/* ---- 3D 喷泉（石盘 + 水面 + 中央水柱） ---- */
function makeFountain(dark) {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: dark ? 0x8a8aa0 : 0xcfc8d8, roughness: 0.85 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.25, 0.45, 24), stoneMat);
  base.position.y = 0.22; base.castShadow = true; base.receiveShadow = true; g.add(base);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.18, 24), stoneMat);
  rim.position.y = 0.5; g.add(rim);
  const waterMat = new THREE.MeshStandardMaterial({
    color: dark ? 0x2b6f9e : 0x7cc6f0, roughness: 0.2, metalness: 0.1,
    transparent: true, opacity: 0.85,
  });
  const water = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.12, 24), waterMat);
  water.position.y = 0.5; g.add(water);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.9, 12), stoneMat);
  pillar.position.y = 0.95; pillar.castShadow = true; g.add(pillar);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.4, 0.22, 12), stoneMat);
  top.position.y = 1.5; top.castShadow = true; g.add(top);
  return g;
}

/* ---- 初始化入口 ---- */
function initFirstPerson() {
  if (typeof THREE === 'undefined') {
    console.warn('Three.js 未加载，第一人称不可用');
    return;
  }
  if (fp.scene) return; /* 幂等 */
  const wrap = $('worldWrap');
  const canvas = $('fpCanvas');
  const S = to3(0, 0, 0).S;

  /* 场景+天空渐变背景+雾（场景扩大到 120×88m，fog 同步拉远） */
  fp.scene = new THREE.Scene();
  const dark = document.body.dataset.theme === 'dark';
  fp.scene.background = makeSkyTexture(dark);
  fp.scene.fog = new THREE.Fog(
    dark ? 0x1a2347 : 0xbfdff5,
    35, 140
  );

  /* 相机（挂在 yawObj→pitchObj 层级下，相机本身 local position=0；yawObj 跟随玩家眼睛 3D 坐标） */
  const rect = wrap.getBoundingClientRect();
  fp.camera = new THREE.PerspectiveCamera(72, rect.width / rect.height, 0.1, 500);
  fp.camera.position.set(0, 0, 0);

  /* Renderer */
  fp.renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
  });
  fp.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  fp.renderer.setSize(rect.width, rect.height, false);
  fp.renderer.shadowMap.enabled = true;
  fp.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  fp.renderer.outputColorSpace = THREE.SRGBColorSpace;

  /* 灯光（阴影相机范围随大地图扩大到 ±80m） */
  const hemi = new THREE.HemisphereLight(dark ? 0x9db4ff : 0xdfeeff, dark ? 0x24351f : 0x6fa055, dark ? 0.7 : 0.95);
  fp.scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff4d6, dark ? 0.75 : 1.15);
  dir.position.set(35, 70, 25);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.bias = -0.0004;
  dir.shadow.normalBias = 0.03;
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 200;
  dir.shadow.camera.left = -80;
  dir.shadow.camera.right = 80;
  dir.shadow.camera.top = 80;
  dir.shadow.camera.bottom = -80;
  fp.scene.add(dir);
  fp.sunLight = dir;

  /* ---- 构建世界 ---- */
  buildFpWorld(S, dark);

  /* 相机控制：自写第一人称 PointerLock (yaw/pitch Euler)，避免 three examples 路径脆弱 */
  fp.yawObj = new THREE.Object3D();
  fp.pitchObj = new THREE.Object3D();
  fp.pitchObj.add(fp.camera);
  fp.yawObj.add(fp.pitchObj);
  fp.scene.add(fp.yawObj);
  /* 把 yawObj 初始位置放玩家眼睛处 */
  const eye0 = to3(world.me.x, world.me.y, fp.meEye);
  fp.yawObj.position.set(eye0.x, eye0.y, eye0.z);
  /* 玩家出生在地图南（y=615 下方），应当"默认向前=向北（world y 减小）"，
     Three.js 相机默认向 -z；但 to3 中 +z = 向南，-z = 向北。
     所以把 yaw 预设为 π（旋转 180°）让 forward 朝 +z 方向（向北），W 键即前进 */
  fp.yaw = Math.PI;
  fp.yawObj.rotation.y = fp.yaw;

  fp.onMouseMove = (e) => {
    if (!fp.locked) return;
    /* 灵敏度：2000 像素 ≈ 2π 弧度 → 每像素 0.0022 弧度。
       to3 北=+z 为镜像映射，水平方向用 += 才能"鼠标右移→视角向东右转" */
    const sens = 0.0022;
    fp.yaw   += e.movementX * sens;
    fp.pitch -= e.movementY * sens;
    /* Pitch 钳制 ±85°，避免翻到后面 */
    const lim = Math.PI * 0.48;
    if (fp.pitch >  lim) fp.pitch =  lim;
    if (fp.pitch < -lim) fp.pitch = -lim;
    fp.yawObj.rotation.y   = fp.yaw;
    fp.pitchObj.rotation.x = fp.pitch;
  };
  document.addEventListener('mousemove', fp.onMouseMove);
  fp.onLockChange = () => {
    const locked = document.pointerLockElement === canvas || document.pointerLockElement === wrap;
    fp.locked = locked;
    $('fpCross').hidden = !locked;
    $('fpLockMsg').hidden = locked;
  };
  document.addEventListener('pointerlockchange', fp.onLockChange);

  fp.raycaster = new THREE.Raycaster();
  fp.mouseVec = new THREE.Vector2(0, 0);
  fp.clock = new THREE.Clock();
  fp.lock = () => { try { canvas.requestPointerLock(); } catch (e) { wrap.requestPointerLock(); } };

  wrap.addEventListener('click', () => {
    if (fp.locked) fpInteract();
    else fp.lock();
  });
  $('fpLockMsg').hidden = false;
  $('fpCross').hidden = true;
  $('fpHint').hidden = true;

  /* 键盘：WASD + 方向键（由 onWorldKey 已绑定的 world.keys 读取）+ 空格跳 */
  window.addEventListener('keydown', onFpKey);
  window.addEventListener('keyup', onFpKey);

  /* 启动动画循环 */
  animateFp();

  /* 初始化 3D 角色 */
  initFpChars(S);
}

function buildFpWorld(S, dark) {
  /* 地面：1500×1100 = 120×88 米，草地纹理 */
  const groundGeo = new THREE.PlaneGeometry(WORLD_W * S, WORLD_H * S, 1, 1);
  const groundMat = new THREE.MeshStandardMaterial({
    map: makeGrassTexture(dark),
    roughness: 0.95, metalness: 0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  fp.scene.add(ground);

  /* 路径：横竖两条土路（横路 y=850、竖路 x=750） */
  const pathMat = new THREE.MeshStandardMaterial({
    map: makePathTexture(dark), roughness: 0.9,
  });
  const pathH = new THREE.Mesh(
    new THREE.BoxGeometry(WORLD_W * S, 0.06, 42 * S),
    pathMat
  );
  pathH.position.set(0, 0.03, (WORLD_H / 2 - 850) * S);
  pathH.receiveShadow = true;
  fp.scene.add(pathH);
  const pathV = new THREE.Mesh(
    new THREE.BoxGeometry(42 * S, 0.06, WORLD_H * S),
    pathMat
  );
  pathV.position.set((750 - WORLD_W / 2) * S, 0.03, 0);
  pathV.receiveShadow = true;
  fp.scene.add(pathV);

  /* 建筑（正面纹理墙体 Box + 四坡屋顶 + 大门牌名） */
  const roofMat = new THREE.MeshStandardMaterial({
    color: dark ? 0x43388a : 0x6f4bcc, roughness: 0.7,
  });
  const sideWallMat = new THREE.MeshStandardMaterial({
    color: dark ? 0x2e2850 : 0xe9e3fb, roughness: 0.9,
  });
  for (const b of WORLD_BUILDINGS) {
    const w = b.w * S, d = b.h * S, h = 110 * S; /* 建筑高度=8.8m */
    const center = to3(b.x + b.w / 2, b.y + b.h / 2);
    const group = new THREE.Group();
    /* 主体：正面(+z)用门窗纹理，其余面素色。Box 材质序 [+x,-x,+y,-y,+z,-z] */
    const frontMat = new THREE.MeshStandardMaterial({
      map: makeWallTexture(b, dark), roughness: 0.85, metalness: 0,
    });
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d * 1.2),
      [sideWallMat, sideWallMat, sideWallMat, sideWallMat, frontMat, sideWallMat]
    );
    body.position.set(0, h / 2, -d * 0.1);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    /* 屋顶：四棱锥 */
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(w, d * 1.2) * 0.95, h * 0.5, 4),
      roofMat
    );
    roof.position.set(0, h + h * 0.25, -d * 0.1);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);
    /* 正面 emoji（门脸上方） */
    const emSp = makeEmojiSprite(b.emoji, { size: 58 });
    emSp.scale.set(0.9, 0.9, 1);
    emSp.position.set(0, h * 0.82, d * 0.62);
    group.add(emSp);
    /* 大门牌名：紫底白字大标签，depthTest=false 保证任何角度清晰可读 */
    const nameSp = makeEmojiSprite(b.name, { bubble: true, size: 44,
      bubble: { bg: dark ? 'rgba(76,61,153,0.98)' : 'rgba(111,75,204,0.98)',
                 border: 'rgba(255,217,122,0.9)',
                 color: '#ffffff' } });
    nameSp.material.depthTest = false;
    nameSp.renderOrder = 999;
    nameSp.scale.set(4.6, 0.95, 1);
    nameSp.position.set(0, h * 0.52, d * 0.68);
    group.add(nameSp);
    group.position.set(center.x, 0, center.z);
    group.userData.building = b;
    fp.scene.add(group);
    body.userData.building = b;   /* raycast 能命中 body 拿到建筑引用 */
    fp.buildingMeshes.push(body);
  }

  /* 装饰：🌳🌲 用真 3D 模型；⛲ 用 3D 喷泉水池；其余 emoji Sprite */
  for (const d of WORLD_DECOS) {
    const p = to3(d.x, d.y);
    if (d.t === '🌳' || d.t === '🌲') {
      const tree = makeTree(d.t, dark);
      tree.position.set(p.x, 0, p.z);
      tree.scale.setScalar(1.15);
      fp.scene.add(tree);
      fp.decoSprites.push(tree); /* Group：随场景 traverse 统一释放 */
      continue;
    }
    if (d.fx) {
      const foun = makeFountain(dark);
      foun.position.set(p.x, 0, p.z);
      fp.scene.add(foun);
      fp.decoSprites.push(foun);
    }
    const size = d.fly ? 0.7 : (d.fx ? 1.1 : 0.7);
    const sp = makeEmojiSprite(d.t, { size: 42 });
    sp.scale.set(size, size, 1);
    if (d.fx) {
      sp.position.set(p.x, 2.0, p.z);
    } else if (d.fly) {
      sp.position.set(p.x, 2.6, p.z);
    } else {
      sp.position.set(p.x, size * 0.55, p.z);
    }
    if (d.fly) sp.userData.fly = { t0: performance.now(), p0: { x: p.x, y: 2.6, z: p.z } };
    fp.decoSprites.push(sp);
    fp.scene.add(sp);
  }

  /* 喷泉粒子（中央喷泉 750,640） */
  const fp0 = to3(750, 850);
  for (let i = 0; i < 10; i++) {
    const geo = new THREE.SphereGeometry(0.07, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.9 });
    const s = new THREE.Mesh(geo, mat);
    s.position.set(fp0.x, 1.6, fp0.z);
    s.userData.fountain = { t0: performance.now() + Math.random() * 1.3e3, ox: (Math.random() - 0.5) * 0.3, oz: (Math.random() - 0.5) * 0.3 };
    fp.decoSprites.push(s);
    fp.scene.add(s);
  }
}

/* ---- 3D 角色初始化 & 每帧同步 ---- */
function initFpChars(S) {
  /* NPC */
  for (const n of WORLD_NPCS) {
    const p = to3(n.x, n.y);
    const spr = makeEmojiSprite(n.emoji, { size: 54 });
    spr.scale.set(1.1, 1.1, 1);
    spr.position.set(p.x, 1.35, p.z);
    const tag = makeEmojiSprite(n.name, { bubble: true, size: 24,
      bubble: { bg: 'rgba(254, 243, 199, 0.98)', border: 'rgba(245,158,11,0.6)', color: '#92400e' } });
    tag.scale.set(1.9, 0.56, 1);
    tag.position.set(p.x, 2.3, p.z);
    spr.userData.npc = n;
    fp.scene.add(spr); fp.scene.add(tag);
    fp.npcMeshes.push({ spr, tag, n });
  }
  /* 机器人 */
  for (const b of world.bots) {
    const p = to3(b.x, b.y);
    const spr = makeEmojiSprite(b.avatar, { size: 54 });
    spr.scale.set(1.0, 1.0, 1);
    spr.position.set(p.x, 1.3, p.z);
    const tag = makeEmojiSprite(b.name, { bubble: true, size: 22,
      bubble: { bg: 'rgba(255,255,255,0.95)', border: 'rgba(0,0,0,0.08)', color: '#23203a' } });
    tag.scale.set(1.8, 0.54, 1);
    tag.position.set(p.x, 2.25, p.z);
    fp.scene.add(spr); fp.scene.add(tag);
    fp.charMeshes.set(b.id, { spr, tag });
  }
  /* 远端玩家（初始空，syncFpRemotes 由 worldPoll 触发同步） */
  syncFpRemotes(true);
}

/* 同步远端玩家到 3D 场景 */
function syncFpRemotes(firstBuild = false) {
  if (!fp.scene) return;
  /* 远端玩家 id 集合 */
  const live = new Set(world.remotes.map(p => 'rm:' + p.id));
  /* 清理已不存在的远端 */
  for (const [id, rec] of fp.charMeshes) {
    if (id.startsWith('rm:') && !live.has(id)) {
      fp.scene.remove(rec.spr); fp.scene.remove(rec.tag);
      rec.spr.material.map.dispose();
      fp.charMeshes.delete(id);
    }
  }
  for (const p of world.remotes) {
    const key = 'rm:' + p.id;
    const pos = to3(p.x, p.y);
    let rec = fp.charMeshes.get(key);
    if (!rec) {
      const spr = makeEmojiSprite(p.avatar || '🧑‍🎨', { size: 54 });
      spr.scale.set(1.0, 1.0, 1);
      spr.position.set(pos.x, 1.3, pos.z);
      const friend = !!p.isFriend;
      const tag = makeEmojiSprite((friend ? '👥 ' : '') + p.name, {
        bubble: true, size: 22,
        bubble: friend
          ? { bg: 'rgba(220, 252, 231, 0.96)', border: 'rgba(34,197,94,0.55)', color: '#15803d' }
          : { bg: 'rgba(255,255,255,0.95)', border: 'rgba(0,0,0,0.08)', color: '#23203a' }
      });
      tag.scale.set(2.0, 0.54, 1);
      tag.position.set(pos.x, 2.25, pos.z);
      fp.scene.add(spr); fp.scene.add(tag);
      rec = { spr, tag };
      fp.charMeshes.set(key, rec);
    } else {
      rec.spr.position.set(pos.x, 1.3, pos.z);
      rec.tag.position.set(pos.x, 2.25, pos.z);
    }
  }
}
/* 每帧位置同步（机器人 tick 已由 worldTick 50ms 更新 2D 坐标，这里读取 world.bots 位置） */
function syncFpCharsEveryFrame() {
  if (!fp.scene) return;
  for (const b of world.bots) {
    const rec = fp.charMeshes.get(b.id);
    if (!rec) continue;
    const p = to3(b.x, b.y);
    rec.spr.position.set(p.x, 1.3, p.z);
    rec.tag.position.set(p.x, 2.25, p.z);
  }
  /* 飞蝶/鸟动画 */
  for (const o of fp.decoSprites) {
    const f = o.userData.fly; if (!f) continue;
    const t = (performance.now() - f.t0) / 1000;
    const a = 0.6;
    o.position.x = f.p0.x + Math.sin(t * 0.9) * a * 0.7;
    o.position.y = f.p0.y + Math.sin(t * 1.6) * 0.15;
    o.position.z = f.p0.z + Math.cos(t * 0.7) * a * 0.5;
  }
  /* 喷泉动画 */
  for (const o of fp.decoSprites) {
    const f = o.userData.fountain; if (!f) continue;
    const t = ((performance.now() - f.t0) / 1000) % 1.3;
    const h = -1.8 * t * t + 2.34 * t;           /* 抛物线 0→最高点 0.65→0 */
    o.position.y = 1.55 + h;
    o.position.x = f.bx + f.ox * t;
    o.position.z = f.bz + f.oz * t;
    o.material.opacity = t < 1.1 ? 0.95 : 0.95 * (1 - (t - 1.1) / 0.2);
  }
  /* 玩家眼睛（yawObj 容器）跟随 world.me 2D 坐标 —— 单一真相写入 */
  const me = to3(world.me.x, world.me.y, fp.meEye);
  const target = new THREE.Vector3(me.x, me.y, me.z);
  if (fp.yawObj) fp.yawObj.position.lerp(target, 0.45);
}

/* ---- 控制：键盘（WASD/方向键跳）+ 重力 AABB 碰撞 ---- */
const fpKeys = { fwd: false, bwd: false, left: false, right: false, jump: false };
function onFpKey(e) {
  if (!fp.locked && !['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Space'].includes(e.key)) return;
  const k = e.key.toLowerCase() === ' ' ? 'space' : e.key.toLowerCase();
  const down = e.type === 'keydown';
  if (k === 'w' || k === 'arrowup')    fpKeys.fwd = down;
  if (k === 's' || k === 'arrowdown')  fpKeys.bwd = down;
  if (k === 'a' || k === 'arrowleft')  fpKeys.left = down;
  if (k === 'd' || k === 'arrowright') fpKeys.right = down;
  if (k === 'space' || k === ' ')      fpKeys.jump = down;
}

/* AABB 碰撞：尝试 nx/nz（world 坐标，中心为 1×1 方块，半径 20 world 单位=1.6m） */
function fpCollides(nx, nz) {
  /* world 坐标下玩家 AABB 半宽 half=18 单位 */
  const half = 18;
  const xa = nx - half, xb = nx + half;
  const za = nz - half, zb = nz + half;
  for (const s of WORLD_SOLIDS) {
    const sxa = s.x, sxb = s.x + s.w;
    const sza = s.y, szb = s.y + s.h;
    if (xb > sxa && xa < sxb && zb > sza && za < szb) return true;
  }
  /* 世界边界钳制（在调用方也会再做一次，这里保底） */
  if (nx < 30 || nx > WORLD_W - 30) return true;
  if (nz < 110 || nz > WORLD_H - 30) return true;
  return false;
}

/* 读取 world.me 2D 坐标，用相机 forward/right 向量投影到 z=0 平面，写回 world.me.x/y；
   相机高度/重力单独维护。world.me.x/y 即"单一真相"，2D 世界的碰撞/心跳/机器人都读这里。
   这样所有功能（2D 碰撞箱、联机坐标上报、靠近检测）都可以零修改复用，
   完全满足经验 #100020927 的"收敛写入点"要求。 */
function moveFp(dt) {
  if (!fp.locked) return;
  const realSpeed = 55; /* world 单位/秒（0.08m/u → 4.4 m/s，快走） */
  const S = 0.08;

  /* forward 向量 = camera direction 投影到地面（y=0 平面） */
  const dir = new THREE.Vector3();
  fp.camera.getWorldDirection(dir);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();
  const right = new THREE.Vector3(dir.z, 0, -dir.x);

  let wx3 = 0, wz3 = 0;
  if (fpKeys.fwd)   { wx3 += dir.x; wz3 += dir.z; }
  if (fpKeys.bwd)   { wx3 -= dir.x; wz3 -= dir.z; }
  if (fpKeys.left)  { wx3 -= right.x; wz3 -= right.z; }
  if (fpKeys.right) { wx3 += right.x; wz3 += right.z; }
  const len = Math.hypot(wx3, wz3);
  if (len <= 0) return;
  wx3 /= len; wz3 /= len;
  /* 位移直接在 world 坐标系算（各向同比例 S，方向向量通用；z 轴与 world y 反号）。
     realSpeed=55 world 单位/秒 ≈ 4.4 m/s 步行速度（注意不要再除 S，否则变成 55m/s） */
  const dwx = wx3 * realSpeed * dt;
  const dwy = -wz3 * realSpeed * dt;
  /* 分轴 AABB：和 worldTick 完全一致 */
  const nx = wcClamp(world.me.x + dwx, 30, WORLD_W - 30);
  const ny = wcClamp(world.me.y + dwy, 110, WORLD_H - 30);
  if (!fpCollides(nx, world.me.y)) world.me.x = nx;
  if (!fpCollides(world.me.x, ny)) world.me.y = ny;
}

/* ---- Raycast 检测正前方目标 -> 交互提示 ---- */
function fpLookCheck() {
  if (!fp.scene || !fp.locked) {
    $('fpHint').hidden = true;
    fp._hoverBuilding = null;
    fp._hoverNpc = null;
    return;
  }
  fp.raycaster.setFromCamera(fp.mouseVec, fp.camera);
  const all = fp.buildingMeshes.concat(
    fp.npcMeshes.map(n => {
      const m = n.spr.clone(true);
      m.userData.npc = n.n;           /* 避免污染原对象，后面不用它 */
      return m;
    })
  );
  const hits = fp.raycaster.intersectObjects(fp.buildingMeshes, false);
  /* NPC 单独用距离球判定更稳（emoji sprite 难 raycast） */
  let npcHit = null, npcDist = Infinity;
  const origin = fp.camera.position.clone();
  const fwd = new THREE.Vector3();
  fp.camera.getWorldDirection(fwd);
  for (const n of fp.npcMeshes) {
    const to = n.spr.position.clone().sub(origin);
    const along = to.dot(fwd);
    if (along < 0.1 || along > 16) continue;
    const perp = to.clone().sub(fwd.clone().multiplyScalar(along)).length();
    if (perp < 0.9 && along < npcDist) { npcDist = along; npcHit = n.n; }
  }
  let buildingHit = null;
  if (hits.length > 0 && hits[0].distance < 22) {
    buildingHit = hits[0].object.userData.building;
  }
  if (npcHit) {
    fp._hoverBuilding = null;
    fp._hoverNpc = npcHit;
    const el = $('fpHint');
    el.hidden = false;
    el.innerHTML = `🗣️ 按 <b>E</b> 或 点击 和 ${npcHit.name} 聊天`;
  } else if (buildingHit) {
    fp._hoverBuilding = buildingHit;
    fp._hoverNpc = null;
    const el = $('fpHint');
    el.hidden = false;
    el.innerHTML = `🚪 按 <b>E</b> 或 点击 进入${buildingHit.name}`;
  } else {
    $('fpHint').hidden = true;
    fp._hoverBuilding = null;
    fp._hoverNpc = null;
  }
}

function fpInteract() {
  /* 按 E 或 点击（已锁定时）触发交互 */
  if (fp._hoverBuilding) {
    sndFlip();
    enterWorldView(fp._hoverBuilding.view);
  } else if (fp._hoverNpc) {
    sndFlip();
    openNpc(fp._hoverNpc);
  }
}

/* ---- 渲染循环 ---- */
function animateFp() {
  fp.animId = requestAnimationFrame(animateFp);
  const dt = Math.min(fp.clock.getDelta(), 0.05);
  moveFp(dt);
  syncFpCharsEveryFrame();
  syncFpRemotes();      /* 不重创建，只是位置修正（幂等但开销低） */
  fpLookCheck();
  fp.renderer.render(fp.scene, fp.camera);
}

/* ---- 适配窗口 ---- */
function fpResize() {
  if (!fp.renderer) return;
  const rect = $('worldWrap').getBoundingClientRect();
  fp.camera.aspect = rect.width / rect.height;
  fp.camera.updateProjectionMatrix();
  fp.renderer.setSize(rect.width, rect.height, false);
}

/* ---- 资源释放 ---- */
function disposeFirstPerson() {
  if (fp.animId) { cancelAnimationFrame(fp.animId); fp.animId = null; }
  if (fp.onMouseMove)  { document.removeEventListener('mousemove', fp.onMouseMove); fp.onMouseMove = null; }
  if (fp.onLockChange){ document.removeEventListener('pointerlockchange', fp.onLockChange); fp.onLockChange = null; }
  if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (e) {} }
  window.removeEventListener('keydown', onFpKey);
  window.removeEventListener('keyup', onFpKey);
  fp.locked = false;
  $('fpCross').hidden = true;
  $('fpLockMsg').hidden = true;
  $('fpHint').hidden = true;
  if (fp.scene) {
    if (fp.scene.background && fp.scene.background.dispose) fp.scene.background.dispose();
    fp.scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    fp.scene = null;
  }
  if (fp.renderer) { fp.renderer.dispose(); fp.renderer = null; }
  fp.camera = null; fp.yawObj = null; fp.pitchObj = null;
  fp.buildingMeshes.length = 0;
  fp.npcMeshes.length = 0;
  fp.charMeshes.clear();
  fp.decoSprites.length = 0;
  fp.raycaster = null; fp.mouseVec = null; fp.clock = null;
}

/* 交互键 E 绑定（避免 PointerLock 下 click 只触发一次交互） */
window.addEventListener('keydown', (e) => {
  if (e.key && e.key.toLowerCase() === 'e' && fp && fp.locked) {
    fpInteract();
  }
});
