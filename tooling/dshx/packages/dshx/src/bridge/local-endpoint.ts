import { randomBytes } from 'node:crypto'
import { chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Where one Host bridge would listen: its socket file beside the metadata, and a short name for the fallbacks. */
export interface LocalEndpointAddress {
  readonly socketPath: string
  /** `[a-z0-9-]` only: it names the short POSIX socket and prefixes the Windows pipe. */
  readonly shortName: string
}

const NAMED_PIPE_PREFIX = '\\\\.\\pipe\\'
/** macOS limits AF_UNIX paths to about 104 bytes; past this a deep `DSH_HOME` moves the socket to the temp directory. */
const MAX_SOCKET_PATH = 90

/**
 * The local endpoint a dshx Host bridge listens on and its clients connect to.
 *
 * POSIX: a Unix domain socket file, `0600`, removed when the bridge closes. Windows has no socket files: Node's
 * `net.Server` only listens on named pipes (`\\.\pipe\…`). Pipe names are machine-wide, so the Host picks a random
 * one per run (another local user cannot claim it first) and clients read it from the private bridge metadata. A pipe
 * needs no chmod (chmod on a live pipe opens a client connection to it) and vanishes with its server (`rm` on one
 * fails with EINVAL).
 */
export class LocalEndpoint {
  static readonly isNamedPipe = (path: string): boolean => path.startsWith(NAMED_PIPE_PREFIX)

  /** A fresh endpoint for a Host to listen on. */
  static readonly listenPath = (address: LocalEndpointAddress, platform: NodeJS.Platform = process.platform): string =>
    platform === 'win32' ? `${NAMED_PIPE_PREFIX}${address.shortName}-${randomBytes(12).toString('hex')}` : LocalEndpoint.socketFile(address)

  /** Whether a path read from bridge metadata is an endpoint this address could have produced. */
  static readonly accepts = (address: LocalEndpointAddress, candidate: string, platform: NodeJS.Platform = process.platform): boolean => {
    if (platform !== 'win32') return resolve(candidate) === resolve(LocalEndpoint.socketFile(address))
    if (!candidate.startsWith(`${NAMED_PIPE_PREFIX}${address.shortName}-`)) return false
    return /^[0-9a-f]{24}$/u.test(candidate.slice(NAMED_PIPE_PREFIX.length + address.shortName.length + 1))
  }

  /** Make a listening socket file owner-only; a named pipe is left alone. */
  static readonly restrict = async (path: string): Promise<void> => {
    if (!LocalEndpoint.isNamedPipe(path)) await chmod(path, 0o600)
  }

  /** Remove a socket file; a named pipe disappears with its server. */
  static readonly remove = async (path: string): Promise<void> => {
    if (!LocalEndpoint.isNamedPipe(path)) await rm(path, { force: true })
  }

  private static readonly socketFile = (address: LocalEndpointAddress): string =>
    address.socketPath.length > MAX_SOCKET_PATH ? join(tmpdir(), `${address.shortName}.sock`) : address.socketPath
}

/**
 * Whether a file or directory grants no group or other access. Windows reports synthetic POSIX modes (files `0o666`,
 * directories `0o777`), so there the user profile's ACL is the boundary and every path passes.
 */
export const isOwnerOnly = (info: { readonly mode: number }, platform: NodeJS.Platform = process.platform): boolean =>
  platform === 'win32' || (info.mode & 0o077) === 0
