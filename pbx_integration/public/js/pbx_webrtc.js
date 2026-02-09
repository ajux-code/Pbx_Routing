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
		this.destroy = null;
		this.on = null;

		// Don't auto-init - wait for explicit call
	}

	/**
	 * Initialize the Linkus SDK WebRTC client
	 */
	async init() {
		// If already initialized AND phone exists, we're good
		if (this.initialized && this.phone) {
			console.log("WebRTC already initialized");
			return true;
		}

		console.log("Initializing WebRTC SDK...");

		// Clean up any stale state before re-initializing
		if (this.destroy) {
			try {
				this.destroy();
			} catch (e) {
				console.warn("Error destroying old SDK instance:", e);
			}
		}
		if (this.container) {
			this.container.remove();
			this.container = null;
		}
		this.phone = null;
		this.pbx = null;
		this.destroy = null;
		this.on = null;
		this.initialized = false;

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
			// Check if browser supports permissions API
			if (!navigator.permissions) {
				// Fallback for browsers without permissions API (Safari)
				try {
					const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
					stream.getTracks().forEach(track => track.stop());
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
		// Check both initialized flag AND phone object existence
		// After a call ends, the SDK may be destroyed and need re-initialization
		if (!this.initialized || !this.phone) {
			console.log("WebRTC needs initialization, phone:", this.phone, "initialized:", this.initialized);
			const ready = await this.init();
			if (!ready) {
				console.error("WebRTC re-initialization failed");
				return false;
			}
		}

		if (!this.phone) {
			frappe.show_alert({
				message: "Phone not ready after init",
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
		console.log("WebRTC disconnected - resetting state");
		// Reset all state so next call triggers full re-initialization
		this.initialized = false;
		this.phone = null;
		this.pbx = null;
		this.destroy = null;
		this.on = null;
		this.currentCall = null;

		// Remove stale container
		if (this.container) {
			this.container.remove();
			this.container = null;
		}

		frappe.show_alert({
			message: "WebRTC disconnected. Will reconnect on next call.",
			indicator: "orange"
		}, 5);
	}

	/**
	 * Cleanup and disconnect
	 */
	disconnect() {
		console.log("Disconnecting WebRTC SDK...");
		if (this.destroy) {
			try {
				this.destroy();
			} catch (e) {
				console.warn("Error during SDK destroy:", e);
			}
		}
		if (this.container) {
			this.container.remove();
			this.container = null;
		}
		this.initialized = false;
		this.phone = null;
		this.pbx = null;
		this.destroy = null;
		this.on = null;
		this.currentCall = null;
	}
};

// Create global instance
pbx_integration.webrtc = new pbx_integration.WebRTC();
