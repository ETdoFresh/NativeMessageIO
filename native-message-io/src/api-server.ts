import express, { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import { logStdErr } from './utils/logger.js';
import { HTTP_PORT } from './config.js';
import { updateComponentStatus } from './state.js';
import { writeNativeMessage, sendCommandAndWaitForResponse } from './native-messaging.js';

let httpServerInstance: http.Server | null = null;

const app = express();
app.use(cors());
app.use(express.json());

let sseClients: Response[] = [];

export function sendSseEvent(data: object) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => client.write(message));
}

app.get('/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.push(res);
    logStdErr(`SSE client connected. Total clients: ${sseClients.length}`);

    // Send initial connection message if needed
    sendSseEvent({ type: 'connection', status: 'established' });

    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
        logStdErr(`SSE client disconnected. Total clients: ${sseClients.length}`);
    });
});

// POST /command (Modified)
app.post('/command', async (req, res) => {
    const commandObject = req.body;
    logStdErr('[API Server] Received POST /command:', commandObject);

    if (!commandObject || typeof commandObject.message !== 'string') {
        logStdErr('[API Server] Invalid command format.');
        return res.status(400).json({ status: "error", message: 'Invalid command format. Expected JSON { "message": "string" }' });
    }
    const commandString = commandObject.message;
    let responsePayload: object; 
    let httpStatus = 500; // Default to internal server error

    try {
        logStdErr(`[API Server] Sending command to extension: "${commandString.substring(0, 100)}..."`);
        const extensionResponseString = await sendCommandAndWaitForResponse(commandString); 
        logStdErr(`[API Server] Received response string from extension: ${extensionResponseString}`);
        
        // Try parsing the response string (expecting { status, message } format)
        try {
            responsePayload = JSON.parse(extensionResponseString);
            // Basic validation of the expected structure
            if (typeof (responsePayload as any)?.status !== 'string' || (responsePayload as any)?.message === undefined) {
                 logStdErr(`[API Server] Warning: Parsed extension response lacks expected status/message structure. Response: ${extensionResponseString}`);
                 // Return the potentially malformed object anyway, but set status to 200 as interaction succeeded
                 httpStatus = 200;
            } else {
                // Successfully parsed into expected format
                httpStatus = (responsePayload as any).status === 'error' ? 500 : 200; // Use 500 for extension errors, 200 otherwise
                logStdErr(`[API Server] Parsed extension response successfully. Status: ${httpStatus}`);
            }
        } catch (parseError) {
             logStdErr(`[API Server] Error parsing extension response as JSON: ${parseError}. Returning as error.`);
             // Treat unparsable response as an error
             responsePayload = { status: "error", message: `Extension response was not valid JSON: ${extensionResponseString}` }; 
             httpStatus = 500;
        }
    } catch (interactionError) {
        const errorMessage = interactionError instanceof Error ? interactionError.message : String(interactionError);
        logStdErr(`[API Server] Error during interaction with extension for command "${commandString}":`, interactionError);
        responsePayload = { status: "error", message: `Failed interaction with extension: ${errorMessage}` }; 
        httpStatus = 500; 
    }

    // Send the final payload (directly parsed from extension or error object)
    res.status(httpStatus).json(responsePayload);
});

// GET /status (Simple HTTP status, not the native host status command)
app.get('/status', (req, res) => {
    res.json({ status: 'running', timestamp: Date.now() });
});

export function startHttpServer(): Promise<http.Server | null> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        httpServerInstance = server;
        server.listen(HTTP_PORT, () => {
            logStdErr(`Express API/SSE server listening on http://localhost:${HTTP_PORT}`);
            updateComponentStatus('http', 'OK');
            resolve(server);
        }).on('error', (err: NodeJS.ErrnoException) => {
            logStdErr(`FATAL: Express server error:`, err);
            const errMsg = (err && 'code' in err) ? err.code : err.message;
            updateComponentStatus('http', `Error: ${errMsg}`);
            // Avoid sending native message if native messaging might not be ready/failed
            // writeNativeMessage({ status: "error", message: `HTTP server error: ${err.message}` }).catch(logStdErr);
            if (err.code === 'EADDRINUSE') {
                logStdErr(`*** Port ${HTTP_PORT} is already in use. Try setting NATIVE_MESSAGE_IO_PORT environment variable. ***`);
                // writeNativeMessage({ status: "error", message: `Port ${HTTP_PORT} in use.` }).catch(logStdErr);
            }
            httpServerInstance = null;
            reject(err); 
        });
    });
}

export function getHttpServerInstance(): http.Server | null { return httpServerInstance; }

export function stopHttpServer(callback: (err?: Error) => void) {
    sseClients.forEach(client => client.end());
    sseClients = [];
    if (httpServerInstance) {
        logStdErr(`Closing HTTP server...`);
        httpServerInstance.close((err) => {
             if (err) logStdErr(`Error closing HTTP server:`, err);
             else logStdErr(`HTTP server closed.`);
             httpServerInstance = null;
             callback(err);
        });
    } else {
        callback();
    }
} 