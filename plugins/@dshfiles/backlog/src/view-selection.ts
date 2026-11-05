export type BacklogView = 'feed' | 'inbox' | 'items' | 'board' | 'projects' | 'shipped'

export type BacklogViewSelection = Record<BacklogView, number | null>

export const setBacklogViewSelection = (selection: BacklogViewSelection, view: BacklogView, id: number | null) => ({
  ...selection,
  [view]: id,
})
