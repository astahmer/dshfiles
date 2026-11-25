import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { makeGiteaPlugin } from './gitea-plugin.js'

export default makeGiteaPlugin({ services: Layer.mergeAll(FetchHttpClient.layer, SecretReferenceResolver.layer) })
