import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'

/** The child slots the shell's `sidebar.settings` entry declares, as the native shell declares them. */
export const SHELL_CHILDREN = {
  'settings.launcher': { kind: 'single', scope: 'root' },
  'settings.trigger': { kind: 'single', scope: 'root' },
  'settings.header': { kind: 'single', scope: 'root' },
  'settings.action': { kind: 'list', scope: 'root' },
  'settings.close': { kind: 'single', scope: 'root' },
  'settings.section': { kind: 'list', scope: 'root' },
  'settings.onboarding': { kind: 'list', scope: 'root' },
} as const

type ShellChildKey = keyof typeof SHELL_CHILDREN

export type ShellRenderSlot = PropsRenderSlots<ShellChildKey>['renderSlot']
