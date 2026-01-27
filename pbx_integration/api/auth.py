# Copyright (c) 2024, Your Company and contributors
# For license information, please see license.txt

"""
PBX Authentication API

Whitelisted functions for PBX authentication and connection testing.
These can be called from the frontend via frappe.call().
"""

import frappe
import requests


@frappe.whitelist()
def test_connection_debug():
    """Debug version - tries different auth formats to find the right one."""
    if not frappe.has_permission("PBX Settings", "write"):
        frappe.throw("Not permitted", frappe.PermissionError)

    settings = frappe.get_single("PBX Settings")
    secret = settings.get_password("client_secret")
    results = []

    # Try format 1: username/password (common for Yeastar)
    url1 = f"{settings.api_host}/openapi/v1.0/get_token"
    payload1 = {"username": settings.client_id, "password": secret}
    try:
        r1 = requests.post(url1, json=payload1, timeout=30, verify=False)
        results.append({"format": "username/password", "url": url1, "status": r1.status_code, "response": r1.json()})
    except Exception as e:
        results.append({"format": "username/password", "error": str(e)})

    # Try format 2: client_id/client_secret
    payload2 = {"client_id": settings.client_id, "client_secret": secret}
    try:
        r2 = requests.post(url1, json=payload2, timeout=30, verify=False)
        results.append({"format": "client_id/client_secret", "url": url1, "status": r2.status_code, "response": r2.json()})
    except Exception as e:
        results.append({"format": "client_id/client_secret", "error": str(e)})

    # Try format 3: access_id/access_key (another common format)
    payload3 = {"access_id": settings.client_id, "access_key": secret}
    try:
        r3 = requests.post(url1, json=payload3, timeout=30, verify=False)
        results.append({"format": "access_id/access_key", "url": url1, "status": r3.status_code, "response": r3.json()})
    except Exception as e:
        results.append({"format": "access_id/access_key", "error": str(e)})

    return results


@frappe.whitelist()
def test_connection():
    """
    Test the PBX connection using configured credentials.

    Usage from frontend:
        frappe.call({
            method: 'pbx_integration.api.auth.test_connection',
            callback: function(r) {
                if (r.message.success) {
                    frappe.msgprint('Connected!');
                }
            }
        });

    Returns:
        dict: {success: bool, message: str}
    """
    # Check permission
    if not frappe.has_permission("PBX Settings", "write"):
        frappe.throw("Not permitted", frappe.PermissionError)

    settings = frappe.get_single("PBX Settings")
    return settings.test_connection()


@frappe.whitelist()
def get_access_token():
    """
    Get a valid access token for API calls.

    This is used by other parts of the integration that need to make
    authenticated API calls to the PBX.

    Returns:
        str: Valid access token or throws an error
    """
    if not frappe.has_permission("PBX Settings", "read"):
        frappe.throw("Not permitted", frappe.PermissionError)

    settings = frappe.get_single("PBX Settings")

    if not settings.enabled:
        frappe.throw("PBX Integration is not enabled")

    token = settings.get_access_token()

    if not token:
        frappe.throw("Failed to get access token. Check PBX Settings.")

    return token
