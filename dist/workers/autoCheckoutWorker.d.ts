/** Grace period after event end time before auto-checkout fires (1 hour). */
export declare const AUTO_CHECKOUT_GRACE_MS: number;
/** Notification title for auto-checkout. */
export declare const AUTO_CHECKOUT_NOTIFICATION_TITLE = "Auto check-out recorded";
export declare const AUTO_CHECKOUT_NOTIFICATION_BODY = "We recorded your check-out automatically. An NGO will verify your attendance.";
export interface AutoCheckoutResult {
    processed: number;
    checkedOut: number;
    skipped: number;
    errors: string[];
}
/**
 * Scan all active bookings with no check-out and process those whose
 * event has ended beyond the grace period.
 */
export declare function processForgottenCheckouts(): Promise<AutoCheckoutResult>;
/**
 * Start the auto-checkout cron job.
 * Runs every hour at minute 0.
 *
 * @param onComplete  Optional callback fired after each run with the result.
 */
export declare function startAutoCheckoutWorker(onComplete?: (result: AutoCheckoutResult) => void): void;
/**
 * Stop the auto-checkout cron job gracefully.
 */
export declare function stopAutoCheckoutWorker(): void;
//# sourceMappingURL=autoCheckoutWorker.d.ts.map