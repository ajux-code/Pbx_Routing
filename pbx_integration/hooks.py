app_name = "pbx_integration"
app_title = "PBX Integration"
app_publisher = "Your Company"
app_description = "Yeastar PBX integration for ERPNext"
app_email = "your@email.com"
app_license = "MIT"

# Apps that this app depends on
required_apps = ["frappe", "erpnext"]

# Documentation
# https://frappeframework.com/docs/user/en/basics/hooks

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/pbx_integration/css/pbx_integration.css"
app_include_js = [
    "/assets/pbx_integration/js/pbx_click_to_call.js",
    "/assets/pbx_integration/js/pbx_telephony.js",
]

# include js, css files in header of web template
# web_include_css = "/assets/pbx_integration/css/pbx_integration.css"
# web_include_js = "/assets/pbx_integration/js/pbx_integration.js"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "pbx_integration.utils.jinja_methods",
# 	"filters": "pbx_integration.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "pbx_integration.install.before_install"
# after_install = "pbx_integration.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "pbx_integration.uninstall.before_uninstall"
# after_uninstall = "pbx_integration.uninstall.after_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "pbx_integration.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }

# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------
# Will be used later to refresh tokens automatically

# scheduler_events = {
# 	"cron": {
# 		"*/25 * * * *": [
# 			"pbx_integration.api.auth.refresh_token_if_needed"
# 		]
# 	}
# }

# Testing
# -------

# before_tests = "pbx_integration.install.before_tests"

# Overriding Methods
# ------------------------------

# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "pbx_integration.event.get_events"
# }

# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "pbx_integration.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"pbx_integration.auth.validate"
# ]
