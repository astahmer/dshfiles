import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { makeNotionPlugin } from './notion-plugin.js'

export default makeNotionPlugin({ services: Layer.mergeAll(FetchHttpClient.layer, SecretReferenceResolver.layer) })
