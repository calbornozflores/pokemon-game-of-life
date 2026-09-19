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
     * so measuring it would feed back its own previous size.
     *
     * Height matters as much as width: the control bar is sticky, so any board
     * row that ends up underneath it is both hidden and unclickable. Reserve
     * its real height rather than guessing. */
    var boardTop = els.board.getBoundingClientRect().top + window.scrollY;
    var reserved = boardTop + els.controls.offsetHeight + 56;  // 56 = status line + gaps
    var available = Math.min(
      els.board.parentNode.clientWidth,
      Math.max(420, window.innerHeight - reserved)
    );
    renderer.resize(sim, available);
    renderer.drawAll(sim);
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

    fitBoard();
    ui.showInspector(0);
    refresh();
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
