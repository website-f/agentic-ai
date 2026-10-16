"""Typed errors for Microsoft sign-in and Graph calls.

Every error's str() is a sentence for a person (often a `Msg`, so the API answers it in the
request's language). Catch `MicrosoftError` for "anything Microsoft", or a subclass:

- `NotConfigured`: no Entra ID app set up (Channels > Microsoft 365) or no tenant for
  app-only access yet (admin consent missing).
- `ReconnectNeeded`: Microsoft refused the person's refresh token (invalid_grant and the
  like). The account is marked `reconnect_needed` and syncing stops until they reconnect.
- `GraphError` (status, code): Graph answered an error. Subclasses by status:
  `Unauthorized` (401, after one token refresh), `Forbidden` (403), `NotFound` (404),
  `Gone` (410: a delta link expired; start a new round), `Throttled` (429/503/504 still
  failing after the bounded retries).
"""

from typing import Any


class MicrosoftError(Exception):
    def __init__(self, message: Any, status: int = 0) -> None:
        super().__init__(message)
        self.status = status


class NotConfigured(MicrosoftError):
    pass


class ReconnectNeeded(MicrosoftError):
    pass


class GraphError(MicrosoftError):
    def __init__(self, message: Any, status: int = 0, code: str = "") -> None:
        super().__init__(message, status)
        self.code = code


class Unauthorized(GraphError):
    pass


class Forbidden(GraphError):
    pass


class NotFound(GraphError):
    pass


class Gone(GraphError):
    pass


class Throttled(GraphError):
    pass


def for_status(status: int) -> type[GraphError]:
    return {401: Unauthorized, 403: Forbidden, 404: NotFound, 410: Gone}.get(
        status, Throttled if status in (429, 503, 504) else GraphError
    )
