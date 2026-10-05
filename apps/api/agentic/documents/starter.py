"""Starter templates every workspace gets: the documents most businesses write every week.
People copy and change them; agents fill them. All company details come from the kit.

STARTERS_MS: the client documents again in Malay, for workspaces that work in Malay, so a
quotation to a Malay-speaking client prints Malay labels (the line-item table, dates and the
amount in words follow the template's language: documents/fill.py)."""

from typing import Any


def _f(
    key: str, label: str, type_: str = "text", required: bool = False, hint: str = ""
) -> dict[str, Any]:
    return {"key": key, "label": label, "type": type_, "required": required, "hint": hint}


CLIENT = [
    _f("client_name", "Client name", required=True),
    _f("client_address", "Client address", "longtext"),
    _f("client_contact", "Attention to", hint="The person you are writing to"),
]

STARTERS: list[dict[str, Any]] = [
    {
        "name": "Quotation",
        "kind": "quotation",
        "prefix": "QT",
        "description": "Prices for a client, with line items, tax and total in words.",
        "fields": [
            *CLIENT,
            _f("subject", "Subject", required=True, hint="e.g. Office cleaning services"),
            _f("items", "Line items", "items", True),
            _f("valid_until", "Valid until", "date"),
            _f("notes", "Notes", "longtext"),
        ],
        "body": """# Quotation

**Quotation no.:** {{doc.number}}
**Date:** {{doc.date}}
**Valid until:** {{valid_until}}

**To:**
{{client_name}}
{{client_address}}
Attn: {{client_contact}}

**Subject: {{subject}}**

Thank you for your enquiry. We are pleased to quote as follows:

{{items}}

**Amount in words:** {{total_words}}

## Terms
- Payment terms: {{company.payment_terms}}
- Prices are quoted in {{company.currency}}.
- {{notes}}

We look forward to working with you.

Yours faithfully,
{{signature}}
""",
    },
    {
        "name": "Invoice",
        "kind": "invoice",
        "prefix": "INV",
        "description": "Bill a client, with bank details for payment.",
        "fields": [
            *CLIENT,
            _f("reference", "Your PO / reference"),
            _f("items", "Line items", "items", True),
            _f("due_date", "Due date", "date", True),
        ],
        "body": """# Invoice

**Invoice no.:** {{doc.number}}
**Date:** {{doc.date}}
**Due date:** {{due_date}}
**Your reference:** {{reference}}

**Bill to:**
{{client_name}}
{{client_address}}
Attn: {{client_contact}}

{{items}}

**Amount in words:** {{total_words}}

## Payment
Please pay by bank transfer to:
**{{company.bank_holder}}**
{{company.bank_name}} — Account no. {{company.bank_account}}

Payment terms: {{company.payment_terms}}

Thank you for your business.
""",
    },
    {
        "name": "Official letter",
        "kind": "letter",
        "prefix": "REF",
        "description": "A formal letter on the company letterhead.",
        "fields": [
            *CLIENT,
            _f("subject", "Subject", required=True),
            _f("body_text", "Letter text", "longtext", True, "The message, in a few paragraphs"),
        ],
        "body": """Our ref: {{doc.number}}
Date: {{doc.date}}

{{client_contact}}
{{client_name}}
{{client_address}}

Dear Sir / Madam,

**{{subject}}**

{{body_text}}

Thank you.

Yours faithfully,
{{signature}}
""",
    },
    {
        "name": "Proposal",
        "kind": "proposal",
        "prefix": "PRP",
        "description": "A short business proposal: the need, the approach, the price.",
        "fields": [
            *CLIENT,
            _f("project", "Project", required=True),
            _f("background", "Background / the client's need", "longtext", True),
            _f("approach", "Our approach", "longtext", True),
            _f("timeline", "Timeline", "longtext"),
            _f("items", "Pricing", "items"),
        ],
        "body": """# Proposal: {{project}}

Prepared for **{{client_name}}** · {{doc.date}} · Ref {{doc.number}}

## 1. Background
{{background}}

## 2. Our approach
{{approach}}

## 3. Timeline
{{timeline}}

## 4. Pricing
{{items}}

**Total:** {{total}} ({{total_words}})

## 5. About us
{{company.legal_name}} ({{company.reg_no}})
{{company.address}}
{{company.phone}} · {{company.email}}

Yours sincerely,
{{signature}}
""",
    },
    {
        "name": "Meeting minutes",
        "kind": "minutes",
        "prefix": "MOM",
        "description": "Who attended, what was decided, who does what by when.",
        "fields": [
            _f("meeting", "Meeting", required=True, hint="e.g. Monthly operations meeting"),
            _f("date", "Date", "date", True),
            _f("venue", "Venue / link"),
            _f("attendees", "Attendees", "longtext", True, "One per line"),
            _f("discussion", "Discussion", "longtext", True),
            _f("decisions", "Decisions", "longtext"),
            _f("actions", "Action items", "longtext", hint="Who, what, by when — one per line"),
        ],
        "body": """# Minutes: {{meeting}}

**Date:** {{doc.date}}
**Venue:** {{venue}}
**Ref:** {{doc.number}}

## Attendees
{{attendees}}

## Discussion
{{discussion}}

## Decisions
{{decisions}}

## Action items
{{actions}}

Prepared by {{company.legal_name}}.
""",
    },
    {
        "name": "Company profile",
        "kind": "profile",
        "prefix": "",
        "description": "Who the company is, what it does, and its credentials.",
        "fields": [
            _f("about", "About the company", "longtext", True),
            _f("services", "Products and services", "longtext", True, "One per line"),
            _f("experience", "Past projects / clients", "longtext", hint="One per line"),
            _f("certifications", "Licences and certifications", "longtext", hint="One per line"),
        ],
        "body": """# {{company.legal_name}}

{{company.reg_no}}
{{company.address}}
{{company.phone}} · {{company.email}} · {{company.website}}

## About us
{{about}}

## What we do
{{services}}

## Experience
{{experience}}

## Licences and certifications
{{certifications}}

## Management
{{company.directors}}
""",
    },
    {
        "name": "Delivery order",
        "kind": "delivery",
        "prefix": "DO",
        "description": "Goods delivered, for the client to sign on receipt.",
        "fields": [
            *CLIENT,
            _f("reference", "PO / invoice reference"),
            _f("items", "Items delivered", "items", True),
            _f("delivered_to", "Delivery address", "longtext"),
        ],
        "body": """# Delivery Order

**DO no.:** {{doc.number}}
**Date:** {{doc.date}}
**Reference:** {{reference}}

**Deliver to:**
{{client_name}}
{{delivered_to}}
Attn: {{client_contact}}

{{items}}

Received in good order and condition:

______________________________
Name, signature and company stamp
Date:

Issued by:
{{signature}}
""",
    },
    {
        "name": "Cover letter for a submission",
        "kind": "letter",
        "prefix": "SUB",
        "description": "Covers a document pack you are submitting to a client or agency.",
        "fields": [
            *CLIENT,
            _f(
                "submission",
                "What is being submitted",
                required=True,
                hint="e.g. Proposal for cleaning services, ref. ABC/2026/01",
            ),
            _f("enclosures", "Enclosures", "longtext", True, "One per line"),
        ],
        "body": """Our ref: {{doc.number}}
Date: {{doc.date}}

{{client_contact}}
{{client_name}}
{{client_address}}

Dear Sir / Madam,

**SUBMISSION: {{submission}}**

We are pleased to submit the above for your consideration. Enclosed are the following:

{{enclosures}}

Should you need any clarification, please contact us at {{company.phone}} or {{company.email}}.

Thank you.

Yours faithfully,
{{signature}}
""",
    },
]


CLIENT_MS = [
    _f("client_name", "Nama pelanggan", required=True),
    _f("client_address", "Alamat pelanggan", "longtext"),
    _f("client_contact", "Untuk perhatian", hint="Orang yang anda tulis kepadanya"),
]

STARTERS_MS: list[dict[str, Any]] = [
    {
        "name": "Sebut harga",
        "kind": "quotation",
        "prefix": "QT",
        "description": "Harga kepada pelanggan, dengan butiran, cukai dan jumlah dalam perkataan.",
        "fields": [
            *CLIENT_MS,
            _f("subject", "Perkara", required=True, hint="cth. Perkhidmatan kawalan keselamatan"),
            _f("items", "Butiran", "items", True),
            _f("valid_until", "Sah sehingga", "date"),
            _f("notes", "Catatan", "longtext"),
        ],
        "body": """# Sebut Harga

**No. sebut harga:** {{doc.number}}
**Tarikh:** {{doc.date}}
**Sah sehingga:** {{valid_until}}

**Kepada:**
{{client_name}}
{{client_address}}
U.P.: {{client_contact}}

Tuan/Puan,

**Perkara: {{subject}}**

Terima kasih atas pertanyaan tuan/puan. Dengan hormatnya kami sertakan sebut harga seperti berikut:

{{items}}

**Jumlah dalam perkataan:** {{total_words}}

## Terma
- Terma bayaran: {{company.payment_terms}}
- Harga dalam {{company.currency}}.
- {{notes}}

Kami berharap dapat berkhidmat untuk tuan/puan.

Sekian, terima kasih.

Yang benar,
{{signature}}
""",
    },
    {
        "name": "Invois",
        "kind": "invoice",
        "prefix": "INV",
        "description": "Bil kepada pelanggan, dengan butiran bank untuk bayaran.",
        "fields": [
            *CLIENT_MS,
            _f("reference", "No. PO / rujukan tuan"),
            _f("items", "Butiran", "items", True),
            _f("due_date", "Tarikh akhir bayaran", "date", True),
        ],
        "body": """# Invois

**No. invois:** {{doc.number}}
**Tarikh:** {{doc.date}}
**Tarikh akhir bayaran:** {{due_date}}
**Rujukan tuan:** {{reference}}

**Kepada:**
{{client_name}}
{{client_address}}
U.P.: {{client_contact}}

{{items}}

**Jumlah dalam perkataan:** {{total_words}}

## Bayaran
Sila buat pindahan bank kepada:
**{{company.bank_holder}}**
{{company.bank_name}}, No. akaun {{company.bank_account}}

Terma bayaran: {{company.payment_terms}}

Sekian, terima kasih.
""",
    },
    {
        "name": "Surat rasmi",
        "kind": "letter",
        "prefix": "REF",
        "description": "Surat rasmi dengan kepala surat syarikat.",
        "fields": [
            *CLIENT_MS,
            _f("subject", "Perkara", required=True),
            _f("body_text", "Isi surat", "longtext", True, "Mesej, dalam beberapa perenggan"),
        ],
        "body": """Ruj. kami: {{doc.number}}
Tarikh: {{doc.date}}

{{client_contact}}
{{client_name}}
{{client_address}}

Tuan/Puan,

**{{subject}}**

{{body_text}}

Sekian, terima kasih.

Yang benar,
{{signature}}
""",
    },
    {
        "name": "Pesanan penghantaran",
        "kind": "delivery",
        "prefix": "DO",
        "description": "Barang yang dihantar, untuk ditandatangani pelanggan semasa terima.",
        "fields": [
            *CLIENT_MS,
            _f("reference", "Rujukan PO / invois"),
            _f("items", "Barang dihantar", "items", True),
            _f("delivered_to", "Alamat penghantaran", "longtext"),
        ],
        "body": """# Pesanan Penghantaran

**No. DO:** {{doc.number}}
**Tarikh:** {{doc.date}}
**Rujukan:** {{reference}}

**Kepada:**
{{client_name}}
{{delivered_to}}
U.P.: {{client_contact}}

{{items}}

Diterima dalam keadaan baik dan lengkap:

______________________________
Nama, tandatangan dan cop syarikat
Tarikh:

Dikeluarkan oleh:
{{signature}}
""",
    },
]
