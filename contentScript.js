// This script runs in the context of each frame and communicates with the background script

// Store information about the current frame
let frameInfo = {
    listeners: [],
    path: "",
    logEnabled: false, // Default to false
    consoleEnhancementEnabled: true,
    reroutingEnabled: true
};

// Create a unique path for this frame
function calculateFramePath() {
    try {
        let path = "";
        let currentWindow = window;
        let parentWindow = window.parent;

        // If this is the top frame, path is just "top"
        if (currentWindow === top) {
            return "top";
        }

        // For iframes, try to find the frame index
        while (currentWindow !== top) {
            if (parentWindow) {
                const frames = parentWindow.frames;
                for (let i = 0; i < frames.length; i++) {
                    if (frames[i] === currentWindow) {
                        path = `.frames[${i}]${path}`;
                        break;
                    }
                }
                currentWindow = parentWindow;
                parentWindow = currentWindow.parent;
            } else {
                break;
            }
        }

        return `top${path}`;
    } catch (e) {
        // Cross-origin restrictions might prevent path calculation
        return "unknown-frame";
    }
}

// Inject the page script to monitor postMessage
function injectPageScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('pageScript.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
}

// Register this frame with the background script
function registerFrame() {
    frameInfo.path = calculateFramePath();

    chrome.runtime.sendMessage({
        type: "REGISTER_FRAME",
        listeners: frameInfo.listeners,
        path: frameInfo.path
    }).catch(err => {
        console.debug("PostMessage Monitor: Error registering frame", err);
    });
}

// Listen for events from the injected page script
window.addEventListener('message', function (event) {
    // Only listen to our special events
    if (event.data && event.data.__postMessageMonitor) {
        const monitorData = event.data.__postMessageMonitor;

        if (monitorData.type === "LISTENERS_UPDATED") {
            // Update listeners list
            frameInfo.listeners = monitorData.listeners;

            // Send updated listeners to background
            chrome.runtime.sendMessage({
                type: "UPDATE_LISTENERS",
                listeners: frameInfo.listeners
            }).catch(err => {
                console.debug("PostMessage Monitor: Error updating listeners", err);
            });
        }
        else if (monitorData.type === "MESSAGE_SENT") {
            // Always log outgoing message, but mark whether console logging should happen based on frameInfo.logEnabled
            chrome.runtime.sendMessage({
                type: "LOG_MESSAGE",
                direction: "OUTGOING",
                source: frameInfo.path,
                target: monitorData.targetOrigin || "any",
                data: monitorData.data,
                timestamp: Date.now(),
                path: `${frameInfo.path}.postMessage(${JSON.stringify(monitorData.data)}, "${monitorData.targetOrigin || '*'}")`,
                consoleLog: frameInfo.logEnabled
            }).catch(err => {
                console.debug("PostMessage Monitor: Error logging outgoing message", err);
            });
        }
        else if (monitorData.type === "MESSAGE_RECEIVED") {
            // Always log incoming message, but mark whether console logging should happen based on frameInfo.logEnabled
            chrome.runtime.sendMessage({
                type: "LOG_MESSAGE",
                direction: "INCOMING",
                source: monitorData.sourceOrigin || "unknown",
                target: frameInfo.path,
                data: monitorData.data,
                timestamp: Date.now(),
                path: frameInfo.path,
                consoleLog: frameInfo.logEnabled
            }).catch(err => {
                console.debug("PostMessage Monitor: Error logging incoming message", err);
            });
        }
    }
});

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "UPDATE_LOGGING") {
        frameInfo.logEnabled = message.enabled;

        // Forward to page script
        window.postMessage({
            __postMessageMonitorControl: {
                type: "UPDATE_LOGGING",
                enabled: message.enabled
            }
        }, "*");
    }
    else if (message.type === "UPDATE_CONSOLE_ENHANCEMENT") {
        frameInfo.consoleEnhancementEnabled = message.enabled;

        // Forward to page script
        window.postMessage({
            __postMessageMonitorControl: {
                type: "UPDATE_CONSOLE_ENHANCEMENT",
                enabled: message.enabled
            }
        }, "*");
    }
    else if (message.type === "UPDATE_REROUTING") {
        frameInfo.reroutingEnabled = message.enabled;

        // Forward to page script
        window.postMessage({
            __postMessageMonitorControl: {
                type: "UPDATE_REROUTING",
                enabled: message.enabled
            }
        }, "*");
    }
    else if (message.type === "INIT_SETTINGS" && message.settings) {
        // Apply all settings at once
        frameInfo.logEnabled = message.settings.logEnabled;
        frameInfo.consoleEnhancementEnabled = message.settings.consoleEnhancementEnabled;
        frameInfo.reroutingEnabled = message.settings.reroutingEnabled;

        // Forward all settings to page script
        window.postMessage({
            __postMessageMonitorControl: {
                type: "INIT_SETTINGS",
                settings: message.settings
            }
        }, "*");
    }
    else if (message.type === "TEST_POSTMESSAGE") {
        // Send a test postMessage to see if listeners catch it
        window.postMessage({
            __postMessageMonitorTest: true,
            data: message.data
        }, "*");
    }
});

// Initialize as soon as the content script runs
injectPageScript();
registerFrame();