import { Response, NextFunction } from 'express';
import { Request } from 'express';
/**
 * Extends requireAuth: verifies the user has an admin role.
 * Must be used after requireAuth so req.userRole is populated.
 * Returns 403 if the user is authenticated but not an admin.
 */
export declare function requireAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=adminAuth.d.ts.map