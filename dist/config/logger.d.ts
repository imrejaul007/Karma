import winston from 'winston';
export declare const logger: winston.Logger;
export declare const createServiceLogger: (name: string) => {
    info: (message: string, meta?: Record<string, unknown>) => winston.Logger;
    warn: (message: string, meta?: Record<string, unknown>) => winston.Logger;
    error: (message: string, meta?: Record<string, unknown>) => winston.Logger;
    debug: (message: string, meta?: Record<string, unknown>) => winston.Logger;
};
//# sourceMappingURL=logger.d.ts.map