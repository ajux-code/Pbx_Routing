/**
 * PBX Telephony Integration with Frappe/ERPNext
 *
 * Integrates Yeastar P-Series PBX with Frappe's telephony system:
 * - Click-to-call from phone fields
 * - Enhanced CallPopup with answer/hangup controls
 * - Real-time call notifications
 */

frappe.provide("pbx_integration");

// ========== DEPLOYMENT TEST v3.0 - 2024-02-06 ==========
console.log("🚀 PBX Telephony v3.0 loaded - If you see this, JS deployment works!");
// ========================================================

pbx_integration.Telephony = class Telephony {
    constructor() {
        this.enabled = false;
        this.extension = null;
        this.active_calls = {};
        this.init();
    }

    async init() {
        // Check if click-to-call is enabled for this user
        const result = await frappe.call({
            method: "pbx_integration.api.call.check_click_to_call_enabled",
        });

        if (result.message && result.message.enabled) {
            this.enabled = true;
            this.extension = result.message.extension;

            // Register phone call handler
            this.register_click_to_call_handler();

            // Setup realtime listeners for CallPopup
            this.setup_realtime_listeners();

            // Proactively initialize WebRTC if user prefers it (or hasn't chosen yet)
            // This ensures incoming calls can be received via WebRTC
            this.initWebRTCIfNeeded();

            frappe.show_alert({
                message: `PBX Ready - Extension ${this.extension}`,
                indicator: "green"
            }, 3);
        }
    }

    async initWebRTCIfNeeded() {
        /**
         * Initialize WebRTC SDK proactively if user prefers WebRTC calling.
         * This ensures incoming calls can be received even before making an outgoing call.
         */
        const preference = localStorage.getItem("pbx_call_method");

        // Initialize if user prefers WebRTC, or hasn't chosen yet (default to WebRTC)
        if (preference === "webrtc" || preference === null) {
            console.log("Proactively initializing WebRTC for incoming calls...");

            // Initialize in background - don't block UI
            if (pbx_integration.webrtc) {
                const success = await pbx_integration.webrtc.init();
                if (success) {
                    console.log("WebRTC initialized - ready for incoming calls");
                } else {
                    console.log("WebRTC init failed - will use fallback for incoming calls");
                }
            }
        } else {
            console.log("WebRTC disabled by user preference - using desk phone mode");
        }
    }

    register_click_to_call_handler() {
        /**
         * Register handler for phone field icons throughout Frappe/ERPNext.
         * When user clicks the phone icon next to a phone number, this handler is called.
         */
        frappe.phone_call.handler = (phone_number, frm) => {
            if (!phone_number) {
                frappe.show_alert({
                    message: "No phone number provided",
                    indicator: "red"
                }, 3);
                return;
            }

            this.initiate_call(phone_number, frm);
        };

        console.log("PBX click-to-call handler registered");

        // Intercept tel: link clicks
        this.intercept_tel_links();
    }

    intercept_tel_links() {
        /**
         * Intercept clicks on tel: links and use custom phone handler instead
         * of browser's default tel: protocol handler.
         */
        $(document).on("click", "a[href^='tel:']", (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Extract phone number from tel: link
            const tel_url = $(e.currentTarget).attr("href");
            const phone_number = tel_url.replace("tel:", "");

            if (phone_number) {
                // Call our handler
                this.initiate_call(phone_number);
            }
        });

        console.log("Tel: link interceptor registered");
    }

    setup_realtime_listeners() {
        /**
         * Listen for incoming call events and enhance the CallPopup
         * with answer/hangup buttons.
         */

        // Listen for ERPNext's standard call popup event
        frappe.realtime.on("show_call_popup", (call_log) => {
            this.handle_incoming_call_popup(call_log);
        });

        // Listen for custom PBX popup event (fallback)
        // Only use this when WebRTC is NOT handling the call
        frappe.realtime.on("pbx_incoming_call", (data) => {
            // Skip if WebRTC is active - it handles its own UI
            if (pbx_integration.webrtc && pbx_integration.webrtc.initialized) {
                console.log("Skipping fallback popup - WebRTC is active");
                return;
            }
            this.handle_custom_incoming_call(data);
        });

        console.log("PBX realtime listeners registered");
    }

    async initiate_call(phone_number, frm) {
        /**
         * Initiate an outgoing call via PBX or WebRTC.
         *
         * Args:
         *     phone_number: The number to call
         *     frm: Optional form object for context
         */

        // Check if WebRTC is preferred
        const useWebRTC = await this.shouldUseWebRTC();

        if (useWebRTC) {
            // Use browser-based WebRTC calling
            const success = await pbx_integration.webrtc.call(phone_number);
            if (success) {
                // Still log the call in backend for CRM integration
                this.log_webrtc_call(phone_number, frm);
                return;
            }

            // Fall through to PBX API if WebRTC fails
            frappe.show_alert({
                message: "WebRTC failed, using desk phone...",
                indicator: "orange"
            }, 3);
        }

        // Get link context if on a form
        let link_doctype = null;
        let link_docname = null;

        if (frm) {
            link_doctype = frm.doctype;
            link_docname = frm.docname;
        }

        // Show loading indicator
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

                // Track the call
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
        /**
         * Check if user prefers WebRTC calling over desk phone.
         *
         * Returns:
         *     boolean: true if WebRTC should be used, false for desk phone
         */

        // Check user preference from localStorage
        const preference = localStorage.getItem("pbx_call_method");

        if (preference === "webrtc") {
            return true;
        } else if (preference === "pbx") {
            return false;
        }

        // First time: ask user preference
        return new Promise((resolve) => {
            // Add a small delay to avoid conflicts with click event handling
            setTimeout(() => {
                const dialog = new frappe.ui.Dialog({
                    title: "Choose Calling Method",
                    fields: [
                        {
                            fieldtype: "HTML",
                            options: `
                                <div style="margin-bottom: 15px;">
                                    <p><strong>How would you like to make calls?</strong></p>
                                    <ul style="margin-top: 10px; padding-left: 20px;">
                                        <li><strong>Browser (WebRTC):</strong> Use your computer's microphone and speakers</li>
                                        <li><strong>Desk Phone:</strong> Use your physical desk phone</li>
                                    </ul>
                                    <p style="margin-top: 10px; font-size: 12px; color: #6c757d;">
                                        You can change this preference later from Settings.
                                    </p>
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
            }, 100); // 100ms delay to let click event finish processing
        });
    }

    setCallingMethod(method) {
        /**
         * Change the calling method preference.
         *
         * Args:
         *     method: "webrtc" or "pbx"
         */
        if (method === "webrtc" || method === "pbx") {
            localStorage.setItem("pbx_call_method", method);
            frappe.show_alert({
                message: `Calling method set to ${method === "webrtc" ? "Browser (WebRTC)" : "Desk Phone"}`,
                indicator: "green"
            }, 3);
        }
    }

    async log_webrtc_call(phone_number, frm) {
        /**
         * Log WebRTC call in backend for CRM integration.
         *
         * Args:
         *     phone_number: The number called
         *     frm: Optional form object for context
         */
        let link_doctype = null;
        let link_docname = null;

        if (frm) {
            link_doctype = frm.doctype;
            link_docname = frm.docname;
        }

        try {
            await frappe.call({
                method: "pbx_integration.api.call.make_call",
                args: {
                    callee: phone_number,
                    link_doctype: link_doctype,
                    link_docname: link_docname
                }
            });
        } catch (error) {
            console.warn("Failed to log WebRTC call:", error);
        }
    }

    handle_incoming_call_popup(call_log) {
        /**
         * Handle incoming call using ERPNext's CallPopup.
         * Enhance it with answer/hangup buttons.
         *
         * Args:
         *     call_log: Call log data from realtime event
         */

        // Check if ERPNext CallPopup is available
        if (typeof CallPopup === "undefined") {
            // Fallback to custom popup
            this.handle_custom_incoming_call({
                call_id: call_log.id,
                phone: call_log.from,
                extension: call_log.to,
                lookup: {}
            });
            return;
        }

        // Create ERPNext's CallPopup
        const call_popup = new CallPopup(call_log);

        // Enhance the popup with answer/hangup buttons
        this.add_call_control_buttons(call_popup, call_log);

        // Track the call
        this.active_calls[call_log.id] = {
            popup: call_popup,
            call_log: call_log,
            status: "Ringing"
        };
    }

    add_call_control_buttons(call_popup, call_log) {
        /**
         * Add answer and hangup buttons to the CallPopup dialog.
         *
         * Args:
         *     call_popup: CallPopup instance
         *     call_log: Call log data
         */

        // Wait for dialog to be rendered
        setTimeout(() => {
            if (!call_popup.dialog || !call_popup.dialog.$wrapper) {
                return;
            }

            const $footer = call_popup.dialog.$wrapper.find(".modal-footer");

            if ($footer.length) {
                // Add Answer button
                const $answer_btn = $(`
                    <button class="btn btn-success btn-sm pbx-answer-btn">
                        <svg class="icon icon-sm">
                            <use href="#icon-call"></use>
                        </svg>
                        Answer
                    </button>
                `);

                $answer_btn.on("click", async () => {
                    await this.answer_call(call_log.id, call_popup);
                });

                // Add Hangup button
                const $hangup_btn = $(`
                    <button class="btn btn-danger btn-sm pbx-hangup-btn" style="margin-left: 8px;">
                        <svg class="icon icon-sm">
                            <use href="#icon-call-end"></use>
                        </svg>
                        Hangup
                    </button>
                `);

                $hangup_btn.on("click", async () => {
                    await this.hangup_call(call_log.id, call_popup);
                });

                // Prepend buttons to footer
                $footer.prepend($hangup_btn);
                $footer.prepend($answer_btn);
            }
        }, 100);
    }

    async answer_call(call_id, call_popup) {
        /**
         * Answer an incoming call via PBX API.
         *
         * Args:
         *     call_id: The call ID
         *     call_popup: CallPopup instance to update
         */

        try {
            const result = await frappe.call({
                method: "pbx_integration.api.call.answer_call",
                args: { call_id: call_id }
            });

            if (result.message && result.message.success) {
                frappe.show_alert({
                    message: "Call answered",
                    indicator: "green"
                }, 3);

                // Update call status
                if (this.active_calls[call_id]) {
                    this.active_calls[call_id].status = "In Progress";
                }

                // Update popup status
                if (call_popup && call_popup.set_call_status) {
                    call_popup.set_call_status("In Progress");
                }

                // Disable answer button, keep hangup
                if (call_popup.dialog) {
                    call_popup.dialog.$wrapper.find(".pbx-answer-btn").prop("disabled", true);
                }
            } else {
                frappe.show_alert({
                    message: result.message.message || "Failed to answer call",
                    indicator: "red"
                }, 5);
            }
        } catch (error) {
            frappe.show_alert({
                message: "Error answering call",
                indicator: "red"
            }, 5);
            console.error("Answer call error:", error);
        }
    }

    async hangup_call(call_id, call_popup) {
        /**
         * Hang up an active call via PBX API.
         *
         * Args:
         *     call_id: The call ID
         *     call_popup: CallPopup instance to close
         */

        try {
            const result = await frappe.call({
                method: "pbx_integration.api.call.hangup_call",
                args: { call_id: call_id }
            });

            if (result.message && result.message.success) {
                frappe.show_alert({
                    message: "Call ended",
                    indicator: "orange"
                }, 3);

                // Remove from active calls
                delete this.active_calls[call_id];

                // Close the popup
                if (call_popup && call_popup.dialog) {
                    call_popup.dialog.hide();
                }
            } else {
                frappe.show_alert({
                    message: result.message.message || "Failed to hang up",
                    indicator: "red"
                }, 5);
            }
        } catch (error) {
            frappe.show_alert({
                message: "Error hanging up call",
                indicator: "red"
            }, 5);
            console.error("Hangup call error:", error);
        }
    }

    handle_custom_incoming_call(data) {
        /**
         * Fallback handler for custom popup when ERPNext CallPopup is not available.
         *
         * Args:
         *     data: Call notification data
         */

        const lookup = data.lookup || {};
        const phone = data.phone || "Unknown";
        let title = "Incoming Call";
        let message = phone;

        if (lookup.found) {
            if (lookup.contact_name) {
                title = lookup.contact_name;
            } else if (lookup.customer) {
                title = lookup.customer;
            } else if (lookup.lead) {
                title = lookup.lead;
            }
        }

        // Show a simpler notification
        frappe.show_alert({
            message: `<strong>${title}</strong><br>${message}`,
            indicator: "blue"
        }, 15);

        // Play notification sound (silently fail if blocked by autoplay policy)
        if (frappe.utils.play_sound) {
            // Wrap in Promise.resolve to ensure we catch any rejection,
            // regardless of whether play_sound returns a Promise or throws
            Promise.resolve().then(() => frappe.utils.play_sound("alert")).catch(() => {
                // Silently ignore - browser autoplay restrictions are normal
            });
        }
    }
};

// Initialize telephony integration when document is ready
$(document).ready(function() {
    // Only initialize if user is logged in
    if (frappe.session.user !== "Guest") {
        pbx_integration.telephony = new pbx_integration.Telephony();
    }
});
