const net = require('net');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Try both locations one at a time:
// const pipePath = path.join('\\\\.\\pipe\\', `my-test-pipe-${Date.now()}`);
const pipePath = path.join(os.tmpdir(), `my-test-pipe-${Date.now()}`);

console.log(`Attempting to listen on: ${pipePath}`);

// Cleanup function (basic)
function cleanup() {
    if (process.platform !== 'win32' && fs.existsSync(pipePath)) {
        try {
            fs.unlinkSync(pipePath);
            console.log('Cleaned up existing socket file.');
        } catch (err) {
            console.error('Error cleaning up socket file:', err);
        }
    }
}

cleanup(); // Try cleanup before starting

const server = net.createServer((socket) => {
    console.log('Client connected!');
    socket.end('Hello from pipe server!\n');
});

server.on('error', (err) => {
    console.error('FATAL SERVER ERROR:', err);
    process.exit(1); // Exit on error
});

server.listen(pipePath, () => {
    console.log(`Server listening successfully on ${pipePath}`);
    // Keep server running briefly for testing
    setTimeout(() => {
        console.log('Closing server.');
        server.close();
        cleanup(); // Cleanup on close
    }, 10000);
});

process.on('SIGINT', () => {
    console.log('SIGINT received. Closing server.');
    server.close(() => {
         cleanup();
         process.exit(0);
    });
}); 