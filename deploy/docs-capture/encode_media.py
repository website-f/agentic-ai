"""Turn the capture's PNG screenshots into WebP (quality 78) and report sizes.

    uv run python ../../deploy/docs-capture/encode_media.py <jobs.json>

jobs.json: [{"src": ".work/png/agents-desktop.png", "dst": ".../shots/agents-desktop.webp"}]
Also accepts {"poster": true} jobs (a JPEG frame from ffmpeg turned into WebP).
Prints the total bytes written.
"""

import json
import sys
from pathlib import Path

from PIL import Image

QUALITY = 78


def main() -> None:
    jobs = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    total = 0
    for j in jobs:
        src, dst = Path(j["src"]), Path(j["dst"])
        dst.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(src) as im:
            im = im.convert("RGB")
            im.save(dst, "WEBP", quality=j.get("quality", QUALITY), method=6)
        total += dst.stat().st_size
    print(json.dumps({"files": len(jobs), "bytes": total}))


if __name__ == "__main__":
    main()
