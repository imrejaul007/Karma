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
  userId: string;
  role: string;
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
    const response = await axios.post<AuthPayload>(
      `${authServiceUrl}/api/auth/verify`,
      { token },
      { timeout: 5000 },
    );

    req.userId = response.data.userId;
    req.userRole = response.data.role;
    req.userPermissions = response.data.permissions;
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
