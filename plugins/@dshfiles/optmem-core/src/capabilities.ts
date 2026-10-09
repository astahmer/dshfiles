export type HarnessCapabilities = {
  readonly captureEvents: boolean
  readonly registerTools: boolean
  readonly injectContext: boolean
  readonly replaceContext: boolean
  readonly resetPerTurn: boolean
}

export type MemoryMode = 'compatibility' | 'full'

export type CapabilityCheck =
  | { readonly ok: true; readonly mode: MemoryMode }
  | { readonly ok: false; readonly mode: MemoryMode; readonly missing: readonly (keyof HarnessCapabilities)[]; readonly message: string }

const requirements: Readonly<Record<MemoryMode, readonly (keyof HarnessCapabilities)[]>> = {
  compatibility: ['captureEvents', 'registerTools', 'injectContext'],
  full: ['captureEvents', 'registerTools', 'injectContext', 'replaceContext', 'resetPerTurn'],
}

export class Capabilities {
  static required(mode: MemoryMode): readonly (keyof HarnessCapabilities)[] {
    return requirements[mode]
  }

  static validate(mode: MemoryMode, capabilities: HarnessCapabilities): CapabilityCheck {
    const missing = requirements[mode].filter(name => !capabilities[name])
    if (missing.length === 0) return { ok: true, mode }
    return { ok: false, mode, missing, message: `OptMem ${mode} mode needs harness capabilities it lacks: ${missing.join(', ')}` }
  }
}
