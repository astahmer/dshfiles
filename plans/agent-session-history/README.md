# Agent Session History progress

Primary design: [Agent Session History plan](../agent-session-history.md).

| Step | Status | Evidence |
|---|---|---|
| Define Agent search/read goals, workspace scopes, LoD behavior, and write meaning | complete | User confirmed old/active Session search; read-only current workspace default; write grants cover all supported operations. |
| Inspect DSH Host Agent Tool, Session, Workspace, and Approval contracts | in progress | Live Inspect confirms `sessionController`, `sessionQuery`, `workspaceController`, `tools`, and one-time `approval` services. Session page cursor gap and group availability need source verification. |
| Implement safe, bounded Session Controller latest-page read | pending | Existing `page` requires `throughSeq`; cold `follow` can promote/activate a Session. Create a core workspace only if source audit confirms no supported alternative. |
| Build Agent-facing Session History tools and Host-enforced presets | pending | New domain boundary; keep Agent Communication focused on peer messaging. |
| Validate in isolated profile and report promotion gates | pending | Never modify or restart the active `web` profile during this task. |

## Resume here

Finish the Host API source audit for cold-safe latest-page access, cursor-based search, and exact workspace/status signals. Then implement in named JJ workspaces based on current tips, preserving unrelated active writers.
