import { describe, it, expect } from 'vitest';
import { validateDesktop, validateApp, coerceIdentity, windowTemplate, stripSentinels, nextVersion } from '../kernel/contract.js';

const FULL = `<!doctype html><html><body>
<div data-os-desktop><button data-os-app="browser">b</button><button data-os-app="notes">n</button></div>
<div data-os-windows></div>
<div data-os-taskbar><span data-os-clock>12:00</span></div>
<template data-os-window><div><span data-os-title></span><div data-os-content></div><button data-os-close>x</button><div data-os-drag></div></div></template>
<template data-os-task><button><span data-os-title></span></button></template>
</body></html>`;

describe('desktop contract', () => {
  it('passes a complete desktop', () => {
    const r = validateDesktop(FULL, ['browser', 'notes']);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('names every missing top-level hook', () => {
    const r = validateDesktop('<html><body><div data-os-desktop></div></body></html>', []);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('[data-os-windows]');
    expect(r.missing).toContain('[data-os-taskbar]');
    expect(r.missing).toContain('template[data-os-window]');
    expect(r.missing).toContain('template[data-os-task]');
  });

  it('looks inside the window template, not just anywhere in the document', () => {
    const html = FULL.replace('<div data-os-content></div>', '');
    const r = validateDesktop(html, []);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['template[data-os-window] [data-os-content]']);
  });

  it('does not accept hooks that live outside the template', () => {
    const html = `<div data-os-desktop></div><div data-os-windows></div><div data-os-taskbar></div>
      <div data-os-title></div><div data-os-content></div><div data-os-close></div><div data-os-drag></div>
      <span data-os-clock></span>
      <template data-os-window><div></div></template><template data-os-task><b data-os-title></b></template>`;
    const r = validateDesktop(html, []);
    expect(r.missing.length).toBe(4);
  });

  it('requires one launcher per manifest app', () => {
    const r = validateDesktop(FULL, ['browser', 'notes', 'terminal']);
    expect(r.missing).toEqual(['[data-os-app="terminal"]']);
  });

  it('accepts launchers written with single quotes or no quotes', () => {
    const html = FULL.replace('data-os-app="notes"', "data-os-app='notes'");
    expect(validateDesktop(html, ['notes']).ok).toBe(true);
  });

  // SPEC §12.3 / I5: the clock needs no identity to evaluate, so it is required
  // on the server's side of the wire too — it used to be checked only when an
  // archetype was passed in, which meant the server reported contract_ok=true
  // for a desktop with no clock in it at all.
  it('requires a clock even when no archetype is known', () => {
    const r = validateDesktop(FULL.replace('<span data-os-clock>12:00</span>', ''), ['browser', 'notes']);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['[data-os-clock]']);
  });

  it('checks the archetype value only when it is told which one to expect', () => {
    expect(validateDesktop(FULL, ['browser', 'notes']).ok).toBe(true);
    expect(validateDesktop(FULL, ['browser', 'notes'], 'dock').missing).toEqual(['[data-os-archetype="dock"]']);
    const dock = FULL.replace('<body>', '<body data-os-archetype="dock">');
    expect(validateDesktop(dock, ['browser', 'notes'], 'dock').ok).toBe(true);
  });

  it('extracts the window template body', () => {
    expect(windowTemplate(FULL)).toContain('data-os-content');
    expect(windowTemplate('<div></div>')).toBeNull();
  });
});

describe('app contract', () => {
  it('only the browser has required hooks', () => {
    expect(validateApp('<p>anything</p>', 'notes').ok).toBe(true);
    expect(validateApp('<p>anything</p>', 'browser').missing).toEqual(['[data-os-page]', '[data-os-url]']);
    expect(validateApp('<div data-os-page></div><input data-os-url>', 'browser').ok).toBe(true);
  });
});

describe('identity', () => {
  it('fills every field the model forgot rather than failing the boot', () => {
    const id = coerceIdentity({ name: 'BUREAU-9' }, 'seedseed');
    expect(id.name).toBe('BUREAU-9');
    expect(id.palette_words.length).toBeGreaterThan(0);
    expect(id.boot_message).toBeTruthy();
  });
  it('survives garbage', () => {
    expect(coerceIdentity(null, 'abcd').name).toContain('UNNAMED');
    expect(coerceIdentity('nope', 'abcd').version).toBe('1.0');
  });
});

describe('validation reads markup, not text that happens to contain a selector', () => {
  const TELEMETRY = '\n<!--os-telemetry:{"kind":"desktop","contract_ok":false,"missing":["[data-os-taskbar]","[data-os-windows]"]}-->\n';

  it('the kernel\'s own telemetry sentinel cannot satisfy the contract', () => {
    const broken = FULL.replace('<div data-os-taskbar><span data-os-clock>12:00</span></div>', '') + TELEMETRY;
    const r = validateDesktop(broken, []);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('[data-os-taskbar]');
    expect(stripSentinels(TELEMETRY).indexOf('data-os-taskbar')).toBe(-1);
  });

  it('a stylesheet rule cannot satisfy the contract', () => {
    // exactly what prompts/system/desktop.md asks the model to write
    const css = '<style>[data-os-windows]{position:relative}[data-os-taskbar]{display:flex}</style>';
    const html = '<html><head>' + css + '</head><body><div data-os-desktop></div></body></html>';
    const r = validateDesktop(html, []);
    expect(r.missing).toContain('[data-os-windows]');
    expect(r.missing).toContain('[data-os-taskbar]');
  });

  it('a script string or an HTML comment cannot satisfy the contract', () => {
    const html =
      '<body><div data-os-desktop></div>' +
      '<!-- remember to add [data-os-windows] and a data-os-taskbar -->' +
      '<script>var s = \'<div data-os-taskbar></div>\'; var t = "data-os-windows";</script></body>';
    const r = validateDesktop(html, []);
    expect(r.missing).toContain('[data-os-windows]');
    expect(r.missing).toContain('[data-os-taskbar]');
  });

  it('a browser app missing its hooks is not rescued by the sentinel that names them', () => {
    const doc = '<html><body><nav>chrome only</nav></body></html>' +
      '<!--os-telemetry:{"missing":["[data-os-page]","[data-os-url]"]}-->';
    expect(validateApp(doc, 'browser').missing).toEqual(['[data-os-page]', '[data-os-url]']);
  });

  it('data-os-windows is not read as data-os-window', () => {
    const html = FULL.replace('<template data-os-window>', '<template data-os-windows>');
    expect(validateDesktop(html, []).missing).toContain('template[data-os-window]');
  });

  it('a launcher id inside a JSON string does not count as a launcher', () => {
    const html = FULL + '<script>var m = {"data-os-app":"terminal"};</script>';
    expect(validateDesktop(html, ['terminal']).missing).toEqual(['[data-os-app="terminal"]']);
  });
});

describe('version lineage', () => {
  it('bumps the last number it can find', () => {
    expect(nextVersion('4.2')).toBe('4.3');
    expect(nextVersion('88.1.3-rc')).toBe('88.1.4-rc');
    expect(nextVersion('9 (Wintergreen)')).toBe('10 (Wintergreen)');
    expect(nextVersion('Series III')).toBe('Series III II');
  });
});
