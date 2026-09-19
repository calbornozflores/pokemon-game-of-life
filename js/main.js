/* Wiring: builds the simulation, drives the clock, connects the controls. */
(function () {
  'use strict';

  var GRID_W = 70, GRID_H = 70;   // 4900 cells -> 1025 species is 20.9% density

  var sim, renderer, ui, dex;
  var running = false, gps = 8, accumulator = 0, lastFrame = 0, startingNote = '';

  var els = {
    board: document.getElementById('board'),
    canvas: document.getElementById('grid'),
    playPause: document.getElementById('playPause'),
    step: document.getElementById('step'),
    reset: document.getElementById('reset'),
    speed: document.getElementById('speed'),
    speedValue: document.getElementById('speedValue'),
    spriteMode: document.getElementById('spriteMode'),
    status: document.getElementById('status'),
    controls: document.querySelector('.controls'),
    footer: document.querySelector('.site-footer'),
  };

  function refresh() {
    ui.updateReadouts(sim);
    ui.updateLeaderboard(sim);
    // The opening note describes generation 0 only; drop it once it is stale.
    if (sim.generation > 0 && els.status.textContent) els.status.textContent = '';
  }

  function setRunning(next) {
    running = next;
    els.playPause.textContent = running ? 'Pause' : 'Start';
    els.playPause.classList.toggle('is-running', running);
    els.step.disabled = running;          // stepping only makes sense while paused
  }

  function stepOnce() {
    sim.step();
    renderer.drawChanged(sim);
    refresh();
  }

  function frame(now) {
    if (!lastFrame) lastFrame = now;
    var dt = now - lastFrame;
    lastFrame = now;

    if (running) {
      accumulator += dt;
      var interval = 1000 / gps, steps = 0;
      while (accumulator >= interval && steps < 4) { sim.step(); accumulator -= interval; steps++; }
      if (steps === 1) renderer.drawChanged(sim);
      else if (steps > 1) renderer.drawAll(sim);   // one change list cannot cover several steps
      if (steps) refresh();
      if (accumulator > interval * 4) accumulator = 0;
    }
    requestAnimationFrame(frame);
  }

  function fitBoard() {
    /* Measure the grid column, not `.board` -- `.board` shrink-wraps the canvas,
     * so measuring it would feed back its own previous size. */
    var panel = els.board.parentNode;
    var availableH;

    if (window.matchMedia('(min-width: 1240px) and (min-height: 700px)').matches) {
      /* The page is pinned to the viewport, so the flex layout has already
       * worked out what is left for the board. Measuring that beats adding up
       * the chrome by hand -- the arithmetic version silently omitted the
       * footer and overflowed the page by up to 54px. */
      availableH = panel.clientHeight - els.status.offsetHeight - 10;
    } else {
      /* Flowing layout: subtract the chrome below the board. The control bar is
       * sticky, so any row left underneath it is hidden and unclickable. */
      var boardTop = els.board.getBoundingClientRect().top + window.scrollY;
      availableH = window.innerHeight - boardTop - els.controls.offsetHeight
        - els.footer.offsetHeight - 56;
    }

    var size = Math.min(panel.clientWidth, Math.max(280, availableH));
    if (renderer.cell === Math.max(4, Math.floor(size / sim.w))) return;  // nothing to redo
    renderer.resize(sim, size);
    renderer.drawAll(sim);
  }

  /* Re-fit whenever the panel's box actually changes. Reading the box straight
   * after load raced the flex layout and clamped the board to its 280px floor;
   * observing the element instead of guessing when layout has settled removes
   * the race entirely, and covers later reflows for free. The early return in
   * fitBoard() above keeps this from feeding back on itself. */
  function watchPanel() {
    if (typeof ResizeObserver !== 'function') return;
    new ResizeObserver(function () { fitBoard(); }).observe(els.board.parentNode);
  }

  function resetBoard() {
    sim.reset((Math.random() * 0xFFFFFFFF) >>> 0);
    renderer.select(-1, sim);
    ui.showInspector(0);
    ui.lastTop = '';
    renderer.drawAll(sim);
    refresh();
    els.status.textContent = startingNote;
  }

  PokeData.loadDex().then(function (loaded) {
    dex = loaded;
    sim = new Life({
      width: GRID_W, height: GRID_H,
      speciesCount: dex.count, stats: dex.stats,
    });
    renderer = new Renderer(els.canvas, dex);
    ui = new UI(dex);

    // Debug handles: lets the board be inspected and driven from the console.
    window.__sim = sim;
    window.__renderer = renderer;

    ui.showInspector(0);
    refresh();
    fitBoard();
    watchPanel();
    startingNote = 'Generation 0 — all ' + dex.count + ' species placed, one cell each. Press Start.';
    els.status.textContent = startingNote;

    // The sheet is not load-bearing -- the board is already live in flat mode.
    PokeData.loadSheet().then(function (img) {
      renderer.setSheet(img);
      if (renderer.mode === 'sprite') renderer.drawAll(sim);
    }).catch(function () {
      els.spriteMode.checked = false;
      renderer.setMode('flat', sim);
      els.status.textContent = 'Spritesheet unavailable — running in flat colour mode.';
    });

    els.playPause.addEventListener('click', function () { setRunning(!running); });
    els.step.addEventListener('click', stepOnce);
    els.reset.addEventListener('click', resetBoard);

    els.speed.addEventListener('input', function () {
      gps = Number(els.speed.value);
      els.speedValue.textContent = gps + ' gen/s';
      accumulator = 0;
    });

    els.spriteMode.addEventListener('change', function () {
      renderer.setMode(els.spriteMode.checked ? 'sprite' : 'flat', sim);
    });

    els.canvas.addEventListener('click', function (event) {
      var idx = renderer.cellAt(event.clientX, event.clientY, sim);
      if (idx < 0) return;
      var id = sim.grid[idx];
      renderer.select(id ? idx : -1, sim);
      ui.showInspector(id);
    });

    window.addEventListener('keydown', function (event) {
      if (event.target.tagName === 'INPUT') return;
      if (event.code === 'Space') { event.preventDefault(); setRunning(!running); }
      else if (event.code === 'ArrowRight' && !running) stepOnce();
      else if (event.key === 'r' || event.key === 'R') resetBoard();
    });

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fitBoard, 120);
    });

    requestAnimationFrame(frame);
  }).catch(function (err) {
    els.status.textContent = 'Could not load the Pokédex data: ' + err.message;
  });
})();
