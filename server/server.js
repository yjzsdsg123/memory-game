/* ============================================================
 * 记忆力挑战 — 支付后端（零依赖，仅使用 Node.js 内置模块）
 *
 * 两种运行模式：
 *  - sandbox（默认）：本地模拟收银台，不发生真实扣款，全流程可跑通
 *  - 真实支付：在 config.json 填入 wechat / alipay 商户凭证后自动启用
 *
 * 接口：
 *  POST /api/pay/create            创建订单（body: { pkgId, method }）
 *  GET  /api/pay/query?orderNo=    查询订单状态（前端轮询）
 *  POST /api/pay/sandbox/complete  沙盒：模拟支付成功（仅 sandbox 模式）
 *  POST /api/pay/notify/wechat     微信支付 v3 回调（验签 + AES-GCM 解密）
 *  POST /api/pay/notify/alipay     支付宝回调（RSA2 验签）
 *  GET  /cashier?orderNo=          沙盒模拟收银台页面
 *  GET  /api/health                健康检查
 * ============================================================ */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_PATH = path.join(DATA_DIR, 'orders.json');

/* config.json 缺失时自动生成沙盒默认配置（真实密钥文件已被 .gitignore 忽略） */
if (!fs.existsSync(CONFIG_PATH)) {
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ mode: 'sandbox', port: 8080, publicBase: 'http://localhost:8080', wechat: null, alipay: null }, null, 2)
  );
  console.log('未找到 config.json，已自动生成沙盒配置');
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const PORT = config.port || 8080;
const SANDBOX = config.mode !== 'live';

/* 充值套餐，必须与前端 app.js 的 RECHARGE_PACKAGES 保持一致 */
const PACKAGES = [
  { id: 'p1', coins: 100, price: 6, bonus: 0 },
  { id: 'p2', coins: 200, price: 12, bonus: 20 },
  { id: 'p3', coins: 500, price: 30, bonus: 100 },
  { id: 'p4', coins: 1200, price: 68, bonus: 300 },
];

/* ---------------- 订单存储（JSON 文件，低并发足够） ---------------- */
function loadOrders() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveOrders(orders) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ORDERS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
  fs.renameSync(tmp, ORDERS_PATH);
}

function genOrderNo() {
  return 'M' + Date.now() + crypto.randomBytes(4).toString('hex');
}

/* 订单标记为已支付（幂等：重复回调安全） */
function markPaid(orderNo) {
  const orders = loadOrders();
  const o = orders[orderNo];
  if (!o) return false;
  if (o.status !== 'PAID') {
    o.status = 'PAID';
    o.paidAt = new Date().toISOString();
    saveOrders(orders);
  }
  return true;
}

/* ---------------- HTTP 工具 ---------------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

/* ---------------- 微信支付 v3（Native 扫码） ---------------- */
function wechatSign(method, urlPath, body, cfg) {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  const signStr = `${method}\n${urlPath}\n${ts}\n${nonce}\n${body}\n`;
  const sig = crypto
    .sign('RSA-SHA256', Buffer.from(signStr), crypto.createPrivateKey(cfg.privateKey))
    .toString('base64');
  return `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchid}",nonce_str="${nonce}",timestamp="${ts}",serial_no="${cfg.serialNo}",signature="${sig}"`;
}

async function wechatCreate(order, cfg) {
  const urlPath = '/v3/pay/transactions/native';
  const body = JSON.stringify({
    appid: cfg.appid,
    mchid: cfg.mchid,
    description: `记忆力挑战-金币充值 ${order.coins} 金币`,
    out_trade_no: order.orderNo,
    notify_url: cfg.notifyUrl.replace(/\/$/, '') + '/api/pay/notify/wechat',
    amount: { total: Math.round(order.price * 100), currency: 'CNY' },
  });
  const r = await fetch('https://api.mch.weixin.qq.com' + urlPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: wechatSign('POST', urlPath, body, cfg),
    },
    body,
  });
  const j = await r.json();
  if (!j.code_url) throw new Error('微信下单失败: ' + JSON.stringify(j));
  return j.code_url;
}

/* 微信 v3 回调：平台公钥验签 + APIv3 密钥 AES-256-GCM 解密 */
function wechatHandleNotify(rawBody, headers, cfg) {
  const ts = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const sig = headers['wechatpay-signature'];
  const signStr = `${ts}\n${nonce}\n${rawBody}\n`;
  const verifed = crypto.verify(
    'RSA-SHA256',
    Buffer.from(signStr),
    crypto.createPublicKey(cfg.payPublicKey),
    Buffer.from(sig, 'base64')
  );
  if (!verifed) throw new Error('微信回调验签失败');

  const evt = JSON.parse(rawBody);
  const res = evt.resource;
  const key = Buffer.from(cfg.apiV3Key, 'utf8');
  const cipherBuf = Buffer.from(res.ciphertext, 'base64');
  const authTag = cipherBuf.subarray(cipherBuf.length - 16);
  const data = cipherBuf.subarray(0, cipherBuf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(res.nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  if (res.associated_data) decipher.setAAD(Buffer.from(res.associated_data, 'utf8'));
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  const pay = JSON.parse(decrypted);
  return pay.out_trade_no;
}

/* ---------------- 支付宝（当面付 precreate 扫码） ---------------- */
function alipaySignParams(params, privateKey) {
  const str = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => k + '=' + params[k])
    .join('&');
  return crypto.sign('RSA-SHA256', Buffer.from(str, 'utf8'), crypto.createPrivateKey(privateKey)).toString('base64');
}

async function alipayCreate(order, cfg) {
  const params = {
    app_id: cfg.appId,
    method: 'alipay.trade.precreate',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    version: '1.0',
    notify_url: cfg.notifyUrl.replace(/\/$/, '') + '/api/pay/notify/alipay',
    biz_content: JSON.stringify({
      out_trade_no: order.orderNo,
      total_amount: order.price.toFixed(2),
      subject: `记忆力挑战-金币充值 ${order.coins} 金币`,
    }),
  };
  params.sign = alipaySignParams(params, cfg.privateKey);
  const r = await fetch('https://openapi.alipay.com/gateway.do', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params).toString(),
  });
  const j = await r.json();
  const resp = j.alipay_trade_precreate_response;
  if (!resp || resp.code !== '10000') throw new Error('支付宝下单失败: ' + JSON.stringify(resp));
  return resp.qr_code;
}

function alipayVerifyNotify(params, cfg) {
  const sign = params.sign;
  if (!sign) return false;
  const str = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k])
    .sort()
    .map((k) => k + '=' + params[k])
    .join('&');
  return crypto.verify(
    'RSA-SHA256',
    Buffer.from(str, 'utf8'),
    crypto.createPublicKey(cfg.publicKey),
    Buffer.from(sign, 'base64')
  );
}

/* ---------------- 沙盒模拟收银台页面 ---------------- */
function cashierHtml(orderNo, order) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>模拟收银台 - 支付 ¥${order.price}</title>
<style>
 body{font-family:'PingFang SC','Microsoft YaHei',sans-serif;background:#f3f2f8;margin:0;padding:24px;display:flex;justify-content:center}
 .box{background:#fff;border-radius:16px;padding:28px 24px;max-width:360px;width:100%;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.1)}
 h2{margin:0 0 6px;font-size:18px} .amt{font-size:40px;font-weight:800;color:#dc2626;margin:14px 0}
 .tag{font-size:12px;color:#999;margin-bottom:20px}
 button{width:100%;padding:14px;border:none;border-radius:11px;font-size:16px;font-weight:700;cursor:pointer;margin-top:10px}
 .ok{background:#07c160;color:#fff} .back{background:#eee;color:#555}
 .done{font-size:50px;margin:10px 0}
</style></head><body><div class="box">
 <h2>🧠 记忆力挑战</h2>
 <div class="tag">订单号 ${orderNo} · 沙盒模拟收银台（不真实扣款）</div>
 <div class="amt">¥${order.price}</div>
 <div>充值 ${order.coins} 金币${order.bonus ? '（赠送 ' + order.bonus + '）' : ''}</div>
 <div id="before">
   <button class="ok" onclick="pay()">✅ 模拟支付成功</button>
   <button class="back" onclick="window.close()">取消支付</button>
 </div>
 <div id="after" style="display:none">
   <div class="done">✅</div>
   <h2>支付成功</h2>
   <p style="color:#666;font-size:13px">金币已到账，请返回游戏页面查看</p>
 </div>
</div>
<script>
async function pay(){
  const r = await fetch('/api/pay/sandbox/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderNo:'${orderNo}'})});
  const j = await r.json();
  if(j.ok){ document.getElementById('before').style.display='none'; document.getElementById('after').style.display='block'; }
  else alert('操作失败: ' + (j.error||''));
}
</script></body></html>`;
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
    return json(res, 200, { ok: true, mode: SANDBOX ? 'sandbox' : 'live', wechat: !!config.wechat, alipay: !!config.alipay });
  }

  /* 创建订单 */
  if (p === '/api/pay/create' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const pkg = PACKAGES.find((x) => x.id === body.pkgId);
      if (!pkg) return json(res, 400, { ok: false, error: '套餐不存在' });
      const method = body.method === 'alipay' ? 'alipay' : 'wechat';
      const orderNo = genOrderNo();
      const orders = loadOrders();
      orders[orderNo] = {
        orderNo,
        pkgId: pkg.id,
        coins: pkg.coins + (pkg.bonus || 0),
        price: pkg.price,
        method,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };
      saveOrders(orders);

      /* 沙盒：返回模拟收银台地址 */
      if (SANDBOX) {
        const base = config.publicBase || `http://localhost:${PORT}`;
        return json(res, 200, {
          ok: true,
          payMode: 'sandbox',
          orderNo,
          coins: orders[orderNo].coins,
          cashierUrl: `${base}/cashier?orderNo=${orderNo}`,
        });
      }

      /* 真实模式：调用对应支付平台下单 */
      const payCfg = config[method];
      if (!payCfg) return json(res, 400, { ok: false, error: '该支付方式未配置' });
      let codeUrl;
      if (method === 'wechat') codeUrl = await wechatCreate(orders[orderNo], payCfg);
      else codeUrl = await alipayCreate(orders[orderNo], payCfg);
      return json(res, 200, { ok: true, payMode: method, orderNo, coins: orders[orderNo].coins, codeUrl });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* 查询订单 */
  if (p === '/api/pay/query' && req.method === 'GET') {
    const orderNo = u.searchParams.get('orderNo');
    const o = loadOrders()[orderNo];
    if (!o) return json(res, 404, { ok: false, error: '订单不存在' });
    return json(res, 200, { ok: true, status: o.status, coins: o.coins, orderNo });
  }

  /* 沙盒：模拟支付成功 */
  if (p === '/api/pay/sandbox/complete' && req.method === 'POST') {
    if (!SANDBOX) return json(res, 403, { ok: false, error: '沙盒接口未启用' });
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!body.orderNo || !markPaid(body.orderNo)) return json(res, 404, { ok: false, error: '订单不存在' });
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  /* 微信回调 */
  if (p === '/api/pay/notify/wechat' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const orderNo = wechatHandleNotify(raw, req.headers, config.wechat);
      markPaid(orderNo);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ code: 'SUCCESS', message: '成功' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ code: 'FAIL', message: e.message }));
    }
  }

  /* 支付宝回调（异步通知 form 表单 + GET 同步跳转） */
  if (p === '/api/pay/notify/alipay' && (req.method === 'POST' || req.method === 'GET')) {
    try {
      const params = Object.fromEntries(u.searchParams.entries());
      let bodyParams = params;
      if (req.method === 'POST') {
        const raw = await readBody(req);
        bodyParams = Object.fromEntries(new URLSearchParams(raw).entries());
      }
      if (alipayVerifyNotify(bodyParams, config.alipay) && bodyParams.trade_status === 'TRADE_SUCCESS') {
        markPaid(bodyParams.out_trade_no);
        return res.end('success');
      }
      return res.end('fail');
    } catch (e) {
      return res.end('fail');
    }
  }

  /* 沙盒收银台 */
  if (p === '/cashier' && req.method === 'GET') {
    const orderNo = u.searchParams.get('orderNo');
    const o = loadOrders()[orderNo];
    if (!o) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('订单不存在');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(cashierHtml(orderNo, o));
  }

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log('==========================================');
  console.log('  记忆力挑战支付后端已启动');
  console.log('  模式: ' + (SANDBOX ? 'sandbox（模拟支付，不扣款）' : 'live（真实支付）'));
  console.log('  地址: http://localhost:' + PORT);
  console.log('  健康检查: http://localhost:' + PORT + '/api/health');
  console.log('==========================================');
});
