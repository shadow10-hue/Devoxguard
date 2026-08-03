import { Collection } from 'mongodb';
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

  return {
    createIndex: jest.fn().mockResolvedValue(undefined),
    insertMany: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockImplementation((filter: { id: string }) => {
      return Promise.resolve(items.find((i) => i.id === filter.id) ?? null);
    }),
    find: jest.fn().mockReturnValue(cursor),
    countDocuments: jest.fn().mockResolvedValue(items.length),
    cursor,
  } as unknown as Collection<StoredFinding> & { cursor: typeof cursor };
}

describe('MongoFindingRepository', () => {
  it('ensureIndexes creates the timestamp and route+severity indexes', async () => {
    const collection = mockCollection([]);
    const repo = new MongoFindingRepository(collection);

    await repo.ensureIndexes();

    expect(collection.createIndex).toHaveBeenCalledWith({ timestamp: -1 });
    expect(collection.createIndex).toHaveBeenCalledWith({ route: 1, severity: 1 });
  });

  it('insertMany is a no-op for an empty array', async () => {
    const collection = mockCollection([]);
    const repo = new MongoFindingRepository(collection);

    await repo.insertMany([]);

    expect(collection.insertMany).not.toHaveBeenCalled();
  });

  it('insertMany forwards findings to the collection', async () => {
    const collection = mockCollection([]);
    const repo = new MongoFindingRepository(collection);
    const findings = [sampleFinding()];

    await repo.insertMany(findings);

    expect(collection.insertMany).toHaveBeenCalledWith(findings);
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
});
