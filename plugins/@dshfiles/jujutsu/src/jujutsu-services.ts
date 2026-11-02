import { Layer } from 'effect'
import { ComposerContext } from './composer-context-host.js'
import { JujutsuCommands } from './jujutsu-commands.js'
import { Mutations } from './mutations.js'
import { Repositories } from './repositories.js'
import { RepositoryIdentity } from './repository-identity.js'
import { RepositoryInitializer } from './repository-init.js'
import { RevisionReader } from './revision-reader.js'

/** The panel and composer services over a jj runner (`JjViewReads`) and the platform `FileSystem` and `Path`. */
export const JujutsuServicesLive = Layer.mergeAll(Mutations.layer, ComposerContext.layer).pipe(
  Layer.provideMerge(RevisionReader.layer),
  Layer.provideMerge(Repositories.layer),
  Layer.provideMerge(Layer.mergeAll(JujutsuCommands.layer, RepositoryInitializer.layer)),
  Layer.provideMerge(RepositoryIdentity.layer),
)
