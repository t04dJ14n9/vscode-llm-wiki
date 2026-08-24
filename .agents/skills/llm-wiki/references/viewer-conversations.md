# Viewer conversations

The extension exports immutable selections but never submits or scrapes
conversations. Within the agent session, file a Query automatically only when
the answer is substantial, grounded, supported, durable or expensive to
reconstruct, novel, clearly scoped, complete about limits, and safe. Ask for
borderline cases; keep trivial lookups read-only.

Store synthesis, not the transcript. Use `conversation.selection_id` for
idempotency. Improve the draft for the same selection; make a materially
different later answer a successor with `supersedes`.

After filing, update the living project repository guide when understanding
materially improved, apply Entity/Concept gates, put unresolved work in tasks,
then rebuild, validate, log, and refresh annotations.
