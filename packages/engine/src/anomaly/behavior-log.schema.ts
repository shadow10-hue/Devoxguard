import { RequestContext } from '../analysis/request-context';

/**
 * Minimal behavioral facts extracted from a request, decoupled from the
 * full RequestContext so the anomaly analyzers (which keep long-lived
 * in-memory state per user+route) don't hold on to request/response
 * bodies or headers.
 */
export interface BehaviorLogEntry {
  requestId: string;
  userId: string;
  route: string;
  method: string;
  timestamp: number;
  originIp: string;
  /** params.id, when the route is parameterized — used by the sequence-scan detector. */
  requestedId?: string;
}

export function behaviorLogEntryFromContext(context: RequestContext): BehaviorLogEntry | null {
  if (!context.authenticatedUser) return null;

  return {
    requestId: context.requestId,
    userId: context.authenticatedUser.id,
    route: context.route,
    method: context.method,
    timestamp: context.timestamp,
    originIp: context.originIp,
    requestedId: context.params.id,
  };
}
