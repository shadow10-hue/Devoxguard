export interface AuthenticatedUser {
  id: string;
  ownedResourceIds?: Record<string, string[]>;
}

export interface RequestContext {
  requestId: string;
  timestamp: number;
  route: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
  headers: Record<string, string | undefined>;
  authenticatedUser: AuthenticatedUser | null;
  originIp: string;
  /**
   * Populated after the route handler resolves, by
   * ResponseAnalysisInterceptor. Enables response-phase DSL rules
   * (e.g. excessive-exposure) to read `response.*` paths.
   */
  responseBody?: unknown;
}

export function buildRequestContext(raw: {
  requestId: string;
  route: string;
  method: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string | undefined>;
  originIp: string;
  authenticatedUser: AuthenticatedUser | null;
}): RequestContext {
  return {
    requestId: raw.requestId,
    timestamp: Date.now(),
    route: raw.route,
    method: raw.method.toUpperCase() as RequestContext['method'],
    params: raw.params ?? {},
    query: raw.query ?? {},
    body: (raw.body as Record<string, unknown>) ?? null,
    headers: raw.headers ?? {},
    authenticatedUser: raw.authenticatedUser,
    originIp: raw.originIp,
  };
}
