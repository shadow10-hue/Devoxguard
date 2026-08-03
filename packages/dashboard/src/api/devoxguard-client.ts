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

export function createDevoxGuardClient(
  baseURL: string = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000',
  apiKey: string = import.meta.env.VITE_DEVOXGUARD_API_KEY ?? '',
) {
  const http = axios.create({
    baseURL,
    headers: { 'x-devoxguard-api-key': apiKey },
  });

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
