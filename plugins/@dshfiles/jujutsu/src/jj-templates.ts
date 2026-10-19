/** JSONL templates used by the Host and exercised against the installed JJ CLI. */
export const REVISION_TEMPLATE =
  '\'{"commitId":\' ++ self.commit_id().short(64).escape_json() ++ ' +
  '\',"changeId":\' ++ self.change_id().normal_hex().escape_json() ++ ' +
  '\',"shortestChangeId":\' ++ self.change_id().shortest().prefix().escape_json() ++ ' +
  '\',"description":\' ++ self.description().escape_json() ++ ' +
  '\',"author":\' ++ self.author().name().escape_json() ++ ' +
  '\',"authorTime":\' ++ self.author().timestamp().utc().format("%+").escape_json() ++ ' +
  '\',"committerTime":\' ++ self.committer().timestamp().utc().format("%+").escape_json() ++ ' +
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
  '\',"changeOffset":\' ++ coalesce(self.change_offset(), "0") ++ ' +
  '\',"evolved":false}\' ++ "\\n"'

export const OPERATION_TEMPLATE =
  '\'{"description":\' ++ self.description().first_line().escape_json() ++ ' +
  '\',"attributes":\' ++ self.attributes().escape_json() ++ ' +
  '\',"time":\' ++ self.time().end().format("%+").escape_json() ++ \'}\' ++ "\\n"'

export const EVOLUTION_TEMPLATE =
  '\'{"commitId":\' ++ self.commit().commit_id().short(64).escape_json() ++ ' +
  '\',"predecessors":[\' ++ self.predecessors().map(|c| c.commit_id().short(64).escape_json()).join(",") ++ \']}\' ++ "\\n"'

/**
 * One evolution entry and whether it edited the revision's own content. Squashing another revision in counts; a
 * version whose parents moved is a rebase, even when its tree changed with them.
 */
export const EDIT_TIME_TEMPLATE =
  '\'{"commitId":\' ++ self.commit().commit_id().short(64).escape_json() ++ ' +
  '\',"changeId":\' ++ self.commit().change_id().normal_hex().escape_json() ++ ' +
  '\',"edited":\' ++ if(self.predecessors().len() > 1 || (' +
  'self.predecessors().any(|p| stringify(p.parents().map(|c| c.commit_id().short(64)).join(",")) == stringify(self.commit().parents().map(|c| c.commit_id().short(64)).join(","))) ' +
  '&& self.inter_diff().files()), "true", "false") ++ ' +
  '\',"time":\' ++ self.operation().time().end().utc().format("%+").escape_json() ++ \'}\' ++ "\\n"'

export const FILE_STATS_TEMPLATE =
  '\'{"commitId":\' ++ self.commit_id().short(64).escape_json() ++ ' +
  '\',"files":[\' ++ self.diff().stat().files().map(|f| ' +
  '\'{"path":\' ++ f.path().display().escape_json() ++ ' +
  '\',"status":\' ++ f.status().escape_json() ++ ' +
  '\',"additions":\' ++ f.lines_added() ++ ' +
  '\',"deletions":\' ++ f.lines_removed() ++ \'}\').join(",") ++ ' +
  '\'],"conflicts":[\' ++ self.diff().files().filter(|e| e.target().conflict()).map(|e| e.path().display().escape_json()).join(",") ++ \']}\' ++ "\\n"'
