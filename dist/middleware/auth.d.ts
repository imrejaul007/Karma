import { Request, Response, NextFunction } from 'express';
declare global {
    namespace Express {
        interface Request {
            userId?: string;
            userRole?: string;
            userPermissions?: string[];
        }
    }
}
export interface AuthPayload {
    userId: string;
    role: string;
    permissions?: string[];
}
/**
 * Validates a user JWT by calling the ReZ Auth service.
 * Sets req.userId, req.userRole, and req.userPermissions on success.
 * Returns 401 if the token is missing, invalid, or the auth service is unreachable.
 */
export declare function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=auth.d.ts.map