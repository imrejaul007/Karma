module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleNameMapper: {
    // ts-jest needs .js import paths mapped to .ts source files
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  testTimeout: 30000,
};
