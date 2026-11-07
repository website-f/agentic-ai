// Client CRM (Fauzan, 4 Nov 2026: "Yes build that. We want complete"). Labels and pure checks for the client lifecycle;
// the service holds the access rules and the writes.

import { RULES } from "./rules";
import { addDays, daysBetween } from "./time";
import type {
  ClientAccount,
  ClientLostReason,
  ClientPersonRole,
  ClientRenewal,
  ClientRenewalAnswer,
  ClientRenewalDecision,
  ClientRequestKind,
  IsoDate,
} from "./types";

export const CLIENT_PERSON_ROLE: Record<ClientPersonRole, string> = {
  decision: "Decides (signs the contract)",
  site: "On site (day-to-day contact)",
  finance: "Finance (invoices and payment)",
  procurement: "Procurement or tenders",
  other: "Other",
};

export const CLIENT_REQUEST_KIND: Record<ClientRequestKind, string> = {
  more_guards: "More guards",
  fewer_guards: "Fewer guards",
  temporary: "Temporary post or event",
  schedule: "Change of hours or schedule",
  other: "Other request",
};

export const CLIENT_RENEWAL_DECISION: Record<ClientRenewalDecision, string> = {
  renew: "Renew on the same price",
  renew_new_price: "Renew at a new price",
  rebid: "Bid again (client calls a tender)",
  let_go: "Let the contract end",
};

export const CLIENT_RENEWAL_ANSWER: Record<ClientRenewalAnswer, string> = {
  accepted: "Client signed the renewal",
  declined: "Client will not renew",
  tender_called: "Client called a tender",
};

export const CLIENT_LOST_REASON: Record<ClientLostReason, string> = {
  price: "Price",
  service: "Service quality",
  tender_lost: "Lost the tender",
  in_house: "Client took security in-house",
  client_closed: "Client closed or moved",
  not_renewed_by_us: "We chose not to renew",
  other: "Other",
};

/** The lifecycle stage of a client account, for the pipeline. */
export type CrmStage =
  | "onboarding"
  | "active"
  | "renewal"
  | "offboarding"
  | "ended";

/** A renewal is open from 90 days before the contract end (Fauzan, 5 Nov 2026) until it is answered. */
export function renewalWindowOpen(
  a: Pick<ClientAccount, "stage" | "contractEndsOn">,
  today: IsoDate,
): boolean {
  if (a.stage !== "active" || !a.contractEndsOn) return false;
  return (
    daysBetween(today, a.contractEndsOn) <= RULES.crm.value.renewalOpenDays
  );
}

export function crmStage(a: ClientAccount, today: IsoDate): CrmStage {
  if (
    a.stage === "active" &&
    (renewalWindowOpen(a, today) || (a.renewal && !a.renewal.closedAt))
  )
    return "renewal";
  return a.stage;
}

/**
 * What the renewal still needs, and how urgent. Nothing decided by 60 days before the end is a warning, by 30 days or
 * past the end it is critical; the offer must be sent by 45 days before (Fauzan, 5 Nov 2026).
 */
export function renewalState(
  a: Pick<ClientAccount, "stage" | "contractEndsOn" | "renewal" | "renewals">,
  today: IsoDate,
) {
  const r = RULES.crm.value;
  const ends =
    a.renewal && !a.renewal.closedAt ? a.renewal.endsOn : a.contractEndsOn;
  if (a.stage !== "active" || !ends) return null;
  const left = daysBetween(today, ends);
  // The client already said no to renewing this end date: the only step left is offboarding.
  if (renewalDeclined(a))
    return {
      endsOn: ends,
      daysLeft: left,
      next: "Client will not renew: start offboarding",
      late: left < 0 ? `Contract ended ${-left} days ago` : null,
      tone: "crit" as const,
      decideBy: addDays(ends, -r.decideByDays),
      offerBy: addDays(ends, -r.proposalByDays),
    };
  if (left > r.renewalOpenDays && !(a.renewal && !a.renewal.closedAt))
    return null;
  const rn: ClientRenewal | null =
    a.renewal && !a.renewal.closedAt ? a.renewal : null;
  const next = !rn?.decision
    ? "Company manager to decide: renew, new price, rebid or let go"
    : rn.decision.choice === "let_go"
      ? "Start offboarding"
      : !rn.proposal && rn.decision.choice !== "rebid"
        ? "Send the renewal offer to the client"
        : !rn.answer
          ? rn.decision.choice === "rebid"
            ? "Bid in the client tender, then record the answer"
            : "Record the client's answer"
          : rn.answer.choice === "tender_called"
            ? "Bid in the client tender, then record the answer"
            : "Close the renewal";
  const late =
    left < 0
      ? `Contract ended ${-left} days ago`
      : !rn?.decision && left <= r.decideByDays
        ? `No decision, ${left} days to the end`
        : rn?.decision &&
            rn.decision.choice !== "let_go" &&
            rn.decision.choice !== "rebid" &&
            !rn.proposal &&
            left <= r.proposalByDays
          ? `Offer not sent, ${left} days to the end`
          : null;
  const tone: "crit" | "warn" | "info" =
    left < 0 || (late && left <= 30) ? "crit" : late ? "warn" : "info";
  return {
    endsOn: ends,
    daysLeft: left,
    next,
    late,
    tone,
    decideBy: addDays(ends, -r.decideByDays),
    offerBy: addDays(ends, -r.proposalByDays),
  };
}

/** The last renewal for the current end date closed with the client declining. */
export function renewalDeclined(
  a: Pick<ClientAccount, "contractEndsOn" | "renewal" | "renewals">,
): boolean {
  if (a.renewal && !a.renewal.closedAt) return false;
  const last = a.renewals?.at(-1);
  return (
    !!last &&
    last.endsOn === a.contractEndsOn &&
    last.answer?.choice === "declined"
  );
}

/** A name key for spotting the same client at two group companies. */
export function clientKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(mock\)|sdn\.? bhd\.?|berhad|bhd|[^a-z0-9]/g, "");
}
