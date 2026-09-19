/* Simulation core: Conway's B3/S23 on a torus, with stat-decided births.
 *
 * Loads both as a plain browser script (window.Life) and under `node --test`
 * via the module.exports tail, so the rules can be unit-tested without a DOM.
 */
(function (global) {
  'use strict';

  var OFFSETS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  var STAT_NAMES = ['HP', 'Attack', 'Defense', 'Sp. Attack', 'Sp. Defense', 'Speed'];

  /* Small, fast, seedable PRNG. Every run is reproducible from its seed, which
   * the UI shows so a board can be recreated exactly. */
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Wrapped neighbour indices, resolved once at construction. Keeps the modulo
   * arithmetic for the torus out of the per-generation loop. */
  function buildNeighbourTable(w, h) {
    var table = new Int32Array(w * h * 8);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var base = (y * w + x) * 8;
        for (var k = 0; k < 8; k++) {
          var nx = (x + OFFSETS[k][0] + w) % w;
          var ny = (y + OFFSETS[k][1] + h) % h;
          table[base + k] = ny * w + nx;
        }
      }
    }
    return table;
  }

  /**
   * @param {object} opts
   * @param {number} opts.width  columns
   * @param {number} opts.height rows
   * @param {number} opts.speciesCount  how many species get a starting cell
   * @param {ArrayLike<number>} opts.stats  flat, 6 per species, (id-1)*6 + statIdx
   * @param {number} [opts.seed]
   */
  function Life(opts) {
    this.w = opts.width;
    this.h = opts.height;
    this.n = opts.width * opts.height;
    this.speciesCount = opts.speciesCount;
    this.stats = opts.stats;

    this.nbrs = buildNeighbourTable(this.w, this.h);
    this.grid = new Uint16Array(this.n);
    this.next = new Uint16Array(this.n);
    this.pop = new Uint16Array(this.speciesCount + 1);
    this.changed = new Int32Array(this.n);
    this.changedCount = 0;

    this.reset(opts.seed === undefined ? (Math.random() * 0xFFFFFFFF) >>> 0 : opts.seed);
  }

  /* Scatter every species onto its own cell. A partial Fisher-Yates over the
   * cell indices gives `speciesCount` distinct cells without rejection-sampling
   * against collisions. */
  Life.prototype.reset = function (seed) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.generation = 0;
    this.statIdx = -1;          // no stat has been rolled before the first step
    this.grid.fill(0);
    this.pop.fill(0);

    var cells = new Int32Array(this.n);
    for (var i = 0; i < this.n; i++) cells[i] = i;
    for (var s = 0; s < this.speciesCount; s++) {
      var j = s + ((this.rng() * (this.n - s)) | 0);
      var tmp = cells[s]; cells[s] = cells[j]; cells[j] = tmp;
      this.grid[cells[s]] = s + 1;
      this.pop[s + 1] = 1;
    }

    this.aliveCount = this.speciesCount;
    this.extinctCount = 0;
    this.changedCount = 0;
    return this;
  };

  /* Test/debug helper: drop an explicit pattern onto an empty board.
   * `cells` is a list of [x, y, speciesId]. */
  Life.prototype.loadPattern = function (cells) {
    this.grid.fill(0);
    this.pop.fill(0);
    for (var i = 0; i < cells.length; i++) {
      var x = cells[i][0], y = cells[i][1], id = cells[i][2];
      this.grid[((y % this.h) + this.h) % this.h * this.w + (((x % this.w) + this.w) % this.w)] = id;
    }
    this.aliveCount = 0;
    for (var c = 0; c < this.n; c++) {
      if (this.grid[c] !== 0) { this.pop[this.grid[c]]++; this.aliveCount++; }
    }
    this.extinctCount = 0;
    for (var id2 = 1; id2 <= this.speciesCount; id2++) if (this.pop[id2] === 0) this.extinctCount++;
    this.generation = 0;
    this.changedCount = 0;
    return this;
  };

  /* Which of three neighbours wins the cell, on this generation's stat.
   * Ties are broken uniformly by reservoir sampling over the tied candidates. */
  Life.prototype._winner = function (a, b, c, statIdx) {
    var stats = this.stats, rng = this.rng;
    var best = stats[(a - 1) * 6 + statIdx], winner = a, ties = 1;
    var vb = stats[(b - 1) * 6 + statIdx];
    if (vb > best) { best = vb; winner = b; ties = 1; }
    else if (vb === best) { ties++; if (rng() * ties < 1) winner = b; }
    var vc = stats[(c - 1) * 6 + statIdx];
    if (vc > best) { best = vc; winner = c; ties = 1; }
    else if (vc === best) { ties++; if (rng() * ties < 1) winner = c; }
    return winner;
  };

  /** Advance one generation. Returns the index of the stat rolled for it. */
  Life.prototype.step = function () {
    var grid = this.grid, next = this.next, nbrs = this.nbrs, n = this.n;
    var statIdx = (this.rng() * 6) | 0;
    var changed = this.changed, changedCount = 0, alive = 0;

    /* Every cell is decided against the previous generation and written to a
     * separate buffer -- reading and writing one grid would corrupt the
     * neighbour counts partway through the pass. */
    for (var i = 0; i < n; i++) {
      var base = i * 8;
      var count = 0, a = 0, b = 0, c = 0;
      for (var k = 0; k < 8; k++) {
        var sp = grid[nbrs[base + k]];
        if (sp !== 0) {
          if (count === 0) a = sp; else if (count === 1) b = sp; else if (count === 2) c = sp;
          count++;
        }
      }

      var self = grid[i];
      var out;
      if (self !== 0) {
        // Survival is neighbour count only -- stats never decide who lives.
        out = (count === 2 || count === 3) ? self : 0;
      } else {
        out = count === 3 ? this._winner(a, b, c, statIdx) : 0;
      }

      next[i] = out;
      if (out !== 0) alive++;
      if (out !== self) changed[changedCount++] = i;
    }

    // Populations move only where a cell changed, so walk the change list.
    var pop = this.pop;
    for (var ci = 0; ci < changedCount; ci++) {
      var idx = changed[ci];
      var was = grid[idx], now = next[idx];
      if (was !== 0 && --pop[was] === 0) this.extinctCount++;
      if (now !== 0 && pop[now]++ === 0) this.extinctCount--;
    }

    this.grid = next;
    this.next = grid;
    this.changedCount = changedCount;
    this.aliveCount = alive;
    this.statIdx = statIdx;
    this.generation++;
    return statIdx;
  };

  /** The `k` species holding the most cells right now, most territory first. */
  Life.prototype.topSpecies = function (k) {
    var pop = this.pop, out = [];
    for (var id = 1; id <= this.speciesCount; id++) {
      if (pop[id] === 0) continue;
      if (out.length < k) {
        out.push({ id: id, count: pop[id] });
        if (out.length === k) out.sort(function (p, q) { return q.count - p.count; });
      } else if (pop[id] > out[k - 1].count) {
        out[k - 1] = { id: id, count: pop[id] };
        out.sort(function (p, q) { return q.count - p.count; });
      }
    }
    return out.sort(function (p, q) { return q.count - p.count; });
  };

  Life.STAT_NAMES = STAT_NAMES;
  Life.mulberry32 = mulberry32;

  global.Life = Life;
  if (typeof module !== 'undefined' && module.exports) module.exports = Life;
})(typeof window !== 'undefined' ? window : globalThis);
