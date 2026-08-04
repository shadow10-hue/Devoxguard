import { NotFoundException } from '@nestjs/common';
import { USERS } from '../seed/seed-data';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let userOneSnapshot: (typeof USERS)[number];

  beforeEach(() => {
    service = new UsersService();
    userOneSnapshot = { ...USERS.find((u) => u.id === '1')! };
  });

  afterEach(() => {
    Object.assign(
      USERS.find((u) => u.id === '1')!,
      userOneSnapshot,
    );
  });

  it('getProfile returns the full user record including passwordHash (deliberate excessive exposure)', () => {
    const profile = service.getProfile('1');
    expect(profile).toHaveProperty('passwordHash');
  });

  it('getProfile throws NotFoundException for an unknown id', () => {
    expect(() => service.getProfile('does-not-exist')).toThrow(
      NotFoundException,
    );
  });

  it('update merges arbitrary fields including role/isAdmin (deliberate mass assignment)', () => {
    const updated = service.update('1', { role: 'admin', isAdmin: true });
    expect(updated).toMatchObject({ role: 'admin', isAdmin: true });
  });

  it('update throws NotFoundException for an unknown id', () => {
    expect(() => service.update('does-not-exist', { role: 'admin' })).toThrow(
      NotFoundException,
    );
  });
});
