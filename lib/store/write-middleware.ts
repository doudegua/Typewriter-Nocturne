import type {Dispatch, Middleware} from 'redux';

import type {HyperActions, HyperState} from '../../typings/hyper';
import {paceTerminal} from '../nocturne/typewriter/pacing';
import terms from '../terms';

// the only side effect we perform from middleware
// is to write to the react term instance directly
// to avoid a performance hit
const writeMiddleware: Middleware<{}, HyperState, Dispatch<HyperActions>> = () => (next) => (action: HyperActions) => {
  if (action.type === 'SESSION_PTY_DATA') {
    const term = terms[action.uid];
    if (term) {
      // [nocturne] Classic typewriter mode queues the output and prints it one character at a
      // time; with that setting off this is the same write it has always been.
      paceTerminal(action.uid, term.term, action.data);
    }
  }
  next(action);
};

export default writeMiddleware;
