# 03 — Custom fields

## The requirement

Field definitions grow over time. Different projects need different fields. The
service must accept new fields without a change to the code and without a change
to the database schema.

## The design

Each task has a small set of core fields and one open object.

- **Core fields** exist on every task in every project: `title`, `status`,
  `priority`, `size`, `labels`, `assignee`, `description`, and the timestamps.
  Generic code and cross-project queries use only these fields.
- **The `fields` object** holds all other values. The project's `fieldSchema`
  describes this object. The database does not constrain it.

## FieldDef

```jsonc
{
  "key":         "difficulty",     // snake_case, permanent
  "label":       "Difficulty",     // shown to the user
  "type":        "select",
  "options":     ["trivial", "easy", "moderate", "hard"],   // select types only
  "required":    false,
  "default":     null,
  "order":       3,
  "showInTable": true,             // the field is a column in the table
  "showAsFacet": true,             // the field is a filter in the left rail
  "description": "How hard the work is"
}
```

### Field types

`text`, `long_text`, `number`, `checkbox`, `date`, `datetime`, `select`,
`multi_select`, `url`, `person`, `task_ref`.

### Two switches, two surfaces

`showInTable` and `showAsFacet` are independent. The set of columns and the set
of filters are different sets.

| Field | Column | Facet |
|---|---|---|
| `difficulty` | yes | yes |
| `layer` | no | yes |
| `spike` | no | no |

## Rules for change

1. **To add a field is always safe.** Existing tasks have no value for the new
   key. A read returns the `default` value, or `null`.
2. **To remove a field hides it. It does not delete data.** The value stays in
   the `fields` object. The user can show the field again.
3. **The service refuses a change of type.** To change a type, create a new
   field. This keeps the parsing rules of all API clients correct.
4. **The service refuses an unknown key.** Use the parameter
   `?allowUnknownFields=true` to accept it. With this parameter, the service
   creates a `text` FieldDef for the key. The new field is hidden. It is not a
   column and not a facet.
5. **`required` is advisory in the API.** A write that omits a required field
   succeeds. The response contains a `warnings` array. The interface enforces
   `required` when a person edits a task.

Rule 4 has two parts for one reason. Strict rejection finds errors in agent
code. The parameter permits growth without a change to the schema first.

## The schema drives four surfaces

The service builds these from `fieldSchema`. It does not hard-code them.

| Surface | Rule |
|---|---|
| Table columns | Each field with `showInTable` is a column. |
| Filter facets | Each `select` or `multi_select` field with `showAsFacet` is a facet. |
| Write validation | The service builds a Zod schema from `fieldSchema` and caches it. |
| AI extraction | The compose step uses the same Zod schema. See [08](08-ai-compose.md). |

One project has `difficulty`. Another project does not. Both projects work
without a change to the code.

## Validation cache

The service builds one Zod schema for each project. It caches the schema. It
clears the cache entry when the schema changes and when the project is deleted.

A deleted project must clear its cache entry. A new project with the same slug
must not receive the previous schema.

## Related documents

- [02 — Data model](02-data-model.md)
- [08 — AI compose](08-ai-compose.md)
- [12 — Project settings](12-project-settings.md)
