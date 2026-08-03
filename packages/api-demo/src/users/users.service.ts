import { Injectable, NotFoundException } from '@nestjs/common';
import { SeedUser, USERS } from '../seed/seed-data';

@Injectable()
export class UsersService {
  private findOrThrow(id: string): SeedUser {
    const user = USERS.find((u) => u.id === id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  /**
   * Deliberately vulnerable: returns the full stored user record,
   * including passwordHash. This is the excessive-exposure flaw
   * DevoxGuard's excessive-exposure-profile rule is meant to catch.
   */
  getProfile(id: string): SeedUser {
    return this.findOrThrow(id);
  }

  /**
   * Deliberately vulnerable: merges the entire request body into the
   * stored user record with no allow-list, letting a caller set `role`
   * or `isAdmin`. This is the mass-assignment flaw DevoxGuard's
   * mass-assignment-users rule is meant to catch.
   */
  update(id: string, patch: Record<string, unknown>): SeedUser {
    const user = this.findOrThrow(id);
    Object.assign(user, patch);
    return user;
  }
}
