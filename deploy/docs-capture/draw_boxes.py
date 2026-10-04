"""Debug copies of the screenshots with their guide boxes drawn on (never shipped).

    uv run python ../../deploy/docs-capture/draw_boxes.py <jobs.json>
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw


def main() -> None:
    for j in json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")):
        dst = Path(j["dst"])
        dst.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(j["src"]) as im:
            im = im.convert("RGB")
            w, h = im.size
            d = ImageDraw.Draw(im)
            for b in j["boxes"]:
                x0, y0 = b["x"] * w, b["y"] * h
                x1, y1 = x0 + b["w"] * w, y0 + b["h"] * h
                d.rectangle([x0, y0, x1, y1], outline=(230, 30, 90), width=3)
                d.rectangle([x0, max(0, y0 - 18), x0 + 9 * len(b["id"]) + 8, y0], fill=(230, 30, 90))
                d.text((x0 + 4, max(0, y0 - 16)), b["id"], fill=(255, 255, 255))
            im.save(dst, "JPEG", quality=70)


if __name__ == "__main__":
    main()
