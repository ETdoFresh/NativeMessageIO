import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import path from 'path';
import * as os from 'os';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { EventEmitter } from 'events';

// MCP Imports
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// --- Configuration ---
const HTTP_PORT = process.env.NATIVE_MESSAGE_IO_PORT || 3580; // Use env var or default
const SERVER_NAME = "native-message-io-multi";
const SERVER_VERSION = "1.2.1"; // Incremented version

// --- IPC Configuration ---
// Use a FIXED name
const PIPE_NAME = 'native-message-io-ipc-pipe';

// Construct the correct path based on the platform
const PIPE_PATH = process.platform === 'win32'
    ? path.join('\\\\.\\pipe\\', PIPE_NAME) // Windows named pipe path
    : path.join(os.tmpdir(), `${PIPE_NAME}.sock`); // Unix domain socket path in /tmp

// --- Central Event Emitter ---
// Used to broadcast messages received from any source
const messageEmitter = new EventEmitter();

// --- Server Instances (declared here for access in shutdown) ---
let httpServer: http.Server | null = null;
let ipcServer: net.Server | null = null; // Restore IPC
let mcpServer: McpServer | null = null;

// --- Component Status Tracking ---
let componentStatus = {
    http: "pending",
    ipc: "pending",
    mcp: "pending", // Assuming MCP starts OK if native messaging works
    nativeMessaging: "pending"
};

// --- Logging Helper ---
/** Logs messages consistently to stderr to avoid interfering with stdout (native messaging) */
function logStdErr(message: string, ...optionalParams: any[]): void {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}][${SERVER_NAME}] ${message}`, ...optionalParams);
}

// --- Native Messaging (STDIO with Firefox) ---

// Helper to send messages *to* Firefox (Native Messaging format)
function writeNativeMessage(message: any): Promise<void> {
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
                    logStdErr(`Sent Native Message: ${messageString.substring(0, 100)}...`);
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
function listenForNativeMessages() {
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

                        // *** Handle log response ***
                        if (messageJson.status === 'logs' && Array.isArray(messageJson.logs)) {
                           logStdErr(`Received browser logs (${messageJson.logs.length} entries). Processing...`);
                           // Print logs to stderr
                           messageJson.logs.forEach((log: any) => {
                               // Basic validation of log entry structure
                               if (log && typeof log.timestamp === 'number' && typeof log.message === 'string') {
                                   logStdErr(`[Browser Log - ${new Date(log.timestamp).toISOString()}] ${log.message}`);
                               } else {
                                   logStdErr(`[Browser Log - Invalid Format]`, log);
                               }
                           });
                           // Optionally, re-emit logs via SSE or other mechanism if needed
                           // sendSseEvent('browser_logs', { source: 'native-messaging', logs: messageJson.logs });
                        } else {
                           // Broadcast other valid messages
                           messageEmitter.emit('message', { source: 'native-messaging', data: messageJson });
                        }
                        // *** End handle log response ***

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

// --- Express API Server with SSE ---
const app = express();
app.use(cors()); // Enable CORS for all origins
app.use(express.json()); // Middleware to parse JSON bodies

let sseClients: Response[] = [];

// SSE Endpoint
app.get('/events', (req: Request, res: Response) => {
    logStdErr(`SSE client connected from ${req.ip}`);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Send headers immediately

    res.write(`id: ${Date.now()}\nevent: connection\ndata: {"message": "Connected to NativeMessageIO SSE"}\n\n`);
    sseClients.push(res);

    req.on('close', () => {
        logStdErr(`SSE client disconnected from ${req.ip}`);
        sseClients = sseClients.filter(client => client !== res);
        res.end();
    });

    const keepAliveInterval = setInterval(() => {
        res.write(': keep-alive\n\n');
    }, 30000);

    res.on('finish', () => {
        clearInterval(keepAliveInterval);
    });
});

// Function to send events to all connected SSE clients
function sendSseEvent(type: string, data: any) {
    if (sseClients.length === 0) return;
    const payload = JSON.stringify(data);
    const message = `id: ${Date.now()}\nevent: ${type}\ndata: ${payload}\n\n`;
    logStdErr(`Sending SSE event '${type}' to ${sseClients.length} clients.`);
    sseClients.forEach(client => {
        try {
             client.write(message);
        } catch (error) {
             logStdErr(`Error sending SSE to a client:`, error);
        }
    });
}

// API Endpoint to receive messages (e.g., via POST)
app.post('/message', (req: Request, res: Response): void => {
    const messageData = req.body;
    if (!messageData) {
        res.status(400).json({ error: 'No message body provided' });
        return;
    }
    logStdErr(`Received API Message via POST:`, JSON.stringify(messageData).substring(0, 100) + "...");

    // *** Check for log request action ***
    if (messageData.action === 'getBrowserLogs') {
        logStdErr(`API request received to get browser logs. Sending 'get-logs' command via Native Messaging.`);
        writeNativeMessage({ command: "get-logs" })
            .then(() => {
                 res.status(202).json({ status: 'log_request_sent' }); // Accepted, processing async
            })
            .catch(err => {
                 logStdErr(`Error sending get-logs command to Native Messaging:`, err);
                 res.status(500).json({ status: 'error', message: 'Failed to send log request to browser extension.' });
            });
        return; // Don't broadcast the request itself
    }
    // *** End check for log request action ***

    // Broadcast other messages
    messageEmitter.emit('message', { source: 'api', data: messageData });
    res.status(200).json({ status: 'received', message: messageData });
});

// Basic status endpoint
app.get('/status', (req: Request, res: Response) => {
    res.json({
        status: "running",
        serverName: SERVER_NAME,
        version: SERVER_VERSION,
        pid: process.pid,
        sseClients: sseClients.length,
        uptime: process.uptime(),
        listeningOn: {
            httpPort: HTTP_PORT,
            ipcPath: PIPE_PATH
        }
    });
});

// Error Handling Middleware (Express)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logStdErr(`Express Error:`, err.stack);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// --- MCP Server (STDIO) ---

// Define MCP tool input schema
const ProcessMessageInputSchema = z.object({
    message: z.any().describe("The message content (can be any JSON structure)."),
    broadcast: z.boolean().optional().default(true).describe("Whether to broadcast this message to other listeners (SSE, Native Messaging)."),
});

// Define the MCP tool handler
async function handleProcessMessage(args: z.infer<typeof ProcessMessageInputSchema>): Promise<CallToolResult> {
    logStdErr(`Received MCP message via tool 'process_message':`, JSON.stringify(args.message).substring(0,100)+"...");
    if (args.broadcast) {
        messageEmitter.emit('message', { source: 'mcp', data: args.message });
    } else {
         logStdErr(`MCP message received but broadcast is disabled.`);
    }
    return {
        content: [{ type: "text", text: `MCP message received by ${SERVER_NAME}` }],
    };
}

function setupMcpServer() {
    try {
         mcpServer = new McpServer(
            { name: `${SERVER_NAME}-mcp`, version: SERVER_VERSION }
        );
        mcpServer.tool(
            "process_message",
            "Sends a message to the native-message-io server, optionally broadcasting it.",
            ProcessMessageInputSchema.shape,
            handleProcessMessage
        );
        const mcpTransport = new StdioServerTransport();
        mcpServer.connect(mcpTransport)
            .then(() => {
                logStdErr(`MCP Server part running on STDIN/STDOUT.`);
            })
            .catch(mcpErr => {
                 logStdErr(`FATAL: MCP Server failed to connect:`, mcpErr);
                 writeNativeMessage({ status: "error", message: `MCP Server failed: ${mcpErr.message}`}).catch(logStdErr);
                 process.exit(1);
            });
    } catch (error) {
         logStdErr(`FATAL: Failed to initialize MCP Server:`, error);
         const errorMsg = error instanceof Error ? error.message : String(error);
         writeNativeMessage({ status: "error", message: `MCP Server init failed: ${errorMsg}`}).catch(logStdErr);
         process.exit(1);
    }
}

// --- IPC Server ---
// Wrapped in Promise for startup coordination
function setupIpcServer(resolveListen: () => void, rejectListen: (err: Error) => void) {
    cleanupPipe(); // Remove old socket file if it exists (important for non-Windows)

    const server = net.createServer((socket) => {
        logStdErr(`IPC Client connected from ${socket.remoteAddress || 'unknown'}`);

        socket.on('data', (data) => {
            try {
                const messageString = data.toString('utf8');
                const messageJson = JSON.parse(messageString);
                logStdErr(`Received via IPC: ${messageString.substring(0, 100)}...`);
                // Broadcast message received via IPC
                messageEmitter.emit('message', { source: 'ipc', data: messageJson });
                socket.write(JSON.stringify({ status: "received" }) + '\n'); // Acknowledge
            } catch (e) {
                logStdErr('Error processing IPC data:', e);
                socket.write(JSON.stringify({ status: "error", message: "Failed to parse JSON" }) + '\n');
            }
        });

        socket.on('error', (err) => {
            logStdErr(`IPC Socket Error:`, err);
        });

        socket.on('end', () => {
            logStdErr(`IPC Client disconnected.`);
        });
    });

    server.on('error', (err: NodeJS.ErrnoException) => { // Add type NodeJS.ErrnoException
        logStdErr(`FATAL: IPC Server Error:`, err);
        // Add specific check for EADDRINUSE
        if (err.code === 'EADDRINUSE') {
            logStdErr(`IPC Pipe ${PIPE_PATH} is already in use. Ensure no other instance is running or cleanup failed.`);
        }
        componentStatus.ipc = "error";
        messageEmitter.emit('status', componentStatus);
        writeNativeMessage({ status: "error", message: `IPC server error: ${err.message} (Code: ${err.code})` }).catch(logStdErr);
        rejectListen(err); // Reject the startup promise
    });

    logStdErr(`Attempting to listen on IPC path: ${PIPE_PATH}`); // Log the path being used

    server.listen(PIPE_PATH, () => {
        logStdErr(`IPC Server listening successfully on ${PIPE_PATH}`);
        ipcServer = server; // Assign to outer scope variable
        componentStatus.ipc = "ok";
        messageEmitter.emit('status', componentStatus);

        // Set permissions for Unix sockets (optional but good practice)
        if (process.platform !== 'win32') {
            try {
                fs.chmodSync(PIPE_PATH, '777'); // Or more restrictive permissions like '600' or '660'
                logStdErr(`Set permissions for socket file: ${PIPE_PATH}`);
            } catch (chmodErr) {
                 logStdErr(`Warning: Could not set permissions for socket file ${PIPE_PATH}:`, chmodErr);
                 // Depending on requirements, you might want to rejectListen(chmodErr) here
            }
        }

        resolveListen(); // Resolve the startup promise
    });
}

function cleanupPipe() {
    // Only unlink Unix sockets, Windows Named Pipes don't use filesystem paths this way
    if (process.platform !== 'win32' && fs.existsSync(PIPE_PATH)) {
        try {
            fs.unlinkSync(PIPE_PATH);
            logStdErr(`Cleaned up existing socket file: ${PIPE_PATH}`);
        } catch (err) {
            logStdErr(`Error cleaning up socket file ${PIPE_PATH}:`, err);
            // Don't throw here, maybe it was already gone or permissions issue
        }
    } else if (process.platform === 'win32') {
         logStdErr(`Skipping filesystem cleanup for Windows named pipe: ${PIPE_PATH}`);
    }
}

// --- Message Broadcasting Logic ---
messageEmitter.on('message', (messagePayload: { source: string, data: any }) => {
    logStdErr(`Broadcasting message from ${messagePayload.source}...`);

    // Send to Firefox via Native Messaging (unless it was the source)
    if (messagePayload.source !== 'native-messaging') {
         writeNativeMessage({ type: "broadcast", source: messagePayload.source, data: messagePayload.data })
            .catch(err => logStdErr(`Error sending broadcast to Native Messaging:`, err));
    }

    // Send to connected SSE clients (unless it came from API - maybe avoid echo?)
    // if (messagePayload.source !== 'api') { // Or always send? Depends on use case.
        sendSseEvent('message', { source: messagePayload.source, data: messagePayload.data });
    // }

    // Send back via MCP? Less common, would require a specific outgoing MCP call or notification mechanism.
    // if (messagePayload.source !== 'mcp') {
    //   //  mcpServer?.notify(...) // Example placeholder
    // }

    // Send back via IPC? (Echo or specific response?) - currently just sends simple ack
    // if (messagePayload.source !== 'ipc') {
       // How to target specific IPC client? Need to manage sockets.
    // }
});


// --- Server Startup ---
async function startServer() {
    logStdErr(`v${SERVER_VERSION} Starting... (PID: ${process.pid})`);
    componentStatus.nativeMessaging = "listening"; // Assume if this runs, stdin is available
    listenForNativeMessages(); // Start this first

    // Start HTTP and IPC servers concurrently
    let httpReady = false;
    let ipcReady = false;

    const listenHttpPromise = new Promise<void>((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(HTTP_PORT, () => {
            logStdErr(`Express API/SSE server listening on http://localhost:${HTTP_PORT}`);
            httpServer = server; // Assign to outer scope variable
            componentStatus.http = "OK"; // Mark HTTP as OK
            httpReady = true;
            resolve();
        }).on('error', (err: NodeJS.ErrnoException) => {
            logStdErr(`FATAL: Express server error:`, err);
            const errMsg = (err && 'code' in err) ? err.code : err.message; // Check for code
            componentStatus.http = `Error: ${errMsg}`;
            writeNativeMessage({ status: "error", message: `HTTP server error: ${err.message}` }).catch(logStdErr);
            if (err.code === 'EADDRINUSE') {
                logStdErr(`*** Port ${HTTP_PORT} is already in use. Try setting NATIVE_MESSAGE_IO_PORT environment variable. ***`);
                writeNativeMessage({ status: "error", message: `Port ${HTTP_PORT} in use.` }).catch(logStdErr);
            }
            reject(err); // Reject this specific promise
        });
    });

    const listenIpcPromise = new Promise<void>((resolve, reject) => {
        setupIpcServer(() => {
            componentStatus.ipc = "OK"; // Mark IPC as OK
            ipcReady = true;
            resolve();
        }, (ipcErr) => {
            const errMsg = (ipcErr && 'code' in ipcErr) ? ipcErr.code : ipcErr.message; // Check for code
            componentStatus.ipc = `Error: ${errMsg}`;
            // Do NOT reject the main startup here, just this promise
            logStdErr("IPC Server failed to start, but continuing startup...");
            resolve(); // Resolve anyway to allow main startup to proceed
        });
    });

    // Start MCP Server Part
    try {
        setupMcpServer();
        componentStatus.mcp = "OK"; // If setupMcpServer doesn't throw/exit, assume OK
    } catch (mcpSetupError) {
        const errorMsg = mcpSetupError instanceof Error ? mcpSetupError.message : String(mcpSetupError);
        logStdErr(`FATAL: MCP setup failed during startup: ${errorMsg}`);
        componentStatus.mcp = `Error: ${errorMsg}`;
        // Allow startup to continue reporting errors
    }

    try {
        // Wait for both HTTP and IPC server attempts to finish
        await Promise.all([listenHttpPromise.catch(e => e), listenIpcPromise.catch(e => e)]);

        logStdErr(`Server startup sequence finished. Status:`, componentStatus);

        // Send ready signal IF Native Messaging is working
        // Include component status regardless of individual errors
        if (componentStatus.nativeMessaging === "listening") {
            await writeNativeMessage({
                status: "ready", // Indicate overall readiness check complete
                pid: process.pid,
                server: SERVER_NAME,
                version: SERVER_VERSION,
                components: componentStatus, // Send detailed status
                httpPort: HTTP_PORT, // Add the HTTP port
                message: "Server ready signal sent. Check component status."
            });
            logStdErr(`Sent ready signal via Native Messaging with component status and HTTP port.`);
        } else {
             logStdErr(`Native messaging not available, cannot send ready signal.`);
        }

    } catch (error) {
        // This catch block might be less likely to be hit now
        logStdErr(`FATAL: Unhandled error during server startup sequence:`, error);
        // Update status if possible
        if (!componentStatus.http.startsWith("Error")) componentStatus.http = "Error: Unknown startup failure";
        if (!componentStatus.ipc.startsWith("Error")) componentStatus.ipc = "Error: Unknown startup failure";
        process.exit(1); // Exit if the core startup sequence has a major unhandled issue
    }
    logStdErr(`All components initialized or initialization attempted.`);
}

// --- Graceful Shutdown ---
function shutdown(signal: string) {
    logStdErr(`Received ${signal}. Shutting down...`);
    messageEmitter.removeAllListeners();

    sseClients.forEach(client => client.end());
    sseClients = [];

    let httpClosed = false;
    let ipcClosed = false;
    const forcedExitTimeout = 5000; // 5 seconds

    const checkExit = () => {
        if (httpClosed && ipcClosed) { // Check both again
            logStdErr(`All servers closed. Exiting.`);
             cleanupPipe(); // Restore IPC Clean up
            process.exit(0);
        }
    };

    const forceExitTimer = setTimeout(() => {
        logStdErr(`Shutdown timeout (${forcedExitTimeout}ms) reached. Forcing exit.`);
        cleanupPipe(); // Restore IPC Clean up
        process.exit(1);
    }, forcedExitTimeout);

    // Close HTTP server
    if (httpServer) {
        logStdErr(`Closing HTTP server...`);
        httpServer.close((err) => {
            if (err) logStdErr(`Error closing HTTP server:`, err);
            else logStdErr(`HTTP server closed.`);
            httpClosed = true;
            checkExit();
        });
    } else { httpClosed = true; }

    // Restore IPC Server closing logic
    if (ipcServer) {
        logStdErr(`Closing IPC server...`);
        ipcServer.close((err) => {
            if (err) logStdErr(`Error closing IPC server:`, err);
            else logStdErr(`IPC server closed.`);
            ipcClosed = true;
            checkExit();
        });
    } else {
        ipcClosed = true; // If it never started or failed, consider it 'closed'
    }

    // If both were already null/closed, check exit immediately
    if(httpClosed && ipcClosed) {
        clearTimeout(forceExitTimer);
        checkExit();
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', (code) => {
    logStdErr(`Exiting with code ${code}`);
    // Ensure pipe is cleaned up on any exit, though shutdown should handle it
    // cleanupPipe(); // Called within shutdown now
});

// Start the server!
startServer().catch(error => {
     logStdErr(`Fatal error during top-level startup:`, error);
     process.exit(1);
}); 