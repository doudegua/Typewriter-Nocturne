import test from 'ava';

import {on} from '../../lib/nocturne/bus';
import {PacedWriter} from '../../lib/nocturne/typewriter/pacer';

type Cell = {chars: string; width: number};

const fakeCell = (cell: Cell) => ({
  getChars: () => cell.chars,
  getWidth: () => cell.width,
  isFgPalette: () => true,
  getFgColor: () => 0,
  isFgRGB: () => false,
  isBold: () => 0,
  isItalic: () => 0
});

/** A terminal just real enough for the pacer: a cursor, a line, a write and two events. */
class FakeTerminal {
  cols = 20;
  rows = 5;
  written: string[] = [];
  lines = new Map<number, Cell[]>();
  cursor = {x: 0, y: 0};
  base = 0;
  alternate = false;
  private dataHandlers: ((data: string) => void)[] = [];
  private resizeHandlers: (() => void)[] = [];

  get buffer() {
    return {
      active: {
        type: this.alternate ? 'alternate' : 'normal',
        cursorX: this.cursor.x,
        cursorY: this.cursor.y,
        baseY: this.base,
        getLine: (index: number) => {
          const cells = this.lines.get(index);
          return cells ? {getCell: (x: number) => fakeCell(cells[x] ?? {chars: '', width: 1})} : undefined;
        }
      }
    };
  }

  get element() {
    return {
      querySelector: () => ({getBoundingClientRect: () => ({width: 200, height: 100, left: 0, top: 0})})
    };
  }

  onData(handler: (data: string) => void) {
    this.dataHandlers.push(handler);
    return {dispose: () => (this.dataHandlers = this.dataHandlers.filter((item) => item !== handler))};
  }

  onResize(handler: () => void) {
    this.resizeHandlers.push(handler);
    return {dispose: () => (this.resizeHandlers = this.resizeHandlers.filter((item) => item !== handler))};
  }

  write(data: string, callback?: () => void) {
    this.written.push(data);
    for (const char of data) {
      if (char === '\r') {
        this.cursor.x = 0;
        continue;
      }
      if (char === '\n') {
        this.cursor.y += 1;
        continue;
      }
      const line = this.lines.get(this.base + this.cursor.y) ?? [];
      line[this.cursor.x] = {chars: char, width: 1};
      this.lines.set(this.base + this.cursor.y, line);
      this.cursor.x += 1;
    }
    callback?.();
  }

  /** A key pressed by the user. */
  key(data: string) {
    this.dataHandlers.forEach((handler) => handler(data));
  }

  resize() {
    this.resizeHandlers.forEach((handler) => handler());
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.serial('prints program output one character at a time', async (t) => {
  const term = new FakeTerminal();
  const prints: string[] = [];
  const off = on('print', (strike) => prints.push(strike.char));
  const writer = new PacedWriter('t1', term as never, () => ({enabled: true, cps: 1000}));

  writer.submit('abc');
  t.deepEqual(term.written, []);
  await wait(60);
  t.deepEqual(term.written, ['a', 'b', 'c']);
  t.deepEqual(prints, ['a', 'b', 'c']);
  off();
  writer.dispose();
});

test.serial('spaces advance the carriage without a strike', async (t) => {
  const term = new FakeTerminal();
  const prints: string[] = [];
  const off = on('print', (strike) => prints.push(strike.char));
  const writer = new PacedWriter('t1', term as never, () => ({enabled: true, cps: 100}));

  writer.submit('a   b');
  await wait(120);
  t.deepEqual(term.written, ['a', '   ', 'b']);
  t.deepEqual(prints, ['a', 'b']);
  off();
  writer.dispose();
});

test.serial('a run of decorative dots is laid down at once', async (t) => {
  const term = new FakeTerminal();
  const prints: string[] = [];
  const off = on('print', (strike) => prints.push(strike.char));
  const writer = new PacedWriter('t1', term as never, () => ({enabled: true, cps: 10}));

  writer.submit('a········b');
  await wait(150);
  t.deepEqual(term.written, ['a', '········', 'b']);
  t.deepEqual(prints, ['a', 'b']);
  off();
  writer.dispose();
});

test.serial('runs control tokens out in the same tick', async (t) => {
  const term = new FakeTerminal();
  const writer = new PacedWriter('t1', term as never, () => ({enabled: true, cps: 1}));

  // A prompt clear is "spaces, carriage return": at one character per second it must not wait a
  // second for the carriage return, or the head visibly visits the right margin first.
  writer.submit('  \r');
  await wait(120);
  t.deepEqual(term.written, ['  \r']);
  writer.dispose();
});

test.serial('prints a prompt at the cells after a carriage return', async (t) => {
  const term = new FakeTerminal();
  const prints: {char: string; col: number}[] = [];
  const off = on('print', (strike) => prints.push({char: strike.char, col: strike.col}));
  const writer = new PacedWriter('t1', term as never, () => ({enabled: true, cps: 200}));

  // A prompt clear, then a prompt: the cells must come from the settled buffer, not from the
  // position before the spaces and carriage return.
  writer.submit('  \r~ $ ');
  await wait(150);
  t.is(prints.map((strike) => strike.char).join(''), '~$');
  t.deepEqual(
    prints.map((strike) => strike.col),
    [0, 2]
  );
  off();
  writer.dispose();
});

test.serial('feeds the platen on a printed newline', async (t) => {
  const feeds: string[] = [];
  const off = on('feed', ({uid}) => feeds.push(uid));
  const term = new FakeTerminal();
  const writer = new PacedWriter('t1', term as never, () => ({enabled: true, cps: 200}));

  writer.submit('a\nb');
  await wait(150);
  t.deepEqual(feeds, ['t1']);
  off();
  writer.dispose();
});

test.serial('writes escape sequences atomically and in order', async (t) => {
  const term = new FakeTerminal();
  const writer = new PacedWriter('t1', term as never, () => ({enabled: true, cps: 1000}));

  writer.submit('a\x1b[31mb');
  await wait(60);
  t.deepEqual(term.written, ['a', '\x1b[31m', 'b']);
  writer.dispose();
});

test.serial('carries a sequence split across reads', async (t) => {
  const term = new FakeTerminal();
  const writer = new PacedWriter('t1', term as never, () => ({enabled: true, cps: 1000}));

  writer.submit('a\x1b[3');
  await wait(30);
  writer.submit('1mb');
  await wait(60);
  t.deepEqual(term.written, ['a', '\x1b[31m', 'b']);
  writer.dispose();
});

test.serial('writes straight through when the setting is off', (t) => {
  const term = new FakeTerminal();
  const writer = new PacedWriter('t1', term as never, () => ({enabled: false, cps: 10}));

  writer.submit('hello');
  t.deepEqual(term.written, ['hello']);
  writer.dispose();
});

test.serial('bypasses the queue in the alternate screen', (t) => {
  const term = new FakeTerminal();
  term.alternate = true;
  const writer = new PacedWriter('t1', term as never, () => ({enabled: true, cps: 10}));

  writer.submit('vim redraw');
  t.deepEqual(term.written, ['vim redraw']);
  writer.dispose();
});

test.serial('a keystroke prints a long backlog at once', async (t) => {
  const term = new FakeTerminal();
  const writer = new PacedWriter('t1', term as never, () => ({enabled: true, cps: 5}));

  writer.submit('abcdefghij'.repeat(4));
  await wait(20);
  const before = term.written.join('');
  term.key('a');
  const after = term.written.join('');
  t.true(after.length > before.length);
  t.is(after.length, 40);
  writer.dispose();
});

test.serial('a short queue is left alone so typing is still struck', async (t) => {
  const term = new FakeTerminal();
  const writer = new PacedWriter('t1', term as never, () => ({enabled: true, cps: 1000}));

  writer.submit('a');
  await wait(10);
  term.key('b');
  t.deepEqual(term.written, ['a']);
  await wait(20);
  t.deepEqual(term.written, ['a']);
  writer.dispose();
});

test.serial('flushes when the terminal is resized', async (t) => {
  const term = new FakeTerminal();
  const writer = new PacedWriter('t1', term as never, () => ({enabled: true, cps: 2}));

  writer.submit('abcdef');
  await wait(20);
  t.true(term.written.join('').length < 6);
  term.resize();
  t.is(term.written.join(''), 'abcdef');
  writer.dispose();
});
