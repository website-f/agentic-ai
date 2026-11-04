# ADR 0001: Modular monolith with a shared core

Date: 2026-10-24. Status: Accepted (A-6 approved 24 Oct 2026).

## Decision
One API (NestJS) and one web app (React PWA), with all business rules in
`packages/core`. The core talks to storage only through the `Store` interface, so the
same rules run on PostgreSQL in the API and in memory in the single-file test version.

## Why
A small team, about 8,000 guards and 2,000 sites does not need microservices. One
deployable is cheaper to run and secure. Keeping rules in one package means the test
version Fauzan clicks through behaves exactly like the server.

## Consequences
Modules can be split out later along the core's service boundaries if load or team size
demands it.
