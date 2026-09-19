# Pokémon Game of Life

Conway's Game of Life played across the full National Pokédex. All **1025 species
(Gen I–IX)** start on a 70×70 toroidal board exactly once, then the board evolves
on its own under classic **B3/S23** — with one twist: when a cell is born, a
base-stat contest between the three neighbours that caused the birth decides
which species takes it.

**Live:** https://calbornozflores.github.io/pokemon-game-of-life/

## The rules

Standard Conway, Moore neighbourhoods, edges wrapping:

- A live cell with 2 or 3 live neighbours **survives, keeping its species**.
  Fewer than 2 dies of underpopulation, more than 3 of overcrowding.
- An empty cell with **exactly 3** live neighbours is **born**.
- Every cell is decided against the previous generation and committed at once.

The one departure, and it only ever applies to births:

1. Each generation rolls **one** of the six base stats at random — the same stat
   for the whole board, not per cell.
2. The newborn cell goes to whichever of its three parents has the highest value
   in that stat. Ties are broken uniformly at random.
3. Survival never consults stats. They decide *which species* wins a birth, never
   *whether* a birth or death happens.

After generation 0 species are no longer unique: one can spread across the board
or die out completely. A species with no cells left cannot come back — births
only ever draw from living neighbours — so the extinction count only rises.

**Expect a sharp crash in the first few generations.** Random placement leaves
most neighbourhoods unable to sustain themselves; the board falls from 1025 live
cells to a few hundred before settling into whatever pockets survived. That is
ordinary Game-of-Life behaviour, not the stat rule misfiring.

## Running it

No build step and no dependencies — it is plain HTML, CSS and JavaScript.

```bash
open index.html            # or, to avoid file:// quirks:
python3 -m http.server 8000
```

Controls: **Space** play/pause, **→** step one generation while paused, **R**
reset. The speed slider runs 1–30 generations per second, and the *Sprites*
toggle drops to flat archetype colours for slower devices.

## Tests

```bash
node --test 'tests/*.test.mjs'
```

Covers the rules themselves — oscillators (including across the torus seam),
still lives, under/overpopulation, stat-decided births, random tie-breaking,
simultaneous evaluation, population and extinction bookkeeping, and seed
reproducibility.

## Rebuilding the data

The three bundled assets are committed, so the site never needs this. Re-run it
only if the upstream data changes:

```bash
uv sync
uv run python scripts/build_assets.py
```

It reads base stats from `poke-dojo`'s local database, pulls English display
names from PokéAPI's GraphQL endpoint in one request, downloads the 1025 sprites
once into `.cache/`, and writes `data/pokemon.json`, `assets/sprites.png` and
`assets/sprites-atlas.json`.

## Deployment

GitHub Pages from `main` at the repository root. Everything ships as static
files; the deployed page makes **no external requests at all** and works offline
once loaded.

## Credits

Stats and sprites derived from [PokéAPI](https://pokeapi.co/). Pokémon and its
sprites are © Nintendo / Creatures Inc. / GAME FREAK inc. This is a personal,
non-commercial fan project — not for redistribution or monetisation.
