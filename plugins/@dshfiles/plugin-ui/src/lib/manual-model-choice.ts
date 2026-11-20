declare global {
  var dshfilesManualModelChoiceV1: Set<string> | undefined
}

/**
 * Threads whose model a person picked by hand in the composer's model picker. Plugins that choose a model on their own
 * (an agent mention) leave these threads alone. Inlined modules share this one registry through `globalThis`.
 */
export const manualModelChoices = (): Set<string> => (globalThis.dshfilesManualModelChoiceV1 ??= new Set<string>())
