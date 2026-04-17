/**
 * Wallet Integration Service — bridges Karma Service with ReZ Wallet Service
 *
 * Credits ReZ coins to users after batch conversion.
 * Uses HTTP calls to the wallet service REST API.
 */
import axios, { type AxiosInstance } from 'axios';
import { walletServiceUrl } from '../config/index.js';
import { createServiceLogger } from '../config/logger.js';

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

function getWalletClient(): AxiosInstance {
  if (!walletClient) {
    walletClient = axios.create({
      baseURL: walletServiceUrl,
      timeout: 10_000,
      headers: {
        'Content-Type': 'application/json',
        // G-KS-C9 FIX: All internal service calls must include the internal service token.
        'X-Internal-Token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
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
  if (!process.env.INTERNAL_SERVICE_TOKEN) {
    log.error('creditUserWallet: INTERNAL_SERVICE_TOKEN not configured');
    return { success: false, error: 'Internal service token not configured' };
  }

  try {
    const client = getWalletClient();
    const response = await client.post<{ success: boolean; balance: number; transactionId: string }>(
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
 * Get a user's karma_points balance from the Wallet Service.
 *
 * @param userId - User ID to query
 * @returns Balance as a number
 * @throws Error if INTERNAL_SERVICE_TOKEN is missing or wallet service call fails
 *
 * CS-CRIT-05 + CS-HIGH-03 FIX: Throws on error so callers can distinguish
 * "user has 0 karma" from "wallet service unavailable". Also sends userId in
 * params so the wallet service returns the correct user's balance.
 */
export async function getKarmaBalance(userId: string): Promise<number> {
  if (!process.env.INTERNAL_SERVICE_TOKEN) {
    throw new Error('INTERNAL_SERVICE_TOKEN not configured');
  }

  const client = getWalletClient();
  // CS-HIGH-03 FIX: Include userId so wallet returns the correct user's balance.
  const response = await client.get<{ balance?: { available?: number }; coins?: Array<{ type: string; amount: number }> }>(
    '/internal/balance',
    { params: { coinType: 'karma_points', userId } },
  );

  // Try karma_points sub-entry first
  const karmaEntry = response.data.coins?.find((c) => c.type === 'karma_points');
  if (karmaEntry) {
    return karmaEntry.amount;
  }

  // Fall back to top-level balance
  return response.data.balance?.available ?? 0;
}
