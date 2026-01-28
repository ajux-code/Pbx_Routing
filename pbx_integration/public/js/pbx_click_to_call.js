/**
 * PBX Click-to-Call
 *
 * Makes phone numbers throughout Frappe/ERPNext clickable.
 * When clicked, initiates a call via the Yeastar PBX.
 *
 * The PBX will ring the user's extension first, then connect to the callee.
 */

frappe.provide("pbx_integration");

pbx_integration.ClickToCall = class ClickToCall {
    constructor() {
        this.enabled = false;
        this.extension = null;
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;

        // Check if click-to-call is available for this user
        try {
            const result = await frappe.call({
                method: "pbx_integration.api.call.check_click_to_call_enabled",
                async: true
            });

            if (result.message && result.message.enabled) {
                this.enabled = true;
                this.extension = result.message.extension;
                this.setup_click_handlers();
                this.add_phone_icon_styles();
                console.log("PBX Click-to-Call initialized for extension:", this.extension);
            }
        } catch (e) {
            console.log("PBX Click-to-Call not available:", e);
        }

        this.initialized = true;
    }

    setup_click_handlers() {
        // Add click handler to document for phone links
        $(document).on("click", ".pbx-phone-link", (e) => {
            e.preventDefault();
            const phone = $(e.currentTarget).data("phone");
            if (phone) {
                this.initiate_call(phone);
            }
        });

        // Watch for new content being added to the page
        this.observe_dom_changes();

        // Process existing content
        this.process_phone_numbers();
    }

    observe_dom_changes() {
        // Use MutationObserver to detect when new content is loaded
        const observer = new MutationObserver((mutations) => {
            // Debounce the processing
            clearTimeout(this.process_timeout);
            this.process_timeout = setTimeout(() => {
                this.process_phone_numbers();
            }, 500);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    process_phone_numbers() {
        if (!this.enabled) return;

        // Find phone fields in forms
        this.process_phone_fields();

        // Find phone numbers in list views
        this.process_list_views();

        // Find phone links (tel:)
        this.process_tel_links();
    }

    process_phone_fields() {
        // Target common phone field names in Frappe forms
        const phone_field_names = [
            "phone", "mobile", "mobile_no", "phone_no",
            "contact_phone", "contact_mobile", "cell_number",
            "primary_phone", "secondary_phone", "work_phone", "home_phone"
        ];

        phone_field_names.forEach(field_name => {
            $(`.frappe-control[data-fieldname="${field_name}"] .like-disabled-input`).each((i, el) => {
                this.make_phone_clickable(el);
            });

            $(`.frappe-control[data-fieldname="${field_name}"] .control-value`).each((i, el) => {
                this.make_phone_clickable(el);
            });
        });
    }

    process_list_views() {
        // Process phone numbers in list view cells
        $(".list-row-container .ellipsis").each((i, el) => {
            const text = $(el).text().trim();
            if (this.looks_like_phone(text) && !$(el).find(".pbx-phone-link").length) {
                this.make_phone_clickable(el);
            }
        });
    }

    process_tel_links() {
        // Convert existing tel: links to click-to-call
        $('a[href^="tel:"]').each((i, el) => {
            if ($(el).hasClass("pbx-converted")) return;

            const phone = $(el).attr("href").replace("tel:", "");
            $(el).addClass("pbx-converted pbx-phone-link")
                .attr("data-phone", phone)
                .attr("href", "#")
                .attr("title", "Click to call via PBX");
        });
    }

    make_phone_clickable(element) {
        const $el = $(element);

        // Skip if already processed
        if ($el.find(".pbx-phone-link").length || $el.hasClass("pbx-phone-link")) {
            return;
        }

        const text = $el.text().trim();
        if (!text || !this.looks_like_phone(text)) {
            return;
        }

        // Create clickable phone link
        const $link = $(`
            <a href="#" class="pbx-phone-link" data-phone="${text}" title="Click to call via PBX">
                <i class="fa fa-phone pbx-phone-icon"></i>
                ${text}
            </a>
        `);

        $el.empty().append($link);
    }

    looks_like_phone(text) {
        if (!text) return false;

        // Remove common formatting characters
        const cleaned = text.replace(/[\s\-\(\)\.]/g, "");

        // Check if it looks like a phone number
        // - Starts with + or digit
        // - Contains mostly digits
        // - Has reasonable length (7-15 digits)
        if (!/^[\+\d]/.test(cleaned)) return false;

        const digits_only = cleaned.replace(/\D/g, "");
        if (digits_only.length < 7 || digits_only.length > 15) return false;

        // At least 70% should be digits
        const digit_ratio = digits_only.length / cleaned.length;
        return digit_ratio >= 0.7;
    }

    async initiate_call(phone) {
        // Show confirmation dialog
        frappe.confirm(
            `<div class="text-center">
                <i class="fa fa-phone fa-3x text-primary mb-3"></i>
                <h4>Call ${phone}?</h4>
                <p class="text-muted">Your phone (ext. ${this.extension}) will ring first,<br>then connect to this number.</p>
            </div>`,
            async () => {
                // User confirmed - make the call
                await this.make_call(phone);
            },
            () => {
                // User cancelled
            }
        );
    }

    async make_call(phone) {
        frappe.show_alert({
            message: `Calling ${phone}...`,
            indicator: "blue"
        });

        try {
            const result = await frappe.call({
                method: "pbx_integration.api.call.make_call",
                args: { callee: phone },
                async: true
            });

            if (result.message && result.message.success) {
                frappe.show_alert({
                    message: `Call initiated! Answer your phone (ext. ${this.extension})`,
                    indicator: "green"
                }, 5);
            } else {
                const error_msg = result.message ? result.message.message : "Unknown error";
                frappe.msgprint({
                    title: "Call Failed",
                    message: error_msg,
                    indicator: "red"
                });
            }
        } catch (e) {
            frappe.msgprint({
                title: "Call Failed",
                message: "Failed to connect to PBX. Please try again.",
                indicator: "red"
            });
        }
    }

    add_phone_icon_styles() {
        if ($("#pbx-click-to-call-styles").length) return;

        const styles = `
            <style id="pbx-click-to-call-styles">
                .pbx-phone-link {
                    color: inherit;
                    text-decoration: none;
                    cursor: pointer;
                }
                .pbx-phone-link:hover {
                    color: var(--primary);
                }
                .pbx-phone-link:hover .pbx-phone-icon {
                    color: var(--primary);
                }
                .pbx-phone-icon {
                    margin-right: 4px;
                    color: var(--text-muted);
                    font-size: 0.9em;
                }
                .pbx-phone-link:hover .pbx-phone-icon {
                    animation: pbx-ring 0.5s ease-in-out;
                }
                @keyframes pbx-ring {
                    0%, 100% { transform: rotate(0deg); }
                    25% { transform: rotate(-15deg); }
                    75% { transform: rotate(15deg); }
                }
            </style>
        `;

        $("head").append(styles);
    }
};

// Initialize when Frappe is ready
$(document).ready(function() {
    // Wait a bit for Frappe to fully initialize
    setTimeout(() => {
        pbx_integration.click_to_call = new pbx_integration.ClickToCall();
        pbx_integration.click_to_call.init();
    }, 1000);
});

// Re-process when route changes (navigating between pages)
$(document).on("page-change", function() {
    if (pbx_integration.click_to_call && pbx_integration.click_to_call.enabled) {
        setTimeout(() => {
            pbx_integration.click_to_call.process_phone_numbers();
        }, 500);
    }
});
