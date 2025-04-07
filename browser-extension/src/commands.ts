// browser-extension/src/commands.ts

// Use .js extension in import
import { logToBuffer, getLastCreatedTabId, setLastCreatedTabId } from './shared-state.js';

// Define the structure for log entries used by the content script
interface ConsoleLogEntry {
    level: 'log' | 'warn' | 'error' | 'info' | 'debug';
    message: string;
    timestamp: number;
}

// Define the structure for command handlers
// They receive arguments parsed by background.ts AND optionally a requestId
type CommandHandler = (args: CommandMessage, nativePort: browser.runtime.Port | null, requestId?: string) => Promise<any>;

const commandRegistry = new Map<string, CommandHandler>();

// Function to register commands within the extension
function registerCommand(commandName: string, handler: CommandHandler) {
    if (commandRegistry.has(commandName)) {
        logToBuffer(`[Commands] Warning: Command \"${commandName}\" is already registered. Overwriting.`);
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

// --- Response Helpers ---

// Helper to send a structured success response if requestId is present
// Constructs the { status: "success", message: ... } format
function sendSuccessResponse(nativePort: browser.runtime.Port | null, requestId: string | undefined, resultData: any) {
    if (requestId) {
        const responseToSend = {
            type: 'commandResponse',
            requestId: requestId,
            response: { // Construct desired inner structure
                status: "success",
                message: resultData
            }
        };
        nativePort?.postMessage(responseToSend);
        logToBuffer(`[Commands] Sent commandResponse for ID ${requestId}`);
    } else {
        // Fallback for non-requestId calls (e.g., popup)
        // Try to mimic old behavior if possible, might need adjustment
        const fallbackStatus = resultData?.status || 'unknown_success'; // Attempt to get status if passed in resultData
        const fallbackPayload = { status: fallbackStatus, ...(typeof resultData === 'object' ? resultData : { data: resultData }) };
        nativePort?.postMessage(fallbackPayload);
        logToBuffer(`[Commands] Sent legacy status message (no requestId): ${fallbackStatus}`);
    }
}

// Helper to send a structured error response if requestId is present
// Constructs the { status: "error", message: ... } format
function sendErrorResponse(nativePort: browser.runtime.Port | null, requestId: string | undefined, commandName: string, errorMessage: string) {
     if (requestId) {
         const responseToSend = {
             type: 'commandError',
             requestId: requestId,
             error: { // Use error structure matching success structure
                status: "error",
                message: errorMessage
             }
         };
         nativePort?.postMessage(responseToSend);
         logToBuffer(`[Commands] Sent commandError for ID ${requestId}: ${errorMessage}`);
     } else {
         // Fallback to old error status message
         nativePort?.postMessage({ status: 'error', command: commandName, message: errorMessage });
          logToBuffer(`[Commands] Sent legacy error status message (no requestId): ${errorMessage}`);
     }
}

// --- Command Handlers (Modified Calls to sendSuccessResponse) ---

// handleGetConsole
async function handleGetConsole(args: CommandMessage, nativePort: browser.runtime.Port | null, requestId?: string) {
    const commandName = args.command;
    const statusKey = commandName.replace('get_', '');
    const levelFilter = commandName === 'get_console_warnings' ? 'warn'
                      : commandName === 'get_console_errors' ? 'error'
                      : commandName === 'get_console_logs' ? ['log', 'info', 'debug']
                      : null;

    logToBuffer(`[${commandName}] Received request (ReqID: ${requestId || 'N/A'}).`);

    try {
        const targetTabId = await getTargetTabId();
        logToBuffer(`[${commandName}] Requesting logs from content script in tab ${targetTabId}`);
        const response = await browser.tabs.sendMessage(targetTabId, { command: 'request_console_logs' });

        if (browser.runtime.lastError) throw new Error(`Error communicating with content script: ${browser.runtime.lastError.message}`);
        if (!response || !response.success || !response.logs) throw new Error('Failed to retrieve logs from page content script (invalid response).');

        logToBuffer(`[${commandName}] Received ${response.logs.length} logs from content script.`);
        const allLogs: ConsoleLogEntry[] = response.logs;
        let resultData: any; // This is the core data to send back

         if (commandName === 'get_console_all') {
             resultData = {
                 logs: allLogs.filter(l => ['log', 'info', 'debug'].includes(l.level)),
                 warnings: allLogs.filter(l => l.level === 'warn'),
                 errors: allLogs.filter(l => l.level === 'error'),
             };
             logToBuffer(`[${commandName}] Prepared data for all log types.`);
         } else if (levelFilter) {
             const levelsToFilter = Array.isArray(levelFilter) ? levelFilter : [levelFilter];
             resultData = allLogs.filter(log => levelsToFilter.includes(log.level));
             logToBuffer(`[${commandName}] Filtered logs.`);
         } else {
              logToBuffer(`[${commandName}] No specific filter applied, returning all logs.`);
              resultData = allLogs;
         }

         // Pass only the core resultData
         sendSuccessResponse(nativePort, requestId, resultData);

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logToBuffer(`[${commandName}] Error: ${errorMessage}`);
        let detailedErrorMessage = `Handler failed: ${errorMessage}`;
        if (errorMessage.includes("Could not establish connection") || errorMessage.includes("No receiving end")) {
             detailedErrorMessage = `Content script not available/responding on the target page. Original error: ${errorMessage}`;
        }
        // Use helper to send error
        sendErrorResponse(nativePort, requestId, commandName, detailedErrorMessage);
    }
}

// handleClearConsole
async function handleClearConsole(args: CommandMessage, nativePort: browser.runtime.Port | null, requestId?: string) {
     logToBuffer(`[clear_console] Received request (ReqID: ${requestId || 'N/A'}).`);
     try {
         const targetTabId = await getTargetTabId();
         logToBuffer(`[clear_console] Requesting clear for tab ${targetTabId}`);
         const response = await browser.tabs.sendMessage(targetTabId, { command: 'request_clear_console' });

         if (browser.runtime.lastError) throw new Error(`Error communicating with content script: ${browser.runtime.lastError.message}`);
         if (!response || !response.success) throw new Error('Failed to clear console via content script (no success response).');

         logToBuffer("[clear_console] Console cleared successfully via content script.");
         // Pass simple success message or boolean
         sendSuccessResponse(nativePort, requestId, "Console cleared"); 

     } catch (err) {
         const errorMessage = err instanceof Error ? err.message : String(err);
         logToBuffer(`[clear_console] Error: ${errorMessage}`);
         let detailedErrorMessage = `Handler failed: ${errorMessage}`;
         if (errorMessage.includes("Could not establish connection") || errorMessage.includes("No receiving end")) {
              detailedErrorMessage = `Content script not available/responding on the target page. Original error: ${errorMessage}`;
         }
         // Use helper to send error
         sendErrorResponse(nativePort, requestId, 'clear_console', detailedErrorMessage);
     }
}

// handleGetScreenshot
async function handleGetScreenshot(args: CommandMessage, nativePort: browser.runtime.Port | null, requestId?: string) {
     logToBuffer(`[get_screenshot] Received request (ReqID: ${requestId || 'N/A'}).`);
     try {
         logToBuffer(`[get_screenshot] Capturing visible tab...`);
         const dataUrl = await browser.tabs.captureVisibleTab({ format: "png" });
         logToBuffer("[get_screenshot] Captured successfully.");
         // Pass only the dataUrl
         sendSuccessResponse(nativePort, requestId, dataUrl); 

     } catch (err) {
         const errorMessage = err instanceof Error ? err.message : String(err);
         logToBuffer(`[get_screenshot] Error: ${errorMessage}`);
         // Use helper to send error
         sendErrorResponse(nativePort, requestId, 'get_screenshot', `Screenshot failed: ${errorMessage}`);
     }
}

// handleCreateTab
async function handleCreateTab(args: CommandMessage, nativePort: browser.runtime.Port | null, requestId?: string) {
     if (!args.url) {
         const errorMsg = 'Missing or invalid URL parameter.';
         logToBuffer(`[create_tab] Error: ${errorMsg}`);
         sendErrorResponse(nativePort, requestId, 'create_tab', errorMsg);
         return;
     }
     const targetUrl = args.url;
     logToBuffer(`[create_tab] Request to create tab: ${targetUrl} (ReqID: ${requestId || 'N/A'}).`);
     try {
         const newTab = await browser.tabs.create({ url: targetUrl, active: true });
         if (newTab.id !== undefined) {
             setLastCreatedTabId(newTab.id);
             logToBuffer(`[create_tab] Stored last created tab ID: ${newTab.id}`);
         } else {
             logToBuffer(`[create_tab] Warning: New tab created but ID is undefined.`);
         }
         logToBuffer(`[create_tab] Success: tab ${newTab.id} for ${targetUrl}`);
         // Pass only the tab ID
         sendSuccessResponse(nativePort, requestId, newTab.id);

     } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
         logToBuffer(`[create_tab] Error creating tab for ${targetUrl}: ${errorMessage}`);
         // Use helper to send error
         sendErrorResponse(nativePort, requestId, 'create_tab', `Failed to create tab: ${errorMessage}`);
     }
}

// handleReloadExtension
async function handleReloadExtension(args: CommandMessage, nativePort: browser.runtime.Port | null, requestId?: string) {
    logToBuffer(`[reload_extension] Received command (ReqID: ${requestId || 'N/A'}). Reloading extension...`);
    if (requestId) {
        // Pass simple success message
        sendSuccessResponse(nativePort, requestId, "Reloading extension"); 
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser.runtime.reload();
}

// handleHelp command
async function handleHelp(args: CommandMessage, nativePort: browser.runtime.Port | null, requestId?: string) {
    logToBuffer(`[help] Received request (ReqID: ${requestId || 'N/A'}).`);
    try {
        const availableCommands = Array.from(commandRegistry.keys());
        const helpString = availableCommands.join('\n');
        logToBuffer(`[help] Sending list of available commands.`);
        // Pass the newline-separated string of command names
        sendSuccessResponse(nativePort, requestId, helpString); 
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logToBuffer(`[help] Error: ${errorMessage}`);
        // Use helper to send error
        sendErrorResponse(nativePort, requestId, 'help', `Failed to get command list: ${errorMessage}`);
    }
}

// handleSwitchToTab command
async function handleSwitchToTab(args: CommandMessage, nativePort: browser.runtime.Port | null, requestId?: string) {
    const commandName = 'switch_to_tab';
    logToBuffer(`[${commandName}] Received request (ReqID: ${requestId || 'N/A'}). Args: ${args.args}`);

    const tabIdStr = args.args?.trim();
    if (!tabIdStr) {
        sendErrorResponse(nativePort, requestId, commandName, "Missing tab_id argument.");
        return;
    }

    const tabId = parseInt(tabIdStr, 10);
    if (isNaN(tabId)) {
        sendErrorResponse(nativePort, requestId, commandName, `Invalid tab_id: "${tabIdStr}". Must be a number.`);
        return;
    }

    try {
        // First, get the tab info to find its window
        const tab = await browser.tabs.get(tabId);

        // Check if windowId is valid before trying to update the window
        if (tab.windowId === undefined) {
            throw new Error(`Could not find window ID for tab ${tabId}.`);
        }

        // Focus the window the tab is in
        await browser.windows.update(tab.windowId, { focused: true });

        // Activate the tab within its window
        await browser.tabs.update(tabId, { active: true });

        logToBuffer(`[${commandName}] Successfully switched to tab ${tabId}.`);
        sendSuccessResponse(nativePort, requestId, `Switched to tab ${tabId}`);
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logToBuffer(`[${commandName}] Error: ${errorMessage}`);
        // Check if the error is due to an invalid tab ID
        if (errorMessage.toLowerCase().includes("invalid tab id") || errorMessage.toLowerCase().includes("no tab with id")) {
            sendErrorResponse(nativePort, requestId, commandName, `Tab with ID ${tabId} not found.`);
        } else {
            sendErrorResponse(nativePort, requestId, commandName, `Failed to switch to tab ${tabId}: ${errorMessage}`);
        }
    }
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
registerCommand('help', handleHelp);
registerCommand('switch_to_tab', handleSwitchToTab);

// Function to execute commands received
// Now accepts optional requestId
export async function executeCommand(message: CommandMessage, nativePort: browser.runtime.Port | null, requestId?: string) {
    const handler = commandRegistry.get(message.command);
    if (handler) {
        logToBuffer(`[Commands] Executing command: ${message.command} (ReqID: ${requestId || 'N/A'}) with args: ${message.args || '<none>'}`);
        try {
            // Pass requestId to the handler
            await handler(message, nativePort, requestId);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToBuffer(`[Commands] Critical error executing handler for ${message.command}: ${errorMessage}`);
            // Use helper to send error, passing requestId
            sendErrorResponse(nativePort, requestId, message.command, `Critical handler error: ${errorMessage}`);
        }
    } else {
        logToBuffer(`[Commands] Received unknown command: ${message.command}`);
        // Use helper to send error, passing requestId
        sendErrorResponse(nativePort, requestId, message.command, `Unknown command: ${message.command}`);
    }
}

logToBuffer("[Commands] Command module initialized."); 