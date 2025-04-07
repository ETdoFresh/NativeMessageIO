// browser-extension/src/commands.ts

// Use .js extension in import
import { logToBuffer, getLastCreatedTabId, setLastCreatedTabId } from './shared-state.js';

// Define the structure for command handlers
// They receive arguments parsed by background.ts
type CommandHandler = (args: CommandMessage, nativePort: browser.runtime.Port | null) => Promise<any>;

const commandRegistry = new Map<string, CommandHandler>();

// Function to register commands within the extension
function registerCommand(commandName: string, handler: CommandHandler) {
    if (commandRegistry.has(commandName)) {
        logToBuffer(`[Commands] Warning: Command "${commandName}" is already registered. Overwriting.`);
    }
    commandRegistry.set(commandName, handler);
    logToBuffer(`[Commands] Command registered: ${commandName}`);
}

// Interface received from background.ts after parsing
interface CommandMessage {
    command: string;
    args?: string; // Arguments as a single string
    url?: string; // Specific property only reliably set for create_tab by background
    [key: string]: any;
}

// --- Helper to get the target Tab ID ---
async function getTargetTabId(): Promise<number> {
    let currentLastCreatedTabId = getLastCreatedTabId();
    if (currentLastCreatedTabId !== undefined) {
        try {
            // Verify the tab still exists
            await browser.tabs.get(currentLastCreatedTabId);
            logToBuffer(`[Commands:getTargetTabId] Using last created tab ID: ${currentLastCreatedTabId}`);
            return currentLastCreatedTabId;
        } catch (e) {
            logToBuffer(`[Commands:getTargetTabId] Last created tab ${currentLastCreatedTabId} no longer exists or error checking: ${e instanceof Error ? e.message : String(e)}. Falling back.`);
            setLastCreatedTabId(undefined); // Clear invalid ID
        }
    }
    logToBuffer(`[Commands:getTargetTabId] Querying active tab in current window.`);
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0 && tabs[0].id !== undefined) {
        logToBuffer(`[Commands:getTargetTabId] Using active tab ID: ${tabs[0].id}`);
        return tabs[0].id;
    }
    throw new Error('No target tab found (last created or active).');
}

// --- Command Handlers ---

// handleGetConsole doesn't use args string, only command name
async function handleGetConsole(args: CommandMessage, nativePort: browser.runtime.Port | null) {
    const commandName = args.command; // e.g., "get_console_logs"
    const statusKey = commandName.replace('get_', ''); // e.g., "console_logs"
    const levelFilter = commandName === 'get_console_warnings' ? 'warn'
                      : commandName === 'get_console_errors' ? 'error'
                      : commandName === 'get_console_logs' ? ['log', 'info', 'debug'] // Capture standard logs for get_console_logs
                      : null; // null means get_console_all or unexpected command

    logToBuffer(`[${commandName}] Received request.`);

    try {
        const targetTabId = await getTargetTabId();
        logToBuffer(`[${commandName}] Requesting logs from content script in tab ${targetTabId}`);

        const response = await browser.tabs.sendMessage(targetTabId, { command: 'request_console_logs' });

        // Check for errors after sending message
        if (browser.runtime.lastError) {
             throw new Error(`Error communicating with content script: ${browser.runtime.lastError.message}`);
        }
        if (!response || !response.success || !response.logs) {
             throw new Error('Failed to retrieve logs from page content script (invalid response). Check if the page supports content scripts.');
        }

        logToBuffer(`[${commandName}] Received ${response.logs.length} logs from content script.`);
        // Define the expected log structure - reusing the interface from content.ts (ideally share types)
        interface ConsoleLogEntry {
            level: string;
            message: string;
            timestamp: number;
        }
        const allLogs: ConsoleLogEntry[] = response.logs;
        const payload: { [key: string]: any } = {};

         if (commandName === 'get_console_all') {
             payload.data = {
                 logs: allLogs.filter(l => ['log', 'info', 'debug'].includes(l.level)),
                 warnings: allLogs.filter(l => l.level === 'warn'),
                 errors: allLogs.filter(l => l.level === 'error'),
             };
             logToBuffer(`[${commandName}] Prepared data for all log types.`);
         } else if (levelFilter) {
             const dataKey = statusKey.includes('logs') ? 'logs'
                           : statusKey.includes('warnings') ? 'warnings'
                           : statusKey.includes('errors') ? 'errors'
                           : 'data'; // Fallback key
             const levelsToFilter = Array.isArray(levelFilter) ? levelFilter : [levelFilter];
             payload[dataKey] = allLogs.filter(log => levelsToFilter.includes(log.level));
             logToBuffer(`[${commandName}] Filtered to ${payload[dataKey].length} logs (level(s): ${levelsToFilter.join(', ')}).`);
         } else {
             // Should not happen with current commands, but handle defensively
              logToBuffer(`[${commandName}] No specific filter applied, returning all logs under 'data'.`);
              payload.data = allLogs;
         }

         nativePort?.postMessage({ status: statusKey, ...payload });
         logToBuffer(`[${commandName}] Sent logs back to native host.`);

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logToBuffer(`[${commandName}] Error: ${errorMessage}`);
        // Provide more context in the error message back to the native host
        let detailedErrorMessage = `Handler failed: ${errorMessage}`;
        if (errorMessage.includes("Could not establish connection") || errorMessage.includes("No receiving end")) {
             detailedErrorMessage = `Content script not available/responding on the target page. Ensure the page is loaded and allows content scripts. Original error: ${errorMessage}`;
        }
        nativePort?.postMessage({ status: 'error', command: commandName, message: detailedErrorMessage });
    }
}

// handleClearConsole doesn't use args string
async function handleClearConsole(args: CommandMessage, nativePort: browser.runtime.Port | null) {
     logToBuffer(`[clear_console] Received request.`);
     try {
         const targetTabId = await getTargetTabId();
         logToBuffer(`[clear_console] Requesting clear for tab ${targetTabId}`);

         const response = await browser.tabs.sendMessage(targetTabId, { command: 'request_clear_console' });

         if (browser.runtime.lastError) {
              throw new Error(`Error communicating with content script: ${browser.runtime.lastError.message}`);
         }
         if (response && response.success) {
              logToBuffer("[clear_console] Console cleared successfully via content script. Sending confirmation.");
              nativePort?.postMessage({ status: 'console_cleared' });
         } else {
              throw new Error('Failed to clear console via content script (no success response).');
         }
     } catch (err) {
         const errorMessage = err instanceof Error ? err.message : String(err);
         logToBuffer(`[clear_console] Error: ${errorMessage}`);
         let detailedErrorMessage = `Handler failed: ${errorMessage}`;
         if (errorMessage.includes("Could not establish connection") || errorMessage.includes("No receiving end")) {
              detailedErrorMessage = `Content script not available/responding on the target page. Original error: ${errorMessage}`;
         }
         nativePort?.postMessage({ status: 'error', command: 'clear_console', message: detailedErrorMessage });
     }
}

// handleGetScreenshot doesn't use args string
async function handleGetScreenshot(args: CommandMessage, nativePort: browser.runtime.Port | null) {
     logToBuffer(`[get_screenshot] Received request.`);
     try {
         // No need to get targetTabId explicitly, captureVisibleTab captures the currently visible tab in the *current* window
         logToBuffer(`[get_screenshot] Capturing visible tab...`);
         // format: "png" is default. Pass options directly if windowId is omitted.
         const dataUrl = await browser.tabs.captureVisibleTab({ format: "png" });
         logToBuffer("[get_screenshot] Sending 'screenshot_data' back to native host.");
         // Send response with base64 data directly in 'data' field
         nativePort?.postMessage({ status: 'screenshot_data', data: dataUrl });
     } catch (err) {
         const errorMessage = err instanceof Error ? err.message : String(err);
         logToBuffer(`[get_screenshot] Error: ${errorMessage}`);
         nativePort?.postMessage({ status: 'error', command: 'get_screenshot', message: `Screenshot failed: ${errorMessage}` });
     }
}

// handleCreateTab uses the pre-parsed url property set by background.ts
async function handleCreateTab(args: CommandMessage, nativePort: browser.runtime.Port | null) {
     if (!args.url) {
         const errorMsg = 'Missing or invalid URL parameter (expected url property).';
         logToBuffer(`[create_tab] Error: ${errorMsg}`);
         nativePort?.postMessage({ status: 'error', command: 'create_tab', message: errorMsg });
         return;
     }
     const targetUrl = args.url;
     logToBuffer(`[create_tab] Request to create tab: ${targetUrl}`);
     try {
         // Create tab and make it active
         const newTab = await browser.tabs.create({ url: targetUrl, active: true });
         if (newTab.id !== undefined) {
             setLastCreatedTabId(newTab.id);
             logToBuffer(`[create_tab] Stored last created tab ID: ${newTab.id}`);
         } else {
             logToBuffer(`[create_tab] Warning: New tab created but ID is undefined.`);
         }
         logToBuffer(`[create_tab] Success: tab ${newTab.id} for ${targetUrl}`);
         nativePort?.postMessage({ status: 'tab_created', command: 'create_tab', tabId: newTab.id, url: targetUrl });
     } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
         logToBuffer(`[create_tab] Error creating tab for ${targetUrl}: ${errorMessage}`);
         nativePort?.postMessage({ status: 'error', command: 'create_tab', url: targetUrl, message: `Failed to create tab: ${errorMessage}` });
     }
}

// handleReloadExtension doesn't use args string
async function handleReloadExtension(args: CommandMessage, nativePort: browser.runtime.Port | null) {
    logToBuffer("[reload_extension] Received command. Reloading extension...");
    // Optional: Send a confirmation back before reloading?
    // nativePort?.postMessage({ status: 'reloading_extension' });
    // await new Promise(resolve => setTimeout(resolve, 100)); // Short delay
    browser.runtime.reload();
}

// TODO: Add handlers for get_network_errors, get_selected_element if needed

// Register the handlers
registerCommand('get_console_logs', handleGetConsole);
registerCommand('get_console_warnings', handleGetConsole);
registerCommand('get_console_errors', handleGetConsole);
registerCommand('get_console_all', handleGetConsole);
registerCommand('clear_console', handleClearConsole);
registerCommand('get_screenshot', handleGetScreenshot);
registerCommand('create_tab', handleCreateTab);
registerCommand('reload_extension', handleReloadExtension);

// Function to execute commands received from the native host
// Accepts the refined CommandMessage type
export async function executeCommand(message: CommandMessage, nativePort: browser.runtime.Port | null) {
    const handler = commandRegistry.get(message.command);
    if (handler) {
        logToBuffer(`[Commands] Executing command: ${message.command} with args: ${message.args || '<none>'}`);
        try {
            await handler(message, nativePort);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToBuffer(`[Commands] Critical error executing handler for ${message.command}: ${errorMessage}`);
            nativePort?.postMessage({ status: 'error', command: message.command, message: `Critical handler error: ${errorMessage}` });
        }
    } else {
        logToBuffer(`[Commands] Received unknown command: ${message.command}`);
        nativePort?.postMessage({ status: 'error', command: message.command, message: `Unknown command: ${message.command}` });
    }
}

logToBuffer("[Commands] Command module initialized."); 