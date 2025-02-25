let tabData = {};

// Initialize data for a tab
function initTabData(tabId) {
    if (!tabData[tabId]) {
        // Create default tab data
        tabData[tabId] = {
            frames: {},
            totalListeners: 0,
            logEnabled: false,
            consoleEnhancementEnabled: true,
            reroutingEnabled: true,
            capturedMessages: []
        };

        // Try to load saved settings for this tab
        chrome.storage.local.get([`tab_${tabId}_settings`], (result) => {
            const savedSettings = result[`tab_${tabId}_settings`];
            if (savedSettings) {
                // Apply saved settings
                tabData[tabId].logEnabled = savedSettings.logEnabled;
                tabData[tabId].consoleEnhancementEnabled = savedSettings.consoleEnhancementEnabled;
                tabData[tabId].reroutingEnabled = savedSettings.reroutingEnabled;
            }
        }).catch(() => { });
    }
}

// Save tab settings
function saveTabSettings(tabId) {
    if (!tabData[tabId]) return;

    chrome.storage.local.set({
        [`tab_${tabId}_settings`]: {
            logEnabled: tabData[tabId].logEnabled,
            consoleEnhancementEnabled: tabData[tabId].consoleEnhancementEnabled,
            reroutingEnabled: tabData[tabId].reroutingEnabled
        }
    }).catch(err => console.error("Error saving settings", err));
}

// Safe wrapper for sending messages
function safeSendMessage(tabId, message, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.sendMessage(tabId, message, options, (response) => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    console.log(`Error sending message to tab ${tabId}:`, lastError.message);
                    resolve(null); // Resolve with null to avoid unhandled rejections
                } else {
                    resolve(response);
                }
            });
        } catch (e) {
            console.error(`Exception sending message to tab ${tabId}:`, e);
            resolve(null);
        }
    });
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // If this is from a content script, get the tab ID
    const tabId = sender.tab ? sender.tab.id : null;

    // Only initialize tab data if we have a valid tabId
    if (tabId !== null) {
        initTabData(tabId);
    }

    if (message.type === "REGISTER_FRAME" && tabId !== null) {
        // Register frame info
        const frameId = sender.frameId;
        tabData[tabId].frames[frameId] = {
            url: sender.url,
            listeners: message.listeners || [],
            path: message.path || ""
        };

        // Update total listener count
        updateListenerCount(tabId);

        // Notify popup about the update
        try {
            chrome.runtime.sendMessage({
                type: "STATE_UPDATED"
            }).catch(() => { }); // Ignore errors if popup isn't open
        } catch (e) {
            // Ignore errors if popup isn't open
        }

        // IMPORTANT: Send current logging state to the newly registered frame
        // This ensures the frame immediately knows if logging is enabled
        safeSendMessage(tabId, {
            type: "UPDATE_LOGGING",
            enabled: tabData[tabId].logEnabled
        }, { frameId: frameId }).catch(() => { });

        // Also send other settings
        safeSendMessage(tabId, {
            type: "UPDATE_CONSOLE_ENHANCEMENT",
            enabled: tabData[tabId].consoleEnhancementEnabled
        }, { frameId: frameId }).catch(() => { });

        safeSendMessage(tabId, {
            type: "UPDATE_REROUTING",
            enabled: tabData[tabId].reroutingEnabled
        }, { frameId: frameId }).catch(() => { });
    }
    else if (message.type === "UPDATE_LISTENERS" && tabId !== null) {
        // Update frame listener info
        const frameId = sender.frameId;
        if (tabData[tabId].frames[frameId]) {
            tabData[tabId].frames[frameId].listeners = message.listeners;
            updateListenerCount(tabId);

            // Notify popup about the update
            try {
                chrome.runtime.sendMessage({
                    type: "STATE_UPDATED"
                }).catch(() => { }); // Ignore errors if popup isn't open
            } catch (e) {
                // Ignore errors if popup isn't open
            }
        }
    }
    else if (message.type === "LOG_MESSAGE" && tabId !== null) {
        // Always store message
        tabData[tabId].capturedMessages.push(message);

        // Limit stored messages to last 500 to prevent memory issues
        if (tabData[tabId].capturedMessages.length > 500) {
            tabData[tabId].capturedMessages = tabData[tabId].capturedMessages.slice(-500);
        }

        // Forward to popup for display (always)
        try {
            chrome.runtime.sendMessage({
                type: "MESSAGE_LOGGED",
                data: message
            }).catch(() => { }); // Ignore errors if popup isn't open
        } catch (e) {
            // Ignore errors if popup isn't open
        }

        // Only log to background console if logging is enabled and the message is marked for console logging
        if (tabData[tabId].logEnabled && message.consoleLog) {
            console.log(`[PostMessage Monitor] ${message.direction}:`, {
                source: message.source,
                target: message.target,
                data: message.data,
                timestamp: message.timestamp,
                path: message.path
            });
        }
    }
    else if (message.type === "GET_STATE") {
        // If this is from popup (no tabId), get active tab first
        if (tabId === null) {
            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                if (tabs.length === 0) {
                    sendResponse({
                        totalListeners: 0,
                        frames: {},
                        logEnabled: false,
                        capturedMessages: []
                    });
                    return;
                }

                const activeTabId = tabs[0].id;
                initTabData(activeTabId);

                // Create a safe copy of the data
                const safeData = {
                    totalListeners: tabData[activeTabId].totalListeners,
                    frames: tabData[activeTabId].frames,
                    logEnabled: tabData[activeTabId].logEnabled,
                    consoleEnhancementEnabled: tabData[activeTabId].consoleEnhancementEnabled,
                    reroutingEnabled: tabData[activeTabId].reroutingEnabled,
                    capturedMessages: tabData[activeTabId].capturedMessages.slice(-100) // Only return last 100 messages
                };

                sendResponse(safeData);
            });
            return true; // Keep connection open for async response
        } else {
            // Direct response for content script requests
            sendResponse({
                totalListeners: tabData[tabId].totalListeners,
                frames: tabData[tabId].frames,
                logEnabled: tabData[tabId].logEnabled,
                consoleEnhancementEnabled: tabData[tabId].consoleEnhancementEnabled,
                reroutingEnabled: tabData[tabId].reroutingEnabled
            });
        }
    }
    else if (message.type === "SET_LOGGING") {
        // If from popup (no tabId), get active tab first
        if (tabId === null) {
            chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
                if (tabs.length === 0) return;

                const activeTabId = tabs[0].id;
                initTabData(activeTabId);

                // Enable/disable logging
                tabData[activeTabId].logEnabled = message.enabled;

                // Save settings
                saveTabSettings(activeTabId);

                // Notify all frames about logging state
                for (const frameId of Object.keys(tabData[activeTabId].frames)) {
                    await safeSendMessage(activeTabId, {
                        type: "UPDATE_LOGGING",
                        enabled: message.enabled
                    }, { frameId: parseInt(frameId) });
                }

                // Send response if callback provided
                if (sendResponse) {
                    sendResponse({ success: true });
                }
            });
            return true; // Keep connection open for async response
        } else {
            // Direct update for the specific tab
            tabData[tabId].logEnabled = message.enabled;

            // Save settings
            saveTabSettings(tabId);

            // Notify all frames about logging state - use async/await pattern with safeSendMessage
            (async () => {
                for (const frameId of Object.keys(tabData[tabId].frames)) {
                    await safeSendMessage(tabId, {
                        type: "UPDATE_LOGGING",
                        enabled: message.enabled
                    }, { frameId: parseInt(frameId) });
                }

                // Send response if callback provided
                if (sendResponse) {
                    sendResponse({ success: true });
                }
            })();

            return true; // Keep the channel open for the async response
        }
    }
    else if (message.type === "SET_CONSOLE_ENHANCEMENT") {
        // Enable/disable console enhancement
        if (tabId === null) {
            chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
                if (tabs.length === 0) return;

                const activeTabId = tabs[0].id;
                initTabData(activeTabId);

                tabData[activeTabId].consoleEnhancementEnabled = message.enabled;

                // Save settings
                saveTabSettings(activeTabId);

                // Notify all frames
                for (const frameId of Object.keys(tabData[activeTabId].frames)) {
                    await safeSendMessage(activeTabId, {
                        type: "UPDATE_CONSOLE_ENHANCEMENT",
                        enabled: message.enabled
                    }, { frameId: parseInt(frameId) });
                }

                // Send response if callback provided
                if (sendResponse) {
                    sendResponse({ success: true });
                }
            });
            return true; // Keep connection open for async response
        } else {
            tabData[tabId].consoleEnhancementEnabled = message.enabled;

            // Save settings
            saveTabSettings(tabId);

            // Notify all frames - use async/await pattern with safeSendMessage
            (async () => {
                for (const frameId of Object.keys(tabData[tabId].frames)) {
                    await safeSendMessage(tabId, {
                        type: "UPDATE_CONSOLE_ENHANCEMENT",
                        enabled: message.enabled
                    }, { frameId: parseInt(frameId) });
                }

                // Send response if callback provided
                if (sendResponse) {
                    sendResponse({ success: true });
                }
            })();

            return true; // Keep the channel open for the async response
        }
    }
    else if (message.type === "SET_REROUTING") {
        // Enable/disable message rerouting
        if (tabId === null) {
            chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
                if (tabs.length === 0) return;

                const activeTabId = tabs[0].id;
                initTabData(activeTabId);

                tabData[activeTabId].reroutingEnabled = message.enabled;

                // Save settings
                saveTabSettings(activeTabId);

                // Notify all frames
                for (const frameId of Object.keys(tabData[activeTabId].frames)) {
                    await safeSendMessage(activeTabId, {
                        type: "UPDATE_REROUTING",
                        enabled: message.enabled
                    }, { frameId: parseInt(frameId) });
                }

                // Send response if callback provided
                if (sendResponse) {
                    sendResponse({ success: true });
                }
            });
            return true; // Keep connection open for async response
        } else {
            tabData[tabId].reroutingEnabled = message.enabled;

            // Save settings
            saveTabSettings(tabId);

            // Notify all frames - use async/await pattern with safeSendMessage
            (async () => {
                for (const frameId of Object.keys(tabData[tabId].frames)) {
                    await safeSendMessage(tabId, {
                        type: "UPDATE_REROUTING",
                        enabled: message.enabled
                    }, { frameId: parseInt(frameId) });
                }

                // Send response if callback provided
                if (sendResponse) {
                    sendResponse({ success: true });
                }
            })();

            return true; // Keep the channel open for the async response
        }
    }
    else if (message.type === "CLEAR_MESSAGES") {
        // Clear captured messages for a tab
        if (tabId === null) {
            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                if (tabs.length === 0) return;

                const activeTabId = tabs[0].id;
                initTabData(activeTabId);

                tabData[activeTabId].capturedMessages = [];

                // Send response if callback provided
                if (sendResponse) {
                    sendResponse({ success: true });
                }
            });
            return true; // Keep connection open for async response
        } else {
            tabData[tabId].capturedMessages = [];

            // Send response if callback provided
            if (sendResponse) {
                sendResponse({ success: true });
            }
        }
    }

    // Return false for synchronous messages
    return false;
});

// Update badge with listener count
function updateListenerCount(tabId) {
    let total = 0;

    // Count listeners across all frames
    Object.values(tabData[tabId].frames).forEach(frame => {
        total += frame.listeners.length;
    });

    tabData[tabId].totalListeners = total;

    // Update badge - using try/catch to handle potential errors
    try {
        chrome.action.setBadgeText({
            text: total.toString(),
            tabId: tabId
        });

        chrome.action.setBadgeBackgroundColor({
            color: total > 0 ? "#cc0000" : "#4688f1",
            tabId: tabId
        });
    } catch (e) {
        console.error("PostMessage Monitor: Error updating badge", e);
    }
}

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    delete tabData[tabId];
});

// Set up navigation handlers to maintain state during navigation
function setupNavigationHandlers() {
    // Listen for tab updates (like refreshes)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        // Only handle when the tab is done loading (to make sure content scripts are ready)
        if (changeInfo.status === 'complete') {
            if (tabData[tabId]) {
                // Delay slightly to allow content scripts to initialize
                setTimeout(() => {
                    // Broadcast current settings to all frames
                    const settings = {
                        logEnabled: tabData[tabId].logEnabled,
                        consoleEnhancementEnabled: tabData[tabId].consoleEnhancementEnabled,
                        reroutingEnabled: tabData[tabId].reroutingEnabled
                    };

                    // Send to all frames (not just ones we know about, as they might have changed)
                    chrome.tabs.sendMessage(tabId, {
                        type: "INIT_SETTINGS",
                        settings: settings
                    }).catch(() => { });
                }, 500);
            }
        }
    });
}

// Reset on navigation
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0) { // Main frame only
        // Initialize tab data but preserve settings
        const oldSettings = tabData[details.tabId] ? {
            logEnabled: tabData[details.tabId].logEnabled,
            consoleEnhancementEnabled: tabData[details.tabId].consoleEnhancementEnabled,
            reroutingEnabled: tabData[details.tabId].reroutingEnabled,
            capturedMessages: tabData[details.tabId].capturedMessages || []
        } : null;

        initTabData(details.tabId);
        tabData[details.tabId].frames = {};

        // Restore settings if they exist
        if (oldSettings) {
            tabData[details.tabId].logEnabled = oldSettings.logEnabled;
            tabData[details.tabId].consoleEnhancementEnabled = oldSettings.consoleEnhancementEnabled;
            tabData[details.tabId].reroutingEnabled = oldSettings.reroutingEnabled;
            tabData[details.tabId].capturedMessages = oldSettings.capturedMessages;
        }

        updateListenerCount(details.tabId);
    }
});

// Initialize navigation handlers when the background script loads
setupNavigationHandlers();