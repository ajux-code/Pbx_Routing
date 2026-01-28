# Copyright (c) 2024, Your Company and contributors
# For license information, please see license.txt

"""
PBX Phone Lookup API

Provides endpoints for looking up phone numbers against
Customer, Lead, and Contact records in ERPNext.
"""

import frappe


@frappe.whitelist()
def by_phone(phone_number):
    """
    Look up a phone number and return matching records.

    URL: /api/method/pbx_integration.api.lookup.by_phone

    Args:
        phone_number: The phone number to search for

    Returns:
        dict: Lookup result containing:
            - phone: The searched phone number
            - found: Whether a match was found
            - contact: Contact name if found
            - contact_name: Contact's full name
            - customer: Customer name if found
            - customer_name: Customer's full name
            - lead: Lead name if found
            - lead_name: Lead's full name
    """
    if not phone_number:
        return {
            "phone": phone_number,
            "found": False,
            "error": "Phone number is required"
        }

    # Use the existing lookup function from PBX Call Log
    from pbx_integration.pbx_integration.doctype.pbx_call_log.pbx_call_log import lookup_phone_number

    result = lookup_phone_number(phone_number)

    # Enrich with display names
    if result.get("customer"):
        customer_name = frappe.db.get_value("Customer", result["customer"], "customer_name")
        result["customer_name"] = customer_name

    if result.get("lead"):
        lead_name = frappe.db.get_value("Lead", result["lead"], "lead_name")
        result["lead_name"] = lead_name

    return result


@frappe.whitelist()
def search(query, limit=10):
    """
    Search for records by phone number or name.

    URL: /api/method/pbx_integration.api.lookup.search

    Args:
        query: Search term (phone number or name)
        limit: Maximum results to return (default 10)

    Returns:
        list: Matching records with type and basic info
    """
    if not query or len(query) < 3:
        return []

    results = []
    limit = min(int(limit), 50)  # Cap at 50 results

    # Normalize query for phone search
    normalized_query = "".join(c for c in query if c.isdigit())

    # Search Contacts
    contacts = frappe.get_all(
        "Contact",
        filters=[
            ["Contact Phone", "phone", "like", f"%{normalized_query[-10:]}%"]
        ] if normalized_query else [
            ["Contact", "first_name", "like", f"%{query}%"]
        ],
        fields=["name", "first_name", "last_name"],
        limit=limit
    )

    for contact in contacts:
        results.append({
            "type": "Contact",
            "name": contact.name,
            "display_name": f"{contact.first_name or ''} {contact.last_name or ''}".strip(),
            "route": f"/app/contact/{contact.name}"
        })

    # Search Customers
    customers = frappe.get_all(
        "Customer",
        filters={
            "mobile_no": ["like", f"%{normalized_query[-10:]}%"]
        } if normalized_query else {
            "customer_name": ["like", f"%{query}%"]
        },
        fields=["name", "customer_name"],
        limit=limit
    )

    for customer in customers:
        results.append({
            "type": "Customer",
            "name": customer.name,
            "display_name": customer.customer_name,
            "route": f"/app/customer/{customer.name}"
        })

    # Search Leads
    lead_filters = []
    if normalized_query:
        lead_filters = [
            ["Lead", "mobile_no", "like", f"%{normalized_query[-10:]}%"]
        ]
    else:
        lead_filters = [
            ["Lead", "lead_name", "like", f"%{query}%"]
        ]

    leads = frappe.get_all(
        "Lead",
        or_filters=lead_filters,
        fields=["name", "lead_name", "company_name"],
        limit=limit
    )

    for lead in leads:
        results.append({
            "type": "Lead",
            "name": lead.name,
            "display_name": lead.lead_name or lead.company_name or lead.name,
            "route": f"/app/lead/{lead.name}"
        })

    return results[:limit]
