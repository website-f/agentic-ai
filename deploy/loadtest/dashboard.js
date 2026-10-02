// k6 load test: people using the dashboard. Each virtual user signs in once, then keeps
// doing what the web app does: board, agents, office, approvals, status, brain search.
//
//   docker run --rm -i --network host -e BASE=http://127.0.0.1:8500 \
//     -v "$PWD/deploy/loadtest:/lt" grafana/k6 run /lt/dashboard.js
//
// On Docker Desktop use -e BASE=http://host.docker.internal:8500 instead of --network host.
import http from "k6/http";
import { check, group, sleep } from "k6";

const BASE = __ENV.BASE || "http://127.0.0.1:8500";
const EMAIL = __ENV.EMAIL || "owner@example.com";
const PASSWORD = __ENV.PASSWORD || "agentic-test-2026";

export const options = {
  scenarios: {
    dashboard: {
      executor: "ramping-vus",
      stages: [
        { duration: "20s", target: Number(__ENV.VUS || 50) },
        { duration: __ENV.HOLD || "2m", target: Number(__ENV.VUS || 50) },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{kind:read}": ["p(95)<500", "p(99)<1500"],
    "http_req_duration{kind:search}": ["p(95)<1500"],
  },
};

export function setup() {
  const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { "content-type": "application/json" },
  });
  check(r, { "signed in": (x) => x.status === 200 });
  const cookies = {};
  for (const [name, list] of Object.entries(r.cookies)) cookies[name] = list[0].value;
  const branches = http.get(`${BASE}/api/branches`, { cookies }).json();
  return { cookies, branch: branches.length ? branches[0].id : null };
}

const read = (path, data) => http.get(`${BASE}${path}`, { cookies: data.cookies, tags: { kind: "read", name: path.split("?")[0] } });

export default function (data) {
  group("board", () => {
    check(read("/api/tasks", data), { "tasks 200": (r) => r.status === 200 });
    check(read("/api/approvals?state=pending", data), { "approvals 200": (r) => r.status === 200 });
  });
  group("people", () => {
    check(read("/api/agents", data), { "agents 200": (r) => r.status === 200 });
    if (data.branch) check(read(`/api/office/${data.branch}`, data), { "office 200": (r) => r.status === 200 });
  });
  group("home", () => {
    check(read("/api/system/status", data), { "status 200": (r) => r.status === 200 });
    check(read("/api/budgets", data), { "budgets 200": (r) => r.status === 200 });
    check(read("/api/pings", data), { "pings 200": (r) => r.status === 200 });
  });
  if (Math.random() < 0.2) {
    const r = http.get(`${BASE}/api/brain/search?q=payment%20terms`, { cookies: data.cookies, tags: { kind: "search", name: "/api/brain/search" } });
    check(r, { "search 200": (x) => x.status === 200 });
  }
  sleep(1 + Math.random() * 2); // a person reading the screen
}
