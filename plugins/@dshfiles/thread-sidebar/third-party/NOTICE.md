The subagent header/catalog fork in `src/subagent-provenance/` is adapted from the MIT-licensed `@deepseek-ai/dsh-client-ui-subagent` package (DSH 0.2.0-rc.2), specifically `packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx` and `SubagentHeaderLineage.module.css`.

This copy registers through `@dshfiles/thread-sidebar`, adds provider/model identity to catalog rows, and omits email-like or credential-like route values. The DSH core package and runtime are not modified.
