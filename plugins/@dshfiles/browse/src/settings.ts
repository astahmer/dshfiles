import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const BROWSE_SETTINGS_DEFAULTS = { command: 'browse', pollIntervalMs: 5_000, notifyHandoffs: false } as const

export const browseSettings = defineSettings({
  namespace: 'dshfiles-browse',
  schema: Schema.object({
    command: Schema.string()
      .default(BROWSE_SETTINGS_DEFAULTS.command)
      .description(
        'The browse CLI to run: a program name looked up on PATH (plus ~/.local/bin and the Nix profiles), or an absolute path. Change it when the panel says browse is not installed but `browse --version` works in a terminal.',
      ),
    pollIntervalMs: Schema.natural()
      .min(1_000)
      .max(60_000)
      .default(BROWSE_SETTINGS_DEFAULTS.pollIntervalMs)
      .description(
        'How often, in milliseconds, the panel and the handoff notifier run `browse status --json`. It only reads the local CLI; no tokens are spent.',
      ),
    notifyHandoffs: Schema.boolean()
      .default(BROWSE_SETTINGS_DEFAULTS.notifyHandoffs)
      .description(
        'Watch for agent tabs that wait on you (sign-in, captcha, 2FA) and put them in the Inbox and on the panel badge. Off (the default) stops the background check entirely; turn it on when agents use browse.',
      ),
  }),
  applies: 'live',
})

export type BrowseSettings = ReturnType<typeof browseSettings.schema>
