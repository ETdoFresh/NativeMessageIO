import { logStdErr } from './utils/logger.js';
import { writeNativeMessage } from './native-messaging.js';
import { SERVER_NAME, SERVER_VERSION, HTTP_PORT, PIPE_PATH } from './config.js'; // Import config
import { componentStatus, messageEmitter } from './state.js'; // Import state AND messageEmitter

// --- Simplified Command Handling ---

// No specific CommandMessage/CommandResponse interfaces needed anymore.

// --- Command Handler Type ---
// Takes arguments parsed from the message string, returns a single response string.
type CommandHandler = (args: string[]) => Promise<string>;

// --- Command Registry ---
const commandRegistry = new Map<string, CommandHandler>();

// --- Register Command Function ---
function registerCommand(commandName: string, handler: CommandHandler) {
    if (commandRegistry.has(commandName)) {
        logStdErr(`Warning: Command "${commandName}" is already registered. Overwriting.`);
    }
    commandRegistry.set(commandName, handler);
    logStdErr(`Command registered: ${commandName}`);
}

// --- Core Command Handler ---
// Parses the input string and executes the corresponding command handler.
export async function handleCommandString(message: string): Promise<string> {
    logStdErr(`Handling command string: "${message}"`);

    // Simple space splitting for command and args.
    // WARNING: This is basic and won't handle args with spaces correctly.
    // More robust parsing (e.g., using quotes or a library) might be needed.
    const parts = message.trim().split(/\s+/);
    const commandName = parts[0];
    const args = parts.slice(1);

    const handler = commandRegistry.get(commandName);

    if (!handler) {
        const errorMsg = `Unknown command: ${commandName}`;
        logStdErr(`Error: ${errorMsg}`);
        return `[ERROR] ${errorMsg}`;
    }

    try {
        // Execute the handler and return its string response
        // Status prefix ([SUCCESS], [ERROR], etc.) should be added by the handler itself.
        return await handler(args);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logStdErr(`Error executing command "${commandName}":`, error);
        return `[ERROR] ${errorMessage}`;
    }
}

// --- Built-in Commands ---

// Example: Ping command
// Usage: `ping` or `ping custom_response`
async function handlePing(args: string[]): Promise<string> {
    const responseText = args.length > 0 ? args.join(' ') : 'hello';
    return `[SUCCESS] pong ${responseText}`;
}

// Command: Get Browser Logs
// Usage: `getBrowserLogs`
// Waits for a response from the browser extension.
async function handleGetBrowserLogs(args: string[]): Promise<string> {
    logStdErr(`Executing getBrowserLogs command. Sending 'get-logs' and waiting for response...`);

    // Timeout duration in milliseconds (e.g., 10 seconds)
    const TIMEOUT_MS = 10000;

    return new Promise<string>((resolve, reject) => {
        let timeoutId: NodeJS.Timeout | null = null;
        let listener: ((logs: any[]) => void) | null = null;

        // Function to clean up listeners and timeout
        const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId);
            if (listener) messageEmitter.removeListener('browser_logs_received', listener);
        };

        // Set up the listener for the log response
        listener = (logs: any[]) => {
            logStdErr(`Received browser_logs_received event with ${logs.length} logs.`);
            cleanup();
            // Format the response. Assuming logs is an array of objects/strings.
            // Adjust JSON.stringify if a different format is needed.
            resolve(`[SUCCESS] ${JSON.stringify(logs)}`);
        };
        messageEmitter.once('browser_logs_received', listener);

        // Set up the timeout
        timeoutId = setTimeout(() => {
            logStdErr(`Timeout waiting for browser logs after ${TIMEOUT_MS}ms.`);
            cleanup();
            // Reject will be caught by handleCommandString and formatted as [ERROR]
            reject(new Error(`Timeout: No logs received from browser extension within ${TIMEOUT_MS / 1000} seconds.`));
        }, TIMEOUT_MS);

        // Send the command to the browser extension
        writeNativeMessage({ command: "get-logs" })
            .then(() => {
                logStdErr("Sent 'get-logs' command successfully.");
                // Now we just wait for the listener or timeout
            })
            .catch((err) => {
                logStdErr(`Error sending 'get-logs' command via Native Messaging:`, err);
                cleanup();
                reject(new Error('Failed to send log request to browser extension.'));
            });
    });
}

// Command: Get Server Status
// Usage: `status`
async function handleStatusCommand(args: string[]): Promise<string> {
    logStdErr(`Executing status command.`);
    try {
        const statusObject = {
            // status: "running", // Implied by SUCCESS prefix
            serverName: SERVER_NAME,
            version: SERVER_VERSION,
            pid: process.pid,
            uptime: process.uptime(),
            listeningOn: {
                httpPort: HTTP_PORT,
                ipcPath: PIPE_PATH
                // sseClients: Cannot get live count easily from here
            },
            components: componentStatus
        };
        // Serialize the status object into the success message
        return `[SUCCESS] ${JSON.stringify(statusObject)}`;
    } catch (error) {
        logStdErr(`Error generating status object:`, error);
        throw new Error('Failed to generate server status.'); // Let handleCommandString format error
    }
}

// --- Register Built-in Commands ---
registerCommand('ping', handlePing);
registerCommand('getBrowserLogs', handleGetBrowserLogs);
registerCommand('status', handleStatusCommand); // Register new command

// --- TODO: Add more commands here --- 