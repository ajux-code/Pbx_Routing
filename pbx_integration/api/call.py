# Copyright (c) 2024, Your Company and contributors
# For license information, please see license.txt

"""
PBX Click-to-Call API

Allows users to initiate calls from within Frappe/ERPNext.
The PBX will first ring the user's extension, then connect to the callee.

Yeastar API Reference:
https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/make-a-call.html
"""

import frappe
import requests


@frappe.whitelist()
def make_call(callee, caller=None):
    """
    Initiate a call from the user's extension to a phone number.

    The Yeastar PBX will:
    1. Ring the caller's extension (user's phone)
    2. When answered, dial the callee number
    3. Bridge the two calls together

    Args:
        callee (str): The phone number to call
        caller (str, optional): The extension to call from. If not provided,
                                uses the current user's mapped extension.

    Returns:
        dict: Result with call_id if successful, or error message
    """
    # Validate callee
    if not callee:
        return {"success": False, "message": "Phone number is required"}

    # Clean the phone number (remove spaces, dashes)
    callee = "".join(c for c in callee if c.isdigit() or c == "+")

    if not callee:
        return {"success": False, "message": "Invalid phone number"}

    # Get caller extension
    if not caller:
        # Look up the current user's extension
        extension_mapping = frappe.db.get_value(
            "PBX User Extension",
            {"user": frappe.session.user, "enabled": 1},
            ["extension"],
            as_dict=True
        )

        if not extension_mapping:
            return {
                "success": False,
                "message": "No extension mapped to your user account. Please contact your administrator."
            }

        caller = extension_mapping.extension

    # Get PBX settings
    settings = frappe.get_single("PBX Settings")

    if not settings.enabled:
        return {"success": False, "message": "PBX Integration is not enabled"}

    # Get access token
    access_token = settings.get_access_token()

    if not access_token:
        return {"success": False, "message": "Failed to authenticate with PBX"}

    # Make the API call to Yeastar
    try:
        url = f"{settings.api_host}/openapi/v1.0/call/dial"

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "OpenAPI"
        }

        params = {
            "access_token": access_token
        }

        payload = {
            "caller": caller,
            "callee": callee
        }

        frappe.logger().info(f"Click-to-call: {caller} -> {callee}")

        response = requests.post(
            url,
            params=params,
            json=payload,
            headers=headers,
            timeout=30,
            verify=False
        )

        response.raise_for_status()
        data = response.json()

        if data.get("errcode") == 0:
            # Success - call initiated
            call_id = data.get("call_id")

            frappe.logger().info(f"Call initiated successfully: {call_id}")

            return {
                "success": True,
                "message": f"Calling {callee}...",
                "call_id": call_id
            }
        else:
            # API returned an error
            error_msg = data.get("errmsg", "Unknown error")
            frappe.logger().warning(f"Click-to-call failed: {error_msg}")

            return {
                "success": False,
                "message": f"Failed to initiate call: {error_msg}"
            }

    except requests.exceptions.RequestException as e:
        frappe.log_error(f"Click-to-call API error: {str(e)}", "PBX Call Error")
        return {"success": False, "message": "Failed to connect to PBX"}


@frappe.whitelist()
def get_user_extension():
    """
    Get the current user's PBX extension.

    Returns:
        dict: Extension info or None if not mapped
    """
    mapping = frappe.db.get_value(
        "PBX User Extension",
        {"user": frappe.session.user, "enabled": 1},
        ["extension", "extension_name"],
        as_dict=True
    )

    if mapping:
        return {
            "has_extension": True,
            "extension": mapping.extension,
            "extension_name": mapping.extension_name
        }
    else:
        return {
            "has_extension": False
        }


@frappe.whitelist()
def check_click_to_call_enabled():
    """
    Check if click-to-call is available for the current user.

    Returns:
        dict: Status of click-to-call availability
    """
    # Check if PBX is enabled
    settings = frappe.get_single("PBX Settings")
    if not settings.enabled:
        return {"enabled": False, "reason": "PBX Integration is disabled"}

    # Check if user has an extension mapped
    mapping = frappe.db.get_value(
        "PBX User Extension",
        {"user": frappe.session.user, "enabled": 1},
        "extension"
    )

    if not mapping:
        return {"enabled": False, "reason": "No extension assigned to your account"}

    return {"enabled": True, "extension": mapping}
