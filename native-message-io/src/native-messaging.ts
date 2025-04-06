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

                        // Handle log response
                        if (messageJson.status === 'logs' && Array.isArray(messageJson.logs)) {
                           logStdErr(`Received browser logs (${messageJson.logs.length} entries). Emitting event...`);
                           // Emit an event with the logs instead of just printing
                           messageEmitter.emit('browser_logs_received', messageJson.logs);
                           // Keep logging to stderr for now as well for debugging? Optional.
                           messageJson.logs.forEach((log: any) => {
                               if (log && typeof log.timestamp === 'number' && typeof log.message === 'string') {
                                   logStdErr(`[Browser Log - ${new Date(log.timestamp).toISOString()}] ${log.message}`);
                               } else {
                                   logStdErr(`[Browser Log - Invalid Format]`, log);
                               }
                           });
                        } else {
                           // Broadcast other valid messages
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