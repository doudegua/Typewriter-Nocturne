// Where classic typewriter mode meets the settings store and React's terminal instances.
//
// The pacing engine itself (pacer.ts) has no opinion about where the speed comes from; this module
// reads it from the Nocturne settings and keeps one writer per xterm.js terminal.

import type {Terminal} from 'xterm';

import {getSettings} from '../store';

import {PacedWriter} from './pacer';
import type {Pacing} from './pacer';

const writers = new WeakMap<Terminal, PacedWriter>();

const read = (): Pacing => {
  const {classic, classicCps} = getSettings().typewriter;
  return {enabled: classic, cps: Math.max(1, Math.min(60, classicCps))};
};

/** The single write path of a terminal: straight through, or through the typewriter queue. */
export function paceTerminal(uid: string, term: Terminal, data: string) {
  let writer = writers.get(term);
  if (!writer) {
    writer = new PacedWriter(uid, term, read);
    writers.set(term, writer);
  }
  writer.submit(data);
}

export function disposePacer(term: Terminal) {
  const writer = writers.get(term);
  if (writer) {
    writer.dispose();
    writers.delete(term);
  }
}
