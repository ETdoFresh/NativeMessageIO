import * as fs from 'fs';
import * as net from 'net';
import { logStdErr } from './utils/logger.js';
import { updateComponentStatus } from './state.js';
import { writeNativeMessage } from './native-messaging.js';
import { PIPE_PATH } from './config.js';
import { handleCommandString } from './commands.js';

let ipcServerInstance: net.Server | null = null;

function cleanupPipe() {
    // Only unlink Unix sockets, Windows Named Pipes don't use filesystem paths this way
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
    return new Promise((resolve) => { // Modified to always resolve
        cleanupPipe(); // Remove old socket file if it exists

        const server = net.createServer((socket) => {
            logStdErr(`IPC Client connected from ${socket.remoteAddress || 'unknown'}`);

            // Buffer to handle partial messages
            let receiveBuffer = '';

            socket.on('data', async (data) => {
                const rawChunk = data.toString('utf8');
                logStdErr(`IPC Socket Raw Data Chunk Received:`, JSON.stringify(rawChunk));
                receiveBuffer += rawChunk;
                logStdErr(`IPC Receive Buffer Content:`, JSON.stringify(receiveBuffer));

                // Don't process if the buffer is obviously empty/whitespace
                if (receiveBuffer.trim().length === 0) {
                    return;
                }

                let requestJson: any;
                try {
                    // Attempt to parse the entire buffer.
                    // If it succeeds, we assume we have one complete JSON message.
                    requestJson = JSON.parse(receiveBuffer);

                    logStdErr(`IPC Buffer parsed successfully.`);

                    // --- Process the received JSON --- 
                    let responseMessage: string;
                    if (!requestJson || typeof requestJson.message !== 'string') {
                        logStdErr('Invalid IPC request format. Expected { message: "string" } Got:', receiveBuffer);
                        responseMessage = '[ERROR] Invalid request format. Expected JSON: { "message": "string" }';
                    } else {
                        const commandString: string = requestJson.message;
                        logStdErr(`Processing IPC command: { "message": "${commandString.substring(0, 100)}..." }`);
                        responseMessage = await handleCommandString(commandString);
                    }
                    // --- End Processing --- 

                    // Send the response back
                    try {
                        // Still sending newline in response for potential client framing needs.
                        // Can be removed if client also doesn't expect it.
                        socket.write(JSON.stringify({ message: responseMessage }) + '\n');
                        logStdErr(`Sent IPC response for command.`);
                    } catch (writeError) {
                        logStdErr('Error writing response to IPC socket:', writeError);
                    }

                    // Clear the buffer assumes one message processed successfully.
                    receiveBuffer = '';
                    logStdErr(`IPC Buffer Cleared after successful parse and processing.`);

                } catch (e) {
                    // JSON.parse failed. Assume incomplete JSON object.
                    // Log the error and wait for more data.
                    if (e instanceof SyntaxError) {
                         logStdErr(`IPC Buffer content is not yet valid JSON. Waiting for more data...`);
                    } else {
                         logStdErr(`Error processing IPC buffer (other than JSON parse):`, e);
                    }
                    // Do not clear the buffer, wait for the next 'data' event.
                }
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
            ipcServerInstance = null; // Clear instance on error
            logStdErr("IPC Server failed to start, allowing main startup to proceed.");
            resolve(null); // Resolve with null to indicate failure but allow continuation
        });

        logStdErr(`Attempting to listen on IPC path: ${PIPE_PATH}`);

        server.listen(PIPE_PATH, () => {
            logStdErr(`IPC Server listening successfully on ${PIPE_PATH}`);
            ipcServerInstance = server; // Assign to module scope variable
            updateComponentStatus('ipc', 'OK');

            // Set permissions for Unix sockets
            if (process.platform !== 'win32') {
                try {
                    fs.chmodSync(PIPE_PATH, '777');
                    logStdErr(`Set permissions for socket file: ${PIPE_PATH}`);
                } catch (chmodErr) {
                     logStdErr(`Warning: Could not set permissions for socket file ${PIPE_PATH}:`, chmodErr);
                }
            }
            resolve(server); // Resolve with the server instance on success
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
            cleanupPipe(); // Clean up the pipe on close
            ipcServerInstance = null;
            callback(err);
        });
    } else {
        cleanupPipe(); // Ensure cleanup even if server wasn't running
        callback();
    }
} 