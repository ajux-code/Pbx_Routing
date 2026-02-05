# Linkus SDK WebRTC Integration Plan

## Overview

Add browser-based calling to the `pbx_integration` app using Yeastar's Linkus SDK. Users will be able to make and receive calls directly in their browser without needing the Linkus app or a physical phone.

### Current State

| Component | Status |
|-----------|--------|
| `get_webrtc_signature()` API | ✅ Implemented |
| OAuth authentication | ✅ Working |
| Webhooks for call events | ✅ Working |
| Click-to-call (via PBX) | ✅ Working |
| Screen pop notifications | ✅ Working |
| Linkus SDK JavaScript | ❌ Missing |
| WebRTC client initialization | ❌ Missing |
| In-browser calling UI | ❌ Missing |
| Microphone/audio handling | ❌ Missing |

### Target State

Users can:
- Make calls directly from the browser by clicking any phone number
- Receive calls with a floating phone widget
- Use their computer's microphone and speakers
- Fall back to desk phone/Linkus app if WebRTC fails

---

## Prerequisites

Before starting implementation:

### 1. Enable Linkus SDK in Yeastar Portal

1. Log in to Yeastar Management Portal
2. Go to **Integrations > Linkus SDK**
3. Enable the SDK
4. Note down:
   - **AccessID**
   - **AccessKey**

### 2. Update PBX Settings in Frappe

Add the AccessID and AccessKey to your PBX Settings DocType (if not already there).

### 3. Verify Backend API Works

```bash
bench --site yoursite execute pbx_integration.api.call.get_webrtc_signature
```

Should return:
```python
{
    "success": True,
    "secret": "signature-string",
    "username": "1001",  # extension number
    "pbx_url": "https://yourpbx.yeastarcloud.com"
}
```

### 4. Requirements

- Yeastar P-Series Cloud Edition
- **Ultimate Plan** (required for Linkus SDK)
- Firmware version 84.12.0.32 or later
- HTTPS on your Frappe site (required for microphone access)

---

## Phase 1: Project Setup & SDK Installation

### 1.1 Create package.json

**File:** `apps/pbx_integration/package.json`

```json
{
  "name": "pbx_integration",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "ys-webrtc-sdk-core": "^1.0.0",
    "ys-webrtc-sdk-ui": "^1.0.0"
  }
}
```

Then run:
```bash
cd apps/pbx_integration && npm install
```

### 1.2 Alternative: Use CDN (Simpler)

If you don't want npm bundling, load directly via CDN. Add to your hooks or HTML:

```html
<link rel="stylesheet" href="https://unpkg.com/ys-webrtc-sdk-ui/lib/ys-webrtc-sdk-ui.css">
<script src="https://unpkg.com/ys-webrtc-sdk-ui/lib/ys-webrtc-sdk-ui.umd.js"></script>
```

### 1.3 Update hooks.py

**File:** `pbx_integration/hooks.py`

```python
app_include_css = [
    "/assets/pbx_integration/css/pbx_webrtc.css"
]

app_include_js = [
    "/assets/pbx_integration/js/pbx_telephony.js",
    "/assets/pbx_integration/js/pbx_webrtc.js"
]

# If using CDN approach, also add:
app_include_css = [
    "https://unpkg.com/ys-webrtc-sdk-ui/lib/ys-webrtc-sdk-ui.css",
    "/assets/pbx_integration/css/pbx_webrtc.css"
]
```

---

## Phase 2: WebRTC Client Module

### 2.1 Create pbx_webrtc.js

**File:** `pbx_integration/public/js/pbx_webrtc.js`

```javascript
/**
 * PBX WebRTC Integration using Yeastar Linkus SDK
 *
 * Enables browser-based calling with:
 * - Incoming/outgoing calls via WebRTC
 * - Microphone/speaker handling
 * - Call UI controls
 */

frappe.provide("pbx_integration");

pbx_integration.WebRTC = class WebRTC {
    constructor() {
        this.initialized = false;
        this.phone = null;      // Linkus SDK phone operator
        this.pbx = null;        // Linkus SDK PBX operator
        this.currentCall = null;
        this.container = null;

        // Don't auto-init - wait for explicit call
    }

    /**
     * Initialize the Linkus SDK WebRTC client
     */
    async init() {
        if (this.initialized) {
            console.log("WebRTC already initialized");
            return true;
        }

        // Check microphone permission first
        const hasMic = await this.requestMicrophonePermission();
        if (!hasMic) {
            return false;
        }

        try {
            // 1. Get login signature from backend
            const credentials = await this.getCredentials();
            if (!credentials.success) {
                frappe.show_alert({
                    message: credentials.message || "Failed to get WebRTC credentials",
                    indicator: "red"
                }, 5);
                return false;
            }

            // 2. Create container for SDK UI
            this.createContainer();

            // 3. Initialize Linkus SDK
            const result = await this.initSDK(credentials);
            if (!result) {
                return false;
            }

            this.initialized = true;
            this.setupEventListeners();

            frappe.show_alert({
                message: "WebRTC Phone Ready",
                indicator: "green"
            }, 3);

            return true;

        } catch (error) {
            console.error("WebRTC init error:", error);
            frappe.show_alert({
                message: "Failed to initialize WebRTC",
                indicator: "red"
            }, 5);
            return false;
        }
    }

    /**
     * Request microphone permission
     */
    async requestMicrophonePermission() {
        try {
            // Check current permission state
            const result = await navigator.permissions.query({ name: 'microphone' });

            if (result.state === 'granted') {
                return true;
            }

            if (result.state === 'denied') {
                frappe.msgprint({
                    title: "Microphone Access Required",
                    message: "Please enable microphone access in your browser settings to make calls.",
                    indicator: "red"
                });
                return false;
            }

            // Prompt for permission
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop()); // Release immediately
            return true;

        } catch (error) {
            console.error("Microphone permission error:", error);
            frappe.msgprint({
                title: "Microphone Access Required",
                message: "Could not access microphone. Please check your browser permissions.",
                indicator: "red"
            });
            return false;
        }
    }

    /**
     * Get WebRTC credentials from backend
     */
    async getCredentials() {
        const result = await frappe.call({
            method: "pbx_integration.api.call.get_webrtc_signature"
        });
        return result.message || { success: false };
    }

    /**
     * Create DOM container for SDK UI
     */
    createContainer() {
        // Remove existing container if present
        if (this.container) {
            this.container.remove();
        }

        // Create floating phone widget container
        this.container = document.createElement("div");
        this.container.id = "pbx-webrtc-container";
        this.container.className = "pbx-webrtc-widget";
        document.body.appendChild(this.container);
    }

    /**
     * Initialize Yeastar Linkus SDK
     */
    async initSDK(credentials) {
        // Check if SDK is loaded
        if (typeof window.YSWebRTCUI === "undefined") {
            console.error("Linkus SDK not loaded");
            frappe.show_alert({
                message: "WebRTC SDK not loaded. Please refresh the page.",
                indicator: "red"
            }, 5);
            return false;
        }

        try {
            const data = await window.YSWebRTCUI.init(this.container, {
                username: credentials.username,
                secret: credentials.secret,
                pbxURL: credentials.pbx_url,

                // Optional configuration
                enableVideo: false,          // Audio only
                autoAnswer: false,           // Don't auto-answer
                callWaiting: true,           // Allow call waiting

                // UI customization
                hideHeader: false,
                hideMinimize: false
            });

            this.phone = data.phone;
            this.pbx = data.pbx;
            this.destroy = data.destroy;
            this.on = data.on;

            console.log("Linkus SDK initialized successfully");
            return true;

        } catch (error) {
            console.error("Linkus SDK init failed:", error);
            return false;
        }
    }

    /**
     * Setup event listeners for call events
     */
    setupEventListeners() {
        if (!this.on) return;

        // Incoming call
        this.on("incoming", (callInfo) => {
            console.log("Incoming call:", callInfo);
            this.currentCall = callInfo;
            this.onIncomingCall(callInfo);
        });

        // Call connected
        this.on("connected", (callInfo) => {
            console.log("Call connected:", callInfo);
            this.onCallConnected(callInfo);
        });

        // Call ended
        this.on("hangup", (callInfo) => {
            console.log("Call ended:", callInfo);
            this.currentCall = null;
            this.onCallEnded(callInfo);
        });

        // Connection status
        this.on("connectionStateChange", (state) => {
            console.log("Connection state:", state);
            if (state === "disconnected") {
                this.onDisconnected();
            }
        });

        // Error handling
        this.on("error", (error) => {
            console.error("WebRTC error:", error);
            frappe.show_alert({
                message: `Call error: ${error.message || error}`,
                indicator: "red"
            }, 5);
        });
    }

    /**
     * Make an outgoing call
     */
    async call(phoneNumber) {
        if (!this.initialized) {
            const ready = await this.init();
            if (!ready) return false;
        }

        if (!this.phone) {
            frappe.show_alert({
                message: "Phone not ready",
                indicator: "red"
            }, 3);
            return false;
        }

        try {
            await this.phone.call(phoneNumber);
            frappe.show_alert({
                message: `Calling ${phoneNumber}...`,
                indicator: "blue"
            }, 3);
            return true;
        } catch (error) {
            console.error("Call failed:", error);
            frappe.show_alert({
                message: `Failed to call: ${error.message || error}`,
                indicator: "red"
            }, 5);
            return false;
        }
    }

    /**
     * Answer incoming call
     */
    async answer() {
        if (!this.phone || !this.currentCall) {
            return false;
        }

        try {
            await this.phone.answer();
            return true;
        } catch (error) {
            console.error("Answer failed:", error);
            return false;
        }
    }

    /**
     * Hang up current call
     */
    async hangup() {
        if (!this.phone) {
            return false;
        }

        try {
            await this.phone.hangup();
            return true;
        } catch (error) {
            console.error("Hangup failed:", error);
            return false;
        }
    }

    /**
     * Toggle mute
     */
    toggleMute() {
        if (this.phone && this.phone.mute) {
            this.phone.mute();
        }
    }

    /**
     * Toggle hold
     */
    toggleHold() {
        if (this.phone && this.phone.hold) {
            this.phone.hold();
        }
    }

    /**
     * Send DTMF tone
     */
    sendDTMF(digit) {
        if (this.phone && this.phone.dtmf) {
            this.phone.dtmf(digit);
        }
    }

    // ============ Event Handlers ============

    onIncomingCall(callInfo) {
        // Show native browser notification if permitted
        if (Notification.permission === "granted") {
            new Notification("Incoming Call", {
                body: callInfo.callerNumber || "Unknown",
                icon: "/assets/pbx_integration/images/phone-icon.png",
                requireInteraction: true
            });
        }

        // Trigger Frappe event for other components
        frappe.publish("pbx_webrtc_incoming", callInfo);
    }

    onCallConnected(callInfo) {
        frappe.publish("pbx_webrtc_connected", callInfo);
    }

    onCallEnded(callInfo) {
        frappe.publish("pbx_webrtc_ended", callInfo);
    }

    onDisconnected() {
        this.initialized = false;
        frappe.show_alert({
            message: "WebRTC disconnected. Click phone icon to reconnect.",
            indicator: "orange"
        }, 5);
    }

    /**
     * Cleanup and disconnect
     */
    disconnect() {
        if (this.destroy) {
            this.destroy();
        }
        if (this.container) {
            this.container.remove();
        }
        this.initialized = false;
        this.phone = null;
        this.pbx = null;
    }
};

// Create global instance
pbx_integration.webrtc = new pbx_integration.WebRTC();
```

---

## Phase 3: Integrate with Existing Click-to-Call

### 3.1 Update pbx_telephony.js

Modify the existing `initiate_call` method to offer WebRTC as an option:

**File:** `pbx_integration/public/js/pbx_telephony.js`

Add these methods to the `pbx_integration.Telephony` class:

```javascript
async initiate_call(phone_number, frm) {
    // Check if WebRTC is preferred
    const useWebRTC = await this.shouldUseWebRTC();

    if (useWebRTC) {
        // Use browser-based WebRTC calling
        const success = await pbx_integration.webrtc.call(phone_number);
        if (success) return;

        // Fall through to PBX API if WebRTC fails
        frappe.show_alert({
            message: "WebRTC failed, using desk phone...",
            indicator: "orange"
        }, 3);
    }

    // Existing PBX API call logic (keep as-is for fallback)
    let link_doctype = null;
    let link_docname = null;

    if (frm) {
        link_doctype = frm.doctype;
        link_docname = frm.docname;
    }

    frappe.show_alert({
        message: `Calling ${phone_number}...`,
        indicator: "blue"
    }, 3);

    try {
        const result = await frappe.call({
            method: "pbx_integration.api.call.make_call",
            args: {
                callee: phone_number,
                link_doctype: link_doctype,
                link_docname: link_docname
            }
        });

        if (result.message && result.message.success) {
            frappe.show_alert({
                message: result.message.message,
                indicator: "green"
            }, 5);

            if (result.message.call_id) {
                this.active_calls[result.message.call_id] = {
                    phone: phone_number,
                    status: "Calling"
                };
            }
        } else {
            frappe.show_alert({
                message: result.message.message || "Failed to initiate call",
                indicator: "red"
            }, 5);
        }
    } catch (error) {
        frappe.show_alert({
            message: "Error initiating call",
            indicator: "red"
        }, 5);
        console.error("Click-to-call error:", error);
    }
}

async shouldUseWebRTC() {
    // Check user preference from localStorage
    const preference = localStorage.getItem("pbx_call_method");

    if (preference === "webrtc") {
        return true;
    } else if (preference === "pbx") {
        return false;
    }

    // First time: ask user preference
    return new Promise((resolve) => {
        const dialog = new frappe.ui.Dialog({
            title: "Choose Calling Method",
            fields: [
                {
                    fieldtype: "HTML",
                    options: `
                        <div style="margin-bottom: 15px;">
                            <p>How would you like to make calls?</p>
                        </div>
                    `
                }
            ],
            primary_action_label: "Use Browser (WebRTC)",
            primary_action: () => {
                localStorage.setItem("pbx_call_method", "webrtc");
                dialog.hide();
                resolve(true);
            },
            secondary_action_label: "Use Desk Phone",
            secondary_action: () => {
                localStorage.setItem("pbx_call_method", "pbx");
                dialog.hide();
                resolve(false);
            }
        });

        dialog.show();
    });
}

// Method to change calling preference
setCallingMethod(method) {
    if (method === "webrtc" || method === "pbx") {
        localStorage.setItem("pbx_call_method", method);
        frappe.show_alert({
            message: `Calling method set to ${method === "webrtc" ? "Browser" : "Desk Phone"}`,
            indicator: "green"
        }, 3);
    }
}
```

---

## Phase 4: CSS Styling

### 4.1 Create pbx_webrtc.css

**File:** `pbx_integration/public/css/pbx_webrtc.css`

```css
/* ============================================
   PBX WebRTC Phone Widget Styles
   ============================================ */

/* Main container - floating widget */
#pbx-webrtc-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 10000;

    /* Shadow and rounding for modern look */
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    border-radius: 12px;
    overflow: hidden;
    background: white;

    /* Default size */
    width: 320px;
    min-height: 200px;
    max-height: 500px;

    transition: all 0.3s ease;
}

/* Minimized state */
#pbx-webrtc-container.minimized {
    width: 60px;
    height: 60px;
    min-height: 60px;
    border-radius: 50%;
    cursor: pointer;
}

/* Hidden state */
#pbx-webrtc-container.hidden {
    display: none;
}

/* ============================================
   Override Linkus SDK UI Styles
   ============================================ */

/* Header styling */
#pbx-webrtc-container .ys-webrtc-header {
    background: var(--primary-color, #5e64ff);
    color: white;
    padding: 12px 16px;
}

/* Call button */
#pbx-webrtc-container .ys-webrtc-btn-call,
#pbx-webrtc-container [class*="call-btn"] {
    background: var(--green-500, #28a745) !important;
    border: none;
    border-radius: 50%;
    width: 50px;
    height: 50px;
}

#pbx-webrtc-container .ys-webrtc-btn-call:hover {
    background: var(--green-600, #218838) !important;
}

/* Hangup button */
#pbx-webrtc-container .ys-webrtc-btn-hangup,
#pbx-webrtc-container [class*="hangup-btn"] {
    background: var(--red-500, #dc3545) !important;
    border: none;
    border-radius: 50%;
    width: 50px;
    height: 50px;
}

#pbx-webrtc-container .ys-webrtc-btn-hangup:hover {
    background: var(--red-600, #c82333) !important;
}

/* Keypad styling */
#pbx-webrtc-container .ys-webrtc-keypad button {
    border-radius: 50%;
    width: 60px;
    height: 60px;
    font-size: 18px;
    font-weight: 500;
    border: 1px solid var(--border-color, #d1d8dd);
    background: white;
    transition: background 0.2s;
}

#pbx-webrtc-container .ys-webrtc-keypad button:hover {
    background: var(--bg-light-gray, #f5f7fa);
}

#pbx-webrtc-container .ys-webrtc-keypad button:active {
    background: var(--bg-gray, #e9ecef);
}

/* ============================================
   Incoming Call Animation
   ============================================ */

#pbx-webrtc-container.incoming {
    animation: pulse-ring 1.5s infinite;
}

@keyframes pulse-ring {
    0% {
        box-shadow: 0 0 0 0 rgba(40, 167, 69, 0.7);
    }
    70% {
        box-shadow: 0 0 0 20px rgba(40, 167, 69, 0);
    }
    100% {
        box-shadow: 0 0 0 0 rgba(40, 167, 69, 0);
    }
}

/* ============================================
   Floating Toggle Button (when minimized)
   ============================================ */

.pbx-webrtc-toggle {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: var(--primary-color, #5e64ff);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 9999;
    transition: transform 0.2s, box-shadow 0.2s;
}

.pbx-webrtc-toggle:hover {
    transform: scale(1.05);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
}

.pbx-webrtc-toggle svg {
    width: 28px;
    height: 28px;
    fill: white;
}

/* Badge for missed calls */
.pbx-webrtc-toggle .badge {
    position: absolute;
    top: -5px;
    right: -5px;
    background: var(--red-500, #dc3545);
    color: white;
    border-radius: 50%;
    width: 22px;
    height: 22px;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* ============================================
   Call Status Indicator
   ============================================ */

.pbx-call-status {
    padding: 8px 16px;
    text-align: center;
    font-weight: 500;
}

.pbx-call-status.ringing {
    background: var(--yellow-100, #fff3cd);
    color: var(--yellow-800, #856404);
}

.pbx-call-status.connected {
    background: var(--green-100, #d4edda);
    color: var(--green-800, #155724);
}

.pbx-call-status.ended {
    background: var(--gray-100, #f8f9fa);
    color: var(--gray-600, #6c757d);
}

/* ============================================
   Responsive adjustments
   ============================================ */

@media (max-width: 768px) {
    #pbx-webrtc-container {
        width: 100%;
        max-width: 100%;
        bottom: 0;
        right: 0;
        left: 0;
        border-radius: 12px 12px 0 0;
    }

    #pbx-webrtc-container.minimized {
        width: 50px;
        height: 50px;
        bottom: 10px;
        right: 10px;
        left: auto;
    }
}

/* ============================================
   Dark mode support
   ============================================ */

[data-theme="dark"] #pbx-webrtc-container {
    background: var(--card-bg, #1c2126);
    border: 1px solid var(--border-color, #2e3338);
}

[data-theme="dark"] #pbx-webrtc-container .ys-webrtc-keypad button {
    background: var(--control-bg, #252a2f);
    border-color: var(--border-color, #2e3338);
    color: var(--text-color, #e8e8e8);
}
```

---

## Phase 5: PBX Settings Updates

### 5.1 Add WebRTC Configuration Fields

Add these fields to the `PBX Settings` DocType:

**File:** `pbx_integration/doctype/pbx_settings/pbx_settings.json`

Add to the `fields` array:

```json
{
    "fieldname": "webrtc_section",
    "fieldtype": "Section Break",
    "label": "WebRTC Browser Calling"
},
{
    "fieldname": "enable_webrtc",
    "fieldtype": "Check",
    "label": "Enable Browser-Based Calling",
    "description": "Allow users to make calls directly in the browser using WebRTC"
},
{
    "fieldname": "webrtc_default",
    "fieldtype": "Check",
    "label": "Use WebRTC as Default",
    "depends_on": "enable_webrtc",
    "description": "When enabled, clicking a phone number will use browser calling instead of desk phone"
},
{
    "fieldname": "linkus_sdk_access_id",
    "fieldtype": "Data",
    "label": "Linkus SDK Access ID",
    "depends_on": "enable_webrtc",
    "description": "Get this from Yeastar Portal > Integrations > Linkus SDK"
},
{
    "fieldname": "linkus_sdk_access_key",
    "fieldtype": "Password",
    "label": "Linkus SDK Access Key",
    "depends_on": "enable_webrtc"
},
{
    "fieldname": "webrtc_column_break",
    "fieldtype": "Column Break"
},
{
    "fieldname": "webrtc_info",
    "fieldtype": "HTML",
    "options": "<div class='alert alert-info'><strong>Requirements:</strong><ul><li>Yeastar P-Series Cloud Edition</li><li>Ultimate Plan subscription</li><li>Linkus SDK enabled in Yeastar Portal</li><li>HTTPS enabled on this site</li></ul></div>",
    "depends_on": "enable_webrtc"
}
```

### 5.2 Update Backend API

If `get_webrtc_signature()` needs to use the new AccessID/AccessKey fields, update it in `call.py`:

```python
@frappe.whitelist()
def get_webrtc_signature():
    """Generate WebRTC login signature for the current user's extension."""

    settings = frappe.get_single("PBX Settings")

    if not settings.enable_webrtc:
        return {"success": False, "message": "WebRTC is not enabled"}

    # Get user's extension
    extension = get_user_extension(frappe.session.user)
    if not extension:
        return {"success": False, "message": "No extension configured for this user"}

    # Get access token using Linkus SDK credentials
    # (implementation depends on whether you use separate SDK credentials
    # or the same OAuth credentials)

    # ... rest of implementation
```

---

## Phase 6: Testing Checklist

### 6.1 Prerequisites

- [ ] Yeastar Ultimate Plan confirmed
- [ ] Linkus SDK enabled in Yeastar Portal
- [ ] AccessID and AccessKey obtained
- [ ] PBX Settings configured in Frappe
- [ ] User has extension mapped in PBX User Extension

### 6.2 Backend Tests

- [ ] `get_webrtc_signature()` returns valid signature
- [ ] Signature includes correct username (extension)
- [ ] Signature includes correct PBX URL
- [ ] Error handling for missing extension
- [ ] Error handling for disabled WebRTC

### 6.3 Frontend Tests

- [ ] Linkus SDK loads without errors
- [ ] SDK initializes with valid credentials
- [ ] Microphone permission request works
- [ ] Phone widget appears on screen
- [ ] Widget can be minimized/expanded

### 6.4 Calling Tests

- [ ] Outgoing call connects
- [ ] Audio quality is acceptable
- [ ] Can hear the other party
- [ ] Other party can hear you
- [ ] Hangup ends call properly
- [ ] Mute/unmute works
- [ ] Hold/resume works
- [ ] DTMF tones work (if needed)

### 6.5 Incoming Call Tests

- [ ] Incoming call shows notification
- [ ] Browser notification appears (if permitted)
- [ ] Answer button works
- [ ] Reject/hangup button works
- [ ] Call connects with audio

### 6.6 Fallback Tests

- [ ] Falls back to PBX API when WebRTC fails
- [ ] User preference persists across sessions
- [ ] Can switch between WebRTC and desk phone

### 6.7 Browser Compatibility

- [ ] Chrome (primary target)
- [ ] Firefox
- [ ] Safari (may have limitations)
- [ ] Edge

---

## Phase 7: Deployment

### 7.1 Steps

1. **Backup current code**
   ```bash
   cd apps/pbx_integration
   git checkout -b feature/webrtc-integration
   ```

2. **Create new files**
   - `public/js/pbx_webrtc.js`
   - `public/css/pbx_webrtc.css`

3. **Update existing files**
   - `hooks.py` - enable JS/CSS includes
   - `public/js/pbx_telephony.js` - add WebRTC option
   - `doctype/pbx_settings/pbx_settings.json` - add fields

4. **Run migrations**
   ```bash
   bench --site yoursite migrate
   ```

5. **Build assets**
   ```bash
   bench build --app pbx_integration
   ```

6. **Clear cache**
   ```bash
   bench --site yoursite clear-cache
   ```

7. **Test thoroughly**

8. **Commit and push**
   ```bash
   git add .
   git commit -m "feat: Add WebRTC browser-based calling via Linkus SDK"
   git push origin feature/webrtc-integration
   ```

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Create | NPM dependencies (optional) |
| `hooks.py` | Edit | Enable JS/CSS includes |
| `public/js/pbx_webrtc.js` | Create | Linkus SDK integration |
| `public/js/pbx_telephony.js` | Edit | Add WebRTC call option |
| `public/css/pbx_webrtc.css` | Create | Widget styling |
| `doctype/pbx_settings/pbx_settings.json` | Edit | Add WebRTC config fields |
| `api/call.py` | Edit (maybe) | Update signature generation |

---

## Estimated Effort

| Phase | Description | Effort |
|-------|-------------|--------|
| Phase 1 | Setup & SDK Installation | 1-2 hours |
| Phase 2 | WebRTC Client Module | 4-6 hours |
| Phase 3 | Integration with Click-to-Call | 2-3 hours |
| Phase 4 | CSS Styling | 1-2 hours |
| Phase 5 | PBX Settings Updates | 1 hour |
| Phase 6 | Testing | 4-6 hours |
| Phase 7 | Deployment | 1-2 hours |
| **Total** | | **14-22 hours** |

---

## References

- [Yeastar Linkus SDK for Web - Official Docs](https://help.yeastar.com/en/p-series-linkus-cloud-edition/linkus-sdk-guide/integrate-linkus-sdk-for-web-core.html)
- [ys-webrtc-sdk-ui - GitHub](https://github.com/Yeastar-PBX/ys-webrtc-sdk-ui)
- [ys-webrtc-sdk-core - GitHub](https://github.com/Yeastar-PBX/ys-webrtc-sdk-core)
- [ys-webrtc-sdk-core - NPM](https://www.npmjs.com/package/ys-webrtc-sdk-core)
- [Obtain Login Signature - Yeastar Docs](https://help.yeastar.com/en/p-series-linkus-cloud-edition/linkus-sdk-guide/obtain-login-signature-for-linkus-sdk-for-web.html)
