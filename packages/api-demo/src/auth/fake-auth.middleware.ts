import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { ownedOrderIds, USERS } from '../seed/seed-data';

export interface RequestUser {
  id: string;
  ownedResourceIds: Record<string, string[]>;
}

declare module 'express' {
  interface Request {
    user?: RequestUser;
  }
}

/**
 * Deliberately trivial demo auth: `Authorization: Bearer <userId>` looked up
 * against the static seed. Not real auth — this exists only to make the
 * api-demo's IDOR/mass-assignment scenarios deterministic for tests.
 */
@Injectable()
export class FakeAuthMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const userId = header.slice('Bearer '.length).trim();
      const seedUser = USERS.find((u) => u.id === userId);
      if (seedUser) {
        req.user = {
          id: seedUser.id,
          ownedResourceIds: { orders: ownedOrderIds(seedUser.id) },
        };
      }
    }
    next();
  }
}
