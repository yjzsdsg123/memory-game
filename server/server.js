/* ============================================================
 * 记忆力挑战 — 短信验证码后端（零依赖，仅使用 Node.js 内置模块）
 *
 * 两种运行模式：
 *  - sandbox（默认）：不真实发短信，验证码打印在后端日志并通过接口返回（devCode）
 *  - 真实短信：在 config.json 填入阿里云短信凭证（sms 字段）后自动启用
 *
 * 接口：
 *  POST /api/sms/send     发送验证码（body: { phone }；限流：60s/条，10条/天）
 *  POST /api/sms/verify   校验验证码并登录，签发 7 天 token（body: { phone, code }）
 *  GET  /api/me?token=    校验登录态（也支持 X-Auth-Token 请求头）
 *  GET  /api/health       健康检查
 * ============================================================ */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_DIR = path.join(__dirname, 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const SCORES_PATH = path.join(DATA_DIR, 'scores.json');
const FRIENDS_PATH = path.join(DATA_DIR, 'friends.json');

/* 排行榜机器人种子（保证榜单有内容，真人成绩合并后排序） */
const BOT_SEED = [
  { name: '记忆大师007', points: 1680, w: 142, d: 9, l: 23 },
  { name: '过目不忘', points: 1590, w: 128, d: 11, l: 30 },
  { name: '最强大脑', points: 1475, w: 116, d: 8, l: 33 },
  { name: '卡牌仙人', points: 1320, w: 104, d: 14, l: 41 },
  { name: '闪电快手', points: 1180, w: 96, d: 7, l: 47 },
  { name: '专注之神', points: 1050, w: 88, d: 10, l: 44 },
  { name: '记忆力爆棚', points: 940, w: 79, d: 6, l: 52 },
  { name: '沉默配对王', points: 860, w: 72, d: 12, l: 55 },
  { name: '翻牌小天才', points: 745, w: 63, d: 9, l: 58 },
  { name: '青铜守门员', points: 620, w: 54, d: 8, l: 61 },
  { name: '慢慢来比较快', points: 520, w: 46, d: 11, l: 63 },
  { name: '随缘选手', points: 430, w: 38, d: 7, l: 66 },
  { name: '三秒记忆', points: 350, w: 31, d: 6, l: 70 },
  { name: '别翻我牌', points: 260, w: 24, d: 5, l: 72 },
  { name: '萌新玩家', points: 180, w: 17, d: 4, l: 75 },
  { name: '路过打酱油', points: 110, w: 10, d: 3, l: 78 },
  { name: '第一次玩', points: 45, w: 4, d: 2, l: 80 },
  { name: '人机友好大使', points: 10, w: 1, d: 1, l: 83 },
];

/* ---------------- 排行榜成绩存储（JSON 文件） ---------------- */
function loadScores() {
  try {
    return JSON.parse(fs.readFileSync(SCORES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveScores(scores) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SCORES_PATH + '.tmp', JSON.stringify(scores, null, 2));
  fs.renameSync(SCORES_PATH + '.tmp', SCORES_PATH);
}

/* ---------------- 好友关系存储（JSON 文件） ---------------- */
function loadFriends() {
  try {
    return JSON.parse(fs.readFileSync(FRIENDS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveFriends(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FRIENDS_PATH + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(FRIENDS_PATH + '.tmp', FRIENDS_PATH);
}

/* 获取或初始化某用户的好友数据 */
function getFriendEntry(phone) {
  const data = loadFriends();
  if (!data[phone]) {
    data[phone] = { friends: [], outgoing: [], incoming: [] };
    saveFriends(data);
  }
  return data[phone];
}

/* 在线状态（内存，不持久化） */
const lastSeen = new Map();
function isOnline(phone) {
  const t = lastSeen.get(phone);
  return t && Date.now() - t < 30000;
}

/* 对战邀请（内存，不持久化） */
const pvpChallenges = new Map();
let challengeSeq = 0;

/* ---------------- 大世界：在线位置（内存态，15 秒无心跳即离开） ---------------- */
const WORLD_W = 1000;
const WORLD_H = 680;
const WORLD_AVATARS = ['🧑‍🎨', '🧙‍♀️', '🧙‍♂️', '🦸‍♀️', '🦸‍♂️', '🥷', '🤖', '🐱', '🐰', '🦊', '🐼', '🐨', '🦁', '🐯', '🐧'];
const worldPresence = new Map(); /* phone -> { x, y, avatar, name, at } */

/* 合并机器人与真人成绩，按积分降序（同积分按胜场），返回 Top50 */
function buildLeaderboard() {
  const scores = loadScores();
  const list = BOT_SEED.map((b, i) => ({ rank: 0, name: b.name, points: b.points, w: b.w, d: 0, l: b.l, bot: true, id: 'bot' + i }));
  for (const [phone, s] of Object.entries(scores)) {
    list.push({
      rank: 0,
      name: s.nickname || phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'),
      points: s.points || 0,
      w: s.w || 0,
      d: s.d || 0,
      l: s.l || 0,
      bot: false,
      id: phone,
    });
  }
  list.sort((a, b) => b.points - a.points || b.w - a.w);
  return list.slice(0, 50).map((e, i) => {
    e.rank = i + 1;
    return e;
  });
}

/* config.json 缺失时自动生成沙盒默认配置（真实密钥文件已被 .gitignore 忽略） */
if (!fs.existsSync(CONFIG_PATH)) {
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ mode: 'sandbox', port: 8080, sms: null }, null, 2)
  );
  console.log('未找到 config.json，已自动生成沙盒配置');
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const PORT = config.port || 8080;

/* ---------------- HTTP 工具 ---------------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
  'Access-Control-Allow-Private-Network': 'true',
};

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/* ---------------- 用户与登录 token（JSON 持久化） ---------------- */
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_PATH + '.tmp', JSON.stringify(users, null, 2));
  fs.renameSync(USERS_PATH + '.tmp', USERS_PATH);
}

function issueToken(phone) {
  const users = loadUsers();
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  users[phone] = {
    token,
    tokenExp: now + 7 * 24 * 3600 * 1000, /* 7 天有效 */
    createdAt: (users[phone] && users[phone].createdAt) || new Date().toISOString(),
    lastLogin: new Date().toISOString(),
  };
  saveUsers(users);
  return token;
}

function phoneByToken(token) {
  if (!token) return null;
  const users = loadUsers();
  for (const [phone, u] of Object.entries(users)) {
    if (u.token === token && u.tokenExp > Date.now()) return phone;
  }
  return null;
}

/* ---------------- 短信验证码（内存存储，单机适用） ----------------
 * 约束：60 秒发送间隔、每号每天 10 条、验证码 5 分钟过期、最多 5 次尝试。
 * 多实例/容器化部署时应把此 Map 换成 Redis（key=phone，TTL=300s）。 */
const smsStore = new Map();
const SMS_TTL = 5 * 60 * 1000;
const SMS_RESEND = 60 * 1000;
const SMS_DAY_LIMIT = 10;
const SMS_MAX_TRIES = 5;

function validPhone(p) {
  return /^1[3-9]\d{9}$/.test(p);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/* 阿里云短信 RPC 签名（HMAC-SHA1），零依赖 */
function aliRpcEncode(v) {
  return encodeURIComponent(v).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');
}

async function aliyunSendSms(phone, code, cfg) {
  const params = {
    AccessKeyId: cfg.accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    RegionId: 'cn-hangzhou',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomBytes(12).toString('hex'),
    SignatureVersion: '1.0',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
    PhoneNumbers: phone,
    SignName: cfg.signName,
    TemplateCode: cfg.templateCode,
    TemplateParam: JSON.stringify({ code }),
  };
  const sorted = Object.keys(params).sort().map((k) => aliRpcEncode(k) + '=' + aliRpcEncode(params[k])).join('&');
  const stringToSign = 'GET&%2F&' + aliRpcEncode(sorted);
  const signature = crypto.createHmac('sha1', cfg.accessKeySecret + '&').update(stringToSign).digest('base64');
  const url = 'https://dysmsapi.aliyuncs.com/?Signature=' + aliRpcEncode(signature) + '&' + sorted;
  const r = await fetch(url);
  const j = await r.json();
  if (j.Code !== 'OK') throw new Error('短信发送失败: ' + (j.Message || j.Code || JSON.stringify(j)));
}

async function sendSmsCode(phone) {
  const now = Date.now();
  const rec = smsStore.get(phone) || {};
  if (rec.lastSend && now - rec.lastSend < SMS_RESEND) {
    const wait = Math.ceil((SMS_RESEND - (now - rec.lastSend)) / 1000);
    const e = new Error(`发送太频繁，请 ${wait} 秒后再试`);
    e.status = 429;
    throw e;
  }
  const day = todayStr();
  if (rec.day !== day) {
    rec.day = day;
    rec.sends = 0;
  }
  if ((rec.sends || 0) >= SMS_DAY_LIMIT) {
    const e = new Error('今日发送次数已达上限，请明天再试');
    e.status = 429;
    throw e;
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  rec.code = code;
  rec.exp = now + SMS_TTL;
  rec.lastSend = now;
  rec.sends = (rec.sends || 0) + 1;
  rec.tries = 0;
  smsStore.set(phone, rec);

  if (config.sms && config.sms.provider === 'aliyun') {
    await aliyunSendSms(phone, code, config.sms);
    return { devCode: null };
  }
  /* 沙盒：不真发短信，验证码通过接口返回（仅开发用）并打印到后端日志 */
  console.log(`[沙盒短信] ${phone} 验证码: ${code}`);
  return { devCode: code };
}

function verifySmsCode(phone, code) {
  const rec = smsStore.get(phone);
  if (!rec || !rec.code) return { ok: false, error: '请先获取验证码' };
  if (Date.now() > rec.exp) {
    smsStore.delete(phone);
    return { ok: false, error: '验证码已过期，请重新获取' };
  }
  if ((rec.tries || 0) >= SMS_MAX_TRIES) {
    smsStore.delete(phone);
    return { ok: false, error: '错误次数过多，请重新获取验证码' };
  }
  if (rec.code !== code) {
    rec.tries = (rec.tries || 0) + 1;
    smsStore.set(phone, rec);
    return { ok: false, error: '验证码错误，请重新输入' };
  }
  smsStore.delete(phone);
  return { ok: true };
}

/* ---------------- 真人对战：匹配与房间（服务器权威牌桌） ---------------- */
const PVP_EMOJIS = ['🍎', '🚀', '🐱', '🌈', '⚽', '🎵', '🌻', '🐳'];
const pvpQueue = []; /* [{ token, phone, at }] */
const pvpRooms = new Map(); /* roomId -> room */
let pvpSeq = 0;

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nicknameOf(phone) {
  const scores = loadScores();
  return (scores[phone] && scores[phone].nickname) ||
    phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

function createRoom(aEntry, bEntry) {
  const id = 'R' + Date.now().toString(36) + (++pvpSeq);
  const deck = shuffleArr([...PVP_EMOJIS, ...PVP_EMOJIS]).map((e) => ({ e, done: false }));
  const room = {
    id,
    a: aEntry.phone,
    b: bEntry.phone,
    tokens: { a: aEntry.token, b: bEntry.token },
    turn: Math.random() < 0.5 ? 'a' : 'b',
    deck,
    open: [],
    scores: { a: 0, b: 0 },
    status: 'playing',
    lastPoll: { a: Date.now(), b: Date.now() },
    over: null,
    createdAt: Date.now(),
  };
  pvpRooms.set(id, room);
  return room;
}

function sideOf(room, phone) {
  return room.a === phone ? 'a' : 'b';
}

function roomView(room, phone) {
  const side = sideOf(room, phone);
  const opp = side === 'a' ? 'b' : 'a';
  const open = room.open.map((o) => ({ i: o.i, e: room.deck[o.i].e }));
  const done = room.deck.map((c, i) => (c.done ? { i, e: c.e } : null)).filter(Boolean);
  let result = null, delta = 0, coins = 0;
  if (room.over) {
    result = room.over[side];
    delta = room.over.delta[side];
    coins = result === 'win' ? 50 : result === 'draw' ? 20 : 10;
  }
  return {
    status: room.status,
    roomId: room.id,
    you: side,
    yourTurn: room.status === 'playing' && room.turn === side,
    open,
    done,
    youScore: room.scores[side],
    oppScore: room.scores[opp],
    oppName: nicknameOf(side === 'a' ? room.b : room.a),
    result,
    delta,
    coins,
    reason: room.over ? room.over.reason : null,
    canAct: room.status === 'playing' && room.turn === side && room.open.length < 2,
  };
}

/* 对局结束：把积分/战绩写入排行榜成绩（服务器权威） */
function applyMultiplayerResult(room) {
  const scores = loadScores();
  for (const side of ['a', 'b']) {
    const phone = room[side];
    const r = room.over[side];
    const delta = room.over.delta[side];
    const prev = scores[phone] || { points: 0, w: 0, d: 0, l: 0 };
    scores[phone] = {
      nickname: prev.nickname || null,
      points: Math.max(0, (prev.points || 0) + delta),
      w: (prev.w || 0) + (r === 'win' ? 1 : 0),
      d: (prev.d || 0) + (r === 'draw' ? 1 : 0),
      l: (prev.l || 0) + (r === 'lose' ? 1 : 0),
      updatedAt: new Date().toISOString(),
    };
  }
  saveScores(scores);
}

function finishRoom(room, winnerSide, reason) {
  if (room.status === 'over') return;
  room.status = 'over';
  let deltaA, deltaB, resA, resB;
  const draw = winnerSide === 'draw' || (!winnerSide && room.scores.a === room.scores.b);
  const aWin = winnerSide === 'a' || (!winnerSide && room.scores.a > room.scores.b);
  if (draw) {
    resA = resB = 'draw';
    deltaA = deltaB = 10;
  } else if (aWin) {
    resA = 'win'; resB = 'lose';
    deltaA = 30; deltaB = -20;
  } else {
    resA = 'lose'; resB = 'win';
    deltaA = -20; deltaB = 30;
  }
  room.over = { a: resA, b: resB, delta: { a: deltaA, b: deltaB }, reason: reason || '' };
  applyMultiplayerResult(room);
  setTimeout(() => pvpRooms.delete(room.id), 120000); /* 结果保留 2 分钟供客户端拉取 */
}

function pvpAction(room, side, index) {
  if (room.status !== 'playing') return { ok: false, error: '对局已结束' };
  if (room.turn !== side) return { ok: false, error: '还没轮到你' };
  if (room.open.length >= 2) return { ok: false, error: '请稍候' };
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= room.deck.length) return { ok: false, error: '无效的牌' };
  if (room.deck[i].done) return { ok: false, error: '该牌已配对' };
  if (room.open.some((o) => o.i === i)) return { ok: false, error: '该牌已翻开' };
  room.open.push({ i, by: side });
  room.lastPoll[side] = Date.now();
  if (room.open.length === 2) {
    const [x, y] = room.open;
    if (room.deck[x.i].e === room.deck[y.i].e) {
      room.deck[x.i].done = true;
      room.deck[y.i].done = true;
      room.scores[side] += 1;
      room.open = [];
      if (room.deck.every((c) => c.done)) {
        finishRoom(room, room.scores.a === room.scores.b ? 'draw' : room.scores.a > room.scores.b ? 'a' : 'b', 'allmatched');
      }
    } else {
      /* 不匹配：1.3 秒后盖回并换手 */
      const cur = room;
      const nextSide = side === 'a' ? 'b' : 'a';
      setTimeout(() => {
        if (cur.status === 'playing') {
          cur.open = [];
          cur.turn = nextSide;
        }
      }, 1300);
    }
  }
  return { ok: true };
}

/* 定时清理：队列 60s 过期；一方 20s 无轮询判负；双方都掉线销毁房间 */
setInterval(() => {
  const now = Date.now();
  for (let k = pvpQueue.length - 1; k >= 0; k--) {
    if (now - pvpQueue[k].at > 60000) pvpQueue.splice(k, 1);
  }
  for (const room of [...pvpRooms.values()]) {
    if (room.status !== 'playing') continue;
    const aIdle = now - room.lastPoll.a > 20000;
    const bIdle = now - room.lastPoll.b > 20000;
    if (aIdle && bIdle) pvpRooms.delete(room.id);
    else if (aIdle) finishRoom(room, 'b', 'opponent_left');
    else if (bIdle) finishRoom(room, 'a', 'opponent_left');
  }
}, 5000);

/* 定时清理过期的对战邀请（60s 未响应自动过期） */
setInterval(() => {
  const now = Date.now();
  for (const [cid, ch] of pvpChallenges) {
    if (now - ch.at > 60000 && ch.status === 'pending') {
      ch.status = 'expired';
      setTimeout(() => pvpChallenges.delete(cid), 5000);
    }
  }
}, 10000);

/* 定时清理大世界过期位置（15s 无心跳判定离开小镇） */
setInterval(() => {
  const now = Date.now();
  for (const [ph, pos] of worldPresence) {
    if (now - pos.at > 15000) worldPresence.delete(ph);
  }
}, 5000);

function findRoomByToken(token) {
  for (const room of pvpRooms.values()) {
    if (room.tokens.a === token || room.tokens.b === token) return room;
  }
  return null;
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  /* 健康检查 */
  if (p === '/api/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, mode: config.sms ? 'live' : 'sandbox', sms: !!config.sms });
  }

  /* 发送短信验证码 */
  if (p === '/api/sms/send' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const phone = String(body.phone || '').trim();
      if (!validPhone(phone)) return json(res, 400, { ok: false, error: '请输入正确的 11 位手机号' });
      const { devCode } = await sendSmsCode(phone);
      return json(res, 200, { ok: true, devCode, mode: config.sms ? 'live' : 'sandbox' });
    } catch (e) {
      return json(res, e.status || 500, { ok: false, error: e.message });
    }
  }

  /* 校验验证码并登录（签发 7 天 token） */
  if (p === '/api/sms/verify' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const phone = String(body.phone || '').trim();
      const code = String(body.code || '').trim();
      if (!validPhone(phone)) return json(res, 400, { ok: false, error: '请输入正确的手机号' });
      if (code.length !== 6) return json(res, 400, { ok: false, error: '请输入 6 位验证码' });
      const v = verifySmsCode(phone, code);
      if (!v.ok) return json(res, 400, { ok: false, error: v.error });
      const token = issueToken(phone);
      return json(res, 200, { ok: true, token, phone });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* 校验登录态 */
  if (p === '/api/me' && req.method === 'GET') {
    const token = u.searchParams.get('token') || req.headers['x-auth-token'];
    const phone = phoneByToken(token);
    if (!phone) return json(res, 401, { ok: false, error: '未登录或登录已过期' });
    const scores = loadScores();
    return json(res, 200, { ok: true, phone, nickname: (scores[phone] && scores[phone].nickname) || null });
  }

  /* 排行榜：机器人 + 真人合并排序 */
  if (p === '/api/leaderboard' && req.method === 'GET') {
    const list = buildLeaderboard();
    const token = u.searchParams.get('token') || req.headers['x-auth-token'];
    const phone = phoneByToken(token);
    const self = phone ? list.find((e) => e.id === phone) : null;
    return json(res, 200, { ok: true, list, self: self || null });
  }

  /* 提交成绩（需登录；每局结算后调用，以客户端最新战绩覆盖） */
  if (p === '/api/leaderboard/submit' && req.method === 'POST') {
    try {
      const token = req.headers['x-auth-token'];
      const phone = phoneByToken(token);
      if (!phone) return json(res, 401, { ok: false, error: '请先登录后再提交成绩' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const points = Math.max(0, Math.min(99999, Math.floor(Number(body.points)) || 0));
      const w = Math.max(0, Math.floor(Number(body.w)) || 0);
      const d = Math.max(0, Math.floor(Number(body.d)) || 0);
      const l = Math.max(0, Math.floor(Number(body.l)) || 0);
      const scores = loadScores();
      const prev = scores[phone] || {};
      scores[phone] = {
        nickname: prev.nickname || null,
        points,
        w,
        d,
        l,
        updatedAt: new Date().toISOString(),
      };
      saveScores(scores);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* 设置昵称（需登录；1-12 字符，去除控制字符与 HTML 特殊符号） */
  if (p === '/api/me/nickname' && req.method === 'POST') {
    try {
      const token = req.headers['x-auth-token'];
      const phone = phoneByToken(token);
      if (!phone) return json(res, 401, { ok: false, error: '请先登录' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const nickname = String(body.nickname || '')
        .replace(/[<>&"'\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 12);
      if (!nickname) return json(res, 400, { ok: false, error: '昵称不能为空（最多 12 个字符）' });
      const scores = loadScores();
      scores[phone] = Object.assign({ points: 0, w: 0, d: 0, l: 0 }, scores[phone], {
        nickname,
        updatedAt: new Date().toISOString(),
      });
      saveScores(scores);
      return json(res, 200, { ok: true, nickname });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* ===== 真人对战 ===== */

  /* 加入匹配队列（已在房间则直接返回房间，支持断线重连） */
  if (p === '/api/match/join' && req.method === 'POST') {
    try {
      const token = req.headers['x-auth-token'];
      const phone = phoneByToken(token);
      if (!phone) return json(res, 401, { ok: false, error: '请先登录后再进行真人对战' });
      const existing = findRoomByToken(token);
      if (existing) {
        if (existing.status === 'over') {
          pvpRooms.delete(existing.id); /* 结算后的房间：开新局重新匹配 */
        } else {
          existing.lastPoll[sideOf(existing, phone)] = Date.now();
          return json(res, 200, { ok: true, status: existing.status, room: roomView(existing, phone) });
        }
      }
      const qi = pvpQueue.findIndex((q) => q.token === token);
      if (qi >= 0) pvpQueue.splice(qi, 1);
      const waiting = pvpQueue.find((q) => q.phone !== phone);
      if (waiting) {
        pvpQueue.splice(pvpQueue.indexOf(waiting), 1);
        const room = createRoom(waiting, { token, phone });
        return json(res, 200, { ok: true, status: 'playing', room: roomView(room, phone) });
      }
      pvpQueue.push({ token, phone, at: Date.now() });
      return json(res, 200, { ok: true, status: 'waiting' });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* 查询匹配/对局状态（轮询） */
  if (p === '/api/match/status' && req.method === 'GET') {
    const token = u.searchParams.get('token') || req.headers['x-auth-token'];
    const phone = phoneByToken(token);
    if (!phone) return json(res, 401, { ok: false, error: '请先登录' });
    lastSeen.set(phone, Date.now());
    const room = findRoomByToken(token);
    if (room) {
      room.lastPoll[sideOf(room, phone)] = Date.now();
      return json(res, 200, { ok: true, status: room.status, room: roomView(room, phone) });
    }
    const inQueue = pvpQueue.some((q) => q.token === token);
    return json(res, 200, { ok: true, status: inQueue ? 'waiting' : 'idle' });
  }

  /* 取消匹配 / 离开对局（对局中离开判负） */
  if (p === '/api/match/leave' && req.method === 'POST') {
    const token = req.headers['x-auth-token'];
    const phone = phoneByToken(token);
    if (!phone) return json(res, 401, { ok: false, error: '请先登录' });
    const qi = pvpQueue.findIndex((q) => q.token === token);
    if (qi >= 0) pvpQueue.splice(qi, 1);
    const room = findRoomByToken(token);
    if (room) {
      if (room.status === 'playing') {
        const side = sideOf(room, phone);
        finishRoom(room, side === 'a' ? 'b' : 'a', 'opponent_left');
      } else {
        pvpRooms.delete(room.id);
      }
    }
    return json(res, 200, { ok: true });
  }

  /* 翻牌操作（服务器校验回合/牌面） */
  if (p === '/api/match/action' && req.method === 'POST') {
    try {
      const token = req.headers['x-auth-token'];
      const phone = phoneByToken(token);
      if (!phone) return json(res, 401, { ok: false, error: '请先登录' });
      const room = findRoomByToken(token);
      if (!room) return json(res, 404, { ok: false, error: '对局不存在或已结束' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const side = sideOf(room, phone);
      const r = pvpAction(room, side, body.index);
      if (!r.ok) return json(res, 400, { ok: false, error: r.error });
      return json(res, 200, { ok: true, status: room.status, room: roomView(room, phone) });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* ===== 好友系统 ===== */

  /* 获取好友列表 + 待处理请求 + 对战邀请 */
  if (p === '/api/friends' && req.method === 'GET') {
    const token = u.searchParams.get('token') || req.headers['x-auth-token'];
    const phone = phoneByToken(token);
    if (!phone) return json(res, 401, { ok: false, error: '请先登录' });
    lastSeen.set(phone, Date.now());
    const entry = getFriendEntry(phone);
    const scores = loadScores();
    const resolveUsers = (phones) => phones.map((ph) => {
      const s = scores[ph] || { points: 0, w: 0, d: 0, l: 0 };
      return {
        phone: ph,
        maskedPhone: ph.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'),
        nickname: s.nickname || ph.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'),
        points: s.points || 0, w: s.w || 0, d: s.d || 0, l: s.l || 0,
        online: isOnline(ph),
      };
    });
    /* 查找发给我的待处理对战邀请 */
    const pendingChallenges = [];
    for (const [cid, ch] of pvpChallenges) {
      if (ch.to === phone && ch.status === 'pending') {
        pendingChallenges.push({ id: cid, from: ch.from, fromNickname: nicknameOf(ch.from), at: ch.at });
      }
      /* 检查我发出的挑战是否被接受（返回room给A方） */
      if (ch.from === phone && ch.status === 'accepted' && ch.room) {
        const room = pvpRooms.get(ch.room);
        if (room) {
          return json(res, 200, {
            ok: true,
            friends: resolveUsers(entry.friends),
            incoming: resolveUsers(entry.incoming),
            outgoing: resolveUsers(entry.outgoing),
            challenge: { status: 'accepted', room: roomView(room, phone) },
          });
        }
        pvpChallenges.delete(cid); /* 房间已不存在，清理 */
      }
    }
    return json(res, 200, {
      ok: true,
      friends: resolveUsers(entry.friends),
      incoming: resolveUsers(entry.incoming),
      outgoing: resolveUsers(entry.outgoing),
      challenges: pendingChallenges,
    });
  }

  /* 按昵称搜索用户 */
  if (p === '/api/friends/search' && req.method === 'POST') {
    try {
      const token = req.headers['x-auth-token'];
      const phone = phoneByToken(token);
      if (!phone) return json(res, 401, { ok: false, error: '请先登录' });
      lastSeen.set(phone, Date.now());
      const body = JSON.parse((await readBody(req)) || '{}');
      const q = String(body.nickname || '').trim().slice(0, 20);
      if (q.length < 1) return json(res, 200, { ok: true, results: [] });
      const scores = loadScores();
      const myEntry = getFriendEntry(phone);
      const results = [];
      for (const [ph, s] of Object.entries(scores)) {
        if (ph === phone) continue;
        const nick = s.nickname;
        if (!nick) continue;
        if (!nick.toLowerCase().includes(q.toLowerCase())) continue;
        const isFriend = myEntry.friends.includes(ph);
        const reqSent = myEntry.outgoing.includes(ph);
        results.push({
          phone: ph,
          maskedPhone: ph.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'),
          nickname: nick,
          points: s.points || 0, w: s.w || 0, l: s.l || 0,
          isFriend, reqSent,
        });
        if (results.length >= 20) break;
      }
      return json(res, 200, { ok: true, results });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* 发送好友请求 */
  if (p === '/api/friends/request' && req.method === 'POST') {
    try {
      const token = req.headers['x-auth-token'];
      const phone = phoneByToken(token);
      if (!phone) return json(res, 401, { ok: false, error: '请先登录' });
      lastSeen.set(phone, Date.now());
      const body = JSON.parse((await readBody(req)) || '{}');
      const target = String(body.phone || '').trim();
      if (!validPhone(target)) return json(res, 400, { ok: false, error: '无效的用户' });
      if (target === phone) return json(res, 400, { ok: false, error: '不能添加自己为好友' });
      const scores = loadScores();
      if (!scores[target]) return json(res, 400, { ok: false, error: '该用户尚未注册（对方需先登录并设置昵称）' });
      const data = loadFriends();
      if (!data[phone]) data[phone] = { friends: [], outgoing: [], incoming: [] };
      if (!data[target]) data[target] = { friends: [], outgoing: [], incoming: [] };
      if (data[phone].friends.includes(target)) return json(res, 400, { ok: false, error: '你们已经是好友了' });
      if (data[phone].outgoing.includes(target)) return json(res, 400, { ok: false, error: '已发送过请求，请等待对方确认' });
      if (data[phone].incoming.includes(target)) {
        /* 对方也向我发了请求 → 直接互加好友 */
        data[phone].incoming = data[phone].incoming.filter((p) => p !== target);
        data[target].outgoing = data[target].outgoing.filter((p) => p !== phone);
        data[phone].friends.push(target);
        data[target].friends.push(phone);
        saveFriends(data);
        return json(res, 200, { ok: true, mutual: true });
      }
      data[phone].outgoing.push(target);
      data[target].incoming.push(phone);
      saveFriends(data);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* 同意/拒绝好友请求 */
  if (p === '/api/friends/respond' && req.method === 'POST') {
    try {
      const token = req.headers['x-auth-token'];
      const phone = phoneByToken(token);
      if (!phone) return json(res, 401, { ok: false, error: '请先登录' });
      lastSeen.set(phone, Date.now());
      const body = JSON.parse((await readBody(req)) || '{}');
      const fromPhone = String(body.phone || '').trim();
      const accept = !!body.accept;
      const data = loadFriends();
      if (!data[phone]) return json(res, 400, { ok: false, error: '无待处理请求' });
      const idx = data[phone].incoming.indexOf(fromPhone);
      if (idx < 0) return json(res, 400, { ok: false, error: '请求不存在或已处理' });
      data[phone].incoming.splice(idx, 1);
      if (!data[fromPhone]) data[fromPhone] = { friends: [], outgoing: [], incoming: [] };
      const oi = data[fromPhone].outgoing.indexOf(phone);
      if (oi >= 0) data[fromPhone].outgoing.splice(oi, 1);
      if (accept) {
        if (!data[phone].friends.includes(fromPhone)) data[phone].friends.push(fromPhone);
        if (!data[fromPhone].friends.includes(phone)) data[fromPhone].friends.push(phone);
      }
      saveFriends(data);
      return json(res, 200, { ok: true, accepted: accept });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* 删除好友 */
  if (p === '/api/friends/remove' && req.method === 'POST') {
    try {
      const token = req.headers['x-auth-token'];
      const phone = phoneByToken(token);
      if (!phone) return json(res, 401, { ok: false, error: '请先登录' });
      lastSeen.set(phone, Date.now());
      const body = JSON.parse((await readBody(req)) || '{}');
      const target = String(body.phone || '').trim();
      const data = loadFriends();
      if (!data[phone]) return json(res, 200, { ok: true });
      data[phone].friends = data[phone].friends.filter((p) => p !== target);
      if (data[target]) data[target].friends = data[target].friends.filter((p) => p !== phone);
      saveFriends(data);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* 挑战好友对战 */
  if (p === '/api/friends/challenge' && req.method === 'POST') {
    try {
      const token = req.headers['x-auth-token'];
      const phone = phoneByToken(token);
      if (!phone) return json(res, 401, { ok: false, error: '请先登录' });
      lastSeen.set(phone, Date.now());
      const body = JSON.parse((await readBody(req)) || '{}');
      const target = String(body.phone || '').trim();
      if (!validPhone(target)) return json(res, 400, { ok: false, error: '无效的用户' });
      if (target === phone) return json(res, 400, { ok: false, error: '不能挑战自己' });
      const data = loadFriends();
      if (!data[phone] || !data[phone].friends.includes(target))
        return json(res, 400, { ok: false, error: '对方还不是你的好友' });
      /* 检查是否已有 pending 挑战 */
      for (const [cid, ch] of pvpChallenges) {
        if (ch.from === phone && ch.to === target && ch.status === 'pending')
          return json(res, 400, { ok: false, error: '已发出挑战，请等待对方响应' });
      }
      const cid = 'C' + (++challengeSeq);
      pvpChallenges.set(cid, { from: phone, to: target, status: 'pending', room: null, at: Date.now() });
      return json(res, 200, { ok: true, challengeId: cid });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* 接受/拒绝对战邀请 → 接受时创建 PvP 房间 */
  if (p === '/api/friends/challenge/respond' && req.method === 'POST') {
    try {
      const token = req.headers['x-auth-token'];
      const phone = phoneByToken(token);
      if (!phone) return json(res, 401, { ok: false, error: '请先登录' });
      lastSeen.set(phone, Date.now());
      const body = JSON.parse((await readBody(req)) || '{}');
      const cid = String(body.challengeId || '');
      const accept = !!body.accept;
      const ch = pvpChallenges.get(cid);
      if (!ch) return json(res, 400, { ok: false, error: '邀请不存在或已过期' });
      if (ch.to !== phone) return json(res, 403, { ok: false, error: '这不是发给你的邀请' });
      if (ch.status !== 'pending') return json(res, 400, { ok: false, error: '邀请已处理' });
      if (!accept) {
        ch.status = 'rejected';
        setTimeout(() => pvpChallenges.delete(cid), 5000);
        return json(res, 200, { ok: true, accepted: false });
      }
      /* 接受 → 创建 PvP 房间 */
      const users = loadUsers();
      const aToken = users[ch.from] && users[ch.from].token;
      const bToken = users[phone] && users[phone].token;
      if (!aToken || !bToken) return json(res, 400, { ok: false, error: '用户信息缺失，请双方重新登录' });
      const aEntry = { token: aToken, phone: ch.from };
      const bEntry = { token: bToken, phone: phone };
      const room = createRoom(aEntry, bEntry);
      ch.status = 'accepted';
      ch.room = room.id;
      setTimeout(() => pvpChallenges.delete(cid), 120000);
      return json(res, 200, { ok: true, accepted: true, room: roomView(room, phone) });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* ===== 大世界 ===== */

  /* 上报世界位置/形象（客户端约 1.2s 一次心跳；坐标服务端钳制，avatar 白名单校验） */
  if (p === '/api/world/presence' && req.method === 'POST') {
    try {
      const token = req.headers['x-auth-token'];
      const phone = phoneByToken(token);
      if (!phone) return json(res, 401, { ok: false, error: '请先登录' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const x = Math.max(0, Math.min(WORLD_W, Math.round(Number(body.x)) || 0));
      const y = Math.max(0, Math.min(WORLD_H, Math.round(Number(body.y)) || 0));
      let avatar = String(body.avatar || '').slice(0, 8);
      if (!WORLD_AVATARS.includes(avatar)) avatar = '🧑‍🎨';
      worldPresence.set(phone, { x, y, avatar, name: nicknameOf(phone), at: Date.now() });
      lastSeen.set(phone, Date.now());
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* 获取小镇里的在线玩家（排除自己；好友打标；15s 内心跳有效） */
  if (p === '/api/world/players' && req.method === 'GET') {
    const token = u.searchParams.get('token') || req.headers['x-auth-token'];
    const phone = phoneByToken(token);
    if (!phone) return json(res, 401, { ok: false, error: '请先登录' });
    lastSeen.set(phone, Date.now());
    const now = Date.now();
    const entry = getFriendEntry(phone);
    const players = [];
    for (const [ph, pos] of worldPresence) {
      if (ph === phone) continue;
      if (now - pos.at > 15000) continue;
      players.push({
        id: ph,
        name: pos.name || nicknameOf(ph),
        avatar: WORLD_AVATARS.includes(pos.avatar) ? pos.avatar : '🧑‍🎨',
        x: pos.x,
        y: pos.y,
        isFriend: entry.friends.includes(ph),
      });
    }
    return json(res, 200, { ok: true, players });
  }

  /* 定时清理过期的对战邀请已在 PvP 模块中注册 */

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log('==========================================');
  console.log('  记忆力挑战短信后端已启动');
  console.log('  模式: ' + (config.sms ? 'live（真实短信）' : 'sandbox（沙盒，不真实发短信）'));
  console.log('  地址: http://localhost:' + PORT);
  console.log('  健康检查: http://localhost:' + PORT + '/api/health');
  console.log('==========================================');
});
