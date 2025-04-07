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
                let responseToSend = { status: "error", message: "[ERROR] Initial error state" }; 

                try {
                    requestJson = JSON.parse(receiveBuffer);
                    logStdErr(`IPC Buffer parsed successfully.`);

                    if (!requestJson || typeof requestJson.message !== 'string') {
                        logStdErr('Invalid IPC request format. Got:', receiveBuffer);
                        responseToSend = { status: "error", message: "[ERROR] Invalid request format." };
                    } else {
                        const commandString: string = requestJson.message;
                        logStdErr(`Attempting to interact with extension: "${commandString.substring(0, 100)}..."`);
                        try {
                            const extensionResponseString = await sendCommandAndWaitForResponse(commandString);
                            logStdErr(`Received response string from extension: ${extensionResponseString}`);
                            
                            try {
                                responseToSend = JSON.parse(extensionResponseString);
                                if (typeof responseToSend?.status !== 'string' || responseToSend?.message === undefined) {
                                    logStdErr(`[IPC Server] Warning: Parsed extension response lacks expected status/message structure. Sending anyway.`);
                                } else {
                                    logStdErr(`[IPC Server] Parsed extension response successfully.`);
                                }
                            } catch (parseError) {
                                logStdErr(`[IPC Server] Error parsing extension response as JSON: ${parseError}. Response string: ${extensionResponseString}`);
                                responseToSend = { status: "error", message: "Failed to parse response from browser extension." }; 
                            }
                        } catch (interactionError) {
                            const errorMessage = interactionError instanceof Error ? interactionError.message : String(interactionError);
                            logStdErr(`Error during interaction with extension:`, interactionError);
                            responseToSend = { status: "error", message: `[ERROR] Failed interaction with extension: ${errorMessage}` };
                        }
                    }
                } catch (e) {
                    if (e instanceof SyntaxError) {
                         logStdErr(`IPC Buffer content is not yet valid JSON. Waiting...`);
                         return; 
                    } else {
                         logStdErr(`Error processing IPC buffer:`, e);
                         responseToSend = { status: "error", message: `[ERROR] Internal server error processing request.` };
                    }
                }

                try {
                    socket.write(JSON.stringify(responseToSend) + '\n'); 
                    logStdErr(`Sent IPC response: ${JSON.stringify(responseToSend)}`);
                } catch (writeError) {
                    logStdErr('Error writing response to IPC socket:', writeError);
                }

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