import { logStdErr } from './utils/logger.js';
import { messageEmitter } from './state.js';

// Helper to send messages *to* Firefox (Native Messaging format)
export function writeNativeMessage(message: any): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const messageString = JSON.stringify(message);
            const messageBuffer = Buffer.from(messageString, 'utf8');
            const lengthBuffer = Buffer.alloc(4);
            lengthBuffer.writeUInt32LE(messageBuffer.length, 0); // Little Endian

            // Write length prefix, then message
            process.stdout.write(lengthBuffer, (err) => {
                if (err) return reject(err);
                process.stdout.write(messageBuffer, (err) => {
                    if (err) return reject(err);
                    // Avoid overly verbose logging for frequent messages if needed
                    // logStdErr(`Sent Native Message: ${messageString.substring(0, 100)}...`);
                    resolve();
                });
            });
        } catch (e) {
            logStdErr(`Error preparing/writing Native Message:`, e);
            reject(e);
        }
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
                // 1. Try reading message length if we don't have it
                if (messageLength === null && messageQueue.length >= 4) {
                    messageLength = messageQueue.readUInt32LE(0); // Little Endian
                    messageQueue = messageQueue.slice(4); // Remove length bytes
                }

                // 2. Check if we have the full message
                if (messageLength !== null && messageQueue.length >= messageLength) {
                    const messageBuffer = messageQueue.slice(0, messageLength);
                    messageQueue = messageQueue.slice(messageLength); // Remove message bytes
                    messageLength = null; // Reset for the next message

                    const messageString = messageBuffer.toString('utf8');
                    try {
                        const messageJson = JSON.parse(messageString);
                        logStdErr(`Received Native Message: ${messageString.substring(0,100)}...`);

                        // --- Event Emitter Logic ---
                        // Standardize data emission based on messageJson.status

                        switch (messageJson.status) {
                            // Console related
                            case 'console_logs': // Response for get_console_logs
                                if (Array.isArray(messageJson.logs)) {
                                    logStdErr(`Received console logs (${messageJson.logs.length}). Emitting 'console_logs_received'.`);
                                    messageEmitter.emit('console_logs_received', messageJson.logs);
                                } else { logStdErr(`Invalid 'console_logs' format:`, messageJson); }
                                break;
                            case 'console_warnings': // Response for get_console_warnings
                                if (Array.isArray(messageJson.warnings)) {
                                    logStdErr(`Received console warnings (${messageJson.warnings.length}). Emitting 'console_warnings_received'.`);
                                    messageEmitter.emit('console_warnings_received', messageJson.warnings);
                                } else { logStdErr(`Invalid 'console_warnings' format:`, messageJson); }
                                break;
                             case 'console_errors': // Response for get_console_errors
                                if (Array.isArray(messageJson.errors)) {
                                    logStdErr(`Received console errors (${messageJson.errors.length}). Emitting 'console_errors_received'.`);
                                    messageEmitter.emit('console_errors_received', messageJson.errors);
                                } else { logStdErr(`Invalid 'console_errors' format:`, messageJson); }
                                break;
                             case 'console_all': // Response for get_console_all
                                // Expecting an object like { logs: [], warnings: [], errors: [] }
                                if (messageJson.data && typeof messageJson.data === 'object') {
                                    logStdErr(`Received all console messages. Emitting 'console_all_received'.`);
                                    messageEmitter.emit('console_all_received', messageJson.data);
                                } else { logStdErr(`Invalid 'console_all' format:`, messageJson); }
                                break;
                            case 'console_cleared': // Response for clear_console
                                logStdErr(`Received console cleared confirmation. Emitting 'console_cleared_confirmation'.`);
                                messageEmitter.emit('console_cleared_confirmation');
                                break;

                            // Network related
                            case 'network_errors': // Response for get_network_errors
                                 if (Array.isArray(messageJson.errors)) {
                                    logStdErr(`Received network errors (${messageJson.errors.length}). Emitting 'network_errors_received'.`);
                                    messageEmitter.emit('network_errors_received', messageJson.errors);
                                } else { logStdErr(`Invalid 'network_errors' format:`, messageJson); }
                                break;

                            // Browser interaction
                             case 'screenshot_data': // Response for get_screenshot
                                // Assuming screenshot data is a base64 string
                                if (typeof messageJson.data === 'string') {
                                    logStdErr(`Received screenshot data. Emitting 'screenshot_received'.`);
                                    messageEmitter.emit('screenshot_received', messageJson.data);
                                } else { logStdErr(`Invalid 'screenshot_data' format:`, messageJson); }
                                break;
                            case 'selected_element_data': // Response for get_selected_element
                                // Assuming element data is an object or string representation
                                if (messageJson.data !== undefined) {
                                    logStdErr(`Received selected element data. Emitting 'selected_element_received'.`);
                                    messageEmitter.emit('selected_element_received', messageJson.data);
                                } else { logStdErr(`Invalid 'selected_element_data' format:`, messageJson); }
                                break;

                            // General / Unhandled
                            case 'error': // Handle errors sent explicitly by the extension
                                logStdErr(`Received error message from extension: ${messageJson.message || 'Unknown error'}`);
                                // Optionally emit a generic error event for the specific command waiting? Needs correlation.
                                // For now, the waiting promise will just timeout.
                                break;
                            default:
                                // Broadcast other valid messages if needed by other parts of the app
                                logStdErr(`Received unhandled message status '${messageJson.status}'. Emitting generic 'message'.`);
                                messageEmitter.emit('message', { source: 'native-messaging', data: messageJson });
                        }

                    } catch (parseError) {
                        logStdErr(`Error parsing JSON from Native Messaging:`, parseError, `\nContent: ${messageString}`);
                        writeNativeMessage({ status: "error", message: "Failed to parse incoming JSON", original: messageString }).catch(logStdErr);
                    }
                } else {
                    // Not enough data for the current message or no message length read yet
                    break;
                }
            }
        } catch (error) {
             logStdErr(`Error processing stdin data:`, error);
             messageQueue = Buffer.alloc(0); // Clear queue on error to prevent loops
             messageLength = null;
             const errorMsg = error instanceof Error ? error.message : String(error);
             writeNativeMessage({ status: "error", message: `Error processing input stream: ${errorMsg}` }).catch(logStdErr);
        }
    });

    process.stdin.on('end', () => {
        logStdErr(`Native Messaging STDIN stream ended.`);
    });

    process.stdin.on('error', (err) => {
        logStdErr(`Native Messaging STDIN error:`, err);
         writeNativeMessage({ status: "error", message: `STDIN Error: ${err.message}` }).catch(logStdErr);
    });
     logStdErr(`Listening for Native Messages on STDIN...`);
} 