# 02 — Custom fields

**Builds on:** 01.
**Source docs:** [03](../docs/03-custom-fields.md), [02](../docs/02-data-model.md).

## Goal

The schema engine: per-project FieldDefs, a cached Zod validator built from
them, and the five rules for change. This engine later drives write
validation, table columns, facets, and AI extraction — build it as one module
with one source of truth.

## Scope

- `FieldDef` shape and storage inside `projects.fieldSchema` (docs/03):
  key (snake_case, permanent), label, type, options, required, default,
  order, showInTable, showAsFacet, description.
- Field types, release 1: `text`, `long_text`, `number`, `checkbox`, `date`,
  `select`, `multi_select`, `url`.
- The `type` field special rule: options come from the predefined pool
  (`feature FEAT`, `bug BUG`, `chore CHORE`, `spike SPIKE`, `debt DEBT`);
  a project selects a subset; an option outside the pool →
  `422 TYPE_OPTION_UNKNOWN`. Export the pool as a shared constant — spec 03
  (keys) and the UI (silhouettes) consume it.
- Schema endpoints:
  ```
  GET  /api/projects/:project/schema     fieldSchema + statuses
  POST /api/projects/:project/schema     add or change field definitions
  ```
- Rules for change, enforced in the engine (docs/03):
  1. adding a field is always allowed;
  2. removing hides (`hidden: true` internally), never deletes values;
  3. type change → `422 FIELD_TYPE_IMMUTABLE`;
  4. unknown key on write → `400 FIELD_UNKNOWN`, unless
     `?allowUnknownFields=true` which auto-creates a hidden `text` FieldDef;
  5. `required` is advisory: the write succeeds with a `warnings` array.
- Validator cache: one compiled Zod schema per project, keyed by project id,
  invalidated on schema write **and on project delete** (recreated slug must
  not inherit).

## Acceptance criteria

- [ ] A write with a value of the wrong type for a defined field fails `400`
      with the field key in `details`.
- [ ] Removing a field then reading a task still returns the stored value;
      re-adding the field with the same key and type surfaces it again.
- [ ] `?allowUnknownFields=true` creates a hidden text field that is neither
      a column nor a facet.
- [ ] Delete project → recreate same slug → old schema is gone (cache test).
- [ ] Two projects with different schemas validate independently with no
      cross-talk.

## Tests

One test per rule 1–5; pool enforcement for `type`; cache invalidation on
schema write and project delete; validator reuse (same object identity until
invalidated).

## Out of scope

Task writes themselves (03), facets/columns rendering (14), AI extraction
(07).
