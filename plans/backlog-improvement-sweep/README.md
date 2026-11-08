# Backlog improvement sweep

Resume here: continue the evidence work for the open items below. The user approved exceptional storage recovery only for a demonstrated real-world use case; no such evidence was found. Do not restart the live Host; session-list instrumentation needs a user-controlled restart before it can collect live attribution. Preserve data and do not push.

| Item   | State   | Evidence and next step                                                                                                                                    |
| ------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| b:y3h4 | Done    | Pricing service registered and tested; `jj:zuvlwqpu`. Live Host needs restart.                                                                            |
| b:bvsv | Done    | Checkout repair planner and real-JJ regression landed; `jj:olztnwqp`, `jj:uxksnrml`.                                                                      |
| b:17rs | Partial | Live list is slow; added bounded diagnostic spans in `jj:usllsyzy`. After Host restart measure actual cache misses and corpus cost before optimizing.     |
| b:z0sm | Partial | Live rapid-typing probe confirms repeated calls but not material latency; design freshness and invalidation before caching.                               |
| b:0b04 | Partial | Bulk writes rewrite one JSON document per record. No special rare-failure recovery without a demonstrated real-world need; safe batching remains open.    |
| b:r5rp | Partial | Live storage-list latency is low. Synthetic 7,500-key workload measured; ordered index freshness and mutation safety remain unverified.                   |
| b:d060 | Partial | Scratch shared-Effect supplier plus two consumers grew by 165,977 gzip bytes. Full-profile impact, runtime identity and loading safety remain unverified. |
| b:9ya4 | Partial | Live dispatch and synthetic long-session snapshots were fast. No measured basis for speculative snapshot caching.                                         |
| b:598  | Partial | Source-backed audit in `docs/native-capability-audit.md`; complete release and official-document coverage and runtime parity remain.                      |
| b:594  | Partial | Native limitations matrix in `docs/native-capability-audit.md`; verify release and runtime behavior before presenting as exhaustive.                      |

Additional user fixes: picker search focus landed in `jj:zwtuvlty`; exact quota reading timestamps in `jj:kmmwywmt`. Picker real-browser behavior remains unverified. The quota change awaits live Host restart because its client is gated.
