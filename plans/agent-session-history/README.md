# Agent Session History progress

Primary design: [Agent Session History plan](../agent-session-history.md).

| Step | Status | Evidence |
|---|---|---|
| Define Agent search/read goals, workspace scopes, LoD behavior, and write meaning | complete | User confirmed old/active Session search; read-only current workspace default; write grants cover all supported operations. |
| Inspect DSH Host Agent Tool, Session, Workspace, and Approval contracts | in progress | Native Host services and source contracts are verified; search cursor/filter semantics and canonical workspace/group signals still need final audit. |
| Implement safe, bounded Session Controller latest-page read | complete | Added optional latest-cursor selection to `sessionController.page` without activation; output returns `throughSeq`. Core revision `445de7b3`; 284 focused tests and Host typecheck pass. |
| Build Agent-facing Session History tools and Host-enforced presets | pending | New domain boundary; keep Agent Communication focused on peer messaging. |
| Validate in isolated profile and report promotion gates | pending | Never modify or restart the active `web` profile during this task. |

## Resume here

Finish the Host API source audit for cursor-based search and exact workspace/status signals. Then build Agent tools and Host permission enforcement in named JJ workspaces, preserving unrelated active writers.
