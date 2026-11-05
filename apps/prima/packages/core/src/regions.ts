// Operating regions. A Regional Operations Manager covers every company that has sites in
// the region (Fauzan, 24 Oct 2026); there is no Operations Manager inside each company.
// Regions group states only for monitoring: each company still controls its own sites.

export interface Region {
  id: string;
  name: string;
  states: string[];
}

// Seven regions (Fauzan, 2 Nov 2026, Government Operations go-live): Perak, Sarawak and Sabah each have their own
// regional manager, so they are regions of their own. Existing ids are kept so saved records still match.
export const REGIONS: Region[] = [
  { id: 'northern', name: 'Northern', states: ['Pulau Pinang', 'Kedah', 'Perlis'] },
  { id: 'perak', name: 'Perak', states: ['Perak'] },
  { id: 'central', name: 'Central', states: ['Selangor', 'Kuala Lumpur', 'Putrajaya', 'Negeri Sembilan'] },
  { id: 'southern', name: 'Southern', states: ['Melaka', 'Johor'] },
  { id: 'east_coast', name: 'Eastern', states: ['Pahang', 'Terengganu', 'Kelantan'] },
  { id: 'sarawak', name: 'Sarawak', states: ['Sarawak'] },
  { id: 'sabah', name: 'Sabah', states: ['Sabah', 'Labuan'] },
];

export function regionOfState(state: string): Region | undefined {
  return REGIONS.find((r) => r.states.includes(state));
}
