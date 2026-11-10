import type { DirectoryListing } from './project-folder-picker.js'
import { ProjectFolderPickerModel, type PathStyle } from './project-folder-picker-model.js'

export interface PickerFlowState {
  readonly query: string
  readonly browse: { readonly path: string | undefined } | null
}

export type PickerFlowEvent =
  | {
      readonly type: 'query.typed'
      readonly query: string
      readonly listing: DirectoryListing | null
      readonly pathStyle: PathStyle
      readonly directories: boolean
    }
  | { readonly type: 'browse.requested'; readonly path: string | undefined }
  | {
      readonly type: 'listing.loaded'
      readonly listing: DirectoryListing
      readonly pathStyle: PathStyle
      readonly directories: boolean
    }

export const initialPickerFlow = (mode: 'projects' | 'directories' | undefined): PickerFlowState => ({
  query: '',
  browse: ProjectFolderPickerModel.initialBrowseTarget(mode),
})

const rootBrowse = (browse: PickerFlowState['browse']): PickerFlowState['browse'] =>
  browse !== null && browse.path === undefined ? browse : { path: undefined }

const browseAfterTyping = ({
  query,
  listing,
  pathStyle,
  browse,
}: {
  readonly query: string
  readonly listing: DirectoryListing | null
  readonly pathStyle: PathStyle
  readonly browse: PickerFlowState['browse']
}): PickerFlowState['browse'] => {
  if (ProjectFolderPickerModel.isHomeRelativePathQuery(query, pathStyle)) {
    const nextPath = ProjectFolderPickerModel.resolvePathQuery(query, listing?.home, pathStyle)
    return listing === null || nextPath === null || !ProjectFolderPickerModel.isPathAtOrWithin(nextPath, listing.path) ? rootBrowse(browse) : browse
  }
  if (ProjectFolderPickerModel.isAbsolutePath(query, pathStyle)) {
    if (listing === null) return rootBrowse(browse)
    const nextPath = ProjectFolderPickerModel.resolvePathQuery(query, listing.home, pathStyle)
    const outsideListing =
      nextPath !== null &&
      ProjectFolderPickerModel.isPathAtOrWithin(nextPath, listing.home) &&
      !ProjectFolderPickerModel.isPathAtOrWithin(nextPath, listing.path)
    return outsideListing ? rootBrowse(browse) : browse
  }
  return ProjectFolderPickerModel.isPathQuery(query, pathStyle) ? browse : null
}

const rewriteQuery = ({
  query,
  browse,
  listing,
  pathStyle,
}: {
  readonly query: string
  readonly browse: NonNullable<PickerFlowState['browse']>
  readonly listing: DirectoryListing
  readonly pathStyle: PathStyle
}): string => {
  if (ProjectFolderPickerModel.matchingDirectoryPaths(listing, query) !== null) return query
  return browse.path === undefined && ProjectFolderPickerModel.isPathQuery(query, pathStyle) ? query : listing.path
}

/**
 * The path query and the folder it browses move together: a typed path opens the browsable root, a loaded listing
 * rewrites the query and opens a unique child match in one transition, so neither can observe the other half-applied.
 */
export const pickerFlowReducer = (flow: PickerFlowState, event: PickerFlowEvent): PickerFlowState => {
  if (event.type === 'browse.requested') {
    if (flow.browse?.path === event.path) return flow
    return { ...flow, browse: { path: event.path } }
  }
  if (event.type === 'query.typed') {
    const browse = browseAfterTyping({ query: event.query, listing: event.listing, pathStyle: event.pathStyle, browse: flow.browse })
    const pathMode = event.directories || ProjectFolderPickerModel.isPathQuery(event.query, event.pathStyle)
    const matchedPath =
      pathMode && browse !== null && browse === flow.browse && event.listing !== null
        ? ProjectFolderPickerModel.uniqueMatchingDirectoryPath(event.listing, event.query)
        : null
    const nextBrowse = matchedPath === null || matchedPath === event.listing?.path ? browse : { path: matchedPath }
    return nextBrowse === flow.browse && event.query === flow.query ? flow : { query: event.query, browse: nextBrowse }
  }
  if (flow.browse === null) return flow
  const query = rewriteQuery({ query: flow.query, browse: flow.browse, listing: event.listing, pathStyle: event.pathStyle })
  const pathMode = event.directories || ProjectFolderPickerModel.isPathQuery(flow.query, event.pathStyle)
  const matchedPath = pathMode ? ProjectFolderPickerModel.uniqueMatchingDirectoryPath(event.listing, flow.query) : null
  const browse = matchedPath === null || matchedPath === event.listing.path ? flow.browse : { path: matchedPath }
  return query === flow.query && browse === flow.browse ? flow : { query, browse }
}
