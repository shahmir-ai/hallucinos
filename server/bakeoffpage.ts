import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SPEC §12.6 / interface I8 — `/bakeoff` is a landing page, not a boot.
 *
 * It lists the keyed engines with their price and whatever the last bake-off
 * report measured, and boots only when a Boot button is clicked
 * (`/bakeoff/run?engine=<id>`, which is the old auto-boot behaviour with the HUD).
 * This is the ONE route allowed to render our own markup: everything else the
 * visitor ever sees is the model's.
 */

export interface EngineRow {
  id: string;
  label: string;
  model: string;
  usd_in: number;
  usd_out: number;
  notes?: string | null;
}

export interface Measured {
  tok_per_s?: string;
  first_paint?: string;
  desktop?: string;
  usd_each?: string;
}

/** The highest-numbered reviews/BAKEOFF-<n>.md, or null. */
export function latestBakeoffReport(dir: string): string | null {
  let best: { n: number; file: string } | null = null;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const f of names) {
    const m = /^BAKEOFF-(\d+)(?:[-.].*)?\.md$/i.exec(f);
    if (!m) continue;
    const n = Number(m[1]);
    if (!best || n > best.n) best = { n, file: resolve(dir, f) };
  }
  return best ? best.file : null;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Pull per-engine numbers out of a report's markdown tables. The report is
 * written for humans, so this is deliberately forgiving: any table whose header
 * names a column we recognise contributes, and anything unparsed is simply not
 * shown.
 */
export function parseBakeoffSpeeds(md: string): Record<string, Measured> {
  const out: Record<string, Measured> = {};
  const lines = md.split('\n');
  let header: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) {
      header = null;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!cells.length) continue;
    if (/^:?-{2,}:?$/.test(norm(cells[0]))) continue; // the |---|---| separator
    const next = (lines[i + 1] || '').trim();
    if (next.startsWith('|') && /^\|[\s:|-]+\|$/.test(next)) {
      header = cells.map(norm);
      continue;
    }
    if (!header) continue;
    const idm = /^`([a-z0-9_.:-]+)`$/i.exec(cells[0]);
    if (!idm) continue;
    const id = idm[1];
    const row: Measured = out[id] || {};
    for (let c = 1; c < cells.length && c < header.length; c++) {
      const h = header[c];
      const v = cells[c].replace(/\*\*/g, '').trim();
      if (!v || v === '—' || v === '-') continue;
      if (h.includes('tok/s') && !row.tok_per_s) row.tok_per_s = v;
      else if (h.includes('first paint') && !row.first_paint) row.first_paint = v;
      else if (h.includes('desktop live') && !row.desktop) row.desktop = v;
      else if (/\$\s*\/\s*desktop|\$\/desktop/.test(h) && !row.usd_each) row.usd_each = v;
    }
    if (Object.keys(row).length) out[id] = row;
  }
  return out;
}

export function measuredFor(reviewsDir: string): { speeds: Record<string, Measured>; source: string | null } {
  const file = latestBakeoffReport(reviewsDir);
  if (!file) return { speeds: {}, source: null };
  try {
    return { speeds: parseBakeoffSpeeds(readFileSync(file, 'utf8')), source: file.split('/').pop() || null };
  } catch {
    return { speeds: {}, source: null };
  }
}

const esc = (s: unknown) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function bakeoffLanding(engines: EngineRow[], speeds: Record<string, Measured>, source: string | null, defaultEngine: string): string {
  const rows = engines
    .map((e) => {
      const m = speeds[e.id] || {};
      const cell = (v?: string) => (v ? esc(v) : '<span class="dim">not measured</span>');
      return `<tr${e.id === defaultEngine ? ' class="dflt"' : ''}>
  <td><div class="name">${esc(e.label)}${e.id === defaultEngine ? ' <span class="tag">default</span>' : ''}</div>
      <div class="id">${esc(e.id)} · ${esc(e.model)}</div></td>
  <td class="num">${cell(m.tok_per_s)}</td>
  <td class="num">${cell(m.first_paint)}</td>
  <td class="num">${cell(m.desktop)}</td>
  <td class="num">$${esc(e.usd_in)} / $${esc(e.usd_out)}<div class="id">per 1M in / out</div></td>
  <td><a class="boot" href="/bakeoff/run?engine=${encodeURIComponent(e.id)}">Boot</a></td>
</tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>hallucinos — bake-off</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;padding:24px 16px 48px;background:#0b0b0e;color:#e7e7ea;
       font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  main{max-width:900px;margin:0 auto}
  h1{font-size:18px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 4px}
  p.sub{margin:0 0 20px;color:#8b8b96}
  .wrap{overflow-x:auto;border:1px solid #26262e;border-radius:8px}
  table{border-collapse:collapse;width:100%;min-width:640px}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #1e1e25;vertical-align:top}
  th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8b8b96;font-weight:400;white-space:nowrap}
  tr:last-child td{border-bottom:0}
  tr.dflt{background:#121219}
  .name{font-weight:600}
  .id,.dim{color:#70707c;font-size:12px}
  .tag{font-size:10px;border:1px solid #3a3a46;border-radius:99px;padding:1px 6px;color:#9a9aa6;letter-spacing:.06em}
  td.num{white-space:nowrap}
  a.boot{display:inline-block;padding:7px 16px;border:1px solid #4a4a58;border-radius:6px;
         color:#e7e7ea;text-decoration:none;background:#1a1a22}
  a.boot:hover{background:#26263040;border-color:#6d6d80}
  footer{margin-top:18px;color:#70707c;font-size:12px}
  footer a{color:#9fd7ff}
  .empty{padding:20px;color:#8b8b96}
</style>
</head>
<body>
<main>
  <h1>hallucinos bake-off</h1>
  <p class="sub">Pick an engine and boot it. Numbers are from ${source ? esc(source) : 'no bake-off report yet'}; the HUD on the booted page is live.</p>
  ${
    engines.length
      ? `<div class="wrap"><table>
<thead><tr><th>engine</th><th>tok/s</th><th>boot paint</th><th>desktop live</th><th>price</th><th></th></tr></thead>
<tbody>
${rows}
</tbody></table></div>`
      : '<div class="wrap"><p class="empty">No engines are keyed. Set a provider key in <code>.env</code> and reload.</p></div>'
  }
  <footer><a href="/">/</a> boots the default engine with no HUD · <a href="/api/stats">/api/stats</a> · <a href="/api/engines">/api/engines</a></footer>
</main>
</body>
</html>
`;
}
