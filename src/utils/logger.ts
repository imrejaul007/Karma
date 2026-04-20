// PAY-KAR-010 FIX: src/utils/logger.ts re-exports from src/config/logger.ts
// to consolidate duplicate logger definitions. All consumers import from either
// path; both now resolve to the single canonical logger in src/config/logger.ts.
export { logger, createServiceLogger } from '../config/logger.js';
