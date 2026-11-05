// The type impression: when a character the user typed has been echoed by the program, the slug
// has just hit the paper, so for a moment the glyph is heavier and its ink spreads a little, then
// it settles into ordinary print. Drawn into a 2D canvas over the sheet, exactly on top of the
// glyph xterm.js rendered, and only ever for characters xterm itself has drawn (hidden input such
// as passwords never produces a strike). Nothing is delayed: the real glyph is already there.

import type {AnsiColors} from '../../../app/nocturne/types';
import type {StrikeEvent} from '../bus';

const SETTLE_MS = 420;

const ANSI_ORDER: (keyof AnsiColors)[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'lightBlack',
  'lightRed',
  'lightGreen',
  'lightYellow',
  'lightBlue',
  'lightMagenta',
  'lightCyan',
  'lightWhite'
];

export type InkStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontWeightBold: number;
  letterSpacing: number;
  ink: string;
  ansi: AnsiColors;
  /** Strength of the impression, 0–1 (0 = off). */
  impression: number;
};

/** Where the active terminal's rows are now, so a strike follows its line when the page scrolls. */
export type InkViewport = {
  /** Sheet-relative position of the text grid. */
  left: number;
  top: number;
  cellHeight: number;
  cellWidth: number;
  /** Buffer line shown in the top row. */
  viewportY: number;
};

type Strike = StrikeEvent & {at: number};

/** Ink that stayed on the paper after its character was taken away (classic mode). */
type Ghost = StrikeEvent & {at: number};

/** The colour xterm.js gives a cell: default ink, one of the 16 ANSI colours, or a true colour. */
export function glyphColor(fg: StrikeEvent['fg'], style: InkStyle): string {
  if (typeof fg === 'string') {
    return fg;
  }
  if (typeof fg === 'number' && fg < 16) {
    return style.ansi[ANSI_ORDER[fg]];
  }
  return style.ink;
}

/**
 * Sets the font of a glyph and measures it as xterm.js does: the glyph box is centred in the cell
 * and drawn on the ideographic baseline.
 */
export function glyphMetrics(c: CanvasRenderingContext2D, style: InkStyle, bold: boolean, viewport: InkViewport) {
  const weight = bold ? style.fontWeightBold : style.fontWeight;
  c.font = `${weight} ${style.fontSize}px ${style.fontFamily}`;
  const metrics = c.measureText('W');
  const charHeight = Math.ceil(metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent);
  return {charHeight, charTop: Math.round((viewport.cellHeight - charHeight) / 2)};
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export class InkLayer {
  private context: CanvasRenderingContext2D | null;
  private strikes: Strike[] = [];
  private ghosts: Ghost[] = [];
  private width = 0;
  private height = 0;
  private pixelRatio = 1;
  private drawn = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d');
  }

  resize(width: number, height: number, pixelRatio: number) {
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    this.canvas.width = Math.max(1, Math.round(width * pixelRatio));
    this.canvas.height = Math.max(1, Math.round(height * pixelRatio));
    this.drawn = false;
  }

  add(strike: StrikeEvent, now: number) {
    // Fresh ink covers whatever stain was on the cell.
    this.ghosts = this.ghosts.filter((ghost) => ghost.line !== strike.line || ghost.col !== strike.col);
    this.strikes.push({...strike, at: now});
    if (this.strikes.length > 64) {
      this.strikes.shift();
    }
  }

  /**
   * A character the machine had printed is gone (a backspace, a redraw). On paper the ink does not
   * come off, so the cell keeps a faint stain where the letter was.
   */
  addGhost(strike: StrikeEvent) {
    this.ghosts = this.ghosts.filter(
      (ghost) => ghost.line !== strike.line || ghost.col !== strike.col || ghost.char !== strike.char
    );
    this.ghosts.push({...strike, at: performance.now()});
    if (this.ghosts.length > 800) {
      this.ghosts.shift();
    }
  }

  /** Forget every strike (the terminal changed, or the effect was turned off). */
  reset() {
    this.strikes = [];
    this.ghosts = [];
    if (this.drawn) {
      this.context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawn = false;
    }
  }

  get active() {
    return this.strikes.length > 0;
  }

  /** Draws the stains and the strikes that are still settling; returns whether any remain. */
  render(now: number, style: InkStyle, viewport: InkViewport | null) {
    const c = this.context;
    this.strikes = this.strikes.filter((strike) => now - strike.at < SETTLE_MS);
    if (!c || (!this.drawn && this.strikes.length === 0 && this.ghosts.length === 0)) {
      return this.strikes.length > 0;
    }
    c.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    c.clearRect(0, 0, this.width, this.height);
    this.drawn = false;
    if (!viewport) {
      return this.strikes.length > 0;
    }
    c.textBaseline = 'ideographic';
    // Old stains first: they sit in the paper, under anything freshly struck.
    if (this.ghosts.length > 0) {
      this.ghosts = this.ghosts.filter((ghost) => ghost.line >= viewport.viewportY - 1);
      const raw = style.impression > 0 ? 0.14 : 0.09;
      for (const ghost of this.ghosts) {
        const top = viewport.top + (ghost.line - viewport.viewportY) * viewport.cellHeight;
        if (top < -viewport.cellHeight || top > this.height) {
          continue;
        }
        const {charHeight, charTop} = glyphMetrics(c, style, ghost.bold, viewport);
        const x = viewport.left + ghost.col * ghost.cellWidth + Math.floor(style.letterSpacing / 2);
        c.globalAlpha = raw;
        c.fillStyle = glyphColor(ghost.fg, style);
        c.fillText(ghost.char, x, top + charTop + charHeight + 0.4);
        this.drawn = true;
      }
      c.globalAlpha = 1;
    }
    if (style.impression <= 0) {
      return this.strikes.length > 0;
    }
    for (const strike of this.strikes) {
      const k = (1 - smooth((now - strike.at) / SETTLE_MS)) * style.impression;
      const {charHeight, charTop} = glyphMetrics(c, style, strike.bold, viewport);
      const x = viewport.left + strike.col * strike.cellWidth + Math.floor(style.letterSpacing / 2);
      const top = viewport.top + (strike.line - viewport.viewportY) * viewport.cellHeight;
      if (top < -viewport.cellHeight || top > this.height) {
        continue;
      }
      const baseline = top + charTop + charHeight;
      const color = glyphColor(strike.fg, style);
      const scale = 1 + 0.07 * k;
      const cx = x + strike.width / 2;
      const cy = top + viewport.cellHeight / 2;
      c.save();
      c.translate(cx, cy);
      c.scale(scale, scale);
      c.translate(-cx, -cy);
      c.fillStyle = color;
      c.shadowColor = color;
      c.shadowBlur = 2.4 * k * this.pixelRatio;
      c.globalAlpha = Math.min(1, k);
      c.fillText(strike.char, x, baseline);
      c.shadowBlur = 0;
      c.globalAlpha = 0.55 * k;
      c.fillText(strike.char, x + 0.35, baseline + 0.25);
      c.restore();
      this.drawn = true;
    }
    return this.strikes.length > 0;
  }
}
