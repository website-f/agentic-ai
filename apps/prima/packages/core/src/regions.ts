// Operating regions. A Regional Operations Manager covers every company that has sites in
// the region (Fauzan, 24 Oct 2026); there is no Operations Manager inside each company.
// Regions group states only for monitoring: each company still controls its own sites.

export interface Region {
  id: string;
  name: string;
  states: string[];
}

export const REGIONS: Region[] = [
  { id: 'central', name: 'Central', states: ['Selangor', 'Kuala Lumpur', 'Putrajaya', 'Negeri Sembilan'] },
  { id: 'southern', name: 'Southern', states: ['Melaka', 'Johor'] },
  { id: 'northern', name: 'Northern', states: ['Pulau Pinang', 'Perak', 'Kedah', 'Perlis'] },
  { id: 'east_coast', name: 'East Coast', states: ['Pahang', 'Terengganu', 'Kelantan'] },
  { id: 'east_malaysia', name: 'Sabah and Sarawak', states: ['Sabah', 'Sarawak', 'Labuan'] },
];

export function regionOfState(state: string): Region | undefined {
  return REGIONS.find((r) => r.states.includes(state));
}
