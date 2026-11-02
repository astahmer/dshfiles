import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'

/** The platform the account services run on: the Host's file system and paths, and `fetch` as the HTTP client. */
export const AccountsPlatformLive = Layer.mergeAll(nodeFileSystemLayer, nodePathLayer, FetchHttpClient.layer)
