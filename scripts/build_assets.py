#!/usr/bin/env python3
"""One-time generator for the static assets shipped with Pokemon Game of Life.

Produces three committed files so the deployed site makes no external calls:

    data/pokemon.json          names, types and the 6 base stats, columnar
    assets/sprites.png         every species packed into one spritesheet
    assets/sprites-atlas.json  the 3 numbers needed to index that sheet

Stats come from poke-dojo's SQLite database (read-only) rather than PokeAPI --
it already holds all 1025 species with their base stats. Display names come
from one PokeAPI GraphQL request, because the database stores slugs
("nidoran-f", "ho-oh", "type-null"). Sprites are downloaded once into .cache/
and reused on later runs.

Run:  uv run python scripts/build_assets.py
"""
from __future__ import annotations

import io
import json
import sqlite3
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC_DB = Path.home() / "code/personal/poke-dojo/data/pokemon.db"
CACHE = ROOT / ".cache" / "sprites"

SPRITE_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon"
GRAPHQL_URL = "https://graphql.pokeapi.co/v1beta2"

COUNT = 1025          # National Pokedex through Gen IX ends at #1025 Pecharunt
SHEET_COLS = 33       # 33 x 32 = 1056 slots, enough for 1025
SIZE_GATE = 1_500_000  # repack smaller if the sheet exceeds this
STAT_KEYS = ("hp", "attack", "defense", "sp_attack", "sp_defense", "speed")


def load_stats() -> list[sqlite3.Row]:
    """Read every species out of poke-dojo's database, read-only."""
    if not SRC_DB.exists():
        sys.exit(f"poke-dojo database not found at {SRC_DB}")
    con = sqlite3.connect(f"file:{SRC_DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT id, name, type1, type2, hp, attack, defense, sp_attack, sp_defense, speed "
        "FROM pokemon ORDER BY id"
    ).fetchall()
    con.close()

    if len(rows) != COUNT:
        sys.exit(f"expected {COUNT} species in the database, got {len(rows)}")
    if [r["id"] for r in rows] != list(range(1, COUNT + 1)):
        sys.exit("database ids are not a contiguous 1..1025 range")
    return rows


def fetch_display_names() -> list[str]:
    """One GraphQL request for all English species names.

    The database stores API slugs; this is what turns them into "Nidoran-F"
    -> "Nidoran♀", "farfetchd" -> "Farfetch'd", "type-null" -> "Type: Null".
    Species names are form-agnostic, which is exactly right here -- the board
    holds one cell per species, not per form.
    """
    query = """
    {
      pokemonspeciesname(
        where: {language_id: {_eq: 9}, pokemon_species_id: {_lte: %d}}
        order_by: {pokemon_species_id: asc}
      ) { pokemon_species_id name }
    }
    """ % COUNT
    resp = requests.post(GRAPHQL_URL, json={"query": query}, timeout=30)
    resp.raise_for_status()
    payload = resp.json()
    if "errors" in payload:
        sys.exit(f"GraphQL error: {payload['errors']}")

    rows = payload["data"]["pokemonspeciesname"]
    if len(rows) != COUNT:
        sys.exit(f"expected {COUNT} display names, got {len(rows)}")

    names = [""] * COUNT
    for row in rows:
        names[row["pokemon_species_id"] - 1] = row["name"]
    if not all(names):
        sys.exit("some species came back without a display name")
    return names


def download_sprite(dex_id: int) -> None:
    """Fetch one 96x96 sprite into the cache, skipping what is already there.

    The generation-viii icon sprites suggested for this kind of grid stop at
    #898, so they 404 for every Gen IX species. These default front sprites
    cover the whole dex at a uniform 96x96.
    """
    dest = CACHE / f"{dex_id}.png"
    if dest.exists() and dest.stat().st_size > 0:
        return
    resp = requests.get(f"{SPRITE_BASE}/{dex_id}.png", timeout=30)
    resp.raise_for_status()
    dest.write_bytes(resp.content)


def download_sprites() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    missing = [i for i in range(1, COUNT + 1) if not (CACHE / f"{i}.png").exists()]
    if not missing:
        print(f"sprites: {COUNT} already cached")
        return
    print(f"sprites: downloading {len(missing)}...")
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(download_sprite, missing))
    print(f"sprites: {COUNT} cached in {CACHE}")


def pack_sheet(cell: int) -> bytes:
    """Downscale every sprite to `cell` px and lay them out in one image."""
    rows = -(-COUNT // SHEET_COLS)
    sheet = Image.new("RGBA", (SHEET_COLS * cell, rows * cell), (0, 0, 0, 0))
    for dex_id in range(1, COUNT + 1):
        with Image.open(CACHE / f"{dex_id}.png") as src:
            icon = src.convert("RGBA").resize((cell, cell), Image.LANCZOS)
        idx = dex_id - 1
        sheet.paste(icon, ((idx % SHEET_COLS) * cell, (idx // SHEET_COLS) * cell))

    # Keep whichever of full-colour and palettised comes out smaller. FASTOCTREE
    # is the only quantizer Pillow allows on RGBA, and it keeps a transparent
    # palette entry, so the sprites' cutout alpha survives.
    buf = io.BytesIO()
    sheet.save(buf, "PNG", optimize=True)
    rgba = buf.getvalue()

    buf = io.BytesIO()
    sheet.quantize(colors=255, method=Image.FASTOCTREE).save(buf, "PNG", optimize=True)
    palette = buf.getvalue()

    print(f"sheet @{cell}px: rgba {len(rgba)/1024:.0f} KB, "
          f"palette {len(palette)/1024:.0f} KB -> "
          f"{'palette' if len(palette) < len(rgba) else 'rgba'}")
    return palette if len(palette) < len(rgba) else rgba


def main() -> None:
    rows = load_stats()
    names = fetch_display_names()
    download_sprites()

    cell = 32
    sheet = pack_sheet(cell)
    if len(sheet) > SIZE_GATE:
        print(f"sheet is {len(sheet)/1024:.0f} KB, over the gate -- repacking at 24px")
        cell = 24
        sheet = pack_sheet(cell)

    (ROOT / "assets" / "sprites.png").write_bytes(sheet)
    (ROOT / "assets" / "sprites-atlas.json").write_text(
        json.dumps({"cell": cell, "cols": SHEET_COLS, "count": COUNT})
    )

    # Columnar rather than a list of objects: the client reads `stats` straight
    # into a Uint8Array (every base stat of a default form fits in a byte --
    # Blissey's 255 HP is the maximum).
    stats: list[int] = []
    for row in rows:
        stats.extend(row[k] for k in STAT_KEYS)
    if max(stats) > 255:
        sys.exit("a base stat exceeds 255; Uint8Array packing is no longer valid")

    (ROOT / "data" / "pokemon.json").write_text(json.dumps({
        "count": COUNT,
        "names": names,
        "types": [[r["type1"], r["type2"]] for r in rows],
        "stats": stats,
    }, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    print(f"wrote data/pokemon.json ({(ROOT / 'data' / 'pokemon.json').stat().st_size/1024:.0f} KB)")
    print(f"wrote assets/sprites.png ({len(sheet)/1024:.0f} KB, {cell}px cells)")


if __name__ == "__main__":
    main()
