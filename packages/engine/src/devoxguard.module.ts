import { DynamicModule, Module, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import { DEVOXGUARD_CONFIG, DevoxGuardConfig } from './devoxguard-config';
import { AnomalyScoreTrendTracker } from './anomaly/anomaly-score-trend.tracker';
import { EwmaFrequencyAnalyzer } from './anomaly/ewma-frequency.analyzer';
import { OriginShiftDetector } from './anomaly/origin-shift.detector';
import { SequenceScanDetector } from './anomaly/sequence-scan.detector';
import { FindingsController } from './dashboard/findings.controller';
import { RulesController } from './dashboard/rules.controller';
import { StatsController } from './dashboard/stats.controller';
import { DecisionEngine } from './guard/decision-engine';
import { DevoxGuardDeps, DevoxGuardInterceptor } from './guard/devoxguard.guard';
import { InternalApiKeyGuard } from './guard/internal-api-key.guard';
import { TokenBucket } from './guard/rate-limiter/token-bucket';
import { RuleLoader } from './rules/rule-loader';
import { RuleRegistry } from './rules/rule-registry';
import { connectMongoFindings, MongoFindingRepository } from './storage/mongo.repository';
import { ElasticsearchFindingIndexer } from './storage/elasticsearch.indexer';

const MONGO_CONNECTION = 'DEVOXGUARD_MONGO_CONNECTION';
const ELASTICSEARCH_INDEXER = 'DEVOXGUARD_ELASTICSEARCH_INDEXER';

/**
 * The installable NestJS module: wires the rule loader (with
 * hot-reload), the anomaly engine, the guard/decision engine, the rate
 * limiter, MongoDB + Elasticsearch persistence, and the four internal
 * dashboard endpoints together from a single config object.
 */
@Module({})
export class DevoxGuardModule {
  static forRoot(config: DevoxGuardConfig): DynamicModule {
    const configProvider: Provider = { provide: DEVOXGUARD_CONFIG, useValue: config };

    const ruleRegistryProvider: Provider = {
      provide: RuleRegistry,
      useFactory: () => {
        const loader = new RuleLoader();
        const registry = new RuleRegistry(loader.loadFromDirectory(config.rulesDirectory));
        loader.watch(config.rulesDirectory, (rules) => registry.setRules(rules));
        return registry;
      },
    };

    const mongoConnectionProvider: Provider = {
      provide: MONGO_CONNECTION,
      useFactory: () => connectMongoFindings(config.mongoUri, config.mongoDbName),
    };

    const repositoryProvider: Provider = {
      provide: MongoFindingRepository,
      useFactory: (conn: Awaited<ReturnType<typeof connectMongoFindings>>) => conn.repository,
      inject: [MONGO_CONNECTION],
    };

    const elasticsearchIndexerProvider: Provider = {
      provide: ELASTICSEARCH_INDEXER,
      useFactory: async () => {
        const client = new ElasticsearchClient({ node: config.elasticsearchNode });
        const indexer = new ElasticsearchFindingIndexer(client);
        // Fail-open at startup: an unreachable ES shouldn't prevent the host app from booting.
        await indexer.ensureIndex().catch(() => undefined);
        return indexer;
      },
    };

    const ewmaAnalyzerProvider: Provider = { provide: EwmaFrequencyAnalyzer, useValue: new EwmaFrequencyAnalyzer() };
    const sequenceScanProvider: Provider = { provide: SequenceScanDetector, useValue: new SequenceScanDetector() };
    const originShiftProvider: Provider = { provide: OriginShiftDetector, useValue: new OriginShiftDetector() };
    const decisionEngineProvider: Provider = { provide: DecisionEngine, useValue: new DecisionEngine() };
    const trendTrackerProvider: Provider = {
      provide: AnomalyScoreTrendTracker,
      useValue: new AnomalyScoreTrendTracker(),
    };
    const tokenBucketProvider: Provider = {
      provide: TokenBucket,
      useValue: new TokenBucket(config.tokenBucket.capacity, config.tokenBucket.refillRatePerSec),
    };

    const interceptorProvider: Provider = {
      provide: APP_INTERCEPTOR,
      useFactory: (
        ruleRegistry: RuleRegistry,
        ewmaAnalyzer: EwmaFrequencyAnalyzer,
        sequenceScanDetector: SequenceScanDetector,
        originShiftDetector: OriginShiftDetector,
        decisionEngine: DecisionEngine,
        tokenBucket: TokenBucket,
        trendTracker: AnomalyScoreTrendTracker,
        repository: MongoFindingRepository,
        indexer: ElasticsearchFindingIndexer,
      ) => {
        const deps: DevoxGuardDeps = {
          getRules: () => ruleRegistry.getRules(),
          ewmaAnalyzer,
          sequenceScanDetector,
          originShiftDetector,
          decisionEngine,
          rateLimiter: tokenBucket,
          scoreTrendTracker: trendTracker,
          persistFindings: async (findings, ctx) => {
            const stored = findings.map((f) => ({ ...f, requestContext: ctx }));
            await Promise.all([repository.insertMany(stored), indexer.indexMany(findings)]);
          },
        };
        return new DevoxGuardInterceptor(deps);
      },
      inject: [
        RuleRegistry,
        EwmaFrequencyAnalyzer,
        SequenceScanDetector,
        OriginShiftDetector,
        DecisionEngine,
        TokenBucket,
        AnomalyScoreTrendTracker,
        MongoFindingRepository,
        ELASTICSEARCH_INDEXER,
      ],
    };

    return {
      module: DevoxGuardModule,
      controllers: [FindingsController, RulesController, StatsController],
      providers: [
        configProvider,
        InternalApiKeyGuard,
        ruleRegistryProvider,
        mongoConnectionProvider,
        repositoryProvider,
        elasticsearchIndexerProvider,
        ewmaAnalyzerProvider,
        sequenceScanProvider,
        originShiftProvider,
        decisionEngineProvider,
        trendTrackerProvider,
        tokenBucketProvider,
        interceptorProvider,
      ],
      exports: [MongoFindingRepository, RuleRegistry],
    };
  }
}
