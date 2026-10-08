/** JSONL templates used by the Host and exercised against the installed JJ CLI. */
export const REVISION_TEMPLATE =
  '\'{"commitId":\' ++ self.commit_id().short(64).escape_json() ++ ' +
  '\',"changeId":\' ++ self.change_id().normal_hex().escape_json() ++ ' +
  '\',"shortestChangeId":\' ++ self.change_id().shortest().prefix().escape_json() ++ ' +
  '\',"description":\' ++ self.description().escape_json() ++ ' +
  '\',"author":\' ++ self.author().name().escape_json() ++ ' +
  '\',"authorTime":\' ++ self.author().timestamp().utc().format("%+").escape_json() ++ ' +
  '\',"parents":[\' ++ self.parents().map(|c| c.commit_id().short(64).escape_json()).join(",") ++ \']\' ++ ' +
  '\',"bookmarks":[\' ++ self.bookmarks().map(|b| b.name().escape_json()).join(",") ++ \']\' ++ ' +
  '\',"localBookmarks":[\' ++ self.local_bookmarks().map(|b| b.name().escape_json()).join(",") ++ \']\' ++ ' +
  '\',"tags":[\' ++ self.tags().map(|t| t.name().escape_json()).join(",") ++ \']\' ++ ' +
  '\',"workspaces":[\' ++ self.working_copies().map(|w| w.name().escape_json()).join(",") ++ \']\' ++ ' +
  '\',"workingCopy":\' ++ self.current_working_copy() ++ ' +
  '\',"mine":\' ++ self.mine() ++ ' +
  '\',"immutable":\' ++ self.immutable() ++ ' +
  '\',"divergent":\' ++ self.divergent() ++ ' +
  '\',"empty":\' ++ self.empty() ++ ' +
  '\',"conflict":\' ++ self.conflict() ++ ' +
  '\',"evolved":false}\' ++ "\\n"'

export const OPERATION_TEMPLATE =
  '\'{"description":\' ++ self.description().first_line().escape_json() ++ ' +
  '\',"attributes":\' ++ self.attributes().escape_json() ++ ' +
  '\',"time":\' ++ self.time().end().format("%+").escape_json() ++ \'}\' ++ "\\n"'

export const EVOLUTION_TEMPLATE =
  '\'{"commitId":\' ++ self.commit().commit_id().short(64).escape_json() ++ ' +
  '\',"predecessors":[\' ++ self.predecessors().map(|c| c.commit_id().short(64).escape_json()).join(",") ++ \']}\' ++ "\\n"'

export const FILE_STATS_TEMPLATE =
  '\'{"commitId":\' ++ self.commit_id().short(64).escape_json() ++ ' +
  '\',"files":[\' ++ self.diff().stat().files().map(|f| ' +
  '\'{"path":\' ++ f.path().display().escape_json() ++ ' +
  '\',"status":\' ++ f.status().escape_json() ++ ' +
  '\',"additions":\' ++ f.lines_added() ++ ' +
  '\',"deletions":\' ++ f.lines_removed() ++ \'}\').join(",") ++ \']}\' ++ "\\n"'
