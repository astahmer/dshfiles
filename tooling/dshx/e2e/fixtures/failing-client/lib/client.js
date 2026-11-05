// Hand-written, not built: the client half throws in apply, the failure the boot card must report by entry id.
window.__ModuleLoader__.load({
  id: `@dshfiles-e2e/failing-client`,
  factory: () => {
    const exports = {}
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    exports.name = '@dshfiles-e2e/failing-client'
    exports.inject = undefined
    exports.Config = undefined
    exports.apply = () => {
      throw new Error('E2E fixture: the failing-client entry throws in apply on purpose')
    }
    return exports
  },
})
