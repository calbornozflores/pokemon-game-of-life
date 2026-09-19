# CLAUDE.md — pokemon-game-of-life

Conway's Game of Life across all 1025 National Pokédex species, with births
decided by a per-generation base-stat contest. Static site, no build step, no
runtime dependencies. Deployed to GitHub Pages from `main` at the repo root.

See `README.md` for the rules and how to run it.

---

## File map

| File | Lines | Role |
|---|---|---|
| `index.html` | ~95 | Markup. Loads the five scripts with `defer`, in dependency order |
| `css/style.css` (desktop block) | — | `@media (min-width:1240px) and (min-height:700px)` pins the page to `100dvh` so nothing scrolls; the sidebar is two `.sidebar-col` flex columns |
| `css/style.css` | ~290 | All styling. Opens with the shared design tokens |
| `js/sim.js` | ~200 | The rules. No DOM — the only file with tests |
| `js/data.js` | ~60 | Fetches `pokemon.json` + atlas, derives archetype colours |
| `js/render.js` | ~130 | Canvas drawing, spritesheet blits, dirty-cell repaint |
| `js/ui.js` | ~95 | Readouts, leaderboard, inspector |
| `js/main.js` | ~130 | Wiring, rAF clock, controls |
| `scripts/build_assets.py` | ~180 | One-time asset generator (uv) |
| `tests/sim.test.mjs` | ~150 | `node --test`, zero deps |

Scripts are plain (non-module) and communicate through globals — the same
pattern as `speed-reader` and `poke-dojo-web`, which keeps `open index.html`
working without a server. `js/sim.js` carries a `module.exports` tail so the
same file also loads under `node --test`.

---

## Things already learned the hard way

**The dex ends at 1025, not 1028.** `pokemon-species` on PokéAPI returns
`count: 1025`, ending at #1025 Pecharunt. Any larger figure for Gen I–IX default
forms is wrong.

**The `generation-viii/icons` sprites stop at #898.** Every Gen IX species 404s
there. `sprites/pokemon/{id}.png` is the set that covers the whole dex, uniformly
96×96, downscaled to 32×32 at build time. Gen IX entries are smooth 3D renders
rather than pixel art; at 32px that difference mostly washes out.

**Pillow cannot MEDIANCUT an RGBA image.** `FASTOCTREE` is the only quantizer
that takes one, and it does preserve the sprites' cutout alpha. Palettising takes
the sheet from 1304 KB to 282 KB, so it is worth doing.

**The database stores slugs, not display names** (`nidoran-f`, `ho-oh`,
`type-null`). One GraphQL request to `graphql.pokeapi.co/v1beta2` returns all
1025 English species names; doing it over the REST API would be 1025 requests.

**The board must be measured off `.board-panel`, not `.board`.** `.board` is
`inline-block`, so it shrink-wraps the canvas — measuring it feeds the canvas its
own previous size and the board collapses to 4px cells.

**Three separate ways the board collapsed while making the page fit one screen.**
All three share a shape: something the board's own size feeds into was used to
decide the board's size.
1. `.layout` had `align-items: start`, so `.board-panel` shrink-wrapped its
   canvas — and `fitBoard()` reads that panel's height. `align-items: stretch`.
2. `.layout`, the header, the controls and the footer all centre themselves with
   `margin: 0 auto`. Once `body` became a *column flex container*, an auto
   *cross-axis* margin makes an item shrink-to-fit, so the grid column collapsed
   onto the canvas (panel width 302px instead of 800px). They need
   `width: 100%`; `max-width` plus the auto margins still do the centring.
3. Reading the panel box straight after load raced the flex layout and clamped
   the board to its 280px floor. A `ResizeObserver` on the panel removes the
   race; `fitBoard()` early-returns when the cell size would not change, so the
   observer cannot feed back on itself.

A layout check that only asks "does it fit / does it scroll" passes happily with
a collapsed board. Assert instead that the board *fills* its panel — compare
`renderer.cell` against the cell size recomputed from the panel box.

**`fitBoard()` has to reserve the control bar's height.** The bar is
`position: sticky; bottom: 0`, so any board row underneath it is both invisible
and unclickable. This only showed up as an *intermittent* failure to inspect a
cell, because it depended on whether the clicked cell happened to be in the
bottom rows.

---

## Constraints that are load-bearing

**Double buffering is the rule, not an optimisation.** `step()` reads `grid` and
writes `next`, then swaps. Mutating in place corrupts neighbour counts partway
through the pass. `tests/sim.test.mjs` asserts the previous buffer is untouched.

**The stat is rolled once per generation, for the whole board** — not per cell.

**Survival never consults stats.** Only births do.

**The canvas is transparent.** Dead cells are `clearRect`-ed and the board's fill
and grid rule live in CSS underneath. That is what makes repainting only the
changed cells correct rather than merely cheap — and why `--cell` is pushed onto
`.board` as a CSS variable on every resize, to keep the CSS grid aligned with
the cells drawn on top.

**The spritesheet is not load-bearing.** It is fetched after first paint; if it
fails, the app falls back to flat archetype colours and keeps simulating.

**No external requests in production.** Stats and sprites are pre-bundled. The
browser check asserts this.

---

## Verification

Unit tests are not sufficient here — check the real page (see the root
`CLAUDE.md` rule):

```bash
node --test 'tests/*.test.mjs'
python3 -m http.server 8000     # then open it and watch it run
```

What to confirm in the browser: generation 0 shows 1025 live cells and 0 extinct;
the population crashes then stabilises; the rolled stat changes every generation;
extinction climbs and never falls; Step works only while paused; clicking a cell
— **including one in the bottom row** — opens the inspector with stats matching
the source database.

---

## Data provenance

`data/pokemon.json` is columnar (`names`, `types`, and a flat `stats` array of
6 values per species) so the client reads stats straight into a `Uint8Array`.
Every base stat of a default form fits in a byte — Blissey's 255 HP is the
maximum — and `build_assets.py` fails loudly if that ever stops being true.

`assets/sprites-atlas.json` is three numbers, not 1025 entries: sheet positions
are arithmetic from the dex id (`sx = ((id - 1) % cols) * cell`).
