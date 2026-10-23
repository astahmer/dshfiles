export const deleteSelection = async (request: { readonly ids: readonly number[]; readonly remove: (id: number) => Promise<unknown> }): Promise<void> => {
  await Promise.all(request.ids.map(request.remove))
}
