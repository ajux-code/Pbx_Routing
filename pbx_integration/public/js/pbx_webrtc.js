/**
 * PBX WebRTC Integration using Yeastar Linkus SDK
 *
 * Single persistent widget with state-aware UI:
 * - Idle: Compact dialer
 * - Incoming: Expanded with answer/reject buttons
 * - Active: Call controls (mute, hold, hangup, timer)
 * - Ended: Brief summary, then collapse to idle
 */

frappe.provide("pbx_integration");

pbx_integration.WebRTC = class WebRTC {
	constructor() {
		this.initialized = false;
		this.phone = null;
		this.pbx = null;
		this.currentCall = null;
		this.currentSession = null;  // SDK session object
		this.currentCallId = null;   // SDK call ID for answer/hangup
		this.wrapper = null;
		this.container = null;
		this.destroy = null;
		this.on = null;

		// Call state management
		this.callState = 'idle'; // idle, incoming, active, ended
		this.callTimer = null;
		this.callDuration = 0;
		this.incomingCallUI = null;
	}

	/**
	 * Initialize the Linkus SDK WebRTC client
	 */
	async init() {
		if (this.initialized && this.phone) {
			console.log("WebRTC already initialized");
			return true;
		}

		console.log("Initializing WebRTC SDK...");

		// Clean up any stale state
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
		this.callState = 'idle';

		const hasMic = await this.requestMicrophonePermission();
		if (!hasMic) {
			return false;
		}

		try {
			const credentials = await this.getCredentials();
			if (!credentials.success) {
				frappe.show_alert({
					message: credentials.message || "Failed to get WebRTC credentials",
					indicator: "red"
				}, 5);
				return false;
			}

			this.createContainer();

			const result = await this.initSDK(credentials);
			if (!result) {
				return false;
			}

			this.initialized = true;
			this.setupEventListeners();
			this.setupRealtimeListeners();

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

	async requestMicrophonePermission() {
		try {
			if (!navigator.permissions) {
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

	async getCredentials() {
		const result = await frappe.call({
			method: "pbx_integration.api.call.get_webrtc_signature"
		});
		return result.message || { success: false };
	}

	/**
	 * Create DOM container with custom header and incoming call UI area
	 */
	createContainer() {
		const existingWrapper = document.getElementById("pbx-webrtc-wrapper");
		if (existingWrapper) {
			existingWrapper.remove();
		}

		this.wrapper = document.createElement("div");
		this.wrapper.id = "pbx-webrtc-wrapper";
		this.wrapper.className = "pbx-webrtc-wrapper";
		this.wrapper.dataset.state = "idle";

		// Header
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
				<span class="pbx-header-text">Phone</span>
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

		// Custom incoming call UI (hidden by default)
		this.incomingCallUI = document.createElement("div");
		this.incomingCallUI.className = "pbx-incoming-call-ui";
		this.incomingCallUI.style.display = "none";
		this.incomingCallUI.innerHTML = `
			<div class="pbx-incoming-caller">
				<div class="pbx-caller-avatar">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
						<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
					</svg>
				</div>
				<div class="pbx-caller-info">
					<div class="pbx-caller-name">Unknown</div>
					<div class="pbx-caller-number"></div>
					<div class="pbx-call-status-text">Incoming call...</div>
				</div>
			</div>
			<div class="pbx-incoming-actions">
				<button class="pbx-btn-reject" title="Reject">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
						<path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
					</svg>
				</button>
				<button class="pbx-btn-answer" title="Answer">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
						<path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
					</svg>
				</button>
			</div>
		`;

		// SDK container
		this.container = document.createElement("div");
		this.container.id = "pbx-webrtc-container";
		this.container.className = "pbx-webrtc-sdk-container";

		// Assemble
		this.wrapper.appendChild(header);
		this.wrapper.appendChild(this.incomingCallUI);
		this.wrapper.appendChild(this.container);
		document.body.appendChild(this.wrapper);

		// Setup interactions
		this.setupDraggable(header);
		this.setupHeaderControls(header);
		this.setupIncomingCallButtons();
		this.loadPosition();
	}

	/**
	 * Setup incoming call button handlers
	 */
	setupIncomingCallButtons() {
		const answerBtn = this.incomingCallUI.querySelector(".pbx-btn-answer");
		const rejectBtn = this.incomingCallUI.querySelector(".pbx-btn-reject");

		answerBtn.addEventListener("click", async () => {
			console.log("Answer button clicked");
			await this.answer();
		});

		rejectBtn.addEventListener("click", async () => {
			console.log("Reject button clicked");
			await this.hangup();
		});
	}

	/**
	 * Set call state and update UI accordingly
	 */
	setCallState(state, callInfo = null) {
		console.log(`Call state: ${this.callState} -> ${state}`, callInfo);
		this.callState = state;

		if (this.wrapper) {
			this.wrapper.dataset.state = state;
		}

		const headerText = this.wrapper?.querySelector(".pbx-header-text");

		switch (state) {
			case 'idle':
				this.hideIncomingCallUI();
				this.stopCallTimer();
				// Clear all call references
				this.currentCall = null;
				this.currentSession = null;
				this.currentCallId = null;
				if (headerText) headerText.textContent = "Phone";
				if (this.wrapper) this.wrapper.classList.remove("incoming", "active");
				break;

			case 'incoming':
				this.showIncomingCallUI(callInfo);
				if (headerText) headerText.textContent = "Incoming Call";
				if (this.wrapper) {
					this.wrapper.classList.add("incoming");
					this.wrapper.classList.remove("active", "minimized", "hidden");
				}
				// Show restore button if hidden
				const restoreBtn = document.getElementById("pbx-restore-btn");
				if (restoreBtn) restoreBtn.classList.add("hidden");
				break;

			case 'active':
				this.hideIncomingCallUI();
				this.startCallTimer();
				if (headerText) headerText.textContent = "On Call";
				if (this.wrapper) {
					this.wrapper.classList.add("active");
					this.wrapper.classList.remove("incoming");
				}
				break;

			case 'ended':
				this.hideIncomingCallUI();
				this.stopCallTimer();
				// Clear call references when ended
				this.currentCall = null;
				this.currentSession = null;
				this.currentCallId = null;
				if (headerText) headerText.textContent = "Call Ended";
				if (this.wrapper) this.wrapper.classList.remove("incoming", "active");
				// Auto-return to idle after 2 seconds
				setTimeout(() => {
					if (this.callState === 'ended') {
						this.setCallState('idle');
					}
				}, 2000);
				break;
		}
	}

	/**
	 * Show custom incoming call UI
	 */
	showIncomingCallUI(callInfo) {
		if (!this.incomingCallUI) return;

		const callerName = this.incomingCallUI.querySelector(".pbx-caller-name");
		const callerNumber = this.incomingCallUI.querySelector(".pbx-caller-number");

		if (callerName) {
			callerName.textContent = callInfo?.callerName || callInfo?.name || "Unknown Caller";
		}
		if (callerNumber) {
			callerNumber.textContent = callInfo?.callerNumber || callInfo?.number || "";
		}

		this.incomingCallUI.style.display = "block";
	}

	/**
	 * Hide custom incoming call UI
	 */
	hideIncomingCallUI() {
		if (this.incomingCallUI) {
			this.incomingCallUI.style.display = "none";
		}
	}

	/**
	 * Start call duration timer
	 */
	startCallTimer() {
		this.callDuration = 0;
		this.stopCallTimer();

		const headerText = this.wrapper?.querySelector(".pbx-header-text");

		this.callTimer = setInterval(() => {
			this.callDuration++;
			const mins = Math.floor(this.callDuration / 60).toString().padStart(2, '0');
			const secs = (this.callDuration % 60).toString().padStart(2, '0');
			if (headerText) {
				headerText.textContent = `${mins}:${secs}`;
			}
		}, 1000);
	}

	/**
	 * Stop call duration timer
	 */
	stopCallTimer() {
		if (this.callTimer) {
			clearInterval(this.callTimer);
			this.callTimer = null;
		}
	}

	setupDraggable(header) {
		let isDragging = false;
		let startX, startY, startLeft, startTop;

		const onMouseDown = (e) => {
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
			this.savePosition();
		};

		header.addEventListener("mousedown", onMouseDown);

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

	setupHeaderControls(header) {
		const minimizeBtn = header.querySelector(".pbx-btn-minimize");
		const closeBtn = header.querySelector(".pbx-btn-close");

		minimizeBtn.addEventListener("click", () => {
			// Don't minimize during incoming call
			if (this.callState === 'incoming') return;
			this.wrapper.classList.toggle("minimized");
			this.savePosition();
		});

		closeBtn.addEventListener("click", () => {
			// Don't close during incoming call
			if (this.callState === 'incoming') return;
			this.wrapper.classList.add("hidden");
			this.showRestoreButton();
		});
	}

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

	savePosition() {
		if (!this.wrapper) return;
		const position = {
			left: this.wrapper.style.left,
			top: this.wrapper.style.top,
			minimized: this.wrapper.classList.contains("minimized")
		};
		localStorage.setItem("pbx_widget_position", JSON.stringify(position));
	}

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
	 * Initialize Yeastar Linkus SDK with hidden incoming component
	 */
	async initSDK(credentials) {
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

				// Configuration
				enableVideo: false,
				autoAnswer: false,
				callWaiting: true,

				// Hide SDK's incoming call popup - we use our own custom UI
				// Events still fire via Frappe realtime and phone.on listeners
				hiddenIncomingComponent: true,

				// Show dial panel
				hiddenDialPanelComponent: false,

				// Session window positioning
				sessionOption: {
					sessionSetting: {
						width: 300,
						height: 400
					}
				}
			});

			this.phone = data.phone;
			this.pbx = data.pbx;
			this.destroy = data.destroy;
			this.on = data.on;

			console.log("Linkus SDK initialized with hiddenIncomingComponent: true");
			console.log("SDK data keys:", Object.keys(data));
			console.log("Phone object:", this.phone);
			console.log("Phone methods:", this.phone ? Object.keys(this.phone) : 'none');

			// Also try to listen on phone object directly if it has an 'on' method
			if (this.phone && typeof this.phone.on === 'function') {
				console.log("Setting up direct phone event listeners");
				this.setupPhoneEventListeners();
			}

			return true;

		} catch (error) {
			console.error("Linkus SDK init failed:", error);
			return false;
		}
	}

	/**
	 * Setup event listeners for call state management
	 * Yeastar SDK events: newRTCSession, ringing, confirmed, ended, etc.
	 */
	setupEventListeners() {
		if (!this.on) return;

		// Log all events for debugging
		const events = [
			'incoming', 'newRTCSession', 'ringing', 'confirmed', 'connected',
			'startSession', 'hangup', 'ended', 'terminated', 'failed',
			'connectionStateChange', 'error'
		];

		events.forEach(eventName => {
			this.on(eventName, (data) => {
				console.log(`[WebRTC Event] ${eventName}:`, data);
			});
		});

		// New RTC Session - this is the main event for incoming calls
		this.on("newRTCSession", (session) => {
			console.log("newRTCSession:", session);

			// Check if this is an incoming call
			if (session && (session.direction === 'incoming' || session._direction === 'incoming')) {
				this.currentCall = session;
				const callInfo = {
					callerName: session.remote_identity?.display_name || session.remoteIdentity?.displayName || 'Unknown',
					callerNumber: session.remote_identity?.uri?.user || session.remoteIdentity?.uri?.user || session.number || '',
					session: session
				};
				this.setCallState('incoming', callInfo);
				this.onIncomingCall(callInfo);
			}
		});

		// Also try 'incoming' event (some SDK versions use this)
		this.on("incoming", (callInfo) => {
			console.log("incoming event:", callInfo);
			if (this.callState !== 'incoming') {
				this.currentCall = callInfo;
				this.setCallState('incoming', callInfo);
				this.onIncomingCall(callInfo);
			}
		});

		// Ringing event - could also indicate incoming
		this.on("ringing", (data) => {
			console.log("ringing event:", data);
			if (this.callState === 'idle' && data?.direction === 'incoming') {
				this.currentCall = data;
				this.setCallState('incoming', data);
				this.onIncomingCall(data);
			}
		});

		// Call connected/confirmed
		this.on("confirmed", (callInfo) => {
			console.log("Call confirmed event:", callInfo);
			this.setCallState('active', callInfo);
			this.onCallConnected(callInfo);
		});

		this.on("connected", (callInfo) => {
			console.log("Call connected event:", callInfo);
			this.setCallState('active', callInfo);
			this.onCallConnected(callInfo);
		});

		// Session start (for outbound calls)
		this.on("startSession", (data) => {
			console.log("startSession event:", data);
			// For outbound calls, this marks the start
			if (this.callState === 'idle') {
				this.setCallState('active', data);
			}
		});

		// Call ended - try multiple event names
		this.on("hangup", (callInfo) => {
			console.log("Call hangup event:", callInfo);
			this.currentCall = null;
			this.setCallState('ended', callInfo);
			this.onCallEnded(callInfo);
		});

		this.on("ended", (callInfo) => {
			console.log("Call ended event:", callInfo);
			this.currentCall = null;
			this.setCallState('ended', callInfo);
			this.onCallEnded(callInfo);
		});

		this.on("terminated", (callInfo) => {
			console.log("Call terminated event:", callInfo);
			this.currentCall = null;
			this.setCallState('ended', callInfo);
			this.onCallEnded(callInfo);
		});

		this.on("failed", (callInfo) => {
			console.log("Call failed event:", callInfo);
			this.currentCall = null;
			this.setCallState('ended', callInfo);
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
	 * Setup event listeners directly on the phone object
	 * The Yeastar SDK phone object may emit events directly
	 */
	setupPhoneEventListeners() {
		if (!this.phone || typeof this.phone.on !== 'function') return;

		console.log("Attaching listeners to phone object directly");

		// newRTCSession is the primary event for new calls
		// Event data is {callId: string, session: object}
		this.phone.on('newRTCSession', (data) => {
			console.log("[phone.on] newRTCSession:", data);

			if (data) {
				// Extract callId and session from event data
				const callId = data.callId || data.call_id;
				const session = data.session || data;

				console.log("Call ID:", callId);
				console.log("Session object:", session);
				console.log("Session keys:", session ? Object.keys(session) : 'none');

				// Store for answer/hangup
				this.currentCallId = callId;
				this.currentSession = session;

				// Check direction - might be on session or data
				const direction = session?.direction || session?._direction ||
					data?.direction || data?._direction;
				console.log("Session direction:", direction);

				// For incoming calls, show our UI
				// Since direction might be undefined, check if we're idle and got a session
				if (direction === 'incoming' || (this.callState === 'idle' && callId)) {
					const callInfo = {
						callerName: session?.remote_identity?.display_name ||
							session?.remoteIdentity?.displayName ||
							session?._remote_identity?.display_name ||
							'Unknown',
						callerNumber: session?.remote_identity?.uri?.user ||
							session?.remoteIdentity?.uri?.user ||
							session?._remote_identity?.uri?.user ||
							session?.request?.from?.uri?.user ||
							'',
						callId: callId,
						session: session
					};

					console.log("Incoming call detected, callInfo:", callInfo);

					this.currentCall = data;
					// Only set incoming if we're idle (avoid double-triggering)
					if (this.callState === 'idle') {
						this.setCallState('incoming', callInfo);
						this.onIncomingCall(callInfo);
					}

					// Also listen to session events if available
					if (session && typeof session.on === 'function') {
						session.on('accepted', () => {
							console.log("[session.on] accepted");
							this.setCallState('active');
						});
						session.on('confirmed', () => {
							console.log("[session.on] confirmed");
							this.setCallState('active');
						});
						session.on('ended', (endData) => {
							console.log("[session.on] ended:", endData);
							this.currentCall = null;
							this.currentSession = null;
							this.currentCallId = null;
							this.setCallState('ended');
						});
						session.on('failed', (failData) => {
							console.log("[session.on] failed:", failData);
							this.currentCall = null;
							this.currentSession = null;
							this.currentCallId = null;
							this.setCallState('ended');
						});
					}
				}
			}
		});

		// Other phone events
		['ringing', 'connecting', 'connected', 'disconnected'].forEach(evt => {
			this.phone.on(evt, (data) => {
				console.log(`[phone.on] ${evt}:`, data);
			});
		});
	}

	/**
	 * Setup Frappe realtime listeners for server-pushed call events
	 * The server pushes incoming call notifications via websocket
	 */
	setupRealtimeListeners() {
		console.log("Setting up Frappe realtime listeners for WebRTC");

		// Listen for incoming call notification from server
		frappe.realtime.on("pbx_incoming_call", (data) => {
			console.log("[realtime] pbx_incoming_call:", data);

			// Only show our UI if we're in idle state
			if (this.callState === 'idle') {
				const callInfo = {
					callerName: data.caller_name || data.contact_name || 'Unknown',
					callerNumber: data.caller_number || data.from_number || data.number || '',
					callId: data.call_id
				};

				this.currentCall = data;
				this.setCallState('incoming', callInfo);
				this.onIncomingCall(callInfo);
			}
		});

		// Also listen for show_call_popup (ERPNext standard)
		frappe.realtime.on("show_call_popup", (data) => {
			console.log("[realtime] show_call_popup:", data);

			if (this.callState === 'idle' && this.initialized) {
				const callInfo = {
					callerName: data.contact || data.caller_name || 'Unknown',
					callerNumber: data.from || data.phone || '',
					callId: data.call_log
				};

				this.currentCall = data;
				this.setCallState('incoming', callInfo);
				this.onIncomingCall(callInfo);
			}
		});

		// Listen for call answered/ended events
		frappe.realtime.on("pbx_call_answered", (data) => {
			console.log("[realtime] pbx_call_answered:", data);
			if (this.callState === 'incoming') {
				this.setCallState('active', data);
			}
		});

		frappe.realtime.on("pbx_call_ended", (data) => {
			console.log("[realtime] pbx_call_ended:", data);
			// IMPORTANT: Don't trust this event when SDK session is active
			// The Frappe realtime uses PBX call IDs, but SDK uses its own UUIDs
			// Only end the call if we don't have an active SDK session
			if (this.callState !== 'idle' && !this.currentSession) {
				console.log("Ending call based on realtime event (no active SDK session)");
				this.currentCall = null;
				this.setCallState('ended', data);
			} else if (this.currentSession) {
				console.log("Ignoring pbx_call_ended - SDK session is still active");
			}
		});
	}

	async call(phoneNumber) {
		if (!this.initialized || !this.phone) {
			console.log("WebRTC needs initialization");
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

	async answer() {
		console.log("Answering call...");
		console.log("Current callId:", this.currentCallId);
		console.log("Current session:", this.currentSession);

		// Try multiple approaches to answer the call

		// Approach 1: Use session.answer() if available
		if (this.currentSession && typeof this.currentSession.answer === 'function') {
			try {
				console.log("Trying session.answer()");
				await this.currentSession.answer();
				this.setCallState('active');
				return true;
			} catch (error) {
				console.error("session.answer() failed:", error);
			}
		}

		// Approach 2: Use phone.answer(callId) if we have callId
		if (this.phone && this.currentCallId) {
			try {
				console.log("Trying phone.answer(callId):", this.currentCallId);
				await this.phone.answer(this.currentCallId);
				this.setCallState('active');
				return true;
			} catch (error) {
				console.error("phone.answer(callId) failed:", error);
			}
		}

		// Approach 3: Use phone.answer() without args
		if (this.phone) {
			try {
				console.log("Trying phone.answer() without args");
				await this.phone.answer();
				this.setCallState('active');
				return true;
			} catch (error) {
				console.error("phone.answer() failed:", error);
			}
		}

		console.error("All answer approaches failed");
		return false;
	}

	async hangup() {
		console.log("Hanging up...");
		console.log("Current callId:", this.currentCallId);
		console.log("Current session:", this.currentSession);

		// Try multiple approaches to hangup

		// Approach 1: Use session.terminate() if available
		if (this.currentSession && typeof this.currentSession.terminate === 'function') {
			try {
				console.log("Trying session.terminate()");
				this.currentSession.terminate();
				return true;
			} catch (error) {
				console.error("session.terminate() failed:", error);
			}
		}

		// Approach 2: Use session.hangup() if available
		if (this.currentSession && typeof this.currentSession.hangup === 'function') {
			try {
				console.log("Trying session.hangup()");
				await this.currentSession.hangup();
				return true;
			} catch (error) {
				console.error("session.hangup() failed:", error);
			}
		}

		// Approach 3: Use phone.hangup(callId) if we have callId
		if (this.phone && this.currentCallId) {
			try {
				console.log("Trying phone.hangup(callId):", this.currentCallId);
				await this.phone.hangup(this.currentCallId);
				return true;
			} catch (error) {
				console.error("phone.hangup(callId) failed:", error);
			}
		}

		// Approach 4: Use phone.hangup() without args
		if (this.phone) {
			try {
				console.log("Trying phone.hangup() without args");
				await this.phone.hangup();
				return true;
			} catch (error) {
				console.error("phone.hangup() failed:", error);
			}
		}

		console.error("All hangup approaches failed");
		return false;
	}

	toggleMute() {
		if (this.phone && this.phone.mute) {
			this.phone.mute();
		}
	}

	toggleHold() {
		if (this.phone && this.phone.hold) {
			this.phone.hold();
		}
	}

	sendDTMF(digit) {
		if (this.phone && this.phone.dtmf) {
			this.phone.dtmf(digit);
		}
	}

	// ============ Event Handlers ============

	onIncomingCall(callInfo) {
		console.log("onIncomingCall handler:", callInfo);

		// Browser notification
		if (Notification.permission === "granted") {
			try {
				new Notification("Incoming Call", {
					body: callInfo?.callerNumber || callInfo?.number || "Unknown",
					icon: "/assets/pbx_integration/images/phone-icon.png",
					requireInteraction: true
				});
			} catch (e) {
				console.warn("Could not show notification:", e);
			}
		}

		// Emit custom event for other parts of the app (use correct Frappe API)
		$(document).trigger("pbx_webrtc_incoming", [callInfo]);
	}

	onCallConnected(callInfo) {
		console.log("onCallConnected handler:", callInfo);
		$(document).trigger("pbx_webrtc_connected", [callInfo]);
	}

	onCallEnded(callInfo) {
		console.log("onCallEnded handler:", callInfo);
		$(document).trigger("pbx_webrtc_ended", [callInfo]);
	}

	onDisconnected() {
		console.log("WebRTC disconnected - resetting state");
		this.initialized = false;
		this.phone = null;
		this.pbx = null;
		this.destroy = null;
		this.on = null;
		this.currentCall = null;
		this.setCallState('idle');

		if (this.wrapper) {
			this.wrapper.remove();
			this.wrapper = null;
		}
		this.container = null;
		this.incomingCallUI = null;

		frappe.show_alert({
			message: "WebRTC disconnected. Will reconnect on next call.",
			indicator: "orange"
		}, 5);
	}

	disconnect() {
		console.log("Disconnecting WebRTC SDK...");
		this.stopCallTimer();

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
		this.incomingCallUI = null;
		this.initialized = false;
		this.phone = null;
		this.pbx = null;
		this.destroy = null;
		this.on = null;
		this.currentCall = null;
		this.callState = 'idle';
	}
};

// Create global instance
pbx_integration.webrtc = new pbx_integration.WebRTC();
