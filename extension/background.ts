// Define the name of the native application (must match the native app manifest)
const NATIVE_APP_NAME = "native_logger_app";

let nativePort: browser.runtime.Port | null = null;
let connectionStatus = "Disconnected";
let lastError: string | null = null;

// Define expected message structure from native host
interface NativeMessage {
    status?: string; // Example property
    pid?: number;
    received?: any;
    // Add other potential properties if needed
    [key: string]: any; // Allow flexibility
}

function updatePopupStatus() {
    const isConnected = nativePort !== null;
    let statusText = `Status: ${connectionStatus}`; // Use the detailed status
    if (lastError && !isConnected) {
        statusText += ` (Error: ${lastError})`;
    }

    browser.runtime.sendMessage({ command: "statusUpdate", isConnected, statusText }).catch(err => {
        // Ignore errors if popup is not open
        if (err.message.includes("Could not establish connection")) return;
        console.warn("Error sending status update to popup:", err);
    });
}

function connect() {
    if (nativePort) {
        console.log("Already connected.");
        return;
    }
    console.log(`Connecting to native application: ${NATIVE_APP_NAME}`);
    lastError = null;
    connectionStatus = "Connecting...";
    updatePopupStatus();

    try {
        nativePort = browser.runtime.connectNative(NATIVE_APP_NAME);
        connectionStatus = "Connected"; // Assume connected, update on disconnect/error

        nativePort.onMessage.addListener((message: NativeMessage) => {
            console.log(`Received message from native app: ${JSON.stringify(message)}`);
            // Handle messages from native app if needed (e.g., status updates)
            if (message.status) {
                connectionStatus = `Connected (Native Status: ${message.status})`;
            }
            updatePopupStatus();
        });

        nativePort.onDisconnect.addListener((p) => {
            if (p.error) {
                console.error(`Native port disconnected with error: ${p.error.message}`);
                lastError = p.error.message;
                connectionStatus = "Disconnected (Error)";
            } else {
                console.log("Native port disconnected normally.");
                lastError = null;
                connectionStatus = "Disconnected";
            }
            nativePort = null;
            updatePopupStatus();
        });

         // Optional: Send an initial message if your native app expects one
         // nativePort.postMessage({ text: "Connection established" });

        console.log("Native port connected.");

    } catch (error) {
        console.error("Failed to connect native port:", error);
        lastError = error instanceof Error ? error.message : String(error);
        connectionStatus = "Failed to connect";
        nativePort = null; // Ensure port is null on failure
    }
    updatePopupStatus();
}

function disconnect() {
    if (nativePort) {
        console.log("Disconnecting native port.");
        nativePort.disconnect();
        nativePort = null; // Assume disconnect is synchronous for status update
        connectionStatus = "Disconnected";
        lastError = null;
        updatePopupStatus();
    } else {
        console.log("Already disconnected.");
    }
}

// Listener for messages from the popup or other extension parts
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background received message:", message);
    if (message.command === "toggle") {
        if (nativePort) {
            disconnect();
        } else {
            connect();
        }
        // Respond with the *intended* state after toggle
        const isConnected = nativePort !== null;
        let statusText = `Status: ${connectionStatus}`;
         if (lastError && !isConnected) {
            statusText += ` (Error: ${lastError})`;
        }
        sendResponse({ isConnected: isConnected, statusText: statusText });
        return true; // Indicate async response (though we send sync here)
    } else if (message.command === "getStatus") {
        const isConnected = nativePort !== null;
        let statusText = `Status: ${connectionStatus}`;
        if (lastError && !isConnected) {
            statusText += ` (Error: ${lastError})`;
        }
        sendResponse({ isConnected: isConnected, statusText: statusText });
        return true; // Indicate async response
    }
    // Handle other commands if needed
    return false; // Indicate no async response needed for unhandled commands
});

// Remove the old browser action listener
// browser.browserAction.onClicked.addListener(() => { ... });

console.log("Background script loaded for Native Host Control.");
// Optionally attempt to connect on startup?
// connect(); 