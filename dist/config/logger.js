"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServiceLogger = exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const serviceName = process.env.SERVICE_NAME || 'rez-karma-service';
exports.logger = winston_1.default.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.errors({ stack: true }), process.env.NODE_ENV === 'production'
        ? winston_1.default.format.json()
        : winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple())),
    defaultMeta: { service: serviceName },
    transports: [new winston_1.default.transports.Console()],
});
const createServiceLogger = (name) => ({
    info: (message, meta) => exports.logger.info(message, { component: name, ...meta }),
    warn: (message, meta) => exports.logger.warn(message, { component: name, ...meta }),
    error: (message, meta) => exports.logger.error(message, { component: name, ...meta }),
    debug: (message, meta) => exports.logger.debug(message, { component: name, ...meta }),
});
exports.createServiceLogger = createServiceLogger;
//# sourceMappingURL=logger.js.map