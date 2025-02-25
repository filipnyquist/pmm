document.addEventListener('DOMContentLoaded', function () {
    const totalCountElement = document.getElementById('totalCount');
    const framesContainer = document.getElementById('framesContainer');
    const messagesContainer = document.getElementById('messagesContainer');
    const loggingToggle = document.getElementById('loggingToggle');
    const autoUpdateToggle = document.getElementById('autoUpdateToggle');
    const enhanceConsoleToggle = document.getElementById('enhanceConsoleToggle');
    const rerouteToggle = document.getElementById('reroute-messages');
    const clearMessagesBtn = document.getElementById('clearMessagesBtn');
    const testPostMessageBtn = document.getElementById('testPostMessageBtn');
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    // Captured messages
    let capturedMessages = [];

    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs and contents
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            // Add active class to current tab and content
            tab.classList.add('active');
            const tabName = tab.getAttribute('data-tab');
            document.getElementById(`${tabName}-tab`).classList.add('active');
        });
    });

    // Function to update the UI with the latest state
    function updateUI(response) {
        if (!response) return;

        // Update listener count
        totalCountElement.textContent = response.totalListeners;

        // Update logging toggle - this ensures UI matches actual state
        if (loggingToggle) {
            loggingToggle.checked = response.logEnabled;
        }

        // Update other toggles if present
        if (enhanceConsoleToggle && response.consoleEnhancementEnabled !== undefined) {
            enhanceConsoleToggle.checked = response.consoleEnhancementEnabled;
        }

        if (rerouteToggle && response.reroutingEnabled !== undefined) {
            rerouteToggle.checked = response.reroutingEnabled;
        }

        // Update captured messages if present
        if (response.capturedMessages) {
            capturedMessages = response.capturedMessages;
            if (autoUpdateToggle && autoUpdateToggle.checked) {
                updateMessages();
            }
        }

        // Display frames and their listeners
        const frames = response.frames;
        const frameIds = Object.keys(frames);

        if (frameIds.length === 0) {
            framesContainer.innerHTML = '<div class="no-frames">No frames detected</div>';
            return;
        }

        framesContainer.innerHTML = '';

        // Sort frames by path for a consistent display
        frameIds.sort((a, b) => {
            return frames[a].path.localeCompare(frames[b].path);
        });

        frameIds.forEach(frameId => {
            const frame = frames[frameId];
            const frameElement = document.createElement('div');
            frameElement.className = 'frame-info';

            let listenersHtml = '';
            if (frame.listeners && frame.listeners.length > 0) {
                frame.listeners.forEach(listener => {
                    // Check if this is a wrapped listener
                    const isWrapped = listener.isUnwrapped;
                    const wrapperType = isWrapped ? (listener.wrapperType || 'Unknown') : '';

                    listenersHtml += `
              <div class="listener-item">
                ${isWrapped ?
                            `<span class="wrapper-type">${wrapperType}</span> wrapped listener` :
                            'Direct listener'}
                <div style="color: #666; margin-top: 2px;">
                  ${listener.unwrapped ?
                            truncateCode(listener.unwrapped.code || "function() {...}") :
                            truncateCode(listener.wrapped ? listener.wrapped.code : "function() {...}")}
                </div>
              </div>
            `;
                });
            }

            frameElement.innerHTML = `
          <div class="frame-path">${frame.path}</div>
          <div class="frame-url">${frame.url}</div>
          <div class="listener-count">
            ${frame.listeners.length} postMessage listener${frame.listeners.length !== 1 ? 's' : ''}
          </div>
          ${listenersHtml}
        `;

            framesContainer.appendChild(frameElement);
        });
    }

    // Helper function to truncate code
    function truncateCode(code) {
        if (!code) return '';
        if (code.length > 100) {
            return code.substring(0, 100) + '...';
        }
        return code;
    }

    // Function to update message display
    function updateMessages() {
        if (!messagesContainer) return;

        if (capturedMessages.length === 0) {
            messagesContainer.innerHTML = '<div class="no-frames">No messages captured yet. Messages are always captured regardless of console logging setting.</div>';
            return;
        }

        // Sort messages by timestamp (newest first)
        capturedMessages.sort((a, b) => b.timestamp - a.timestamp);

        messagesContainer.innerHTML = '';

        capturedMessages.forEach(message => {
            const messageElement = document.createElement('div');
            messageElement.className = 'frame-info';

            // Format timestamp
            const date = new Date(message.timestamp);
            const timeString = date.toLocaleTimeString();

            // Determine icon and color based on direction
            const isOutgoing = message.direction === 'OUTGOING';
            const icon = isOutgoing ? '→' : '←';
            const color = isOutgoing ? '#1976d2' : '#43a047';

            // Check if this is a simplified message (non-serializable original)
            const isSimplified = message.data && message.data.__simplified;

            // Format message data
            let dataDisplay = '';
            try {
                if (isSimplified) {
                    dataDisplay = `[${message.data.type}] ${message.data.toString}${message.data.keys ? ' Keys: ' + message.data.keys.join(', ') : ''}`;
                } else {
                    dataDisplay = JSON.stringify(message.data).substring(0, 100);
                    if (JSON.stringify(message.data).length > 100) {
                        dataDisplay += '...';
                    }
                }
            } catch (e) {
                dataDisplay = '[Complex Data]';
            }

            messageElement.innerHTML = `
          <div style="display: flex; justify-content: space-between;">
            <div style="font-weight: bold; color: ${color};">
              ${icon} ${isOutgoing ? 'Sent to' : 'Received from'} ${isOutgoing ? message.target : message.source}
            </div>
            <div style="color: #666; font-size: 11px;">${timeString}</div>
          </div>
          <div style="margin: 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            Data: ${dataDisplay}
          </div>
          <div style="font-size: 11px; color: #666;">${isOutgoing ? 'From' : 'To'}: ${isOutgoing ? message.source : message.target}</div>
          ${message.path ? `<div style="font-size: 11px; color: #0d47a1; margin-top: 2px;">Path: ${message.path}</div>` : ''}
        `;

            messagesContainer.appendChild(messageElement);
        });
    }

    // Get current tab and update UI
    function refreshState() {
        chrome.runtime.sendMessage({ type: "GET_STATE" }, function (response) {
            if (chrome.runtime.lastError) {
                console.error("Error getting state:", chrome.runtime.lastError);
                return;
            }
            updateUI(response);
        });
    }

    // Initialize UI
    refreshState();

    // Listen for background updates
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === "STATE_UPDATED") {
            refreshState();
        }
        else if (message.type === "MESSAGE_LOGGED" && message.data) {
            // Add to captured messages
            capturedMessages.push(message.data);

            // Limit local messages to prevent UI lag
            if (capturedMessages.length > 200) {
                capturedMessages = capturedMessages.slice(-200);
            }

            // Update messages display if auto-update is enabled
            if (autoUpdateToggle && autoUpdateToggle.checked) {
                updateMessages();
            }
        }
    });

    // Toggle logging
    if (loggingToggle) {
        loggingToggle.addEventListener('change', function () {
            const enabled = loggingToggle.checked;

            chrome.runtime.sendMessage({
                type: "SET_LOGGING",
                enabled: enabled
            }, function (response) {
                // Optional callback - can handle success/failure
                if (chrome.runtime.lastError) {
                    console.error("Error setting logging:", chrome.runtime.lastError);
                    // Reset the toggle to match actual state
                    refreshState();
                }
            });
        });
    }

    // Auto-update toggle
    if (autoUpdateToggle) {
        autoUpdateToggle.addEventListener('change', function () {
            if (autoUpdateToggle.checked) {
                updateMessages();
            }
        });
    }

    // Clear messages button
    if (clearMessagesBtn) {
        clearMessagesBtn.addEventListener('click', function () {
            chrome.runtime.sendMessage({
                type: "CLEAR_MESSAGES"
            }, function (response) {
                if (chrome.runtime.lastError) {
                    console.error("Error clearing messages:", chrome.runtime.lastError);
                    return;
                }

                capturedMessages = [];
                updateMessages();
            });
        });
    }

    // Toggle console enhancement
    if (enhanceConsoleToggle) {
        enhanceConsoleToggle.addEventListener('change', function () {
            chrome.runtime.sendMessage({
                type: "SET_CONSOLE_ENHANCEMENT",
                enabled: enhanceConsoleToggle.checked
            }, function (response) {
                if (chrome.runtime.lastError) {
                    console.error("Error setting console enhancement:", chrome.runtime.lastError);
                    // Reset the toggle to match actual state
                    refreshState();
                }
            });
        });
    }

    // Toggle message rerouting
    if (rerouteToggle) {
        rerouteToggle.addEventListener('change', function () {
            chrome.runtime.sendMessage({
                type: "SET_REROUTING",
                enabled: rerouteToggle.checked
            }, function (response) {
                if (chrome.runtime.lastError) {
                    console.error("Error setting message rerouting:", chrome.runtime.lastError);
                    // Reset the toggle to match actual state
                    refreshState();
                }
            });
        });
    }

    // Test postMessage button
    if (testPostMessageBtn) {
        testPostMessageBtn.addEventListener('click', function () {
            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                if (tabs.length === 0) {
                    console.error("No active tab found");
                    return;
                }

                chrome.tabs.sendMessage(tabs[0].id, {
                    type: "TEST_POSTMESSAGE",
                    data: {
                        message: "Test message from PostMessage Monitor extension",
                        timestamp: Date.now()
                    }
                }).catch(err => {
                    console.error("Error sending test message:", err);
                });
            });
        });
    }
});