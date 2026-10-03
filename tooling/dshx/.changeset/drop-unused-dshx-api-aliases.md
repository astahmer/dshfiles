---
"@dshfiles/dshx": patch
---

Remove the deprecated `DSH_0_1_COMPATIBILITY`, `DSH_0_2_COMPATIBILITY`, and `RC8_COMPATIBILITY` exports. Use `PROTOCOL_1_COMPATIBILITY` or `PROTOCOL_2_COMPATIBILITY` instead. Remove imports of the unused `SettingsApplies` and `SettingsRegisterOptions` types; Settings contracts retain the literal `applies: 'live'`, and DSH 0.2 has no per-section registration options.
