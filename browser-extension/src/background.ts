// --- Log Buffer ---
const MAX_LOG_MESSAGES = 100;
let consoleLogBuffer: { timestamp: number; message: string }[] = [];

/**
 * Logs a message to both the actual console and an in-memory buffer.
 * Keeps the buffer size limited to MAX_LOG_MESSAGES.
 * @param message The message string to log.
 */
function logToBuffer(message: string): void {
    if (consoleLogBuffer.length >= MAX_LOG_MESSAGES) {
        consoleLogBuffer.shift(); // Remove the oldest message
    }
    const logEntry = { timestamp: Date.now(), message: message };
    consoleLogBuffer.push(logEntry);
    // Also log to the actual browser console for real-time debugging
    console.log(`[Buffered] ${message}`);
}
// --- End Log Buffer ---

// --- Native Host Status Tracking ---
let nativeHostStatus: { isConnected: boolean; components: { [key: string]: string } } = {
    isConnected: false,
    components: {}
};
// --- End Status Tracking ---

// Extension interaction logic (popup, options, etc.)
logToBuffer("[Background] Script top level."); // Use buffered log

// Listener for messages FROM POPUP or other extension parts
logToBuffer("[Background] Attaching runtime.onMessage listener..."); // Use buffered log
browser.runtime.onMessage.addListener((message: any, sender: browser.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  logToBuffer(`[Background:onMessage] Received message from extension: ${JSON.stringify(message)}`); // Use buffered log
  const command = message?.command;

  if (command === "toggle") {
    if (port) {
      logToBuffer("[Background:onMessage:toggle] Port exists. Calling disconnect()"); // Use buffered log
      disconnect();
      logToBuffer("[Background:onMessage:toggle] Sending response { status: 'disconnecting' }"); // Use buffered log
      sendResponse({ status: "disconnecting" });
    } else {
      logToBuffer("[Background:onMessage:toggle] Port is null. Calling connect()"); // Use buffered log
      connect(); // connect() is async
      logToBuffer("[Background:onMessage:toggle] Sending response { status: 'connecting' }"); // Use buffered log
      sendResponse({ status: "connecting" });
    }
    return true;
  } else if (command === "getStatus") {
    if (port) {
      logToBuffer("[Background:onMessage:getStatus] Port exists. Sending detailed status."); // Use buffered log
      sendResponse({ status: "connected", components: nativeHostStatus.components });
    } else {
      logToBuffer("[Background:onMessage:getStatus] Port is null. Sending { status: 'disconnected' }"); // Use buffered log
      sendResponse({ status: "disconnected", components: {} });
    }
    return true;
  } else if (command === "sendMessageToNative") {
    if (port) {
      try {
        logToBuffer(`[Background:onMessage:send] Port exists. Payload: ${JSON.stringify(message.payload)}`); // Use buffered log
        port.postMessage(message.payload);
        logToBuffer("[Background:onMessage:send] Sending response { status: 'sent' }"); // Use buffered log
        sendResponse({ status: "sent" });
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logToBuffer(`[Background:onMessage:send] Error posting message: ${errorMsg}`); // Use buffered log
        sendResponse({ status: "error", message: errorMsg });
      }
    } else {
      logToBuffer("[Background:onMessage:send] Port is null. Sending error."); // Use buffered log
      sendResponse({ status: "error", message: "Not connected to native host." });
    }
    return true;
  }

  logToBuffer(`[Background:onMessage] Unknown command: ${command}`); // Use buffered log
  return false;
});
logToBuffer("[Background] Attached runtime.onMessage listener."); // Use buffered log

// Store icon paths
const ICON_DEFAULT = "/icons/native-host-control-128.png";
const ICON_CONNECTED = "/icons/native-host-control-connected-128.png";

// Native Messaging logic
let port: browser.runtime.Port | null = null; // Use browser.runtime.Port type
const nativeHostName = "native_message_io_etdofresh";

function disconnect() {
  logToBuffer("[Background:disconnect] Entered disconnect function."); // Use buffered log
  if (port) {
    logToBuffer("[Background:disconnect] Port exists. Disconnecting."); // Use buffered log
    try {
      port.disconnect();
      logToBuffer("[Background:disconnect] port.disconnect() called."); // Use buffered log

      // *** Perform cleanup immediately ***
      logToBuffer("[Background:disconnect] Immediately resetting icon to default."); // Use buffered log
      browser.action.setIcon({ path: ICON_DEFAULT })
        .then(() => {
          logToBuffer("[Background:disconnect] Immediate setIcon (default) call successful."); // Use buffered log
        })
        .catch((err: Error) => {
          logToBuffer(`[Background:disconnect] Immediate setIcon (default) call FAILED: ${err.message}`); // Use buffered log
        });

      logToBuffer("[Background:disconnect] Immediately nullifying port variable and status."); // Use buffered log
      port = null;
      nativeHostStatus = { isConnected: false, components: {} }; // Reset status HERE

      // *** Notify popup IMMEDIATELY ***
      logToBuffer("[Background:disconnect] Immediately notifying popup of disconnect.");
      browser.runtime.sendMessage({ type: "NATIVE_DISCONNECTED", payload: nativeHostStatus }).catch(err => {
         if (err?.message?.includes("Could not establish connection")) return;
         logToBuffer(`[Background:disconnect:immediate] Error sending disconnect message: ${err.message}`);
      });

    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logToBuffer(`[Background:disconnect] Error during port.disconnect(): ${errorMsg}`); // Use buffered log
        port = null;
        nativeHostStatus = { isConnected: false, components: {} }; // Reset status
        browser.action.setIcon({ path: ICON_DEFAULT }).catch((e: Error) => logToBuffer(`Icon reset error after disconnect error: ${e.message}`));
        // Notify popup of disconnect even after error
        logToBuffer("[Background:disconnect] Immediately notifying popup after error.");
        browser.runtime.sendMessage({ type: "NATIVE_DISCONNECTED", payload: nativeHostStatus }).catch(err => {
           if (err?.message?.includes("Could not establish connection")) return;
           logToBuffer(`[Background:disconnect:error] Error sending disconnect message: ${err.message}`);
        });
    }
  } else {
    logToBuffer("[Background:disconnect] Port is null. Already disconnected."); // Use buffered log
  }
}

async function connect() {
  logToBuffer("[Background:connect] Entered connect function."); // Use buffered log
  if (port) {
    logToBuffer("[Background:connect] Port already exists or connecting. Exiting."); // Use buffered log
    return;
  }
  logToBuffer(`[Background:connect] Attempting browser.runtime.connectNative('${nativeHostName}')`); // Use buffered log
  try {
    port = browser.runtime.connectNative(nativeHostName);
    logToBuffer("[Background:connect] connectNative call successful (port object created)."); // Use buffered log

    logToBuffer("[Background:connect] Attaching port.onMessage listener..."); // Use buffered log
    port.onMessage.addListener((message: any) => {
      logToBuffer(`[Background:port.onMessage] Received message from native host: ${JSON.stringify(message)}`); // Use buffered log

      // *** Handle get-logs command ***
      if (message && message.command === "get-logs") {
          logToBuffer("[Background:port.onMessage] Received 'get-logs' command. Sending log buffer.");
          port?.postMessage({
              status: "logs",
              logs: consoleLogBuffer, // Send the entire buffer
          });
          return; // Don't process this command further below
      }
      // *** End handle get-logs command ***

      // Handle other specific messages like 'ready'
      if (message && message.status === "ready") {
         logToBuffer("[Background:port.onMessage] Native host ready. Setting connected icon & status."); // Use buffered log
         nativeHostStatus.isConnected = true;
         nativeHostStatus.components = message.components || {}; // Store component status
         browser.action.setIcon({ path: ICON_CONNECTED }).catch((e: Error) => logToBuffer(`Set icon error on ready: ${e.message}`));
         // Notify popup of new status
         browser.runtime.sendMessage({ type: "NATIVE_STATUS_UPDATE", payload: nativeHostStatus }).catch(err => {
            if (err?.message?.includes("Could not establish connection")) return;
            logToBuffer(`[Background:port.onMessage:ready] Error sending status update to popup: ${err.message}`);
         });
      }

      // Forward other messages to popup etc.
      browser.runtime.sendMessage({ type: "FROM_NATIVE", payload: message }).catch((err: Error) => {
         if (err?.message?.includes("Could not establish connection")) return;
         logToBuffer(`[Background:port.onMessage] Error sending message to popup: ${err.message}`); // Use buffered log
      });

    });
    logToBuffer("[Background:connect] Attached port.onMessage listener."); // Use buffered log

    logToBuffer("[Background:connect] Attaching port.onDisconnect listener..."); // Use buffered log
    port.onDisconnect.addListener(() => {
      logToBuffer("[Background:port.onDisconnect] Listener triggered."); // Use buffered log
      const disconnectedPort = port;
      const lastError = browser.runtime.lastError;

      if (lastError) {
        logToBuffer(`[Background:port.onDisconnect] Disconnected with error: ${lastError.message}`); // Use buffered log
      } else {
        logToBuffer("[Background:port.onDisconnect] Disconnected normally."); // Use buffered log
      }

      if (disconnectedPort) {
        logToBuffer("[Background:port.onDisconnect] Port reference existed. Proceeding..."); // Use buffered log
        if (port === disconnectedPort) {
            logToBuffer(`[Background:port.onDisconnect] Nullifying global port variable.`); // Use buffered log
            port = null;
        } else {
            logToBuffer("[Background:port.onDisconnect] Global port variable was already different or nullified."); // Use buffered log
        }

        // Clear status on disconnect
        // nativeHostStatus = { isConnected: false, components: {} }; // Moved to disconnect() for immediate update

        logToBuffer(`[Background:port.onDisconnect] Calling setIcon with ICON_DEFAULT: ${ICON_DEFAULT}`); // Use buffered log
        browser.action.setIcon({ path: ICON_DEFAULT })
          .then(() => {
            logToBuffer("[Background:port.onDisconnect] setIcon (default) call successful."); // Use buffered log
          })
          .catch((err: Error) => {
            logToBuffer(`[Background:port.onDisconnect] setIcon (default) call FAILED: ${err.message}`); // Use buffered log
          });

        logToBuffer("[Background:port.onDisconnect] Notifying popup."); // Use buffered log
        // Send message from here ONLY if status wasn't already cleared by disconnect()
        // This acts as a fallback.
        if (nativeHostStatus.isConnected) {
             logToBuffer("[Background:port.onDisconnect] Status was still connected, sending disconnect message as fallback.");
             nativeHostStatus = { isConnected: false, components: {} }; // Ensure reset before sending
             browser.runtime.sendMessage({ type: "NATIVE_DISCONNECTED", payload: nativeHostStatus }).catch((err: Error) => {
                 if (err?.message?.includes("Could not establish connection")) return;
                 logToBuffer(`[Background:port.onDisconnect:fallback] Error sending disconnect message: ${err.message}`);
             });
        } else {
             logToBuffer("[Background:port.onDisconnect] Status already disconnected, no message sent from listener.");
        }

      } else {
        logToBuffer("[Background:port.onDisconnect] Port reference was already null when listener triggered. No action taken."); // Use buffered log
      }
    });
    logToBuffer("[Background:connect] Attached port.onDisconnect listener."); // Use buffered log

    logToBuffer("[Background:connect] Native port listeners attached."); // Use buffered log

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logToBuffer(`[Background:connect] Error during connectNative call ${nativeHostName}: ${errorMsg}`); // Use buffered log
    port = null;
    nativeHostStatus = { isConnected: false, components: {} }; // Reset status on connection error
    logToBuffer("[Background:connect] Resetting icon due to error."); // Use buffered log
    browser.action.setIcon({ path: ICON_DEFAULT }).catch((e: Error) => logToBuffer(`Icon reset error after connect error: ${e.message}`)); // Use buffered log
    logToBuffer("[Background:connect] Notifying popup of connection error."); // Use buffered log
    browser.runtime.sendMessage({ type: "NATIVE_CONNECT_ERROR", error: errorMsg, payload: nativeHostStatus }).catch((err: Error) => {
       if (err?.message?.includes("Could not establish connection")) return;
       logToBuffer(`[Background:connect] Error sending connect error message: ${err.message}`); // Use buffered log
    });
  }
}

// Ensure the icon is default when the script starts
logToBuffer("[Background] Attaching runtime.onStartup listener..."); // Use buffered log
browser.runtime.onStartup.addListener(() => {
  logToBuffer("[Background:onStartup] Listener triggered. Setting icon..."); // Use buffered log
  browser.action.setIcon({ path: ICON_DEFAULT }).catch((e: Error) => logToBuffer(`onStartup setIcon error: ${e.message}`)); // Use buffered log
  logToBuffer("[Background:onStartup] Icon set."); // Use buffered log
});
logToBuffer("[Background] Attached runtime.onStartup listener."); // Use buffered log

logToBuffer("[Background] Attaching runtime.onInstalled listener..."); // Use buffered log
browser.runtime.onInstalled.addListener(() => {
  logToBuffer("[Background:onInstalled] Listener triggered. Setting icon..."); // Use buffered log
  browser.action.setIcon({ path: ICON_DEFAULT }).catch((e: Error) => logToBuffer(`onInstalled setIcon error: ${e.message}`)); // Use buffered log
  logToBuffer("[Background:onInstalled] Icon set."); // Use buffered log
});
logToBuffer("[Background] Attached runtime.onInstalled listener."); // Use buffered log

logToBuffer("[Background] Initial connection attempt is DISABLED."); // Use buffered log
logToBuffer("[Background] Script bottom level reached."); // Use buffered log 