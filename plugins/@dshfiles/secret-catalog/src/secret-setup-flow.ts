import type { SecretCreateInput } from './secret-operations.js'
import { SecretSetupModel } from './secret-setup-model.js'

export interface SecretSetupFlowPorts {
  readonly create: (input: SecretCreateInput) => Promise<{ readonly created: true }>
  readonly bind: (reference: string) => Promise<void>
}

export type SecretSetupResult = { readonly status: 'bound'; readonly reference: string } | { readonly status: 'stored'; readonly reference: string }

export const storeAndBindSecret = async (input: { readonly request: SecretCreateInput; readonly ports: SecretSetupFlowPorts }): Promise<SecretSetupResult> => {
  await input.ports.create(input.request)
  const reference = SecretSetupModel.reference({ alias: input.request.alias, environment: input.request.environment })
  try {
    await input.ports.bind(reference)
    return { status: 'bound', reference }
  } catch {
    return { status: 'stored', reference }
  }
}

export const bindStoredSecret = async (input: { readonly reference: string; readonly bind: (reference: string) => Promise<void> }): Promise<boolean> => {
  try {
    await input.bind(input.reference)
    return true
  } catch {
    return false
  }
}
