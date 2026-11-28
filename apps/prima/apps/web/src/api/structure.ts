/**
 * P145 (owner, 27 Nov 2026: "full revamp of the org chart, organization and members: the roles from the two PDFs
 * (Director Office governance, Government operation), every member placed in a role, unknown ones sorted by hand,
 * add a role when it is not listed"). The office keeps the group structure: units (offices, departments, regions)
 * and the positions (job roles) in them, each reporting to another position, and which member holds which position.
 * Prima's org chart and member pages read and change it here (office API on this same site; api/office.ts carries
 * the cookie and CSRF token). The office checks every permission again.
 *
 * Contract (apps/api/agentic/api/routers/org_structure.py):
 *   GET    /api/org/structure                      -> Structure
 *   POST   /api/org/structure/units                {name, name_ms?, parent_id?, kind?, branch_id?, department_id?} -> OrgUnitRow
 *   PATCH  /api/org/structure/units/{id}           any of the above + sort -> OrgUnitRow
 *   DELETE /api/org/structure/units/{id}           (only an empty custom unit) -> 204
 *   POST   /api/org/structure/positions            {title, title_ms?, unit_id, reports_to_id?, default_role?, headcount?, duties?} -> PositionRow
 *   PATCH  /api/org/structure/positions/{id}       any of the above + sort -> PositionRow
 *   DELETE /api/org/structure/positions/{id}       (nobody holds it; ?move_holders=true puts its holders in Unsorted) -> 204
 *   POST   /api/org/structure/seed                 owners: put back the units and positions from the PDFs that are missing
 *   PUT    /api/members/{user_id}/position         {position_id: string | null, set_job_title?: boolean} -> {ok: true}
 *   POST   /api/org/structure/assign               {user_ids: string[], position_id: string | null} -> {done: number, skipped: {user_id, message}[]}
 *
 * P146 (owner, 28 Nov 2026): every office company (branch) and its departments are units too (kind "company" with
 * branch_id; "department" with department_id), made by the office on read when missing. A new role may carry the other
 * names of a role it was picked from (aliases). Each member's reports_to_user_id is in the read (set with PATCH
 * /api/members/{id} {reports_to_user_id}, api/office.ts updateMember). Work groups: people of one unit who work
 * together (a pair or a small team), drawn side by side; lead_user_id is the person they work with. One group per
 * member per unit: a member already in another group of the unit is refused (409 group_member_taken) unless move=true.
 *   POST   /api/org/structure/groups               {unit_id, member_ids, name?, lead_user_id?, move?} -> WorkGroup
 *   PATCH  /api/org/structure/groups/{id}          {name?, lead_user_id?, member_ids?, sort?, move?} -> WorkGroup
 *   DELETE /api/org/structure/groups/{id}          (its people stay where they are) -> 204
 */
import { officeFetch } from './office';

export type UnitKind = 'governance' | 'office' | 'department' | 'unit' | 'division' | 'region' | 'company' | 'team';

export interface OrgUnitRow {
  id: string;
  key: string;
  name: string;
  name_ms: string | null;
  parent_id: string | null;
  kind: UnitKind;
  /** The office company (branch) and department this unit stands for, when it is one. */
  branch_id: string | null;
  department_id: string | null;
  sort: number;
  /** Added in the app (not from the PDFs); may be renamed or removed. */
  custom: boolean;
}

export interface PositionRow {
  id: string;
  key: string;
  title: string;
  title_ms: string | null;
  unit_id: string;
  reports_to_id: string | null;
  level: number;
  /** The office role a person in this position usually has (owner never). */
  default_role: string | null;
  /** Planned number of people (from the PDFs), or null. */
  headcount: number | null;
  duties: string | null;
  aliases: string[];
  sort: number;
  custom: boolean;
}

export interface StructureMember {
  user_id: string;
  name: string;
  email: string;
  work_email: string | null;
  role: string;
  is_active: boolean;
  branch_id: string | null;
  branch_name: string | null;
  department_id: string | null;
  department_name: string | null;
  job_title: string | null;
  position_id: string | null;
  /** Their Prima account (the org chart's person id), when the office linked one. */
  prima_id?: string | null;
  /** P146: the person they report to (any member), or null. */
  reports_to_user_id?: string | null;
}

/** P146: people of one unit who work together (a pair or a small team). */
export interface WorkGroup {
  id: string;
  unit_id: string;
  name: string | null;
  /** The person the group works with (reports to), or null. */
  lead_user_id: string | null;
  member_ids: string[];
  sort: number;
}

export interface Structure {
  units: OrgUnitRow[];
  positions: PositionRow[];
  members: StructureMember[];
  /** P146: work groups (older offices send none). */
  groups?: WorkGroup[];
  /** Whoever may change units, positions and who holds them (org.manage or members.manage). */
  can_edit: boolean;
}

const id = encodeURIComponent;

export const structure = {
  get: () => officeFetch<Structure>('GET', '/api/org/structure'),
  addUnit: (body: { name: string; name_ms?: string | null; parent_id?: string | null; kind?: UnitKind; branch_id?: string | null; department_id?: string | null }) =>
    officeFetch<OrgUnitRow>('POST', '/api/org/structure/units', body),
  updateUnit: (unitId: string, body: Partial<Pick<OrgUnitRow, 'name' | 'name_ms' | 'parent_id' | 'kind' | 'branch_id' | 'department_id' | 'sort'>>) =>
    officeFetch<OrgUnitRow>('PATCH', `/api/org/structure/units/${id(unitId)}`, body),
  removeUnit: (unitId: string) => officeFetch<void>('DELETE', `/api/org/structure/units/${id(unitId)}`, {}),
  addPosition: (body: { title: string; title_ms?: string | null; unit_id: string; reports_to_id?: string | null; default_role?: string | null; headcount?: number | null; duties?: string | null; aliases?: string[] }) =>
    officeFetch<PositionRow>('POST', '/api/org/structure/positions', body),
  updatePosition: (positionId: string, body: Partial<Pick<PositionRow, 'title' | 'title_ms' | 'unit_id' | 'reports_to_id' | 'default_role' | 'headcount' | 'duties' | 'sort'>>) =>
    officeFetch<PositionRow>('PATCH', `/api/org/structure/positions/${id(positionId)}`, body),
  removePosition: (positionId: string, moveHolders = false) =>
    officeFetch<void>('DELETE', `/api/org/structure/positions/${id(positionId)}${moveHolders ? '?move_holders=true' : ''}`, {}),
  setPosition: (userId: string, positionId: string | null, setJobTitle = true) =>
    officeFetch<{ ok: true }>('PUT', `/api/members/${id(userId)}/position`, { position_id: positionId, set_job_title: setJobTitle }),
  assign: (userIds: string[], positionId: string | null) =>
    officeFetch<{ done: number; skipped: { user_id: string; message: string }[] }>('POST', '/api/org/structure/assign', { user_ids: userIds, position_id: positionId }),
  addGroup: (body: { unit_id: string; member_ids: string[]; name?: string | null; lead_user_id?: string | null; move?: boolean }) => officeFetch<WorkGroup>('POST', '/api/org/structure/groups', body),
  updateGroup: (groupId: string, body: { name?: string | null; lead_user_id?: string | null; member_ids?: string[]; sort?: number; move?: boolean }) =>
    officeFetch<WorkGroup>('PATCH', `/api/org/structure/groups/${id(groupId)}`, body),
  removeGroup: (groupId: string) => officeFetch<void>('DELETE', `/api/org/structure/groups/${id(groupId)}`, {}),
  /** P146: who a member reports to (null: nobody). */
  setReportsTo: (userId: string, bossId: string | null) => officeFetch<unknown>('PATCH', `/api/members/${id(userId)}`, { reports_to_user_id: bossId }),
  seed: () => officeFetch<{ units: number; positions: number; linked: number }>('POST', '/api/org/structure/seed', {}),
};
