import * as fs from 'fs';
import * as http from 'http';
import path from 'path';
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
const SERVER_VERSION = "1.1.0";

// --- Central Event Emitter ---
// Used to broadcast messages received from any source
const messageEmitter = new EventEmitter();

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
                    console.error(`[${SERVER_NAME}] Sent Native Message: ${messageString.substring(0, 100)}...`);
                    resolve();
                });
            });
        } catch (e) {
            console.error(`[${SERVER_NAME}] Error preparing/writing Native Message:`, e);
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
                        console.error(`[${SERVER_NAME}] Received Native Message: ${messageString.substring(0,100)}...`);
                        // Broadcast the received message
                        messageEmitter.emit('message', { source: 'native-messaging', data: messageJson });
                    } catch (parseError) {
                        console.error(`[${SERVER_NAME}] Error parsing JSON from Native Messaging:`, parseError, `\nContent: ${messageString}`);
                        writeNativeMessage({ status: "error", message: "Failed to parse incoming JSON", original: messageString }).catch(console.error);
                    }
                } else {
                    // Not enough data for the current message or no message length read yet
                    break;
                }
            }
        } catch (error) {
             console.error(`[${SERVER_NAME}] Error processing stdin data:`, error);
             messageQueue = Buffer.alloc(0); // Clear queue on error to prevent loops
             messageLength = null;
             writeNativeMessage({ status: "error", message: `Error processing input stream: ${error instanceof Error ? error.message : error}` }).catch(console.error);
        }
    });

    process.stdin.on('end', () => {
        console.error(`[${SERVER_NAME}] Native Messaging STDIN stream ended.`);
        // Handle cleanup if necessary
    });

    process.stdin.on('error', (err) => {
        console.error(`[${SERVER_NAME}] Native Messaging STDIN error:`, err);
         writeNativeMessage({ status: "error", message: `STDIN Error: ${err.message}` }).catch(console.error);
         // Potentially exit or try to recover
    });
     console.error(`[${SERVER_NAME}] Listening for Native Messages on STDIN...`);
}

// --- Express API Server with SSE ---
const app = express();
app.use(cors()); // Enable CORS for all origins
app.use(express.json()); // Middleware to parse JSON bodies

let sseClients: Response[] = [];

// SSE Endpoint
app.get('/events', (req: Request, res: Response) => {
    console.error(`[${SERVER_NAME}] SSE client connected from ${req.ip}`);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Send headers immediately

    // Send a connection confirmation event
    res.write(`id: ${Date.now()}\nevent: connection\ndata: {"message": "Connected to NativeMessageIO SSE"}\n\n`);

    sseClients.push(res);

    req.on('close', () => {
        console.error(`[${SERVER_NAME}] SSE client disconnected from ${req.ip}`);
        sseClients = sseClients.filter(client => client !== res);
        res.end();
    });

    // Keep connection alive (some proxies might close idle connections)
    const keepAliveInterval = setInterval(() => {
        res.write(': keep-alive\n\n');
    }, 30000); // Send comment every 30 seconds

    res.on('finish', () => {
        clearInterval(keepAliveInterval);
    });
});

// Function to send events to all connected SSE clients
function sendSseEvent(type: string, data: any) {
    if (sseClients.length === 0) return;

    const payload = JSON.stringify(data);
    const message = `id: ${Date.now()}\nevent: ${type}\ndata: ${payload}\n\n`;

    console.error(`[${SERVER_NAME}] Sending SSE event '${type}' to ${sseClients.length} clients.`);
    sseClients.forEach(client => {
        try {
             client.write(message);
        } catch (error) {
             console.error(`[${SERVER_NAME}] Error sending SSE to a client:`, error);
             // Optionally remove the client if sending fails permanently
        }

    });
}

// API Endpoint to receive messages (e.g., via POST)
app.post('/message', (req: Request, res: Response): void => {
    const messageData = req.body;
    if (!messageData) {
        // Send response and return
        res.status(400).json({ error: 'No message body provided' });
        return;
    }
    console.error(`[${SERVER_NAME}] Received API Message via POST:`, JSON.stringify(messageData).substring(0, 100) + "...");

    // Broadcast the received message
    messageEmitter.emit('message', { source: 'api', data: messageData });

    // Send response and return
    res.status(200).json({ status: 'received', message: messageData });
    // No explicit return needed here if void is the return type, but added one before
    // Let's rely on the function signature's void type now.
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
        // mcpStatus: mcpServer?.getStatus() || 'not_initialized' // Removed - getStatus() not available
    });
});

// Error Handling Middleware (Express)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(`[${SERVER_NAME}] Express Error:`, err.stack);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// --- MCP Server (STDIO) ---
let mcpServer: McpServer | null = null;

// Define MCP tool input schema
const ProcessMessageInputSchema = z.object({
    message: z.any().describe("The message content (can be any JSON structure)."),
    broadcast: z.boolean().optional().default(true).describe("Whether to broadcast this message to other listeners (SSE, Native Messaging)."),
});

// Define the MCP tool handler
async function handleProcessMessage(args: z.infer<typeof ProcessMessageInputSchema>): Promise<CallToolResult> {
    console.error(`[${SERVER_NAME}] Received MCP message via tool 'process_message':`, JSON.stringify(args.message).substring(0,100)+"...");
    if (args.broadcast) {
        // Broadcast the received message
        messageEmitter.emit('message', { source: 'mcp', data: args.message });
    } else {
         console.error(`[${SERVER_NAME}] MCP message received but broadcast is disabled.`);
    }
    // Acknowledge receipt
    return {
        content: [{ type: "text", text: `MCP message received by ${SERVER_NAME}` }],
    };
}

function setupMcpServer() {
    try {
         mcpServer = new McpServer(
            {
                name: `${SERVER_NAME}-mcp`, // Distinguish the MCP part
                version: SERVER_VERSION,
            }
            // No specific capabilities needed here as we use server.tool()
        );

        // Register the tool
        mcpServer.tool(
            "process_message",
            "Sends a message to the native-message-io server, optionally broadcasting it to other connected clients (Firefox via Native Messaging, API SSE clients).",
            ProcessMessageInputSchema.shape,
            handleProcessMessage
        );

        // Use StdioServerTransport for MCP over the *same* stdio
        const mcpTransport = new StdioServerTransport();

        // Connect the MCP server - this will handle reading/writing MCP protocol messages
        // It runs *concurrently* with the Native Messaging listener on the same stdio streams
        mcpServer.connect(mcpTransport)
            .then(() => {
                console.error(`[${SERVER_NAME}] MCP Server part running on STDIN/STDOUT.`);
            })
            .catch(mcpErr => {
                 console.error(`[${SERVER_NAME}] FATAL: MCP Server failed to connect:`, mcpErr);
                 // Decide how to handle this - maybe send error via native message and exit?
                 writeNativeMessage({ status: "error", message: `MCP Server failed: ${mcpErr.message}`}).catch(console.error);
                 process.exit(1);
            });

    } catch (error) {
         console.error(`[${SERVER_NAME}] FATAL: Failed to initialize MCP Server:`, error);
         writeNativeMessage({ status: "error", message: `MCP Server init failed: ${error instanceof Error ? error.message : error}`}).catch(console.error);
         process.exit(1);
    }
}


// --- Message Broadcasting Logic ---
messageEmitter.on('message', (messagePayload: { source: string, data: any }) => {
    console.error(`[${SERVER_NAME}] Broadcasting message from ${messagePayload.source}...`);

    // Send to Firefox via Native Messaging (unless it was the source)
    if (messagePayload.source !== 'native-messaging') {
         writeNativeMessage({ type: "broadcast", source: messagePayload.source, data: messagePayload.data })
            .catch(err => console.error(`[${SERVER_NAME}] Error sending broadcast to Native Messaging:`, err));
    }

    // Send to connected SSE clients (unless it came from API - maybe avoid echo?)
    // if (messagePayload.source !== 'api') { // Or always send? Depends on use case.
        sendSseEvent('message', { source: messagePayload.source, data: messagePayload.data });
    // }

    // Send back via MCP? Less common, would require a specific outgoing MCP call or notification mechanism.
    // if (messagePayload.source !== 'mcp') {
    //   //  mcpServer?.notify(...) // Example placeholder
    // }
});


// --- Server Startup ---
async function startServer() {
    console.error(`[${SERVER_NAME}] v${SERVER_VERSION} Starting... (PID: ${process.pid})`);

    // Start listening for Native Messages FIRST, as Firefox connects immediately
    listenForNativeMessages();

    // Start the Express server
    const httpServer = http.createServer(app);
    httpServer.listen(HTTP_PORT, () => {
        console.error(`[${SERVER_NAME}] Express API/SSE server listening on http://localhost:${HTTP_PORT}`);
        // Now that HTTP is up, signal readiness via Native Messaging
         writeNativeMessage({
            status: "ready",
            pid: process.pid,
            server: SERVER_NAME,
            version: SERVER_VERSION,
            apiPort: HTTP_PORT,
            message: "Server ready, accepting Native Messaging, API/SSE, and MCP connections."
        }).catch(err => {
             console.error(`[${SERVER_NAME}] Failed to send initial ready message:`, err);
             // Exit if we can't even signal readiness?
             // process.exit(1);
        });
    }).on('error', (err: NodeJS.ErrnoException) => {
        console.error(`[${SERVER_NAME}] FATAL: Express server error:`, err);
         writeNativeMessage({ status: "error", message: `HTTP server error: ${err.message}`}).catch(console.error);
        if (err.code === 'EADDRINUSE') {
            console.error(`*** Port ${HTTP_PORT} is already in use. Try setting NATIVE_MESSAGE_IO_PORT environment variable. ***`);
             writeNativeMessage({ status: "error", message: `Port ${HTTP_PORT} in use.`}).catch(console.error);
        }
        process.exit(1);
    });

    // Start the MCP server part
    setupMcpServer();

    console.error(`[${SERVER_NAME}] All components initialized.`);
}

// --- Graceful Shutdown ---
function shutdown(signal: string) {
    console.error(`[${SERVER_NAME}] Received ${signal}. Shutting down...`);
    messageEmitter.removeAllListeners();

    // Close SSE connections
    sseClients.forEach(client => client.end());
    sseClients = [];

    // Close HTTP server
    // httpServer.close(() => { // httpServer is not in scope here - need to make it global or handle differently
    //     console.error(`[${SERVER_NAME}] HTTP server closed.`);
    // });

     // Close MCP server connection (if initialized)
     // McpServer doesn't have an explicit close method exposed easily in this setup
     // Relying on process exit might be sufficient for StdioTransport

    console.error(`[${SERVER_NAME}] Shutdown complete.`);
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', (code) => {
    console.error(`[${SERVER_NAME}] Exiting with code ${code}`);
});

// Start the server!
startServer().catch(error => {
     console.error(`[${SERVER_NAME}] Fatal error during startup:`, error);
     process.exit(1);
});

// Prevent Node from exiting immediately (needed especially if only stdin/stdout are active)
// process.stdin.resume(); // Already handled by the listener attaching 