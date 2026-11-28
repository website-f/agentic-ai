"""P149b: posters, flyers and social graphics from a small spec (design_poster).

The model never writes HTML, CSS or drawing code. It picks one of the ready-made templates
(templates.py: events, hiring, sale, safety notice, festive greetings, stats...), fills its
named text slots, and may name a palette, a size and the Library pictures to use. That spec
is a few hundred tokens; everything that makes the result look designed (grid, type scale,
balanced line breaks, palette, motifs, contrast) lives here, in code, and costs nothing.

- spec.py: sizes (print A4/A3, Instagram, WhatsApp status, Facebook, LinkedIn), palettes,
  font sets, the slot vocabulary, and validate() (every problem in one message).
- engine.py: the Pillow drawing kit: anti-aliased shapes, gradients, text fitting (shrink,
  wrap, balance, ellipsis as the last resort), photo cover/contain, logo chips, WCAG
  contrast checks.
- templates.py: the templates, each a layout that adapts to tall, square and wide sizes.
- render.py: spec + pictures -> PNG (print: 300 dpi) and PDF (exact paper size), plus a
  short description of what was drawn, so the agent can check its work without vision.

Fonts are bundled (fonts/, SIL Open Font License 1.1): Poppins, Bebas Neue, DM Serif
Display and Parisienne. Pillow + fpdf2 only: no browser and no new dependency.
"""

from .render import Rendered, render
from .spec import PALETTES, SIZES, SpecError, validate
from .templates import TEMPLATES, catalogue

__all__ = [
    "PALETTES",
    "SIZES",
    "TEMPLATES",
    "Rendered",
    "SpecError",
    "catalogue",
    "render",
    "validate",
]
