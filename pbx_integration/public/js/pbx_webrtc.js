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
		this.wrapper = null;    // Outer draggable wrapper
		this.container = null;  // SDK container
		this.destroy = null;
		this.on = null;
		this.sdkObserver = null; // MutationObserver for SDK elements

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
		if (this.wrapper) {
			this.wrapper.remove();
			this.wrapper = null;
		}
		this.container = null;
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
	 * Create DOM container for SDK UI with custom draggable wrapper
	 */
	createContainer() {
		// Remove existing wrapper if present
		const existingWrapper = document.getElementById("pbx-webrtc-wrapper");
		if (existingWrapper) {
			existingWrapper.remove();
		}

		// Create outer wrapper for dragging
		this.wrapper = document.createElement("div");
		this.wrapper.id = "pbx-webrtc-wrapper";
		this.wrapper.className = "pbx-webrtc-wrapper";

		// Create custom header with drag handle
		const header = document.createElement("div");
		header.className = "pbx-webrtc-header";
		header.innerHTML = `
			<div class="pbx-header-drag-handle">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
					<circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
					<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
				</svg>
			</div>
			<div class="pbx-header-title">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
					<path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
				</svg>
				<span>Phone</span>
			</div>
			<div class="pbx-header-actions">
				<button class="pbx-btn-minimize" title="Minimize">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
						<path d="M19 13H5v-2h14v2z"/>
					</svg>
				</button>
				<button class="pbx-btn-close" title="Close">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
						<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
					</svg>
				</button>
			</div>
		`;

		// Create SDK container
		this.container = document.createElement("div");
		this.container.id = "pbx-webrtc-container";
		this.container.className = "pbx-webrtc-sdk-container";

		// Assemble
		this.wrapper.appendChild(header);
		this.wrapper.appendChild(this.container);
		document.body.appendChild(this.wrapper);

		// Setup dragging and controls
		this.setupDraggable(header);
		this.setupHeaderControls(header);

		// Load saved position
		this.loadPosition();

		// Watch for SDK elements added outside our container
		this.setupSDKElementObserver();
	}

	/**
	 * Setup draggable functionality
	 */
	setupDraggable(header) {
		let isDragging = false;
		let startX, startY, startLeft, startTop;

		const dragHandle = header.querySelector(".pbx-header-drag-handle");

		const onMouseDown = (e) => {
			// Only drag from the header, not buttons
			if (e.target.closest("button")) return;

			isDragging = true;
			this.wrapper.classList.add("dragging");

			const rect = this.wrapper.getBoundingClientRect();
			startX = e.clientX;
			startY = e.clientY;
			startLeft = rect.left;
			startTop = rect.top;

			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("mouseup", onMouseUp);
			e.preventDefault();
		};

		const onMouseMove = (e) => {
			if (!isDragging) return;

			const deltaX = e.clientX - startX;
			const deltaY = e.clientY - startY;

			let newLeft = startLeft + deltaX;
			let newTop = startTop + deltaY;

			// Keep within viewport bounds
			const wrapperRect = this.wrapper.getBoundingClientRect();
			const maxLeft = window.innerWidth - wrapperRect.width;
			const maxTop = window.innerHeight - wrapperRect.height;

			newLeft = Math.max(0, Math.min(newLeft, maxLeft));
			newTop = Math.max(0, Math.min(newTop, maxTop));

			this.wrapper.style.left = newLeft + "px";
			this.wrapper.style.top = newTop + "px";
			this.wrapper.style.right = "auto";
			this.wrapper.style.bottom = "auto";
		};

		const onMouseUp = () => {
			isDragging = false;
			this.wrapper.classList.remove("dragging");
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);

			// Save position
			this.savePosition();
		};

		header.addEventListener("mousedown", onMouseDown);

		// Touch support for mobile
		header.addEventListener("touchstart", (e) => {
			if (e.target.closest("button")) return;
			const touch = e.touches[0];
			onMouseDown({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => {} });
		});

		document.addEventListener("touchmove", (e) => {
			if (!isDragging) return;
			const touch = e.touches[0];
			onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
		});

		document.addEventListener("touchend", onMouseUp);
	}

	/**
	 * Setup header control buttons
	 */
	setupHeaderControls(header) {
		const minimizeBtn = header.querySelector(".pbx-btn-minimize");
		const closeBtn = header.querySelector(".pbx-btn-close");

		minimizeBtn.addEventListener("click", () => {
			this.wrapper.classList.toggle("minimized");
			this.savePosition();
		});

		closeBtn.addEventListener("click", () => {
			this.wrapper.classList.add("hidden");
			// Show a floating button to restore
			this.showRestoreButton();
		});
	}

	/**
	 * Show floating button to restore the phone widget
	 */
	showRestoreButton() {
		let restoreBtn = document.getElementById("pbx-restore-btn");
		if (!restoreBtn) {
			restoreBtn = document.createElement("button");
			restoreBtn.id = "pbx-restore-btn";
			restoreBtn.className = "pbx-restore-btn";
			restoreBtn.innerHTML = `
				<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
					<path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
				</svg>
			`;
			restoreBtn.addEventListener("click", () => {
				this.wrapper.classList.remove("hidden");
				restoreBtn.classList.add("hidden");
			});
			document.body.appendChild(restoreBtn);
		}
		restoreBtn.classList.remove("hidden");
	}

	/**
	 * Save widget position to localStorage
	 */
	savePosition() {
		if (!this.wrapper) return;
		const rect = this.wrapper.getBoundingClientRect();
		const position = {
			left: this.wrapper.style.left,
			top: this.wrapper.style.top,
			minimized: this.wrapper.classList.contains("minimized")
		};
		localStorage.setItem("pbx_widget_position", JSON.stringify(position));
	}

	/**
	 * Load saved widget position
	 */
	loadPosition() {
		if (!this.wrapper) return;
		const saved = localStorage.getItem("pbx_widget_position");
		if (saved) {
			try {
				const position = JSON.parse(saved);
				if (position.left) this.wrapper.style.left = position.left;
				if (position.top) this.wrapper.style.top = position.top;
				if (position.left || position.top) {
					this.wrapper.style.right = "auto";
					this.wrapper.style.bottom = "auto";
				}
				if (position.minimized) {
					this.wrapper.classList.add("minimized");
				}
			} catch (e) {
				console.warn("Failed to load widget position:", e);
			}
		}
	}

	/**
	 * Setup MutationObserver to watch for SDK elements added to body
	 * The Yeastar SDK sometimes creates elements outside our container
	 */
	setupSDKElementObserver() {
		if (this.sdkObserver) {
			this.sdkObserver.disconnect();
		}

		this.sdkObserver = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach((node) => {
					if (node.nodeType === Node.ELEMENT_NODE) {
						// Check if this is an SDK element added to body
						if (this.isSDKElement(node) && node.parentElement === document.body) {
							console.log("Captured SDK element added to body:", node.className);
							this.positionSDKElement(node);
						}
					}
				});
			});
		});

		this.sdkObserver.observe(document.body, {
			childList: true,
			subtree: false
		});
	}

	/**
	 * Check if an element belongs to the Yeastar SDK
	 */
	isSDKElement(element) {
		if (!element.className) return false;
		const className = typeof element.className === "string" ? element.className : "";
		return className.includes("ys-") ||
			   className.includes("webrtc") ||
			   className.includes("call-") ||
			   element.id?.includes("ys-");
	}

	/**
	 * Position SDK element near our widget
	 */
	positionSDKElement(element) {
		if (!this.wrapper) return;

		const wrapperRect = this.wrapper.getBoundingClientRect();

		// Position the SDK element relative to our wrapper
		element.style.cssText += `
			position: fixed !important;
			z-index: 10002 !important;
			visibility: visible !important;
			display: block !important;
			opacity: 1 !important;
			right: ${window.innerWidth - wrapperRect.right}px !important;
			bottom: ${window.innerHeight - wrapperRect.bottom + wrapperRect.height + 10}px !important;
		`;
	}

	/**
	 * Capture any SDK elements that exist outside our container
	 */
	captureStraySDKElements() {
		// Find all SDK elements in body (not in our container)
		const allElements = document.body.children;
		for (let i = 0; i < allElements.length; i++) {
			const el = allElements[i];
			if (this.isSDKElement(el) && el !== this.wrapper && el.id !== "pbx-restore-btn") {
				console.log("Found stray SDK element:", el.className);
				this.positionSDKElement(el);
			}
		}
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
		// IMPORTANT: Ensure the widget is visible for incoming calls
		if (this.wrapper) {
			// Remove hidden state
			this.wrapper.classList.remove("hidden");
			// Remove minimized state so user can see the call UI
			this.wrapper.classList.remove("minimized");
			// Add incoming animation
			this.wrapper.classList.add("incoming");
			// Hide restore button if visible
			const restoreBtn = document.getElementById("pbx-restore-btn");
			if (restoreBtn) {
				restoreBtn.classList.add("hidden");
			}
		}

		// Capture any SDK elements that might have been added outside our container
		// Use a small delay to let SDK render its incoming call UI
		setTimeout(() => this.captureStraySDKElements(), 100);

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
		// Remove incoming animation when call is answered
		if (this.wrapper) {
			this.wrapper.classList.remove("incoming");
			// Add in-call state for CSS targeting
			this.wrapper.classList.add("in-call");
			// Ensure widget remains visible during call
			this.wrapper.classList.remove("hidden");
			this.wrapper.classList.remove("minimized");
		}

		// Capture any SDK elements that might have been added outside our container
		// Use delays to catch SDK UI at different render stages
		this.captureStraySDKElements();
		setTimeout(() => this.captureStraySDKElements(), 100);
		setTimeout(() => this.captureStraySDKElements(), 500);

		frappe.publish("pbx_webrtc_connected", callInfo);
	}

	onCallEnded(callInfo) {
		// Remove incoming animation and in-call state when call ends
		if (this.wrapper) {
			this.wrapper.classList.remove("incoming");
			this.wrapper.classList.remove("in-call");
		}
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

		// Clean up observer
		if (this.sdkObserver) {
			this.sdkObserver.disconnect();
			this.sdkObserver = null;
		}

		// Remove stale wrapper and container
		if (this.wrapper) {
			this.wrapper.remove();
			this.wrapper = null;
		}
		this.container = null;

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
		if (this.sdkObserver) {
			this.sdkObserver.disconnect();
			this.sdkObserver = null;
		}
		if (this.destroy) {
			try {
				this.destroy();
			} catch (e) {
				console.warn("Error during SDK destroy:", e);
			}
		}
		if (this.wrapper) {
			this.wrapper.remove();
			this.wrapper = null;
		}
		this.container = null;
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
