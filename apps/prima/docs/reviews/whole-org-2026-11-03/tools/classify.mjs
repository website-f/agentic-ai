// Sorts HTTP results so refusals are never counted as failures (Arisha review, 3 Nov 2026).
export function classify(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'refused_permission';
  if (status >= 400 && status < 500) return 'refused_input';
  // 503 is Prima's "busy, try again, nothing was changed" answer; any other 5xx is a real server error.
  if (status === 503) return 'busy';
  if (status >= 500) return 'server_error';
  return 'other';
}
export function tally(rows) {
  const t = { ok: 0, refused_permission: 0, refused_input: 0, busy: 0, server_error: 0, other: 0 };
  for (const r of rows) t[classify(r.status)]++;
  return t;
}
