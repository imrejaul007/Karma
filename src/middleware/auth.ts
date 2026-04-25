import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { authServiceUrl } from '../config';
import { redis } from '../config/redis';

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
    const payload = await validateTokenWithCache(token);

    // G-KS-C2 FIX: Validate response shape before trusting.
    // Reject if valid is false, userId is missing/not a string/empty, or role is missing.
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

/**
 * Cache key prefix for auth token validation results.
 */
const AUTH_CACHE_PREFIX = 'auth:token:';

/**
 * Cache TTL in seconds (1 minute).
 */
const AUTH_CACHE_TTL = 60;

/**
 * Validates a token against the auth service with Redis caching.
 * Results are cached for 60 seconds to reduce load on the auth service.
 *
 * @param token - The bearer token to validate
 * @returns The auth payload from the auth service
 */
async function validateTokenWithCache(token: string): Promise<AuthPayload | null> {
  // Create a SHA-256 hash of the token for the cache key (don't store raw tokens)
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const cacheKey = `${AUTH_CACHE_PREFIX}${tokenHash}`;

  try {
    // Check Redis cache first
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      // Cached result exists - return it without calling auth service
      if (cached === 'null') return null;
      return JSON.parse(cached) as AuthPayload;
    }
  } catch {
    // Redis error - proceed without cache (fall through to auth service call)
  }

  // Cache miss or Redis error - call auth service
  const response = await axios.get<AuthPayload>(
    `${authServiceUrl}/api/user/auth/validate`,
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    },
  );

  try {
    // Cache the result with 60-second TTL
    const cacheValue = response.data === null ? 'null' : JSON.stringify(response.data);
    await redis.setex(cacheKey, AUTH_CACHE_TTL, cacheValue);
  } catch {
    // Redis error - proceed without caching
  }

  return response.data;
}
