import { Response, NextFunction } from 'express';
import { Request } from 'express';
import { requireAuth } from './auth';

/**
 * Extends requireAuth: verifies the user has an admin role.
 * Must be used after requireAuth so req.userRole is populated.
 * Returns 403 if the user is authenticated but not an admin.
 */
export async function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    requireAuth(req, res, (err?: unknown) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

  // G-KS-H1 FIX: Normalize role to lowercase before comparison.
  // Handles case-sensitive auth services that return mixed-case roles.
  const normalizedRole = (req.userRole ?? '').toLowerCase();
  const adminRoles = ['admin', 'superadmin'];
  if (!normalizedRole || !adminRoles.includes(normalizedRole)) {
    res.status(403).json({
      success: false,
      message: 'Admin access required',
    });
    return;
  }

  next();
}
