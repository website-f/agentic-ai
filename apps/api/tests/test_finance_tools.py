"""P19: deterministic finance maths and forecasting, and the finance starter skills."""

import math

import pytest
from sqlalchemy import select

# isort: off
from agentic.agents.tools import TOOLS  # first: finance_tools registers into it
from agentic.agents import finance_tools as ft

# isort: on
from agentic.core.db import SessionLocal
from agentic.models import Skill, SkillEvalCase, Workspace
from agentic.skills import store

from .conftest import csrf, setup_owner

# ---------------------------------------------------------------- loans


def test_flat_rate_hire_purchase_and_its_effective_rate():
    ln = ft.loan(50_000, 3, 60, "flat")
    # interest = 50,000 x 3% x 5 = 7,500; instalment = 57,500 / 60
    assert ln.total_interest == pytest.approx(7_500)
    assert ln.instalment == pytest.approx(958.3333, abs=1e-4)
    # The same instalment on a reducing balance is about 5.64% a year, not 3%.
    assert ln.apr == pytest.approx(0.056418, abs=1e-5)
    assert ft.annuity_payment(50_000, ln.monthly_rate, 60) == pytest.approx(958.3333, abs=1e-4)
    # Rule of 78: month 1 earns 60/1830 of the interest, the last month 1/1830.
    assert ln.rows[0][2] == pytest.approx(7_500 * 60 / 1830)
    assert ln.rows[-1][2] == pytest.approx(7_500 / 1830)
    assert ln.rows[-1][4] == 0.0 and sum(r[3] for r in ln.rows) == pytest.approx(50_000)

    out = ft.finance_calc(
        {"calculation": "hire_purchase", "principal": "50,000", "rate": 3, "years": 5}
    )
    assert "RM 958.33" in out and "5.64% a year" in out and "Rule of 78" in out
    assert out.count("\n| ") >= 60  # a monthly schedule for a 60-month term


def test_reducing_balance_loan_schedule():
    ln = ft.loan(100_000, 4, 120, "reducing")
    assert ln.instalment == pytest.approx(1_012.45, abs=0.005)
    assert ln.total_interest == pytest.approx(21_494.17, abs=0.01)
    assert ln.rows[0][2] == pytest.approx(100_000 * 0.04 / 12)  # first month's interest
    assert ln.rows[-1][4] == 0.0
    out = ft.finance_calc(
        {
            "calculation": "loan",
            "principal": 100_000,
            "rate": 4,
            "months": 120,
            "method": "reducing",
            "schedule": "yearly",
        }
    )
    assert "RM 1,012.45" in out and "| 10 |" in out and "| 11 |" not in out


def test_zero_rate_and_bad_input():
    assert ft.loan(12_000, 0, 12, "reducing").instalment == pytest.approx(1_000)
    assert ft.finance_calc(
        {"calculation": "loan", "principal": 0, "rate": 3, "years": 1}
    ).startswith("Error")
    assert ft.finance_calc({"calculation": "teleport"}).startswith("Error: calculation must be")
    assert "Give rate" in ft.finance_calc({"calculation": "loan", "principal": 1, "years": 1})


# ---------------------------------------------------------------- appraisal


def test_npv_irr_and_payback():
    flows = [-1_000, 300, 400, 500]
    assert ft.npv(0.10, flows) == pytest.approx(-21.0368, abs=1e-4)
    r = ft.irr(flows)
    assert r == pytest.approx(0.088963, abs=1e-6) and ft.npv(r, flows) == pytest.approx(0, abs=1e-6)
    assert ft.irr([-100, 110]) == pytest.approx(0.10, abs=1e-9)
    assert ft.irr([-10_000, 3_000, 4_200, 6_800]) == pytest.approx(0.1634, abs=1e-4)
    assert ft.payback(flows) == pytest.approx(2.6)
    assert ft.payback([-100, 10, 10]) is None
    with pytest.raises(ft.FinanceError):
        ft.irr([100, 200])
    out = ft.finance_calc({"calculation": "payback", "cash_flows": flows, "rate": 10})
    assert "2.60 periods" in out and "Discounted payback at 10.00%: not reached" in out
    assert "more than one IRR" in ft.finance_calc(
        {"calculation": "irr", "cash_flows": [-100, 230, -132]}
    )


def test_break_even_margin_depreciation_growth_sst():
    units, revenue, cm, ratio = ft.break_even(10_000, 50, 30)
    assert (units, revenue, cm, ratio) == (500, 25_000, 20, 0.4)
    out = ft.finance_calc(
        {
            "calculation": "break_even",
            "fixed_costs": 10_000,
            "price": 50,
            "variable_cost": 30,
            "target_profit": 400,
        }
    )
    assert "Units: **520.00**" in out and "RM 26,000.00" in out

    out = ft.finance_calc({"calculation": "margin", "cost": 1_000, "markup_pct": 30})
    assert "23.08%" in out and "30.00%" in out
    out = ft.finance_calc({"calculation": "margin", "cost": 1_000, "margin_pct": 30})
    assert "RM 1,428.57" in out
    out = ft.finance_calc(
        {"calculation": "margin", "revenue": 200_000, "cogs": 120_000, "net_profit": 20_000}
    )
    assert "40.00%" in out and "10.00%" in out

    sl = ft.depreciation(10_000, 1_000, 5)
    assert all(r[2] == pytest.approx(1_800) for r in sl) and sl[-1][4] == pytest.approx(1_000)
    db = ft.depreciation(10_000, 1_000, 5, "declining_balance")
    assert [round(r[2], 2) for r in db] == [4_000, 2_400, 1_440, 864, 296]
    assert db[-1][4] == pytest.approx(1_000)

    assert ft.cagr(100, 121, 2) == pytest.approx(0.10)
    assert "**10.00% a period**" in ft.finance_calc(
        {"calculation": "cagr", "start_value": 100, "end_value": 121, "periods": 2}
    )
    assert "**121.00**" in ft.finance_calc(
        {"calculation": "growth", "start_value": 100, "rate": 10, "periods": 2}
    )

    assert ft.sst(108, 8, inclusive=True) == pytest.approx((100, 8, 108))
    assert ft.sst(100, 6, inclusive=False) == pytest.approx((100, 6, 106))
    assert "RM 8.00" in ft.finance_calc({"calculation": "sst", "amount": 100})


# ---------------------------------------------------------------- forecasting


def test_holt_reproduces_a_linear_trend():
    fc = ft.forecast([10, 12, 14, 16, 18, 20, 22, 24], 3)
    assert fc.method == "Holt linear trend"
    assert fc.points == pytest.approx([26, 28, 30], abs=1e-9)
    assert fc.rmse == pytest.approx(0, abs=1e-9)
    assert any("fits the history exactly" in n for n in fc.notes)


def test_seasonal_data_picks_holt_winters():
    ys = [100 + 2 * t + 10 * math.sin(2 * math.pi * t / 12) for t in range(36)]
    fc = ft.forecast(ys, 12, season_length=12)
    assert fc.method.startswith("Holt-Winters")
    want = [100 + 2 * t + 10 * math.sin(2 * math.pi * t / 12) for t in range(36, 48)]
    assert fc.points == pytest.approx(want, abs=1e-6)
    assert set(fc.compared) == {
        "Holt linear trend",
        "Seasonal naive (same period last season)",
        "Holt-Winters additive (trend + season)",
    }


def test_forecast_ranges_and_honest_notes():
    fc = ft.forecast([5, 7, 6, 8, 9, 11, 10, 12, 13], 3)
    assert all(lo < p < hi for lo, p, hi in zip(fc.low, fc.points, fc.high, strict=True))
    widths = [hi - lo for lo, hi in zip(fc.low, fc.high, strict=True)]
    assert widths == sorted(widths)  # the range widens with the horizon

    short = ft.forecast([100, 120, 90, 110], 2, season_length=12)
    assert short.method == "Holt linear trend"
    assert any("two full seasons" in n for n in short.notes)
    assert any("Only 4 values" in n for n in short.notes)

    falling = ft.forecast([50, 40, 30, 20, 10], 4)
    assert min(falling.points) >= 0 and any("floored at 0" in n for n in falling.notes)

    out = ft.forecast_text(
        {"values": [5, 7, 6, 8, 9, 11, 10, 12, 13], "periods": 3, "last_period": "2026-11"}
    )
    assert "| 2026-12 |" in out and "| 2027-01 |" in out and "80% range" in out
    assert ft.forecast_text({"values": [1, 2], "periods": 3}).startswith("Error: Give at least 3")
    assert ft.forecast_text({"values": "1,2,3", "periods": 3}).startswith("Error")


def test_tools_are_registered_low_risk_and_allowed():
    for name in ("finance_calc", "forecast"):
        t = TOOLS[name]
        assert (t.risk, t.default_mode) == ("low", "allow")
        assert t.schema()["function"]["name"] == name


# ---------------------------------------------------------------- starter skills


async def test_finance_skills_are_seeded_with_eval_cases(client):
    await setup_owner(client)
    names = {s["name"] for s in (await client.get("/api/skills")).json()}
    assert {
        "cash-flow-forecast",
        "budget-variance",
        "debtor-ageing",
        "monthly-management-report",
        "pricing-margin-check",
        "financing-comparison",
        "compare-quotes",
        "meeting-notes",
    } <= names
    async with SessionLocal() as db:
        skill = await db.scalar(select(Skill).where(Skill.name == "financing-comparison"))
        assert skill is not None and skill.trust == "builtin"
        cases = (
            await db.scalars(select(SkillEvalCase).where(SkillEvalCase.skill_id == skill.id))
        ).all()
        assert cases and cases[0].checks["must_call"] == ["finance_calc"]


async def test_older_workspaces_gain_new_starters_and_deleted_ones_stay_gone(client):
    await setup_owner(client)
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        assert ws is not None
        # A workspace from before P19: only the first two starters, no record of seeding.
        for name, desc, body in store.BUILTIN[:2]:
            db.add(
                Skill(
                    workspace_id=ws.id,
                    name=name,
                    description=desc,
                    body=body,
                    trust="builtin",
                    created_by="system",
                )
            )
        await db.commit()
        await store.ensure_builtin(db, ws)
        names = set((await db.scalars(select(Skill.name))).all())
        assert len(names) == len(store.BUILTIN)
        assert ws.settings["builtin_skills"] == sorted(names)

        gone = await db.scalar(select(Skill).where(Skill.name == "debtor-ageing"))
        await db.delete(gone)
        await db.commit()
        await store.ensure_builtin(db, ws)
        assert "debtor-ageing" not in set((await db.scalars(select(Skill.name))).all())
    r = await client.get("/api/skills", headers=csrf(client))
    assert r.status_code == 200 and "debtor-ageing" not in {s["name"] for s in r.json()}
