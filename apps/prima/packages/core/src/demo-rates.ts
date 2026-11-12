/**
 * Demo-only monthly device rents (RM), used by the demo's rental simulation and its sample bills. Synthetic: never a
 * production rate (C5, Fauzan 11 Nov 2026: real rates are entered by the IT Manager in the app, from a month).
 */
export const DEMO_IT_RENTAL_RATES: Record<string, number> = { LAPTOP: 120, DESKTOP: 90, PHONE: 45, TABLET: 40, PRINTER: 80, NETWORK: 60, CCTV: 150, OTHER: 30 };
