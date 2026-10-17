import type { GenTelemetry } from './gen.js';

/**
 * The bake-off HUD and engine picker (SPEC §7). The only non-hallucinated
 * visible UI, and they exist on `/bakeoff/run` only — never on `/`.
 *
 * Both live in one dock at the BOTTOM RIGHT. They used to sit at the top
 * corners, where the picker covered the boot document's own first lines —
 * `shots-final-v01/cerebras-oss120/01-boot.png` is a machine whose banner is
 * behind a `<select>`, i.e. the picker hid exactly the line a judge wants to
 * read (HANDOFF-3 issue 11, BAKEOFF-2 §8). A boot screen writes its name and
 * its first messages at the top left; nothing of ours goes there.
 *
 * `\`` (or `h`) collapses the whole dock, for a screenshot with no kernel
 * pixels in it at all.
 */
const DOCK_ID = 'os-bakeoff-dock';
const MONO = '11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace';
const PANEL =
  'background:rgba(0,0,0,.82);color:#d6ffd6;font:' + MONO + ';border:1px solid #2f4f2f;border-radius:4px;';

let dockKeys: ((e: KeyboardEvent) => void) | null = null;

/**
 * The dock every bake-off overlay goes into: fixed to the bottom-right corner,
 * stacked upwards, and collapsible with one key.
 */
export function dock(): HTMLElement {
  const existing = document.getElementById(DOCK_ID);
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = DOCK_ID;
  el.setAttribute('data-os-dock', '');
  el.style.cssText =
    'position:fixed;right:8px;bottom:8px;z-index:2147483600;display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-width:46ch';
  document.body.appendChild(el);

  const hint = document.createElement('div');
  hint.setAttribute('data-os-dock-hint', '');
  hint.style.cssText = PANEL + 'padding:2px 6px;cursor:pointer;opacity:.75';
  hint.textContent = '` hide';
  hint.addEventListener('click', () => toggleDock());
  el.appendChild(hint);

  if (!dockKeys) {
    dockKeys = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      // never steal the key from a field: the picker is a <select>, and the
      // desktop the model wrote may have inputs of its own
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key !== '`' && e.key !== '~' && e.key !== 'h' && e.key !== 'H') return;
      toggleDock();
    };
    window.addEventListener('keydown', dockKeys);
  }
  return el;
}

/**
 * Is this element part of the kernel's OWN bake-off chrome?
 *
 * KERNEL-6. The desktop's click delegation used to ask
 * `el.closest('[data-os-dock]')` and skip what it found, so that a click on the
 * HUD or the engine picker was not read as a launcher click. But
 * `data-os-dock` is a plain attribute in a document the MODEL writes, and SPEC
 * §12.3's `dock` archetype is literally "a dock along the bottom holding the
 * launchers as icons" — a generated Mac-shaped desktop that names its own dock
 * `data-os-dock` therefore made every launcher in it unclickable, silently.
 * That is HANDOFF-5 issue 1.
 *
 * Identity, not a selector: the kernel's dock is the one element it created,
 * and nothing a model writes can be it.
 */
export function isKernelChrome(el: Element | null | undefined): boolean {
  if (!el) return false;
  const dock = document.getElementById(DOCK_ID);
  return !!dock && (dock === el || dock.contains(el));
}

/** Collapse or restore the dock. Collapsed leaves one line saying how to get it back. */
export function toggleDock(force?: boolean): void {
  const el = document.getElementById(DOCK_ID);
  if (!el) return;
  const collapsed = force === undefined ? el.getAttribute('data-os-dock-collapsed') === null : force;
  const hint = el.querySelector('[data-os-dock-hint]') as HTMLElement | null;
  for (const child of Array.from(el.children)) {
    if (child === hint) continue;
    (child as HTMLElement).style.display = collapsed ? 'none' : '';
  }
  if (collapsed) el.setAttribute('data-os-dock-collapsed', '');
  else el.removeAttribute('data-os-dock-collapsed');
  if (hint) hint.textContent = collapsed ? '` show' : '` hide';
}

/** Remove the dock and its key handler when nothing is left in it. */
function tidyDock(): void {
  const el = document.getElementById(DOCK_ID);
  if (!el) return;
  const live = Array.from(el.children).filter((c) => !c.hasAttribute('data-os-dock-hint'));
  if (live.length) return;
  el.remove();
  if (dockKeys) window.removeEventListener('keydown', dockKeys);
  dockKeys = null;
}

export class Hud {
  private el: HTMLElement;
  private sessionUsd = 0;
  private lines: string[] = [];
  /** SEAM H3: when the boot frame first had a box in it, or that it never did. */
  private inkLine = '';

  constructor() {
    const el = document.createElement('div');
    el.setAttribute('data-os-hud', '');
    el.style.cssText = PANEL + 'padding:8px 10px;white-space:pre-wrap;pointer-events:none;text-align:left';
    this.el = el;
    const d = dock();
    // above the hint line, below the picker: the picker is the thing you click
    d.insertBefore(el, d.firstChild);
    if (d.getAttribute('data-os-dock-collapsed') !== null) el.style.display = 'none';
    this.paint('booting');
  }

  private paint(extra: string) {
    this.el.textContent = [...this.lines, this.inkLine, extra, 'session $ ' + this.sessionUsd.toFixed(5)]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * SEAM H3. The number a judge actually wants for the first two seconds of the
   * product: not "the first chunk arrived" but "the boot frame has something in
   * it" — and, when it never did, that fact, which is what HANDOFF-4's two
   * instruments disagreed about.
   */
  ink(what: string, ms: number | null) {
    this.inkLine = 'ink      ' + what + ' ' + (ms === null ? 'NONE' : ms + ' ms');
    this.paint('');
  }

  record(t: GenTelemetry | null, note?: string) {
    if (!t) {
      // a note never wipes the numbers: the HUD is the bake-off's independent
      // witness and it has to stay readable while the kernel narrates
      if (note) this.paint(note);
      return;
    }
    this.sessionUsd += t.usd || 0;
    const breakdown = [
      t.moderation_ms != null ? 'mod ' + t.moderation_ms : '',
      t.server_ms != null ? 'srv ' + t.server_ms : '',
      t.provider_ttfb_ms != null ? 'prov ' + t.provider_ttfb_ms : '',
    ]
      .filter(Boolean)
      .join(' / ');
    this.lines = [
      'engine   ' + t.engine,
      'last     ' + t.kind,
      'ttfb     ' + t.ttfb_ms + ' ms',
      ...(breakdown ? ['split    ' + breakdown] : []),
      'tok/s    ' + t.tok_per_s,
      'tokens   ' + t.tokens_in + ' in / ' + t.tokens_out + ' out',
      'gen $    ' + (t.usd || 0).toFixed(5),
      'contract ' + (t.contract_ok === null ? 'n/a' : t.contract_ok ? 'ok' : 'MISS ' + (t.missing || []).join(' ')),
    ];
    /**
     * SEAM H2. A hedged generation ran two engines and paid for both; `engine`
     * above is the routed name that was asked for (`auto`), so without this
     * line the HUD cannot say which engine the document on screen came from —
     * the one number the hedge exists to be judged on.
     */
    if (t.hedged) {
      const loser = [
        t.loser ? t.loser : '',
        t.loser_aborted_ms != null ? '@' + t.loser_aborted_ms + 'ms' : '',
        t.loser_tokens_in != null ? t.loser_tokens_in + ' in billed' : '',
      ]
        .filter(Boolean)
        .join(' ');
      this.lines.push('hedge    won by ' + (t.winner || '?') + (loser ? ' / lost ' + loser : ''));
    } else if (t.winner && t.winner !== t.engine) {
      this.lines.push('routed   ' + t.winner);
    }
    this.paint(note || '');
  }

  note(s: string) {
    this.paint(s);
  }

  destroy() {
    this.el.remove();
    tidyDock();
  }
}

/** Engine picker — boot screen only, /bakeoff/run only, also settable with ?engine=. */
export function enginePicker(
  engines: { id: string; label: string }[],
  current: string,
  onPick: (id: string) => void
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.setAttribute('data-os-picker', '');
  wrap.style.cssText = PANEL + 'padding:6px 8px';
  const sel = document.createElement('select');
  sel.setAttribute('data-os-engine-select', '');
  sel.style.cssText = 'font:inherit;background:#0b0b0b;color:#d6ffd6;border:1px solid #2f4f2f;border-radius:3px;padding:2px 4px';
  for (const e of engines) {
    const o = document.createElement('option');
    o.value = e.id;
    o.textContent = e.label || e.id;
    if (e.id === current) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onPick(sel.value));
  wrap.appendChild(sel);
  const d = dock();
  d.insertBefore(wrap, d.firstChild);
  if (d.getAttribute('data-os-dock-collapsed') !== null) wrap.style.display = 'none';
  return wrap;
}

/** Take an overlay out of the dock (the picker is boot-screen only). */
export function undock(el: HTMLElement | null): void {
  el?.remove();
  tidyDock();
}
