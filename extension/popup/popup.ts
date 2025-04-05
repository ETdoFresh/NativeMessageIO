const statusDiv = document.getElementById('status') as HTMLDivElement;
const toggleButton = document.getElementById('toggle-button') as HTMLButtonElement;

// Function to update UI based on connection status
function updateUI(isConnected: boolean, statusText?: string) {
    if (isConnected) {
        statusDiv.textContent = statusText || 'Status: Connected';
        toggleButton.textContent = 'Disconnect';
    } else {
        statusDiv.textContent = statusText || 'Status: Disconnected';
        toggleButton.textContent = 'Connect';
    }
}

// Handle button click
toggleButton.addEventListener('click', async () => {
    try {
        const response = await browser.runtime.sendMessage({ command: "toggle" });
        updateUI(response.isConnected, response.statusText);
    } catch (error) {
        statusDiv.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error("Error toggling connection:", error);
    }
});

// Get initial status when popup opens
async function getInitialStatus() {
    try {
        const response = await browser.runtime.sendMessage({ command: "getStatus" });
        updateUI(response.isConnected, response.statusText);
    } catch (error) {
        // If background script isn't ready, it might throw an error.
        // Assume disconnected initially.
        console.warn("Could not get initial status:", error);
        updateUI(false, "Status: Error fetching status");
    }
}

// Listen for status updates from the background script
browser.runtime.onMessage.addListener((message) => {
    if (message.command === "statusUpdate") {
        updateUI(message.isConnected, message.statusText);
    }
});

getInitialStatus(); 