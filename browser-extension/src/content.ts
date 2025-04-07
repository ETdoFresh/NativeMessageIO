// browser-extension/src/content.ts

interface ConsoleLogEntry {
    level: 'log' | 'warn' | 'error' | 'info' | 'debug';
    message: string;
    timestamp: number;
}

const MAX_BUFFERED_LOGS = 200; // Limit the number of logs stored in memory
let logBuffer: ConsoleLogEntry[] = [];
const originalConsole = { ...console }; // Store original console methods

console.log('[ContentScript] Initializing console override...');

function addToBuffer(level: ConsoleLogEntry['level'], args: any[]) {
    if (logBuffer.length >= MAX_BUFFERED_LOGS) {
        logBuffer.shift(); // Remove the oldest log
    }
    try {
        // Attempt to serialize arguments reasonably well
        const messageParts = args.map(arg => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return `Error: ${arg.message}\n${arg.stack}`;
            try {
                // Basic serialization, might need more robust handling for complex objects/circular refs
                return JSON.stringify(arg);
            } catch (e) {
                return Object.prototype.toString.call(arg); // Fallback
            }
        });
        const message = messageParts.join(' ');
        logBuffer.push({ level, message, timestamp: Date.now() });
    } catch (e) {
         // Fallback if serialization fails completely
         logBuffer.push({ level, message: '[ContentScript] Error processing log arguments.', timestamp: Date.now() });
         originalConsole.error("[ContentScript] Error processing log arguments:", e);
    }
}

// Override console methods
console.log = (...args: any[]) => {
    originalConsole.log(...args);
    addToBuffer('log', args);
};
console.warn = (...args: any[]) => {
    originalConsole.warn(...args);
    addToBuffer('warn', args);
};
console.error = (...args: any[]) => {
    originalConsole.error(...args);
    addToBuffer('error', args);
};
console.info = (...args: any[]) => {
    originalConsole.info(...args);
    addToBuffer('info', args);
};
console.debug = (...args: any[]) => {
    // Debug logs might be very verbose, only log if debugger is attached?
    // For now, we'll capture them.
    originalConsole.debug(...args);
    addToBuffer('debug', args);
};
console.clear = () => {
    originalConsole.clear();
    logBuffer = []; // Clear our buffer too
    originalConsole.log('[ContentScript] Console cleared by script.');
};

// Listen for messages from the background/commands script
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    originalConsole.log('[ContentScript] Received message:', request); // Use original console for debugging the script itself

    if (request.command === 'request_console_logs') {
        originalConsole.log('[ContentScript] Sending console log buffer:', logBuffer.length, 'entries');
        // Send a copy to avoid potential mutation issues
        sendResponse({ success: true, logs: [...logBuffer] });
        return true; // Indicate asynchronous response
    } else if (request.command === 'request_clear_console') {
        originalConsole.log('[ContentScript] Clearing console log buffer.');
        console.clear(); // Use our overridden clear which clears the buffer
        sendResponse({ success: true });
        return false; // Synchronous response
    }

    // Handle other potential commands if needed

    return false; // Indicate synchronous response for unhandled commands
});

originalConsole.log('[ContentScript] Console override active.'); 