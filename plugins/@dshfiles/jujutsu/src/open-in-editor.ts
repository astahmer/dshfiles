import { Files, useContract } from '@dshfiles/dshx/client'

/**
 * Opens a repository file in the editor through the dshx `Files` contract. The returned function reports false while no
 * editor provides it or no session is on screen.
 */
export const useOpenInEditor = (): ((request: { readonly path: string; readonly cwd: string; readonly line?: number }) => boolean) => {
  const files = useContract(Files)
  return request => files.status === 'active' && files.value.open(request)
}
