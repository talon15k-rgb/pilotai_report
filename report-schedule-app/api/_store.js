// Vercel 배포용 공통 모듈: 접속 코드 확인 + Upstash Redis(REST) 저장소
// 로컬 실행판(server.ps1)은 이 파일을 쓰지 않습니다.
const crypto = require('crypto');

const COLLECTIONS = ['reports', 'events'];
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const MAX_BODY = 256 * 1024;
const KEY_PREFIX = 'rsm:';

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

async function redis(command) {
  const cfg = redisConfig();
  if (!cfg) { const e = new Error('no_storage'); e.code = 'no_storage'; throw e; }
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error('redis: ' + (data.error || res.status));
  return data.result;
}

// ACCESS_CODE 환경변수가 있으면 X-Access-Code 헤더가 일치해야 통과
function checkAccess(req, res) {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return true;
  const given = String(req.headers['x-access-code'] || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (crypto.timingSafeEqual(a, b)) return true;
  send(res, 401, { error: 'access_code' });
  return false;
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function fail(res, e) {
  if (e && e.code === 'no_storage') return send(res, 503, { error: 'no_storage' });
  console.error(e);
  return send(res, 500, { error: 'server' });
}

module.exports = { COLLECTIONS, ID_RE, MAX_BODY, KEY_PREFIX, redis, checkAccess, send, fail };
