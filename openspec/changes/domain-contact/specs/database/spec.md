# Delta for Database Schema

## Purpose

This delta encodes the destructive DBML change required by
`domain-contact`: the `email_sent_log boolean` column on the `contacts`
table is **dropped**, the `updated_at` column on the `contacts` table is
**added**, and a new `sent_emails` table is **added** that records every
Resend send attempt (one row per email: owner notification + visitor
auto-reply). The new table supports the audit-trail requirement that
the boolean structurally could not (proposal §6, decision #2).

## Source sections

Quoted from `openspec/specs/database-schema.dbml` lines 58–67 (the
current `contacts` table, which this delta modifies):

```
Table contacts {
  id uuid [pk, default: `uuid_generate_v4()`]
  name varchar [not null]
  email varchar [not null]
  subject varchar
  message text [not null]
  status varchar [default: 'pending', note: 'pending, read, replied']
  email_sent_log boolean [default: true, note: 'Verifica si Resend procesó el correo']
  created_at timestamp [default: `now()`]
}
```

The canonical `openspec/specs/server_specs.md` §3.4 has no
DBML-level requirements of its own; the DBML is the source of truth
for the schema.

## Purpose of the change

The user-locked decision (proposal §6, #2) is that every Resend send
attempt MUST be recorded in a dedicated `sent_emails` table. The
canonical `email_sent_log boolean` cannot represent two distinct
sends per submission (one `contact_notification` to the operator, one
`contact_auto_reply` to the visitor), the nullable `resend_id` per
send, or the nullable `error_message` per send. Replacing the boolean
with a new table is the only way to satisfy the audit-trail contract
the user requires. The change is destructive (a column is dropped) and
the migration's `down` step MUST recreate the column to keep the
schema reversible. The `updated_at` column is added on the `contacts`
table because the new `PATCH /api/v1/admin/contacts/:id` route
mutates `status` and benefits from a last-modified timestamp (mirror
the `projects` and `project_urls` precedent).

## ADDED Requirements

### Requirement: New `sent_emails` table

The system MUST add a new `sent_emails` table to the database with the
following column shape:

| Column           | Type         | Constraints                                          | Notes                                                                                            |
|------------------|--------------|------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| `id`             | `uuid`       | PK, `default: uuid_generate_v4()`                    | Surrogate key                                                                                    |
| `subject`        | `varchar`    | NOT NULL                                             | The email subject as sent                                                                        |
| `from`           | `varchar`    | NOT NULL                                             | The `from` address (friendly-name form allowed)                                                  |
| `to`             | `varchar`    | NOT NULL                                             | The recipient address                                                                            |
| `resend_id`      | `varchar`    | nullable                                             | Resend's `data.id` on success; `NULL` on failure                                                 |
| `status`         | `enum`       | NOT NULL, values: `accepted`, `failed` (see note)   | Enum leaves room for future `delivered`, `bounced`, `complained` (webhook receiver is out of scope for this change). |
| `kind`           | `enum`       | NOT NULL, values: `contact_notification`, `contact_auto_reply` | Discriminator for which email was sent                                                           |
| `error_message`  | `text`       | nullable                                             | Resend error message on `failed`; `NULL` on `accepted`                                          |
| `created_at`     | `timestamp`  | NOT NULL, `default: now()`                            | Insert time                                                                                      |
| `updated_at`     | `timestamp`  | NOT NULL, `default: now()`                            | Last update                                                                                      |

The table MUST have the following indexes:

- `kind` (single-column btree) — for filtering by `contact_notification` vs `contact_auto_reply`.
- `status` (single-column btree) — for filtering by `accepted` vs `failed` in operator audits.
- `created_at` (single-column btree, `DESC`) — for the natural audit ordering.
- `resend_id` (single-column btree, unique partial index where `resend_id IS NOT NULL`) — for
  idempotency lookups and webhook event correlation in future work.

The `status` and `kind` enums MUST be Postgres-native `ENUM` types
declared via `CREATE TYPE`, NOT plain `varchar` with a CHECK
constraint — this matches the TypeORM `enum` decorator pattern and
keeps the values addressable from the application layer.

**When:** `database-schema.dbml` (this is a new table; no prior
section to modify).

#### Scenario: Table exists with the documented columns

- GIVEN the up migration has been applied
- WHEN the `sent_emails` table is introspected via `\d sent_emails` in psql
- THEN the table MUST contain the 10 columns listed above (no more, no less)
- AND the column types MUST match (uuid, varchar, varchar, varchar, varchar, enum, enum, text, timestamp, timestamp)

#### Scenario: Indexes exist on the documented columns

- GIVEN the up migration has been applied
- WHEN the `sent_emails` indexes are listed via `\d sent_emails` in psql
- THEN the indexes `kind`, `status`, `created_at`, and a partial unique index on `resend_id` (where not null) MUST all exist

### Requirement: `updated_at` column on the `contacts` table

The system MUST add an `updated_at timestamp [default: now()]` column
to the `contacts` table. The application layer (TypeORM `@UpdateDateColumn`
in `ContactEntity`) MUST populate this column on every save.

**When:** `database-schema.dbml` lines 58–67 (the existing `contacts`
table — this is a MODIFIED change to that table).

#### Scenario: PATCH on a contact updates `updated_at`

- GIVEN a contact with `status = 'pending'` and an earlier `updated_at` value
- WHEN `PATCH /api/v1/admin/contacts/:id` is called with body `{ "status": "read" }`
- THEN the persisted contact row's `updated_at` is strictly greater than its previous `updated_at`

## MODIFIED Requirements

### Requirement: `contacts` table — drop `email_sent_log`, add `updated_at`

The `contacts` table MUST be modified as follows. The destructive
change is the drop of `email_sent_log boolean [default: true, note:
'Verifica si Resend procesó el correo']` (the only column being
removed). The additive change is `updated_at timestamp [default: now()]`
(the only column being added). All other columns (`id`, `name`, `email`,
`subject`, `message`, `status`, `created_at`) are unchanged.

After this delta, the `contacts` table MUST have the following shape:

```
Table contacts {
  id uuid [pk, default: `uuid_generate_v4()`]
  name varchar [not null]
  email varchar [not null]
  subject varchar
  message text [not null]
  status varchar [default: 'pending', note: 'pending, read, replied']
  created_at timestamp [default: `now()`]
  updated_at timestamp [default: `now()`]
}
```

(Previously: `contacts` had 8 columns including
`email_sent_log boolean [default: true]`. Now: 8 columns
including `updated_at timestamp [default: now()]`. The same column
count, but the boolean is gone and the timestamp is in.)

**When:** `database-schema.dbml` lines 58–67 (the entire table is
replaced). `server_specs.md` §3.4 references the old `email_sent_log`
in the business-logic bullet ("Updates the contact record
(email_sent_log) confirming the dispatch."); the corresponding
requirement in `contact/spec.md` is REMOVED.

#### Scenario: The `email_sent_log` column is gone after migration

- GIVEN the up migration has been applied
- WHEN the `contacts` table is introspected via `\d contacts` in psql
- THEN the `email_sent_log` column is NOT present
- AND no `sent_emails` table-level link references the dropped column

#### Scenario: The `updated_at` column is present after migration

- GIVEN the up migration has been applied
- WHEN the `contacts` table is introspected via `\d contacts` in psql
- THEN the `updated_at timestamp [default: now()]` column IS present

#### Scenario: Down migration restores the boolean

- GIVEN the down migration is run after the up migration
- WHEN the `contacts` table is introspected via `\d contacts` in psql
- THEN the `email_sent_log boolean [default: true]` column IS present
- AND the `updated_at` column is NOT present (reverted to the pre-change shape)
- AND no data loss occurred on the surviving columns (id, name, email, subject, message, status, created_at)

## REMOVED Requirements

### Requirement: `email_sent_log` boolean column

(Reason: the boolean is structurally incapable of recording the
audit-trail the user requires — two distinct sends, two `kind`s, a
nullable `resend_id`, and a nullable `error_message` per send. The
new `sent_emails` table (above) captures all of this.)

(Migration: the `down` migration recreates the
`email_sent_log boolean [default: true]` column. Application code
MUST NOT reference `email_sent_log` after the change is applied —
see the corresponding REMOVED requirement in `contact/spec.md`.)

**When:** `database-schema.dbml` line 65 (the `email_sent_log` row in
the `contacts` table definition).

#### Scenario: Application code no longer references the dropped column

- GIVEN the `domain-contact` change is applied
- WHEN the entire `src/` tree is grepped for `email_sent_log`
- THEN no source file references the string

## Migration

The migration MUST be hand-written, reversible, and idempotent
(matching the precedent in
`src/database/migrations/20260618205116-create-projects-and-project-urls.ts`
and `src/database/migrations/20260620020316-create-reviews-and-review-comments.ts`).
It MUST be registered via the `migrations` glob in `src/data-source.ts`.

**Up migration** (`up`):

1. Modify the `contacts` table:
   - `DROP COLUMN email_sent_log`.
   - `ADD COLUMN updated_at timestamp NOT NULL DEFAULT now()`.
2. Create the `sent_emails` table:
   - `CREATE TYPE sent_emails_status_enum AS ENUM ('accepted', 'failed')`.
   - `CREATE TYPE sent_emails_kind_enum AS ENUM ('contact_notification', 'contact_auto_reply')`.
   - `CREATE TABLE sent_emails` with the 10 columns and constraints documented above.
   - `CREATE INDEX idx_sent_emails_kind ON sent_emails (kind)`.
   - `CREATE INDEX idx_sent_emails_status ON sent_emails (status)`.
   - `CREATE INDEX idx_sent_emails_created_at_desc ON sent_emails (created_at DESC)`.
   - `CREATE UNIQUE INDEX idx_sent_emails_resend_id_unique ON sent_emails (resend_id) WHERE resend_id IS NOT NULL`.

**Down migration** (`down`):

1. Recreate the dropped column on `contacts`:
   - `DROP TABLE sent_emails`.
   - `DROP TYPE sent_emails_status_enum`.
   - `DROP TYPE sent_emails_kind_enum`.
   - `ADD COLUMN email_sent_log boolean NOT NULL DEFAULT true` on `contacts`.
   - `DROP COLUMN updated_at` on `contacts`.

**Idempotency** (per the reviews precedent): each `CREATE` /
`DROP` / `ALTER` MUST be guarded with `IF NOT EXISTS` /
`IF EXISTS` so a partially-applied migration does not fail on
re-run.

**`migrationsRun` behavior**: `TypeOrmModule` is configured to
auto-run migrations in non-production environments (per the
existing `src/data-source.ts` and `app.module.ts` settings). The
down migration is NEVER auto-run; it exists for explicit operator
rollback.

## Out of scope

- The full `delivered` / `bounced` / `complained` status flow.
  The `status` enum leaves room for these values but no listener is
  wired in this change (a future change would add
  `@nestjs/event-emitter` to the controller surface or a webhook
  receiver).
- An `admin_list_sent_emails` endpoint. Operators audit `sent_emails`
  via the DB or psql.
- Backfill from a pre-migration boolean. There is no production
  data yet; the boolean has no historical value to preserve.
- Changing the `status` column on `contacts` from `varchar` to a
  Postgres `ENUM`. The canonical spec describes `status` as a
  varchar with a note; converting it is out of scope.
