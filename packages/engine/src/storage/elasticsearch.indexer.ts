import type { Client } from '@elastic/elasticsearch';
import { Finding } from './finding.schema';

export const FINDINGS_INDEX_NAME = 'findings-index';

/** Elasticsearch mapping for `findings-index` (spec section 6.2). */
export const FINDINGS_INDEX_MAPPING = {
  properties: {
    id: { type: 'keyword' },
    requestId: { type: 'keyword' },
    type: { type: 'keyword' },
    severity: { type: 'keyword' },
    route: { type: 'keyword' },
    method: { type: 'keyword' },
    userId: { type: 'keyword' },
    detail: { type: 'text' },
    ruleName: { type: 'keyword' },
    actionTaken: { type: 'keyword' },
    timestamp: { type: 'date', format: 'epoch_millis' },
  },
} as const;

function toDocument(finding: Finding) {
  return {
    id: finding.id,
    requestId: finding.requestId,
    type: finding.type,
    severity: finding.severity,
    route: finding.route,
    method: finding.method,
    userId: finding.userId,
    detail: finding.detail,
    ruleName: finding.ruleName ?? null,
    actionTaken: finding.actionTaken,
    timestamp: finding.timestamp,
  };
}

export class ElasticsearchFindingIndexer {
  constructor(
    private readonly client: Client,
    private readonly indexName: string = FINDINGS_INDEX_NAME,
  ) {}

  async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.indexName });
    if (!exists) {
      await this.client.indices.create({ index: this.indexName, mappings: FINDINGS_INDEX_MAPPING });
    }
  }

  async index(finding: Finding): Promise<void> {
    await this.client.index({ index: this.indexName, id: finding.id, document: toDocument(finding) });
  }

  async indexMany(findings: Finding[]): Promise<void> {
    if (findings.length === 0) return;
    const operations = findings.flatMap((finding) => [
      { index: { _index: this.indexName, _id: finding.id } },
      toDocument(finding),
    ]);
    await this.client.bulk({ operations });
  }
}
