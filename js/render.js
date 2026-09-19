/* Canvas renderer. One canvas, no per-cell DOM.
 *
 * The canvas is transparent and dead cells are cleared rather than painted --
 * the board's background and grid rule live in CSS underneath, which is what
 * makes repainting only the changed cells correct rather than merely cheap. */
(function (global) {
  'use strict';

  var STAT_VARS = ['--stat-hp', '--stat-atk', '--stat-def', '--stat-spa', '--stat-spd', '--stat-spe'];

  function hexToRgb(hex) {
    var h = hex.trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function Renderer(canvas, dex) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dex = dex;
    this.sheet = null;
    this.mode = 'sprite';
    this.selected = -1;
    this.cell = 12;
    this.dpr = 1;

    var css = getComputedStyle(document.documentElement);
    this.colors = STAT_VARS.map(function (name) { return css.getPropertyValue(name).trim(); });
    this.tints = this.colors.map(function (hex) {
      var c = hexToRgb(hex);
      return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.22)';
    });
    this.selectColor = css.getPropertyValue('--text').trim() || '#fff';
  }

  /** Fit the board to the space available, in whole pixels so the CSS grid
   *  rule underneath stays aligned with the cells drawn on top. */
  Renderer.prototype.resize = function (sim, availablePx) {
    var cell = Math.max(4, Math.floor(availablePx / sim.w));
    this.cell = cell;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    var cssW = cell * sim.w, cssH = cell * sim.h;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);

    var ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // The board's grid rule is a CSS background sized from this variable.
    this.canvas.parentNode.style.setProperty('--cell', cell + 'px');
    return cell;
  };

  Renderer.prototype.setSheet = function (img) { this.sheet = img; };

  Renderer.prototype.setMode = function (mode, sim) {
    this.mode = mode;
    this.drawAll(sim);
  };

  Renderer.prototype._drawCell = function (idx, sim) {
    var cell = this.cell, ctx = this.ctx;
    var x = (idx % sim.w) * cell, y = ((idx / sim.w) | 0) * cell;
    ctx.clearRect(x, y, cell, cell);

    var id = sim.grid[idx];
    if (id !== 0) {
      var arch = this.dex.dominant[id];
      if (this.mode === 'sprite' && this.sheet) {
        // Archetype tint behind the sprite: the secondary readability layer.
        ctx.fillStyle = this.tints[arch];
        ctx.fillRect(x, y, cell, cell);
        var size = this.dex.atlas.cell, cols = this.dex.atlas.cols;
        ctx.drawImage(this.sheet,
          ((id - 1) % cols) * size, (((id - 1) / cols) | 0) * size, size, size,
          x, y, cell, cell);
      } else {
        ctx.fillStyle = this.colors[arch];
        ctx.fillRect(x, y, cell, cell);
      }
    }

    if (idx === this.selected) {
      ctx.strokeStyle = this.selectColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
    }
  };

  Renderer.prototype.drawAll = function (sim) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (var i = 0; i < sim.n; i++) if (sim.grid[i] !== 0) this._drawCell(i, sim);
    if (this.selected >= 0) this._drawCell(this.selected, sim);
  };

  /** Repaint only what the last generation actually changed. */
  Renderer.prototype.drawChanged = function (sim) {
    for (var i = 0; i < sim.changedCount; i++) this._drawCell(sim.changed[i], sim);
    if (this.selected >= 0) this._drawCell(this.selected, sim);
  };

  Renderer.prototype.select = function (idx, sim) {
    var previous = this.selected;
    this.selected = idx;
    if (previous >= 0) this._drawCell(previous, sim);
    if (idx >= 0) this._drawCell(idx, sim);
  };

  Renderer.prototype.cellAt = function (clientX, clientY, sim) {
    var rect = this.canvas.getBoundingClientRect();
    var x = Math.floor((clientX - rect.left) / this.cell);
    var y = Math.floor((clientY - rect.top) / this.cell);
    if (x < 0 || y < 0 || x >= sim.w || y >= sim.h) return -1;
    return y * sim.w + x;
  };

  global.Renderer = Renderer;
})(window);
