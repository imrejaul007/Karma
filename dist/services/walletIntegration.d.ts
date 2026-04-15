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
export declare function creditUserWallet(params: WalletCreditParams): Promise<WalletCreditResult>;
/**
 * Get a user's karma_points balance from the Wallet Service.
 *
 * @param userId - User ID to query
 * @returns Balance as a number, or 0 on error
 *
 * Calls: GET {walletServiceUrl}/api/wallet/balance?coinType=karma_points
 */
export declare function getKarmaBalance(userId: string): Promise<number>;
//# sourceMappingURL=walletIntegration.d.ts.map