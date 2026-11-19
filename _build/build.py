#!/usr/bin/env python3
"""Build the GitHub Pages site from local flashcard folders.

For every deck in decks.json: read the card data from <source>/Flashcards.html
(made by make_cards.py), copy <source>/audio/*.mp3, and write
<slug>/index.html (Mac version with sync) and <slug>/mobile.html (touch version).
Also writes the home page index.html.

Usage: python3 -I _build/build.py      (run from anywhere)
"""
import html, json, re, shutil
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
BUILD = SITE / "_build"
decks = json.loads((SITE / "decks.json").read_text(encoding="utf-8"))
templates = {name: (BUILD / f"{tpl}.html").read_text(encoding="utf-8")
             for name, tpl in (("index.html", "desktop"), ("mobile.html", "mobile"))}

rows = []
for d in decks:
    src = (SITE / d["source"]).resolve()
    page = (src / "Flashcards.html").read_text(encoding="utf-8")
    m = re.search(r"^const cards = (\[.*\]);$", page, re.M)
    if not m:
        raise SystemExit(f"no card data in {src}/Flashcards.html")
    cards = json.loads(m.group(1))
    out = SITE / d["slug"]
    (out / "audio").mkdir(parents=True, exist_ok=True)
    wanted = {Path(c["a"]).name for c in cards}
    for f in (out / "audio").glob("*.mp3"):
        if f.name not in wanted:
            f.unlink()
    for name in wanted:
        if not (out / "audio" / name).exists():
            shutil.copy2(src / "audio" / name, out / "audio" / name)
    for fname, tpl in templates.items():
        text = (tpl.replace("__TITLE__", html.escape(d["title"]))
                   .replace("__HEADING__", html.escape(d["title"]))
                   .replace("__EYEBROW__", html.escape(d.get("eyebrow", "Portuguese · Flashcards")))
                   .replace("__DECK__", d["slug"])
                   .replace("__DATA__", json.dumps(cards, ensure_ascii=False)))
        (out / fname).write_text(text, encoding="utf-8")
    sections = list(dict.fromkeys(c["s"] for c in cards))
    rows.append((d, len(cards), sections))
    print(f"{d['slug']}: {len(cards)} cards")

items = "\n".join(
    f'''    <li class="deck" data-deck="{d['slug']}" data-total="{n}">
      <div><h2>{html.escape(d['title'])}</h2><p>{n} cards · {html.escape(" · ".join(secs))}</p><p class="known"></p></div>
      <div class="links"><a class="btn primary" data-mobile href="{d['slug']}/mobile.html">Touch</a><a class="btn" data-desktop href="{d['slug']}/">Mac</a></div>
    </li>''' for d, n, secs in rows)
home = (BUILD / "home.html").read_text(encoding="utf-8").replace("__DECKS__", items)
(SITE / "index.html").write_text(home, encoding="utf-8")
print("index.html written")
