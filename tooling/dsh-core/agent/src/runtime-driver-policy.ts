import type { RuntimeDriverDescriptor } from './runtime-driver.ts'

export const runtimeDriverSupportsOperation = (
  capabilities: RuntimeDriverDescriptor['capabilities'],
  operation: 'create' | 'resume' | 'fork',
): boolean => {
  if (capabilities[operation]) return true
  if (operation === 'create') return false
  return capabilities.create && capabilities.historyReplay
}
