/** Errors the HTTP layer turns into specific status codes instead of a generic 502. */

/** The page tried to navigate (redirect, meta refresh, script) somewhere the auditor refuses to go. Maps to 400. */
export class AuditRefusedError extends Error {}
