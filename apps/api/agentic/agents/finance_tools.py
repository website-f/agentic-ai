"""Finance and forecasting tools (P19): deterministic maths, no model in the loop.

- finance_calc: financing instalments and schedules (flat rate as in Malaysian hire purchase,
  and reducing balance), the effective rate behind a flat rate, NPV, IRR, payback, break-even,
  margins and markup, depreciation, compound growth and CAGR, and SST in or out of a price.
- forecast: Holt's linear trend, plus seasonal naive and additive Holt-Winters when there are
  at least two full seasons; the method with the smallest one-step-ahead error wins, and the
  80% range comes from those errors.

Every answer says which formula it used, so a person can check it by hand. The pure functions
below are what the tests check; the tool handlers only parse arguments and format.
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from .tools import Tool, ToolContext

MAX_PERIODS = 600  # 50 years of monthly instalments
MAX_SERIES = 240
MAX_AHEAD = 36
Z80 = 1.2816  # two-sided 80%: 10% in each tail


class FinanceError(ValueError):
    pass


# ---------------------------------------------------------------- formatting


def money(x: float, cur: str = "RM") -> str:
    sign = "-" if x < 0 else ""
    return f"{sign}{cur + ' ' if cur else ''}{abs(x):,.2f}"


def pct(x: float, dp: int = 2) -> str:
    return f"{x * 100:.{dp}f}%"


def num(x: float, dp: int = 2) -> str:
    return f"{x:,.{dp}f}"


def table(columns: Sequence[str], rows: Sequence[Sequence[Any]]) -> str:
    head = "| " + " | ".join(columns) + " |"
    sep = "|" + "|".join("---" for _ in columns) + "|"
    body = ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join([head, sep, *body])


def _f(args: dict[str, Any], key: str, default: float | None = None) -> float:
    v = args.get(key, default)
    if v is None or v == "":
        raise FinanceError(f"Give {key}.")
    if isinstance(v, str):
        v = v.replace(",", "").replace("RM", "").replace("%", "").strip()
    try:
        out = float(v)
    except (TypeError, ValueError) as e:
        raise FinanceError(f"{key} must be a number.") from e
    if not math.isfinite(out):
        raise FinanceError(f"{key} must be a finite number.")
    return out


def _flows(args: dict[str, Any]) -> list[float]:
    raw = args.get("cash_flows")
    if not isinstance(raw, list) or len(raw) < 2:
        raise FinanceError(
            "Give cash_flows as a list, first item today (usually negative: the outlay)."
        )
    if len(raw) > MAX_PERIODS:
        raise FinanceError(f"At most {MAX_PERIODS} cash flows.")
    return [_f({"v": v}, "v") for v in raw]


# ---------------------------------------------------------------- loans and financing


@dataclass
class Loan:
    principal: float
    annual_rate: float  # e.g. 0.03
    months: int
    method: str  # flat | reducing
    instalment: float
    total_interest: float
    total_paid: float
    monthly_rate: float  # the reducing-balance rate per month (equivalent, for flat)
    rows: list[tuple[int, float, float, float, float]] = field(default_factory=list)

    @property
    def apr(self) -> float:
        """Annual reducing-balance rate (monthly rate x 12): what banks call the effective
        rate when they compare a flat-rate offer with a reducing-balance one."""
        return self.monthly_rate * 12

    @property
    def effective_annual(self) -> float:
        return (1 + self.monthly_rate) ** 12 - 1


def annuity_payment(principal: float, monthly_rate: float, months: int) -> float:
    if monthly_rate == 0:
        return principal / months
    return principal * monthly_rate / (1 - (1 + monthly_rate) ** -months)


def rate_for_payment(principal: float, payment: float, months: int) -> float:
    """The monthly reducing-balance rate at which `payment` repays `principal` in `months`."""
    if payment * months <= principal + 1e-9:
        return 0.0
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if annuity_payment(principal, mid, months) > payment:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def loan(principal: float, annual_rate_pct: float, months: int, method: str = "reducing") -> Loan:
    if principal <= 0:
        raise FinanceError("principal must be more than 0.")
    if not 0 <= annual_rate_pct <= 100:
        raise FinanceError("rate is a yearly percentage between 0 and 100.")
    if not 1 <= months <= MAX_PERIODS:
        raise FinanceError(f"The term must be 1 to {MAX_PERIODS} months.")
    r = annual_rate_pct / 100
    rows: list[tuple[int, float, float, float, float]] = []
    if method == "flat":
        interest = principal * r * months / 12
        pay = (principal + interest) / months
        # Rule of 78 (sum of digits): how hire-purchase interest is earned month by month,
        # front-loaded like a reducing-balance loan; also how early-settlement rebates work.
        digits = months * (months + 1) / 2
        bal = principal
        for k in range(1, months + 1):
            i_k = interest * (months - k + 1) / digits
            p_k = pay - i_k
            bal -= p_k
            rows.append((k, pay, i_k, p_k, max(bal, 0.0) if abs(bal) > 1e-6 else 0.0))
        i_m = rate_for_payment(principal, pay, months)
        return Loan(principal, r, months, "flat", pay, interest, pay * months, i_m, rows)
    if method != "reducing":
        raise FinanceError("method is flat or reducing.")
    i_m = r / 12
    pay = annuity_payment(principal, i_m, months)
    bal, total_i = principal, 0.0
    for k in range(1, months + 1):
        i_k = bal * i_m
        p_k = pay - i_k
        bal -= p_k
        total_i += i_k
        rows.append((k, pay, i_k, p_k, bal if abs(bal) > 1e-6 else 0.0))
    return Loan(principal, r, months, "reducing", pay, total_i, pay * months, i_m, rows)


def _months(args: dict[str, Any]) -> int:
    if args.get("months") not in (None, ""):
        m = _f(args, "months")
    else:
        m = _f(args, "years") * 12
    if abs(m - round(m)) > 1e-9:
        raise FinanceError("The term must be a whole number of months.")
    return int(round(m))


def _loan_text(args: dict[str, Any], cur: str) -> str:
    method = str(args.get("method") or "reducing").lower()
    if args.get("calculation") in ("hire_purchase", "flat_to_effective"):
        method = "flat"
    method = "flat" if method.startswith("flat") else method
    method = "reducing" if method.startswith("reduc") or method == "effective" else method
    ln = loan(_f(args, "principal"), _f(args, "rate"), _months(args), method)
    lines = [
        f"## {'Flat-rate' if method == 'flat' else 'Reducing-balance'} financing: "
        f"{money(ln.principal, cur)} at {num(ln.annual_rate * 100)}% "
        f"{'flat' if method == 'flat' else 'a year'} over {ln.months} months",
        "",
        f"- Monthly instalment: **{money(ln.instalment, cur)}**",
        f"- Total interest: {money(ln.total_interest, cur)}",
        f"- Total paid: {money(ln.total_paid, cur)}",
    ]
    if method == "flat":
        lines += [
            f"- Effective rate (reducing-balance equivalent): **{pct(ln.apr)} a year** "
            f"({pct(ln.monthly_rate, 4)} a month; {pct(ln.effective_annual)} compounded "
            "yearly)",
            "",
            "Formula: interest = principal x flat rate x years; instalment = (principal + "
            "interest) / months. The effective rate is the monthly rate i that solves "
            "instalment = principal x i / (1 - (1 + i)^-months), times 12. Interest per month "
            "is split by the Rule of 78 (month k earns interest x (n - k + 1) / (n(n+1)/2)).",
        ]
    else:
        flat_eq = ln.total_interest / ln.principal / (ln.months / 12)
        lines += [
            f"- Same cost as a flat rate of {pct(flat_eq)} a year",
            "",
            "Formula: i = yearly rate / 12; instalment = principal x i / (1 - (1 + i)^-months);"
            " each month interest = balance x i, the rest of the instalment repays principal.",
        ]
    view = str(args.get("schedule") or ("monthly" if ln.months <= 60 else "yearly")).lower()
    if view == "monthly":
        lines += [
            "",
            table(
                ["Month", "Instalment", "Interest", "Principal", "Balance"],
                [(k, num(p), num(i), num(pr), num(b)) for k, p, i, pr, b in ln.rows[:MAX_PERIODS]],
            ),
        ]
    elif view == "yearly":
        yrows = []
        for y in range(0, ln.months, 12):
            chunk = ln.rows[y : y + 12]
            yrows.append(
                (
                    y // 12 + 1,
                    num(sum(c[1] for c in chunk)),
                    num(sum(c[2] for c in chunk)),
                    num(sum(c[3] for c in chunk)),
                    num(chunk[-1][4]),
                )
            )
        lines += [
            "",
            table(["Year", "Paid", "Interest", "Principal", "Balance at year end"], yrows),
        ]
    return "\n".join(lines)


# ---------------------------------------------------------------- investment appraisal


def npv(rate: float, flows: Sequence[float]) -> float:
    """Net present value; flows[0] is today (not discounted)."""
    return sum(cf / (1 + rate) ** t for t, cf in enumerate(flows))


def irr(flows: Sequence[float]) -> float:
    """The rate at which NPV is zero. Raises when the flows never change sign."""
    if not (any(f < 0 for f in flows) and any(f > 0 for f in flows)):
        raise FinanceError("No IRR: the cash flows need both an outlay and a return.")
    grid = [-0.99 + 0.01 * k for k in range(0, 100)] + [0.01 * k for k in range(1, 1001)]
    prev_r, prev_v = grid[0], npv(grid[0], flows)
    for r in grid[1:]:
        v = npv(r, flows)
        if prev_v == 0:
            return prev_r
        if (prev_v < 0) != (v < 0):
            lo, hi, vlo = prev_r, r, prev_v
            for _ in range(200):
                mid = (lo + hi) / 2
                vm = npv(mid, flows)
                if (vm < 0) == (vlo < 0):
                    lo, vlo = mid, vm
                else:
                    hi = mid
            return (lo + hi) / 2
        prev_r, prev_v = r, v
    raise FinanceError("No IRR between -99% and 1000% for these cash flows.")


def payback(flows: Sequence[float]) -> float | None:
    """Periods until the cumulative cash flow turns non-negative (interpolated), else None."""
    cum = flows[0]
    if cum >= 0:
        return 0.0
    for t in range(1, len(flows)):
        nxt = cum + flows[t]
        if nxt >= 0 and flows[t] > 0:
            return t - 1 + (-cum) / flows[t]
        cum = nxt
    return None


def _sign_changes(flows: Sequence[float]) -> int:
    signs = [f > 0 for f in flows if f != 0]
    return sum(1 for a, b in zip(signs, signs[1:], strict=False) if a != b)


def _npv_text(args: dict[str, Any], cur: str) -> str:
    flows = _flows(args)
    r = _f(args, "rate") / 100
    v = npv(r, flows)
    rows = [
        (t, num(cf), f"{1 / (1 + r) ** t:.4f}", num(cf / (1 + r) ** t))
        for t, cf in enumerate(flows)
    ]
    verdict = "worth more than it costs" if v > 0 else "does not earn the required rate"
    return "\n".join(
        [
            f"## NPV at {num(r * 100)}% a period",
            "",
            f"- NPV: **{money(v, cur)}** (the project {verdict} at this rate)",
            "",
            "Formula: NPV = sum of cash flow_t / (1 + rate)^t, with t = 0 for today's cash "
            "flow (not discounted). Note: Excel's NPV() discounts the first value too; add "
            "the day-0 flow outside it to match this.",
            "",
            table(["Period", "Cash flow", "Discount factor", "Present value"], rows),
        ]
    )


def _irr_text(args: dict[str, Any], cur: str) -> str:
    flows = _flows(args)
    r = irr(flows)
    lines = [
        "## Internal rate of return",
        "",
        f"- IRR: **{pct(r)} a period** (if periods are months, about "
        f"{pct((1 + r) ** 12 - 1)} a year)",
        f"- Check: NPV at the IRR = {money(npv(r, flows), cur)}",
        "",
        "Formula: the rate r where sum of cash flow_t / (1 + r)^t = 0 (solved numerically, "
        "t = 0 is today).",
    ]
    if _sign_changes(flows) > 1:
        lines.append(
            "\nCaution: the cash flows change sign more than once, so more than one IRR can "
            "exist. Prefer NPV at your required rate for the decision."
        )
    return "\n".join(lines)


def _payback_text(args: dict[str, Any], cur: str) -> str:
    flows = _flows(args)
    simple = payback(flows)
    cum, rows = 0.0, []
    rate = args.get("rate")
    r = _f(args, "rate") / 100 if rate not in (None, "") else None
    dcum, disc = 0.0, []
    for t, cf in enumerate(flows):
        cum += cf
        row = [t, num(cf), num(cum)]
        if r is not None:
            pv = cf / (1 + r) ** t
            dcum += pv
            disc.append(pv)
            row.append(num(dcum))
        rows.append(row)
    lines = ["## Payback period", ""]
    lines.append(
        f"- Simple payback: **{num(simple)} periods**"
        if simple is not None
        else "- Simple payback: not reached within these cash flows"
    )
    cols = ["Period", "Cash flow", "Cumulative"]
    if r is not None:
        dp = payback(disc)
        lines.append(
            f"- Discounted payback at {num(r * 100)}%: **{num(dp)} periods**"
            if dp is not None
            else f"- Discounted payback at {num(r * 100)}%: not reached"
        )
        cols.append("Cumulative (discounted)")
    lines += [
        "",
        "Formula: periods before the cumulative cash flow turns positive, plus the "
        "fraction of the next period's inflow needed to cover what is left (cash assumed "
        "to arrive evenly through the period).",
        "",
        table(cols, rows),
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------- pricing and costs


def break_even(fixed: float, price: float, variable: float, target_profit: float = 0.0):
    cm = price - variable
    if cm <= 0:
        raise FinanceError("The price must be higher than the variable cost per unit.")
    units = (fixed + target_profit) / cm
    return units, units * price, cm, cm / price


def _break_even_text(args: dict[str, Any], cur: str) -> str:
    fixed, price, var = (
        _f(args, "fixed_costs"),
        _f(args, "price"),
        _f(args, "variable_cost"),
    )
    target = _f(args, "target_profit", 0)
    units, revenue, cm, ratio = break_even(fixed, price, var, target)
    what = "break even" if not target else f"make {money(target, cur)} profit"
    return "\n".join(
        [
            f"## Break-even: units needed to {what}",
            "",
            f"- Units: **{num(units)}** (round up: {math.ceil(units - 1e-9):,} units)",
            f"- Revenue: **{money(revenue, cur)}**",
            f"- Contribution per unit: {money(cm, cur)} ({pct(ratio)} of the price)",
            "",
            "Formula: units = (fixed costs + target profit) / (price - variable cost per "
            "unit); revenue = units x price.",
        ]
    )


def _margin_text(args: dict[str, Any], cur: str) -> str:
    has = {k for k, v in args.items() if v not in (None, "")}
    if {"revenue"} <= has and has & {"cogs", "net_profit", "operating_expenses"}:
        rev = _f(args, "revenue")
        if rev <= 0:
            raise FinanceError("revenue must be more than 0.")
        rows, lines = [], [f"## Margins on revenue of {money(rev, cur)}", ""]
        if "cogs" in has:
            gp = rev - _f(args, "cogs")
            rows.append(("Gross profit", money(gp, cur), pct(gp / rev)))
            if "operating_expenses" in has:
                op = gp - _f(args, "operating_expenses")
                rows.append(("Operating profit", money(op, cur), pct(op / rev)))
        if "net_profit" in has:
            npf = _f(args, "net_profit")
            rows.append(("Net profit", money(npf, cur), pct(npf / rev)))
        lines += [
            table(["Measure", "Amount", "Margin"], rows),
            "",
            "Formula: margin = profit / revenue; gross profit = revenue - cost of goods sold; "
            "operating profit = gross profit - operating expenses.",
        ]
        return "\n".join(lines)
    cost = _f(args, "cost")
    if cost < 0:
        raise FinanceError("cost cannot be negative.")
    if "price" in has:
        price = _f(args, "price")
    elif "margin_pct" in has:
        m = _f(args, "margin_pct") / 100
        if m >= 1:
            raise FinanceError("A margin must be below 100%.")
        price = cost / (1 - m)
    elif "markup_pct" in has:
        price = cost * (1 + _f(args, "markup_pct") / 100)
    else:
        raise FinanceError("Give price, margin_pct or markup_pct with the cost.")
    if price <= 0:
        raise FinanceError("price must be more than 0.")
    profit = price - cost
    return "\n".join(
        [
            "## Margin and markup",
            "",
            table(
                ["Cost", "Price", "Profit", "Gross margin", "Markup"],
                [
                    (
                        money(cost, cur),
                        money(price, cur),
                        money(profit, cur),
                        pct(profit / price),
                        pct(profit / cost) if cost else "n/a",
                    )
                ],
            ),
            "",
            "Formula: margin = (price - cost) / price; markup = (price - cost) / cost; price "
            "for a target margin = cost / (1 - margin); for a markup = cost x (1 + markup). "
            "A 30% markup is only a 23.08% margin.",
        ]
    )


def depreciation(
    cost: float, salvage: float, life: int, method: str = "straight_line", rate: float | None = None
) -> list[tuple[int, float, float, float, float]]:
    """Rows: (year, opening value, depreciation, accumulated, closing value)."""
    if cost <= 0 or salvage < 0 or salvage >= cost:
        raise FinanceError("Give cost more than 0 and a salvage value below the cost.")
    if not 1 <= life <= 100:
        raise FinanceError("life_years must be 1 to 100.")
    rows, nbv, acc = [], cost, 0.0
    if method == "straight_line":
        dep = (cost - salvage) / life
        for y in range(1, life + 1):
            acc += dep
            rows.append((y, nbv, dep, acc, nbv - dep))
            nbv -= dep
        return rows
    if method != "declining_balance":
        raise FinanceError("method is straight_line or declining_balance.")
    r = rate if rate is not None else 2 / life  # double declining balance
    if not 0 < r < 1:
        raise FinanceError("The declining-balance rate must be between 0% and 100%.")
    for y in range(1, life + 1):
        dep = nbv * r
        if y == life or nbv - dep < salvage:
            dep = nbv - salvage  # never below salvage; the last year writes down to it
        acc += dep
        rows.append((y, nbv, dep, acc, nbv - dep))
        nbv -= dep
    return rows


def _depreciation_text(args: dict[str, Any], cur: str) -> str:
    method = str(args.get("method") or "straight_line").lower().replace(" ", "_").replace("-", "_")
    if method in ("straight", "sl"):
        method = "straight_line"
    if method in ("declining", "reducing", "reducing_balance", "db", "ddb", "double_declining"):
        method = "declining_balance"
    life = int(_f(args, "life_years"))
    rate = _f(args, "rate") / 100 if args.get("rate") not in (None, "") else None
    rows = depreciation(_f(args, "cost"), _f(args, "salvage", 0), life, method, rate)
    formula = (
        "Formula: yearly depreciation = (cost - salvage) / useful life."
        if method == "straight_line"
        else f"Formula: depreciation = opening value x {pct(rate or 2 / life)} (default "
        "2 / life, double declining balance), never going below the salvage value; the last "
        "year writes down to salvage."
    )
    return "\n".join(
        [
            f"## Depreciation ({method.replace('_', ' ')})",
            "",
            formula,
            "",
            table(
                ["Year", "Opening value", "Depreciation", "Accumulated", "Closing value"],
                [(y, num(o), num(d), num(a), num(c)) for y, o, d, a, c in rows],
            ),
            "",
            "Note: tax capital allowances in Malaysia follow LHDN rates, which differ from "
            "book depreciation.",
        ]
    )


def cagr(start: float, end: float, periods: float) -> float:
    if start <= 0 or end <= 0 or periods <= 0:
        raise FinanceError("CAGR needs positive start and end values and periods.")
    return (end / start) ** (1 / periods) - 1


def _growth_text(args: dict[str, Any], cur: str) -> str:
    start = _f(args, "start_value")
    periods = int(_f(args, "periods"))
    if not 1 <= periods <= MAX_PERIODS:
        raise FinanceError(f"periods must be 1 to {MAX_PERIODS}.")
    if args.get("end_value") not in (None, "") and args.get("rate") in (None, ""):
        end = _f(args, "end_value")
        g = cagr(start, end, periods)
        return "\n".join(
            [
                "## Compound annual growth rate (CAGR)",
                "",
                f"- From {num(start)} to {num(end)} over {periods} periods: **{pct(g)} a period**",
                "",
                "Formula: CAGR = (end / start)^(1 / periods) - 1.",
            ]
        )
    g = _f(args, "rate") / 100
    rows, v = [], start
    for t in range(1, periods + 1):
        v *= 1 + g
        rows.append((t, num(v)))
    shown = rows if periods <= 60 else rows[:12] + [("...", "...")] + rows[-6:]
    return "\n".join(
        [
            f"## Compound growth at {num(g * 100)}% a period",
            "",
            f"- After {periods} periods: **{num(start * (1 + g) ** periods)}** (from {num(start)})",
            "",
            "Formula: value = start x (1 + rate)^periods.",
            "",
            table(["Period", "Value"], shown),
        ]
    )


def sst(amount: float, rate_pct: float, inclusive: bool) -> tuple[float, float, float]:
    """(net, tax, gross)."""
    r = rate_pct / 100
    if inclusive:
        net = amount / (1 + r)
        return net, amount - net, amount
    return amount, amount * r, amount * (1 + r)


def _sst_text(args: dict[str, Any], cur: str) -> str:
    rate = _f(args, "tax_rate", 8)
    inclusive = bool(args.get("inclusive"))
    net, tax, gross = sst(_f(args, "amount"), rate, inclusive)
    return "\n".join(
        [
            f"## {'Tax inside a price' if inclusive else 'Tax on top of a price'} at {num(rate)}%",
            "",
            table(
                ["Before tax", "Tax", "Including tax"],
                [(money(net, cur), money(tax, cur), money(gross, cur))],
            ),
            "",
            "Formula: "
            + (
                "before tax = amount / (1 + rate); tax = amount - before tax."
                if inclusive
                else "tax = amount x rate; total = amount x (1 + rate)."
            ),
            "Rates: service tax is 8% on most taxable services (6% for some, e.g. food and "
            "beverage, telecommunications, parking, logistics); sales tax is 5% or 10% "
            "depending on the goods. Check the current Customs (JKDM) schedule for the item.",
        ]
    )


CALCS: dict[str, Callable[[dict[str, Any], str], str]] = {
    "loan": _loan_text,
    "hire_purchase": _loan_text,
    "flat_to_effective": _loan_text,
    "npv": _npv_text,
    "irr": _irr_text,
    "payback": _payback_text,
    "break_even": _break_even_text,
    "margin": _margin_text,
    "depreciation": _depreciation_text,
    "growth": _growth_text,
    "cagr": _growth_text,
    "sst": _sst_text,
}


def finance_calc(args: dict[str, Any]) -> str:
    kind = str(args.get("calculation") or "").strip().lower().replace("-", "_").replace(" ", "_")
    fn = CALCS.get(kind)
    if fn is None:
        return f"Error: calculation must be one of {', '.join(CALCS)}."
    cur = str(args.get("currency") if args.get("currency") is not None else "RM")[:6]
    try:
        return fn(args, cur)
    except FinanceError as e:
        return f"Error: {e}"


async def _finance_calc(_: ToolContext, args: dict[str, Any]) -> str:
    return finance_calc(args)


# ---------------------------------------------------------------- forecasting


@dataclass
class Fit:
    method: str
    errors: list[float]  # one-step-ahead errors, by index of the value predicted
    forecast: list[float]
    params: dict[str, float]


def _holt_run(
    y: Sequence[float], a: float, b: float, ahead: int
) -> tuple[list[float], list[float]]:
    level, trend = y[0], y[1] - y[0]
    errs = [math.nan, math.nan]  # the first two values seed the level and trend
    for t in range(1, len(y)):
        f = level + trend
        if t >= 2:
            errs.append(y[t] - f)
        new_level = a * y[t] + (1 - a) * (level + trend)
        trend = b * (new_level - level) + (1 - b) * trend
        level = new_level
    return errs, [level + h * trend for h in range(1, ahead + 1)]


def _hw_run(
    y: Sequence[float], m: int, a: float, b: float, g: float, ahead: int
) -> tuple[list[float], list[float]]:
    # Seed from the first two seasons: the trend from their means, the level at the end of
    # season one, and each season term as that period's gap from the trend line.
    mean1 = sum(y[:m]) / m
    trend = (sum(y[m : 2 * m]) / m - mean1) / m
    level = mean1 + trend * (m - 1) / 2
    season = [y[i] - (mean1 + trend * (i - (m - 1) / 2)) for i in range(m)]
    errs = [math.nan] * m
    for t in range(m, len(y)):
        s = season[t - m]
        errs.append(y[t] - (level + trend + s))
        new_level = a * (y[t] - s) + (1 - a) * (level + trend)
        trend = b * (new_level - level) + (1 - b) * trend
        season.append(g * (y[t] - new_level) + (1 - g) * s)
        level = new_level
    n = len(y)
    return errs, [level + h * trend + season[n - m + (h - 1) % m] for h in range(1, ahead + 1)]


def _sse(errs: Sequence[float]) -> float:
    return sum(e * e for e in errs if not math.isnan(e))


GRID = [round(0.05 * k, 2) for k in range(1, 20)]
GRID_HW = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


def fit_holt(y: Sequence[float], ahead: int) -> Fit:
    best: tuple[float, float, float] | None = None
    for a in GRID:
        for b in GRID:
            s = _sse(_holt_run(y, a, b, 0)[0])
            if best is None or s < best[0] - 1e-12:
                best = (s, a, b)
    assert best is not None
    errs, fc = _holt_run(y, best[1], best[2], ahead)
    return Fit("Holt linear trend", errs, fc, {"alpha": best[1], "beta": best[2]})


def fit_hw(y: Sequence[float], m: int, ahead: int) -> Fit:
    best: tuple[float, float, float, float] | None = None
    for a in GRID_HW:
        for b in GRID_HW:
            for g in GRID_HW:
                s = _sse(_hw_run(y, m, a, b, g, 0)[0])
                if best is None or s < best[0] - 1e-12:
                    best = (s, a, b, g)
    assert best is not None
    errs, fc = _hw_run(y, m, best[1], best[2], best[3], ahead)
    return Fit(
        "Holt-Winters additive (trend + season)",
        errs,
        fc,
        {"alpha": best[1], "beta": best[2], "gamma": best[3]},
    )


def fit_seasonal_naive(y: Sequence[float], m: int, ahead: int) -> Fit:
    errs = [math.nan] * m + [y[t] - y[t - m] for t in range(m, len(y))]
    n = len(y)
    return Fit(
        "Seasonal naive (same period last season)",
        errs,
        [y[n - m + (h - 1) % m] for h in range(1, ahead + 1)],
        {},
    )


@dataclass
class Forecast:
    method: str
    points: list[float]
    low: list[float]
    high: list[float]
    mae: float
    rmse: float
    compared: dict[str, float]  # method -> MAE on the common window
    params: dict[str, float]
    notes: list[str]


def forecast(values: Sequence[float], ahead: int, season_length: int | None = None) -> Forecast:
    y = [float(v) for v in values]
    if len(y) < 3:
        raise FinanceError("Give at least 3 values (more is better: 2 years for seasonality).")
    if len(y) > MAX_SERIES:
        raise FinanceError(f"At most {MAX_SERIES} values.")
    if not 1 <= ahead <= MAX_AHEAD:
        raise FinanceError(f"periods ahead must be 1 to {MAX_AHEAD}.")
    notes: list[str] = []
    fits = [fit_holt(y, ahead)]
    start = 2
    m = season_length or 0
    if m:
        if m < 2:
            raise FinanceError("season_length must be at least 2 (12 for monthly data).")
        if len(y) >= 2 * m:
            fits += [fit_seasonal_naive(y, m, ahead), fit_hw(y, m, ahead)]
            start = max(start, m)
        else:
            notes.append(
                f"Seasonality needs at least two full seasons ({2 * m} values); with "
                f"{len(y)} only the trend was fitted."
            )
    compared: dict[str, float] = {}
    for f in fits:
        window = [e for e in f.errors[start:] if not math.isnan(e)]
        compared[f.method] = sum(abs(e) for e in window) / len(window) if window else math.inf
    best = min(fits, key=lambda f: compared[f.method])  # ties keep the simpler (first) one
    window = [e for e in best.errors[start:] if not math.isnan(e)]
    rmse = math.sqrt(sum(e * e for e in window) / len(window)) if window else 0.0
    if len(y) < 8:
        notes.append(
            f"Only {len(y)} values: treat this as a rough direction, not a forecast to plan "
            "cash on."
        )
    if not window or rmse <= 1e-9 * max(1.0, max(abs(v) for v in y)):
        notes.append(
            "The method fits the history exactly, so the range shows no spread; real "
            "results will vary."
        )
    points = list(best.forecast)
    low = [p - Z80 * rmse * math.sqrt(h) for h, p in enumerate(points, 1)]
    high = [p + Z80 * rmse * math.sqrt(h) for h, p in enumerate(points, 1)]
    if min(y) >= 0 and min(low) < 0:
        low = [max(0.0, v) for v in low]
        if min(points) < 0:
            points = [max(0.0, v) for v in points]
            notes.append("The trend runs below zero; values were floored at 0.")
    if ahead > max(3, len(y) // 2):
        notes.append(
            f"{ahead} periods ahead from {len(y)} values is a long reach: the far end is "
            "mostly the trend carried forward."
        )
    return Forecast(
        best.method,
        points,
        low,
        high,
        compared[best.method],
        rmse,
        compared,
        best.params,
        notes,
    )


def _labels(last: str | None, ahead: int) -> list[str]:
    if last and len(last) == 7 and last[4] == "-" and last[:4].isdigit() and last[5:].isdigit():
        y, mth = int(last[:4]), int(last[5:])
        out = []
        for _ in range(ahead):
            mth += 1
            if mth > 12:
                y, mth = y + 1, 1
            out.append(f"{y}-{mth:02d}")
        return out
    return [f"+{h}" for h in range(1, ahead + 1)]


def forecast_text(args: dict[str, Any]) -> str:
    raw = args.get("values")
    if not isinstance(raw, list):
        return "Error: give values as a list of numbers, oldest first."
    try:
        vals = [_f({"v": v}, "v") for v in raw]
        ahead = int(_f(args, "periods", 6))
        season = args.get("season_length")
        m = int(_f(args, "season_length")) if season not in (None, "", 0) else None
        fc = forecast(vals, ahead, m)
    except FinanceError as e:
        return f"Error: {e}"
    labels = _labels(str(args.get("last_period") or "") or None, ahead)
    lines = [
        f"## Forecast: {ahead} period(s) ahead from {len(vals)} values",
        "",
        f"- Method: **{fc.method}**"
        + (" (" + ", ".join(f"{k} {v}" for k, v in fc.params.items()) + ")" if fc.params else ""),
        f"- Typical one-step error on the history: {num(fc.mae)} (MAE), {num(fc.rmse)} (RMSE)",
        f"- Total of the forecast: {num(sum(fc.points))}",
    ]
    if len(fc.compared) > 1:
        lines.append(
            "- Compared (MAE, lower is better): "
            + "; ".join(f"{k} {num(v)}" for k, v in fc.compared.items())
        )
    lines += [
        "",
        table(
            ["Period", "Forecast", "80% range low", "80% range high"],
            [
                (lab, num(p), num(lo), num(hi))
                for lab, p, lo, hi in zip(labels, fc.points, fc.low, fc.high, strict=True)
            ],
        ),
        "",
        "How: exponential smoothing fitted by least squared one-step-ahead error. Holt: "
        "level_t = a*y_t + (1-a)(level + trend); trend_t = b*(level_t - level) + (1-b)*trend; "
        "forecast_h = level + h*trend. Holt-Winters adds a seasonal term per period of the "
        "season. The 80% range is forecast +/- 1.28 x RMSE x sqrt(h), an approximation that "
        "assumes the past errors are typical.",
    ]
    if fc.notes:
        lines += ["", "Notes:"] + [f"- {n}" for n in fc.notes]
    return "\n".join(lines)


async def _forecast(_: ToolContext, args: dict[str, Any]) -> str:
    return forecast_text(args)


# ---------------------------------------------------------------- registration

_NUM = {"type": "number"}

FINANCE_TOOLS = (
    Tool(
        "finance_calc",
        "Finance calculator",
        "Exact finance maths with the formula shown (no guessing): loan or hire-purchase "
        "instalments and amortization schedules (method flat, as in Malaysian hire purchase, "
        "or reducing balance) with the effective rate behind a flat rate; npv, irr and payback "
        "of cash flows; break_even units and revenue; margin and markup; depreciation "
        "(straight_line or declining_balance); growth and cagr; sst added to or taken out of "
        "a price. Use it for every financial figure instead of working it out yourself.",
        {
            "type": "object",
            "properties": {
                "calculation": {
                    "type": "string",
                    "enum": list(CALCS),
                    "description": "Which calculation to run",
                },
                "principal": {**_NUM, "description": "loan: amount financed"},
                "rate": {
                    **_NUM,
                    "description": "Percent a year (loan: flat or reducing rate; npv/payback: "
                    "discount rate per period; growth: growth per period; depreciation: "
                    "declining-balance rate)",
                },
                "years": {**_NUM, "description": "loan term in years (or give months)"},
                "months": {**_NUM, "description": "loan term in months"},
                "method": {
                    "type": "string",
                    "description": "loan: flat | reducing. depreciation: straight_line | "
                    "declining_balance",
                },
                "schedule": {
                    "type": "string",
                    "enum": ["monthly", "yearly", "none"],
                    "description": "loan schedule detail (default monthly up to 60 months)",
                },
                "cash_flows": {
                    "type": "array",
                    "items": _NUM,
                    "description": "npv/irr/payback: one per period, the first is today",
                },
                "fixed_costs": _NUM,
                "price": {**_NUM, "description": "break_even/margin: selling price per unit"},
                "variable_cost": {**_NUM, "description": "break_even: variable cost per unit"},
                "target_profit": _NUM,
                "cost": {**_NUM, "description": "margin: unit cost; depreciation: asset cost"},
                "margin_pct": {**_NUM, "description": "margin: target gross margin %"},
                "markup_pct": {**_NUM, "description": "margin: markup % on cost"},
                "revenue": _NUM,
                "cogs": {**_NUM, "description": "cost of goods sold"},
                "operating_expenses": _NUM,
                "net_profit": _NUM,
                "salvage": {**_NUM, "description": "depreciation: value at the end of life"},
                "life_years": {**_NUM, "description": "depreciation: useful life in years"},
                "start_value": _NUM,
                "end_value": {**_NUM, "description": "cagr: final value"},
                "periods": {**_NUM, "description": "growth/cagr: number of periods"},
                "amount": {**_NUM, "description": "sst: the price"},
                "tax_rate": {**_NUM, "description": "sst: percent (default 8)"},
                "inclusive": {
                    "type": "boolean",
                    "description": "sst: true when the amount already includes the tax",
                },
                "currency": {"type": "string", "description": "Label for amounts (default RM)"},
            },
            "required": ["calculation"],
        },
        "low",
        "allow",
        _finance_calc,
    ),
    Tool(
        "forecast",
        "Forecast a series",
        "Forecast the next periods of a numeric series (monthly sales, cash in, orders) with "
        "exponential smoothing: Holt's trend, and with season_length (12 for monthly) and two "
        "seasons of history also seasonal naive and Holt-Winters, picking the most accurate "
        "on the history. Returns forecasts with an 80% range, the method and honest notes "
        "when the data is short. Deterministic: no model guesses.",
        {
            "type": "object",
            "properties": {
                "values": {
                    "type": "array",
                    "items": _NUM,
                    "description": "The history, oldest first, evenly spaced",
                },
                "periods": {"type": "integer", "description": "How many periods ahead (1-36)"},
                "season_length": {
                    "type": "integer",
                    "description": "Periods per season, e.g. 12 for monthly, 4 for quarterly",
                },
                "last_period": {
                    "type": "string",
                    "description": "The last value's month as YYYY-MM, to label the forecast",
                },
            },
            "required": ["values", "periods"],
        },
        "low",
        "allow",
        _forecast,
    ),
)
