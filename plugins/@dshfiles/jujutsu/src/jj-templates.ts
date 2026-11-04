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
  '\',"remoteBookmarksText":\' ++ stringify(self.remote_bookmarks().map(|b| b.name() ++ "@" ++ b.remote()).join("\\n")).escape_json() ++ ' +
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

/** One operation per line, newest first: its id lets a later last-push scan stop where this one started. */
export const OPERATION_ID_TEMPLATE =
  '\'{"id":\' ++ self.id().short(128).escape_json() ++ ' +
  '\',"description":\' ++ self.description().first_line().escape_json() ++ ' +
  '\',"attributes":\' ++ self.attributes().escape_json() ++ ' +
  '\',"time":\' ++ self.time().end().format("%+").escape_json() ++ \'}\' ++ "\\n"'

/**
 * What a prepared action is bound to for one revision it names: visibility, mutability, working-copy role, parents,
 * local bookmarks and first line. Any change here between preview and confirmation refuses the action.
 */
export const TARGET_TEMPLATE =
  'commit_id ++ "\\t" ++ if(hidden, "hidden", "visible") ++ "\\t" ++ if(immutable, "immutable", "mutable") ++ "\\t" ++ ' +
  'if(current_working_copy, "working-copy", "-") ++ "\\t" ++ working_copies ++ "\\t" ++ parents.map(|c| c.commit_id()).join(",") ++ "\\t" ++ ' +
  'local_bookmarks.map(|b| b.name()).join(",") ++ "\\t" ++ description.first_line() ++ "\\n"'

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
  '\',"predecessors":[\' ++ self.predecessors().map(|c| c.commit_id().short(64).escape_json()).join(",") ++ ' +
  '\'],"time":\' ++ self.operation().time().end().utc().format("%+").escape_json() ++ \'}\' ++ "\\n"'

export const FILE_STATS_TEMPLATE =
  '\'{"commitId":\' ++ self.commit_id().short(64).escape_json() ++ ' +
  '\',"files":[\' ++ self.diff().stat().files().map(|f| ' +
  '\'{"path":\' ++ f.path().display().escape_json() ++ ' +
  '\',"status":\' ++ f.status().escape_json() ++ ' +
  '\',"additions":\' ++ f.lines_added() ++ ' +
  '\',"deletions":\' ++ f.lines_removed() ++ \'}\').join(",") ++ ' +
  '\'],"conflicts":[\' ++ self.diff().files().filter(|e| e.target().conflict()).map(|e| e.path().display().escape_json()).join(",") ++ \']}\' ++ "\\n"'
