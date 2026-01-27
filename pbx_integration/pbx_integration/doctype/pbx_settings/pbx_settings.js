// Copyright (c) 2024, Your Company and contributors
// For license information, please see license.txt

frappe.ui.form.on('PBX Settings', {
    refresh: function(frm) {
        // Add "Test Connection" button
        frm.add_custom_button(__('Test Connection'), function() {
            // Show loading indicator
            frappe.show_alert({
                message: __('Testing connection...'),
                indicator: 'blue'
            });

            frappe.call({
                method: 'pbx_integration.api.auth.test_connection',
                callback: function(r) {
                    if (r.message) {
                        if (r.message.success) {
                            frappe.show_alert({
                                message: __('Connection successful!'),
                                indicator: 'green'
                            });
                            frappe.msgprint({
                                title: __('Success'),
                                message: r.message.message,
                                indicator: 'green'
                            });
                        } else {
                            frappe.msgprint({
                                title: __('Connection Failed'),
                                message: r.message.message,
                                indicator: 'red'
                            });
                        }
                    }
                },
                error: function(r) {
                    frappe.msgprint({
                        title: __('Error'),
                        message: __('Could not test connection. Please check the error log.'),
                        indicator: 'red'
                    });
                }
            });
        }, __('Actions'));
    },

    validate: function(frm) {
        // Ensure API host doesn't have trailing slash
        if (frm.doc.api_host) {
            frm.doc.api_host = frm.doc.api_host.replace(/\/+$/, '');
        }
    }
});
