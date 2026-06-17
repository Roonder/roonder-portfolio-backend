# Delta for `database-schema`

Source spec: `openspec/specs/database-schema.dbml`. The `users` table is
unchanged (its existing definition is the source of truth for the
`UserEntity` columns). This change ADDs a `refresh_tokens` table that
backs the refresh-token rotation flow documented in the `auth-domain`
capability spec at `openspec/changes/auth-domain/specs/auth-domain/spec.md`.

The archive step will translate the ADDED Requirement below into the
following dbml block (inserted after the `users` table in
`openspec/specs/database-schema.dbml`):

```dbml
Table refresh_tokens {
  id uuid [pk, default: `uuid_generate_v4()`]
  user_id uuid [ref: > users.id, not null]
  family_id uuid [not null, note: 'Stable id for the login session lineage; same value across rotations, reused on theft-detect']
  hashed_token varchar [unique, not null, note: 'sha-256 hex of the plaintext refresh token; raw token never persisted']
  expires_at timestamp [not null]
  revoked_at timestamp [note: 'Null while active; set on rotation, logout, or family-level reuse detection']
  replaced_by uuid [ref: > refresh_tokens.id, note: 'Next row in the rotation chain; null on the active row']
  created_at timestamp [default: `now()`]

  Indexes {
    family_id [name: 'idx_refresh_tokens_family_id']
    user_id [name: 'idx_refresh_tokens_user_id']
  }
}
```

## ADDED Requirements

### Requirement: Refresh Tokens Storage

The database MUST include a `refresh_tokens` table that persists every
issued refresh token as the sha-256 hash of its plaintext value. A row
MUST be inserted on every successful login (with a fresh `family_id`)
and on every successful refresh (same `family_id`, with `replaced_by`
pointing at the new row). A row MUST be marked `revoked_at = now()` when
it is rotated, when its owner logs out (presented token only), or when
ANY other row in its `family_id` is replayed (family-level reuse
detection — see `auth-domain` §Refresh Token Reuse Detection).

#### Scenario: `refresh_tokens` columns match the entity

- GIVEN the `refresh_tokens` table exists
- WHEN its schema is inspected
- THEN it declares `id` (uuid, pk), `user_id` (uuid, not null), `family_id` (uuid, not null),
  `hashed_token` (varchar, unique, not null), `expires_at` (timestamp, not null),
  `revoked_at` (timestamp, nullable), `replaced_by` (uuid, nullable, self-FK),
  `created_at` (timestamp, default `now()`)

#### Scenario: `family_id` is stable across rotation

- GIVEN a user logs in and rotates the refresh token N times
- WHEN all `refresh_tokens` rows for that user are inspected
- THEN every row in the rotation chain shares the SAME `family_id`
- AND the chain is linked by `replaced_by` (row N's `replaced_by` = row N+1's `id`)

#### Scenario: `family_id` index supports reuse-detection lookup

- GIVEN a refresh cookie is presented
- WHEN the system looks up the matching row
- THEN it locates the row by `hashed_token` (unique index)
- AND it can fetch all rows in the family in O(matches) using the
  `idx_refresh_tokens_family_id` index

#### Scenario: Plaintext tokens are never stored

- GIVEN any row in `refresh_tokens` is inspected
- WHEN its `hashed_token` column is read
- THEN the value is a 64-char lowercase hex string (sha-256)
- AND the plaintext refresh token is NOT present anywhere in the row

#### Scenario: Reuse detection revokes the whole family

- GIVEN family `F` has rows `r1`, `r2`, `r3` and `r3` is currently active
- WHEN a client presents the cookie bound to `r1` (already revoked) to `/auth/refresh`
- THEN a single UPDATE sets `revoked_at = now()` on `r1`, `r2`, AND `r3`
- AND no new row is inserted
- AND the response is `401 Unauthorized`

### Requirement: Refresh Token Lifecycle Invariants

The system MUST enforce the following invariants on the
`refresh_tokens` table at the application layer (TypeORM repository
methods):

1. At most ONE row per `family_id` has `revoked_at IS NULL` AND
   `replaced_by IS NULL` (the "active" row).
2. Every non-null `replaced_by` MUST point to a row whose `family_id`
   equals the referrer's `family_id` (the chain stays inside one family).
3. Once `revoked_at IS NOT NULL` on any row in a `family_id`, NO further
   row in that family MAY transition back to active (revocation is
   terminal).

#### Scenario: At most one active row per family

- GIVEN a family `F` exists
- WHEN the application layer queries for the active row in `F`
- THEN at most one row matches `family_id = F AND revoked_at IS NULL`

#### Scenario: `replaced_by` stays inside the family

- GIVEN any non-null `replaced_by` value on a row in family `F`
- WHEN the referenced row is inspected
- THEN `referenced_row.family_id = F`

#### Scenario: Revocation is terminal

- GIVEN a row `r` in family `F` has `revoked_at IS NOT NULL`
- WHEN any subsequent operation touches `r` (refresh, logout, reuse-detect)
- THEN `r.revoked_at` is unchanged or further in the past
- AND no operation sets `r.revoked_at IS NULL`

## MODIFIED Requirements

_None. No existing tables or requirements in `database-schema.dbml` are
modified by this change. The `users` table is the source of truth and is
unchanged._

## REMOVED Requirements

_None._

## RENAMED Requirements

_None._