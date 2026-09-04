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
    return json(res, 200, { ok: true, phone });
  }

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
