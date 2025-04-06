// Extension interaction logic (popup, options, etc.)
console.log("[Background] Script top level.");

// Listener for messages FROM POPUP or other extension parts
console.log("[Background] Attaching runtime.onMessage listener...");
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Background:onMessage] Received message from extension: ", message);
  const command = message?.command;

  if (command === "toggle") {
    if (port) {
      console.log("[Background:onMessage:toggle] Port exists. Calling disconnect()");
      disconnect();
      console.log("[Background:onMessage:toggle] Sending response { status: 'disconnecting' }");
      // In Firefox, sendResponse is sync, but returning true/Promise still works for async
      sendResponse({ status: "disconnecting" });
    } else {
      console.log("[Background:onMessage:toggle] Port is null. Calling connect()");
      connect(); // connect() is async
      console.log("[Background:onMessage:toggle] Sending response { status: 'connecting' }");
      // Send an initial acknowledgement
      sendResponse({ status: "connecting" });
    }
    // Indicate potential async response (required if connect() might be async)
    return true;
  } else if (command === "getStatus") {
    if (port) {
      console.log("[Background:onMessage:getStatus] Port exists. Sending { status: 'connected' }");
      sendResponse({ status: "connected" });
    } else {
      console.log("[Background:onMessage:getStatus] Port is null. Sending { status: 'disconnected' }");
      sendResponse({ status: "disconnected" });
    }
    return true; // Indicate potential async response
  } else if (command === "sendMessageToNative") {
    if (port) {
      try {
        console.log("[Background:onMessage:send] Port exists. Payload:", message.payload);
        port.postMessage(message.payload);
        console.log("[Background:onMessage:send] Sending response { status: 'sent' }");
        sendResponse({ status: "sent" });
      } catch (e) {
        console.error("[Background:onMessage:send] Error posting message:", e);
        console.log("[Background:onMessage:send] Sending error response");
        sendResponse({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    } else {
      console.log("[Background:onMessage:send] Port is null. Sending error.");
      sendResponse({ status: "error", message: "Not connected to native host." });
    }
    return true;
  }

  console.log("[Background:onMessage] Unknown command:", command);
  return false;
});
console.log("[Background] Attached runtime.onMessage listener.");

// Store icon paths
const ICON_DEFAULT = "/icons/native-host-control-128.png";
const ICON_CONNECTED = "/icons/native-host-control-connected-128.png";

// Native Messaging logic
let port: browser.runtime.Port | null = null; // Use browser.runtime.Port type
const nativeHostName = "native_message_io_etdofresh";

function disconnect() {
  console.log("[Background:disconnect] Entered disconnect function.");
  if (port) {
    console.log("[Background:disconnect] Port exists. Disconnecting.");
    try {
      port.disconnect();
      console.log("[Background:disconnect] port.disconnect() called.");

      // *** Perform cleanup immediately since onDisconnect might not fire reliably ***
      console.log("[Background:disconnect] Immediately resetting icon to default.");
      browser.action.setIcon({ path: ICON_DEFAULT })
        .then(() => {
          console.log("[Background:disconnect] Immediate setIcon (default) call successful.");
        })
        .catch(err => {
          console.error("[Background:disconnect] Immediate setIcon (default) call FAILED:", err);
        });

      console.log("[Background:disconnect] Immediately nullifying port variable.");
      port = null;

    } catch (e) {
        console.error("[Background:disconnect] Error during port.disconnect():", e);
        // Even if disconnect errors, try to nullify port and reset icon
        port = null;
        browser.action.setIcon({ path: ICON_DEFAULT }).catch(console.error);
    }
  } else {
    console.log("[Background:disconnect] Port is null. Already disconnected.");
  }
}

async function connect() {
  console.log("[Background:connect] Entered connect function."); // <-- Log entry
  if (port) {
    console.log("[Background:connect] Port already exists or connecting. Exiting.");
    return;
  }
  console.log(`[Background:connect] Attempting browser.runtime.connectNative('${nativeHostName}')`);
  try {
    port = browser.runtime.connectNative(nativeHostName);
    console.log("[Background:connect] connectNative call successful (port object created).");

    console.log("[Background:connect] Attaching port.onMessage listener...");
    port.onMessage.addListener((message: any) => {
      console.log("[Background:port.onMessage] Received message from native host: ", message);
      browser.runtime.sendMessage({ type: "FROM_NATIVE", payload: message }).catch(err => {
         if (err?.message?.includes("Could not establish connection")) return;
         console.error("[Background:port.onMessage] Error sending message to popup:", err);
      });
      if (message && message.status === "ready") {
         console.log("[Background:port.onMessage] Native host ready. Setting connected icon.");
         browser.action.setIcon({ path: ICON_CONNECTED }).catch(console.error);
      }
    });
    console.log("[Background:connect] Attached port.onMessage listener.");

    console.log("[Background:connect] Attaching port.onDisconnect listener...");
    port.onDisconnect.addListener(() => {
      console.log("[Background:port.onDisconnect] Listener triggered.");
      // Capture the reference to the port *at the time the listener fired*
      const disconnectedPort = port;
      const lastError = browser.runtime.lastError;

      if (lastError) {
        console.error("[Background:port.onDisconnect] Disconnected with error:", lastError.message);
      } else {
        console.log("[Background:port.onDisconnect] Disconnected normally.");
      }

      // Check if the port we are handling the disconnect for is the one we expected
      if (disconnectedPort) {
        console.log("[Background:port.onDisconnect] Port reference existed. Proceeding...");

        // Nullify the global port variable if it still matches the disconnected one
        if (port === disconnectedPort) {
            console.log("[Background:port.onDisconnect] Nullifying global port variable.");
            port = null;
        } else {
            console.log("[Background:port.onDisconnect] Global port variable was already different or nullified.");
        }

        console.log(`[Background:port.onDisconnect] Calling setIcon with ICON_DEFAULT: ${ICON_DEFAULT}`);
        browser.action.setIcon({ path: ICON_DEFAULT })
          .then(() => {
            console.log("[Background:port.onDisconnect] setIcon (default) call successful.");
          })
          .catch(err => {
            console.error("[Background:port.onDisconnect] setIcon (default) call FAILED:", err);
          });

        console.log("[Background:port.onDisconnect] Notifying popup.");
        browser.runtime.sendMessage({ type: "NATIVE_DISCONNECTED" }).catch(err => {
           if (err?.message?.includes("Could not establish connection")) return;
           console.error("[Background:port.onDisconnect] Error sending disconnect message:", err);
        });
      } else {
        // This case should ideally not happen if disconnect() ensures port exists before calling port.disconnect()
        console.log("[Background:port.onDisconnect] Port reference was already null when listener triggered. No action taken.");
      }
    });
    console.log("[Background:connect] Attached port.onDisconnect listener.");

    console.log("[Background:connect] Native port listeners attached.");

  } catch (error) {
    console.error(`[Background:connect] Error during connectNative call ${nativeHostName}:`, error);
    port = null;
    console.log("[Background:connect] Resetting icon due to error.");
    browser.action.setIcon({ path: ICON_DEFAULT }).catch(console.error);
    console.log("[Background:connect] Notifying popup of connection error.");
    browser.runtime.sendMessage({ type: "NATIVE_CONNECT_ERROR", error: error instanceof Error ? error.message : String(error) }).catch(err => {
       if (err?.message?.includes("Could not establish connection")) return;
       console.error("[Background:connect] Error sending connect error message:", err);
    });
  }
}

// Ensure the icon is default when the script starts
console.log("[Background] Attaching runtime.onStartup listener...");
browser.runtime.onStartup.addListener(() => {
  console.log("[Background:onStartup] Listener triggered. Setting icon...");
  browser.action.setIcon({ path: ICON_DEFAULT }).catch(console.error);
  console.log("[Background:onStartup] Icon set.");
});
console.log("[Background] Attached runtime.onStartup listener.");

console.log("[Background] Attaching runtime.onInstalled listener...");
browser.runtime.onInstalled.addListener(() => {
  console.log("[Background:onInstalled] Listener triggered. Setting icon...");
  browser.action.setIcon({ path: ICON_DEFAULT }).catch(console.error);
  console.log("[Background:onInstalled] Icon set.");
});
console.log("[Background] Attached runtime.onInstalled listener.");

// Attempt initial connection when background script loads
console.log("[Background] Initial connection attempt is DISABLED.");
/* // Commented out auto-connect
try {
  connect();
  console.log("[Background] Initial connect() call finished.");
} catch (error) {
  console.error("[Background] Error directly calling connect() at end of script:", error);
}
*/
console.log("[Background] Script bottom level reached."); 