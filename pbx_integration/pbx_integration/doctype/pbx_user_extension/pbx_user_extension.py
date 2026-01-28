# Copyright (c) 2024, Your Company and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class PBXUserExtension(Document):
    def validate(self):
        # Ensure extension is numeric
        if self.extension and not self.extension.isdigit():
            frappe.throw("Extension must be a numeric value")

    @staticmethod
    def get_extension_for_user(user=None):
        """Get the PBX extension mapped to a user."""
        if not user:
            user = frappe.session.user

        mapping = frappe.db.get_value(
            "PBX User Extension",
            {"user": user, "enabled": 1},
            ["extension", "extension_name"],
            as_dict=True
        )

        return mapping

    @staticmethod
    def get_user_for_extension(extension):
        """Get the Frappe user mapped to a PBX extension."""
        user = frappe.db.get_value(
            "PBX User Extension",
            {"extension": extension, "enabled": 1},
            "user"
        )

        return user
