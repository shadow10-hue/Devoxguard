import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ElasticsearchFindingIndexer } from '../storage/elasticsearch.indexer';
import { MongoFindingRepository } from '../storage/mongo.repository';
import { ELASTICSEARCH_INDEXER } from '../storage/tokens';

interface HealthChecks {
  mongo: boolean;
  elasticsearch: boolean;
}

/**
 * Not behind InternalApiKeyGuard: orchestrators (Docker HEALTHCHECK,
 * compose `service_healthy` conditions, load balancers) need this
 * reachable without a secret. Mirrors the storage layer's documented
 * fail-open/fail-closed split (docs/architecture.md §5): Mongo is the
 * source of truth, so an unreachable Mongo reports unhealthy; ES is a
 * secondary index, so it reports degraded-but-still-200.
 */
@Controller('devoxguard/health')
export class HealthController {
  constructor(
    private readonly repository: MongoFindingRepository,
    @Inject(ELASTICSEARCH_INDEXER) private readonly indexer: ElasticsearchFindingIndexer,
  ) {}

  @Get()
  async check(): Promise<{ status: 'ok'; checks: HealthChecks }> {
    const [mongoOk, esOk] = await Promise.all([this.repository.ping(), this.indexer.ping()]);
    const checks: HealthChecks = { mongo: mongoOk, elasticsearch: esOk };

    if (!mongoOk) {
      throw new ServiceUnavailableException({ status: 'degraded', checks });
    }
    return { status: 'ok', checks };
  }
}
