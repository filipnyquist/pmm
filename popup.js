// popup.js
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

            let frameHTML = `
          <div class="frame-path">${frame.path}</div>
          <div class="frame-url">${frame.url}</div>
          <div class="listener-count">
            ${frame.listeners.length} postMessage listener${frame.listeners.length !== 1 ? 's' : ''}
          </div>
        `;

            if (frame.listeners && frame.listeners.length > 0) {
                frame.listeners.forEach((listener, idx) => {
                    // Check if this is a wrapped listener
                    const isWrapped = listener.isUnwrapped;
                    const wrapperType = isWrapped ? (listener.wrapperType || 'Unknown') : '';

                    // Create unique ID for expandable section
                    const listenerId = `listener-${frameId}-${idx}`;

                    // Create the listener item HTML
                    frameHTML += `
              <div class="listener-item">
                <div class="expandable-header" data-target="${listenerId}">
                  <div>
                    <span class="expand-icon">+</span>
                    ${isWrapped ?
                            `<span class="wrapper-type">${wrapperType}</span> wrapped listener` :
                            'Direct listener'}
                  </div>
                  <span style="color:#999;font-size:10px;">${listener.unwrapped.location}</span>
                </div>
                <div class="expandable-content" id="${listenerId}">
            `;

                    // Add function code details
                    if (isWrapped) {
                        const wrappedCode = listener.wrapped.code || "function() {...}";
                        const unwrappedCode = listener.unwrapped.code || "function() {...}";

                        frameHTML += `
                <div>
                  <strong>Original wrapper:</strong>
                  <div class="code-block">${escapeHTML(wrappedCode)}</div>
                </div>
                <div style="margin-top:8px;">
                  <strong>Unwrapped function:</strong>
                  <div class="code-block">${escapeHTML(unwrappedCode)}</div>
                </div>
              `;
                    } else {
                        const functionCode = listener.wrapped.code || "function() {...}";
                        frameHTML += `
                <div>
                  <strong>Function:</strong>
                  <div class="code-block">${escapeHTML(functionCode)}</div>
                </div>
              `;
                    }

                    // Add metadata
                    frameHTML += `
                  <div style="margin-top:8px;">
                    <strong>Location:</strong> ${listener.unwrapped.location}<br>
                    <strong>Added at:</strong> ${new Date(listener.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            `;
                });
            }

            frameElement.innerHTML = frameHTML;
            framesContainer.appendChild(frameElement);
        });

        // Add event listeners to expandable sections
        setTimeout(() => {
            setupExpandables();
        }, 0);
    }

    // Function to escape HTML to prevent XSS when displaying code
    function escapeHTML(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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

        capturedMessages.forEach((message, idx) => {
            const messageElement = document.createElement('div');
            messageElement.className = 'frame-info';

            // Format timestamp
            const date = new Date(message.timestamp);
            const timeString = date.toLocaleTimeString();

            // Determine icon and color based on direction
            const isOutgoing = message.direction === 'OUTGOING';
            const icon = isOutgoing ? '→' : '←';
            const color = isOutgoing ? '#1976d2' : '#43a047';

            // Create a unique ID for this message's expandable content
            const messageId = `message-${idx}-content`;

            // Check if this is a simplified message (non-serializable original)
            const isSimplified = message.data && message.data.__simplified;

            // Format message data preview (truncated)
            let dataPreview = '';
            let fullData = '';

            try {
                if (isSimplified) {
                    dataPreview = `[${message.data.type}] ${message.data.toString.substring(0, 50)}${message.data.toString.length > 50 ? '...' : ''}`;
                    fullData = `[${message.data.type}] ${message.data.toString}${message.data.keys ? '\nKeys: ' + message.data.keys.join(', ') : ''}`;
                } else {
                    const stringified = JSON.stringify(message.data, null, 2);
                    dataPreview = stringified.length > 50 ? stringified.substring(0, 50) + '...' : stringified;
                    fullData = stringified;
                }
            } catch (e) {
                dataPreview = '[Complex Data]';
                fullData = '[Cannot stringify data: ' + e.message + ']';
            }

            messageElement.innerHTML = `
          <div class="message-header">
            <div style="font-weight: bold; color: ${color};">
              ${icon} ${isOutgoing ? 'Sent to' : 'Received from'} ${isOutgoing ? message.target : message.source}
            </div>
            <div style="color: #666; font-size: 11px;">${timeString}</div>
          </div>
          
          <div class="expandable-header" data-target="${messageId}">
            <div>
              <span class="expand-icon">+</span>
              <span>Data: ${escapeHTML(dataPreview)}</span>
            </div>
          </div>
          
          <div class="expandable-content" id="${messageId}">
            <div class="message-data">${escapeHTML(fullData)}</div>
            <div class="message-row" style="margin-top:8px;">
              <strong>${isOutgoing ? 'From' : 'To'}:</strong> ${isOutgoing ? message.source : message.target}
            </div>
            ${message.path ? `
            <div class="message-row">
              <strong>Path:</strong> ${message.path}
            </div>` : ''}
            <div class="message-row">
              <strong>Timestamp:</strong> ${date.toLocaleString()}
            </div>
          </div>
        `;

            messagesContainer.appendChild(messageElement);
        });

        // Setup expandable sections after adding all elements to DOM
        setTimeout(() => {
            setupExpandables();
        }, 0);
    }

    // Function to set up expandable sections
    function setupExpandables() {
        // Remove any existing event listeners first to prevent duplicates
        document.querySelectorAll('.expandable-header').forEach(header => {
            // Clone the node to remove event listeners
            const newHeader = header.cloneNode(true);
            header.parentNode.replaceChild(newHeader, header);

            // Add event listener to the new header
            newHeader.addEventListener('click', function (e) {
                const targetId = this.getAttribute('data-target');
                const content = document.getElementById(targetId);

                if (content) {
                    // Toggle visibility
                    content.classList.toggle('visible');

                    // Update the expand icon
                    const icon = this.querySelector('.expand-icon');
                    if (icon) {
                        icon.textContent = content.classList.contains('visible') ? '−' : '+';
                    }
                }

                // Prevent event bubbling to avoid issues with nested expandables
                e.stopPropagation();
            });
        });

        // Also make the expand icons clickable separately
        document.querySelectorAll('.expand-icon').forEach(icon => {
            // Clone and replace to remove existing listeners
            const newIcon = icon.cloneNode(true);
            icon.parentNode.replaceChild(newIcon, icon);

            newIcon.addEventListener('click', function (e) {
                // Find the parent header
                const header = this.closest('.expandable-header');
                if (header) {
                    // Trigger the header's click event
                    header.click();
                }

                // Prevent event bubbling
                e.stopPropagation();
            });
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