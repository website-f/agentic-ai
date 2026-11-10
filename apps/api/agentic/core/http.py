"""P96: shared pieces for the many short-lived httpx clients on the agents' path.

Every httpx client built its own TLS context, reading the whole CA bundle from disk: about
40-50 ms of CPU each, on the event loop, even for plain-http calls to the browser service. A
task step makes several (each model call, each browser action), so with 25 steps running it
was ~14% of the worker's CPU (load harness, cProfile). One context made once serves every
client, and still verifies every certificate.

httpcore also tries `import sniffio` for every new connection lock. It is not installed
(anyio 4 no longer needs it), and a failed import searches the whole sys.path each time: ~1 ms
per try, ~7% of the worker's CPU. Recording it as absent once makes that a dict lookup.
"""

import importlib.util
import ssl
import sys
from functools import lru_cache

import httpx


@lru_cache(maxsize=1)
def tls() -> ssl.SSLContext:
    """The TLS context every client shares (certifi's CAs, as httpx's own default)."""
    return httpx.create_ssl_context()


def _sniffio_absent() -> None:
    if "sniffio" not in sys.modules and importlib.util.find_spec("sniffio") is None:
        sys.modules["sniffio"] = None  # type: ignore[assignment] - "import sniffio" fails fast


_sniffio_absent()
