import * as fs from 'fs';
import * as net from 'net';
import { logStdErr } from './utils/logger.js';
import { updateComponentStatus } from './state.js';
import { writeNativeMessage, sendCommandAndWaitForResponse } from './native-messaging.js';
import { PIPE_PATH } from './config.js';

let ipcServerInstance: net.Server | null = null;

function cleanupPipe() {
    if (process.platform !== 'win32' && fs.existsSync(PIPE_PATH)) {
        try {
            fs.unlinkSync(PIPE_PATH);
            logStdErr(`Cleaned up existing socket file: ${PIPE_PATH}`);
        } catch (err) {
            logStdErr(`Error cleaning up socket file ${PIPE_PATH}:`, err);
        }
    } else if (process.platform === 'win32') {
         logStdErr(`Skipping filesystem cleanup for Windows named pipe: ${PIPE_PATH}`);
    }
}

export function startIpcServer(): Promise<net.Server | null> {
    return new Promise((resolve) => {
        cleanupPipe();

        const server = net.createServer((socket) => {
            logStdErr(`IPC Client connected from ${socket.remoteAddress || 'unknown'}`);
            let receiveBuffer = '';

            socket.on('data', async (data) => {
                const rawChunk = data.toString('utf8');
                logStdErr(`IPC Socket Raw Data Chunk Received:`, JSON.stringify(rawChunk));
                receiveBuffer += rawChunk;
                logStdErr(`IPC Receive Buffer Content:`, JSON.stringify(receiveBuffer));
                if (receiveBuffer.trim().length === 0) { return; }

                let requestJson: any;
                let responseMessage: string = '[ERROR] Initial error state'; // Default error
                let commandInteractionSuccessful = false; // Renamed for clarity

                try {
                    requestJson = JSON.parse(receiveBuffer);
                    logStdErr(`IPC Buffer parsed successfully.`);

                    if (!requestJson || typeof requestJson.message !== 'string') {
                        logStdErr('Invalid IPC request format. Expected { message: "string" } Got:', receiveBuffer);
                        responseMessage = '[ERROR] Invalid request format. Expected JSON: { "message": "string" }';
                    } else {
                        const commandString: string = requestJson.message;
                        logStdErr(`Attempting to interact with extension using command string: "${commandString.substring(0, 100)}..."`);

                        // --- Send command and wait for response from extension ---
                        try {
                            // Use the new function that sends and waits for a response
                            const extensionResponse = await sendCommandAndWaitForResponse(commandString);
                            logStdErr(`Received response from extension: ${JSON.stringify(extensionResponse)}`);
                            // Use the actual response from the extension
                            // Prepending [SUCCESS] for consistency, adjust as needed
                            responseMessage = `[SUCCESS] ${JSON.stringify(extensionResponse)}`; 
                            commandInteractionSuccessful = true; 
                        } catch (interactionError) {
                            const errorMessage = interactionError instanceof Error ? interactionError.message : String(interactionError);
                            logStdErr(`Error during interaction with extension for command "${commandString}":`, interactionError);
                            // Adjust error message
                            responseMessage = `[ERROR] Failed interaction with extension: ${errorMessage}`;
                        }
                    }
                } catch (e) {
                    if (e instanceof SyntaxError) {
                         logStdErr(`IPC Buffer content is not yet valid JSON. Waiting for more data...`);
                         // Don't send response yet, wait for more data
                         return; 
                    } else {
                         logStdErr(`Error processing IPC buffer (other than JSON parse):`, e);
                         responseMessage = `[ERROR] Internal server error processing request.`;
                    }
                }

                // Send response back to IPC client
                try {
                    // Ensure response is always JSON stringified
                    socket.write(JSON.stringify({ message: responseMessage }) + '\n'); 
                    logStdErr(`Sent IPC response.`);
                } catch (writeError) {
                    logStdErr('Error writing response to IPC socket:', writeError);
                }

                // Clear buffer only if JSON parsing was attempted (success or fail)
                receiveBuffer = ''; 
                logStdErr(`IPC Buffer Cleared after processing attempt.`);

            });

            socket.on('error', (err) => {
                logStdErr(`IPC Socket Error:`, err);
            });

            socket.on('end', () => {
                logStdErr(`IPC Client disconnected.`);
            });
        });

        server.on('error', (err: NodeJS.ErrnoException) => {
            logStdErr(`FATAL: IPC Server Error:`, err);
            if (err.code === 'EADDRINUSE') {
                logStdErr(`IPC Pipe ${PIPE_PATH} is already in use. Ensure no other instance is running or cleanup failed.`);
            }
            updateComponentStatus('ipc', `Error: ${err.code || err.message}`);
            // Still use writeNativeMessage for status updates if appropriate
            writeNativeMessage({ status: "error", message: `IPC server error: ${err.message} (Code: ${err.code})` }).catch(logStdErr); 
            ipcServerInstance = null;
            logStdErr("IPC Server failed to start, allowing main startup to proceed.");
            resolve(null);
        });
        logStdErr(`Attempting to listen on IPC path: ${PIPE_PATH}`);
        server.listen(PIPE_PATH, () => {
            logStdErr(`IPC Server listening successfully on ${PIPE_PATH}`);
            ipcServerInstance = server;
            updateComponentStatus('ipc', 'OK');
            if (process.platform !== 'win32') {
                try {
                    fs.chmodSync(PIPE_PATH, '777');
                    logStdErr(`Set permissions for socket file: ${PIPE_PATH}`);
                } catch (chmodErr) {
                     logStdErr(`Warning: Could not set permissions for socket file ${PIPE_PATH}:`, chmodErr);
                }
            }
            resolve(server);
        });
    });
}

export function getIpcServerInstance(): net.Server | null {
    return ipcServerInstance;
}

export function stopIpcServer(callback: (err?: Error) => void) {
    if (ipcServerInstance) {
        logStdErr(`Closing IPC server...`);
        ipcServerInstance.close((err) => {
            if (err) logStdErr(`Error closing IPC server:`, err);
            else logStdErr(`IPC server closed.`);
            cleanupPipe();
            ipcServerInstance = null;
            callback(err);
        });
    } else {
        cleanupPipe();
        callback();
    }
} 