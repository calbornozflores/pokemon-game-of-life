/* Loads the two bundled data files and derives what the renderer needs.
 * The spritesheet is loaded separately and deliberately not awaited -- the
 * simulation and the flat renderer work without it. */
(function (global) {
  'use strict';

  function loadDex() {
    return Promise.all([
      fetch('data/pokemon.json').then(function (r) { return r.json(); }),
      fetch('assets/sprites-atlas.json').then(function (r) { return r.json(); }),
    ]).then(function (parts) {
      var dex = parts[0], atlas = parts[1];
      var stats = Uint8Array.from(dex.stats);

      /* Each species' single highest base stat decides its archetype colour,
       * so territory reads as colour before any sprite is recognisable.
       * Ties fall to the earliest stat. */
      var dominant = new Uint8Array(dex.count + 1);
      for (var id = 1; id <= dex.count; id++) {
        var best = -1, bestIdx = 0;
        for (var s = 0; s < 6; s++) {
          var v = stats[(id - 1) * 6 + s];
          if (v > best) { best = v; bestIdx = s; }
        }
        dominant[id] = bestIdx;
      }

      return {
        count: dex.count,
        names: dex.names,
        types: dex.types,
        stats: stats,
        dominant: dominant,
        atlas: atlas,
      };
    });
  }

  function loadSheet() {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('spritesheet failed to load')); };
      img.src = 'assets/sprites.png';
    });
  }

  global.PokeData = { loadDex: loadDex, loadSheet: loadSheet };
})(window);
