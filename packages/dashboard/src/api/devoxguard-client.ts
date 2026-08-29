import axios from 'axios';

export interface Finding {
  id: string;
  requestId: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  route: string;
  method: string;
  userId: string | null;
  detail: string;
  ruleName?: string;
  actionTaken: 'blocked' | 'logged' | 'rate-limited';
  timestamp: number;
}

export interface RequestContext {
  requestId: string;
  timestamp: number;
  route: string;
  method: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
  headers: Record<string, string | undefined>;
  authenticatedUser: { id: string; ownedResourceIds?: Record<string, string[]> } | null;
  originIp: string;
}

export interface FindingsPage {
  items: Finding[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FindingsQuery {
  type?: string;
  severity?: string;
  route?: string;
  from?: number;
  to?: number;
  page?: number;
  pageSize?: number;
}

export interface CompiledRule {
  nom: string;
  route: string;
  methode: string;
  action: 'bloquer' | 'journaliser';
  severite: 'low' | 'medium' | 'high';
  raw: string;
}

export interface OverviewStats {
  blockedLast24h: number;
  topRulesTriggered: { ruleName: string; count: number }[];
  averageAnomalyScoreTrend: { timestamp: number; score: number }[];
}

/**
 * Same-origin client (AR-6, resolved): no API key or base URL is read from
 * the browser bundle. In production, nginx reverse-proxies
 * /devoxguard/api/* to the backend and injects the real key server-side
 * (see nginx.conf.template); in dev, vite.config.ts's server.proxy does
 * the same against a Node-side-only key.
 */
export function createDevoxGuardClient() {
  const http = axios.create();

  return {
    async getFindings(query: FindingsQuery = {}): Promise<FindingsPage> {
      const res = await http.get<FindingsPage>('/devoxguard/api/findings', { params: query });
      return res.data;
    },
    async getFinding(id: string): Promise<Finding & { requestContext: RequestContext }> {
      const res = await http.get<Finding & { requestContext: RequestContext }>(`/devoxguard/api/findings/${id}`);
      return res.data;
    },
    async getRules(): Promise<CompiledRule[]> {
      const res = await http.get<CompiledRule[]>('/devoxguard/api/rules');
      return res.data;
    },
    async getOverview(): Promise<OverviewStats> {
      const res = await http.get<OverviewStats>('/devoxguard/api/stats/overview');
      return res.data;
    },
  };
}

export const devoxguardClient = createDevoxGuardClient();
