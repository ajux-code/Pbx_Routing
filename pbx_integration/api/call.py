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


@frappe.whitelist()
def answer_call(call_id, channel_id=None):
    """
    Answer an incoming call.

    Args:
        call_id: The call ID from the webhook
        channel_id: Optional - specific channel to answer

    Returns:
        dict: {"success": bool, "message": str}
    """
    if not call_id:
        return {"success": False, "message": "Call ID is required"}

    # Get PBX settings and access token
    settings = frappe.get_single("PBX Settings")
    if not settings.enabled:
        return {"success": False, "message": "PBX integration is disabled"}

    access_token = settings.get_access_token()
    if not access_token:
        return {"success": False, "message": "Failed to authenticate with PBX"}

    # Call Yeastar API to answer the call
    try:
        url = f"{settings.api_host}/openapi/v1.0/call/answer"

        payload = {"call_id": call_id}
        if channel_id:
            payload["channel_id"] = channel_id

        response = requests.post(
            url,
            params={"access_token": access_token},
            json=payload,
            headers={"Content-Type": "application/json", "User-Agent": "OpenAPI"},
            timeout=10,
            verify=False
        )

        data = response.json()

        if data.get("errcode") == 0:
            # Update Call Log status if it exists
            _update_call_log_status(call_id, "In Progress")

            frappe.logger().info(f"Call {call_id} answered successfully")
            return {"success": True, "message": "Call answered"}
        else:
            error_msg = data.get("errmsg", "Unknown error")
            frappe.logger().warning(f"Failed to answer call {call_id}: {error_msg}")
            return {"success": False, "message": f"Failed to answer call: {error_msg}"}

    except Exception as e:
        frappe.log_error(f"PBX Answer Error: {str(e)}", "PBX Call Error")
        return {"success": False, "message": "Failed to answer call"}


@frappe.whitelist()
def hangup_call(call_id, channel_id=None):
    """
    Hang up an active call.

    Args:
        call_id: The call ID from the webhook
        channel_id: Optional - specific channel to hang up

    Returns:
        dict: {"success": bool, "message": str}
    """
    if not call_id:
        return {"success": False, "message": "Call ID is required"}

    # Get PBX settings and access token
    settings = frappe.get_single("PBX Settings")
    if not settings.enabled:
        return {"success": False, "message": "PBX integration is disabled"}

    access_token = settings.get_access_token()
    if not access_token:
        return {"success": False, "message": "Failed to authenticate with PBX"}

    # Call Yeastar API to hang up the call
    try:
        url = f"{settings.api_host}/openapi/v1.0/call/hangup"

        payload = {"call_id": call_id}
        if channel_id:
            payload["channel_id"] = channel_id

        response = requests.post(
            url,
            params={"access_token": access_token},
            json=payload,
            headers={"Content-Type": "application/json", "User-Agent": "OpenAPI"},
            timeout=10,
            verify=False
        )

        data = response.json()

        if data.get("errcode") == 0:
            # Update Call Log status if it exists
            _update_call_log_status(call_id, "Completed")

            frappe.logger().info(f"Call {call_id} ended successfully")
            return {"success": True, "message": "Call ended"}
        else:
            error_msg = data.get("errmsg", "Unknown error")
            frappe.logger().warning(f"Failed to hang up call {call_id}: {error_msg}")
            return {"success": False, "message": f"Failed to hang up: {error_msg}"}

    except Exception as e:
        frappe.log_error(f"PBX Hangup Error: {str(e)}", "PBX Call Error")
        return {"success": False, "message": "Failed to hang up call"}


def _update_call_log_status(call_id, status):
    """
    Update the status of a call log (internal helper).

    Args:
        call_id: The call ID
        status: New status (Ringing, In Progress, Completed, etc.)
    """
    try:
        # Try ERPNext Call Log first
        if frappe.db.exists("DocType", "Call Log"):
            if frappe.db.exists("Call Log", {"id": call_id}):
                frappe.db.set_value("Call Log", {"id": call_id}, "status", status)
                frappe.db.commit()
                return

        # Fallback to PBX Call Log
        if frappe.db.exists("PBX Call Log", {"call_id": call_id}):
            frappe.db.set_value("PBX Call Log", {"call_id": call_id}, "status", status)
            frappe.db.commit()

    except Exception as e:
        frappe.log_error(f"Failed to update call log status: {str(e)}", "PBX Call Log Error")


@frappe.whitelist()
def is_pbx_enabled():
    """
    Check if PBX integration is enabled and configured.

    Used by Helpdesk telephony system to detect PBX availability.

    Returns:
        dict: {
            "pbx_enabled": bool,
            "has_extension": bool,
            "extension": str (if applicable)
        }
    """
    try:
        # Check if PBX Settings is enabled
        settings = frappe.get_single("PBX Settings")
        if not settings.enabled:
            return {
                "pbx_enabled": False,
                "has_extension": False
            }

        # Check if current user has an extension mapped
        from pbx_integration.pbx_integration.doctype.pbx_user_extension.pbx_user_extension import PBXUserExtension
        mapping = PBXUserExtension.get_extension_for_user()

        if mapping:
            return {
                "pbx_enabled": True,
                "has_extension": True,
                "extension": mapping.extension
            }
        else:
            return {
                "pbx_enabled": True,
                "has_extension": False
            }

    except Exception as e:
        frappe.log_error(f"Failed to check PBX status: {str(e)}", "PBX Status Check Error")
        return {
            "pbx_enabled": False,
            "has_extension": False
        }


@frappe.whitelist()
def get_webrtc_signature():
    """
    Generate WebRTC login signature for the current user's extension.

    This signature is used to authenticate the WebRTC SDK client.
    The signature is obtained from Yeastar's OpenAPI /sign/create endpoint.

    Returns:
        dict: {
            "success": bool,
            "secret": str (login signature),
            "username": str (extension number),
            "pbx_url": str (PBX WebSocket URL),
            "message": str (error message if failed)
        }
    """
    try:
        # Get PBX settings
        settings = frappe.get_single("PBX Settings")
        if not settings.enabled:
            return {"success": False, "message": "PBX integration is disabled"}

        # Get current user's extension
        from pbx_integration.pbx_integration.doctype.pbx_user_extension.pbx_user_extension import PBXUserExtension
        mapping = PBXUserExtension.get_extension_for_user()

        if not mapping:
            return {
                "success": False,
                "message": "No extension mapped to your user account"
            }

        extension = mapping.extension

        # Get access token
        access_token = settings.get_access_token()
        if not access_token:
            return {"success": False, "message": "Failed to authenticate with PBX"}

        # Call Yeastar API to create login signature
        url = f"{settings.api_host}/openapi/v1.0/sign/create"

        # Try different sign_type values if "sdk" doesn't work
        # Possible values: "sdk", "webrtc", "linkus", "linkus_sdk"
        payload = {
            "username": extension,
            "sign_type": "linkus",  # Changed from "sdk" - try this first
            "expire_time": 0  # 0 means no expiration
        }

        frappe.logger().info(f"WebRTC signature request - Extension: {extension}, URL: {url}, Payload: {payload}")

        response = requests.post(
            url,
            params={"access_token": access_token},
            json=payload,
            headers={"Content-Type": "application/json", "User-Agent": "OpenAPI"},
            timeout=10,
            verify=False
        )

        data = response.json()

        # Log full response for debugging
        frappe.logger().info(f"WebRTC signature response - Status: {response.status_code}, Response: {data}")

        if data.get("errcode") == 0:
            # Success - return signature
            signature = data.get("data", {}).get("signature")

            if not signature:
                return {
                    "success": False,
                    "message": "No signature returned from PBX"
                }

            # Construct WebSocket URL (typically port 8088 for WebRTC)
            pbx_url = settings.api_host

            frappe.logger().info(f"WebRTC signature generated for extension {extension}")

            return {
                "success": True,
                "secret": signature,
                "username": extension,
                "pbx_url": pbx_url
            }
        else:
            error_msg = data.get("errmsg", "Unknown error")
            frappe.logger().warning(f"Failed to generate WebRTC signature: {error_msg}")
            return {
                "success": False,
                "message": f"Failed to generate signature: {error_msg}"
            }

    except Exception as e:
        frappe.log_error(f"WebRTC Signature Error: {str(e)}", "PBX WebRTC Error")
        return {
            "success": False,
            "message": "Failed to generate WebRTC signature"
        }
