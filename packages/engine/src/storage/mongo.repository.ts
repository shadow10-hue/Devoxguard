import { Logger } from '@nestjs/common';
import { Collection, Long, MongoClient } from 'mongodb';
import { RequestContext } from '../analysis/request-context';
import { Finding, FINDING_COLLECTION_VALIDATOR } from './finding.schema';

const connectLogger = new Logger('DevoxGuardMongoConnection');

export const FINDINGS_COLLECTION_NAME = 'findings';

/** A Finding as persisted, with its associated RequestContext attached for full-detail retrieval (spec section 6/9). */
export interface StoredFinding extends Finding {
  requestContext?: RequestContext;
}

export interface FindingQuery {
  type?: string;
  severity?: string;
  route?: string;
  from?: number;
  to?: number;
  page?: number;
  pageSize?: number;
}

export interface FindingsPage {
  items: StoredFinding[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RuleTriggerCount {
  ruleName: string;
  count: number;
}

const DEFAULT_PAGE_SIZE = 20;
/** Hard server-side cap on page size — a caller can't request an unbounded bulk dump of stored findings (which carry captured request context). */
const MAX_PAGE_SIZE = 100;

const DEFAULT_RETENTION_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Native `mongodb` driver only (no Mongoose) — $jsonSchema validation
 * at the DB level already covers schema enforcement, so an ORM would
 * add no validation value here, only weight.
 */
export class MongoFindingRepository {
  private readonly retentionMs: number;

  constructor(
    private readonly collection: Collection<StoredFinding>,
    retentionDays: number = DEFAULT_RETENTION_DAYS,
  ) {
    this.retentionMs = retentionDays * MS_PER_DAY;
  }

  /** Cheap reachability check for the health endpoint — never throws. */
  async ping(): Promise<boolean> {
    try {
      await this.collection.estimatedDocumentCount();
      return true;
    } catch {
      return false;
    }
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ timestamp: -1 });
    await this.collection.createIndex({ route: 1, severity: 1 });
    await this.collection.createIndex({ type: 1 });
    // expireAfterSeconds: 0 — expiresAt is already the exact expiry
    // instant (computed at insert time as now + retention), not a
    // duration to add on top.
    await this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }

  async insertMany(findings: StoredFinding[]): Promise<void> {
    if (findings.length === 0) return;
    // The $jsonSchema validator requires timestamp as BSON `long`, but a
    // plain JS number (Date.now()) serializes as BSON `double` by
    // default — discovered by actually inserting against a live,
    // schema-validated collection during load testing (mocked unit
    // tests never exercise real BSON serialization). Convert only at
    // this persistence boundary so the rest of the codebase keeps using
    // plain numbers.
    const documents = findings.map((finding) => ({
      ...finding,
      timestamp: Long.fromNumber(finding.timestamp),
      expiresAt: new Date(Date.now() + this.retentionMs),
    }));
    await this.collection.insertMany(documents as unknown as StoredFinding[]);
  }

  async findById(id: string): Promise<StoredFinding | null> {
    return this.collection.findOne({ id });
  }

  async findPage(query: FindingQuery): Promise<FindingsPage> {
    const filter: Record<string, unknown> = {};
    if (query.type) filter.type = query.type;
    if (query.severity) filter.severity = query.severity;
    if (query.route) filter.route = query.route;
    if (query.from !== undefined || query.to !== undefined) {
      filter.timestamp = {
        ...(query.from !== undefined ? { $gte: query.from } : {}),
        ...(query.to !== undefined ? { $lte: query.to } : {}),
      };
    }

    // Sanitize pagination: reject NaN/negative/oversized values a caller
    // could pass via the raw query string, and cap the page size so no
    // single request can dump the whole collection.
    const page = Number.isFinite(query.page) && (query.page as number) >= 1 ? Math.floor(query.page as number) : 1;
    const requestedPageSize =
      Number.isFinite(query.pageSize) && (query.pageSize as number) >= 1
        ? Math.floor(query.pageSize as number)
        : DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(requestedPageSize, MAX_PAGE_SIZE);

    const [items, total] = await Promise.all([
      this.collection
        .find(filter)
        .sort({ timestamp: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      this.collection.countDocuments(filter),
    ]);

    return { items, total, page, pageSize };
  }

  /** Count of findings with actionTaken 'blocked' since the given timestamp — backs stats/overview's blockedLast24h. */
  async countBlockedSince(sinceTimestamp: number): Promise<number> {
    return this.collection.countDocuments({ actionTaken: 'blocked', timestamp: { $gte: sinceTimestamp } });
  }

  /** Top `limit` DSL rules by trigger count — backs stats/overview's topRulesTriggered. */
  async topRulesTriggered(limit = 5): Promise<RuleTriggerCount[]> {
    const results = await this.collection
      .aggregate<{ _id: string; count: number }>([
        { $match: { ruleName: { $exists: true, $ne: null } } },
        { $group: { _id: '$ruleName', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ])
      .toArray();

    return results.map((r) => ({ ruleName: r._id, count: r.count }));
  }
}

/**
 * Ordinary container-startup races (Mongo not quite ready yet even though
 * its own healthcheck-gated `depends_on` already passed) get absorbed
 * here instead of one-shot-crashing the host app. This is defense in
 * depth, not the primary mechanism — deployments should still gate
 * startup on Mongo's healthcheck. Still fail-closed overall: after the
 * retries are exhausted, the error propagates and boot fails, per
 * docs/architecture.md §5's documented policy.
 */
async function connectWithRetry(client: MongoClient, retries = 5, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await client.connect();
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      connectLogger.warn(`Mongo connect attempt ${attempt}/${retries} failed, retrying in ${delayMs}ms`, err as Error);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** Connects to Mongo, creates the validated `findings` collection if it doesn't exist yet (or re-syncs an existing collection's validator to the current schema), and ensures its indexes. */
export async function connectMongoFindings(
  uri: string,
  dbName: string,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): Promise<{ client: MongoClient; repository: MongoFindingRepository }> {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 20000,
    maxPoolSize: 20,
    retryWrites: true,
  });
  await connectWithRetry(client);
  const db = client.db(dbName);

  const existing = await db.listCollections({ name: FINDINGS_COLLECTION_NAME }).toArray();
  if (existing.length === 0) {
    await db.createCollection(FINDINGS_COLLECTION_NAME, { validator: FINDING_COLLECTION_VALIDATOR });
  } else {
    // The collection keeps whatever validator it was created with, so a schema
    // change (e.g. new FindingType values) would otherwise never reach an
    // existing database — Mongo would silently reject the new documents and
    // persist() would swallow the error. Re-apply the current validator so an
    // upgrade in place stays in sync. Best-effort: if the app's Mongo user
    // lacks the privilege for collMod, log and continue with the stale
    // validator (degraded, but no worse than before) rather than fail boot.
    await db
      .command({ collMod: FINDINGS_COLLECTION_NAME, validator: FINDING_COLLECTION_VALIDATOR })
      .catch((err: Error) =>
        connectLogger.warn(
          'Could not update the findings-collection validator to the current schema — ' +
            'new finding types may be rejected until this is applied manually',
          err,
        ),
      );
  }

  const collection = db.collection<StoredFinding>(FINDINGS_COLLECTION_NAME);
  const repository = new MongoFindingRepository(collection, retentionDays);
  await repository.ensureIndexes();

  return { client, repository };
}
