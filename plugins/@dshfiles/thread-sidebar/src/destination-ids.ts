/** The rail destinations' ids (docs/ade-ux §4.2). Pure data, so the Host half can validate them without the client runtime. */
export const DESTINATION_IDS = ['threads', 'inbox', 'land', 'work', 'agents', 'observe', 'knowledge', 'settings'] as const
export type DestinationId = (typeof DESTINATION_IDS)[number]
