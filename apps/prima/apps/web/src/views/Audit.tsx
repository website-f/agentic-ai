import { api } from '../api';
import { Chip, ErrorNotice, Loading, dateTimeLabel, useLoad } from '../ui';

export function AuditView() {
  const { data, error } = useLoad(() => api.audit(), []);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="audit trail" />
      </div>
    );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Audit trail</h1>
          <p>
            Every change is recorded with who, what and when. Each entry is sealed with the one before it, so any later edit breaks the seal and shows here.
          </p>
        </div>
        {data.verified ? (
          data.chainIntact ? (
            <Chip tone="ok">Seal intact across {data.total} entries</Chip>
          ) : (
            <Chip tone="crit">Seal broken at entry {data.brokenAt}</Chip>
          )
        ) : (
          <Chip tone="neutral">Seal checked by PWVSB</Chip>
        )}
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th className="hide-sm">Seal</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.seq}>
                  <td className="num mono">{e.seq}</td>
                  <td className="mono small">{dateTimeLabel(e.at)}</td>
                  <td>{e.actor}</td>
                  <td>
                    <div>{e.summary}</div>
                    <div className="muted small mono">{e.action}</div>
                  </td>
                  <td className="mono small muted hide-sm" title={e.hash}>
                    {e.hash.slice(0, 10)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
