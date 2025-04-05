// Define the name of the native application (must match the native app manifest)
const NATIVE_APP_NAME = "native_logger_app"; // Choose a name

function onResponse(response: any) {
  console.log(`Received response from native app: ${JSON.stringify(response)}`);
}

function onError(error: Error) {
  console.error(`Error communicating with native app: ${error.message}`);
}

// Listener for the browser action click
browser.browserAction.onClicked.addListener(() => {
  const message = { text: "Hello from Firefox Extension!" };
  console.log(`Sending message to native app (${NATIVE_APP_NAME}):`, message);

  const sending = browser.runtime.sendNativeMessage(
    NATIVE_APP_NAME,
    message // Message must be JSON-serializable
  );

  sending.then(onResponse, onError);
});

console.log("Background script loaded for Native Message Sender."); 