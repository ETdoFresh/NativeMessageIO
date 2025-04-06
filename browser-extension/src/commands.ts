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

// --- Command Handlers (Updated for args string) ---

// handleGetConsole doesn't use args string, only command name
async function handleGetConsole(args: CommandMessage, nativePort: browser.runtime.Port | null) {
    const levelFilter = args.command === 'get_console_warnings' ? 'warn'
                      : args.command === 'get_console_errors' ? 'error'
                      : null;
    const statusKey = args.command.replace('get_', '');

    const getTargetTab = async (): Promise<number | undefined> => {
        let currentLastCreatedTabId = getLastCreatedTabId(); // Use imported getter
        if (currentLastCreatedTabId !== undefined) {
             try {
                 await browser.tabs.get(currentLastCreatedTabId);
                 logToBuffer(`[${args.command}] Using last created tab ID: ${currentLastCreatedTabId}`);
                 return currentLastCreatedTabId;
             } catch (e) {
                 logToBuffer(`[${args.command}] Last created tab ${currentLastCreatedTabId} no longer exists. Falling back.`);
                 setLastCreatedTabId(undefined); // Use imported setter
             }
        }
         logToBuffer(`[${args.command}] Querying active tab.`);
         const tabs = await browser.tabs.query({ active: true, currentWindow: true });
         if (tabs.length > 0 && tabs[0].id !== undefined) {
              logToBuffer(`[${args.command}] Using active tab ID: ${tabs[0].id}`);
             return tabs[0].id;
         }
         return undefined;
    };

    try {
        const targetTabId = await getTargetTab();
        if (targetTabId === undefined) {
            throw new Error('No target tab found (last created or active).');
        }
        logToBuffer(`[${args.command}] Requesting logs from tab ${targetTabId}`);
        const response = await browser.tabs.sendMessage(targetTabId, { command: 'request_console_logs' });
        if (!response || !response.logs) {
             if (browser.runtime.lastError) {
                 throw new Error(`Error communicating with content script: ${browser.runtime.lastError.message}`);
             } else {
                 throw new Error('Failed to retrieve logs from page content script (no response).');
             }
        }
        logToBuffer(`[${args.command}] Received ${response.logs.length} logs.`);
        let filteredLogs = response.logs;
        if (levelFilter) {
            filteredLogs = response.logs.filter((log: any) => log.level === levelFilter);
            logToBuffer(`[${args.command}] Filtered to ${filteredLogs.length} logs (level: ${levelFilter}).`);
        }
        const payload: { [key: string]: any } = {};
         if (args.command === 'get_console_all') {
             payload.data = {
                 logs: response.logs.filter((l:any) => ['log', 'info', 'debug'].includes(l.level)),
                 warnings: response.logs.filter((l:any) => l.level === 'warn'),
                 errors: response.logs.filter((l:any) => l.level === 'error'),
             };
         } else {
             const dataKey = statusKey.includes('logs') ? 'logs'
                           : statusKey.includes('warnings') ? 'warnings'
                           : statusKey.includes('errors') ? 'errors'
                           : 'data';
             payload[dataKey] = filteredLogs;
         }
         nativePort?.postMessage({ status: statusKey, ...payload });
    } catch (err) {
        logToBuffer(`[${args.command}] Error: ${err instanceof Error ? err.message : String(err)}`);
        const errorMessage = (err instanceof Error && (err.message.includes("Could not establish connection") || err.message.includes("No receiving end")))
            ? "Content script not available on the target page."
            : err instanceof Error ? err.message : String(err);
        nativePort?.postMessage({ status: 'error', command: args.command, message: `Handler failed: ${errorMessage}` });
    }
}

// handleClearConsole doesn't use args string
async function handleClearConsole(args: CommandMessage, nativePort: browser.runtime.Port | null) {
     const getTargetTabForClear = async (): Promise<number | undefined> => {
        let currentLastCreatedTabId = getLastCreatedTabId(); // Use imported getter
         if (currentLastCreatedTabId !== undefined) {
             try {
                 await browser.tabs.get(currentLastCreatedTabId); return currentLastCreatedTabId;
             } catch (e) {
                 setLastCreatedTabId(undefined); // Use imported setter
             }
         }
         const tabs = await browser.tabs.query({ active: true, currentWindow: true });
         return tabs[0]?.id;
     };
     try {
         const targetTabId = await getTargetTabForClear();
         if (targetTabId === undefined) {
             throw new Error('No target tab found.');
         }
         logToBuffer(`[clear_console] Requesting clear for tab ${targetTabId}`);
         const response = await browser.tabs.sendMessage(targetTabId, { command: 'request_clear_console' });
          if (browser.runtime.lastError) {
              throw new Error(`Error communicating with content script: ${browser.runtime.lastError.message}`);
          } else if (response && response.success) {
              logToBuffer("Sending 'console_cleared' confirmation back to native host");
              nativePort?.postMessage({ status: 'console_cleared' });
          } else {
              throw new Error('Failed to clear console via content script (no success response).');
          }
     } catch (err) {
         logToBuffer(`[clear_console] Error: ${err instanceof Error ? err.message : String(err)}`);
         const errorMessage = (err instanceof Error && (err.message.includes("Could not establish connection") || err.message.includes("No receiving end")))
             ? "Content script not available on the target page."
             : err instanceof Error ? err.message : String(err);
         nativePort?.postMessage({ status: 'error', command: 'clear_console', message: `Handler failed: ${errorMessage}` });
     }
}

// handleGetScreenshot doesn't use args string
async function handleGetScreenshot(args: CommandMessage, nativePort: browser.runtime.Port | null) {
     try {
         logToBuffer(`[get_screenshot] Capturing visible tab...`);
         const dataUrl = await browser.tabs.captureVisibleTab({ format: "png" });
         logToBuffer("Sending 'screenshot_data' back to native host");
         nativePort?.postMessage({ status: 'screenshot_data', data: dataUrl });
     } catch (err) {
         logToBuffer(`[get_screenshot] Error: ${err instanceof Error ? err.message : String(err)}`);
         nativePort?.postMessage({ status: 'error', command: 'get_screenshot', message: `Screenshot failed: ${err}` });
     }
}

// handleCreateTab uses the pre-parsed url property set by background.ts
async function handleCreateTab(args: CommandMessage, nativePort: browser.runtime.Port | null) {
     // Background.ts specifically parses URL for this command
     if (!args.url) { // Check url property
         const errorMsg = 'Missing or invalid URL parameter (expected url property).';
         logToBuffer(`[create_tab] Error: ${errorMsg}`);
         nativePort?.postMessage({ status: 'error', command: 'create_tab', message: errorMsg });
         return;
     }
     const targetUrl = args.url;
     logToBuffer(`[create_tab] Request to create tab: ${targetUrl}`);
     try {
         const newTab = await browser.tabs.create({ url: targetUrl, active: true });
         if (newTab.id !== undefined) {
             setLastCreatedTabId(newTab.id);
             logToBuffer(`[create_tab] Stored last created tab ID: ${newTab.id}`);
         }
         logToBuffer(`[create_tab] Success: tab ${newTab.id} for ${targetUrl}`);
         nativePort?.postMessage({ status: 'tab_created', command: 'create_tab', tabId: newTab.id, url: targetUrl });
     } catch (err) {
         logToBuffer(`[create_tab] Error creating tab for ${targetUrl}: ${err instanceof Error ? err.message : String(err)}`);
         nativePort?.postMessage({ status: 'error', command: 'create_tab', url: targetUrl, message: `Failed to create tab: ${err}` });
     }
}

// handleReloadExtension doesn't use args string
async function handleReloadExtension(args: CommandMessage, nativePort: browser.runtime.Port | null) {
    logToBuffer("[reload_extension] Received command. Reloading extension...");
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
        logToBuffer(`[Commands] Executing command: ${message.command}`);
        try {
            await handler(message, nativePort);
        } catch (error) {
            logToBuffer(`[Commands] Critical error executing handler for ${message.command}: ${error instanceof Error ? error.message : String(error)}`);
            nativePort?.postMessage({ status: 'error', command: message.command, message: `Critical handler error: ${error}` });
        }
    } else {
        logToBuffer(`[Commands] Received unknown command: ${message.command}`);
        nativePort?.postMessage({ status: 'error', command: message.command, message: `Unknown command: ${message.command}` });
    }
}

logToBuffer("[Commands] Command module initialized."); 