import { registerHooks } from 'node:module'

const isCoreRuntimeImport = (specifier, parentUrl) =>
  specifier === '@deepseek-ai/dsh-api-session-controller' ||
  specifier === '@deepseek-ai/dsh-session' ||
  specifier === '@deepseek-ai/cordis' ||
  String(parentUrl).includes('/dsh-api-session-controller/')

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parentUrl = context.parentURL ?? '<entrypoint>'
    try {
      const resolution = nextResolve(specifier, context)
      if (isCoreRuntimeImport(specifier, parentUrl)) {
        process.stderr.write(
          `Core runtime resolution ${specifier} from ${parentUrl} -> ${resolution.url}\n`,
        )
      }
      return resolution
    } catch (error) {
      if (isCoreRuntimeImport(specifier, parentUrl)) {
        process.stderr.write(
          `Core runtime resolution failure ${specifier} from ${parentUrl}: ${error.stack ?? error}\n`,
        )
      }
      throw error
    }
  },
})
