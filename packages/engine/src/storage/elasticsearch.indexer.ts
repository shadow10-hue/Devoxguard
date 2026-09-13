import { Logger } from '@nestjs/common';
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
    matchedPattern: { type: 'keyword' },
    cwe: { type: 'keyword' },
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
    matchedPattern: finding.matchedPattern ?? null,
    cwe: finding.cwe ?? null,
    actionTaken: finding.actionTaken,
    timestamp: finding.timestamp,
  };
}

export class ElasticsearchFindingIndexer {
  private readonly logger = new Logger(ElasticsearchFindingIndexer.name);

  constructor(
    private readonly client: Client,
    private readonly indexName: string = FINDINGS_INDEX_NAME,
  ) {}

  /** Cheap reachability check for the health endpoint — never throws. */
  async ping(): Promise<boolean> {
    try {
      return await this.client.ping();
    } catch {
      return false;
    }
  }

  async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.indexName });
    if (!exists) {
      await this.client.indices.create({ index: this.indexName, mappings: FINDINGS_INDEX_MAPPING });
    }
  }

  async index(finding: Finding): Promise<void> {
    try {
      await this.client.index({ index: this.indexName, id: finding.id, document: toDocument(finding) });
    } catch (err) {
      this.logger.error(`Elasticsearch index failed for finding ${finding.id} on ${this.indexName}`, err as Error);
      throw err; // devoxguard.guard.ts's persist() still owns swallowing this for the client
    }
  }

  /** indexMany(findings) forwards to the bulk API; a partial per-document failure (some indexed, some rejected) is only visible in the response body, not the promise rejection — logged here since client code just awaits success/failure of the whole call. */
  async indexMany(findings: Finding[]): Promise<void> {
    if (findings.length === 0) return;
    const operations = findings.flatMap((finding) => [
      { index: { _index: this.indexName, _id: finding.id } },
      toDocument(finding),
    ]);
    try {
      const result = await this.client.bulk({ operations });
      if (result.errors) {
        const failed = result.items.filter((item) => item.index?.error);
        this.logger.error(
          `Elasticsearch bulk index had ${failed.length}/${findings.length} failure(s) on ${this.indexName}`,
        );
      }
    } catch (err) {
      this.logger.error(`Elasticsearch bulk index failed for ${findings.length} finding(s) on ${this.indexName}`, err as Error);
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
