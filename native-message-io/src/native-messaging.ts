import { logStdErr } from './utils/logger.js';
// Remove messageEmitter import if no longer needed anywhere
// import { messageEmitter } from './state.js';

// Helper to send messages *to* Firefox (Native Messaging format)
export function writeNativeMessage(message: any): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const messageString = JSON.stringify(message);
            const messageBuffer = Buffer.from(messageString, 'utf8');
            const lengthBuffer = Buffer.alloc(4);
            lengthBuffer.writeUInt32LE(messageBuffer.length, 0); // Little Endian

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
                if (messageLength === null && messageQueue.length >= 4) {
                    messageLength = messageQueue.readUInt32LE(0);
                    messageQueue = messageQueue.slice(4);
                }

                if (messageLength !== null && messageQueue.length >= messageLength) {
                    const messageBuffer = messageQueue.slice(0, messageLength);
                    messageQueue = messageQueue.slice(messageLength);
                    const currentMessageLength = messageLength; // Store for logging
                    messageLength = null;

                    const messageString = messageBuffer.toString('utf8');
                    try {
                        const messageJson = JSON.parse(messageString);
                        // Log the received message (status/data/error from extension)
                        logStdErr(`Received Native Message (length ${currentMessageLength}): ${messageString.substring(0, 200)}${messageString.length > 200 ? '...' : ''}`);

                        // --- REMOVED Event Emitter Logic --- 
                        // No need to emit specific events here anymore.
                        // Responses are handled directly by the extension.
                        // We might add logic later to forward specific statuses (like 'error')
                        // back to the original caller (e.g., IPC client) if needed.

                    } catch (parseError) {
                        logStdErr(`Error parsing JSON from Native Messaging:`, parseError, `\nContent: ${messageString}`);
                        // Consider sending an error message back *if* this host was expected to respond
                    }
                } else {
                    break;
                }
            }
        } catch (error) {
             logStdErr(`Error processing stdin data:`, error);
             messageQueue = Buffer.alloc(0);
             messageLength = null;
             // Consider sending an error message back
        }
    });

    process.stdin.on('end', () => {
        logStdErr(`Native Messaging STDIN stream ended. Exiting host process.`);
        // Explicitly exit the process to ensure cleanup
        process.exit(0);
    });

    process.stdin.on('error', (err) => {
        logStdErr(`Native Messaging STDIN error:`, err);
        // Optionally exit on error too, depending on desired behavior
        // process.exit(1);
    });
     logStdErr(`Listening for Native Messages on STDIN...`);
} 