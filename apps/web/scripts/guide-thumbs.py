"""P122 (speed): small pictures for the guide's index cards and slide strips.

The cards showed each page's full screenshot (about 70 KB each; a wide screen fetched 15 to 25 of
them at once). A card shows only the top of the page at 16:10, about 400 px wide, so each shot gets
a thumbnail of exactly that: the top, 16:10, 480 px wide (sharp on most screens), WebP.
ShotThumb (src/guide/annotated-shot.tsx) uses /guide-media/thumbs/<name>.webp and falls back to the
full shot if a thumbnail is missing. Run after a new capture, from apps/web:

    python scripts/guide-thumbs.py
"""

from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SHOTS = HERE.parent / "public" / "guide-media" / "shots"
THUMBS = HERE.parent / "public" / "guide-media" / "thumbs"
WIDTH = 480


def main() -> None:
    THUMBS.mkdir(exist_ok=True)
    made = 0
    total = 0
    wanted = set()
    for src in sorted(SHOTS.glob("*.webp")):
        wanted.add(src.name)
        with Image.open(src) as im:
            im = im.convert("RGB")
            w, h = im.size
            top = im.crop((0, 0, w, min(h, round(w * 10 / 16))))
            ratio = WIDTH / w
            small = top.resize((WIDTH, max(1, round(top.height * ratio))), Image.LANCZOS) if w > WIDTH else top
            out = THUMBS / src.name
            small.save(out, "WEBP", quality=72, method=6)
            made += 1
            total += out.stat().st_size
    for old in THUMBS.glob("*.webp"):
        if old.name not in wanted:
            old.unlink()
    print(f"{made} thumbnails, {total // 1024} KB in all")


if __name__ == "__main__":
    main()
