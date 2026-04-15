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
      headers: { 'Content-Type': 'application/json' },
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
 * Calls: POST {walletServiceUrl}/api/wallet/credit
 * Body shape mirrors walletService.creditCoins() signature:
 *   { userId, amount, coinType, source, description, idempotencyKey, referenceModel, sourceId }
 */
export async function creditUserWallet(params: WalletCreditParams): Promise<WalletCreditResult> {
  const { userId, amount, coinType, source, referenceId, referenceModel, description, idempotencyKey } = params;

  if (amount <= 0) {
    return { success: false, error: 'Amount must be positive' };
  }

  try {
    const client = getWalletClient();
    const response = await client.post<{ success: boolean; balance: number; transactionId: string }>(
      '/api/wallet/credit',
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
 * @returns Balance as a number, or 0 on error
 *
 * Calls: GET {walletServiceUrl}/api/wallet/balance?coinType=karma_points
 */
export async function getKarmaBalance(userId: string): Promise<number> {
  try {
    const client = getWalletClient();
    const response = await client.get<{ balance?: { available?: number }; coins?: Array<{ type: string; amount: number }> }>(
      '/api/wallet/balance',
      { params: { coinType: 'karma_points' } },
    );

    // Try karma_points sub-entry first
    const karmaEntry = response.data.coins?.find((c) => c.type === 'karma_points');
    if (karmaEntry) {
      return karmaEntry.amount;
    }

    // Fall back to top-level balance
    return response.data.balance?.available ?? 0;
  } catch (err) {
    log.warn('Failed to get karma balance', { userId, error: (err as Error).message });
    return 0;
  }
}
