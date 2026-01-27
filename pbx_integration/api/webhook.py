# Copyright (c) 2024, Your Company and contributors
# For license information, please see license.txt

"""
PBX Webhook API

Receives call events from Yeastar PBX via HTTP POST.
This endpoint must be publicly accessible (allow_guest=True).

Yeastar sends events like:
- NewCdr: When a call ends (contains full call details)
- CallStatus: Real-time call status changes (ringing, answered, etc.)
- ExtensionStatus: Extension state changes
"""

import frappe
import json
from frappe.utils import now_datetime, cstr


@frappe.whitelist(allow_guest=True, methods=["POST"])
def receive():
    """
    Main webhook endpoint for Yeastar events.

    URL: /api/method/pbx_integration.api.webhook.receive

    Yeastar P-Series Cloud sends:
    - type: 30012 = CDR (call detail record when call ends)
    - type: 30011 = Call status updates (ringing, answered, hangup)
    - msg: JSON string containing the actual event data
    """
    try:
        # Get the raw request data
        if frappe.request.data:
            data = json.loads(frappe.request.data)
        else:
            data = frappe.form_dict

        # Log the incoming webhook for debugging
        frappe.logger().info(f"PBX Webhook received: {json.dumps(data, indent=2)}")

        # Yeastar P-Series Cloud format: {type: number, sn: string, msg: "json string"}
        event_type = data.get("type")

        if event_type and "msg" in data:
            # Parse the msg JSON string
            try:
                msg_data = json.loads(data.get("msg", "{}"))
            except json.JSONDecodeError:
                msg_data = {}

            # Route based on Yeastar event type codes
            if event_type == 30012:
                # CDR - Call Detail Record (call completed)
                return handle_yeastar_cdr(msg_data)
            elif event_type == 30011:
                # Call status update
                return handle_yeastar_call_status(msg_data)
            else:
                frappe.logger().info(f"Unhandled Yeastar event type: {event_type}")
                return {"status": "ok", "message": f"Event type {event_type} received"}

        # Fallback: Try old format for compatibility
        event_name = data.get("event") or data.get("action") or "unknown"

        if event_name == "NewCdr":
            return handle_new_cdr(data)
        elif event_name == "CallStatus":
            return handle_call_status(data)
        elif event_name == "ExtensionStatus":
            return handle_extension_status(data)
        elif event_name == "Ringing":
            return handle_ringing(data)
        elif event_name == "answer":
            return handle_answer(data)
        elif event_name == "hangup" or event_name == "HANGUP":
            return handle_hangup(data)
        else:
            frappe.logger().warning(f"Unknown PBX event: {event_name}")
            return {"status": "ok", "message": f"Event {event_name} received but not handled"}

    except Exception as e:
        frappe.log_error(f"Webhook error: {str(e)}\nData: {frappe.request.data}", "PBX Webhook Error")
        return {"status": "error", "message": str(e)}


def handle_yeastar_cdr(msg_data):
    """
    Handle Yeastar type 30012 - CDR (Call Detail Record).

    Fields from Yeastar:
    - call_id: Unique call identifier
    - time_start: Call start time
    - call_from: Caller number/extension
    - call_to: Called number/extension
    - call_duration: Total call duration in seconds
    - talk_duration: Talk time in seconds
    - status: ANSWERED, NO ANSWER, BUSY, VOICEMAIL, etc.
    - type: Internal, Inbound, Outbound
    - recording: Recording file path if exists
    """
    try:
        call_log = frappe.new_doc("PBX Call Log")

        # Call identification
        call_log.call_id = msg_data.get("call_id")

        # Call type mapping
        call_type_map = {
            "Internal": "Internal",
            "Inbound": "Inbound",
            "Outbound": "Outbound"
        }
        call_log.call_type = call_type_map.get(msg_data.get("type"), "Internal")

        # Status mapping
        status_map = {
            "ANSWERED": "Answered",
            "NO ANSWER": "Missed",
            "BUSY": "Busy",
            "FAILED": "Failed",
            "VOICEMAIL": "Voicemail"
        }
        call_log.status = status_map.get(msg_data.get("status"), "Missed")

        # Caller/Called info
        call_log.caller_number = msg_data.get("call_from")
        call_log.called_number = msg_data.get("call_to")

        # For internal calls, use call_to as extension
        if call_log.call_type == "Internal":
            call_log.extension = msg_data.get("call_to")
        else:
            call_log.extension = msg_data.get("call_to") if call_log.call_type == "Inbound" else msg_data.get("call_from")

        # Timing
        call_log.call_start = parse_datetime(msg_data.get("time_start"))
        call_log.duration = msg_data.get("talk_duration") or msg_data.get("call_duration") or 0

        # Recording
        if msg_data.get("recording"):
            call_log.has_recording = 1
            call_log.recording_url = msg_data.get("recording")

        # Check for existing record with same call_id
        if call_log.call_id:
            existing = frappe.db.exists("PBX Call Log", {"call_id": call_log.call_id})
            if existing:
                # Update existing
                frappe.db.set_value("PBX Call Log", existing, {
                    "status": call_log.status,
                    "duration": call_log.duration,
                    "has_recording": call_log.has_recording or 0,
                    "recording_url": call_log.recording_url
                })
                frappe.db.commit()
                frappe.logger().info(f"Updated call log: {existing}")
                return {"status": "ok", "message": "Call log updated", "name": existing}

        # Insert new record
        call_log.insert(ignore_permissions=True)
        frappe.db.commit()

        frappe.logger().info(f"Created call log: {call_log.name}")
        return {"status": "ok", "message": "Call log created", "name": call_log.name}

    except Exception as e:
        frappe.log_error(f"Error handling Yeastar CDR: {str(e)}\nData: {msg_data}", "PBX CDR Error")
        return {"status": "error", "message": str(e)}


def handle_yeastar_call_status(msg_data):
    """
    Handle Yeastar type 30011 - Call Status Update.

    Fields from Yeastar:
    - call_id: Unique call identifier
    - members: Array of call members with status
      - extension: {number, channel_id, member_status, call_path}
      - member_status: RING, ANSWERED, BYE, etc.
    """
    try:
        call_id = msg_data.get("call_id")
        members = msg_data.get("members", [])

        for member in members:
            ext_info = member.get("extension", {})
            extension = ext_info.get("number")
            member_status = ext_info.get("member_status")

            frappe.logger().info(f"Call {call_id}: Extension {extension} status: {member_status}")

            # Handle different statuses
            if member_status == "RING":
                # Incoming call ringing
                trigger_screen_pop(extension, extension, call_id)

            elif member_status == "ANSWERED":
                # Call was answered - update existing log if exists
                if call_id:
                    existing = frappe.db.exists("PBX Call Log", {"call_id": call_id})
                    if existing:
                        frappe.db.set_value("PBX Call Log", existing, {
                            "status": "Answered",
                            "call_answer": now_datetime()
                        })
                        frappe.db.commit()

            elif member_status == "BYE":
                # Call ended - will be handled by CDR event (type 30012)
                pass

        return {"status": "ok", "message": "Call status processed"}

    except Exception as e:
        frappe.log_error(f"Error handling Yeastar call status: {str(e)}\nData: {msg_data}", "PBX CallStatus Error")
        return {"status": "error", "message": str(e)}


def handle_new_cdr(data):
    """
    Handle NewCdr event - a completed call record.

    This is sent when a call ends and contains full call details.
    """
    try:
        cdr_data = data.get("data", data)

        # Map Yeastar fields to our Call Log fields
        call_log = frappe.new_doc("PBX Call Log")

        # Call identification
        call_log.call_id = cdr_data.get("callid") or cdr_data.get("call_id") or cdr_data.get("linkedid")

        # Determine call type
        call_type_map = {
            "Inbound": "Inbound",
            "Outbound": "Outbound",
            "Internal": "Internal",
            "inbound": "Inbound",
            "outbound": "Outbound",
            "internal": "Internal",
            "in": "Inbound",
            "out": "Outbound"
        }
        raw_type = cdr_data.get("type") or cdr_data.get("calltype") or cdr_data.get("direction") or ""
        call_log.call_type = call_type_map.get(raw_type, "Inbound")

        # Call status
        status_map = {
            "ANSWERED": "Answered",
            "NO ANSWER": "Missed",
            "BUSY": "Busy",
            "FAILED": "Failed",
            "VOICEMAIL": "Voicemail",
            "answered": "Answered",
            "noanswer": "Missed",
            "busy": "Busy",
            "failed": "Failed"
        }
        raw_status = cdr_data.get("status") or cdr_data.get("disposition") or ""
        call_log.status = status_map.get(raw_status, "Answered" if cdr_data.get("talkdur") else "Missed")

        # Extension info
        call_log.extension = cdr_data.get("ext") or cdr_data.get("extension") or cdr_data.get("callee")
        call_log.extension_name = cdr_data.get("extname") or cdr_data.get("extension_name")

        # Caller/Called numbers
        call_log.caller_number = cdr_data.get("src") or cdr_data.get("caller") or cdr_data.get("from")
        call_log.caller_name = cdr_data.get("srcname") or cdr_data.get("caller_name") or cdr_data.get("callername")
        call_log.called_number = cdr_data.get("dst") or cdr_data.get("callee") or cdr_data.get("to")
        call_log.called_name = cdr_data.get("dstname") or cdr_data.get("callee_name")

        # Timing
        call_log.call_start = parse_datetime(cdr_data.get("timestart") or cdr_data.get("start"))
        call_log.call_answer = parse_datetime(cdr_data.get("timeanswer") or cdr_data.get("answer"))
        call_log.call_end = parse_datetime(cdr_data.get("timeend") or cdr_data.get("end"))
        call_log.duration = cdr_data.get("talkdur") or cdr_data.get("duration") or cdr_data.get("billsec") or 0

        # Recording
        if cdr_data.get("recording") or cdr_data.get("recordfile"):
            call_log.has_recording = 1
            call_log.recording_url = cdr_data.get("recording") or cdr_data.get("recordfile")

        # Check if this call_id already exists
        if call_log.call_id:
            existing = frappe.db.exists("PBX Call Log", {"call_id": call_log.call_id})
            if existing:
                # Update existing record instead of creating new
                existing_doc = frappe.get_doc("PBX Call Log", existing)
                existing_doc.status = call_log.status
                existing_doc.call_end = call_log.call_end
                existing_doc.duration = call_log.duration
                existing_doc.has_recording = call_log.has_recording
                existing_doc.recording_url = call_log.recording_url
                existing_doc.save(ignore_permissions=True)
                frappe.db.commit()
                return {"status": "ok", "message": "Call log updated", "name": existing_doc.name}

        # Save new call log
        call_log.insert(ignore_permissions=True)
        frappe.db.commit()

        frappe.logger().info(f"Created call log: {call_log.name}")
        return {"status": "ok", "message": "Call log created", "name": call_log.name}

    except Exception as e:
        frappe.log_error(f"Error handling NewCdr: {str(e)}", "PBX CDR Error")
        return {"status": "error", "message": str(e)}


def handle_call_status(data):
    """
    Handle real-time call status updates.

    Used for screen pop - notifies when a call starts ringing.
    """
    try:
        status_data = data.get("data", data)

        call_id = status_data.get("callid") or status_data.get("call_id")
        status = status_data.get("status") or status_data.get("state")
        caller = status_data.get("caller") or status_data.get("src") or status_data.get("from")
        callee = status_data.get("callee") or status_data.get("dst") or status_data.get("to")
        extension = status_data.get("ext") or status_data.get("extension")

        # If this is a ringing event, trigger screen pop
        if status in ["ringing", "Ringing", "RINGING"]:
            trigger_screen_pop(caller, extension, call_id)

        return {"status": "ok", "message": f"Call status {status} processed"}

    except Exception as e:
        frappe.log_error(f"Error handling CallStatus: {str(e)}", "PBX CallStatus Error")
        return {"status": "error", "message": str(e)}


def handle_ringing(data):
    """Handle incoming call ringing event."""
    status_data = data.get("data", data)
    caller = status_data.get("caller") or status_data.get("src") or status_data.get("from")
    extension = status_data.get("ext") or status_data.get("extension") or status_data.get("callee")
    call_id = status_data.get("callid") or status_data.get("call_id")

    # Create a call log with "Ringing" status
    try:
        call_log = frappe.new_doc("PBX Call Log")
        call_log.call_id = call_id
        call_log.call_type = "Inbound"
        call_log.status = "Ringing"
        call_log.caller_number = caller
        call_log.extension = extension
        call_log.call_start = now_datetime()
        call_log.insert(ignore_permissions=True)
        frappe.db.commit()
    except Exception:
        pass  # May fail if duplicate, that's ok

    trigger_screen_pop(caller, extension, call_id)
    return {"status": "ok", "message": "Ringing event processed"}


def handle_answer(data):
    """Handle call answered event."""
    status_data = data.get("data", data)
    call_id = status_data.get("callid") or status_data.get("call_id")

    # Update existing call log to "Answered"
    if call_id:
        existing = frappe.db.exists("PBX Call Log", {"call_id": call_id})
        if existing:
            frappe.db.set_value("PBX Call Log", existing, {
                "status": "Answered",
                "call_answer": now_datetime()
            })
            frappe.db.commit()

    return {"status": "ok", "message": "Answer event processed"}


def handle_hangup(data):
    """Handle call hangup event."""
    status_data = data.get("data", data)
    call_id = status_data.get("callid") or status_data.get("call_id")
    duration = status_data.get("duration") or status_data.get("talkdur") or 0

    # Update existing call log
    if call_id:
        existing = frappe.db.exists("PBX Call Log", {"call_id": call_id})
        if existing:
            doc = frappe.get_doc("PBX Call Log", existing)
            doc.call_end = now_datetime()
            doc.duration = duration
            # Set status based on whether call was answered
            if doc.status == "Ringing":
                doc.status = "Missed"
            doc.save(ignore_permissions=True)
            frappe.db.commit()

    return {"status": "ok", "message": "Hangup event processed"}


def handle_extension_status(data):
    """Handle extension status changes (idle, ringing, busy, etc.)."""
    # Future: Can be used to show agent availability dashboard
    return {"status": "ok", "message": "Extension status received"}


def trigger_screen_pop(phone_number, extension, call_id):
    """
    Trigger a screen pop notification for the agent.

    Uses Frappe's realtime messaging (Socket.io) to push
    notification to the user's browser.
    """
    if not phone_number:
        return

    # Look up the caller
    from pbx_integration.pbx_integration.doctype.pbx_call_log.pbx_call_log import lookup_phone_number
    lookup_result = lookup_phone_number(phone_number)

    # Find the user associated with this extension
    # Future: Map extensions to users via PBX Extension Mapping DocType
    # For now, broadcast to all users with System Manager role

    # Prepare notification data
    notification_data = {
        "type": "incoming_call",
        "call_id": call_id,
        "phone": phone_number,
        "extension": extension,
        "lookup": lookup_result,
        "timestamp": cstr(now_datetime())
    }

    # Publish to realtime channel
    frappe.publish_realtime(
        event="pbx_incoming_call",
        message=notification_data,
        after_commit=True
    )

    frappe.logger().info(f"Screen pop triggered for {phone_number} on extension {extension}")


def parse_datetime(dt_string):
    """Parse various datetime formats from Yeastar."""
    if not dt_string:
        return None

    from frappe.utils import get_datetime

    try:
        return get_datetime(dt_string)
    except Exception:
        return None
