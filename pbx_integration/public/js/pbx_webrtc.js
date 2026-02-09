/**
 * PBX WebRTC Integration using Yeastar Linkus Core SDK
 *
 * Custom UI implementation for full control over call experience:
 * - Draggable phone widget
 * - Dial pad with DTMF support
 * - Incoming call popup with answer/reject
 * - In-call controls (mute, hold, hangup)
 * - Call timer and status display
 */

frappe.provide("pbx_integration");

pbx_integration.WebRTC = class WebRTC {
	constructor() {
		this.initialized = false;
		this.phone = null;      // Linkus SDK phone operator
		this.pbx = null;        // Linkus SDK PBX operator
		this.currentCall = null;
		this.wrapper = null;    // Outer draggable wrapper
		this.callState = "idle"; // idle, ringing, incoming, connected
		this.isMuted = false;
		this.isOnHold = false;
		this.callTimer = null;
		this.callStartTime = null;
		this.destroy = null;
	}

	/**
	 * Initialize the Linkus Core SDK WebRTC client
	 */
	async init() {
		if (this.initialized && this.phone) {
			console.log("WebRTC already initialized");
			return true;
		}

		console.log("Initializing WebRTC Core SDK...");

		// Clean up any stale state
		this.cleanup();

		// Check microphone permission first
		const hasMic = await this.requestMicrophonePermission();
		if (!hasMic) {
			return false;
		}

		try {
			// Get login signature from backend
			const credentials = await this.getCredentials();
			if (!credentials.success) {
				frappe.show_alert({
					message: credentials.message || "Failed to get WebRTC credentials",
					indicator: "red"
				}, 5);
				return false;
			}

			// Create the UI
			this.createUI();

			// Initialize Core SDK
			const result = await this.initSDK(credentials);
			if (!result) {
				return false;
			}

			this.initialized = true;
			this.setupEventListeners();
			this.updateUI();

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
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			stream.getTracks().forEach(track => track.stop());
			return true;
		} catch (error) {
			console.error("Microphone permission error:", error);
			frappe.msgprint({
				title: "Microphone Access Required",
				message: "Please enable microphone access in your browser settings to make calls.",
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
	 * Create the complete phone UI
	 */
	createUI() {
		// Remove existing wrapper
		const existing = document.getElementById("pbx-webrtc-wrapper");
		if (existing) existing.remove();

		// Create wrapper
		this.wrapper = document.createElement("div");
		this.wrapper.id = "pbx-webrtc-wrapper";
		this.wrapper.className = "pbx-webrtc-wrapper";

		this.wrapper.innerHTML = `
			<!-- Header -->
			<div class="pbx-header">
				<div class="pbx-header-drag">
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
			</div>

			<!-- Status Bar -->
			<div class="pbx-status-bar">
				<span class="pbx-status-indicator"></span>
				<span class="pbx-status-text">Ready</span>
				<span class="pbx-call-timer"></span>
			</div>

			<!-- Incoming Call Panel (hidden by default) -->
			<div class="pbx-incoming-panel pbx-hidden">
				<div class="pbx-incoming-info">
					<div class="pbx-incoming-icon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
							<path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
						</svg>
					</div>
					<div class="pbx-incoming-text">Incoming Call</div>
					<div class="pbx-incoming-number"></div>
				</div>
				<div class="pbx-incoming-actions">
					<button class="pbx-btn pbx-btn-answer" title="Answer">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
							<path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
						</svg>
					</button>
					<button class="pbx-btn pbx-btn-reject" title="Reject">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
							<path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
						</svg>
					</button>
				</div>
			</div>

			<!-- In-Call Panel (hidden by default) -->
			<div class="pbx-incall-panel pbx-hidden">
				<div class="pbx-incall-info">
					<div class="pbx-incall-number"></div>
					<div class="pbx-incall-status">Connected</div>
				</div>
				<div class="pbx-incall-actions">
					<button class="pbx-btn pbx-btn-mute" title="Mute">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="pbx-icon-unmuted">
							<path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
						</svg>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="pbx-icon-muted pbx-hidden">
							<path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
						</svg>
						<span>Mute</span>
					</button>
					<button class="pbx-btn pbx-btn-hold" title="Hold">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="pbx-icon-unhold">
							<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
						</svg>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="pbx-icon-hold pbx-hidden">
							<path d="M8 5v14l11-7z"/>
						</svg>
						<span>Hold</span>
					</button>
					<button class="pbx-btn pbx-btn-keypad" title="Keypad">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
							<path d="M12 19c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM6 1c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12-8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-6 8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
						</svg>
						<span>Keypad</span>
					</button>
					<button class="pbx-btn pbx-btn-hangup" title="Hang Up">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
							<path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
						</svg>
						<span>End</span>
					</button>
				</div>
			</div>

			<!-- Dial Pad Panel -->
			<div class="pbx-dialpad-panel">
				<div class="pbx-dialpad-input-wrapper">
					<input type="text" class="pbx-dialpad-input" placeholder="Enter number..." />
					<button class="pbx-btn-backspace" title="Backspace">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
							<path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-3 12.59L17.59 17 14 13.41 10.41 17 9 15.59 12.59 12 9 8.41 10.41 7 14 10.59 17.59 7 19 8.41 15.41 12 19 15.59z"/>
						</svg>
					</button>
				</div>
				<div class="pbx-dialpad-grid">
					<button class="pbx-dialpad-btn" data-digit="1">1</button>
					<button class="pbx-dialpad-btn" data-digit="2">2<span>ABC</span></button>
					<button class="pbx-dialpad-btn" data-digit="3">3<span>DEF</span></button>
					<button class="pbx-dialpad-btn" data-digit="4">4<span>GHI</span></button>
					<button class="pbx-dialpad-btn" data-digit="5">5<span>JKL</span></button>
					<button class="pbx-dialpad-btn" data-digit="6">6<span>MNO</span></button>
					<button class="pbx-dialpad-btn" data-digit="7">7<span>PQRS</span></button>
					<button class="pbx-dialpad-btn" data-digit="8">8<span>TUV</span></button>
					<button class="pbx-dialpad-btn" data-digit="9">9<span>WXYZ</span></button>
					<button class="pbx-dialpad-btn" data-digit="*">*</button>
					<button class="pbx-dialpad-btn" data-digit="0">0<span>+</span></button>
					<button class="pbx-dialpad-btn" data-digit="#">#</button>
				</div>
				<div class="pbx-dialpad-actions">
					<button class="pbx-btn pbx-btn-call" title="Call">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
							<path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
						</svg>
					</button>
				</div>
			</div>

			<!-- DTMF Keypad (shown during call when keypad button pressed) -->
			<div class="pbx-dtmf-panel pbx-hidden">
				<div class="pbx-dtmf-grid">
					<button class="pbx-dialpad-btn pbx-dtmf-btn" data-digit="1">1</button>
					<button class="pbx-dialpad-btn pbx-dtmf-btn" data-digit="2">2</button>
					<button class="pbx-dialpad-btn pbx-dtmf-btn" data-digit="3">3</button>
					<button class="pbx-dialpad-btn pbx-dtmf-btn" data-digit="4">4</button>
					<button class="pbx-dialpad-btn pbx-dtmf-btn" data-digit="5">5</button>
					<button class="pbx-dialpad-btn pbx-dtmf-btn" data-digit="6">6</button>
					<button class="pbx-dialpad-btn pbx-dtmf-btn" data-digit="7">7</button>
					<button class="pbx-dialpad-btn pbx-dtmf-btn" data-digit="8">8</button>
					<button class="pbx-dialpad-btn pbx-dtmf-btn" data-digit="9">9</button>
					<button class="pbx-dialpad-btn pbx-dtmf-btn" data-digit="*">*</button>
					<button class="pbx-dialpad-btn pbx-dtmf-btn" data-digit="0">0</button>
					<button class="pbx-dialpad-btn pbx-dtmf-btn" data-digit="#">#</button>
				</div>
				<button class="pbx-btn pbx-btn-close-dtmf">Close Keypad</button>
			</div>
		`;

		document.body.appendChild(this.wrapper);

		// Setup UI interactions
		this.setupDraggable();
		this.setupHeaderControls();
		this.setupDialpad();
		this.setupCallControls();
		this.loadPosition();
	}

	/**
	 * Setup draggable functionality
	 */
	setupDraggable() {
		const header = this.wrapper.querySelector(".pbx-header");
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

			let newLeft = startLeft + (e.clientX - startX);
			let newTop = startTop + (e.clientY - startY);

			const rect = this.wrapper.getBoundingClientRect();
			newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - rect.width));
			newTop = Math.max(0, Math.min(newTop, window.innerHeight - rect.height));

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

		// Touch support
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
	setupHeaderControls() {
		const minimizeBtn = this.wrapper.querySelector(".pbx-btn-minimize");
		const closeBtn = this.wrapper.querySelector(".pbx-btn-close");

		minimizeBtn.addEventListener("click", () => {
			this.wrapper.classList.toggle("minimized");
			this.savePosition();
		});

		closeBtn.addEventListener("click", () => {
			this.wrapper.classList.add("hidden");
			this.showRestoreButton();
		});
	}

	/**
	 * Setup dial pad interactions
	 */
	setupDialpad() {
		const input = this.wrapper.querySelector(".pbx-dialpad-input");
		const backspace = this.wrapper.querySelector(".pbx-btn-backspace");
		const dialButtons = this.wrapper.querySelectorAll(".pbx-dialpad-btn:not(.pbx-dtmf-btn)");
		const callBtn = this.wrapper.querySelector(".pbx-btn-call");

		// Dial pad button clicks
		dialButtons.forEach(btn => {
			btn.addEventListener("click", () => {
				const digit = btn.dataset.digit;
				input.value += digit;
				input.focus();
			});
		});

		// Backspace
		backspace.addEventListener("click", () => {
			input.value = input.value.slice(0, -1);
			input.focus();
		});

		// Call button
		callBtn.addEventListener("click", () => {
			const number = input.value.trim();
			if (number) {
				this.call(number);
			}
		});

		// Enter key to call
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				const number = input.value.trim();
				if (number) {
					this.call(number);
				}
			}
		});
	}

	/**
	 * Setup in-call control buttons
	 */
	setupCallControls() {
		// Answer button
		this.wrapper.querySelector(".pbx-btn-answer").addEventListener("click", () => {
			this.answer();
		});

		// Reject button
		this.wrapper.querySelector(".pbx-btn-reject").addEventListener("click", () => {
			this.hangup();
		});

		// Mute button
		this.wrapper.querySelector(".pbx-btn-mute").addEventListener("click", () => {
			this.toggleMute();
		});

		// Hold button
		this.wrapper.querySelector(".pbx-btn-hold").addEventListener("click", () => {
			this.toggleHold();
		});

		// Hangup button
		this.wrapper.querySelector(".pbx-btn-hangup").addEventListener("click", () => {
			this.hangup();
		});

		// Keypad button (show DTMF panel)
		this.wrapper.querySelector(".pbx-btn-keypad").addEventListener("click", () => {
			this.wrapper.querySelector(".pbx-dtmf-panel").classList.toggle("pbx-hidden");
			this.wrapper.querySelector(".pbx-incall-panel").classList.toggle("pbx-hidden");
		});

		// Close DTMF panel
		this.wrapper.querySelector(".pbx-btn-close-dtmf").addEventListener("click", () => {
			this.wrapper.querySelector(".pbx-dtmf-panel").classList.add("pbx-hidden");
			this.wrapper.querySelector(".pbx-incall-panel").classList.remove("pbx-hidden");
		});

		// DTMF buttons
		this.wrapper.querySelectorAll(".pbx-dtmf-btn").forEach(btn => {
			btn.addEventListener("click", () => {
				this.sendDTMF(btn.dataset.digit);
			});
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
	 * Initialize Yeastar Linkus Core SDK
	 */
	async initSDK(credentials) {
		if (typeof window.YSWebRTC === "undefined") {
			console.error("Linkus Core SDK not loaded");
			frappe.show_alert({
				message: "WebRTC SDK not loaded. Please refresh the page.",
				indicator: "red"
			}, 5);
			return false;
		}

		try {
			// Core SDK init
			const result = await window.YSWebRTC.init({
				username: credentials.username,
				secret: credentials.secret,
				pbxURL: credentials.pbx_url
			});

			this.phone = result.phone;
			this.pbx = result.pbx;
			this.destroy = result.destroy;

			console.log("Linkus Core SDK initialized successfully");
			return true;

		} catch (error) {
			console.error("Linkus Core SDK init failed:", error);
			return false;
		}
	}

	/**
	 * Setup event listeners for call events
	 */
	setupEventListeners() {
		if (!this.phone) return;

		// Incoming call
		this.phone.on("incoming", (callInfo) => {
			console.log("Incoming call:", callInfo);
			this.currentCall = callInfo;
			this.onIncomingCall(callInfo);
		});

		// Outgoing call ringing
		this.phone.on("ringing", (callInfo) => {
			console.log("Ringing:", callInfo);
			this.callState = "ringing";
			this.updateUI();
		});

		// Call connected
		this.phone.on("connected", (callInfo) => {
			console.log("Call connected:", callInfo);
			this.onCallConnected(callInfo);
		});

		// Call ended
		this.phone.on("hangup", (callInfo) => {
			console.log("Call ended:", callInfo);
			this.onCallEnded(callInfo);
		});

		// Error handling
		this.phone.on("error", (error) => {
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
		if (!this.initialized || !this.phone) {
			const ready = await this.init();
			if (!ready) return false;
		}

		try {
			await this.phone.call(phoneNumber);

			this.callState = "ringing";
			this.wrapper.querySelector(".pbx-incall-number").textContent = phoneNumber;
			this.wrapper.querySelector(".pbx-incall-status").textContent = "Calling...";
			this.updateUI();

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
		if (!this.phone || !this.currentCall) return false;

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
		if (!this.phone) return false;

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
		if (!this.phone) return;

		if (this.isMuted) {
			this.phone.unmute();
			this.isMuted = false;
		} else {
			this.phone.mute();
			this.isMuted = true;
		}

		this.updateMuteButton();
	}

	/**
	 * Toggle hold
	 */
	toggleHold() {
		if (!this.phone) return;

		if (this.isOnHold) {
			this.phone.unhold();
			this.isOnHold = false;
		} else {
			this.phone.hold();
			this.isOnHold = true;
		}

		this.updateHoldButton();
	}

	/**
	 * Send DTMF tone
	 */
	sendDTMF(digit) {
		if (this.phone && this.callState === "connected") {
			this.phone.dtmf(digit);
			// Visual feedback
			frappe.show_alert({ message: `DTMF: ${digit}`, indicator: "blue" }, 1);
		}
	}

	// ============ Event Handlers ============

	onIncomingCall(callInfo) {
		this.callState = "incoming";
		this.currentCall = callInfo;

		// Show widget if hidden
		this.wrapper.classList.remove("hidden", "minimized");
		const restoreBtn = document.getElementById("pbx-restore-btn");
		if (restoreBtn) restoreBtn.classList.add("hidden");

		// Update incoming panel
		const number = callInfo.callerNumber || callInfo.number || "Unknown";
		this.wrapper.querySelector(".pbx-incoming-number").textContent = number;

		// Add ringing animation
		this.wrapper.classList.add("incoming");

		this.updateUI();

		// Browser notification
		if (Notification.permission === "granted") {
			new Notification("Incoming Call", {
				body: number,
				icon: "/assets/pbx_integration/images/phone-icon.png",
				requireInteraction: true
			});
		}

		frappe.publish("pbx_webrtc_incoming", callInfo);
	}

	onCallConnected(callInfo) {
		this.callState = "connected";
		this.wrapper.classList.remove("incoming");

		// Start call timer
		this.callStartTime = Date.now();
		this.startCallTimer();

		// Update in-call panel
		const number = callInfo.callerNumber || callInfo.number || this.wrapper.querySelector(".pbx-dialpad-input").value || "Unknown";
		this.wrapper.querySelector(".pbx-incall-number").textContent = number;
		this.wrapper.querySelector(".pbx-incall-status").textContent = "Connected";

		this.updateUI();

		frappe.publish("pbx_webrtc_connected", callInfo);
	}

	onCallEnded(callInfo) {
		this.callState = "idle";
		this.currentCall = null;
		this.isMuted = false;
		this.isOnHold = false;

		// Stop call timer
		this.stopCallTimer();

		// Remove animations
		this.wrapper.classList.remove("incoming");

		// Clear input
		this.wrapper.querySelector(".pbx-dialpad-input").value = "";

		// Reset buttons
		this.updateMuteButton();
		this.updateHoldButton();

		this.updateUI();

		frappe.publish("pbx_webrtc_ended", callInfo);
	}

	// ============ UI Updates ============

	updateUI() {
		const dialpadPanel = this.wrapper.querySelector(".pbx-dialpad-panel");
		const incomingPanel = this.wrapper.querySelector(".pbx-incoming-panel");
		const incallPanel = this.wrapper.querySelector(".pbx-incall-panel");
		const dtmfPanel = this.wrapper.querySelector(".pbx-dtmf-panel");
		const statusBar = this.wrapper.querySelector(".pbx-status-bar");
		const statusIndicator = this.wrapper.querySelector(".pbx-status-indicator");
		const statusText = this.wrapper.querySelector(".pbx-status-text");

		// Hide all panels first
		dialpadPanel.classList.add("pbx-hidden");
		incomingPanel.classList.add("pbx-hidden");
		incallPanel.classList.add("pbx-hidden");
		dtmfPanel.classList.add("pbx-hidden");

		// Update based on call state
		switch (this.callState) {
			case "idle":
				dialpadPanel.classList.remove("pbx-hidden");
				statusIndicator.className = "pbx-status-indicator ready";
				statusText.textContent = "Ready";
				break;

			case "incoming":
				incomingPanel.classList.remove("pbx-hidden");
				statusIndicator.className = "pbx-status-indicator incoming";
				statusText.textContent = "Incoming Call";
				break;

			case "ringing":
				incallPanel.classList.remove("pbx-hidden");
				statusIndicator.className = "pbx-status-indicator ringing";
				statusText.textContent = "Calling...";
				break;

			case "connected":
				incallPanel.classList.remove("pbx-hidden");
				statusIndicator.className = "pbx-status-indicator connected";
				statusText.textContent = "In Call";
				break;
		}
	}

	updateMuteButton() {
		const btn = this.wrapper.querySelector(".pbx-btn-mute");
		const unmutedIcon = btn.querySelector(".pbx-icon-unmuted");
		const mutedIcon = btn.querySelector(".pbx-icon-muted");

		if (this.isMuted) {
			btn.classList.add("active");
			unmutedIcon.classList.add("pbx-hidden");
			mutedIcon.classList.remove("pbx-hidden");
		} else {
			btn.classList.remove("active");
			unmutedIcon.classList.remove("pbx-hidden");
			mutedIcon.classList.add("pbx-hidden");
		}
	}

	updateHoldButton() {
		const btn = this.wrapper.querySelector(".pbx-btn-hold");
		const unholdIcon = btn.querySelector(".pbx-icon-unhold");
		const holdIcon = btn.querySelector(".pbx-icon-hold");

		if (this.isOnHold) {
			btn.classList.add("active");
			unholdIcon.classList.add("pbx-hidden");
			holdIcon.classList.remove("pbx-hidden");
		} else {
			btn.classList.remove("active");
			unholdIcon.classList.remove("pbx-hidden");
			holdIcon.classList.add("pbx-hidden");
		}
	}

	startCallTimer() {
		const timerEl = this.wrapper.querySelector(".pbx-call-timer");

		this.callTimer = setInterval(() => {
			const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
			const minutes = Math.floor(elapsed / 60).toString().padStart(2, "0");
			const seconds = (elapsed % 60).toString().padStart(2, "0");
			timerEl.textContent = `${minutes}:${seconds}`;
		}, 1000);

		timerEl.textContent = "00:00";
	}

	stopCallTimer() {
		if (this.callTimer) {
			clearInterval(this.callTimer);
			this.callTimer = null;
		}
		if (this.wrapper) {
			const timerEl = this.wrapper.querySelector(".pbx-call-timer");
			if (timerEl) timerEl.textContent = "";
		}
	}

	/**
	 * Cleanup and reset
	 */
	cleanup() {
		// Stop timer first while wrapper still exists
		this.stopCallTimer();

		if (this.destroy) {
			try {
				this.destroy();
			} catch (e) {
				console.warn("Error destroying SDK:", e);
			}
		}
		if (this.wrapper) {
			this.wrapper.remove();
			this.wrapper = null;
		}
		this.initialized = false;
		this.phone = null;
		this.pbx = null;
		this.destroy = null;
		this.currentCall = null;
		this.callState = "idle";
		this.isMuted = false;
		this.isOnHold = false;
	}

	/**
	 * Disconnect and cleanup
	 */
	disconnect() {
		console.log("Disconnecting WebRTC SDK...");
		this.cleanup();
	}
};

// Create global instance
pbx_integration.webrtc = new pbx_integration.WebRTC();
