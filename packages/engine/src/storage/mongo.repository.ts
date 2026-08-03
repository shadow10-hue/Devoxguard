import { Collection, Long, MongoClient } from 'mongodb';
import { RequestContext } from '../analysis/request-context';
import { Finding, FINDING_COLLECTION_VALIDATOR } from './finding.schema';

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

/**
 * Native `mongodb` driver only (no Mongoose) — $jsonSchema validation
 * at the DB level already covers schema enforcement, so an ORM would
 * add no validation value here, only weight.
 */
export class MongoFindingRepository {
  constructor(private readonly collection: Collection<StoredFinding>) {}

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ timestamp: -1 });
    await this.collection.createIndex({ route: 1, severity: 1 });
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
    const documents = findings.map((finding) => ({ ...finding, timestamp: Long.fromNumber(finding.timestamp) }));
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

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

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

/** Connects to Mongo, creates the validated `findings` collection if it doesn't exist yet, and ensures its indexes. */
export async function connectMongoFindings(
  uri: string,
  dbName: string,
): Promise<{ client: MongoClient; repository: MongoFindingRepository }> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const existing = await db.listCollections({ name: FINDINGS_COLLECTION_NAME }).toArray();
  if (existing.length === 0) {
    await db.createCollection(FINDINGS_COLLECTION_NAME, { validator: FINDING_COLLECTION_VALIDATOR });
  }

  const collection = db.collection<StoredFinding>(FINDINGS_COLLECTION_NAME);
  const repository = new MongoFindingRepository(collection);
  await repository.ensureIndexes();

  return { client, repository };
}
