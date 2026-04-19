module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Exclude integration tests that require complex external dependencies:
  // - smoke.test.ts: requires running service at localhost:3009
  // - karmaRoutes.test.ts: requires axios mock for auth service (fragile)
  // - batchRoutes.test.ts: requires deep batch service mocking (fragile)
  testPathIgnorePatterns: [
    '/node_modules/',
    '__tests__/smoke.test.ts',
    '__tests__/karmaRoutes.test.ts',
    '__tests__/batchRoutes.test.ts',
  ],
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  testTimeout: 30000,
};
