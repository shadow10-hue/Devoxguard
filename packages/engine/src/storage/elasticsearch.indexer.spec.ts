import { ElasticsearchFindingIndexer, FINDINGS_INDEX_NAME } from './elasticsearch.indexer';
import { Finding } from './finding.schema';

function sampleFinding(overrides: Partial<Finding> = {}): Finding {
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

function mockClient(indexExists: boolean) {
  return {
    indices: {
      exists: jest.fn().mockResolvedValue(indexExists),
      create: jest.fn().mockResolvedValue(undefined),
    },
    index: jest.fn().mockResolvedValue(undefined),
    bulk: jest.fn().mockResolvedValue({ errors: false, items: [] }),
    ping: jest.fn().mockResolvedValue(true),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

describe('ElasticsearchFindingIndexer', () => {
  it('ensureIndex creates the index when it does not exist yet', async () => {
    const client = mockClient(false);
    const indexer = new ElasticsearchFindingIndexer(client as never);

    await indexer.ensureIndex();

    expect(client.indices.create).toHaveBeenCalledWith(
      expect.objectContaining({ index: FINDINGS_INDEX_NAME }),
    );
  });

  it('ensureIndex is a no-op when the index already exists', async () => {
    const client = mockClient(true);
    const indexer = new ElasticsearchFindingIndexer(client as never);

    await indexer.ensureIndex();

    expect(client.indices.create).not.toHaveBeenCalled();
  });

  it('index sends a single document keyed by finding.id', async () => {
    const client = mockClient(true);
    const indexer = new ElasticsearchFindingIndexer(client as never);
    const finding = sampleFinding();

    await indexer.index(finding);

    expect(client.index).toHaveBeenCalledWith(
      expect.objectContaining({ index: FINDINGS_INDEX_NAME, id: finding.id }),
    );
  });

  it('indexMany is a no-op for an empty array', async () => {
    const client = mockClient(true);
    const indexer = new ElasticsearchFindingIndexer(client as never);

    await indexer.indexMany([]);

    expect(client.bulk).not.toHaveBeenCalled();
  });

  it('indexMany sends one index action + document pair per finding', async () => {
    const client = mockClient(true);
    const indexer = new ElasticsearchFindingIndexer(client as never);
    const findings = [sampleFinding({ id: 'f-1' }), sampleFinding({ id: 'f-2' })];

    await indexer.indexMany(findings);

    const [[call]] = client.bulk.mock.calls;
    expect(call.operations).toHaveLength(4);
    expect(call.operations[0]).toEqual({ index: { _index: FINDINGS_INDEX_NAME, _id: 'f-1' } });
    expect(call.operations[2]).toEqual({ index: { _index: FINDINGS_INDEX_NAME, _id: 'f-2' } });
  });

  it('ping returns true when the client is reachable', async () => {
    const client = mockClient(true);
    const indexer = new ElasticsearchFindingIndexer(client as never);

    await expect(indexer.ping()).resolves.toBe(true);
  });

  it('ping returns false instead of throwing when the client call rejects', async () => {
    const client = mockClient(true);
    client.ping.mockRejectedValue(new Error('connection lost'));
    const indexer = new ElasticsearchFindingIndexer(client as never);

    await expect(indexer.ping()).resolves.toBe(false);
  });

  it('index rethrows on failure (devoxguard.guard.ts owns swallowing it for the client)', async () => {
    const client = mockClient(true);
    client.index.mockRejectedValue(new Error('es down'));
    const indexer = new ElasticsearchFindingIndexer(client as never);

    await expect(indexer.index(sampleFinding())).rejects.toThrow('es down');
  });

  it('indexMany rethrows when the bulk call itself rejects', async () => {
    const client = mockClient(true);
    client.bulk.mockRejectedValue(new Error('es down'));
    const indexer = new ElasticsearchFindingIndexer(client as never);

    await expect(indexer.indexMany([sampleFinding()])).rejects.toThrow('es down');
  });

  it('indexMany does not throw on a partial bulk failure — logged, not surfaced', async () => {
    const client = mockClient(true);
    client.bulk.mockResolvedValue({
      errors: true,
      items: [{ index: { error: { type: 'mapper_parsing_exception' } } }, { index: {} }],
    });
    const indexer = new ElasticsearchFindingIndexer(client as never);

    await expect(indexer.indexMany([sampleFinding({ id: 'f-1' }), sampleFinding({ id: 'f-2' })])).resolves.toBeUndefined();
  });

  it('close delegates to the underlying client', async () => {
    const client = mockClient(true);
    const indexer = new ElasticsearchFindingIndexer(client as never);

    await indexer.close();

    expect(client.close).toHaveBeenCalled();
  });
});
