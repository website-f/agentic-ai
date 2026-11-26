/**
 * P139 Organization: the office's companies ("branches") and their departments, in Prima's own look. Search, open a
 * company to see its departments and how many people are in each, and (org.manage) add, rename and delete companies
 * and departments. Deleting a company asks for its name. The office checks every change again (routers/org.py).
 */
import { useState } from 'react';
import { PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { office, saved, type OfficeCompany, type OfficeDepartment } from '../../api/office';
import { DataTable, type DtColumn } from '../../DataTable';
import { Empty, Facts, Stat, Stats } from '../../kit';
import { Chip, Drawer, ErrorNotice, dateLabel, useAction, useLoad } from '../../ui';
import { ConfirmDialog, Field, countsOf, sortedCompanies, useChange, usePowers } from './shared';

const SWATCHES = ['#13895f', '#2f6db5', '#b7791f', '#c2412d', '#7a5af5', '#0f8ba0', '#5b6b2f', '#b04a87'];

type Confirm = { kind: 'company'; company: OfficeCompany } | { kind: 'department'; dept: OfficeDepartment; company: OfficeCompany };

export function OrganizationTab() {
  const p = usePowers();
  const companies = useLoad(() => office.companies(), []);
  // Member counts come from the members list, which only people managers read in full.
  const members = useLoad(() => (p.people ? office.members() : Promise.resolve(null)), [p.people]);
  const counts = countsOf(members.data);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ company: OfficeCompany | null } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [addDeptTo, setAddDeptTo] = useState<string | null>(null);

  const list = companies.data ? sortedCompanies(companies.data) : null;
  const opened = list?.find((c) => c.id === open) ?? null;
  const departments = list?.reduce((n, c) => n + c.departments.length, 0) ?? 0;
  const peopleIn = (c: OfficeCompany) => (counts ? (counts.byCompany.get(c.id) ?? 0) : null);

  const columns: DtColumn<OfficeCompany>[] = [
    {
      id: 'name',
      label: 'Company',
      value: (c) => c.name,
      phone: 'title',
      render: (c) => (
        <span className="oa-company">
          <span className="oa-dot" style={{ background: c.color }} aria-hidden="true" />
          <b data-no-translate>{c.name}</b>
        </span>
      ),
    },
    { id: 'departments', label: 'Departments', value: (c) => c.departments.length, sort: 'number' },
    ...(counts ? [{ id: 'members', label: 'Members', value: (c: OfficeCompany) => peopleIn(c), sort: 'number' as const }] : []),
    {
      id: 'knowledge',
      label: 'Knowledge',
      value: (c) => (c.isolated ? 'Private' : 'Shared'),
      translate: true,
      hideBelow: 1000,
      render: (c) => (c.isolated ? <Chip tone="info">Private</Chip> : <Chip tone="neutral">Shared</Chip>),
    },
    { id: 'added', label: 'Added', value: (c) => c.created_at, sort: 'date', hideBelow: 1180 },
  ];

  return (
    <div className="oa-stack">
      <Stats>
        <Stat label="Companies" value={list ? list.length : '…'} />
        <Stat label="Departments" value={list ? departments : '…'} />
        {p.people && <Stat label="Members" value={members.data ? members.data.length : '…'} />}
      </Stats>
      {members.error && <ErrorNotice error={`Member counts could not be loaded: ${members.error}`} />}
      <DataTable
        label="Companies"
        stateKey="office.companies"
        rows={list}
        rowKey={(c) => c.id}
        columns={columns}
        searchText={(c) => `${c.slug} ${c.departments.map((d) => d.name).join(' ')}`}
        searchPlaceholder="Search companies or departments"
        loading={companies.loading && !companies.data}
        loadingWhat="companies"
        error={companies.error}
        onView={(c) => setOpen(c.id)}
        viewLabel="Open"
        onEdit={p.org ? (c) => setForm({ company: c }) : undefined}
        editLabel="Rename"
        actions={(c) => [
          { label: 'Add department', icon: <PlusIcon size={16} aria-hidden="true" />, hidden: !p.org, onClick: () => setAddDeptTo(c.id) },
          {
            label: 'Delete company',
            tone: 'danger',
            icon: <TrashIcon size={16} aria-hidden="true" />,
            hidden: !p.org,
            onClick: () => setConfirm({ kind: 'company', company: c }),
          },
        ]}
        onAdd={p.org ? () => setForm({ company: null }) : undefined}
        addLabel="Add company"
        exportName="companies"
        empty={
          <Empty
            title="No companies yet."
            action={
              p.org ? (
                <button className="btn btn-primary" onClick={() => setForm({ company: null })}>
                  Add company
                </button>
              ) : undefined
            }
          >
            {p.org ? 'Add the first company, then its departments.' : 'Companies appear here once they are added.'}
          </Empty>
        }
      />

      {opened && (
        <CompanyDrawer
          company={opened}
          people={peopleIn(opened)}
          deptCount={(d) => (counts ? (counts.byDept.get(d.id) ?? 0) : null)}
          onClose={() => setOpen(null)}
          onRename={() => setForm({ company: opened })}
          onDelete={() => setConfirm({ kind: 'company', company: opened })}
          onDeleteDept={(d) => setConfirm({ kind: 'department', dept: d, company: opened })}
        />
      )}
      {form && <CompanyForm company={form.company} onClose={() => setForm(null)} />}
      {addDeptTo && list && <AddDepartmentDrawer company={list.find((c) => c.id === addDeptTo) ?? null} onClose={() => setAddDeptTo(null)} />}
      {confirm?.kind === 'company' && (
        <DeleteCompany
          company={confirm.company}
          people={peopleIn(confirm.company)}
          onClose={() => setConfirm(null)}
          onDone={() => {
            if (open === confirm.company.id) setOpen(null);
          }}
        />
      )}
      {confirm?.kind === 'department' && (
        <DeleteDepartment
          dept={confirm.dept}
          company={confirm.company}
          people={counts ? (counts.byDept.get(confirm.dept.id) ?? 0) : null}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function DeleteCompany({ company, people, onClose, onDone }: { company: OfficeCompany; people: number | null; onClose: () => void; onDone: () => void }) {
  const change = useChange();
  const n = company.departments.length;
  return (
    <ConfirmDialog
      title={
        <>
          Delete <q data-no-translate>{company.name}</q>?
        </>
      }
      body={
        <>
          {`This removes the company and its ${n} ${n === 1 ? 'department' : 'departments'}. It cannot be undone.`}
          {people ? ` ${people} ${people === 1 ? 'member works' : 'members work'} there: they stay members, without this company.` : ''}
        </>
      }
      confirmLabel="Delete company"
      danger
      typeToConfirm={company.name}
      run={async () => {
        await change(() => office.deleteCompany(company.id), `${company.name} deleted.`);
        onDone();
      }}
      onClose={onClose}
    />
  );
}

function DeleteDepartment({ dept, company, people, onClose }: { dept: OfficeDepartment; company: OfficeCompany; people: number | null; onClose: () => void }) {
  const change = useChange();
  return (
    <ConfirmDialog
      title={
        <>
          Delete the department <q data-no-translate>{dept.name}</q>?
        </>
      }
      body={
        <>
          <span data-no-translate>{company.name}</span>
          {': the department is removed. It cannot be undone.'}
          {people ? ` ${people} ${people === 1 ? 'member is' : 'members are'} in it: they stay in the company, without a department.` : ''}
        </>
      }
      confirmLabel="Delete department"
      danger
      run={() => change(() => office.deleteDepartment(dept.id), `${dept.name} deleted.`)}
      onClose={onClose}
    />
  );
}

function CompanyDrawer({
  company,
  people,
  deptCount,
  onClose,
  onRename,
  onDelete,
  onDeleteDept,
}: {
  company: OfficeCompany;
  people: number | null;
  deptCount: (d: OfficeDepartment) => number | null;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDeleteDept: (d: OfficeDepartment) => void;
}) {
  const p = usePowers();
  const act = useAction();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState('');
  const depts = [...company.departments].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const rename = async (d: OfficeDepartment) => {
    const name = newName.trim();
    if (!name || name === d.name) return setRenaming(null);
    const r = await act.run(() => office.renameDepartment(d.id, name), saved('Department renamed.'));
    if (r !== undefined) setRenaming(null);
  };
  const add = async () => {
    const name = adding.trim();
    if (!name) return;
    const r = await act.run(() => office.addDepartment(company.id, name), saved(`${name} added.`));
    if (r !== undefined) setAdding('');
  };
  return (
    <Drawer
      title={<span data-no-translate>{company.name}</span>}
      sub={`${depts.length} ${depts.length === 1 ? 'department' : 'departments'}`}
      onClose={onClose}
    >
      <div className="oa-stack">
        <Facts
          items={[
            [
              'Short name',
              <span key="s" data-no-translate className="oa-mono">
                {company.slug}
              </span>,
            ],
            ['Members', people == null ? '–' : people],
            ['Knowledge', company.isolated ? 'Private: only its own agents read its files' : 'Shared with the other companies'],
            ['Added', dateLabel(company.created_at)],
          ]}
        />
        {p.org && (
          <div className="row">
            <button className="btn btn-sm" onClick={onRename}>
              <PencilSimpleIcon size={15} aria-hidden="true" /> Rename company
            </button>
            <button className="btn btn-sm oa-danger-text" onClick={onDelete}>
              <TrashIcon size={15} aria-hidden="true" /> Delete company
            </button>
          </div>
        )}
        <h3 className="oa-h3">Departments</h3>
        <ErrorNotice error={act.error} />
        {depts.length ? (
          <ul className="oa-list">
            {depts.map((d) => {
              const n = deptCount(d);
              return (
                <li key={d.id} className="oa-list-row">
                  {renaming === d.id ? (
                    <form
                      className="oa-inline"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void rename(d);
                      }}
                    >
                      <input
                        className="input"
                        aria-label="Department name"
                        value={newName}
                        maxLength={120}
                        autoFocus
                        onChange={(e) => setNewName(e.target.value)}
                      />
                      <button className="btn btn-primary btn-sm" disabled={act.busy || !newName.trim()}>
                        Save
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <span className="oa-list-main">
                        <b data-no-translate>{d.name}</b>
                        {n != null && <small>{`${n} ${n === 1 ? 'member' : 'members'}`}</small>}
                      </span>
                      {p.org && (
                        <span className="oa-list-actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            aria-label={`Rename ${d.name}`}
                            onClick={() => {
                              setNewName(d.name);
                              setRenaming(d.id);
                            }}
                          >
                            <PencilSimpleIcon size={15} aria-hidden="true" /> Rename
                          </button>
                          <button className="btn btn-ghost btn-sm oa-danger-text" aria-label={`Delete ${d.name}`} onClick={() => onDeleteDept(d)}>
                            <TrashIcon size={15} aria-hidden="true" /> Delete
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty title="No departments yet.">{p.org ? 'Add the first one below.' : 'Departments appear here once they are added.'}</Empty>
        )}
        {p.org && (
          <form
            className="oa-inline"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input
              className="input"
              aria-label="New department"
              placeholder="New department, for example: Finance"
              value={adding}
              maxLength={120}
              onChange={(e) => setAdding(e.target.value)}
            />
            <button className="btn btn-primary btn-sm" disabled={act.busy || !adding.trim()}>
              <PlusIcon size={15} aria-hidden="true" /> Add department
            </button>
          </form>
        )}
      </div>
    </Drawer>
  );
}

function AddDepartmentDrawer({ company, onClose }: { company: OfficeCompany | null; onClose: () => void }) {
  const act = useAction();
  const [name, setName] = useState('');
  if (!company) return null;
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const r = await act.run(() => office.addDepartment(company.id, n), saved(`${n} added to ${company.name}.`));
    if (r !== undefined) onClose();
  };
  return (
    <Drawer title="Add department" sub={<span data-no-translate>{company.name}</span>} onClose={onClose}>
      <form
        className="oa-form"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Field label="Department name" wide>
          <input className="input" value={name} maxLength={120} autoFocus placeholder="For example: Finance" onChange={(e) => setName(e.target.value)} />
        </Field>
        <ErrorNotice error={act.error} />
        <div className="oa-form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={act.busy || !name.trim()}>
            {act.busy ? 'Saving…' : 'Add department'}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

/** Add a company, or rename one (its colour and whether its knowledge is private change here too). */
function CompanyForm({ company, onClose }: { company: OfficeCompany | null; onClose: () => void }) {
  const act = useAction();
  const [name, setName] = useState(company?.name ?? '');
  const [color, setColor] = useState(company?.color ?? SWATCHES[0]);
  const [isolated, setIsolated] = useState(company?.isolated ?? false);
  const [seed, setSeed] = useState(false);
  const save = async () => {
    const n = name.trim();
    if (!n) return;
    const r = company
      ? await act.run(
          () =>
            office.updateCompany(company.id, {
              ...(n !== company.name ? { name: n } : {}),
              ...(color !== company.color ? { color } : {}),
              ...(isolated !== company.isolated ? { isolated } : {}),
            }),
          saved('Company saved.'),
        )
      : await act.run(() => office.addCompany({ name: n, color, isolated, seed_departments: seed }), saved(`${n} added.`));
    if (r !== undefined) onClose();
  };
  const unchanged = !!company && name.trim() === company.name && color === company.color && isolated === company.isolated;
  return (
    <Drawer
      title={company ? 'Rename company' : 'Add company'}
      sub={company ? <span data-no-translate>{company.name}</span> : 'A company (office branch) people and departments belong to.'}
      onClose={onClose}
    >
      <form
        className="oa-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Company name" wide>
          <input
            className="input"
            value={name}
            maxLength={120}
            autoFocus
            placeholder="For example: Prima Security Sdn Bhd"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="field oa-wide">
          <span className="label">Colour</span>
          <div className="oa-swatches" role="radiogroup" aria-label="Colour">
            {SWATCHES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={color === s}
                aria-label={`Colour ${s}`}
                className="oa-swatch"
                style={{ background: s }}
                onClick={() => setColor(s)}
              />
            ))}
          </div>
        </div>
        <label className="oa-check oa-wide">
          <input type="checkbox" checked={isolated} onChange={(e) => setIsolated(e.target.checked)} />
          <span>
            <b>Private knowledge</b>
            <small className="muted">Only this company's own agents read its files and what it learns.</small>
          </span>
        </label>
        {!company && (
          <label className="oa-check oa-wide">
            <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
            <span>
              <b>Add the usual departments</b>
              <small className="muted">Management, Finance, Research, Operations, Data and Writing. You can rename or delete them later.</small>
            </span>
          </label>
        )}
        <ErrorNotice error={act.error} />
        <div className="oa-form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={act.busy || !name.trim() || unchanged}>
            {act.busy ? 'Saving…' : company ? 'Save' : 'Add company'}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
