import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { authServiceUrl } from '../config';

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
  valid: boolean;
  userId?: string;
  role?: string;
  merchantId?: string;
  permissions?: string[];
}

/**
 * Validates a user JWT by calling the ReZ Auth service.
 * Sets req.userId, req.userRole, and req.userPermissions on success.
 * Returns 401 if the token is missing, invalid, or the auth service is unreachable.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'No token provided' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const response = await axios.get<AuthPayload>(
      `${authServiceUrl}/api/user/auth/validate`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      },
    );

    // G-KS-C2 FIX: Validate response shape before trusting.
    // Reject if valid is false, userId is missing/not a string/empty, or role is missing.
    const payload = response.data;
    if (
      !payload ||
      payload.valid !== true ||
      typeof payload.userId !== 'string' ||
      payload.userId.length === 0 ||
      typeof payload.role !== 'string'
    ) {
      res.status(401).json({ success: false, message: 'Invalid token' });
      return;
    }

    req.userId = payload.userId;
    req.userRole = payload.role;
    req.userPermissions = Array.isArray(payload.permissions) ? payload.permissions : undefined;
    next();
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string };
    if (axiosErr.response?.status === 401) {
      res.status(401).json({ success: false, message: 'Invalid token' });
      return;
    }
    res.status(503).json({
      success: false,
      message: 'Authentication service unavailable',
    });
  }
}
