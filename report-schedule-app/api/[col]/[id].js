// PUT /api/{reports|events}/{id}  본문: 레코드 전체(JSON) → 저장(나중 저장 우선)
// DELETE /api/{reports|events}/{id} → 삭제
const { COLLECTIONS, ID_RE, MAX_BODY, KEY_PREFIX, redis, checkAccess, send, fail } = require('../_store');

module.exports = async (req, res) => {
  const { col, id } = req.query;
  if (!COLLECTIONS.includes(col) || !ID_RE.test(String(id))) return send(res, 404, { error: 'not_found' });
  if (!checkAccess(req, res)) return;
  try {
    if (req.method === 'PUT') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.id !== id) {
        return send(res, 400, { error: 'invalid_body' });
      }
      const json = JSON.stringify(body);
      if (Buffer.byteLength(json) > MAX_BODY) return send(res, 413, { error: 'too_large' });
      await redis(['HSET', KEY_PREFIX + col, id, json]);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      await redis(['HDEL', KEY_PREFIX + col, id]);
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'method' });
  } catch (e) { fail(res, e); }
};
