# Backlog improvement sweep

Resume here: continue the measurement work for the open items below. Storage batching requires the pending human decision about recovery from a published-but-not-durable write. Do not restart the live Host; session-list instrumentation needs a user-controlled restart before it can collect live attribution. Preserve data and do not push.

| Item   | State   | Evidence and next step                                                                                                                                           |
| ------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| b:y3h4 | Done    | Pricing service registered and tested; `jj:zuvlwqpu`. Live Host needs restart.                                                                                   |
| b:bvsv | Done    | Checkout repair planner and real-JJ regression landed; `jj:olztnwqp`, `jj:uxksnrml`.                                                                             |
| b:17rs | Partial | Live list is slow; added bounded diagnostic spans in `jj:usllsyzy`. After Host restart measure actual cache misses and corpus cost before optimizing.            |
| b:z0sm | Partial | Live rapid-typing probe confirms repeated calls but not material latency; design freshness and invalidation before caching.                                      |
| b:0b04 | Partial | Bulk writes rewrite one JSON document per record; a post-rename sync failure makes rollback uncertain. Await human decision on the additional recovery protocol. |
| b:r5rp | Partial | Current live storage-list latency is low; historical 7,500-key workload and safe ordered index remain unverified.                                                |
| b:d060 | Partial | Effect sources appear in many bundles; actual duplicate output savings and shared-runtime safety remain unverified.                                              |
| b:9ya4 | Partial | Live dispatch is fast; verify long-session cost and correctness before replacing the deprecated snapshot call.                                                   |
| b:598  | Partial | Source-backed audit in `docs/native-capability-audit.md`; complete release and official-document coverage and runtime parity remain.                             |
| b:594  | Partial | Native limitations matrix in `docs/native-capability-audit.md`; verify release and runtime behavior before presenting as exhaustive.                             |

Additional user fixes: picker search focus landed in `jj:zwtuvlty`; exact quota reading timestamps in `jj:kmmwywmt`. Picker real-browser behavior remains unverified. The quota change awaits live Host restart because its client is gated.
