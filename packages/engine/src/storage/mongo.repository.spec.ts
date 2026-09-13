import { Collection, Long } from 'mongodb';
import { MongoFindingRepository, StoredFinding } from './mongo.repository';

function sampleFinding(overrides: Partial<StoredFinding> = {}): StoredFinding {
  return {
    id: 'f-1',
    requestId: 'req-1',
    type: 'idor',
    severity: 'high',
    route: '/orders/:id',
    method: 'GET',
    userId: 'user-1',
    detail: 'test',
    actionTaken: 'blocked',
    timestamp: 1000,
    ...overrides,
  };
}

function mockCollection(items: StoredFinding[]) {
  const cursor = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(items),
  };

  const aggregateCursor = { toArray: jest.fn().mockResolvedValue([]) };

  return {
    createIndex: jest.fn().mockResolvedValue(undefined),
    insertMany: jest.fn().mockResolvedValue(undefined),
    estimatedDocumentCount: jest.fn().mockResolvedValue(items.length),
    findOne: jest.fn().mockImplementation((filter: { id: string }) => {
      return Promise.resolve(items.find((i) => i.id === filter.id) ?? null);
    }),
    find: jest.fn().mockReturnValue(cursor),
    countDocuments: jest.fn().mockResolvedValue(items.length),
    aggregate: jest.fn().mockReturnValue(aggregateCursor),
    cursor,
    aggregateCursor,
  } as unknown as Collection<StoredFinding> & { cursor: typeof cursor; aggregateCursor: typeof aggregateCursor };
}

describe('MongoFindingRepository', () => {
  it('ensureIndexes creates the timestamp, route+severity, type, and expiresAt TTL indexes', async () => {
    const collection = mockCollection([]);
    const repo = new MongoFindingRepository(collection);

    await repo.ensureIndexes();

    expect(collection.createIndex).toHaveBeenCalledWith({ timestamp: -1 });
    expect(collection.createIndex).toHaveBeenCalledWith({ route: 1, severity: 1 });
    expect(collection.createIndex).toHaveBeenCalledWith({ type: 1 });
    expect(collection.createIndex).toHaveBeenCalledWith({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  });

  it('insertMany is a no-op for an empty array', async () => {
    const collection = mockCollection([]);
    const repo = new MongoFindingRepository(collection);

    await repo.insertMany([]);

    expect(collection.insertMany).not.toHaveBeenCalled();
  });

  it('insertMany forwards findings to the collection, with timestamp as a BSON Long', async () => {
    // The $jsonSchema validator requires timestamp as bsonType 'long';
    // a plain JS number serializes as 'double' by default, which a live
    // schema-validated collection rejects (caught via load testing).
    const collection = mockCollection([]);
    const repo = new MongoFindingRepository(collection);
    const findings = [sampleFinding()];

    await repo.insertMany(findings);

    expect(collection.insertMany).toHaveBeenCalledTimes(1);
    const insertManyMock = collection.insertMany as unknown as jest.Mock;
    const [insertedDocs] = insertManyMock.mock.calls[0] as [Array<{ timestamp: Long }>];
    expect(insertedDocs).toHaveLength(1);
    expect(Long.isLong(insertedDocs[0].timestamp)).toBe(true);
    expect(insertedDocs[0].timestamp.toNumber()).toBe(findings[0].timestamp);
  });

  it('insertMany stamps each document with a BSON Date expiresAt, distinct from the Long timestamp, honoring the configured retention', async () => {
    const collection = mockCollection([]);
    const repo = new MongoFindingRepository(collection, 30); // 30-day retention
    const before = Date.now();

    await repo.insertMany([sampleFinding()]);

    const insertManyMock = collection.insertMany as unknown as jest.Mock;
    const [insertedDocs] = insertManyMock.mock.calls[0] as [Array<{ expiresAt: Date }>];
    const expiresAt = insertedDocs[0].expiresAt;

    expect(expiresAt).toBeInstanceOf(Date);
    const expectedMs = 30 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + expectedMs + 1000);
  });

  it('insertMany defaults retention to 90 days when none is configured', async () => {
    const collection = mockCollection([]);
    const repo = new MongoFindingRepository(collection);
    const before = Date.now();

    await repo.insertMany([sampleFinding()]);

    const insertManyMock = collection.insertMany as unknown as jest.Mock;
    const [insertedDocs] = insertManyMock.mock.calls[0] as [Array<{ expiresAt: Date }>];
    const expectedMs = 90 * 24 * 60 * 60 * 1000;
    expect(insertedDocs[0].expiresAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs);
  });

  it('findById returns the matching finding', async () => {
    const finding = sampleFinding({ id: 'f-42' });
    const collection = mockCollection([finding]);
    const repo = new MongoFindingRepository(collection);

    await expect(repo.findById('f-42')).resolves.toEqual(finding);
    await expect(repo.findById('missing')).resolves.toBeNull();
  });

  it('findPage applies filters, pagination defaults, and returns total', async () => {
    const findings = [sampleFinding({ id: 'f-1' }), sampleFinding({ id: 'f-2' })];
    const collection = mockCollection(findings);
    const repo = new MongoFindingRepository(collection);

    const result = await repo.findPage({ type: 'idor', severity: 'high' });

    expect(collection.find).toHaveBeenCalledWith({ type: 'idor', severity: 'high' });
    expect(collection.cursor.sort).toHaveBeenCalledWith({ timestamp: -1 });
    expect(collection.cursor.skip).toHaveBeenCalledWith(0);
    expect(collection.cursor.limit).toHaveBeenCalledWith(20);
    expect(result).toEqual({ items: findings, total: 2, page: 1, pageSize: 20 });
  });

  it('findPage builds a timestamp range filter and applies custom pagination', async () => {
    const collection = mockCollection([]);
    const repo = new MongoFindingRepository(collection);

    await repo.findPage({ from: 100, to: 200, page: 2, pageSize: 5 });

    expect(collection.find).toHaveBeenCalledWith({ timestamp: { $gte: 100, $lte: 200 } });
    expect(collection.cursor.skip).toHaveBeenCalledWith(5);
    expect(collection.cursor.limit).toHaveBeenCalledWith(5);
  });

  it('findPage caps the page size so a caller cannot request an unbounded dump', async () => {
    const collection = mockCollection([]);
    const repo = new MongoFindingRepository(collection);

    const result = await repo.findPage({ pageSize: 100000 });

    expect(collection.cursor.limit).toHaveBeenCalledWith(100);
    expect(result.pageSize).toBe(100);
  });

  it('findPage sanitizes NaN/negative pagination back to safe defaults', async () => {
    const collection = mockCollection([]);
    const repo = new MongoFindingRepository(collection);

    await repo.findPage({ page: Number.NaN, pageSize: -5 });

    expect(collection.cursor.skip).toHaveBeenCalledWith(0); // page clamped to 1 -> skip 0
    expect(collection.cursor.limit).toHaveBeenCalledWith(20); // pageSize clamped to default
  });

  it('countBlockedSince filters by actionTaken blocked and a minimum timestamp', async () => {
    const collection = mockCollection([]);
    const repo = new MongoFindingRepository(collection);

    await repo.countBlockedSince(1000);

    expect(collection.countDocuments).toHaveBeenCalledWith({ actionTaken: 'blocked', timestamp: { $gte: 1000 } });
  });

  it('ping returns true when the collection is reachable', async () => {
    const collection = mockCollection([]);
    const repo = new MongoFindingRepository(collection);

    await expect(repo.ping()).resolves.toBe(true);
  });

  it('ping returns false instead of throwing when the collection call rejects', async () => {
    const collection = mockCollection([]);
    (collection.estimatedDocumentCount as jest.Mock).mockRejectedValue(new Error('connection lost'));
    const repo = new MongoFindingRepository(collection);

    await expect(repo.ping()).resolves.toBe(false);
  });

  it('topRulesTriggered aggregates and maps _id to ruleName', async () => {
    const collection = mockCollection([]);
    collection.aggregateCursor.toArray.mockResolvedValueOnce([
      { _id: 'idor-orders', count: 5 },
      { _id: 'mass-assignment-users-role', count: 2 },
    ]);
    const repo = new MongoFindingRepository(collection);

    const result = await repo.topRulesTriggered(5);

    expect(result).toEqual([
      { ruleName: 'idor-orders', count: 5 },
      { ruleName: 'mass-assignment-users-role', count: 2 },
    ]);
  });
});
