import type { BoardCommittee } from "./board-registers";
import type { DirectorInterest } from "./board-registers";
import type { RelatedPartyDeal } from "./board-registers";
import type { RiskEntry } from "./board-registers";
import { addDays } from "./time";
import { myt } from "./time";
import type { Dataset } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";


export function seedBoardRegisters(ds: Dataset, today: IsoDate) {
  const at = (daysAgo: number) => myt(addDays(today, -daysAgo), "10:00");
  const manager = (companyId: Id) =>
    ds.users.find(
      (u) => u.role === "company_manager" && u.companyIds.includes(companyId),
    ) ?? null;
  const cos = ds.users.find((u) => u.leadership === "cos") ?? null;
  const by = (companyId: Id) => {
    const u = companyId === "pwvsb" ? cos : manager(companyId);
    return {
      recordedBy: u?.name ?? "Company Manager (mock)",
      recordedById: u?.id ?? "u-cm",
    };
  };
  const has = (id: Id) =>
    id === "pwvsb" || ds.companies.some((c) => c.id === id);
  // Deals and declarations: the Deputy Chief of Staff records; the Chief of Staff reviews (Fauzan, 5 Nov 2026).
  const dcos = ds.users.find((u) => u.leadership === "deputy_cos") ?? null;
  const desk = {
    recordedBy: dcos?.name ?? "Deputy Chief of Staff (mock)",
    recordedById: dcos?.id ?? "u-dcos",
  };
  // Risks: the ACT Director runs them and gives work to the team.
  const actDir = ds.users.find((u) => u.id === "u-audit") ?? null;
  const actTeam = ds.users.filter(
    (u) =>
      u.role === "pwvsb_officer" &&
      u.department === "audit" &&
      u.id !== "u-audit",
  );
  const act = {
    recordedBy: actDir?.name ?? "ACT Director (mock)",
    recordedById: actDir?.id ?? "u-audit",
  };

  // ----- Related-party deals -----
  const deals: [
    Id,
    string,
    RelatedPartyDeal["party"],
    string,
    RelatedPartyDeal["nature"],
    number,
    string,
    string[],
    RelatedPartyDeal["status"],
    number,
  ][] = [
    [
      "co-sasa",
      "Goodwill Empire Sdn Bhd",
      "group_company",
      "Fellow PWVSB group company",
      "equipment_rental",
      186_000,
      "Group equipment rate card 2026 (mock)",
      [],
      "awaiting_review",
      3,
    ],
    [
      "co-sasa",
      "Hartanah Seri Mewah Sdn Bhd (mock)",
      "director_company",
      "Owned by director Encik Rahim Osman (mock)",
      "rent",
      288_000,
      "Two valuer letters on market rent, RM11,500 to RM12,500 a month (mock)",
      ["Rahim Osman (mock)"],
      "awaiting_review",
      9,
    ],
    [
      "co-arsh",
      "PWVSB",
      "shareholder",
      "Holding shareholder",
      "management_fee",
      420_000,
      "Management agreement fee schedule, FD-set rate (mock)",
      [],
      "done",
      40,
    ],
    [
      "co-arsh",
      "Lau Trading Enterprise (mock)",
      "family",
      "Owned by the Company Manager's brother (mock)",
      "purchase",
      18_400,
      "One quote only (mock)",
      [],
      "questioned",
      6,
    ],
    [
      "co-inas",
      "Merdeka Network Sdn Bhd",
      "group_company",
      "Fellow PWVSB group company (IT)",
      "equipment_rental",
      54_000,
      "IT device rental rates set by the IT Manager (mock)",
      [],
      "done",
      22,
    ],
    [
      "co-inas",
      "PWVSB",
      "shareholder",
      "Holding shareholder; loan under the KPKT moneylending licence",
      "loan",
      500_000,
      "Group lending rate 6% a year, same for all companies (mock)",
      [],
      "awaiting_review",
      1,
    ],
  ];
  deals.forEach(
    (
      [
        companyId,
        counterparty,
        party,
        relationship,
        nature,
        amount,
        basis,
        interested,
        status,
        age,
      ],
      i,
    ) => {
      if (!has(companyId)) return;
      const id = `rpt-${companyId}-${i + 1}`;
      const reviewed = status !== "awaiting_review";
      ds.regRelatedParties.push({
        id,
        companyId,
        counterparty,
        party,
        relationship,
        nature,
        description: "",
        amount,
        startOn: addDays(today, -age),
        endOn: nature === "purchase" ? null : addDays(today, 365 - age),
        fairPriceBasis: basis,
        interestedDirectors: interested,
        ...desk,
        at: at(age),
        status,
        review: reviewed
          ? {
              by: cos?.name ?? "Chief of Staff (mock)",
              byId: cos?.id ?? "u-cos",
              at: at(Math.max(0, age - 1)),
              agree: status !== "questioned",
              note:
                status === "questioned"
                  ? "Only one quote and a family link. Get two more quotes."
                  : "Rate matches the group rate card.",
            }
          : null,
        answers: [],
        board: false
          ? {
              resolutionRef: `${companyId.toUpperCase()}/BR/2026/RPT${i + 1}`,
              on: addDays(today, -age + 3),
              interestedStayedOut: true,
              by: desk.recordedBy,
              byId: desk.recordedById,
              at: at(age - 3),
            }
          : null,
      });
    },
  );

  // ----- Directors' interests -----
  const decl: [Id, string, number, DirectorInterest["interests"]][] = [
    [
      "co-sasa",
      "Rahim Osman (mock)",
      120,
      [
        {
          kind: "directorship",
          detail: "Director, Hartanah Seri Mewah Sdn Bhd (mock)",
        },
        { kind: "shareholding", detail: "40% of Hartanah Seri Mewah (mock)" },
      ],
    ],
    ["co-sasa", "Zulkifli Hamzah (mock)", 400, []],
    [
      "co-arsh",
      "Tan Mei Ling (mock)",
      200,
      [
        {
          kind: "family",
          detail: "Brother runs Lau Trading Enterprise (mock)",
        },
      ],
    ],
    ["co-inas", "Faridah Ismail (mock)", 30, []],
    [
      "pwvsb",
      "Group director A (mock)",
      90,
      [
        {
          kind: "directorship",
          detail: "Director of all PWVSB group companies",
        },
      ],
    ],
  ];
  decl.forEach(([companyId, directorName, age, interests], i) => {
    if (!has(companyId)) return;
    ds.regInterests.push({
      id: `dir-${companyId}-${i + 1}`,
      companyId,
      directorName,
      directorUserId: null,
      nothingToDeclare: !interests.length,
      interests,
      declaredOn: addDays(today, -age),
      formRef: `DECL-${companyId.toUpperCase()}-${addDays(today, -age).slice(0, 4)}-${i + 1}`,
      ...desk,
      at: at(age),
      seen:
        age > 60
          ? {
              by: cos?.name ?? "Chief of Staff (mock)",
              byId: cos?.id ?? "u-cos",
              at: at(age - 5),
              note: "Read; matches the SSM director list.",
            }
          : null,
      replacedById: null,
    });
  });

  // ----- Committees -----
  const com: [
    Id,
    string,
    BoardCommittee["kind"],
    number,
    BoardCommittee["members"],
    number | null,
  ][] = [
    [
      "pwvsb",
      "Group audit and risk committee",
      "audit_risk",
      3,
      [
        { name: "Independent member A (mock)", chair: true, independent: true },
        {
          name: "Independent member B (mock)",
          chair: false,
          independent: true,
        },
        { name: "Group director A (mock)", chair: false, independent: false },
      ],
      40,
    ],
    [
      "pwvsb",
      "Group pay and rewards committee",
      "remuneration",
      6,
      [
        { name: "Group director A (mock)", chair: true, independent: false },
        { name: "Group director B (mock)", chair: false, independent: false },
      ],
      220,
    ],
    [
      "co-sasa",
      "Sasa tender committee",
      "tender",
      1,
      [
        { name: "Rahim Osman (mock)", chair: true, independent: false },
        { name: "Zulkifli Hamzah (mock)", chair: false, independent: false },
      ],
      null,
    ],
  ];
  com.forEach(([companyId, name, kind, every, members, lastAgo], i) => {
    if (!has(companyId)) return;
    const b = by(companyId);
    ds.regCommittees.push({
      id: `com-${companyId}-${i + 1}`,
      companyId,
      name,
      kind,
      members,
      meetEveryMonths: every,
      termsRef: `${companyId.toUpperCase()}/BR/2026/TOR${i + 1}`,
      meetings:
        lastAgo === null
          ? []
          : [
              {
                on: addDays(today, -lastAgo),
                present: members.length,
                minutesRef: `MIN-${companyId.toUpperCase()}-${i + 1}`,
                actionsOpen: 2,
                by: b.recordedBy,
                byId: b.recordedById,
                at: at(lastAgo),
              },
            ],
      ...b,
      at: at(300),
    });
  });

  // ----- Risks -----
  const risk: [
    Id,
    string,
    RiskEntry["category"],
    string,
    number,
    number,
    string,
    string,
    number,
    number,
    number,
  ][] = [
    [
      "pwvsb",
      "A group company loses its KDN licence at renewal",
      "licence",
      "Chief of Staff (mock)",
      2,
      5,
      "Licence tracker 120 days ahead; CSG quota plan",
      "Check every renewal pack 90 days before expiry",
      60,
      20,
      100,
    ],
    [
      "pwvsb",
      "Related-party deals not at fair price",
      "financial",
      "Finance Director (mock)",
      3,
      3,
      "This register; FD-set group rates",
      "Review the group rate card yearly",
      120,
      200,
      100,
    ],
    [
      "co-sasa",
      "Client pays late on large government contracts",
      "financial",
      "Company Manager (mock)",
      4,
      4,
      "Monthly client acknowledgement by the 10th; aged debt list",
      "Escalate any invoice over 90 days to the COO",
      20,
      100,
      30,
    ],
    [
      "co-sasa",
      "Guards not at post at night",
      "operational",
      "Operations Manager (mock)",
      3,
      4,
      "Patrol checks, CMS video calls",
      "Add one more night patrol round",
      30,
      40,
      90,
    ],
    [
      "co-arsh",
      "Firearm lost or misused",
      "licence",
      "Arms Control (mock)",
      1,
      5,
      "Vault RFID scan, CCTV, Arms Control coordination",
      "",
      0,
      50,
      50,
    ],
    [
      "co-inas",
      "Key admin staff leave with no backup",
      "people",
      "Company Manager (mock)",
      3,
      3,
      "Desk owner and backup for each desk",
      "Train a second admin executive",
      45,
      210,
      60,
    ],
  ];
  risk.forEach(
    (
      [
        companyId,
        title,
        category,
        ownerName,
        likelihood,
        impact,
        controls,
        action,
        dueIn,
        reviewedAgo,
        recordedAgo,
      ],
      i,
    ) => {
      if (!has(companyId)) return;
      const b = act;
      const lastReviewedOn = addDays(today, -reviewedAgo);
      const to =
        i % 2 === 0
          ? (actTeam[(i / 2) % Math.max(1, actTeam.length)] ?? null)
          : null;
      ds.regRisks.push({
        id: `risk-${companyId}-${i + 1}`,
        companyId,
        title,
        category,
        ownerName,
        likelihood,
        impact,
        controls,
        action,
        actionDueOn: action ? addDays(today, dueIn) : null,
        lastReviewedOn,
        reviews: [
          {
            on: lastReviewedOn,
            likelihood,
            impact,
            note: "Reviewed at the management meeting (mock)",
            by: b.recordedBy,
            byId: b.recordedById,
            at: myt(lastReviewedOn, "10:00"),
          },
        ],
        assignedToId: to?.id ?? null,
        assignedTo: to?.name ?? null,
        instructions: to
          ? [
              {
                by: b.recordedBy,
                byId: b.recordedById,
                at: at(Math.max(0, reviewedAgo - 1)),
                note: "Check the controls with the owner and update the score (mock)",
                toId: to.id,
                to: to.name,
              },
            ]
          : [],
        status: "open",
        closed: null,
        ...b,
        at: at(Math.max(recordedAgo, reviewedAgo)),
      });
    },
  );
}