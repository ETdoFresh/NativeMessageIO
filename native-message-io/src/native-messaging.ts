import crypto from 'crypto'; // Import crypto for UUIDs
import { logStdErr } from './utils/logger.js';
// Remove messageEmitter import if no longer needed anywhere
// import { messageEmitter } from './state.js';

// Timeout for waiting for a response from the extension (in milliseconds)
const RESPONSE_TIMEOUT_MS = 15000; 

// Interface for pending requests
interface PendingRequest {
    resolve: (value: string | PromiseLike<string>) => void;
    reject: (reason?: any) => void;
    timeout: NodeJS.Timeout;
}

// Map to store pending requests: requestId -> { resolve, reject, timeout }
const pendingRequests = new Map<string, PendingRequest>();

// Helper to send messages *to* Firefox (Native Messaging format)
export function writeNativeMessage(message: any): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const messageString = JSON.stringify(message);
            const messageBuffer = Buffer.from(messageString, 'utf8');
            const lengthBuffer = Buffer.alloc(4);
            lengthBuffer.writeUInt32LE(messageBuffer.length, 0); // Little Endian

            logStdErr(`Sending Native Message (length ${messageBuffer.length}): ${messageString.substring(0, 150)}${messageString.length > 150 ? '...' : ''}`); // Log outgoing

            process.stdout.write(lengthBuffer, (err) => {
                if (err) {
                    logStdErr(`Error writing length buffer:`, err);
                    return reject(err);
                }
                process.stdout.write(messageBuffer, (err) => {
                    if (err) {
                        logStdErr(`Error writing message buffer:`, err);
                        return reject(err);
                    }
                    resolve();
                });
            });
        } catch (e) {
            logStdErr(`Error preparing/writing Native Message:`, e);
            reject(e);
        }
    });
}

/**
 * Sends a command to the browser extension and waits for a response.
 * @param commandString The command to send.
 * @param timeoutMs Optional timeout in milliseconds. Defaults to RESPONSE_TIMEOUT_MS.
 * @returns A promise that resolves with the extension's response string or rejects on error/timeout.
 */
export function sendCommandAndWaitForResponse(commandString: string, timeoutMs: number = RESPONSE_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();

        const timeout = setTimeout(() => {
            pendingRequests.delete(requestId);
            logStdErr(`Request ${requestId} timed out after ${timeoutMs}ms.`);
            reject(new Error(`Request timed out waiting for response from extension (ID: ${requestId})`));
        }, timeoutMs);

        pendingRequests.set(requestId, { resolve, reject, timeout });

        const messageToSend = {
            type: 'commandWithResponse', // Specific type for requests needing a reply
            requestId: requestId,
            payload: commandString // Keep the payload structure flexible if needed
        };

        writeNativeMessage(messageToSend)
            .catch(err => {
                clearTimeout(timeout); // Clear timeout if sending fails
                pendingRequests.delete(requestId);
                logStdErr(`Failed to send command with request ID ${requestId}:`, err);
                reject(new Error(`Failed to send command to extension: ${err.message}`));
            });
         logStdErr(`Sent command, waiting for response with ID: ${requestId}`);
    });
}

// Listener for messages *from* Firefox (Native Messaging format)
export function listenForNativeMessages() {
    let messageQueue = Buffer.alloc(0);
    let messageLength: number | null = null;

    process.stdin.on('data', (chunk: Buffer) => {
        messageQueue = Buffer.concat([messageQueue, chunk]);

        try {
            while (true) {
                // 1. Read message length if we don't have it
                if (messageLength === null && messageQueue.length >= 4) {
                    messageLength = messageQueue.readUInt32LE(0);
                    messageQueue = messageQueue.slice(4);
                     logStdErr(`DEBUG: Read message length: ${messageLength}`);
                }

                // 2. Process message if we have length and enough data
                if (messageLength !== null && messageQueue.length >= messageLength) {
                    const messageBuffer = messageQueue.slice(0, messageLength);
                    messageQueue = messageQueue.slice(messageLength);
                    const currentMessageLength = messageLength; // Store for logging
                    messageLength = null; // Reset for next message

                    const messageString = messageBuffer.toString('utf8');
                     logStdErr(`Received Native Message (length ${currentMessageLength}): ${messageString.substring(0, 200)}${messageString.length > 200 ? '...' : ''}`);

                    try {
                        const messageJson = JSON.parse(messageString);

                        // 3. Check if it's a response to a pending request
                        if (messageJson && typeof messageJson.requestId === 'string' && pendingRequests.has(messageJson.requestId)) {
                            const pending = pendingRequests.get(messageJson.requestId);
                            if (pending) {
                                clearTimeout(pending.timeout); // Clear the timeout
                                pendingRequests.delete(messageJson.requestId); // Remove from map

                                if (messageJson.type === 'commandResponse' && messageJson.response !== undefined) {
                                     logStdErr(`Received response for ID ${messageJson.requestId}. Resolving promise.`);
                                    pending.resolve(messageJson.response); // Resolve the promise
                                } else if (messageJson.type === 'commandError' && messageJson.error !== undefined) {
                                     logStdErr(`Received error for ID ${messageJson.requestId}. Rejecting promise.`);
                                    pending.reject(new Error(`Extension error: ${messageJson.error}`)); // Reject the promise
                                } else {
                                     logStdErr(`Received message for ID ${messageJson.requestId} but missing 'response' or 'error' field, or wrong type. Rejecting.`);
                                    pending.reject(new Error(`Invalid response format from extension for request ID ${messageJson.requestId}`));
                                }
                            }
                        } else {
                            // Handle other messages (e.g., status updates, broadcasts from extension) if needed
                             logStdErr(`Received message is not a tracked response (ID: ${messageJson?.requestId}) or has no request ID. Type: ${messageJson?.type}`);
                            // TODO: Add handling for other message types if necessary
                        }

                    } catch (parseError) {
                        logStdErr(`Error parsing JSON from Native Messaging:`, parseError, `\nContent: ${messageString}`);
                    }
                } else {
                    // Not enough data for the full message yet, break and wait for more
                    if (messageLength !== null) {
                         logStdErr(`DEBUG: Have length ${messageLength}, but only ${messageQueue.length} bytes in queue. Waiting...`);
                    }
                    break;
                }
            }
        } catch (error) {
             logStdErr(`Error processing stdin data:`, error);
             // Reset state on error to avoid partial message processing
             messageQueue = Buffer.alloc(0);
             messageLength = null;
        }
    });

    process.stdin.on('end', () => {
        logStdErr(`Native Messaging STDIN stream ended. Rejecting any pending requests and exiting host process.`);
        // Reject any outstanding promises
        pendingRequests.forEach((pending, requestId) => {
            clearTimeout(pending.timeout);
            pending.reject(new Error(`Native Messaging channel closed before response received for request ID ${requestId}`));
        });
        pendingRequests.clear();
        process.exit(0); // Explicitly exit
    });

    process.stdin.on('error', (err) => {
        logStdErr(`Native Messaging STDIN error:`, err);
         // Reject any outstanding promises
         pendingRequests.forEach((pending, requestId) => {
            clearTimeout(pending.timeout);
            pending.reject(new Error(`Native Messaging channel error before response received for request ID ${requestId}: ${err.message}`));
        });
        pendingRequests.clear();
        // Optionally exit on error too
        // process.exit(1);
    });

     logStdErr(`Listening for Native Messages on STDIN... (Request/Response enabled)`);
} 