// Cutting a PTY stream at the boundaries xterm.js would cut it.
//
// A terminal's output is not text. It is text interleaved with escape sequences that move the
// cursor, erase cells, and switch screens. Classic typewriter mode prints the text one character
// at a time, so the stream has to be split into printable code points and atomic control
// sequences; a sequence split across two reads must never be mistaken for text.

/** How much of a stream is text and how much is instruction. */
export type Token = {
  text: string;
  /** True for one printable code point, false for a control sequence or control character. */
  printable: boolean;
};

const ESC = 0x1b;

/** Index just past the escape sequence at `start`, or −1 when the chunk ends inside it. */
export function sequenceEnd(data: string, start: number): number {
  if (start + 1 >= data.length) {
    return -1;
  }
  const next = data.charCodeAt(start + 1);
  // CSI: ESC [ parameter bytes, intermediate bytes, one final byte.
  if (next === 0x5b) {
    let i = start + 2;
    while (i < data.length) {
      const code = data.charCodeAt(i);
      if (code >= 0x40 && code <= 0x7e) {
        return i + 1;
      }
      if (code < 0x20) {
        // A control character inside a sequence: stop before it and let the caller split there.
        return i;
      }
      i += 1;
    }
    return -1;
  }
  // OSC, DCS, PM, APC: terminated by BEL or ST (ESC \).
  if (next === 0x5d || next === 0x50 || next === 0x5e || next === 0x5f) {
    let i = start + 2;
    while (i < data.length) {
      if (data.charCodeAt(i) === 0x07) {
        return i + 1;
      }
      if (data.charCodeAt(i) === ESC && data.charCodeAt(i + 1) === 0x5c) {
        return i + 2;
      }
      i += 1;
    }
    return -1;
  }
  // Two-byte escapes (ESC 7, ESC =) and escapes with intermediates (ESC ( B).
  let i = start + 1;
  while (i < data.length && data.charCodeAt(i) >= 0x20 && data.charCodeAt(i) <= 0x2f) {
    i += 1;
  }
  if (i >= data.length) {
    return -1;
  }
  return i + 1;
}

/**
 * Splits whatever arrives from the PTY into tokens, carrying an incomplete escape sequence over
 * to the next read.
 */
export class Splitter {
  private carry = '';

  push(data: string): Token[] {
    const input = this.carry + data;
    this.carry = '';
    const tokens: Token[] = [];
    let i = 0;
    while (i < input.length) {
      const code = input.charCodeAt(i);
      if (code === ESC) {
        const end = sequenceEnd(input, i);
        if (end < 0) {
          this.carry = input.slice(i);
          break;
        }
        tokens.push({text: input.slice(i, end), printable: false});
        i = end;
        continue;
      }
      if (code < 0x20 || code === 0x7f) {
        tokens.push({text: input[i], printable: false});
        i += 1;
        continue;
      }
      const point = input.codePointAt(i) ?? 0;
      const width = point > 0xffff ? 2 : 1;
      tokens.push({text: input.slice(i, i + width), printable: true});
      i += width;
    }
    return tokens;
  }

  /** An escape sequence still waiting for its final byte. */
  get pending() {
    return this.carry;
  }

  /** Hands the pending bytes over (used when the mode is switched off mid-sequence). */
  take(): string {
    const pending = this.carry;
    this.carry = '';
    return pending;
  }

  reset() {
    this.carry = '';
  }
}
