// Vercel 배포용 공통 모듈: 접속 코드 확인 + Upstash Redis(REST) 저장소
// 로컬 실행판(server.ps1)은 이 파일을 쓰지 않습니다.
const crypto = require('crypto');

const COLLECTIONS = ['reports', 'events'];
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const MAX_BODY = 256 * 1024;
const KEY_PREFIX = 'rsm:';

// Upstash 연동은 접두어를 붙여 환경변수를 넣을 수 있음 (예: STORAGE_KV_REST_API_URL)
// → 기본 이름을 먼저 보고, 없으면 같은 접두어의 URL/TOKEN 쌍을 찾음
const PAIRS = [
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['REDIS_REST_API_URL', 'REDIS_REST_API_TOKEN'],
];
function redisConfig() {
  const env = process.env;
  for (const [u, t] of PAIRS) {
    if (env[u] && env[t]) return { url: env[u].replace(/\/+$/, ''), token: env[t] };
  }
  for (const key of Object.keys(env)) {
    for (const [u, t] of PAIRS) {
      if (key.endsWith('_' + u)) {
        const tokenKey = key.slice(0, -u.length) + t;
        if (env[key] && env[tokenKey]) return { url: env[key].replace(/\/+$/, ''), token: env[tokenKey] };
      }
    }
  }
  return null;
}
// 저장소 미연결 진단용: 관련 환경변수 "이름"만 (값은 절대 포함하지 않음)
function storageEnvNames() {
  return Object.keys(process.env).filter((k) => /KV|REDIS|UPSTASH/i.test(k)).sort();
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
  if (e && e.code === 'no_storage') return send(res, 503, { error: 'no_storage', envNames: storageEnvNames() });
  console.error(e);
  return send(res, 500, { error: 'server' });
}

module.exports = { COLLECTIONS, ID_RE, MAX_BODY, KEY_PREFIX, redis, checkAccess, send, fail };
