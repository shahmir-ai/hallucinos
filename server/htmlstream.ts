import { tolerantJsonParse } from './identity.js';

/**
 * Streaming filter: drops code fences and any prose before the document start,
 * then passes everything through. Works across arbitrary chunk boundaries.
 */
const STARTS = ['<!doctype', '<html'];

export class HtmlStreamFilter {
  private buf = '';
  private started = false;
  private tail = '';

  /** Feed a chunk, get back whatever is safe to emit now. */
  push(chunk: string): string {
    if (!this.started) {
      this.buf += chunk;
      const low = this.buf.toLowerCase();
      let idx = -1;
      for (const s of STARTS) {
        const i = low.indexOf(s);
        if (i >= 0 && (idx < 0 || i < idx)) idx = i;
      }
      if (idx < 0) {
        // keep the buffer bounded: a model that rambles for 8k chars before the
        // document is a model that is not going to produce one.
        if (this.buf.length > 8192) this.buf = this.buf.slice(-4096);
        return '';
      }
      this.started = true;
      const rest = this.buf.slice(idx);
      this.buf = '';
      return this.emit(rest);
    }
    return this.emit(chunk);
  }

  /** Flush. If no document start was ever seen, emit the buffer de-fenced (a fragment still renders). */
  end(): string {
    if (!this.started) {
      const out = stripFences(this.buf);
      this.buf = '';
      this.started = true;
      return out;
    }
    // anything still held back can only be a stray backtick or two
    const out = stripFences(this.tail).replace(/`+$/, '');
    this.tail = '';
    return out;
  }

  private emit(s: string): string {
    let text = stripFences(this.tail + s);
    this.tail = '';
    // hold back a trailing partial fence so ``` never gets split across emits
    const m = /`{1,2}$/.exec(text);
    if (m) {
      this.tail = m[0];
      text = text.slice(0, text.length - m[0].length);
    }
    return text;
  }
}

export function stripFences(s: string): string {
  return s.replace(/```[a-zA-Z0-9_-]*/g, '');
}

/**
 * Pull the first JSON object out of a model response (identity kind).
 *
 * Delegates to the tolerant parser in identity.ts: a trailing comma, a smart
 * quote, a raw newline inside a tagline or a body that stopped mid-object each
 * used to cost a whole identity here too (BAKEOFF-2: UNNAMED/6BXG).
 */
export function extractJson(raw: string): unknown {
  return tolerantJsonParse(raw);
}
