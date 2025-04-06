import path from 'path';
import * as os from 'os';

// --- Configuration ---
export const HTTP_PORT = process.env.NATIVE_MESSAGE_IO_PORT || 3580; // Use env var or default
export const SERVER_NAME = "native-message-io-multi";
export const SERVER_VERSION = "1.2.1";

// --- IPC Configuration ---
export const PIPE_NAME = 'native-message-io-ipc-pipe';

// Construct the correct path based on the platform
export const PIPE_PATH = process.platform === 'win32'
    ? path.join('\\\\.\\pipe\\', PIPE_NAME) // Windows named pipe path
    : path.join(os.tmpdir(), `${PIPE_NAME}.sock`); // Unix domain socket path in /tmp 