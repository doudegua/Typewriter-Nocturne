import test from 'ava';

import {sequenceEnd, Splitter} from '../../lib/nocturne/typewriter/stream';

test('splits printable text into code points', (t) => {
  const tokens = new Splitter().push('abc');
  t.deepEqual(tokens, [
    {text: 'a', printable: true},
    {text: 'b', printable: true},
    {text: 'c', printable: true}
  ]);
});

test('keeps a wide character and an emoji whole', (t) => {
  const tokens = new Splitter().push('你🙂');
  t.deepEqual(tokens, [
    {text: '你', printable: true},
    {text: '🙂', printable: true}
  ]);
});

test('keeps control characters separate', (t) => {
  const tokens = new Splitter().push('a\r\n\tb');
  t.deepEqual(tokens, [
    {text: 'a', printable: true},
    {text: '\r', printable: false},
    {text: '\n', printable: false},
    {text: '\t', printable: false},
    {text: 'b', printable: true}
  ]);
});

test('keeps a CSI sequence atomic and in order', (t) => {
  const tokens = new Splitter().push('a\x1b[31mb');
  t.deepEqual(tokens, [
    {text: 'a', printable: true},
    {text: '\x1b[31m', printable: false},
    {text: 'b', printable: true}
  ]);
});

test('carries an escape sequence split across reads', (t) => {
  const splitter = new Splitter();
  t.deepEqual(splitter.push('a\x1b[3'), [{text: 'a', printable: true}]);
  t.is(splitter.pending, '\x1b[3');
  t.deepEqual(splitter.push('1mb'), [
    {text: '\x1b[31m', printable: false},
    {text: 'b', printable: true}
  ]);
  t.is(splitter.pending, '');
});

test('carries a lone ESC until the sequence is complete', (t) => {
  const splitter = new Splitter();
  t.deepEqual(splitter.push('\x1b'), []);
  t.deepEqual(splitter.push('[1;2H'), [{text: '\x1b[1;2H', printable: false}]);
  t.is(splitter.pending, '');
});

test('reads OSC titles terminated by BEL or ST', (t) => {
  t.deepEqual(new Splitter().push('\x1b]0;title\x07x'), [
    {text: '\x1b]0;title\x07', printable: false},
    {text: 'x', printable: true}
  ]);
  t.deepEqual(new Splitter().push('\x1b]0;title\x1b\\x'), [
    {text: '\x1b]0;title\x1b\\', printable: false},
    {text: 'x', printable: true}
  ]);
});

test('reads a two-byte escape as one control token', (t) => {
  t.deepEqual(new Splitter().push('\x1b7x'), [
    {text: '\x1b7', printable: false},
    {text: 'x', printable: true}
  ]);
});

test('sequenceEnd reports incomplete sequences', (t) => {
  t.is(sequenceEnd('\x1b[12;', 0), -1);
  t.is(sequenceEnd('\x1b]0;title', 0), -1);
  t.is(sequenceEnd('\x1b', 0), -1);
  t.is(sequenceEnd('\x1b[K', 0), 3);
});

test('take() hands the pending bytes back', (t) => {
  const splitter = new Splitter();
  splitter.push('text\x1b[3');
  t.is(splitter.take(), '\x1b[3');
  t.is(splitter.pending, '');
});
