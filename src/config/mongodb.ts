// @ts-nocheck
import mongoose from 'mongoose';
import { logger } from './logger';

export async function connectMongoDB(uri?: string): Promise<void> {
  const connectionUri = uri || process.env.MONGODB_URI;
  if (!connectionUri) {
    logger.error('[FATAL] MONGODB_URI environment variable is not set');
    process.exit(1);
  }

  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => logger.info('[MongoDB] Connected'));
  mongoose.connection.on('disconnected', () => logger.warn('[MongoDB] Disconnected'));
  mongoose.connection.on('error', (err: Error) => logger.error('[MongoDB] Error: ' + err.message));

  await mongoose.connect(connectionUri, {
    // IDX-1: Disable autoIndex in production (same pattern as monolith).
    // autoIndex=true would make every pod re-run ensureIndex() on boot,
    // stalling startup and racing on large collections. Index creation
    // is handled via one-off migration scripts in production.
    autoIndex: process.env.NODE_ENV !== 'production',
    autoCreate: process.env.NODE_ENV !== 'production',
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    heartbeatFrequencyMS: 10000,
    retryWrites: true,
    w: 'majority',
    journal: true,
  });
}

export async function disconnectMongoDB(): Promise<void> {
  await mongoose.disconnect();
}
