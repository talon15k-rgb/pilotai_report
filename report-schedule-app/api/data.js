// GET /api/data → { reports: [...], events: [...] }
const { COLLECTIONS, KEY_PREFIX, redis, checkAccess, send, fail } = require('./_store');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'method' });
  if (!checkAccess(req, res)) return;
  try {
    const out = {};
    for (const col of COLLECTIONS) {
      const flat = (await redis(['HGETALL', KEY_PREFIX + col])) || [];
      const items = [];
      for (let i = 1; i < flat.length; i += 2) {
        try { items.push(JSON.parse(flat[i])); } catch { /* 깨진 항목은 건너뜀 */ }
      }
      out[col] = items;
    }
    send(res, 200, out);
  } catch (e) { fail(res, e); }
};
