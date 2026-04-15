"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectMongoDB = connectMongoDB;
exports.disconnectMongoDB = disconnectMongoDB;
const mongoose_1 = __importDefault(require("mongoose"));
const logger_1 = require("./logger");
async function connectMongoDB(uri) {
    const connectionUri = uri || process.env.MONGODB_URI;
    if (!connectionUri) {
        console.error('[FATAL] MONGODB_URI environment variable is not set');
        process.exit(1);
    }
    mongoose_1.default.set('strictQuery', false);
    mongoose_1.default.connection.on('connected', () => logger_1.logger.info('[MongoDB] Connected'));
    mongoose_1.default.connection.on('disconnected', () => logger_1.logger.warn('[MongoDB] Disconnected'));
    mongoose_1.default.connection.on('error', (err) => logger_1.logger.error('[MongoDB] Error: ' + err.message));
    await mongoose_1.default.connect(connectionUri, {
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
async function disconnectMongoDB() {
    await mongoose_1.default.disconnect();
}
//# sourceMappingURL=mongodb.js.map