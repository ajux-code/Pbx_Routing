# Copyright (c) 2024, Your Company and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class PBXCallLog(Document):
    """
    PBX Call Log - Stores call history from the PBX system.

    Automatically looks up and links customers/leads/contacts
    based on phone numbers when a call record is created.
    """

    def before_insert(self):
        """Auto-link customer/lead/contact based on phone number."""
        phone_to_lookup = self.caller_number if self.call_type == "Inbound" else self.called_number

        if phone_to_lookup:
            self.lookup_and_link(phone_to_lookup)

    def lookup_and_link(self, phone_number):
        """
        Look up a phone number and link to Customer, Lead, or Contact.

        Search priority:
        1. Contact (most specific)
        2. Customer
        3. Lead
        """
        if not phone_number:
            return

        # Normalize phone number (remove spaces, dashes, etc.)
        normalized = self.normalize_phone(phone_number)

        # Try to find a Contact first
        contact = self.find_contact(normalized)
        if contact:
            self.linked_contact = contact.name
            # Also link the customer if contact has one
            if contact.links:
                for link in contact.links:
                    if link.link_doctype == "Customer":
                        self.linked_customer = link.link_name
                        break
                    elif link.link_doctype == "Lead":
                        self.linked_lead = link.link_name
            return

        # Try to find a Customer
        customer = self.find_customer(normalized)
        if customer:
            self.linked_customer = customer
            return

        # Try to find a Lead
        lead = self.find_lead(normalized)
        if lead:
            self.linked_lead = lead
            return

    def normalize_phone(self, phone):
        """Remove common formatting from phone numbers."""
        if not phone:
            return ""
        # Remove common formatting characters
        for char in [" ", "-", "(", ")", "+", "."]:
            phone = phone.replace(char, "")
        return phone

    def find_contact(self, phone):
        """Find a contact by phone number."""
        # Search in Contact's phone fields
        contact = frappe.db.get_value(
            "Contact",
            filters=[
                ["Contact Phone", "phone", "like", f"%{phone[-10:]}%"]
            ],
            fieldname="name"
        )

        if contact:
            return frappe.get_doc("Contact", contact)

        # Also check the main phone field on Contact
        contact = frappe.db.get_value(
            "Contact",
            filters={"phone": ["like", f"%{phone[-10:]}%"]},
            fieldname="name"
        )

        if contact:
            return frappe.get_doc("Contact", contact)

        return None

    def find_customer(self, phone):
        """Find a customer by phone number."""
        # Check Customer's mobile_no field
        customer = frappe.db.get_value(
            "Customer",
            filters={"mobile_no": ["like", f"%{phone[-10:]}%"]},
            fieldname="name"
        )

        if customer:
            return customer

        # Also check primary phone from Dynamic Link
        customer = frappe.db.sql("""
            SELECT dl.link_name
            FROM `tabContact` c
            JOIN `tabContact Phone` cp ON cp.parent = c.name
            JOIN `tabDynamic Link` dl ON dl.parent = c.name
            WHERE dl.link_doctype = 'Customer'
            AND cp.phone LIKE %s
            LIMIT 1
        """, (f"%{phone[-10:]}%",), as_dict=True)

        if customer:
            return customer[0].link_name

        return None

    def find_lead(self, phone):
        """Find a lead by phone number."""
        lead = frappe.db.get_value(
            "Lead",
            filters={"mobile_no": ["like", f"%{phone[-10:]}%"]},
            fieldname="name"
        )

        if lead:
            return lead

        lead = frappe.db.get_value(
            "Lead",
            filters={"phone": ["like", f"%{phone[-10:]}%"]},
            fieldname="name"
        )

        return lead


def lookup_phone_number(phone_number):
    """
    Public utility function to look up a phone number.

    Returns dict with customer, lead, contact info if found.
    Used by the screen pop feature.
    """
    log = PBXCallLog({"doctype": "PBX Call Log"})
    normalized = log.normalize_phone(phone_number)

    result = {
        "phone": phone_number,
        "found": False,
        "customer": None,
        "lead": None,
        "contact": None,
        "contact_name": None
    }

    # Find contact
    contact = log.find_contact(normalized)
    if contact:
        result["found"] = True
        result["contact"] = contact.name
        result["contact_name"] = contact.first_name + (" " + contact.last_name if contact.last_name else "")

        # Get linked customer/lead
        for link in contact.links:
            if link.link_doctype == "Customer":
                result["customer"] = link.link_name
            elif link.link_doctype == "Lead":
                result["lead"] = link.link_name

        return result

    # Find customer
    customer = log.find_customer(normalized)
    if customer:
        result["found"] = True
        result["customer"] = customer
        return result

    # Find lead
    lead = log.find_lead(normalized)
    if lead:
        result["found"] = True
        result["lead"] = lead
        return result

    return result
