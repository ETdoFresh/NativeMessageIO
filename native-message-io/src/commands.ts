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

// --- Helper for Asynchronous Native Message Commands ---
// Sends a command and waits for a specific event from the message emitter.
async function sendAndWait<T>(command: object, eventName: string, timeoutMs: number = 10000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let timeoutId: NodeJS.Timeout | null = null;
        let listener: ((data: T) => void) | null = null;

        const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId);
            if (listener) messageEmitter.removeListener(eventName, listener);
        };

        listener = (data: T) => {
            logStdErr(`Received ${eventName} event.`);
            cleanup();
            resolve(data);
        };
        messageEmitter.once(eventName, listener);

        timeoutId = setTimeout(() => {
            logStdErr(`Timeout waiting for ${eventName} after ${timeoutMs}ms.`);
            cleanup();
            reject(new Error(`Timeout: No response received for ${eventName} within ${timeoutMs / 1000} seconds.`));
        }, timeoutMs);

        writeNativeMessage(command)
            .then(() => {
                logStdErr(`Sent command ${JSON.stringify(command)} successfully.`);
            })
            .catch((err) => {
                logStdErr(`Error sending command ${JSON.stringify(command)}:`, err);
                cleanup();
                reject(new Error(`Failed to send command ${JSON.stringify(command)} to browser extension.`));
            });
    });
}

// --- Built-in Commands ---

// Example: Ping command
// Usage: `ping` or `ping custom_response`
async function handlePing(args: string[]): Promise<string> {
    const responseText = args.length > 0 ? args.join(' ') : 'hello';
    return `[SUCCESS] pong ${responseText}`;
}

// Command: get_console_logs
async function handleGetConsoleLogs(args: string[]): Promise<string> {
    logStdErr(`Executing get_console_logs command...`);
    const logs = await sendAndWait<any[]>({ command: 'get_console_logs' }, 'console_logs_received');
    return `[SUCCESS] ${JSON.stringify(logs)}`;
}

// Command: get_console_warnings
async function handleGetConsoleWarnings(args: string[]): Promise<string> {
    logStdErr(`Executing get_console_warnings command...`);
    const warnings = await sendAndWait<any[]>({ command: 'get_console_warnings' }, 'console_warnings_received');
    return `[SUCCESS] ${JSON.stringify(warnings)}`;
}

// Command: get_console_errors
async function handleGetConsoleErrors(args: string[]): Promise<string> {
    logStdErr(`Executing get_console_errors command...`);
    const errors = await sendAndWait<any[]>({ command: 'get_console_errors' }, 'console_errors_received');
    return `[SUCCESS] ${JSON.stringify(errors)}`;
}

// Command: get_console_all
async function handleGetConsoleAll(args: string[]): Promise<string> {
    logStdErr(`Executing get_console_all command...`);
    // Expecting data = { logs: [], warnings: [], errors: [] }
    const allData = await sendAndWait<object>({ command: 'get_console_all' }, 'console_all_received');
    return `[SUCCESS] ${JSON.stringify(allData)}`;
}

// Command: clear_console
async function handleClearConsole(args: string[]): Promise<string> {
    logStdErr(`Executing clear_console command...`);
    // This command just waits for a confirmation event, no data expected
    await sendAndWait<void>({ command: 'clear_console' }, 'console_cleared_confirmation');
    return `[SUCCESS] Console cleared signal sent and confirmed.`;
}

// Command: get_network_errors
async function handleGetNetworkErrors(args: string[]): Promise<string> {
    logStdErr(`Executing get_network_errors command...`);
    const errors = await sendAndWait<any[]>({ command: 'get_network_errors' }, 'network_errors_received');
    return `[SUCCESS] ${JSON.stringify(errors)}`;
}

// Command: get_screenshot
async function handleGetScreenshot(args: string[]): Promise<string> {
    logStdErr(`Executing get_screenshot command...`);
    // Expecting data = base64 string
    const screenshotData = await sendAndWait<string>({ command: 'get_screenshot' }, 'screenshot_received', 20000); // Longer timeout for screenshot
    return `[SUCCESS] Screenshot data received (length: ${screenshotData.length})`; // Avoid logging full base64 string
}

// Command: get_selected_element
async function handleGetSelectedElement(args: string[]): Promise<string> {
    logStdErr(`Executing get_selected_element command...`);
    const elementData = await sendAndWait<any>({ command: 'get_selected_element' }, 'selected_element_received');
    return `[SUCCESS] ${JSON.stringify(elementData)}`;
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
registerCommand('get_console_logs', handleGetConsoleLogs); // Renamed
registerCommand('get_console_warnings', handleGetConsoleWarnings);
registerCommand('get_console_errors', handleGetConsoleErrors);
registerCommand('get_console_all', handleGetConsoleAll);
registerCommand('clear_console', handleClearConsole);
registerCommand('get_network_errors', handleGetNetworkErrors);
registerCommand('get_screenshot', handleGetScreenshot);
registerCommand('get_selected_element', handleGetSelectedElement);
registerCommand('status', handleStatusCommand); // Register new command

// Command: help
async function handleHelp(args: string[]): Promise<string> {
    logStdErr(`Executing help command...`);
    const commandNames = Array.from(commandRegistry.keys()).sort();
    const helpText = `Available commands:\n  ${commandNames.join('\n  ')}`;
    return `[SUCCESS]\n${helpText}`;
}

registerCommand('help', handleHelp); // Register help command

// --- TODO: Add more commands here --- 