# Creator mode is not available

`@deepseek-ai/dsh-agent-preset` ships a `skills/` directory that a "creator"
mode mounts through `skill-filesystem`: `agent-experience`,
`cordis-plugin-development` (with `references/` and copyable `templates/`),
`editing-cordis-compositions`, and `cordis-composition-reference`.

**As of DSH 0.2.0-rc.2 on this profile, no preset with `id: creator` is
declared.** The four declared ids are `standard`, `minimal`, `ptc`, and
`cordis`, and `agent-preset-registry`'s `default` is `standard`.

This matters because we intend to create DSH plugins *from inside DSH itself*.
That path depends on `cordis-plugin-development`, which is the single best
piece of DSH documentation for plugin work — it mandates `plugin_manager` with
`action: install_bundle`, forbids hand-editing `package.json` /
`cordis.patch.yml`, and lists concrete verification steps.

Do not assume the skills are reachable. Check first:

```sh
dsh --profile web --dump-config | grep -A4 "name: '@deepseek-ai/dsh-agent-preset'$"
```

If `creator` is missing, read the skill directly from the installed package
instead — the skills are plain files on disk:

```sh
find ~/.local/share/pnpm/global/v11 -path '*dsh-agent-preset/skills' -type d
```

Presets are declared as entries in `@deepseek-ai/dsh-agent-preset`; the active
default comes from `agent-preset-registry`'s `default` config key. Sessions
store the preset identity they were created with, so changing the default does
not move existing sessions — start a new one to pick it up.
