/* Readouts, leaderboard and the cell inspector.
 * Sprites outside the canvas are background-positioned slices of the same
 * spritesheet, so nothing here costs an extra request. */
(function (global) {
  'use strict';

  var TYPE_LABEL = function (t) { return t.charAt(0).toUpperCase() + t.slice(1); };

  function UI(dex) {
    this.dex = dex;
    this.el = {};
    ['generation', 'alive', 'extinct', 'rolledStat', 'seed', 'leaderboard', 'inspector']
      .forEach(function (id) { this.el[id] = document.getElementById(id); }, this);
    this.lastTop = '';
    // The roster size is fixed for the run, so it belongs in the label rather
    // than in the value, where it would wrap the column.
    document.getElementById('extinctLabel').textContent = 'Extinct / ' + dex.count;
  }

  /** A spritesheet slice sized to `px`, as an inline style string. */
  UI.prototype.spriteStyle = function (id, px) {
    var atlas = this.dex.atlas;
    var scale = px / atlas.cell;
    return 'width:' + px + 'px;height:' + px + 'px;' +
      'background-image:url(assets/sprites.png);' +
      'background-size:' + (atlas.cols * atlas.cell * scale) + 'px auto;' +
      'background-position:' + (-((id - 1) % atlas.cols) * px) + 'px ' +
      (-(((id - 1) / atlas.cols) | 0) * px) + 'px;';
  };

  UI.prototype.updateReadouts = function (sim) {
    this.el.generation.textContent = sim.generation;
    this.el.alive.textContent = sim.aliveCount;
    this.el.extinct.textContent = sim.extinctCount;
    this.el.rolledStat.textContent = sim.statIdx < 0 ? '—' : global.Life.STAT_NAMES[sim.statIdx];
    this.el.seed.textContent = sim.seed;
  };

  UI.prototype.updateLeaderboard = function (sim) {
    var top = sim.topSpecies(5), dex = this.dex, self = this;
    var key = top.map(function (e) { return e.id + ':' + e.count; }).join(',');
    if (key === this.lastTop) return;   // the top five rarely move every tick
    this.lastTop = key;

    if (!top.length) {
      this.el.leaderboard.innerHTML = '<li class="empty">The board is empty.</li>';
      return;
    }
    this.el.leaderboard.innerHTML = top.map(function (entry) {
      var share = ((entry.count / sim.aliveCount) * 100).toFixed(1);
      return '<li>' +
        '<span class="sprite" style="' + self.spriteStyle(entry.id, 32) + '"></span>' +
        '<span class="lb-name">' + dex.names[entry.id - 1] + '</span>' +
        '<span class="lb-count">' + entry.count + '<small>' + share + '%</small></span>' +
        '</li>';
    }).join('');
  };

  UI.prototype.showInspector = function (id) {
    var dex = this.dex;
    if (!id) {
      this.el.inspector.innerHTML =
        '<p class="hint">Click any cell on the board to inspect the species holding it.</p>';
      return;
    }
    var types = dex.types[id - 1].filter(Boolean)
      .map(function (t) { return '<span class="pill">' + TYPE_LABEL(t) + '</span>'; }).join('');
    var bars = global.Life.STAT_NAMES.map(function (name, s) {
      var v = dex.stats[(id - 1) * 6 + s];
      var isDominant = dex.dominant[id] === s;
      return '<div class="stat-row' + (isDominant ? ' dominant' : '') + '">' +
        '<span class="stat-name">' + name + '</span>' +
        '<span class="stat-bar"><i style="width:' + ((v / 255) * 100).toFixed(1) + '%;' +
        'background:var(' + ['--stat-hp', '--stat-atk', '--stat-def', '--stat-spa', '--stat-spd', '--stat-spe'][s] + ')"></i></span>' +
        '<span class="stat-value">' + v + '</span></div>';
    }).join('');

    this.el.inspector.innerHTML =
      '<div class="inspect-head">' +
        '<span class="sprite big" style="' + this.spriteStyle(id, 64) + '"></span>' +
        '<div><h3>' + dex.names[id - 1] + '</h3>' +
        '<p class="dex-no">#' + String(id).padStart(4, '0') + '</p>' +
        '<div class="pills">' + types + '</div></div>' +
      '</div><div class="stats">' + bars + '</div>';
  };

  global.UI = UI;
})(window);
