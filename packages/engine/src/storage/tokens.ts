/** DI tokens for the storage connections, shared between devoxguard.module.ts and any controller/service outside it that needs to inject them (e.g. HealthController). */
export const MONGO_CONNECTION = 'DEVOXGUARD_MONGO_CONNECTION';
export const ELASTICSEARCH_INDEXER = 'DEVOXGUARD_ELASTICSEARCH_INDEXER';
/** Resolves to `null` when config.redisUrl isn't set — analyzers fall back to in-memory state in that case (see devoxguard.module.ts). */
export const REDIS_CONNECTION = 'DEVOXGUARD_REDIS_CONNECTION';
