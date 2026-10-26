import re
import unicodedata


def slugify(value: str, fallback: str = "item") -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")
    return slug[:60] or fallback


# Characters a spreadsheet treats as the start of a formula (CSV / formula injection).
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(value: object) -> object:
    """A CSV cell that cannot run as a formula when opened in Excel or Sheets: text starting
    with = + - @ (or a tab / carriage return) is prefixed with a quote. Other values as they are."""
    if isinstance(value, str) and value.startswith(_FORMULA_START):
        return "'" + value
    return value
