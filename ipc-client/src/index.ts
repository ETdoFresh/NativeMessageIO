import * as net from 'net';
import * as process from 'process';
import * as path from 'path';

// Get the same pipe path used by the server
const PIPE_DIR = process.platform === 'win32' ? '\\\\.\\pipe\\' : '/tmp';
const PIPE_NAME = 'native-message-io-ipc-pipe';
const PIPE_PATH = process.platform === 'win32' ? path.join(PIPE_DIR, PIPE_NAME) : path.join(PIPE_DIR, `${PIPE_NAME}.sock`);

// Get message from command line arguments
const messageToSend = process.argv[2];

if (!messageToSend) {
    console.error("Usage: node dist/index.js <message_to_send>");
    process.exit(1);
}

console.log(`Attempting to connect to IPC server at: ${PIPE_PATH}`);
const client: net.Socket = net.createConnection({ path: PIPE_PATH }, () => {
    console.log('Connected to IPC server.');
    console.log(`Sending message: "${messageToSend}"`);
    client.write(messageToSend);
});

client.on('data', (data: Buffer) => {
    console.log('Received from server:', data.toString());
    // Assuming server sends a confirmation and then we can close
    client.end(); // Close the connection gracefully
});

client.on('end', () => {
    console.log('Disconnected from IPC server.');
});

client.on('error', (err: NodeJS.ErrnoException) => {
    console.error('IPC Client Error:', err.message);
    if (err.code === 'ENOENT') {
        console.error(`Error: Could not connect to pipe ${PIPE_PATH}. Is the native host running?`);
    }
    process.exit(1);
});

// Handle timeout just in case
client.setTimeout(5000, () => {
     console.error('Connection timed out.');
     client.end();
     process.exit(1);
}); 