/**
 * Keep only the bindings whose Session generation is still current. A dropped
 * generation keeps its stale binding until the scope effect unwinds, and
 * refreshing a view through it throws into every locale subscriber.
 */
export const liveViewBindings = <Binding extends { readonly sessionId: string }>(input: {
  readonly bindings: Set<Binding>
  readonly current: (sessionId: Binding['sessionId']) => Binding | undefined
  readonly onDrop: (binding: Binding) => void
}): readonly Binding[] => {
  const live: Binding[] = []
  for (const binding of input.bindings) {
    if (input.current(binding.sessionId) !== binding) {
      input.bindings.delete(binding)
      input.onDrop(binding)
      continue
    }
    live.push(binding)
  }
  return live
}
