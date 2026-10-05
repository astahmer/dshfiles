# Narrow DSH core fork

The agent package is copied from DeepSeek Harness tag `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84`, https://github.com/deepseek-ai/deepseek-harness. Original MIT license is retained. No upstream remote or nested VCS boundary.

This source fork earns its scope from software roadmap Phase 1A: named runtime drivers must coexist behind the native AgentRegistry lifecycle while preserving the standard factory. Its native package name is retained so all runtime consumers share one identity. It is private, never published by this repository.

Build only this TypeScript package; existing official runtime dependencies remain binary/published packages. Scratch profile overrides must bind every native agent dependency to this package. Never patch the user's installed global package or running web profile.

Commands: `pnpm --dir tooling/dsh-core/agent install`, then `build`, `test`, and `typecheck`. Runtime acceptance must explicitly test the override; source checks are not activation proof.
