# Design: Pluggable External Durable-State DB Backend (PostgreSQL / MySQL)

Status: PROPOSAL · Discussion issue: [#8075](https://github.com/diegosouzapw/OmniRoute/issues/8075) · Author: @oyi77

Grounded in the tree at `release/v3.8.51` (`3192eb88d`). Every number below was measured on that tree, not estimated.

---

## 0. Why this document exists

#8075 asks five questions (backends & order, abstraction contract, what stays SQLite-only, config surface, migration path). This document answers them with a census of how deeply the current data layer is coupled to SQLite, and proposes a repository-contract seam that lets external backends be adopted per domain instead of via a big-bang driver swap.

## 1. Measured coupling census (`release/v3.8.51`)

| Surface | Count | Implication for external backends |
|---|---|---|
| `src/lib/db/*.ts` modules calling `.prepare()` / `.transaction()` | **126 files** | The synchronous SQLite call shape is the de-facto data API; every module is a translation candidate |
| `.pragma()` call sites | **36** | No equivalent in PG/MySQL — each needs an audit (many are performance tuning that becomes server config) |
| SQLite migrations on disk | **159** | A second dialect needs its own migration lineage, not a translator |
| `sqlite-vec` / `vec0` referencing files | **9** | Vector search must move to an external store (Qdrant proposed in #8075) |
| FTS5 referencing files | **8** | Maps to Postgres `tsvector` / MySQL `FULLTEXT` — dialect work |
| Existing driver adapters | **4** (`better-sqlite3`, `node:sqlite`, `bun:sqlite`, `sql.js`) behind `SqliteAdapter` (`src/lib/db/adapters/types.ts`) | Proves a seam exists at the DRIVER level — but all four are SQLite; the seam OmniRoute actually needs is one level up |

The decisive fact: **the adapter interface is synchronous** (`prepare().run/get/all`, sync closure transactions). PostgreSQL and MySQL drivers are inherently async. A faithful external backend behind `SqliteAdapter` is therefore impossible without faking sync over async — which is exactly the trap #8037/#8073 already flagged ("not a drop-in ORM/driver swap"). The contract must live ABOVE the adapter layer.

## 2. Proposed contract: durable-state repositories, not a driver swap

Introduce a `DurableStateStore` port with per-domain repositories, defined once and implemented per dialect:

```ts
// src/lib/db/ports/ — dialect-agnostic, async, transactional by unit-of-work
interface UnitOfWork {
  connections: ConnectionRepository;   // provider connections + credentials
  apiKeys: ApiKeyRepository;           // keys, groups, usage-limit fields
  combos: ComboRepository;             // combo defs + routing policies
  quotaState: QuotaStateRepository;    // quota/account state, cooldowns
  sessionAffinity: AffinityRepository; // sticky routing state
  audit: AuditRepository;              // config audit log
}
interface DurableStateStore {
  readonly driver: "sqlite" | "postgres" | "mysql";
  withUnitOfWork<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
  healthCheck(): Promise<{ ok: boolean; latencyMs: number }>;
}
```

Deliberate exclusions from v1 (stay SQLite-local, matching #8075 §3): WAL/VACUUM/PRAGMA lifecycle, file backup/import/export, `sqlite-vec` vector storage (external backends delegate vectors to Qdrant), FTS (dialect-native fulltext later).

### What makes each repository shippable

The single-writer pattern OmniRoute already uses internally (targeted raw-SQL stat bumps like `touchConnectionLastUsed`, single-writer caches) maps cleanly onto `UnitOfWork`. Repositories are adopted **per domain**: a deployment can run `postgres` for connections+keys while hot-path ephemeral state stays local — because the port is injected at the repository boundary, not under 126 modules.

## 3. Sequencing: PostgreSQL first, MySQL second

1. **Postgres-first** (`pg` + `pg-pool`): richer native JSONB (several modules persist JSON blobs), `tsvector`, `INSERT ... ON CONFLICT` semantics closest to `INSERT OR REPLACE` usage.
2. **MySQL 8+ after**, gated by a shared **dialect-conformance suite**: the same behavioral test pack runs against both implementations (schema bootstrap, UoW rollback, credential round-trip incl. encryption-at-rest fields, pagination/ordering contracts). A backend is "supported" only when the suite is green.

Rationale: one conformance suite prevents the MySQL implementation from drifting into a shim that passes smoke tests but corrupts ordering/collation edge cases.

## 4. Config surface

```
DATABASE_DRIVER=sqlite            # sqlite (default) | postgres | mysql
DATABASE_URL=postgres://...       # required when driver != sqlite
DATABASE_POOL_MAX=10
DATABASE_TLS_REJECT_UNAUTHORIZED=1
DATABASE_MIGRATIONS_TABLE=_omniroute_migrations
```

- Default stays `sqlite` — zero-config npm/Electron/Termux behavior is non-negotiable (#8075 §6).
- Health check surfaces in the existing `/api/monitoring/health` payload next to `inflightRequests`.
- Migrations: per-dialect lineage directories (`migrations-postgres/`, `migrations-mysql/`) with their own runner sharing the safety checks (mass-migration abort, pre-migration backup → pg_dump/mysqldump equivalent) already proven in `migrationRunner.ts`.

## 5. Migration path (one-way export tool)

`omniroute db export --to postgres --dsn ...`:
1. Snapshot `storage.sqlite` (reuse `createPreMigrationBackup`).
2. Replay schema from the target dialect's lineage to head.
3. Copy tables row-by-row through the new repositories (not raw SQL translation), preserving IDs; re-encrypt nothing (credential ciphertexts are dialect-neutral strings today).
4. Verify with row-count + checksum comparison per table; write a receipt file.
5. Refuse to continue on any mismatch (fail-closed).

## 6. Phased delivery plan

| Phase | Deliverable | Risk gate |
|---|---|---|
| P1 | `ports/` contract + SQLite implementation of `ConnectionRepository` + conformance-suite skeleton running against SQLite itself | Suite green on the reference driver |
| P2 | Postgres implementation of the same repo + suite green on PG | Suite green on PG |
| P3 | Remaining domains (apiKeys, combos, quotaState, affinity, audit) on PG | Full-suite parity vs SQLite run |
| P4 | MySQL via conformance suite | Suite green on MySQL |
| P5 | Export tool + docs | Round-trip receipt on a 1GB-scale fixture |

P1–P2 alone deliver value: a clustered deployment can share connection/key state while everything else stays local.

## 7. Explicitly out of scope

- Translating the remaining ~120 SQLite-shaped modules verbatim ("just make prepare() hit Postgres") — rejected: it fakes sync over async and preserves dialect bugs forever.
- Replacing `sqlite-vec` with pgvector — #8075 names Qdrant; keeping vector search out-of-process also keeps the lean proxy core lean (4.0 modular direction).
