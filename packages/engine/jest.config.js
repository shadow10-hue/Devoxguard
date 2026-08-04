/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  // Regression gate, calibrated just under current coverage
  // (92.8% stmts / 76.9% branch / 96.1% funcs / 94.4% lines). Ratchet up as
  // coverage grows; never lower without a documented reason in the PR.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 72,
      functions: 92,
      lines: 90,
    },
  },
};
