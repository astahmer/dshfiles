# DSH core runtime bridge

This private bundle lets a scratch DSH profile load the first-party core forks
from this checkout for Agent, AgentLoop, Session, and JSONL persistence. Its
composition patch disables the matching native rows and inserts scoped local
entrypoints in their place.

Keep this bundle opt-in. Install it only in a scratch profile while validating
the local forks; it is not part of the active web profile. The package depends
on local workspace paths and is not a registry distribution.
