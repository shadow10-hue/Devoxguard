import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { createDevoxGuardClient } from './devoxguard-client';

vi.mock('axios');

describe('createDevoxGuardClient', () => {
  it('creates a same-origin client with no API key or base URL baked in (AR-6)', () => {
    vi.mocked(axios.create).mockReturnValue({} as never);

    createDevoxGuardClient();

    expect(axios.create).toHaveBeenCalledWith();
  });

  it('getFinding requests the correct path and returns the response data', async () => {
    const finding = { id: 'f-1', requestContext: {} };
    const get = vi.fn().mockResolvedValue({ data: finding });
    vi.mocked(axios.create).mockReturnValue({ get } as never);

    const client = createDevoxGuardClient();
    const result = await client.getFinding('f-1');

    expect(get).toHaveBeenCalledWith('/devoxguard/api/findings/f-1');
    expect(result).toEqual(finding);
  });

  it('getFindings forwards query filters as request params', async () => {
    const get = vi.fn().mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 20 } });
    vi.mocked(axios.create).mockReturnValue({ get } as never);

    const client = createDevoxGuardClient();
    await client.getFindings({ type: 'idor', severity: 'high' });

    expect(get).toHaveBeenCalledWith('/devoxguard/api/findings', {
      params: { type: 'idor', severity: 'high' },
    });
  });
});
