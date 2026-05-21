const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetches a client's leads report.
// Without `overrideSince` the call advances the server cursor — use only
// from the scheduled job. With `overrideSince` it re-fetches a window
// without moving the cursor (safe to repeat).
// Transient failures retry with backoff; since the cursor only moves on a
// 200, giving up is recovered by the next scheduled run.
export async function fetchLeads(client, { overrideSince } = {}) {
  let url = `${client.apiBase}/api/report/${client.slug}/leads`;
  if (overrideSince) {
    url += `?override_since=${encodeURIComponent(overrideSince)}`;
  }
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'x-api-key': client.apiKey } });
      if (res.status === 200) return { ok: true, data: await res.json() };
      if (res.status === 401) return { ok: false, fatal: true, error: 'invalid API key (401)', url };
      if (res.status === 404) return { ok: false, fatal: true, error: 'unknown slug (404)', url };
      if (res.status === 400) return { ok: false, fatal: true, error: 'bad override_since (400)', url };
      lastError = `HTTP ${res.status}`;
      if (!TRANSIENT.has(res.status)) return { ok: false, error: lastError, url };
    } catch (err) {
      lastError = err.message;
    }
    if (attempt < 3) await sleep(2000 * 2 ** (attempt - 1));
  }
  return { ok: false, error: lastError, url };
}
