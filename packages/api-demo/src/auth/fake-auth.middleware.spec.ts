import { FakeAuthMiddleware, RequestUser } from './fake-auth.middleware';

interface MinimalRequest {
  headers: { authorization?: string };
  user?: RequestUser;
}

describe('FakeAuthMiddleware', () => {
  let middleware: FakeAuthMiddleware;

  beforeEach(() => {
    middleware = new FakeAuthMiddleware();
  });

  it('populates req.user with owned order ids for a known bearer id', () => {
    const req: MinimalRequest = { headers: { authorization: 'Bearer 1' } };
    const next = jest.fn();

    middleware.use(req as never, {} as never, next);

    expect(req.user).toEqual({
      id: '1',
      ownedResourceIds: { orders: ['1', '2', '10', '11', '12', '13', '14'] },
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('leaves req.user undefined when the authorization header is missing', () => {
    const req: MinimalRequest = { headers: {} };
    const next = jest.fn();

    middleware.use(req as never, {} as never, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('leaves req.user undefined for an unknown bearer id', () => {
    const req: MinimalRequest = { headers: { authorization: 'Bearer 999' } };
    const next = jest.fn();

    middleware.use(req as never, {} as never, next);

    expect(req.user).toBeUndefined();
  });
});
