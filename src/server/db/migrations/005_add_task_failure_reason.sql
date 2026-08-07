-- The failure loop of docs/04-status-pipeline.md: "Each gate has one failure
-- path. The task returns to `executing`. The service attaches the reason. The
-- next run receives the reason as part of its instructions."
--
-- The reason is one string on the task, written by the transition engine
-- (src/server/tasks/pipeline.ts) and cleared the moment the task advances
-- again. It is server-owned: the task API returns it and never accepts it.
ALTER TABLE tasks ADD COLUMN failureReason TEXT;
