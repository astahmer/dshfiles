import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { makeJiraPlugin } from './jira-plugin.js'

export default makeJiraPlugin({ services: Layer.mergeAll(FetchHttpClient.layer, SecretReferenceResolver.layer) })
