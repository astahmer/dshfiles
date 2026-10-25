import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const annotationsSettings = defineSettings({
  namespace: 'dshfiles-annotations',
  schema: Schema.object({
    chromePath: Schema.string()
      .default('')
      .description('Chrome or Chromium executable for the no-extension picker. Empty auto-detects the usual install location.'),
    cdpPort: Schema.natural().min(1024).max(65535).default(9222).description('Loopback port the picker browser exposes for the DevTools protocol.'),
    profileDir: Schema.string()
      .default('')
      .description('User data directory for that browser. Empty uses a DSH-owned profile so it never touches your daily Chrome.'),
    pickActiveTab: Schema.boolean().default(true).description('Pick on the focused tab instead of showing a tab list. Turn off to choose a tab per pick.'),
    startUrl: Schema.string().default('').description('Page the picker browser opens on launch. Empty opens a blank tab; paste your dev server URL here.'),
    pickTimeoutSeconds: Schema.natural().min(30).max(1_800).default(300).description('How long one pick may stay armed in the browser before it is abandoned.'),
  }),
  applies: 'live',
})
