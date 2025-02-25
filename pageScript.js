// This script runs in the context of the page and can monitor the actual window.postMessage calls

(function () {
    // Track all registered event listeners
    const listeners = [];
    let logEnabled = false;
    let consoleEnhancementEnabled = true;
    let reroutingEnabled = true;
    let consolePatched = false;

    // Store original console methods
    let originalConsoleLog = null;
    let originalConsoleDir = null;

    // Helper function to generate a fingerprint for a function
    function getFunctionFingerprint(fn) {
        // Return placeholder for our own handlers
        if (fn.__postMessageMonitor_handler) {
            return {
                code: "[PostMessage Monitor's internal handler]",
                location: "extension",
                hash: 0
            };
        }

        const fnStr = fn.toString();

        // Create a unique ID for this function
        const fnHash = String(fnStr).split('').reduce((a, b) => (((a << 5) - a) + b.charCodeAt(0)) | 0, 0);

        // Try to extract real location from function source if possible
        let location = "unknown";

        // Look for source URL comment that some minifiers/bundlers add
        const sourceURLMatch = fnStr.match(/\/\/[#@]\s*sourceURL=\s*(\S+)/);
        if (sourceURLMatch) {
            location = sourceURLMatch[1];
        } else {
            // Check for source mapping URL
            const sourceMappingURLMatch = fnStr.match(/\/\/[#@]\s*sourceMappingURL=\s*(\S+)/);
            if (sourceMappingURLMatch) {
                location = "mapped: " + sourceMappingURLMatch[1];
            } else {
                // Try to get location from error stack (less reliable)
                try {
                    // Create an error and parse its stack
                    const err = new Error();
                    // Force creation of stack property
                    Error.captureStackTrace(err, getFunctionFingerprint);

                    const stackLines = err.stack.split('\n');

                    // Look for a stack line that isn't from our extension
                    for (let i = 1; i < stackLines.length; i++) {
                        const line = stackLines[i];
                        // Skip our extension's code
                        if (line.includes('postmessage-monitor') || line.includes('chrome-extension')) {
                            continue;
                        }

                        const match = line.match(/at .* \((.*):(\d+):(\d+)\)/) ||
                            line.match(/at (.*):(\d+):(\d+)/);
                        if (match) {
                            location = `${match[1]}:${match[2]}`;
                            break;
                        }
                    }
                } catch (e) {
                    // If anything goes wrong, fall back to "unknown"
                    location = "unknown";
                }
            }
        }

        return {
            code: fnStr.length > 100 ? fnStr.substring(0, 100) + '...' : fnStr,
            location: location,
            hash: fnHash
        };
    }

    // Helper function to check if a function is our own monitoring code
    function isOurOwnListener(fn) {
        if (!fn) return false;

        // Check for special marker property
        if (fn.__postMessageMonitor_handler) return true;

        // Check the function string for our identifying comment
        const fnStr = fn.toString();
        return fnStr.includes("// Ignore our own messages") ||
            fnStr.includes("__postMessageMonitor") ||
            fnStr.includes("__postMessageMonitorControl");
    }

    // Additional filtering helper for UI/display
    function isExtensionListener(code) {
        if (!code) return false;

        return code.includes("// Ignore our own messages") ||
            code.includes("__postMessageMonitor") ||
            code.includes("PostMessage Monitor") ||
            code.includes("[PostMessage Monitor]");
    }

    // Library detection and unwrapping helpers
    const wrappers = {
        // Check if Raven/Sentry is present
        isRavenPresent: function () {
            return typeof window.Raven !== 'undefined' || typeof window.Sentry !== 'undefined';
        },

        // Check if New Relic is present
        isNewRelicPresent: function () {
            return typeof window.newrelic !== 'undefined' || typeof window.NREUM !== 'undefined';
        },

        // Check if Rollbar is present
        isRollbarPresent: function () {
            return typeof window.Rollbar !== 'undefined';
        },

        // Check if Bugsnag is present
        isBugsnagPresent: function () {
            return typeof window.Bugsnag !== 'undefined';
        },

        // Check if jQuery is present
        isjQueryPresent: function () {
            return typeof window.jQuery !== 'undefined' || typeof window.$ !== 'undefined';
        },

        // Unwrap Raven/Sentry wrapped function
        unwrapRaven: function (fn) {
            if (typeof fn !== 'function') return fn;

            // Check for Raven.__wrap pattern
            if (fn.__raven__ && typeof fn.__orig__ === 'function') {
                return fn.__orig__;
            }

            // Check for Sentry wrap pattern
            if (fn.__sentry_wrapped__ && typeof fn.__sentry_original__ === 'function') {
                return fn.__sentry_original__;
            }

            return fn;
        },

        // Unwrap New Relic wrapped function
        unwrapNewRelic: function (fn) {
            if (typeof fn !== 'function') return fn;

            // Check for New Relic wrapping patterns
            if (fn.nr && typeof fn.__nr_original === 'function') {
                return fn.__nr_original;
            }

            // Another NR pattern
            if (fn.__NR_original && typeof fn.__NR_original === 'function') {
                return fn.__NR_original;
            }

            return fn;
        },

        // Unwrap Rollbar wrapped function
        unwrapRollbar: function (fn) {
            if (typeof fn !== 'function') return fn;

            // Check for Rollbar wrapping pattern
            if (fn._rollbar_wrapped && typeof fn._rollbar_wrapped === 'function') {
                return fn._rollbar_wrapped;
            }

            return fn;
        },

        // Unwrap Bugsnag wrapped function
        unwrapBugsnag: function (fn) {
            if (typeof fn !== 'function') return fn;

            // Check for Bugsnag wrapping pattern
            if (fn.bugsnag && typeof fn.bugsnag.originalFunction === 'function') {
                return fn.bugsnag.originalFunction;
            }

            return fn;
        },

        // Unwrap jQuery event handler
        unwrapjQuery: function (fn) {
            if (typeof fn !== 'function') return fn;

            // Check for jQuery handler pattern
            if (fn.guid && fn.handler && typeof fn.handler === 'function') {
                return fn.handler;
            }

            return fn;
        },

        // Try all unwrappers to get the original function
        unwrapAll: function (fn) {
            if (typeof fn !== 'function') return fn;

            let unwrapped = fn;

            // Keep unwrapping until we can't unwrap anymore
            let prevFn;
            do {
                prevFn = unwrapped;

                if (this.isRavenPresent()) unwrapped = this.unwrapRaven(unwrapped);
                if (this.isNewRelicPresent()) unwrapped = this.unwrapNewRelic(unwrapped);
                if (this.isRollbarPresent()) unwrapped = this.unwrapRollbar(unwrapped);
                if (this.isBugsnagPresent()) unwrapped = this.unwrapBugsnag(unwrapped);
                if (this.isjQueryPresent()) unwrapped = this.unwrapjQuery(unwrapped);

                // If the function reference hasn't changed, we're done unwrapping
            } while (unwrapped !== prevFn);

            return unwrapped;
        }
    };

    // Monitor addEventListener calls
    const originalAddEventListener = window.EventTarget.prototype.addEventListener;
    window.EventTarget.prototype.addEventListener = function (type, listener, options) {
        // Only track message event listeners
        if (type === 'message' && typeof listener === 'function') {
            // Check if this is our own listener
            if (isOurOwnListener(listener)) {
                // Mark our own listener for future reference
                listener.__postMessageMonitor_handler = true;
                // Call original function and skip tracking
                return originalAddEventListener.apply(this, arguments);
            }

            // Try to unwrap the listener to get the original function
            const unwrappedListener = wrappers.unwrapAll(listener);

            // Skip if unwrapped listener is our own
            if (isOurOwnListener(unwrappedListener)) {
                // Call original function and skip tracking
                return originalAddEventListener.apply(this, arguments);
            }

            // Create fingerprints for both wrapped and unwrapped versions
            const wrappedFingerprint = getFunctionFingerprint(listener);
            const unwrappedFingerprint = unwrappedListener !== listener ?
                getFunctionFingerprint(unwrappedListener) :
                wrappedFingerprint;

            // Create a sanitized version of the fingerprints that can be cloned
            const wrappedFingerprintSafe = {
                code: wrappedFingerprint.code,
                location: wrappedFingerprint.location,
                hash: wrappedFingerprint.hash
            };

            const unwrappedFingerprintSafe = {
                code: unwrappedFingerprint.code,
                location: unwrappedFingerprint.location,
                hash: unwrappedFingerprint.hash
            };

            // Add to our tracked listeners - using safe references that can be cloned
            const listenerInfo = {
                type: 'message',
                wrapped: wrappedFingerprintSafe,
                unwrapped: unwrappedFingerprintSafe,
                isUnwrapped: unwrappedListener !== listener,
                // We don't store actual function references, as they can't be cloned
                wrapperType: getWrapperType(listener),
                target: this === window ? 'window' : 'other-target',
                timestamp: Date.now()
            };

            listeners.push(listenerInfo);

            // Override the listener with a special proxy that helps with debugging
            if (unwrappedListener !== listener && reroutingEnabled) {
                const proxyListener = function (event) {
                    // Log information about this event being triggered
                    if (logEnabled) {
                        console.group(`%c[PostMessage Monitor] Message event caught`, 'color: #4688f1; font-weight: bold;');
                        console.log('Event:', event);
                        console.log('Original wrapper:', listener);
                        console.log('Unwrapped handler:', unwrappedListener);
                        console.log('Source path:', event.source ? getWindowPath(event.source) : 'unknown');
                        console.log('Target path:', getWindowPath(window));
                        console.groupEnd();
                    }

                    // Call the original listener
                    return listener.apply(this, arguments);
                };

                // Store a reference to the original and unwrapped functions
                // We use __postMessageMonitor prefix to avoid conflicts
                proxyListener.__postMessageMonitor_original = listener;
                proxyListener.__postMessageMonitor_unwrapped = unwrappedListener;
                proxyListener.__postMessageMonitor_handler = true; // Mark as our code

                // Replace the listener with our proxy
                arguments[1] = proxyListener;
            }

            // Notify about the new listener
            notifyListenersUpdated();
        }

        // Call the original function
        return originalAddEventListener.apply(this, arguments);
    };

    // Monitor removeEventListener calls
    const originalRemoveEventListener = window.EventTarget.prototype.removeEventListener;
    window.EventTarget.prototype.removeEventListener = function (type, listener, options) {
        // Only track message event listeners
        if (type === 'message' && typeof listener === 'function') {
            // Check if this is our proxy listener
            if (listener.__postMessageMonitor_original) {
                // Get the original listener
                const originalListener = listener.__postMessageMonitor_original;

                // Replace with original for removal
                arguments[1] = originalListener;

                // Handle our tracking separately
                const fingerprint = getFunctionFingerprint(originalListener);

                // Remove from our tracked listeners
                const index = listeners.findIndex(l =>
                    l.type === 'message' &&
                    l.wrapped.hash === fingerprint.hash
                );

                if (index !== -1) {
                    listeners.splice(index, 1);
                    notifyListenersUpdated();
                }

                // Call the original function with the original listener
                return originalRemoveEventListener.apply(this, arguments);
            }

            // Normal case - not our proxy
            const fingerprint = getFunctionFingerprint(listener);

            // Remove from our tracked listeners
            const index = listeners.findIndex(l =>
                l.type === 'message' &&
                l.wrapped.hash === fingerprint.hash
            );

            if (index !== -1) {
                listeners.splice(index, 1);
                notifyListenersUpdated();
            }
        }

        // Call the original function
        return originalRemoveEventListener.apply(this, arguments);
    };

    // Helper function to get path to a window object
    function getWindowPath(win) {
        if (!win) return 'unknown';

        try {
            if (win === window) return 'self';
            if (win === top) return 'top';
            if (win === parent) return 'parent';

            // Check if it's one of our frames
            for (let i = 0; i < frames.length; i++) {
                if (win === frames[i]) return `frames[${i}]`;
            }

            // Check if it's a frame's frame
            for (let i = 0; i < frames.length; i++) {
                try {
                    const subframes = frames[i].frames;
                    for (let j = 0; j < subframes.length; j++) {
                        if (win === subframes[j]) return `frames[${i}].frames[${j}]`;
                    }
                } catch (e) {
                    // Cross-origin access might fail
                }
            }

            return 'unknown-window';
        } catch (e) {
            return 'access-denied';
        }
    }

    // Determine the type of wrapper used for a function
    function getWrapperType(fn) {
        if (!fn) return 'unknown';

        if (fn.__raven__ || fn.__sentry_wrapped__) return 'Raven/Sentry';
        if (fn.nr || fn.__NR_original) return 'New Relic';
        if (fn._rollbar_wrapped) return 'Rollbar';
        if (fn.bugsnag) return 'Bugsnag';
        if (fn.guid && fn.handler) return 'jQuery';

        return 'unknown wrapper';
    }

    // Monitor postMessage calls
    const originalPostMessage = window.postMessage;
    window.postMessage = function (message, targetOrigin, transfer) {
        // Ignore our own messages
        if (message && (message.__postMessageMonitor || message.__postMessageMonitorControl)) {
            return originalPostMessage.apply(this, arguments);
        }

        try {
            // Clone the message to ensure it can be serialized
            let safeMessage;
            try {
                // Test if the message is serializable by using structured clone algorithm
                safeMessage = structuredClone(message);
            } catch (e) {
                // If not serializable, create a simple representation
                safeMessage = {
                    __simplified: true,
                    type: typeof message,
                    toString: String(message).substring(0, 500)
                };

                if (typeof message === 'object' && message !== null) {
                    safeMessage.keys = Object.keys(message);
                }
            }

            // Always send to extension
            window.postMessage({
                __postMessageMonitor: {
                    type: "MESSAGE_SENT",
                    data: safeMessage,
                    targetOrigin: targetOrigin,
                    timestamp: Date.now()
                }
            }, "*");

            // Only log to console if enabled
            if (logEnabled) {
                console.group(`%c[PostMessage Monitor] Outgoing Message to ${targetOrigin || '*'}`, 'color: #1976d2; font-weight: bold;');
                console.log('Data:', message);
                console.log('Target origin:', targetOrigin || '*');
                console.log('Sender path:', getWindowPath(window));

                // Get call stack info
                const stack = new Error().stack;
                console.log('Call stack:', stack);

                // Find the caller of postMessage
                const callMatch = stack.split('\n')[2].match(/at (.*) \((.*):(\d+):(\d+)\)/);
                if (callMatch) {
                    console.log('Called from:', `${callMatch[1]} at ${callMatch[2]}:${callMatch[3]}`);
                }

                console.groupEnd();
            }
        } catch (e) {
            console.error('[PostMessage Monitor] Error handling message:', e);
        }

        // Call the original function
        return originalPostMessage.apply(this, arguments);
    };

    // Also handle Window.prototype.postMessage for completeness
    if (Window.prototype.postMessage && Window.prototype.postMessage !== window.postMessage) {
        const originalWindowPrototypePostMessage = Window.prototype.postMessage;
        Window.prototype.postMessage = function (message, targetOrigin, transfer) {
            // Ignore our own messages
            if (message && (message.__postMessageMonitor || message.__postMessageMonitorControl)) {
                return originalWindowPrototypePostMessage.apply(this, arguments);
            }

            try {
                const targetWindow = this;
                const targetPath = getWindowPath(targetWindow);

                // Clone the message to ensure it can be serialized
                let safeMessage;
                try {
                    // Test if the message is serializable
                    safeMessage = structuredClone(message);
                } catch (e) {
                    // If not serializable, create a simple representation
                    safeMessage = {
                        __simplified: true,
                        type: typeof message,
                        toString: String(message).substring(0, 500)
                    };

                    if (typeof message === 'object' && message !== null) {
                        safeMessage.keys = Object.keys(message);
                    }
                }

                // Always send to extension
                window.postMessage({
                    __postMessageMonitor: {
                        type: "MESSAGE_SENT",
                        data: safeMessage,
                        targetOrigin: targetOrigin,
                        targetPath: targetPath,
                        timestamp: Date.now()
                    }
                }, "*");

                // Only log to console if enabled
                if (logEnabled) {
                    console.group(`%c[PostMessage Monitor] Cross-window Message to ${targetPath}`, 'color: #e91e63; font-weight: bold;');
                    console.log('Data:', message);
                    console.log('Target origin:', targetOrigin || '*');
                    console.log('Target window:', targetWindow);
                    console.log('Target path:', targetPath);
                    console.log('Sender path:', getWindowPath(window));

                    // Get call stack info
                    const stack = new Error().stack;
                    console.log('Call stack:', stack);

                    // Find the caller
                    const callMatch = stack.split('\n')[2].match(/at (.*) \((.*):(\d+):(\d+)\)/);
                    if (callMatch) {
                        console.log('Called from:', `${callMatch[1]} at ${callMatch[2]}:${callMatch[3]}`);
                    }

                    console.groupEnd();
                }
            } catch (e) {
                console.error('[PostMessage Monitor] Error handling cross-window message:', e);
            }

            // Call the original function
            return originalWindowPrototypePostMessage.apply(this, arguments);
        };
    }

    // Capture incoming messages
    window.addEventListener('message', function (event) {
        // Ignore our own messages
        if (event.data && (event.data.__postMessageMonitor || event.data.__postMessageMonitorControl)) {
            // Check if this is a control message
            if (event.data.__postMessageMonitorControl) {
                const control = event.data.__postMessageMonitorControl;
                if (control.type === "UPDATE_LOGGING") {
                    logEnabled = control.enabled;
                } else if (control.type === "UPDATE_CONSOLE_ENHANCEMENT") {
                    // Update console enhancement setting
                    consoleEnhancementEnabled = control.enabled;

                    // If disabling, restore original console methods
                    if (!control.enabled && originalConsoleLog) {
                        console.log = originalConsoleLog;
                        console.dir = originalConsoleDir;
                    } else if (control.enabled && !consolePatched) {
                        // Re-apply console patches
                        patchConsole();
                    }
                } else if (control.type === "UPDATE_REROUTING") {
                    // Update listener rerouting setting
                    reroutingEnabled = control.enabled;
                } else if (control.type === "INIT_SETTINGS" && control.settings) {
                    // Apply all settings at once
                    logEnabled = control.settings.logEnabled;
                    consoleEnhancementEnabled = control.settings.consoleEnhancementEnabled;
                    reroutingEnabled = control.settings.reroutingEnabled;

                    // Apply console patching based on new settings
                    if (consoleEnhancementEnabled && !consolePatched) {
                        patchConsole();
                    } else if (!consoleEnhancementEnabled && originalConsoleLog) {
                        console.log = originalConsoleLog;
                        console.dir = originalConsoleDir;
                    }
                }
            }
            return;
        }

        try {
            // Get source window path if available
            const sourcePath = event.source ? getWindowPath(event.source) : 'unknown';

            // Clone the message data to ensure it can be serialized
            let safeData;
            try {
                // Test if the data is serializable
                safeData = structuredClone(event.data);
            } catch (e) {
                // If not serializable, create a simple representation
                safeData = {
                    __simplified: true,
                    type: typeof event.data,
                    toString: String(event.data).substring(0, 500)
                };

                if (typeof event.data === 'object' && event.data !== null) {
                    safeData.keys = Object.keys(event.data);
                }
            }

            // Always send to extension
            window.postMessage({
                __postMessageMonitor: {
                    type: "MESSAGE_RECEIVED",
                    data: safeData,
                    sourceOrigin: event.origin,
                    sourcePath: sourcePath,
                    timestamp: Date.now()
                }
            }, "*");

            // Only log to console if enabled
            if (logEnabled) {
                console.group(`%c[PostMessage Monitor] Incoming Message from ${event.origin}`, 'color: #43a047; font-weight: bold;');
                console.log('Data:', event.data);
                console.log('Origin:', event.origin);
                console.log('Source path:', sourcePath);
                console.log('Target path:', getWindowPath(window));
                console.log('Event:', event);

                // If we have active listeners, show them
                const activeListeners = listeners.filter(l => l.type === 'message' &&
                    // Filter out our own listeners
                    !l.wrapped.code.includes("// Ignore our own messages") &&
                    !l.wrapped.code.includes("__postMessageMonitor") &&
                    !l.unwrapped.code.includes("// Ignore our own messages") &&
                    !l.unwrapped.code.includes("__postMessageMonitor"));

                if (activeListeners.length > 0) {
                    console.group('Active listeners that will receive this message:');
                    activeListeners.forEach((listener, idx) => {
                        console.group(`Listener #${idx + 1}`);
                        if (listener.isUnwrapped) {
                            console.log('Original wrapper:', listener.wrapped.code);
                            console.log('Unwrapped function:', listener.unwrapped.code);
                            console.log('Wrapper type:', listener.wrapperType || 'unknown');
                        } else {
                            console.log('Function:', listener.wrapped.code);
                        }
                        console.log('Added at:', new Date(listener.timestamp).toLocaleTimeString());
                        console.log('Location:', listener.unwrapped.location);
                        console.groupEnd();
                    });
                    console.groupEnd();
                }

                console.groupEnd();
            }
        } catch (e) {
            console.error('[PostMessage Monitor] Error handling incoming message:', e);
        }
    }, true); // Use capture to see messages before other handlers

    // Hook into console to improve message event display
    function patchConsole() {
        if (!console || !console.log) return;

        // Store references to the original methods if not already saved
        if (!originalConsoleLog) {
            originalConsoleLog = console.log;
            originalConsoleDir = console.dir;
        }

        // Enhance console.log for event objects
        console.log = function (...args) {
            for (let i = 0; i < args.length; i++) {
                const arg = args[i];
                // Check if this is a MessageEvent
                if (arg && arg instanceof MessageEvent) {
                    // If next arg isn't a string descriptor, add one
                    if (i === args.length - 1 || typeof args[i + 1] !== 'string') {
                        // Insert extra info about the message event
                        originalConsoleLog.call(this, arg, '(MessageEvent details:)');
                        originalConsoleLog.call(this, 'Data:', arg.data);
                        originalConsoleLog.call(this, 'Origin:', arg.origin);
                        originalConsoleLog.call(this, 'Source:', arg.source ? getWindowPath(arg.source) : 'unknown');
                        continue;
                    }
                }

                // Regular handling for other arguments
                originalConsoleLog.call(this, arg);
            }
        };

        // Enhance console.dir for event listener objects
        console.dir = function (obj, options) {
            // If this is a function that might be a message event listener
            if (typeof obj === 'function') {
                const unwrapped = wrappers.unwrapAll(obj);
                if (unwrapped !== obj) {
                    originalConsoleLog.call(this, '%cUnwrapped event listener:', 'color: #e91e63; font-weight: bold');
                    originalConsoleDir.call(this, unwrapped, options);
                    originalConsoleLog.call(this, '%cOriginal wrapped function:', 'color: #888; font-weight: bold');
                }
            }

            // Call the original method
            originalConsoleDir.call(this, obj, options);
        };

        consolePatched = true;
    }

    // Notify about listener updates
    function notifyListenersUpdated() {
        try {
            // Filter out our own listeners before notifying
            const filteredListeners = listeners.filter(listener => {
                return !(listener.wrapped.code.includes("// Ignore our own messages") ||
                    listener.wrapped.code.includes("__postMessageMonitor") ||
                    listener.unwrapped.code.includes("// Ignore our own messages") ||
                    listener.unwrapped.code.includes("__postMessageMonitor"));
            });

            // Create a serializable copy of the listeners
            const serializableListeners = filteredListeners.map(listener => {
                // Make sure we only include properties that can be cloned
                return {
                    type: listener.type,
                    wrapped: listener.wrapped,
                    unwrapped: listener.unwrapped,
                    isUnwrapped: listener.isUnwrapped,
                    wrapperType: listener.wrapperType,
                    target: listener.target,
                    timestamp: listener.timestamp
                };
            });

            window.postMessage({
                __postMessageMonitor: {
                    type: "LISTENERS_UPDATED",
                    listeners: serializableListeners
                }
            }, "*");
        } catch (e) {
            console.error('[PostMessage Monitor] Error notifying about listener updates:', e);
        }
    }

    // Try to patch libraries that wrap event listeners
    function patchLibraries() {
        // Patch Raven/Sentry wrap method
        if (window.Raven && typeof Raven.wrap === 'function') {
            const originalRavenWrap = Raven.wrap;
            Raven.wrap = function (options, fn) {
                const wrapped = originalRavenWrap.apply(this, arguments);
                // Make the original function accessible
                if (wrapped && typeof fn === 'function') {
                    wrapped.__postMessageMonitor_unwrapped = fn;
                }
                return wrapped;
            };
        }

        // Patch Sentry wrap method
        if (window.Sentry && typeof Sentry.wrap === 'function') {
            const originalSentryWrap = Sentry.wrap;
            Sentry.wrap = function (options, fn) {
                const wrapped = originalSentryWrap.apply(this, arguments);
                // Make the original function accessible
                if (wrapped && typeof fn === 'function') {
                    wrapped.__postMessageMonitor_unwrapped = fn;
                }
                return wrapped;
            };
        }

        // Patch jQuery event add method if available
        if (window.jQuery) {
            const originalOn = jQuery.fn.on;
            jQuery.fn.on = function (types, selector, data, fn) {
                // Handle the different argument patterns
                let handler;
                if (typeof selector === 'function') {
                    handler = selector;
                    selector = undefined;
                } else if (typeof data === 'function') {
                    handler = data;
                    data = undefined;
                } else {
                    handler = fn;
                }

                // If this is a message event, mark it
                if (types && typeof types === 'string' && types.includes('message') && typeof handler === 'function') {
                    // Store the original handler
                    handler.__postMessageMonitor_jquery_original = true;
                }

                return originalOn.apply(this, arguments);
            };
        }
    }

    // Detect existing message listeners
    // This is a best-effort approach as we can't access listeners already added
    // We'll catch all new ones going forward

    // Initial notification of listeners
    notifyListenersUpdated();

    // Re-check listeners on DOM content loaded
    document.addEventListener('DOMContentLoaded', function () {
        // Try to patch libraries
        patchLibraries();
        // Initial console patching
        if (consoleEnhancementEnabled) {
            patchConsole();
        }
        notifyListenersUpdated();
    });

    // Also check on load
    window.addEventListener('load', function () {
        // Try to patch libraries again
        patchLibraries();
        // Make sure console is patched
        if (consoleEnhancementEnabled && !consolePatched) {
            patchConsole();
        }
        notifyListenersUpdated();
    });
})();