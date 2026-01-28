/**
 * PBX Screen Pop - Real-time incoming call notifications
 *
 * Listens for Socket.io events from the PBX webhook handler
 * and displays caller information in a popup notification.
 */

frappe.provide("pbx_integration");

pbx_integration.ScreenPop = class ScreenPop {
    constructor() {
        this.active_notifications = {};
        this.init();
    }

    init() {
        // Subscribe to PBX incoming call events via Socket.io
        frappe.realtime.on("pbx_incoming_call", (data) => {
            this.handle_incoming_call(data);
        });

        // Subscribe to call ended events to dismiss notifications
        frappe.realtime.on("pbx_call_ended", (data) => {
            this.dismiss_notification(data.call_id);
        });
    }

    handle_incoming_call(data) {
        // Avoid duplicate notifications for the same call
        if (this.active_notifications[data.call_id]) {
            return;
        }

        const lookup = data.lookup || {};
        const phone = data.phone || "Unknown";

        // Build the notification content
        let title = "Incoming Call";
        let message = this.format_phone(phone);
        let primary_action = null;
        let secondary_action = null;

        if (lookup.found) {
            if (lookup.contact) {
                title = lookup.contact_name || lookup.contact;
                message = this.format_phone(phone);

                if (lookup.customer) {
                    message += `<br><small class="text-muted">Customer: ${lookup.customer}</small>`;
                } else if (lookup.lead) {
                    message += `<br><small class="text-muted">Lead: ${lookup.lead}</small>`;
                }

                primary_action = {
                    label: "Open Contact",
                    action: () => {
                        frappe.set_route("Form", "Contact", lookup.contact);
                        this.dismiss_notification(data.call_id);
                    }
                };

                if (lookup.customer) {
                    secondary_action = {
                        label: "Open Customer",
                        action: () => {
                            frappe.set_route("Form", "Customer", lookup.customer);
                            this.dismiss_notification(data.call_id);
                        }
                    };
                }
            } else if (lookup.customer) {
                title = lookup.customer;
                message = this.format_phone(phone);

                primary_action = {
                    label: "Open Customer",
                    action: () => {
                        frappe.set_route("Form", "Customer", lookup.customer);
                        this.dismiss_notification(data.call_id);
                    }
                };
            } else if (lookup.lead) {
                title = lookup.lead;
                message = this.format_phone(phone);

                primary_action = {
                    label: "Open Lead",
                    action: () => {
                        frappe.set_route("Form", "Lead", lookup.lead);
                        this.dismiss_notification(data.call_id);
                    }
                };
            }
        } else {
            // Unknown caller - offer to create a new Lead
            message += `<br><small class="text-muted">Unknown caller</small>`;

            primary_action = {
                label: "Create Lead",
                action: () => {
                    frappe.new_doc("Lead", {
                        mobile_no: phone
                    });
                    this.dismiss_notification(data.call_id);
                }
            };

            secondary_action = {
                label: "Create Contact",
                action: () => {
                    frappe.new_doc("Contact", {
                        phone_nos: [{ phone: phone }]
                    });
                    this.dismiss_notification(data.call_id);
                }
            };
        }

        // Show the notification
        this.show_notification(data.call_id, {
            title: title,
            message: message,
            indicator: "blue",
            primary_action: primary_action,
            secondary_action: secondary_action,
            phone: phone,
            extension: data.extension
        });
    }

    show_notification(call_id, options) {
        // Create a custom notification dialog
        const dialog = new frappe.ui.Dialog({
            title: `<span class="indicator-pill blue">
                <svg class="icon icon-sm" style="margin-right: 4px;">
                    <use href="#icon-call"></use>
                </svg>
                ${options.title}
            </span>`,
            fields: [
                {
                    fieldtype: "HTML",
                    options: `
                        <div class="pbx-screen-pop">
                            <div class="pbx-phone-number" style="font-size: 1.2em; font-weight: 500; margin-bottom: 8px;">
                                ${options.message}
                            </div>
                            ${options.extension ? `<div class="pbx-extension text-muted"><small>Extension: ${options.extension}</small></div>` : ""}
                        </div>
                    `
                }
            ],
            primary_action_label: options.primary_action?.label || "Dismiss",
            primary_action: options.primary_action?.action || (() => {
                this.dismiss_notification(call_id);
            }),
            secondary_action_label: options.secondary_action?.label,
            secondary_action: options.secondary_action?.action
        });

        // Add dismiss button
        dialog.$wrapper.find(".modal-header").append(`
            <button type="button" class="btn btn-sm btn-secondary pbx-dismiss-btn"
                    style="position: absolute; right: 40px; top: 12px;">
                Dismiss
            </button>
        `);

        dialog.$wrapper.find(".pbx-dismiss-btn").on("click", () => {
            this.dismiss_notification(call_id);
        });

        // Style the dialog
        dialog.$wrapper.find(".modal-dialog").css({
            "max-width": "350px"
        });

        dialog.$wrapper.find(".modal-content").css({
            "border-left": "4px solid var(--blue-500)"
        });

        // Auto-dismiss after 30 seconds
        const timeout = setTimeout(() => {
            this.dismiss_notification(call_id);
        }, 30000);

        // Store reference to the dialog
        this.active_notifications[call_id] = {
            dialog: dialog,
            timeout: timeout
        };

        // Play notification sound if available
        this.play_notification_sound();

        dialog.show();
    }

    dismiss_notification(call_id) {
        const notification = this.active_notifications[call_id];
        if (notification) {
            if (notification.timeout) {
                clearTimeout(notification.timeout);
            }
            if (notification.dialog) {
                notification.dialog.hide();
            }
            delete this.active_notifications[call_id];
        }
    }

    format_phone(phone) {
        // Basic phone formatting - can be enhanced for specific country formats
        if (!phone) return "Unknown";

        // If it looks like a full international number, format it nicely
        const cleaned = phone.replace(/\D/g, "");

        if (cleaned.length === 10) {
            // US format: (XXX) XXX-XXXX
            return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
        } else if (cleaned.length === 11 && cleaned[0] === "1") {
            // US with country code: +1 (XXX) XXX-XXXX
            return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
        }

        // Return as-is for other formats
        return phone;
    }

    play_notification_sound() {
        // Play a subtle notification sound
        // Only play if user has interacted with the page (browser autoplay policy)
        try {
            const audio = new Audio("/assets/frappe/sounds/chat-notification.mp3");
            audio.volume = 0.5;
            audio.play().catch(() => {
                // Autoplay blocked - silently ignore
            });
        } catch (e) {
            // Audio not supported - silently ignore
        }
    }
};

// Initialize screen pop when document is ready
$(document).ready(function() {
    // Only initialize if user is logged in (not guest)
    if (frappe.session.user !== "Guest") {
        pbx_integration.screen_pop = new pbx_integration.ScreenPop();
    }
});
