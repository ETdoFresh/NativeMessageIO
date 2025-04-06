// Content from browser-extension/src/popup/popup.ts
console.log("[Popup] Script top level - waiting for DOMContentLoaded.");

document.addEventListener('DOMContentLoaded', () => {
    console.log("[Popup] DOMContentLoaded event fired.");

    const statusDiv = document.getElementById('status') as HTMLDivElement;
    const toggleButton = document.getElementById('toggle-button') as HTMLButtonElement;
    const iconImage = document.getElementById('popup-icon-img') as HTMLImageElement;

    // Icon paths relative to popup.html in the *dist* folder
    const ICON_IMG_DEFAULT = "native-host-control-128.png";
    const ICON_IMG_CONNECTED = "native-host-control-connected-128.png";

    console.log(`[Popup] Elements acquired: statusDiv=${!!statusDiv}, toggleButton=${!!toggleButton}, iconImage=${!!iconImage}`);

    // Ensure elements were found before proceeding
    if (!statusDiv || !toggleButton || !iconImage) {
        console.error("[Popup] FATAL: Could not find essential UI elements after DOMContentLoaded!");
        // Optionally display an error message in the popup body
        document.body.textContent = "Error: Popup UI elements missing.";
        return; // Stop execution if elements are missing
    }

    // Function to update UI based on connection status
    function updateUI(isConnected: boolean, statusText?: string) {
        console.log(`[Popup:updateUI] Called with isConnected=${isConnected}, statusText=${statusText}`);
        // Elements are checked above
        if (isConnected) {
            console.log("[Popup:updateUI] Setting state to Connected.");
            statusDiv.textContent = statusText || 'Status: Connected';
            toggleButton.textContent = 'Disconnect';
            iconImage.src = ICON_IMG_CONNECTED;
        } else {
            console.log("[Popup:updateUI] Setting state to Disconnected.");
            statusDiv.textContent = statusText || 'Status: Disconnected';
            toggleButton.textContent = 'Connect';
            iconImage.src = ICON_IMG_DEFAULT;
        }
    }

    // Handle button click
    toggleButton.addEventListener('click', async () => {
        console.log("[Popup] Toggle button clicked.");
        try {
            console.log("[Popup] Sending toggle command...");
            const response = await browser.runtime.sendMessage({ command: "toggle" });
            console.log("[Popup] Toggle response received:", response);
            if (response?.status === 'connecting') {
                updateUI(false, "Status: Connecting...");
            } else if (response?.status === 'disconnecting') {
                updateUI(false); // Directly set to disconnected state
            }
        } catch (error) {
            const errorMessage = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
            console.error("[Popup] Error toggling connection:", error);
            if (statusDiv) statusDiv.textContent = errorMessage;
        }
    });
    console.log("[Popup] Added toggle button listener.");

    // Get initial status when popup opens
    async function getInitialStatus() {
        console.log("[Popup:getInitialStatus] Entered.");
        try {
            console.log("[Popup:getInitialStatus] Sending getStatus command...");
            const response = await browser.runtime.sendMessage({ command: "getStatus" });
            console.log("[Popup:getInitialStatus] Received response:", response);

            if (response?.status === 'connected') {
                console.log("[Popup:getInitialStatus] Status is connected, calling updateUI(true).");
                updateUI(true);
            } else {
                console.log("[Popup:getInitialStatus] Status is disconnected, calling updateUI(false).");
                updateUI(false);
            }
        } catch (error) {
            console.warn("[Popup:getInitialStatus] Error fetching status:", error);
            console.log("[Popup:getInitialStatus] Calling updateUI(false, error message).");
            updateUI(false, "Status: Error fetching status");
        }
    }

    // Listen for status updates FROM BACKGROUND SCRIPT
    console.log("[Popup] Adding runtime.onMessage listener.");
    browser.runtime.onMessage.addListener((message) => {
        console.log("[Popup:onMessage] Received message:", message);
        if (message?.type === "NATIVE_DISCONNECTED" || message?.type === "NATIVE_CONNECT_ERROR") {
            console.log("[Popup:onMessage] Handling disconnect/error message.");
            updateUI(false, message.error ? `Error: ${message.error}` : "Status: Disconnected");
        } else if (message?.type === "FROM_NATIVE" && message.payload?.status === 'ready') {
            console.log("[Popup:onMessage] Handling native host ready message.");
            updateUI(true);
        }
    });
    console.log("[Popup] Added runtime.onMessage listener.");

    console.log("[Popup] DOM Ready. Calling getInitialStatus()...");
    getInitialStatus();
    console.log("[Popup] getInitialStatus() called.");
}); // End of DOMContentLoaded listener