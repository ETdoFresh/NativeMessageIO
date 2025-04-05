import * as fs from 'fs';
// import * as process from 'process'; // REMOVED - Rely on global process
import * as net from 'net'; // Import net module for IPC
import * as path from 'path'; // To handle paths consistently

// Define the path for the IPC pipe/socket
// Use different paths for different OS, ensuring the directory exists or can be created.
const PIPE_DIR = process.platform === 'win32' ? '\\\\.\\pipe\\' : '/tmp';
const PIPE_NAME = 'native-message-io-ipc-pipe';
const PIPE_PATH = process.platform === 'win32' ? path.join(PIPE_DIR, PIPE_NAME) : path.join(PIPE_DIR, `${PIPE_NAME}.sock`);

// Helper function to write message to stdout (length prefix + message) - STILL USED FOR INITIAL HANDSHAKE
function writeStdout(message: any): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const messageString = JSON.stringify(message);
            const messageBuffer = Buffer.from(messageString, 'utf8');
            const lengthBuffer = Buffer.alloc(4);
            lengthBuffer.writeUInt32LE(messageBuffer.length, 0); // Use Little Endian

            process.stdout.write(lengthBuffer, (err) => {
                if (err) return reject(err);
                process.stdout.write(messageBuffer, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        } catch(e) {
             reject(e);
        }
    });
}

// --- Stdio reading is no longer the primary communication method --- 
// The old readStdin function can be removed or commented out if not needed for any initial setup.


// --- IPC Server Logic ---
const ipcServer = net.createServer((socket) => {
    console.error(`Native Message IO (${process.pid}): IPC Client connected.`);

    socket.on('data', (data) => {
        const receivedString = data.toString('utf8').trim();
        console.error(`Native Message IO (${process.pid}): Received via IPC: ${receivedString}`);
        
        // Process the received string (e.g., log it, perform an action)
        // You could potentially send a status update back to the extension here if needed,
        // using writeStdout if the connection is still expected.

        // Example: Send confirmation back to IPC client
        socket.write(`Native host received: ${receivedString}\n`); 
    });

    socket.on('end', () => {
        console.error(`Native Message IO (${process.pid}): IPC Client disconnected.`);
    });

    socket.on('error', (err) => {
        console.error(`Native Message IO (${process.pid}): IPC Socket Error:`, err);
    });
});

ipcServer.on('error', (err) => {
    console.error(`Native Message IO (${process.pid}): IPC Server Error:`, err);
    // Try to send error via stdout if possible
    writeStdout({ status: "error", message: `IPC server error: ${err.message}`, pid: process.pid })
        .catch(stdoutErr => console.error("Failed to send IPC server error to stdout:", stdoutErr))
        .finally(() => process.exit(1)); // Exit if server fails critically
});

function cleanupPipe() {
    if (process.platform !== 'win32' && fs.existsSync(PIPE_PATH)) {
        try {
            fs.unlinkSync(PIPE_PATH);
            console.error(`Native Message IO (${process.pid}): Cleaned up existing socket file: ${PIPE_PATH}`);
        } catch (err) {
            console.error(`Native Message IO (${process.pid}): Error cleaning up socket file: ${PIPE_PATH}`, err);
        }
    }
}

async function startServer() {
    cleanupPipe(); // Remove old socket file if it exists (Linux/macOS)

    ipcServer.listen(PIPE_PATH, () => {
        console.error(`Native Message IO (${process.pid}): IPC Server listening on ${PIPE_PATH}`);
        // Send a confirmation message back to the extension via stdout
        writeStdout({ status: "ready", pid: process.pid, ipcPath: PIPE_PATH })
            .then(() => {
                console.error(`Native Message IO (${process.pid}): Sent ready signal to stdout.`);
            })
            .catch(err => {
                console.error(`Native Message IO (${process.pid}): Failed to send ready signal to stdout:`, err);
                process.exit(1); // Exit if we can't even signal readiness
            });
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.error(`Native Message IO (${process.pid}): Received SIGINT. Shutting down.`);
    ipcServer.close(() => {
        console.error(`Native Message IO (${process.pid}): IPC Server closed.`);
        cleanupPipe();
        process.exit(0);
    });
});
process.on('SIGTERM', () => {
    console.error(`Native Message IO (${process.pid}): Received SIGTERM. Shutting down.`);
     ipcServer.close(() => {
        console.error(`Native Message IO (${process.pid}): IPC Server closed.`);
        cleanupPipe();
        process.exit(0);
    });
});

// The old main() function relying on stdin is replaced by starting the server.
console.error(`Native Message IO (${process.pid}): Starting IPC server...`);
startServer();

// Keep the process alive while the server is running
// No need for process.stdin.resume() anymore unless needed for other reasons. 