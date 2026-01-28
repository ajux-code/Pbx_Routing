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
        frappe.logger().info(f"PBX Webhook received: type={data.get('type')}")

        # DEBUG: Log full payload - visible in Error Log and browser console
        debug_msg = f"PBX Webhook FULL DATA: {json.dumps(data, indent=2, default=str)}"
        frappe.log_error(debug_msg, "PBX Debug - Webhook Received")

        # Also send to browser console for real-time debugging
        frappe.publish_realtime("pbx_debug", {"message": debug_msg}, after_commit=True)

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
        call_id = msg_data.get("call_id")

        # Map Yeastar fields
        call_type_map = {
            "Internal": "Internal",
            "Inbound": "Incoming",
            "Outbound": "Outgoing"
        }
        call_type = call_type_map.get(msg_data.get("type"), "Incoming")

        # Status mapping
        status_map = {
            "ANSWERED": "Completed",
            "NO ANSWER": "No Answer",
            "BUSY": "Busy",
            "FAILED": "Failed",
            "VOICEMAIL": "No Answer"
        }
        status = status_map.get(msg_data.get("status"), "Completed")

        caller_number = msg_data.get("call_from")
        called_number = msg_data.get("call_to")
        duration = msg_data.get("talk_duration") or msg_data.get("call_duration") or 0
        recording_url = msg_data.get("recording")

        # Determine extension
        if call_type == "Internal":
            extension = called_number
        else:
            extension = called_number if call_type == "Incoming" else caller_number

        # Update ERPNext Call Log if it exists
        if frappe.db.exists("DocType", "Call Log"):
            if frappe.db.exists("Call Log", {"id": call_id}):
                call_log_doc = frappe.get_doc("Call Log", {"id": call_id})
                call_log_doc.status = status
                call_log_doc.duration = duration
                call_log_doc.end_time = now_datetime()
                if recording_url:
                    call_log_doc.recording_url = recording_url
                call_log_doc.save(ignore_permissions=True)
                frappe.db.commit()

                # Trigger call ended event for CallPopup
                frappe.publish_realtime(
                    event=f"call_{call_id}_ended",
                    message={"id": call_id, "status": status},
                    after_commit=True
                )

                frappe.logger().info(f"Updated ERPNext Call Log: {call_log_doc.name}")

        # Also maintain PBX Call Log for compatibility
        call_log = frappe.new_doc("PBX Call Log")
        call_log.call_id = call_id
        call_log.call_type = msg_data.get("type", "Internal")
        call_log.status = msg_data.get("status", "Answered")
        call_log.caller_number = caller_number
        call_log.called_number = called_number
        call_log.extension = extension
        call_log.call_start = parse_datetime(msg_data.get("time_start"))
        call_log.duration = duration

        if recording_url:
            call_log.has_recording = 1
            call_log.recording_url = recording_url

        # Check for existing record
        if call_id:
            existing = frappe.db.exists("PBX Call Log", {"call_id": call_id})
            if existing:
                # Update existing
                frappe.db.set_value("PBX Call Log", existing, {
                    "status": call_log.status,
                    "duration": call_log.duration,
                    "has_recording": call_log.has_recording or 0,
                    "recording_url": call_log.recording_url
                })
                frappe.db.commit()
                frappe.logger().info(f"Updated PBX call log: {existing}")
                return {"status": "ok", "message": "Call log updated", "name": existing}

        # Insert new record
        call_log.insert(ignore_permissions=True)
        frappe.db.commit()

        frappe.logger().info(f"Created PBX call log: {call_log.name}")
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
        # DEBUG: Log full msg_data - visible in Error Log and browser console
        debug_msg = f"PBX CallStatus msg_data: {json.dumps(msg_data, indent=2, default=str)}"
        frappe.log_error(debug_msg, "PBX Debug - Call Status")
        frappe.publish_realtime("pbx_debug", {"message": debug_msg}, after_commit=True)

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

    Uses Frappe's built-in CallPopup (if ERPNext is available)
    or custom popup notification.
    """
    if not phone_number:
        return

    # Look up the caller
    from pbx_integration.pbx_integration.doctype.pbx_call_log.pbx_call_log import lookup_phone_number
    lookup_result = lookup_phone_number(phone_number)

    # Find the user associated with this extension
    from pbx_integration.pbx_integration.doctype.pbx_user_extension.pbx_user_extension import PBXUserExtension
    user_email = PBXUserExtension.get_user_for_extension(extension)

    # Try to use ERPNext's Call Log and CallPopup
    if frappe.db.exists("DocType", "Call Log"):
        # Create ERPNext Call Log entry
        call_log = create_erpnext_call_log(
            call_id=call_id,
            from_number=phone_number,
            to_extension=extension,
            lookup_result=lookup_result
        )

        # Trigger ERPNext's built-in CallPopup
        if user_email:
            frappe.publish_realtime(
                event="show_call_popup",
                message=call_log,
                user=user_email,
                after_commit=True
            )
        else:
            # Broadcast to all System Managers if no specific user found
            frappe.publish_realtime(
                event="show_call_popup",
                message=call_log,
                after_commit=True
            )

        frappe.logger().info(f"ERPNext Call popup triggered for {phone_number} on extension {extension}")
    else:
        # Fallback to custom popup (original implementation)
        notification_data = {
            "type": "incoming_call",
            "call_id": call_id,
            "phone": phone_number,
            "extension": extension,
            "lookup": lookup_result,
            "timestamp": cstr(now_datetime())
        }

        if user_email:
            frappe.publish_realtime(
                event="pbx_incoming_call",
                message=notification_data,
                user=user_email,
                after_commit=True
            )
        else:
            frappe.publish_realtime(
                event="pbx_incoming_call",
                message=notification_data,
                after_commit=True
            )

        frappe.logger().info(f"Custom screen pop triggered for {phone_number} on extension {extension}")


def create_erpnext_call_log(call_id, from_number, to_extension, lookup_result):
    """
    Create an ERPNext Call Log entry for incoming call.

    Args:
        call_id: Unique call identifier
        from_number: Caller phone number
        to_extension: Extension being called
        lookup_result: Result from phone lookup

    Returns:
        dict: Call log data for realtime event
    """
    try:
        # Check if call log already exists
        if frappe.db.exists("Call Log", {"id": call_id}):
            call_log = frappe.get_doc("Call Log", {"id": call_id})
        else:
            call_log = frappe.new_doc("Call Log")
            call_log.id = call_id
            call_log.to = to_extension
            call_log.from_ = from_number  # Note: 'from' is reserved, use 'from_'
            call_log.status = "Ringing"
            call_log.type = "Incoming"
            call_log.medium = to_extension
            call_log.start_time = now_datetime()

            # Link to found records
            if lookup_result.get("contact"):
                call_log.append("links", {
                    "link_doctype": "Contact",
                    "link_name": lookup_result["contact"]
                })

            if lookup_result.get("customer"):
                call_log.append("links", {
                    "link_doctype": "Customer",
                    "link_name": lookup_result["customer"]
                })

            if lookup_result.get("lead"):
                call_log.append("links", {
                    "link_doctype": "Lead",
                    "link_name": lookup_result["lead"]
                })

            call_log.insert(ignore_permissions=True)
            frappe.db.commit()

        # Return data for CallPopup
        return {
            "name": call_log.name,
            "id": call_id,
            "from": from_number,
            "to": to_extension,
            "status": "Ringing",
            "type": "Incoming",
            "links": [
                {"link_doctype": link.link_doctype, "link_name": link.link_name}
                for link in call_log.links
            ] if hasattr(call_log, "links") else []
        }

    except Exception as e:
        frappe.log_error(f"Failed to create ERPNext Call Log: {str(e)}", "PBX Call Log Error")
        # Return minimal data for popup
        return {
            "id": call_id,
            "from": from_number,
            "to": to_extension,
            "status": "Ringing",
            "type": "Incoming",
            "links": []
        }


def parse_datetime(dt_string):
    """Parse various datetime formats from Yeastar."""
    if not dt_string:
        return None

    from frappe.utils import get_datetime

    try:
        return get_datetime(dt_string)
    except Exception:
        return None
