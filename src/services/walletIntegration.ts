/**
 * Wallet Integration Service — bridges Karma Service with ReZ Wallet Service
 *
 * Credits ReZ coins to users after batch conversion.
 * Uses HTTP calls to the wallet service REST API.
 */
import axios, { type AxiosInstance } from 'axios';
import { walletServiceUrl } from '../config/index.js';
import { createServiceLogger } from '../config/logger.js';
import { withRetry } from '../utils/retry.js';

const log = createServiceLogger('walletIntegration');

export interface WalletCreditParams {
  userId: string;
  amount: number;
  coinType: string;
  source: string;
  referenceId: string;
  referenceModel: string;
  description: string;
  idempotencyKey: string;
}

export interface WalletCreditResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

let walletClient: AxiosInstance | null = null;
let tokenValidated = false;

function getWalletClient(): AxiosInstance {
  // PAY-KAR-006 FIX: Validate token once at first call. Previously, if neither
  // INTERNAL_SERVICE_KEY nor INTERNAL_SERVICE_TOKEN was set, the client was
  // created with 'X-Internal-Token: undefined' (the literal string), sending a
  // forged header that downstream services would reject or ignore silently.
  if (!tokenValidated) {
    const token = process.env.INTERNAL_SERVICE_KEY || process.env.INTERNAL_SERVICE_TOKEN;
    if (!token) {
      throw new Error('INTERNAL_SERVICE_KEY / INTERNAL_SERVICE_TOKEN is not configured');
    }
    tokenValidated = true;
  }

  if (!walletClient) {
    const token = process.env.INTERNAL_SERVICE_KEY || process.env.INTERNAL_SERVICE_TOKEN;
    walletClient = axios.create({
      baseURL: walletServiceUrl,
      timeout: 10_000,
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': token,
      },
    });
  }
  return walletClient;
}

/**
 * Credit ReZ coins to a user's wallet via the Wallet Service REST API.
 *
 * @param params - Credit parameters including userId, amount, coinType, etc.
 * @returns Result with success flag, transactionId on success, or error message on failure.
 *
 * G-KS-C9 FIX: Uses /internal/credit endpoint (not /api/wallet/credit) and includes
 * X-Internal-Token header for service-to-service authentication.
 */
export async function creditUserWallet(params: WalletCreditParams): Promise<WalletCreditResult> {
  const { userId, amount, coinType, source, referenceId, referenceModel, description, idempotencyKey } = params;

  if (amount <= 0) {
    return { success: false, error: 'Amount must be positive' };
  }

  // G-KS-C9 FIX: Validate internal token is configured before making the call.
  if (!process.env.INTERNAL_SERVICE_KEY && !process.env.INTERNAL_SERVICE_TOKEN) {
    log.error('creditUserWallet: INTERNAL_SERVICE_KEY/TOKEN not configured');
    return { success: false, error: 'Internal service token not configured' };
  }

  try {
    const client = getWalletClient();
    const response = await withRetry(
      () =>
        client.post<{ success: boolean; balance: number; transactionId: string }>(
          // G-KS-C9 FIX: Use internal endpoint /internal/credit, not /api/wallet/credit.
          '/internal/credit',
          {
            userId,
            amount,
            coinType,
            source,
            description,
            idempotencyKey,
            referenceModel,
            sourceId: referenceId,
          },
        ),
      { retries: 1, delayMs: 500 },
    );

    if (response.data.success) {
      log.info('Wallet credit successful', {
        userId,
        amount,
        coinType,
        transactionId: response.data.transactionId,
      });
      return {
        success: true,
        transactionId: response.data.transactionId,
      };
    } else {
      log.warn('Wallet credit returned success=false', { userId, amount, coinType });
      return { success: false, error: 'Wallet service returned failure' };
    }
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: { message?: string } }; message?: string; code?: string };

    if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
      log.error('Wallet credit timed out', { userId, amount });
      return { success: false, error: 'Wallet service request timed out' };
    }

    const status = axiosErr.response?.status;
    const message = axiosErr.response?.data?.message ?? axiosErr.message ?? 'Unknown error';

    log.error('Wallet credit failed', { userId, amount, status, message });
    return { success: false, error: `Wallet service error (${status ?? 'N/A'}): ${message}` };
  }
}

/**
 * Get a user's ReZ coin balance from the Wallet Service.
 *
 * @param userId - User ID to query
 * @returns Balance as a number
 * @throws Error if INTERNAL_SERVICE_TOKEN is missing or wallet service call fails
 *
 * CS-CRIT-05 + CS-HIGH-03 FIX: Throws on error so callers can distinguish
 * "user has 0 karma" from "wallet service unavailable". Also sends userId in
 * params so the wallet service returns the correct user's balance.
 *
 * CROSS-PRODUCT-FIX-1: Changed coinType from 'karma_points' to canonical 'rez'.
 * batchService already credits coins as 'rez'; querying with 'karma_points'
 * would never find them, making converted karma coins appear unredeemable.
 */
export async function getKarmaBalance(userId: string): Promise<number> {
  if (!process.env.INTERNAL_SERVICE_KEY && !process.env.INTERNAL_SERVICE_TOKEN) {
    throw new Error('INTERNAL_SERVICE_KEY/TOKEN not configured');
  }

  const client = getWalletClient();
  // CS-HIGH-03 FIX: Include userId so wallet returns the correct user's balance.
  // CROSS-PRODUCT-FIX-1: Use canonical 'rez' coin type (not legacy 'karma_points').
  const response = await withRetry(
    () =>
      client.get<{ balance?: { available?: number }; coins?: Array<{ type: string; amount: number }> }>(
        '/internal/balance',
        { params: { coinType: 'rez', userId } },
      ),
    { retries: 1, delayMs: 500 },
  );

  // Try 'rez' sub-entry first (canonical coin type for karma-converted coins)
  const rezEntry = response.data.coins?.find((c) => c.type === 'rez');
  if (rezEntry) {
    return rezEntry.amount;
  }

  // Fall back to top-level balance
  return response.data.balance?.available ?? 0;
}
