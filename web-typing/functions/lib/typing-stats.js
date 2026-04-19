const floor = Math.floor;
const max = Math.max;
const min = Math.min;

function _calculateRatio(matches, length) {
  if (length) {
    return (2.0 * matches) / length;
  }
  return 1.0;
}

function _arrayCmp(a, b) {
  const la = a.length;
  const lb = b.length;
  for (let i = 0, n = min(la, lb); i < n; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return la - lb;
}

function _has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function SequenceMatcher(isjunk, a, b, autojunk) {
  this.isjunk = isjunk;
  if (a == null) a = '';
  if (b == null) b = '';
  this.autojunk = autojunk != null ? autojunk : true;
  this.a = this.b = null;
  this.setSeqs(a, b);
}

SequenceMatcher.prototype.setSeqs = function (a, b) {
  this.setSeq1(a);
  this.setSeq2(b);
};

SequenceMatcher.prototype.setSeq1 = function (a) {
  if (a === this.a) return;
  this.a = a;
  this.matchingBlocks = this.opcodes = null;
};

SequenceMatcher.prototype.setSeq2 = function (b) {
  if (b === this.b) return;
  this.b = b;
  this.matchingBlocks = this.opcodes = null;
  this.fullbcount = null;
  this._chainB();
};

SequenceMatcher.prototype._chainB = function () {
  const b = this.b;
  const b2j = {};
  this.b2j = b2j;
  for (let i = 0, len = b.length; i < len; i++) {
    const elt = b[i];
    const indices = _has(b2j, elt) ? b2j[elt] : (b2j[elt] = []);
    indices.push(i);
  }
  const junk = {};
  const isjunk = this.isjunk;
  if (isjunk) {
    const keys = Object.keys(b2j);
    for (let j = 0; j < keys.length; j++) {
      const elt = keys[j];
      if (isjunk(elt)) {
        junk[elt] = true;
        delete b2j[elt];
      }
    }
  }
  const popular = {};
  const n = b.length;
  if (this.autojunk && n >= 200) {
    const ntest = floor(n / 100) + 1;
    for (const elt in b2j) {
      const idxs = b2j[elt];
      if (idxs.length > ntest) {
        popular[elt] = true;
        delete b2j[elt];
      }
    }
  }
  this.isbjunk = function (x) {
    return _has(junk, x);
  };
  this.isbpopular = function (x) {
    return _has(popular, x);
  };
};

SequenceMatcher.prototype.findLongestMatch = function (alo, ahi, blo, bhi) {
  const a = this.a;
  const b = this.b;
  const b2j = this.b2j;
  const isbjunk = this.isbjunk;
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;
  let j2len = {};
  for (let i = alo; i < ahi; i++) {
    const newj2len = {};
    const arr = _has(b2j, a[i]) ? b2j[a[i]] : [];
    for (let jj = 0; jj < arr.length; jj++) {
      const j = arr[jj];
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (newj2len[j] = (j2len[j - 1] || 0) + 1);
      if (k > bestsize) {
        besti = i - k + 1;
        bestj = j - k + 1;
        bestsize = k;
      }
    }
    j2len = newj2len;
  }
  while (besti > alo && bestj > blo && !isbjunk(b[bestj - 1]) && a[besti - 1] === b[bestj - 1]) {
    besti--;
    bestj--;
    bestsize++;
  }
  while (besti + bestsize < ahi && bestj + bestsize < bhi && !isbjunk(b[bestj + bestsize]) && a[besti + bestsize] === b[bestj + bestsize]) {
    bestsize++;
  }
  while (besti > alo && bestj > blo && isbjunk(b[bestj - 1]) && a[besti - 1] === b[bestj - 1]) {
    besti--;
    bestj--;
    bestsize++;
  }
  while (besti + bestsize < ahi && bestj + bestsize < bhi && isbjunk(b[bestj + bestsize]) && a[besti + bestsize] === b[bestj + bestsize]) {
    bestsize++;
  }
  return [besti, bestj, bestsize];
};

SequenceMatcher.prototype.getMatchingBlocks = function () {
  if (this.matchingBlocks) return this.matchingBlocks;
  const la = this.a.length;
  const lb = this.b.length;
  const queue = [[0, la, 0, lb]];
  const matchingBlocks = [];
  while (queue.length) {
    const popped = queue.pop();
    const alo = popped[0];
    const ahi = popped[1];
    const blo = popped[2];
    const bhi = popped[3];
    const x = this.findLongestMatch(alo, ahi, blo, bhi);
    const i = x[0];
    const j = x[1];
    const k = x[2];
    if (k) {
      matchingBlocks.push(x);
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  matchingBlocks.sort(_arrayCmp);
  let i1 = 0;
  let j1 = 0;
  let k1 = 0;
  const nonAdjacent = [];
  for (let ii = 0; ii < matchingBlocks.length; ii++) {
    const i2 = matchingBlocks[ii][0];
    const j2 = matchingBlocks[ii][1];
    const k2 = matchingBlocks[ii][2];
    if (i1 + k1 === i2 && j1 + k1 === j2) {
      k1 += k2;
    } else {
      if (k1) nonAdjacent.push([i1, j1, k1]);
      i1 = i2;
      j1 = j2;
      k1 = k2;
    }
  }
  if (k1) nonAdjacent.push([i1, j1, k1]);
  nonAdjacent.push([la, lb, 0]);
  this.matchingBlocks = nonAdjacent;
  return nonAdjacent;
};

SequenceMatcher.prototype.ratio = function () {
  let matches = 0;
  const blocks = this.getMatchingBlocks();
  for (let i = 0; i < blocks.length; i++) {
    matches += blocks[i][2];
  }
  return _calculateRatio(matches, this.a.length + this.b.length);
};

export function normalizeTypingText(s) {
  return s
    .replace(/\xa0/g, ' ')
    .toLowerCase()
    .replace(/[^a-z ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wpmFromText(typed, elapsedSec) {
  if (elapsedSec <= 0) return 0;
  const words = typed.length / 5.0;
  return Math.round((words / elapsedSec) * 60.0 * 100) / 100;
}

export function accuracyPercent(expected, actual) {
  const sm = new SequenceMatcher(null, expected, actual);
  return Math.round(sm.ratio() * 10000) / 100;
}
