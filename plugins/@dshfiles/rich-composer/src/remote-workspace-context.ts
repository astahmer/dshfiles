import type { RemoteSessionWorkspaceOwnership } from './native/contract/slots.ts'

export const confirmedRemoteWorkspaceCwd = (input: {
  readonly ownership: RemoteSessionWorkspaceOwnership | undefined
  readonly cwd: string | undefined
}): string | undefined => {
  if (input.ownership !== 'remote' || input.cwd === undefined || input.cwd === '') return undefined
  return input.cwd
}
