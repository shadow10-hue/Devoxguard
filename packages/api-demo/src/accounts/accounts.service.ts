import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Collection, Filter, MongoClient } from 'mongodb';
import { env } from '../config/env';

export interface Account {
  email: string;
  password: string;
  role: 'user' | 'admin';
  apiToken: string;
}

const SEED: Account[] = [
  {
    email: 'alice@corp.test',
    password: 'correct-horse',
    role: 'user',
    apiToken: 'tok_alice_2f9c',
  },
  {
    email: 'admin@corp.test',
    password: 'sup3r-s3cret',
    role: 'admin',
    apiToken: 'tok_admin_88de',
  },
];

export interface LoginResult {
  authenticated: boolean;
  email?: string;
  role?: string;
  apiToken?: string;
}

/**
 * Backs the deliberately NoSQLi-vulnerable login endpoint. Connects to the
 * demo app's own MongoDB database (APP_MONGO_URI / APP_MONGO_DB) and seeds a
 * couple of accounts idempotently on boot.
 */
@Injectable()
export class AccountsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountsService.name);
  private client!: MongoClient;
  private accounts!: Collection<Account>;

  async onModuleInit(): Promise<void> {
    // Fail fast rather than hang for 30s if Mongo is down at boot.
    this.client = new MongoClient(env.APP_MONGO_URI, {
      serverSelectionTimeoutMS: 2000,
    });
    await this.client.connect();
    this.accounts = this.client
      .db(env.APP_MONGO_DB)
      .collection<Account>('accounts');
    await this.accounts.createIndex({ email: 1 }, { unique: true });
    // Upsert-per-email keeps seeding idempotent and safe under cluster mode
    // (multiple workers booting at once won't collide the way insertMany would).
    for (const account of SEED) {
      await this.accounts.updateOne(
        { email: account.email },
        { $setOnInsert: account },
        { upsert: true },
      );
    }
    this.logger.log(
      `Seeded ${SEED.length} demo accounts in ${env.APP_MONGO_DB}.accounts`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  /**
   * Deliberately vulnerable: `filter` is the untrusted request body, passed
   * straight into findOne. With a scalar `{ email, password }` it behaves like
   * a normal login. With operator injection — `{ email, password: { $ne: '' } }`
   * or `{ email: { $ne: null } }` — an attacker authenticates without knowing a
   * password and recovers the account's apiToken. This is what DevoxGuard's
   * NoSqlInjectionDetector blocks (see docs/injection-detection.md).
   */
  async login(filter: Record<string, unknown>): Promise<LoginResult> {
    const account = await this.accounts.findOne(filter as Filter<Account>);
    if (!account) return { authenticated: false };
    return {
      authenticated: true,
      email: account.email,
      role: account.role,
      apiToken: account.apiToken,
    };
  }
}
