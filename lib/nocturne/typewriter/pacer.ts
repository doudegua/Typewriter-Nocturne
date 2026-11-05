// Classic typewriter mode: program output is printed one character at a time.
//
// A real terminal receives output in chunks and xterm.js draws them at once. A typewriter cannot:
// its type bars fall one after another, roughly ten to twenty strikes a second. This queue sits in
// front of xterm.js' write path and lets a character through only when the machine is ready, so the
// Nocturne layer can strike each printed character as it lands.
//
// The rules that keep it honest:
//   * input is never delayed — a key flushes anything still queued;
//   * a full-screen program (alternate screen: Vim, less, htop) bypasses the queue entirely;
//   * escape sequences stay atomic and in order, and a sequence split across reads is carried over;
//   * when the queue grows past a backlog limit (cat of a huge file, yes) it is printed at once.
//
// Nothing here changes what the shell receives; only when the screen is allowed to show it.

import type {IBufferCell, IDisposable, Terminal} from 'xterm';

import {emit} from '../bus';

import {Splitter} from './stream';
import type {Token} from './stream';

/** Beyond this many queued characters the paper takes the rest at once. */
const MAX_QUEUE = 4096;

/** Entering the alternate screen must never wait behind a backlog. */
const ESCAPE = String.fromCharCode(27);
const ALTERNATE_ENTER = new RegExp(`${ESCAPE}\\[\\?(?:47|1047|1048|1049)h`);

/** Whether the machine paces output, and how fast. */
export type Pacing = {enabled: boolean; cps: number};

export type PaceReader = () => Pacing;

const OFF: Pacing = {enabled: false, cps: 12};

function foregroundOf(cell: IBufferCell | undefined): number | string | null {
  if (!cell) {
    return null;
  }
  if (cell.isFgRGB()) {
    return `#${cell.getFgColor().toString(16).padStart(6, '0')}`;
  }
  return cell.isFgPalette() ? cell.getFgColor() : null;
}

export class PacedWriter {
  private queue: Token[] = [];
  private splitter = new Splitter();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private listeners: IDisposable[] = [];

  constructor(
    private readonly uid: string,
    private readonly term: Terminal,
    private readonly pacing: PaceReader = () => OFF
  ) {
    // Never make the user wait behind a backlog: a keystroke prints one at once once it is long,
    // and Ctrl-C always does. Short queues are left alone, so typing is still struck at speed.
    this.listeners.push(
      term.onData((data) => {
        if (data.includes('\x03') || this.queue.length > 24) {
          this.flush();
        }
      })
    );
    this.listeners.push(term.onResize(() => this.flush()));
  }

  submit(data: string) {
    if (this.disposed || !data) {
      return;
    }
    const {enabled} = this.pacing();
    if (!enabled) {
      this.flush();
      this.term.write(this.splitter.take() + data);
      return;
    }
    if (this.bypassed()) {
      this.flush();
      this.term.write(this.splitter.take() + data);
      return;
    }
    // A program is taking the screen: let it in immediately and from now on.
    if (ALTERNATE_ENTER.test(data)) {
      this.flush();
      this.term.write(data);
      return;
    }
    for (const token of this.splitter.push(data)) {
      this.queue.push(token);
    }
    if (this.queue.length > MAX_QUEUE) {
      this.flush();
      return;
    }
    this.schedule(0);
  }

  /** Prints everything still queued at once (input, resize, leaving classic mode). */
  flush() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) {
      return;
    }
    const pending = this.queue;
    this.queue = [];
    this.term.write(pending.map((token) => token.text).join(''));
  }

  dispose() {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.listeners.forEach((listener) => listener.dispose());
    this.listeners = [];
    this.queue = [];
    this.splitter.reset();
  }

  private bypassed() {
    return this.term.buffer.active.type === 'alternate';
  }

  private schedule(delay: number) {
    if (this.timer !== null || this.disposed) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick();
    }, delay);
  }

  private tick() {
    if (this.disposed) {
      return;
    }
    const {enabled, cps} = this.pacing();
    if (!enabled || this.bypassed()) {
      this.flush();
      return;
    }
    // Everything that is not a struck character (cursor moves, erases, spaces, a ruler) goes out
    // as one write, and the next tick waits for xterm.js to parse it. The buffer is then in step
    // with what has been written, so a printed character is read from a settled buffer rather than
    // from the position before a queued prompt clear.
    const cheap = this.takeCheap();
    if (cheap) {
      this.term.write(cheap, () => this.schedule(0));
      return;
    }
    const token = this.queue.shift();
    if (!token) {
      return;
    }
    const buffer = this.term.buffer.active;
    const at = {col: buffer.cursorX, line: buffer.baseY + buffer.cursorY};
    this.term.write(token.text, () => {
      this.landed(token.text, at.col, at.line);
      this.schedule(Math.max(4, 1000 / cps));
    });
  }

  /** Pops the run of leading tokens that are printed without a strike. */
  private takeCheap() {
    let cheap = '';
    while (this.queue.length > 0) {
      const token = this.queue[0];
      if (!token.printable) {
        if (token.text === '\n') {
          emit('feed', {uid: this.uid});
        }
        cheap += this.queue.shift()?.text ?? '';
        continue;
      }
      if (token.text === ' ' || this.runLength(token.text) >= 6) {
        this.queue.shift();
        cheap += token.text + this.takeRun(token.text);
        continue;
      }
      break;
    }
    return cheap;
  }

  /** The cell a printed character landed in, read after xterm.js has parsed it. */
  private landed(char: string, col: number, line: number) {
    if (this.disposed) {
      return;
    }
    const buffer = this.term.buffer.active;
    if (buffer.type !== 'normal') {
      return;
    }
    let cell = buffer.getLine(line)?.getCell(col);
    if (cell?.getChars() !== char) {
      // The character wrapped: the capture happened with the cursor still on the last column.
      const wrapped = buffer.getLine(line + 1)?.getCell(0);
      if (wrapped?.getChars() === char) {
        cell = wrapped;
        col = 0;
        line += 1;
      }
    }
    if (!cell || cell.getChars() !== char) {
      return;
    }
    const screen = this.term.element?.querySelector('.xterm-screen');
    const rect = screen?.getBoundingClientRect();
    const cols = this.term.cols;
    if (!rect || !cols || rect.width <= 0) {
      return;
    }
    emit('print', {
      uid: this.uid,
      char,
      col,
      line,
      cellWidth: rect.width / cols,
      width: Math.max(1, cell.getWidth()),
      fg: foregroundOf(cell),
      bold: cell.isBold() !== 0
    });
  }

  /** How many of the queued characters in a row are this same character. */
  private runLength(char: string) {
    let count = 0;
    while (this.queue[count]?.printable && this.queue[count].text === char) {
      count += 1;
    }
    return count;
  }

  /** Removes a run of the same character from the head of the queue and returns it. */
  private takeRun(char: string) {
    let run = '';
    while (this.queue[0]?.printable && this.queue[0].text === char) {
      run += this.queue.shift()?.text ?? '';
    }
    return run;
  }
}
