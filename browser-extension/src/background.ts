// --- Imports --- (Ensure this is at the top, WITH .js extension)
import { executeCommand } from './commands.js';
// Import shared logger and state setter (WITH .js extension)
import { logToBuffer, setLastCreatedTabId } from './shared-state.js';

// --- Native Host Status Tracking ---
let nativeHostStatus: { isConnected: boolean; components: { [key: string]: string } } = {
    isConnected: false,
    components: {}
};
// --- End Status Tracking ---

const APP_TITLE = "Native Message IO";

// Store icon path (relative to extension root)
const ICON_DEFAULT = "icons/native-host-control-128.png"; // Added definition
const ICON_CONNECTED = "icons/native-host-control-connected-128.png"; // Define connected icon path

// Function to update title
function updateTitle(isConnected: boolean, statusText?: string) {
    const state = isConnected ? "Connected" : (statusText || "Disconnected");
    browser.action.setTitle({ title: `${APP_TITLE} (${state})` }).catch((e: Error) => {
        logToBuffer(`[Background:updateTitle] Error setting title: ${e.message}`);
    });
}

// Define the name of the native application (must match the native app manifest)
const NATIVE_APP_NAME = "native_message_io_etdofresh";

let nativePort: browser.runtime.Port | null = null;
let connectionStatus = "Disconnected";
let lastError: string | null = null;
// Variables to store last known state from 'ready' message
let lastKnownComponents: { [key: string]: string } | undefined = undefined;
let lastKnownHttpPort: number | undefined = undefined;

// Store the ID of the tab created by the 'create_tab' command
let lastCreatedTabId: number | undefined = undefined;

// Interface for messages arriving FROM native host
interface NativeMessage {
    rawCommand?: string; // Expecting the raw command string now
    status?: string;     // Keep status for ready/error messages from host
    [key: string]: any;
}

// Interface expected by executeCommand (requires parsed command)
interface CommandMessage {
    command: string;
    args?: string; // Arguments as a single string
    url?: string; // Specific for create_tab
    [key: string]: any;
}

// Modify updatePopupStatus to accept optional components and httpPort
function updatePopupStatus(components?: { [key: string]: string }, httpPort?: number) {
    const isConnected = nativePort !== null;
    let statusText = `Status: ${connectionStatus}`;
    if (lastError && !isConnected) {
        statusText += ` (Error: ${lastError})`;
    }

    // Change the message format to use 'type' and 'payload'
    const messageToSend = {
        type: "NATIVE_STATUS_UPDATE", // Use the type popup.js expects
        payload: {
            isConnected: isConnected,
            statusText: statusText,
            // Include components and httpPort if provided
            components: components, // Will be undefined if not passed
            httpPort: httpPort     // Will be undefined if not passed
        }
    };

    browser.runtime.sendMessage(messageToSend).catch(err => {
        // Ignore errors if popup is not open
        if (err.message.includes("Could not establish connection")) return;
        console.warn("Error sending status update to popup:", err);
    });
}

function connect() {
    if (nativePort) {
        logToBuffer("[Background] Already connected."); // Use imported logger
        return;
    }
    logToBuffer(`[Background] Connecting to native application: ${NATIVE_APP_NAME}`); // Use imported logger
    lastError = null;
    connectionStatus = "Connecting...";
    updatePopupStatus();

    try {
        nativePort = browser.runtime.connectNative(NATIVE_APP_NAME);
        connectionStatus = "Connected";

        nativePort.onMessage.addListener((message: NativeMessage) => {
             logToBuffer(`[Background] Received message: ${JSON.stringify(message)}`);

             if (message.rawCommand) {
                 // --- Parse the raw command string --- 
                 const commandString = message.rawCommand.trim();
                 const parts = commandString.split(/\s+/);
                 const commandName = parts[0];
                 const argsString = parts.slice(1).join(' ');

                 if (!commandName) {
                     logToBuffer(`[Background] Received empty rawCommand.`);
                     return; // Ignore empty commands
                 }

                 // Construct the CommandMessage for executeCommand
                 const commandMessage: CommandMessage = { command: commandName };
                 if (argsString) {
                     commandMessage.args = argsString;
                 }
                 // Special handling for create_tab URL argument
                 if (commandName === 'create_tab' && argsString) {
                     commandMessage.url = argsString; 
                 }

                 logToBuffer(`[Background] Parsed command: ${commandName}, Args: ${argsString}`);
                 executeCommand(commandMessage, nativePort);

             } else if (message.status === "error") {
                 logToBuffer(`[Background] Received error status from native app: ${message.message}`);
                 connectionStatus = "Connection Error";
                 lastError = message.message || "Unknown error from native host";
                 updatePopupStatus();
             } else if (message.status === "ready") {
                 connectionStatus = "Connected (Ready)";
                 lastError = null;
                 lastKnownComponents = message.components;
                 lastKnownHttpPort = message.httpPort;
                 updatePopupStatus(lastKnownComponents, lastKnownHttpPort);
                 browser.action.setIcon({ path: ICON_CONNECTED }).catch((e: Error) => logToBuffer(`[Background] Set icon error on ready: ${e.message}`));
             } else if (message.status) {
                 connectionStatus = `Connected (Status: ${message.status})`;
                  logToBuffer(`[Background] Received status: ${message.status}`);
                 updatePopupStatus();
             } else {
                  logToBuffer(`[Background] Received unhandled message structure: ${JSON.stringify(message)}`);
                  updatePopupStatus();
             }
        });

        // --- Simplify onDisconnect Listener (primarily for logging) ---
        nativePort.onDisconnect.addListener((p) => {
            logToBuffer("[Background] nativePort.onDisconnect event fired.");
            if (p.error) {
                logToBuffer(`[Background] Disconnected due to error: ${p.error.message}`);
                // Optional: Update status if it wasn't already handled by disconnect() function
                if (connectionStatus !== "Disconnected" && connectionStatus !== "Connection Error") {
                    connectionStatus = "Connection Error";
                    lastError = p.error.message;
                    // Update UI only if disconnect() wasn't called first
                    // updatePopupStatus();
                }
            }
            // No state cleanup here - it's handled in disconnect()
        });
        // --- End Simplified Listener ---

        logToBuffer("[Background] Native port connected.");
    } catch (error) {
        logToBuffer(`[Background] Failed to connect native port: ${error instanceof Error ? error.message : String(error)}`);
        lastError = error instanceof Error ? error.message : String(error);
        connectionStatus = "Failed to connect";
        nativePort = null;
        updatePopupStatus();
    }
}

function disconnect() {
    if (nativePort) {
        logToBuffer("[Background:disconnect] Attempting to disconnect native port.");
        try {
            nativePort.disconnect();
            logToBuffer("[Background:disconnect] nativePort.disconnect() called.");
        } catch (e) {
             logToBuffer(`[Background:disconnect] Error calling nativePort.disconnect(): ${e instanceof Error ? e.message : String(e)}`);
             // Proceed with cleanup even if disconnect throws
        }

        // --- Perform cleanup IMMEDIATELY --- 
        logToBuffer("[Background:disconnect] Performing immediate cleanup.");
        nativePort = null; // Clear the reference FIRST
        connectionStatus = "Disconnected"; // Set final state
        lastError = null; // Clear any previous error
        lastKnownComponents = undefined;
        lastKnownHttpPort = undefined;
        setLastCreatedTabId(undefined); // Clear shared state
        
        // Update icon and title
        browser.action.setIcon({ path: ICON_DEFAULT }).catch((e: Error) => logToBuffer(`[Background:disconnect] Set icon error: ${e.message}`));
        updateTitle(false);
        
        // Update the popup UI LAST, after state is set
        updatePopupStatus(); 
        logToBuffer("[Background:disconnect] Immediate cleanup finished.");
        // --- End Immediate Cleanup ---

    } else {
        logToBuffer("[Background:disconnect] Already disconnected.");
    }
}

// Listener for messages from the popup or other extension parts
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    logToBuffer(`[Background] Received runtime message: ${JSON.stringify(message)}`); // Use imported logger
    if (message.command === "toggle") {
        if (nativePort) {
            disconnect();
        } else {
            connect();
        }
        const isConnectedAfterToggle = nativePort !== null;
        let statusTextAfterToggle = `Status: ${connectionStatus}`;
         if (lastError && !isConnectedAfterToggle) {
            statusTextAfterToggle += ` (Error: ${lastError})`;
        }
        sendResponse({ isConnected: isConnectedAfterToggle, statusText: statusTextAfterToggle });
        return true;
    } else if (message.command === "getStatus") {
        const isConnected = nativePort !== null;
        let statusText = `Status: ${connectionStatus}`;
        if (lastError && !isConnected) {
            statusText += ` (Error: ${lastError})`;
        }
        logToBuffer(`[Background:getStatus] Responding with state: isConnected=${isConnected}, components=${JSON.stringify(lastKnownComponents)}, port=${lastKnownHttpPort}`); // Use imported logger
        sendResponse({
            isConnected: isConnected,
            statusText: statusText,
            components: lastKnownComponents,
            httpPort: lastKnownHttpPort
        });
        return false;
    }
    return false;
});

// Remove the old browser action listener
// browser.browserAction.onClicked.addListener(() => { ... });

logToBuffer("[Background] Script loaded. Initializing..."); // Use imported logger
browser.runtime.onStartup.addListener(() => {
  logToBuffer("[Background:onStartup] Setting icon & title..."); // Use imported logger
  browser.action.setIcon({ path: ICON_DEFAULT }).catch((e: Error) => logToBuffer(`[Background] onStartup setIcon error: ${e.message}`)); // Use imported logger
  updateTitle(false);
});
browser.runtime.onInstalled.addListener(() => {
  logToBuffer("[Background:onInstalled] Setting icon & title..."); // Use imported logger
  browser.action.setIcon({ path: ICON_DEFAULT }).catch((e: Error) => logToBuffer(`[Background] onInstalled setIcon error: ${e.message}`)); // Use imported logger
  updateTitle(false);
});
updateTitle(false); // Initial title set

logToBuffer("[Background] Initialization complete. Ready."); // Use imported logger 