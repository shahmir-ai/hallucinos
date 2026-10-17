/**
 * A stand-in for `omni-moderation-latest`, for the e2e suite only.
 *
 * SPEC §12.1 puts the remote moderation call BESIDE the generation, so the
 * interesting path — it flags after the stream has already started, the server
 * ends that stream with `<!--os-reroute-->` and the kernel has to throw the
 * document away and ask again — cannot be reached without a remote that answers
 * late. This is that remote. It is pointed at with MODERATION_ENDPOINT, which
 * exists for exactly this and is never set in production.
 *
 * It flags ONE thing: any input containing the magic word below. Everything
 * else comes back clean, so the rest of the suite is untouched.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8778);
const DELAY_MS = Number(process.env.FAKE_MOD_DELAY_MS || 250);
const MAGIC = process.env.FAKE_MOD_MAGIC || 'reroute-me';

createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    let inputs = [];
    try {
      const j = JSON.parse(body);
      inputs = Array.isArray(j?.input) ? j.input : [String(j?.input || '')];
    } catch {}
    const flagged = inputs.some((s) => String(s).toLowerCase().includes(MAGIC));
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ results: inputs.map(() => ({ categories: { sexual: flagged, 'sexual/minors': false } })) }));
    }, DELAY_MS);
  });
}).listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`fake moderation on http://127.0.0.1:${PORT} (flags "${MAGIC}" after ${DELAY_MS} ms)\n`);
});
