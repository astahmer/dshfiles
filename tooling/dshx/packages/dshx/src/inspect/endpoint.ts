import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { LocalEndpointAddress } from '../bridge/local-endpoint.js'

export interface InspectEndpointLocation {
  readonly directory: string
  readonly metadataPath: string
  readonly address: LocalEndpointAddress
}

/** Where one package's Host Inspect bridge keeps its metadata and listens; the Host and the dshx client derive it alike. */
export const inspectEndpoint = (home: string, packageId: string): InspectEndpointLocation => {
  const directory = join(home, 'runtime', 'dshx', 'inspect')
  const name = createHash('sha256').update(packageId).digest('hex').slice(0, 20)
  return {
    directory,
    metadataPath: join(directory, `${name}.json`),
    address: {
      socketPath: join(directory, `${name}.sock`),
      shortName: `dshx-${createHash('sha256').update(`${home}:${packageId}`).digest('hex').slice(0, 24)}`,
    },
  }
}
