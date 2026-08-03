export interface DevoxGuardConfig {
  mongoUri: string;
  mongoDbName: string;
  elasticsearchNode: string;
  /** Checked against the x-devoxguard-api-key header on internal dashboard endpoints. */
  apiKey: string;
  rulesDirectory: string;
  tokenBucket: {
    capacity: number;
    refillRatePerSec: number;
  };
}

export const DEVOXGUARD_CONFIG = 'DEVOXGUARD_CONFIG';

export const DEFAULT_DEVOXGUARD_CONFIG: Omit<DevoxGuardConfig, 'rulesDirectory' | 'apiKey'> = {
  mongoUri: 'mongodb://localhost:27017',
  mongoDbName: 'devoxguard',
  elasticsearchNode: 'http://localhost:9200',
  tokenBucket: { capacity: 20, refillRatePerSec: 2 },
};
