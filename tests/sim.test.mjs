/* Rules tests for the simulation core. Run: node --test tests/ */
import test from 'node:test';
import assert from 'node:assert/strict';
import Life from '../js/sim.js';

/** A small board with hand-written stats. `stats` is [[hp,atk,...], ...] per id. */
function board(w, h, stats) {
  const flat = new Uint8Array(stats.length * 6);
  stats.forEach((row, i) => flat.set(row, i * 6));
  return new Life({ width: w, height: h, speciesCount: stats.length, stats: flat, seed: 1 });
}

/** Force `step()` to roll a chosen stat, leaving ties to a scripted sequence. */
function rollStat(sim, statIdx, tieDraws = []) {
  const queue = [(statIdx + 0.5) / 6, ...tieDraws];
  let i = 0;
  sim.rng = () => (i < queue.length ? queue[i++] : 0.5);
}

const at = (sim, x, y) => sim.grid[y * sim.w + x];
const live = (sim) => {
  const out = [];
  for (let i = 0; i < sim.n; i++) if (sim.grid[i]) out.push([i % sim.w, (i / sim.w) | 0]);
  return out.sort(([ax, ay], [bx, by]) => ay - by || ax - bx);
};

const UNIFORM = [[50, 50, 50, 50, 50, 50]];

test('a blinker oscillates with period 2', () => {
  const sim = board(9, 9, UNIFORM);
  sim.loadPattern([[3, 4, 1], [4, 4, 1], [5, 4, 1]]);
  sim.step();
  assert.deepEqual(live(sim), [[4, 3], [4, 4], [4, 5]], 'horizontal blinker turns vertical');
  sim.step();
  assert.deepEqual(live(sim), [[3, 4], [4, 4], [5, 4]], 'and back again');
});

test('a blinker oscillates across the torus seam', () => {
  const sim = board(9, 9, UNIFORM);
  // Straddles the left/right edge: x = 8, 0, 1 are contiguous on a torus.
  sim.loadPattern([[8, 0, 1], [0, 0, 1], [1, 0, 1]]);
  sim.step();
  assert.deepEqual(live(sim), [[0, 0], [0, 1], [0, 8]], 'wraps top to bottom too');
  sim.step();
  assert.deepEqual(live(sim), [[0, 0], [1, 0], [8, 0]]);
});

test('a block is a still life and keeps every species', () => {
  const sim = board(9, 9, [UNIFORM[0], UNIFORM[0], UNIFORM[0], UNIFORM[0]]);
  sim.loadPattern([[3, 3, 1], [4, 3, 2], [3, 4, 3], [4, 4, 4]]);
  sim.step();
  assert.equal(sim.aliveCount, 4);
  assert.deepEqual([at(sim, 3, 3), at(sim, 4, 3), at(sim, 3, 4), at(sim, 4, 4)], [1, 2, 3, 4],
    'survivors keep their own species -- stats never decide who lives');
});

test('under- and overpopulation both kill', () => {
  const lone = board(9, 9, UNIFORM);
  lone.loadPattern([[4, 4, 1]]);
  lone.step();
  assert.equal(lone.aliveCount, 0, 'a cell with no neighbours dies');

  const crowd = board(9, 9, UNIFORM);
  // Centre cell has 4 live neighbours -> overcrowded.
  crowd.loadPattern([[4, 4, 1], [3, 4, 1], [5, 4, 1], [4, 3, 1], [4, 5, 1]]);
  crowd.step();
  assert.equal(at(crowd, 4, 4), 0, 'a cell with 4 neighbours dies');
});

test('births go to the highest value in the stat rolled this generation', () => {
  const stats = [
    [10, 90, 50, 50, 50, 50],  // id 1: wins on Attack
    [90, 10, 50, 50, 50, 50],  // id 2: wins on HP
    [50, 50, 50, 50, 50, 50],  // id 3: never wins
  ];
  const layout = [[3, 3, 1], [5, 3, 2], [4, 5, 3]];  // (4,4) sees exactly these 3

  const onHp = board(9, 9, stats);
  onHp.loadPattern(layout);
  rollStat(onHp, 0);
  assert.equal(onHp.step(), 0);
  assert.equal(at(onHp, 4, 4), 2, 'HP roll -> id 2');

  const onAtk = board(9, 9, stats);
  onAtk.loadPattern(layout);
  rollStat(onAtk, 1);
  assert.equal(onAtk.step(), 1);
  assert.equal(at(onAtk, 4, 4), 1, 'same neighbourhood, Attack roll -> id 1');
});

test('one stat is rolled for the whole board, not per cell', () => {
  const sim = board(70, 70, Array.from({ length: 20 }, () => [50, 50, 50, 50, 50, 50]));
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(sim.step());
  assert.ok(seen.size > 1, 'the roll varies between generations');
  for (const s of seen) assert.ok(s >= 0 && s < 6);
});

test('ties among birth candidates are broken at random, not by position', () => {
  const stats = [
    [50, 50, 50, 50, 50, 50],
    [50, 50, 50, 50, 50, 50],
    [50, 50, 50, 50, 50, 50],
  ];
  const winners = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const sim = board(9, 9, stats);
    sim.seed = seed;
    sim.rng = Life.mulberry32(seed);
    sim.loadPattern([[3, 3, 1], [5, 3, 2], [4, 5, 3]]);
    sim.step();
    winners.add(at(sim, 4, 4));
  }
  assert.deepEqual([...winners].sort(), [1, 2, 3], 'all three tied species win sometimes');
});

test('a generation is computed against the previous state, not in place', () => {
  const sim = board(9, 9, UNIFORM);
  sim.loadPattern([[3, 4, 1], [4, 4, 1], [5, 4, 1]]);
  const before = Uint16Array.from(sim.grid);
  const prevBuffer = sim.grid;
  sim.step();
  assert.notEqual(sim.grid, prevBuffer, 'the buffers are swapped, not overwritten');
  assert.deepEqual([...prevBuffer], [...before],
    'the previous generation is left untouched while it is being read');
});

test('generation 0 places every species exactly once', () => {
  const stats = new Uint8Array(1025 * 6).fill(50);
  const sim = new Life({ width: 70, height: 70, speciesCount: 1025, stats, seed: 99 });
  assert.equal(sim.aliveCount, 1025);
  assert.equal(sim.extinctCount, 0);
  const ids = [...sim.grid].filter(Boolean);
  assert.equal(ids.length, 1025);
  assert.equal(new Set(ids).size, 1025, 'no species appears twice');
  assert.ok(sim.pop.slice(1).every((c) => c === 1));
});

test('population and extinction counts track the grid', () => {
  const stats = new Uint8Array(1025 * 6);
  for (let i = 0; i < stats.length; i++) stats[i] = (i * 37) % 200;
  const sim = new Life({ width: 70, height: 70, speciesCount: 1025, stats, seed: 4 });
  let extinctBefore = 0;
  for (let g = 0; g < 60; g++) {
    sim.step();
    const ids = [...sim.grid].filter(Boolean);
    assert.equal(sim.aliveCount, ids.length, `alive count at gen ${g + 1}`);
    assert.equal(sim.extinctCount, 1025 - new Set(ids).size, `extinct count at gen ${g + 1}`);
    assert.ok(sim.extinctCount >= extinctBefore, 'extinction never reverses');
    extinctBefore = sim.extinctCount;
    for (const id of new Set(ids)) {
      assert.equal(sim.pop[id], ids.filter((x) => x === id).length);
    }
  }
});

test('the leaderboard is ordered by territory', () => {
  const sim = board(20, 20, Array.from({ length: 30 }, () => [50, 50, 50, 50, 50, 50]));
  for (let i = 0; i < 30; i++) sim.step();
  const top = sim.topSpecies(5);
  assert.ok(top.length <= 5);
  for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].count >= top[i].count);
  for (const entry of top) assert.equal(entry.count, sim.pop[entry.id]);
});

test('the same seed reproduces the same run', () => {
  const stats = new Uint8Array(1025 * 6).fill(77);
  const a = new Life({ width: 70, height: 70, speciesCount: 1025, stats, seed: 2024 });
  const b = new Life({ width: 70, height: 70, speciesCount: 1025, stats, seed: 2024 });
  for (let i = 0; i < 25; i++) { a.step(); b.step(); }
  assert.deepEqual([...a.grid], [...b.grid]);
});
