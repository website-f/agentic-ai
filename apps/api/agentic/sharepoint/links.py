"""P80: a pasted SharePoint / OneDrive link, and the read-only Graph calls on what it points to.

Only https links on *.sharepoint.com, onedrive.live.com or 1drv.ms are accepted: anything
else is refused before Microsoft is asked. A link (a sharing link or a plain folder address)
is resolved with GET /shares/{u!base64url(link)}/driveItem using the person's own delegated
token, so it opens exactly what that person may already open, nothing more.

A folder is walked breadth-first (sorted by name, so a capped walk always keeps the same
files), down to settings.sharepoint_max_depth and up to sharepoint_max_files supported files
and sharepoint_max_folders folders. Only Word, Excel, PowerPoint, PDF, text, Markdown and CSV
files are taken. A file's content is downloaded into memory (never stored) from the short
pre-signed address Graph redirects to; that address must be https on Microsoft's file hosts.
"""

import base64
import urllib.parse
from collections import deque
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..core.config import settings
from ..i18n import Msg
from ..microsoft import http
from ..microsoft.errors import GraphError
from ..microsoft.graph import GRAPH, Graph

TYPES = (".docx", ".xlsx", ".pptx", ".pdf", ".txt", ".md", ".csv")
LINK_HOSTS = ("sharepoint.com",)  # and any subdomain: contoso.sharepoint.com, -my.
EXACT_HOSTS = frozenset({"onedrive.live.com", "1drv.ms"})
# Where Graph's pre-signed download addresses live (SharePoint, OneDrive for Business and
# personal OneDrive). Nothing else is ever fetched.
DOWNLOAD_HOSTS = ("sharepoint.com", "1drv.com", "livefilestore.com", "live.net", "onedrive.com")
ITEM_FIELDS = "id,name,webUrl,file,folder,size,eTag,cTag,parentReference,lastModifiedDateTime"
MAX_LINK = 2000
PAGE = 200


class BadLink(ValueError):
    """The pasted text is not a link the Library may open (message for the person)."""

    def __init__(self, message: Msg) -> None:
        super().__init__(message)
        self.message = message


def _host_ok(host: str, suffixes: tuple[str, ...], exact: frozenset[str] = frozenset()) -> bool:
    host = host.lower().rstrip(".")
    return host in exact or any(host == s or host.endswith("." + s) for s in suffixes)


def check_link(raw: str) -> str:
    """The link, trimmed, when it is an https SharePoint / OneDrive address; else BadLink."""
    url = (raw or "").strip()
    if not url:
        raise BadLink(Msg("Paste the link to a SharePoint or OneDrive folder."))
    if len(url) > MAX_LINK or any(c.isspace() for c in url):
        raise BadLink(Msg("That does not look like one link. Paste just the folder's link."))
    try:
        u = urllib.parse.urlsplit(url)
        port = u.port
    except ValueError as e:
        raise BadLink(Msg("That does not look like one link. Paste just the folder's link.")) from e
    if u.scheme != "https" or u.username or u.password or port not in (None, 443):
        raise BadLink(Msg("Only https links to SharePoint or OneDrive can be connected."))
    host = (u.hostname or "").lower()
    if not _host_ok(host, LINK_HOSTS, EXACT_HOSTS):
        raise BadLink(
            Msg(
                "Only SharePoint (sharepoint.com) and OneDrive links can be connected. Copy the "
                "link from SharePoint or OneDrive with Share or Copy link."
            )
        )
    return url


def provider_of(url: str) -> str:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if host in EXACT_HOSTS or host.endswith("-my.sharepoint.com"):
        return "onedrive"
    return "sharepoint"


def share_id(url: str) -> str:
    """Graph's id for a sharing link: "u!" + unpadded base64url of the link."""
    raw = base64.urlsafe_b64encode(url.encode("utf-8")).decode("ascii").rstrip("=")
    return f"u!{raw}"


def supported(name: str) -> bool:
    return name.lower().endswith(TYPES)


def _q(graph_id: str) -> str:
    return urllib.parse.quote(graph_id, safe="")


@dataclass
class Item:
    """A drive item, as the Library keeps it."""

    drive_id: str
    item_id: str
    name: str
    web_url: str
    is_folder: bool
    size: int = 0
    etag: str = ""
    ctag: str = ""
    path: str = ""  # within the linked folder, e.g. "HR/Leave policy.docx"

    @classmethod
    def of(cls, d: dict[str, Any], drive_id: str = "", path: str = "") -> "Item":
        parent = d.get("parentReference") or {}
        return cls(
            drive_id=str(parent.get("driveId") or drive_id),
            item_id=str(d.get("id") or ""),
            name=str(d.get("name") or "")[:300],
            web_url=str(d.get("webUrl") or ""),
            is_folder="folder" in d,
            size=int(d.get("size") or 0),
            etag=str(d.get("eTag") or "")[:200],
            ctag=str(d.get("cTag") or "")[:200],
            path=path[:1000],
        )


@dataclass
class Walk:
    files: list[Item] = field(default_factory=list)
    skipped: int = 0  # files of other types (pictures, zips, videos)
    capped: bool = False  # more than the limits: only the first files were taken
    folders: int = 0


async def resolve(g: Graph, url: str) -> Item:
    """What the link points to (a folder or a file). Raises GraphError subclasses."""
    body = await g.request(
        "GET",
        f"/shares/{share_id(url)}/driveItem",
        params={"$select": ITEM_FIELDS},
        prefer=["redeemSharingLinkIfNecessary"],
    )
    item = Item.of(body)
    if not item.drive_id or not item.item_id:
        raise GraphError(Msg("Microsoft did not say which folder that link opens."), 404)
    return item


async def get_item(g: Graph, drive_id: str, item_id: str) -> Item:
    body = await g.request(
        "GET", f"/drives/{_q(drive_id)}/items/{_q(item_id)}", params={"$select": ITEM_FIELDS}
    )
    return Item.of(body, drive_id)


async def children(g: Graph, drive_id: str, item_id: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    path: str | None = f"/drives/{_q(drive_id)}/items/{_q(item_id)}/children"
    params: dict[str, Any] | None = {"$select": ITEM_FIELDS, "$top": PAGE}
    while path:
        body = await g.request("GET", path, params=params)
        out += list(body.get("value") or [])
        path, params = body.get("@odata.nextLink"), None
    return out


async def walk(
    g: Graph,
    root: Item,
    *,
    max_files: int | None = None,
    max_depth: int | None = None,
    max_folders: int | None = None,
) -> Walk:
    """The supported files under a folder (or the one file a link points to), bounded."""
    max_files = max_files or settings.sharepoint_max_files
    max_depth = settings.sharepoint_max_depth if max_depth is None else max_depth
    max_folders = max_folders or settings.sharepoint_max_folders
    out = Walk()
    if not root.is_folder:
        root.path = root.name
        if supported(root.name):
            out.files.append(root)
        else:
            out.skipped += 1
        return out
    queue: deque[tuple[str, str, int]] = deque([(root.item_id, "", 0)])
    while queue:
        folder_id, prefix, depth = queue.popleft()
        out.folders += 1
        rows = sorted(await children(g, root.drive_id, folder_id), key=lambda d: str(d["name"]))
        for d in rows:
            name = str(d.get("name") or "")
            path = f"{prefix}{name}"
            if "folder" in d:
                if depth + 1 > max_depth or out.folders + len(queue) >= max_folders:
                    out.capped = True
                    continue
                queue.append((str(d["id"]), f"{path}/", depth + 1))
            elif "file" in d:
                if not supported(name):
                    out.skipped += 1
                elif len(out.files) >= max_files:
                    out.capped = True
                else:
                    out.files.append(Item.of(d, root.drive_id, path))
    return out


class TooLarge(ValueError):
    pass


def _download_ok(url: str) -> bool:
    u = urllib.parse.urlsplit(url)
    return u.scheme == "https" and _host_ok(u.hostname or "", DOWNLOAD_HOSTS)


async def download(g: Graph, drive_id: str, item_id: str, max_bytes: int) -> bytes:
    """A file's content, in memory. Graph answers /content with a redirect to a short-lived
    pre-signed address on Microsoft's file hosts; that one is fetched without our token."""
    path = f"{GRAPH}/drives/{_q(drive_id)}/items/{_q(item_id)}/content"
    refreshed = False
    while True:
        token = await g._token(refreshed)  # noqa: SLF001 - the Graph's own token source
        async with http.client() as c:
            r = await c.get(path, headers={"Authorization": f"Bearer {token}"})
        if r.status_code == 401 and not refreshed:
            refreshed = True
            continue
        break
    if r.status_code in (301, 302, 303, 307, 308):
        where = r.headers.get("location", "")
        if not _download_ok(where):
            raise GraphError(Msg("Refused a download address that is not Microsoft's."), 0)
        return await _fetch(where, max_bytes)
    if r.status_code >= 400:
        from ..microsoft.graph import _error

        raise _error(r)
    if len(r.content) > max_bytes:
        raise TooLarge()
    return r.content


async def _fetch(url: str, max_bytes: int) -> bytes:
    data = bytearray()
    try:
        async with http.client() as c, c.stream("GET", url) as r:
            if r.status_code >= 400:
                raise GraphError(
                    Msg("Microsoft answered {status} for the file.", status=r.status_code),
                    r.status_code,
                )
            async for chunk in r.aiter_bytes():
                data += chunk
                if len(data) > max_bytes:
                    raise TooLarge()
    except httpx.TransportError as e:
        raise GraphError(
            Msg("Could not reach Microsoft Graph ({why}).", why=type(e).__name__), 0
        ) from e
    return bytes(data)
