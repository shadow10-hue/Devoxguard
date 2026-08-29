import { DynamicModule, Inject, Injectable, Logger, Module, OnModuleDestroy, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import type { MongoClient } from 'mongodb';
import Redis from 'ioredis';
import { DEVOXGUARD_CONFIG, DevoxGuardConfig } from './devoxguard-config';
import { RequestAnalysisInterceptor } from './analysis/request-analysis.interceptor';
import { redactRequestContext } from './analysis/redact-context';
import { ResponseAnalysisInterceptor } from './analysis/response-analysis.interceptor';
import { AnomalyScoreTrendTracker } from './anomaly/anomaly-score-trend.tracker';
import { EwmaFrequencyAnalyzer } from './anomaly/ewma-frequency.analyzer';
import { OriginShiftDetector } from './anomaly/origin-shift.detector';
import { SequenceScanDetector } from './anomaly/sequence-scan.detector';
import { FindingsController } from './dashboard/findings.controller';
import { HealthController } from './dashboard/health.controller';
import { MetricsController } from './dashboard/metrics.controller';
import { RulesController } from './dashboard/rules.controller';
import { StatsController } from './dashboard/stats.controller';
import { Detector } from './analysis/detectors/detector.interface';
import { SqlInjectionDetector } from './analysis/detectors/sql-injection.detector';
import { NoSqlInjectionDetector } from './analysis/detectors/nosql-injection.detector';
import { AlertNotifier } from './alerting/alert-notifier';
import { IpContainment } from './alerting/ip-containment';
import { DecisionEngine } from './guard/decision-engine';
import { DevoxGuardDeps, DevoxGuardInterceptor } from './guard/devoxguard.guard';
import { DEVOXGUARD_AUTH_RATE_LIMITER, InternalApiKeyGuard } from './guard/internal-api-key.guard';
import { TokenBucket } from './guard/rate-limiter/token-bucket';
import { RuleLoader } from './rules/rule-loader';
import { RuleRegistry } from './rules/rule-registry';
import { connectMongoFindings, MongoFindingRepository } from './storage/mongo.repository';
import { ElasticsearchFindingIndexer } from './storage/elasticsearch.indexer';
import { ELASTICSEARCH_INDEXER, MONGO_CONNECTION, REDIS_CONNECTION } from './storage/tokens';

/**
 * Closes the Mongo, Elasticsearch, and (if configured) Redis connections
 * on app shutdown. Fires via onModuleDestroy, which only runs when the
 * host app calls `app.enableShutdownHooks()` (see
 * packages/api-demo/src/main.ts).
 */
@Injectable()
class DevoxGuardShutdownService implements OnModuleDestroy {
  constructor(
    @Inject(MONGO_CONNECTION) private readonly mongoConnection: { client: MongoClient },
    @Inject(ELASTICSEARCH_INDEXER) private readonly indexer: ElasticsearchFindingIndexer,
    @Inject(REDIS_CONNECTION) private readonly redis: Redis | null,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.mongoConnection.client.close(),
      this.indexer.close(),
      this.redis?.quit() ?? Promise.resolve(),
    ]);
  }
}

/**
 * The installable NestJS module: wires the rule loader (with
 * hot-reload), the anomaly engine, the guard/decision engine, the rate
 * limiter, MongoDB + Elasticsearch persistence, and the five internal
 * dashboard endpoints (findings, rules, stats, health) together from a
 * single config object.
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
      useFactory: () => connectMongoFindings(config.mongoUri, config.mongoDbName, config.findingsRetentionDays),
    };

    const repositoryProvider: Provider = {
      provide: MongoFindingRepository,
      useFactory: (conn: Awaited<ReturnType<typeof connectMongoFindings>>) => conn.repository,
      inject: [MONGO_CONNECTION],
    };

    const elasticsearchIndexerProvider: Provider = {
      provide: ELASTICSEARCH_INDEXER,
      useFactory: async () => {
        const client = new ElasticsearchClient({
          node: config.elasticsearchNode,
          requestTimeout: 5000,
          maxRetries: 3,
          sniffOnConnectionFault: true,
        });
        const indexer = new ElasticsearchFindingIndexer(client);
        // Fail-open at startup: an unreachable ES shouldn't prevent the
        // host app from booting — but log it, rather than swallowing
        // silently, so an operator can tell indexing is disabled.
        await indexer.ensureIndex().catch((err: Error) => {
          new Logger('DevoxGuardElasticsearchConnection').warn(
            'Elasticsearch unreachable at boot — indexing disabled until the next successful reload',
            err,
          );
        });
        return indexer;
      },
    };

    const redisConnectionProvider: Provider = {
      provide: REDIS_CONNECTION,
      useFactory: (): Redis | null => {
        if (!config.redisUrl) return null;
        // maxRetriesPerRequest: 1 — a command fails fast (and the
        // analyzer-level try/catch fails open) instead of ioredis's
        // default retry storm holding up the request for seconds while
        // Redis is down.
        const client = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
        const logger = new Logger('DevoxGuardRedisConnection');
        // ioredis crashes the process on an unhandled 'error' event —
        // this listener is required, not just informative, to keep
        // Redis unavailability a fail-open degradation instead of a
        // startup/runtime crash.
        client.on('error', (err) => {
          logger.warn('Redis connection error — anomaly analyzers will fail open on affected requests', err);
        });
        return client;
      },
    };

    const ewmaAnalyzerProvider: Provider = {
      provide: EwmaFrequencyAnalyzer,
      useFactory: (redis: Redis | null) => new EwmaFrequencyAnalyzer(undefined, redis ?? undefined),
      inject: [REDIS_CONNECTION],
    };
    const sequenceScanProvider: Provider = {
      provide: SequenceScanDetector,
      useFactory: (redis: Redis | null) => new SequenceScanDetector(undefined, redis ?? undefined),
      inject: [REDIS_CONNECTION],
    };
    const originShiftProvider: Provider = {
      provide: OriginShiftDetector,
      useFactory: (redis: Redis | null) => new OriginShiftDetector(undefined, redis ?? undefined),
      inject: [REDIS_CONNECTION],
    };
    const decisionEngineProvider: Provider = { provide: DecisionEngine, useValue: new DecisionEngine() };
    const trendTrackerProvider: Provider = {
      provide: AnomalyScoreTrendTracker,
      useValue: new AnomalyScoreTrendTracker(),
    };
    const tokenBucketProvider: Provider = {
      provide: TokenBucket,
      useValue: new TokenBucket(config.tokenBucket.capacity, config.tokenBucket.refillRatePerSec),
    };

    const authRateLimiterProvider: Provider = {
      provide: DEVOXGUARD_AUTH_RATE_LIMITER,
      useValue: new TokenBucket(config.authRateLimiter.capacity, config.authRateLimiter.refillRatePerSec),
    };

    // Registration order matters: Nest runs APP_INTERCEPTOR providers'
    // pre-handler code in array order and unwinds post-handler code in
    // reverse, so ResponseAnalysisInterceptor (registered last here)
    // populates ctx.responseBody before DevoxGuardInterceptor's own
    // tap() runs, and RequestAnalysisInterceptor (registered first)
    // has already built the RequestContext before DevoxGuardInterceptor
    // reads it.
    const requestAnalysisInterceptorProvider: Provider = {
      provide: APP_INTERCEPTOR,
      useClass: RequestAnalysisInterceptor,
    };

    const responseAnalysisInterceptorProvider: Provider = {
      provide: APP_INTERCEPTOR,
      useClass: ResponseAnalysisInterceptor,
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
        redis: Redis | null,
      ) => {
        const injectionEnabled = config.injectionDetection?.enabled ?? true;
        const injectionDetectors: Detector[] = injectionEnabled
          ? [new SqlInjectionDetector(), new NoSqlInjectionDetector()]
          : [];

        const alertNotifier = new AlertNotifier(config.alerting ?? {});
        // Redis-backed when configured, so a ban is shared across every
        // instance/worker (an attacker can't dodge it by hitting another one).
        const ipContainment = config.autoContainment?.enabled
          ? new IpContainment(config.autoContainment, redis ?? undefined)
          : undefined;

        const deps: DevoxGuardDeps = {
          getRules: () => ruleRegistry.getRules(),
          getRulesFor: (methode, route) => ruleRegistry.getRulesFor(methode, route),
          ewmaAnalyzer,
          sequenceScanDetector,
          originShiftDetector,
          injectionDetectors,
          decisionEngine,
          rateLimiter: tokenBucket,
          scoreTrendTracker: trendTracker,
          alertNotifier,
          ipContainment,
          persistFindings: async (findings, ctx) => {
            // Scrub credentials (Authorization/Cookie headers, password/token
            // body fields) before the context is stored and later served
            // through the dashboard API.
            const safeCtx = redactRequestContext(ctx);
            const stored = findings.map((f) => ({ ...f, requestContext: safeCtx }));
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
        REDIS_CONNECTION,
      ],
    };

    return {
      module: DevoxGuardModule,
      controllers: [FindingsController, RulesController, StatsController, HealthController, MetricsController],
      providers: [
        configProvider,
        InternalApiKeyGuard,
        ruleRegistryProvider,
        mongoConnectionProvider,
        repositoryProvider,
        elasticsearchIndexerProvider,
        redisConnectionProvider,
        ewmaAnalyzerProvider,
        sequenceScanProvider,
        originShiftProvider,
        decisionEngineProvider,
        trendTrackerProvider,
        tokenBucketProvider,
        authRateLimiterProvider,
        DevoxGuardShutdownService,
        requestAnalysisInterceptorProvider,
        interceptorProvider,
        responseAnalysisInterceptorProvider,
      ],
      exports: [MongoFindingRepository, RuleRegistry],
    };
  }
}
