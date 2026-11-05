import test from 'ava';

import {vanishedCells} from '../../lib/nocturne/typewriter/ghosts';
import type {GhostCell} from '../../lib/nocturne/typewriter/ghosts';

const cell = (char: string, width = 1): GhostCell => ({char, width, fg: null, bold: false});

test('finds the cells a backspace emptied', (t) => {
  const before = [cell('h'), cell('i'), cell(' ')];
  const after = [cell('h'), cell(' '), cell(' ')];
  t.deepEqual(vanishedCells(before, after), [1]);
});

test('ignores cells that are unchanged', (t) => {
  const row = [cell('a'), cell('b'), cell('c')];
  t.deepEqual(vanishedCells(row, row.slice()), []);
});

test('ignores a cell that was overwritten by another character', (t) => {
  // Overstriking is not erasing: the new glyph simply covers the old one.
  t.deepEqual(vanishedCells([cell('a')], [cell('b')]), []);
});

test('treats wide characters and spaces correctly', (t) => {
  const before = [cell('你', 2), cell('', 1), cell('好', 2)];
  const after = [cell(' ', 1), cell(' ', 1), cell('好', 2)];
  t.deepEqual(vanishedCells(before, after), [0]);
});

test('compares only the columns both rows have', (t) => {
  const before = [cell('a'), cell('b'), cell('c')];
  const after = [cell('a')];
  t.deepEqual(vanishedCells(before, after), []);
});

test('finds every emptied cell of a cleared line', (t) => {
  const before = ['a', 'b', 'c'].map((char) => cell(char));
  const after = [' ', ' ', ' '].map((char) => cell(char));
  t.deepEqual(vanishedCells(before, after), [0, 1, 2]);
});
