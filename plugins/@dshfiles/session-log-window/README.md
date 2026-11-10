# @dshfiles/session-log-window

Bounded reads of one stored Session log, shared by every Host reader that needs a few events instead of the whole
event list.

The JSONL backend writes a header frame and then one independently decodable Zstandard frame per durable append, so a
reader can decode a byte window of the log:

| Read | Window | Used by |
| --- | --- | --- |
| `TailLog.open` | newest `TAIL_WINDOW_BYTES` (4 MB) | the Session Controller's cold transcript and follow pages |
| `openLogHead` | first `HEAD_WINDOW_BYTES` (256 KB) | a title's provenance event, which the Session writes at the start |
| `recentLogEvents` | the newest frames, extended back until enough matches | hook events, a pull-request thread's last messages |

Each returns `undefined` when the window cannot serve the read exactly — another backend, a non-current format, a
migration, a torn frame, fewer matches than the caller needs and no reach back to the log's first event. Every caller
then keeps its full-log path, so a window never shortens an answer.

`TailLog.restore` folds the projection cache's persisted checkpoint over the decoded tail through
`ctx.sessionProjections.restore`, which is how a cold Session gets its projections without decoding its log.

The package opens no span: the calling plugin owns one (`session tail read` for the Controller, a title-read span for
the search backend) and records the window's bytes, frames and per-phase timings from the `metrics` bag it passes in.
