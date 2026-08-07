/**
 * The payload of the data-change stream (`GET /api/events`), shared by the
 * server that emits it and the client that subscribes to it.
 *
 * docs/06-rest-api.md "The events stream": "one stream of all data changes:
 * tasks, projects, schemas, and saved views. Each event names the record
 * type, the record id, and the kind of change."
 */

export const CHANGE_TYPES = ["task", "project", "schema", "view"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_KINDS = ["created", "updated", "deleted"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export interface ChangeEvent {
  type: ChangeType;
  /**
   * The id of the record that changed. A `project` event and a `schema`
   * event both name the project's id: the schema is part of the project row,
   * not a record of its own, but a client refreshes the two separately.
   */
  id: string;
  /**
   * The project the record belongs to, so a client filters the stream
   * without a lookup. For `project` and `schema` events it repeats `id`.
   */
  projectId: string | null;
  change: ChangeKind;
}
