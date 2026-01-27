# Copyright (c) 2024, Your Company and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime, add_to_date
import requests


class PBXSettings(Document):
    """
    PBX Settings - Manages Yeastar PBX API credentials and tokens.

    This is a Single DocType - only one instance exists system-wide.
    Access it with: frappe.get_single("PBX Settings")

    Yeastar Cloud uses OAuth2 Client Credentials flow:
    - Client ID and Client Secret are used to get access tokens
    - Tokens expire and need to be refreshed
    """

    def validate(self):
        """Called before save - validate the settings."""
        if self.enabled and not all([self.api_host, self.client_id, self.client_secret]):
            frappe.throw("API Host, Client ID, and Client Secret are required when enabled")

        # Ensure API host doesn't have trailing slash
        if self.api_host:
            self.api_host = self.api_host.rstrip("/")

    def get_access_token(self):
        """
        Get a valid access token, refreshing if necessary.

        Returns:
            str: Valid access token or None if authentication fails
        """
        if not self.enabled:
            frappe.throw("PBX Integration is not enabled")

        # Check if we have a valid token
        if self.access_token and self.token_expiry:
            if now_datetime() < self.token_expiry:
                return self.access_token

        # Try to refresh the token
        if self.refresh_token:
            token = self._refresh_access_token()
            if token:
                return token

        # Need to get a new token
        return self._authenticate()

    def _authenticate(self):
        """
        Authenticate with the Yeastar Cloud API.

        Yeastar expects 'username' and 'password' parameters.
        We store them as client_id/client_secret in Frappe for clarity.

        Endpoint: POST /openapi/v1.0/get_token

        Returns:
            str: Access token or None
        """
        try:
            url = f"{self.api_host}/openapi/v1.0/get_token"

            # Yeastar uses username/password, not client_id/client_secret
            payload = {
                "username": self.client_id,
                "password": self.get_password("client_secret")
            }

            response = requests.post(url, json=payload, timeout=30, verify=False)
            response.raise_for_status()

            data = response.json()

            if data.get("errcode") == 0:
                self._save_tokens(data)
                return self.access_token
            else:
                frappe.log_error(
                    f"PBX Authentication failed: {data.get('errmsg')}",
                    "PBX Authentication Error"
                )
                return None

        except requests.exceptions.RequestException as e:
            frappe.log_error(f"PBX API request failed: {str(e)}", "PBX Connection Error")
            return None

    def _refresh_access_token(self):
        """
        Refresh the access token using the refresh token.

        Returns:
            str: New access token or None
        """
        try:
            url = f"{self.api_host}/openapi/v1.0/refresh_token"

            payload = {
                "refresh_token": self.refresh_token
            }

            response = requests.post(url, json=payload, timeout=30, verify=False)
            response.raise_for_status()

            data = response.json()

            if data.get("errcode") == 0:
                self._save_tokens(data)
                return self.access_token
            else:
                # Refresh failed, need to re-authenticate
                return self._authenticate()

        except requests.exceptions.RequestException:
            return self._authenticate()

    def _save_tokens(self, data):
        """
        Save the tokens from the API response.

        Args:
            data: API response containing access_token, refresh_token, access_token_expire_time
        """
        self.access_token = data.get("access_token")
        self.refresh_token = data.get("refresh_token")

        # Yeastar returns access_token_expire_time in seconds (typically 1800 = 30 minutes)
        expire_seconds = data.get("access_token_expire_time", 1800)
        # Set expiry 5 minutes early to be safe
        self.token_expiry = add_to_date(now_datetime(), seconds=expire_seconds - 300)

        # For Single DocTypes, use set_value to update individual fields
        frappe.db.set_single_value("PBX Settings", "access_token", self.access_token)
        frappe.db.set_single_value("PBX Settings", "refresh_token", self.refresh_token)
        frappe.db.set_single_value("PBX Settings", "token_expiry", self.token_expiry)
        frappe.db.commit()

    def test_connection(self):
        """
        Test the PBX connection and return status.

        Returns:
            dict: Connection test result
        """
        if not all([self.api_host, self.client_id, self.client_secret]):
            return {"success": False, "message": "Missing API credentials (Host, Client ID, or Client Secret)"}

        token = self._authenticate()

        if token:
            return {"success": True, "message": "Connection successful! Token obtained."}
        else:
            return {"success": False, "message": "Authentication failed. Check your Client ID and Client Secret."}
