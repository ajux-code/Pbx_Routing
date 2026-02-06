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

        frappe.log_error(f"Attempting to answer call with payload: {payload}", "PBX Answer Debug")

        response = requests.post(
            url,
            params={"access_token": access_token},
            json=payload,
            headers={"Content-Type": "application/json", "User-Agent": "OpenAPI"},
            timeout=10,
            verify=False
        )

        data = response.json()
        frappe.log_error(f"Answer API response: {data}", "PBX Answer Debug")

        if data.get("errcode") == 0:
            # Update Call Log status if it exists
            _update_call_log_status(call_id, "In Progress")

            frappe.logger().info(f"Call {call_id} answered successfully")
            return {"success": True, "message": "Call answered"}
        else:
            error_msg = data.get("errmsg", "Unknown error")

            # If "INTERFACE NOT EXISTED" error, try without channel_id
            if "INTERFACE NOT EXISTED" in error_msg and channel_id:
                frappe.log_error(f"Retrying answer without channel_id", "PBX Answer Retry")
                payload_retry = {"call_id": call_id}

                response_retry = requests.post(
                    url,
                    params={"access_token": access_token},
                    json=payload_retry,
                    headers={"Content-Type": "application/json", "User-Agent": "OpenAPI"},
                    timeout=10,
                    verify=False
                )

                data_retry = response_retry.json()
                frappe.log_error(f"Retry answer API response: {data_retry}", "PBX Answer Retry")

                if data_retry.get("errcode") == 0:
                    _update_call_log_status(call_id, "In Progress")
                    return {"success": True, "message": "Call answered"}
                else:
                    error_msg = data_retry.get("errmsg", "Unknown error")

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
            "extension": str (if applicable),
            "webrtc_trunk_url": str (WebRTC call link if available)
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

        # Get WebRTC trunk URL if configured
        webrtc_trunk_url = settings.get("webrtc_trunk_url") if hasattr(settings, "webrtc_trunk_url") else None

        if mapping:
            return {
                "pbx_enabled": True,
                "has_extension": True,
                "extension": mapping.extension,
                "webrtc_trunk_url": webrtc_trunk_url
            }
        else:
            return {
                "pbx_enabled": True,
                "has_extension": False,
                "webrtc_trunk_url": webrtc_trunk_url
            }

    except Exception as e:
        frappe.log_error(f"Failed to check PBX status: {str(e)}", "PBX Status Check Error")
        return {
            "pbx_enabled": False,
            "has_extension": False
        }


@frappe.whitelist()
def get_webrtc_signature(debug=False):
    """
    Generate WebRTC login signature for the current user's extension.

    This signature is used to authenticate the WebRTC SDK client.
    The signature is obtained from Yeastar's OpenAPI /sign/create endpoint.

    IMPORTANT: Linkus SDK requires authentication using its own AccessID/AccessKey,
    not the general OpenAPI client_id/client_secret. The flow is:
    1. Get token using Linkus SDK AccessID (as username) and AccessKey (as password)
    2. Use that token to call /sign/create with sign_type "sdk"

    Args:
        debug (bool): If True, return detailed debug information

    Returns:
        dict: {
            "success": bool,
            "secret": str (login signature),
            "username": str (extension number),
            "pbx_url": str (PBX WebSocket URL),
            "message": str (error message if failed),
            "debug": dict (debug info if debug=True)
        }
    """
    debug_info = {
        "code_version": "3.0-deployment-test",  # Version marker to verify deployment
        "steps": []
    }

    def log_step(step_name, data):
        """Helper to log debug steps - also saves to Error Log for visibility"""
        debug_info["steps"].append({"step": step_name, "data": data})
        frappe.logger().info(f"WebRTC Debug [{step_name}]: {data}")
        # Also log to Error Log doctype for easy viewing in UI
        if debug:
            frappe.log_error(
                message=f"Step: {step_name}\nData: {data}",
                title=f"WebRTC Debug - {step_name}"
            )

    try:
        log_step("start", {"user": frappe.session.user, "timestamp": str(frappe.utils.now())})

        # Get PBX settings
        settings = frappe.get_single("PBX Settings")
        if not settings.enabled:
            return {"success": False, "message": "PBX integration is disabled", "debug": debug_info if debug else None}

        log_step("settings_loaded", {
            "api_host": settings.api_host,
            "has_linkus_access_id": bool(settings.get("linkus_sdk_access_id")),
            "has_linkus_access_key": bool(settings.get_password("linkus_sdk_access_key")),
            "webrtc_trunk_url": settings.get("webrtc_trunk_url")
        })

        # Check if Linkus SDK credentials are configured
        linkus_access_id = settings.get("linkus_sdk_access_id")
        linkus_access_key = settings.get_password("linkus_sdk_access_key")

        if not linkus_access_id or not linkus_access_key:
            log_step("error", {"reason": "missing_linkus_credentials"})
            return {
                "success": False,
                "message": "Linkus SDK credentials not configured. Please add Access ID and Access Key in PBX Settings.",
                "debug": debug_info if debug else None
            }

        log_step("credentials_found", {
            "linkus_access_id_prefix": linkus_access_id[:8] + "..." if linkus_access_id else None,
            "linkus_access_key_length": len(linkus_access_key) if linkus_access_key else 0
        })

        # Get current user's extension
        from pbx_integration.pbx_integration.doctype.pbx_user_extension.pbx_user_extension import PBXUserExtension
        mapping = PBXUserExtension.get_extension_for_user()

        if not mapping:
            log_step("error", {"reason": "no_extension_mapping", "user": frappe.session.user})
            return {
                "success": False,
                "message": "No extension mapped to your user account",
                "debug": debug_info if debug else None
            }

        extension = mapping.extension
        log_step("extension_found", {"extension": extension})

        # Step 1: Get Linkus SDK access token using AccessID/AccessKey
        # This is different from the general OpenAPI OAuth flow!
        token_url = f"{settings.api_host}/openapi/v1.0/get_token"
        token_payload = {
            "username": linkus_access_id,
            "password": linkus_access_key
        }

        log_step("token_request", {"url": token_url, "username_prefix": linkus_access_id[:8] + "..."})

        token_response = requests.post(
            token_url,
            json=token_payload,
            headers={"Content-Type": "application/json", "User-Agent": "OpenAPI"},
            timeout=10,
            verify=False
        )

        token_data = token_response.json()
        log_step("token_response", {
            "status_code": token_response.status_code,
            "errcode": token_data.get("errcode"),
            "errmsg": token_data.get("errmsg"),
            "has_access_token": bool(token_data.get("access_token"))
        })

        if token_data.get("errcode") != 0:
            error_msg = token_data.get("errmsg", "Unknown error")
            log_step("error", {"reason": "token_request_failed", "errmsg": error_msg})
            return {
                "success": False,
                "message": f"Failed to get Linkus SDK token: {error_msg}",
                "debug": debug_info if debug else None
            }

        linkus_access_token = token_data.get("access_token")
        if not linkus_access_token:
            log_step("error", {"reason": "no_token_in_response"})
            return {
                "success": False,
                "message": "No access token returned from Linkus SDK authentication",
                "debug": debug_info if debug else None
            }

        log_step("token_obtained", {"token_prefix": linkus_access_token[:8] + "..."})

        # Step 2: Call Yeastar API to create login signature using Linkus SDK token
        url = f"{settings.api_host}/openapi/v1.0/sign/create"

        # Use "sdk" sign type for Linkus SDK (not "linkus")
        payload = {
            "username": extension,
            "sign_type": "sdk",  # SDK type for Linkus SDK WebRTC calling
            "expire_time": 0  # 0 means no expiration
        }

        log_step("signature_request", {"url": url, "payload": payload})

        response = requests.post(
            url,
            params={"access_token": linkus_access_token},
            json=payload,
            headers={"Content-Type": "application/json", "User-Agent": "OpenAPI"},
            timeout=10,
            verify=False
        )

        data = response.json()

        log_step("signature_response", {
            "status_code": response.status_code,
            "errcode": data.get("errcode"),
            "errmsg": data.get("errmsg"),
            "has_data": bool(data.get("data")),
            "data_keys": list(data.get("data", {}).keys()) if data.get("data") else []
        })

        if data.get("errcode") == 0:
            # Success - return signature
            # Note: Yeastar may return "sign" or "signature" depending on endpoint version
            response_data = data.get("data", {})
            signature = response_data.get("sign") or response_data.get("signature")

            if not signature:
                log_step("error", {"reason": "no_signature_in_data", "response_data": response_data})
                return {
                    "success": False,
                    "message": "No signature returned from PBX",
                    "debug": debug_info if debug else None
                }

            # SDK needs the base PBX URL, not the webtrunk call link
            # api_host is like: https://zngreal.euycm.yeastarcloud.com
            pbx_url = settings.api_host

            log_step("success", {
                "extension": extension,
                "pbx_url": pbx_url,
                "signature_length": len(signature) if signature else 0
            })

            return {
                "success": True,
                "secret": signature,
                "username": extension,
                "pbx_url": pbx_url,
                "debug": debug_info if debug else None
            }
        else:
            error_msg = data.get("errmsg", "Unknown error")
            log_step("error", {"reason": "signature_request_failed", "errmsg": error_msg, "full_response": data})
            return {
                "success": False,
                "message": f"Failed to generate signature: {error_msg}",
                "debug": debug_info if debug else None
            }

    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        frappe.log_error(f"WebRTC Signature Error: {str(e)}\n{error_traceback}", "PBX WebRTC Error")
        return {
            "success": False,
            "message": f"Failed to generate WebRTC signature: {str(e)}",
            "debug": {
                "code_version": "2.0-linkus-sdk",
                "error": str(e),
                "traceback": error_traceback
            } if debug else None
        }
