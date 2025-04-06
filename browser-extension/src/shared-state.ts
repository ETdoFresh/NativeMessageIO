// browser-extension/src/shared-state.ts

// --- Log Buffer ---
export const MAX_LOG_MESSAGES = 100;
export let consoleLogBuffer: { timestamp: number; message: string }[] = [];

/**
 * Logs a message to both the actual console and an in-memory buffer.
 * Keeps the buffer size limited to MAX_LOG_MESSAGES.
 * @param message The message string to log.
 */
export function logToBuffer(message: string): void {
    if (consoleLogBuffer.length >= MAX_LOG_MESSAGES) {
        consoleLogBuffer.shift(); // Remove the oldest message
    }
    const logEntry = { timestamp: Date.now(), message: message };
    consoleLogBuffer.push(logEntry);
    // Also log to the actual browser console for real-time debugging
    console.log(`[Buffered] ${message}`);
}
// --- End Log Buffer ---


// --- Tab State ---
let _lastCreatedTabId: number | undefined = undefined;

export function getLastCreatedTabId(): number | undefined {
    return _lastCreatedTabId;
}

export function setLastCreatedTabId(tabId: number | undefined): void {
    _lastCreatedTabId = tabId;
    // Log using the local logger
    logToBuffer(`[SharedState] Updated lastCreatedTabId: ${_lastCreatedTabId}`);
}
// --- End Tab State ---

logToBuffer("[SharedState] Module initialized."); 