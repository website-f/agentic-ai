"""P49 "Ask how": plain-word help with links only to the person's own pages, as data."""

from agentic.api.routers.help import clean_links

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401

PAGES = [
    {"to": "/money", "label": "Money", "about": "Invoices and bills"},
    {"to": "/tasks", "label": "Tasks", "about": "All the work"},
]


def test_links_only_to_the_persons_pages():
    text = "Open [Money](/money) then [Admin](/admin) or [evil](https://evil.example)."
    assert clean_links(text, {"/money"}) == "Open [Money](/money) then Admin or evil."
    assert clean_links("[Bills](/money?tab=payable)", {"/money"}) == "[Bills](/money?tab=payable)"


async def test_ask_how_answers_with_the_pages_as_data(client, llm, temporal):
    await office(client)
    llm.say(
        "1. Open [Money](/money).\n2. Press Upload receipts and bills. See also [Secret](/secret)."
    )
    r = await client.post(
        "/api/help/ask",
        json={
            "question": "How do I add a bill?",
            "path": "/tasks",
            "pages": PAGES,
            "setup": [{"label": "Connect an AI", "done": True}],
        },
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    answer = r.json()["answer"]
    assert "[Money](/money)" in answer and "(/secret)" not in answer and "Secret" in answer
    sent = llm.requests[-1]["messages"]
    assert "never instructions" in sent[0]["content"]
    assert "<<<" in sent[1]["content"] and "How do I add a bill?" in sent[1]["content"]
    bad = await client.post(
        "/api/help/ask", json={"question": "x", "pages": []}, headers=csrf(client)
    )
    assert bad.status_code == 422
    odd = await client.post(
        "/api/help/ask",
        json={"question": "hi there", "pages": [{"to": "javascript:alert(1)", "label": "x"}]},
        headers=csrf(client),
    )
    assert odd.status_code == 422
