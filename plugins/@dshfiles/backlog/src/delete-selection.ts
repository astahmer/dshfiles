/** Remove every selected item; whatever each removal resolves to is ignored. */
export const deleteSelection = async <Removed>(request: {
  readonly ids: readonly number[]
  readonly remove: (id: number) => Promise<Removed>
}): Promise<void> => {
  await Promise.all(request.ids.map(request.remove))
}
