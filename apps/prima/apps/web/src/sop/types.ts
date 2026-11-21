import type { ViewName } from '../App';
import type { NavSectionId } from '../nav-catalog';

/**
 * P121 (Fitri, 21 Nov 2026: "Fauzan already declared all the SOPs and workflows in the original repository, but on our
 * Prima side they are not clear; add an SOP and workflow page that shows them all"): the SOPs and workflows of Prima,
 * one entry per flow, written from Fauzan's documents (docs/*.md) and owner decisions, with the screen where each step is
 * done. Read only: the page explains and links; who may do a step is still decided by the server.
 *
 * Text is written twice, English and Bahasa Melayu (the default); the "BM + English" setting shows the Malay. Keep it
 * plain: short sentences, the role names staff use, no code names.
 */
export interface Text2 {
  en: string;
  ms: string;
}

/** A place in Prima: a screen (menu view), optionally one of its tabs (see useRouteTab in App.tsx). */
export interface Place {
  view: ViewName;
  tab?: string;
  /** What the button says, e.g. "Open Procurement > Store". */
  label: Text2;
}

export interface SopStep {
  /** Who does this step (a role as staff say it: "Operations Manager (OM)", "Storekeeper", "CEO"). */
  who: Text2;
  /** What they do, in one or two plain sentences. */
  does: Text2;
  /** Where in Prima it is done; leave out for a step done outside Prima (on paper, at the bank, in Outlook). */
  where?: Place;
  /** This step approves or refuses (shown with a stamp). */
  decision?: boolean;
  /** Done outside Prima (paper, phone, bank, Outlook, a government portal). */
  outside?: boolean;
}

/**
 * in_force: in use now. trial: running side by side or as a trial (e.g. guard pay until 1 Aug 2027).
 * off: built, switched off until its owner turns it on. draft: decided on paper, not yet in force (e.g. needs HR/Legal
 * sign-off, or its database module is not installed).
 */
export type SopStatus = 'in_force' | 'trial' | 'off' | 'draft';

export interface Sop {
  /** Unique, kebab-case, prefixed by the app: "equip-uniform-request". Used in links: #sop/equip-uniform-request. */
  id: string;
  /** The app it belongs to (the home screen's app cards). */
  app: NavSectionId;
  title: Text2;
  /** One line: what it is for and when to use it. */
  purpose: Text2;
  /** The form or button that starts it, when there is one. */
  start?: Place;
  /** Who may start it. */
  starter: Text2;
  steps: SopStep[];
  /** The rules that always apply (reasons, limits, who may not approve, time targets). */
  rules: Text2[];
  status: SopStatus;
  /** Why it is off, trial or draft, or what is still missing. */
  statusNote?: Text2;
  /** Where it was declared: the document in the Prima repository and the owner's decision. */
  source: { doc: string; decided?: string };
  /** Extra search words (English and Malay). */
  words?: string;
}
