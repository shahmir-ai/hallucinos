import { describe, it, expect } from 'vitest';
import { HtmlStreamFilter, stripFences, extractJson } from '../server/htmlstream.js';

function run(chunks: string[]): string {
  const f = new HtmlStreamFilter();
  let out = '';
  for (const c of chunks) out += f.push(c);
  out += f.end();
  return out;
}

describe('html stream filter', () => {
  it('drops prose and fences before the document', () => {
    expect(run(['Sure! Here is the page:\n```html\n<!doctype html><p>hi</p>'])).toBe('<!doctype html><p>hi</p>');
  });

  it('works when the document start is split across chunks', () => {
    expect(run(['prose ', '<!doc', 'type html><h', 'tml><body>x'])).toBe('<!doctype html><html><body>x');
  });

  it('accepts <html> without a doctype', () => {
    expect(run(['```\n', '<html><body>y</body></html>'])).toBe('<html><body>y</body></html>');
  });

  it('strips a closing fence even when the backticks straddle chunks', () => {
    expect(run(['<!doctype html><p>a</p>', '`', '``'])).toBe('<!doctype html><p>a</p>');
  });

  it('emits a fragment de-fenced when the model never opened a document', () => {
    expect(run(['```html\n<p>fragment</p>\n```'])).toBe('\n<p>fragment</p>\n');
  });

  it('is case insensitive about the doctype', () => {
    expect(run(['<!DOCTYPE HTML><p>x</p>'])).toBe('<!DOCTYPE HTML><p>x</p>');
  });

  it('does not grow the buffer without bound while it waits', () => {
    const f = new HtmlStreamFilter();
    for (let i = 0; i < 50; i++) expect(f.push('x'.repeat(500))).toBe('');
    expect(f.push('<!doctype html>ok')).toBe('<!doctype html>ok');
  });
});

describe('json extraction', () => {
  it('pulls the object out of a fenced, chatty reply', () => {
    expect(extractJson('```json\n{"name":"X"}\n```')).toEqual({ name: 'X' });
  });
  it('throws when there is no object', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
  it('strips fences', () => {
    expect(stripFences('```html x ```')).toBe(' x ');
  });
});
