"""Fill a template's {{placeholders}} from the company kit, the document's field values, and
computed line-item totals.

Namespaces: {{company.legal_name}} (any kit key, custom ones too), {{doc.number}},
{{doc.title}}, {{doc.date}}, {{today}}, {{items}} (a line-item table with totals),
{{subtotal}}, {{tax}}, {{total}}, {{total_words}}, {{signature}}, and each field's own key.
A placeholder with no value renders as [[Its label]] so people and the checks can see it.
"""

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}")
MISSING = re.compile(r"\[\[([^\]\n]{1,80})\]\]")

# The company kit: what every document about a company reuses. Grouped for the form.
KIT_FIELDS: list[dict[str, str]] = [
    {"key": "legal_name", "label": "Legal name", "group": "Identity"},
    {"key": "trading_name", "label": "Trading name", "group": "Identity"},
    {"key": "reg_no", "label": "Registration no.", "group": "Identity"},
    {"key": "tax_no", "label": "Tax / SST no.", "group": "Identity"},
    {"key": "incorporated_on", "label": "Incorporated on", "group": "Identity"},
    {"key": "address", "label": "Address", "group": "Contact", "type": "longtext"},
    {"key": "phone", "label": "Phone", "group": "Contact"},
    {"key": "email", "label": "Email", "group": "Contact"},
    {"key": "website", "label": "Website", "group": "Contact"},
    {"key": "bank_name", "label": "Bank", "group": "Bank"},
    {"key": "bank_account", "label": "Account no.", "group": "Bank"},
    {"key": "bank_holder", "label": "Account holder", "group": "Bank"},
    {"key": "signatory_name", "label": "Signatory name", "group": "People"},
    {"key": "signatory_title", "label": "Signatory title", "group": "People"},
    {
        "key": "directors",
        "label": "Directors (one per line)",
        "group": "People",
        "type": "longtext",
    },
    {"key": "currency", "label": "Currency", "group": "Money"},
    {"key": "tax_label", "label": "Tax label", "group": "Money"},
    {"key": "tax_rate", "label": "Tax rate (%)", "group": "Money", "type": "number"},
    {"key": "payment_terms", "label": "Payment terms", "group": "Money"},
    {"key": "language", "label": "Document language", "group": "Brand", "type": "choice"},
    {"key": "accent", "label": "Brand colour", "group": "Brand"},
    {"key": "footer_note", "label": "Footer note", "group": "Brand"},
]
KIT_KEYS = {f["key"] for f in KIT_FIELDS}
KIT_LABELS = {f["key"]: f["label"] for f in KIT_FIELDS}
CORE_KIT = ("legal_name", "reg_no", "address", "phone", "email", "signatory_name")

FIELD_TYPES = ("text", "longtext", "date", "number", "money", "items", "choice")

BUILTIN_LABELS = {
    "today": "Today's date",
    "doc.number": "Document number",
    "doc.title": "Document title",
    "doc.date": "Document date",
    "items": "Line items",
    "subtotal": "Subtotal",
    "tax": "Tax",
    "total": "Total",
    "total_words": "Total in words",
    "signature": "Signature block",
}


@dataclass
class Filled:
    markdown: str
    missing: list[str] = field(default_factory=list)  # labels with no value
    totals: dict[str, float] | None = None
    items: list[dict[str, Any]] = field(default_factory=list)


def number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    text = re.sub(r"[^\d.\-]", "", str(value or ""))
    if not text or text in ("-", ".", "-."):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def money(x: float) -> str:
    return f"{x:,.2f}"


_MS_MONTHS = (
    "Januari",
    "Februari",
    "Mac",
    "April",
    "Mei",
    "Jun",
    "Julai",
    "Ogos",
    "September",
    "Oktober",
    "November",
    "Disember",
)
# Words a Malay letter or form uses that an English one does not.
_MALAY_BODY = re.compile(
    r"\b(Tarikh|Kepada|Tuan/Puan|Yang benar|Sekian|Dengan hormatnya|Ruj\. kami|Perkara)\b"
)


def body_language(body: str) -> str:
    """ms when the template is written in Malay (two or more Malay letter words), else en."""
    return "ms" if len(set(_MALAY_BODY.findall(body or ""))) >= 2 else "en"


def fmt_date(value: Any, lang: str = "en") -> str:
    if isinstance(value, date):
        d = value
    else:
        try:
            d = date.fromisoformat(str(value).strip()[:10])
        except ValueError:
            return str(value or "")
    if lang == "ms":
        return f"{d.day} {_MS_MONTHS[d.month - 1]} {d.year}"
    return f"{d.day} {d:%B %Y}"


_ONES = (
    "Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen "
    "Fifteen Sixteen Seventeen Eighteen Nineteen"
).split()
_TENS = "_ _ Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety".split()


def _words(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("-" + _ONES[n % 10] if n % 10 else "")
    if n < 1000:
        rest = n % 100
        return _ONES[n // 100] + " Hundred" + (" " + _words(rest) if rest else "")
    for size, name in ((10**9, "Billion"), (10**6, "Million"), (1000, "Thousand")):
        if n >= size:
            rest = n % size
            return _words(n // size) + f" {name}" + (" " + _words(rest) if rest else "")
    return str(n)


_MS_ONES = ("Kosong Satu Dua Tiga Empat Lima Enam Tujuh Lapan Sembilan Sepuluh Sebelas").split()


def _words_ms(n: int) -> str:
    """Malay number words: 54000 -> Lima Puluh Empat Ribu."""
    if n < 12:
        return _MS_ONES[n]
    if n < 20:
        return _MS_ONES[n - 10] + " Belas"
    if n < 100:
        rest = n % 10
        return _MS_ONES[n // 10] + " Puluh" + (" " + _MS_ONES[rest] if rest else "")
    for size, one, name in (
        (10**9, "Satu Bilion", "Bilion"),
        (10**6, "Sejuta", "Juta"),
        (1000, "Seribu", "Ribu"),
        (100, "Seratus", "Ratus"),
    ):
        if n >= size:
            head, rest = divmod(n, size)
            text = one if head == 1 else f"{_words_ms(head)} {name}"
            return text + (" " + _words_ms(rest) if rest else "")
    return str(n)


def amount_in_words(x: float, currency: str = "RM", lang: str = "en") -> str:
    whole = int(abs(x))
    cents = round((abs(x) - whole) * 100)
    if cents == 100:
        whole, cents = whole + 1, 0
    name = {"RM": "Ringgit Malaysia", "MYR": "Ringgit Malaysia"}.get(currency.upper(), currency)
    if lang == "ms":
        text = f"{name} {_words_ms(whole)}"
        if cents:
            text += f" dan Sen {_words_ms(cents)}"
        return text + " Sahaja"
    text = f"{name} {_words(whole)}"
    if cents:
        text += f" and Cents {_words(cents)}"
    return text + " Only"


def clean_items(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict):
            continue
        desc = str(r.get("description") or "").strip()[:500]
        qty = number(r.get("qty"))
        price = number(r.get("unit_price"))
        if not desc and qty is None and price is None:
            continue
        q = qty if qty is not None else 1.0
        p = price if price is not None else 0.0
        out.append(
            {
                "description": desc,
                "qty": q,
                "unit": str(r.get("unit") or "").strip()[:20],
                "unit_price": p,
                "amount": round(q * p, 2),
            }
        )
    return out[:200]


def _qty(q: float) -> str:
    return str(int(q)) if float(q).is_integer() else f"{q:g}"


_ITEM_HEADS = {
    "en": ("No.", "Description", "Qty", "Unit price", "Amount", "Subtotal", "Total"),
    "ms": ("Bil.", "Perkara", "Kuantiti", "Harga seunit", "Jumlah", "Jumlah kecil", "Jumlah besar"),
}


def items_table(
    items: list[dict[str, Any]], totals: dict[str, float], cur: str, tax: str, lang: str = "en"
) -> str:
    no, desc, qty, price, amount, sub, total = _ITEM_HEADS.get(lang, _ITEM_HEADS["en"])
    head = f"| {no} | {desc} | {qty} | {price} ({cur}) | {amount} ({cur}) |\n|---|---|---|---|---|"
    rows = [
        f"| {i} | {it['description']} | {_qty(it['qty'])}{(' ' + it['unit']) if it['unit'] else ''}"
        f" | {money(it['unit_price'])} | {money(it['amount'])} |"
        for i, it in enumerate(items, 1)
    ]
    rows.append(f"|  |  |  | **{sub}** | **{money(totals['subtotal'])}** |")
    if totals.get("tax"):
        rows.append(f"|  |  |  | {tax} | {money(totals['tax'])} |")
    rows.append(f"|  |  |  | **{total}** | **{money(totals['total'])}** |")
    return "\n".join([head, *rows])


def context(
    values: dict[str, Any],
    fields: list[dict[str, Any]],
    kit: dict[str, Any],
    meta: dict[str, str],
    today: date,
    lang: str = "en",
) -> tuple[dict[str, str], Filled]:
    """Every placeholder's text. Empty strings mean 'no value'. Dates follow `lang`."""
    info = Filled(markdown="")
    ctx: dict[str, str] = {}
    cur = str(kit.get("currency") or "RM").strip() or "RM"
    for k, v in kit.items():
        if k == "custom" and isinstance(v, list):
            for c in v:
                if isinstance(c, dict) and c.get("key"):
                    ctx[f"company.{c['key']}"] = str(c.get("value") or "")
        elif not isinstance(v, list | dict):
            ctx[f"company.{k}"] = str(v if v is not None else "")
    ctx["today"] = fmt_date(today, lang)
    ctx["doc.number"] = meta.get("number", "")
    ctx["doc.title"] = meta.get("title", "")
    ctx["doc.date"] = fmt_date(values.get("date") or today, lang)

    types = {str(f.get("key")): str(f.get("type", "text")) for f in fields}
    for k, v in values.items():
        t = types.get(k, "text")
        if t == "items" or isinstance(v, list | dict):
            continue
        if t == "date" and v:
            ctx[k] = fmt_date(v, lang)
        elif t == "money" and number(v) is not None:
            ctx[k] = f"{cur} {money(number(v) or 0)}"
        else:
            ctx[k] = str(v if v is not None else "")

    item_key = next((k for k, t in types.items() if t == "items"), "items")
    items = clean_items(values.get(item_key))
    if items:
        rate = number(values.get("tax_rate"))
        if rate is None:
            rate = number(kit.get("tax_rate")) or 0.0
        subtotal = round(sum(i["amount"] for i in items), 2)
        tax = round(subtotal * rate / 100, 2)
        totals = {"subtotal": subtotal, "tax": tax, "total": round(subtotal + tax, 2)}
        label = f"{kit.get('tax_label') or 'Tax'} {rate:g}%"
        ctx["items"] = items_table(items, totals, cur, label, lang)
        if item_key != "items":
            ctx[item_key] = ctx["items"]
        ctx["subtotal"] = f"{cur} {money(subtotal)}"
        ctx["tax"] = f"{cur} {money(tax)}"
        ctx["total"] = f"{cur} {money(totals['total'])}"
        ctx["total_words"] = amount_in_words(totals["total"], cur, lang)
        info.totals, info.items = totals, items

    blank_name, blank_company = (
        ("[[Nama penandatangan]]", "[[Nama syarikat]]")
        if lang == "ms"
        else ("[[Signatory name]]", "[[Legal name]]")
    )
    sig = [
        "______________________________",
        f"**{kit.get('signatory_name') or blank_name}**",
    ]
    if kit.get("signatory_title"):
        sig.append(str(kit["signatory_title"]))
    sig.append(str(kit.get("legal_name") or blank_company))
    ctx["signature"] = "\n".join(sig)
    return ctx, info


def label_for(key: str, fields: list[dict[str, Any]]) -> str:
    for f in fields:
        if f.get("key") == key:
            return str(f.get("label") or key)
    if key.startswith("company."):
        k = key.split(".", 1)[1]
        return "Company " + KIT_LABELS.get(k, k.replace("_", " ")).lower()
    return BUILTIN_LABELS.get(key, key.replace("_", " ").capitalize())


def fill_text(
    text: str, ctx: dict[str, str], fields: list[dict[str, Any]]
) -> tuple[str, list[str]]:
    """Substitute line by line. An optional field left empty disappears, and so does a line
    it leaves holding only a label ("Attn:", "- "); anything else empty shows as [[Label]]."""
    missing: list[str] = []
    optional = {str(f.get("key")) for f in fields if not f.get("required")}
    out_lines: list[str] = []
    for line in text.split("\n"):
        dropped = False

        def sub(m: re.Match[str]) -> str:
            nonlocal dropped
            key = m.group(1)
            val = ctx.get(key, "")
            if val.strip():
                return val
            if key in optional:
                dropped = True
                return ""
            lab = label_for(key, fields)
            if lab not in missing:
                missing.append(lab)
            return f"[[{lab}]]"

        new = PLACEHOLDER.sub(sub, line)
        if dropped:
            rest = re.sub(r"[*_\-•>\s]", "", new)
            if not rest or rest.endswith(":") or rest in ("()", "Attn"):
                continue
        out_lines.append(new)
    out = "\n".join(out_lines)
    for m in MISSING.finditer(out):  # [[...]] written by hand or by the signature block
        if m.group(1) not in missing:
            missing.append(m.group(1))
    return out, missing


def fill(
    body: str,
    values: dict[str, Any],
    fields: list[dict[str, Any]],
    kit: dict[str, Any],
    meta: dict[str, str],
    today: date,
) -> Filled:
    ctx, info = context(values or {}, fields or [], kit or {}, meta, today, body_language(body))
    info.markdown, info.missing = fill_text(body, ctx, fields or [])
    return info


def placeholders(text: str) -> list[str]:
    seen: list[str] = []
    for m in PLACEHOLDER.finditer(text):
        if m.group(1) not in seen:
            seen.append(m.group(1))
    return seen


def detect_fields(text: str, known: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Fields for a template from its placeholders: keeps known definitions, adds the rest
    as text fields (company.*, doc.* and the computed ones are not fields)."""
    by_key = {str(f.get("key")): f for f in known or []}
    out: list[dict[str, Any]] = []
    for key in placeholders(text):
        if key.startswith(("company.", "doc.")) or key in BUILTIN_LABELS:
            if key == "items" and key not in by_key:
                out.append(
                    {"key": "items", "label": "Line items", "type": "items", "required": True}
                )
            elif key in by_key:
                out.append(by_key[key])
            continue
        out.append(
            by_key.get(key)
            or {
                "key": key,
                "label": key.replace("_", " ").capitalize(),
                "type": "text",
                "required": False,
            }
        )
    return out


def clean_fields(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for f in raw if isinstance(raw, list) else []:
        if not isinstance(f, dict):
            continue
        key = re.sub(r"[^\w]", "_", str(f.get("key") or "").strip().lower())[:40]
        if not key or key in seen or key.startswith(("company", "doc")):
            continue
        seen.add(key)
        t = str(f.get("type") or "text")
        item: dict[str, Any] = {
            "key": key,
            "label": str(f.get("label") or key).strip()[:80],
            "type": t if t in FIELD_TYPES else "text",
            "required": bool(f.get("required")),
            "hint": str(f.get("hint") or "")[:200],
        }
        if item["type"] == "choice":
            item["options"] = [str(o)[:60] for o in (f.get("options") or [])][:20]
        out.append(item)
    return out[:40]
