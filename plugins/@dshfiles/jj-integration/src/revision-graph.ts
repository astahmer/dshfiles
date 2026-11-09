/**
 * The `revision-graph` dshx module: the revision graph layout and the SVG row cell that draws it, shared so a plugin
 * can draw a revision graph without depending on `@dshfiles/jujutsu`.
 */
export {
  RevisionGraphLayout,
  type GraphAncestor,
  type GraphLane,
  type GraphLink,
  type GraphParentLink,
  type GraphRevision,
  type RevisionGraphRow,
} from './revision-graph-layout.js'
export {
  GRAPH_DENSITY,
  GraphLanes,
  graphWidthFor,
  RevisionGraphCell,
  type GraphDensity,
  type GraphLanesProps,
  type GraphMetrics,
  type GraphNodeRevision,
  type RevisionGraphCellProps,
} from './revision-graph-cell.js'
