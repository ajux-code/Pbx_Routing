# PBX Integration for Frappe/ERPNext

A Frappe application that integrates Yeastar P-Series Cloud PBX with ERPNext, enabling automatic call logging, real-time notifications, and CRM-telephony workflows.

## Overview

This integration connects your cloud phone system (Yeastar P-Series) with your business management system (ERPNext/Frappe), allowing your team to:

- Automatically log all incoming, outgoing, and internal calls
- See caller information instantly when the phone rings (screen pop)
- Link calls to Customers, Leads, and Contacts
- Track call history and recordings within ERPNext

## Architecture

```
┌─────────────────────┐         ┌──────────────────────┐
│   Yeastar P-Series  │         │   Frappe/ERPNext     │
│   Cloud PBX         │         │                      │
│                     │         │  ┌────────────────┐  │
│  - Handles calls    │ webhook │  │ Webhook API    │  │
│  - Linkus app       │────────▶│  │ /api/method/   │  │
│  - Extensions       │         │  │ pbx_integration│  │
│                     │         │  └───────┬────────┘  │
│                     │         │          │           │
│                     │         │          ▼           │
│                     │         │  ┌────────────────┐  │
│                     │         │  │ PBX Call Log   │  │
│                     │         │  │ DocType        │  │
│                     │         │  └───────┬────────┘  │
│                     │         │          │           │
│                     │         │          ▼           │
│                     │  socket │  ┌────────────────┐  │
│                     │◀────────│  │ Screen Pop     │  │
│                     │         │  │ Notification   │  │
└─────────────────────┘         │  └────────────────┘  │
                                └──────────────────────┘
```

## Integration Model

**Important distinction:** This is a *webhook-based* integration, not an API-control integration.

| Aspect | This Integration (Yeastar) | Active Control (e.g., Twilio) |
|--------|---------------------------|-------------------------------|
| Call initiation | User dials on phone/Linkus app | Code can initiate calls via API |
| Call control | PBX handles everything | Can answer, transfer, record via API |
| Data flow | PBX pushes events to us | We push commands to telephony API |
| Use case | Call logging & CRM sync | Call centers, IVR, programmatic dialing |

Yeastar acts as the phone system; we passively receive events and log them. We cannot make calls or control call flow through this integration.

---

## Phases

### Phase 1: Foundation & Authentication ✅

**Goal:** Establish secure connection to Yeastar Cloud API.

**Components Built:**
- **PBX Settings** (Single DocType) - Stores Yeastar credentials and configuration
  - `client_id` - OAuth client ID from Yeastar
  - `client_secret` - OAuth client secret (encrypted)
  - `pbx_domain` - Your Yeastar cloud domain (e.g., `company.ypcloud.yeastar.com`)
  - `access_token` - Auto-refreshed OAuth token
  - `token_expiry` - Token expiration timestamp

**Authentication Flow:**
```
1. Admin enters Client ID + Secret in PBX Settings
2. Click "Get Access Token"
3. App calls Yeastar OAuth endpoint
4. Receives access_token (valid ~2 hours)
5. Token stored and auto-refreshed before expiry
```

**Files:**
- `pbx_integration/doctype/pbx_settings/pbx_settings.py`
- `pbx_integration/doctype/pbx_settings/pbx_settings.json`

---

### Phase 2: Call Logging & Webhooks ✅

**Goal:** Automatically create call records in ERPNext when calls happen.

**Components Built:**
- **PBX Call Log** (DocType) - Stores individual call records
  - `call_id` - Unique identifier from Yeastar
  - `call_type` - Inbound, Outbound, or Internal
  - `status` - Answered, Missed, Busy, Voicemail, Failed
  - `caller_number` - Who initiated the call
  - `called_number` - Who was called
  - `extension` - Internal extension involved
  - `call_start` - When the call began
  - `duration` - Talk time in seconds
  - `has_recording` - Whether call was recorded
  - `recording_url` - Link to recording file

- **Webhook Endpoint** - Receives real-time events from Yeastar
  - URL: `/api/method/pbx_integration.api.webhook.receive`
  - Handles event type `30011` (Call Status) - real-time ringing/answered/hangup
  - Handles event type `30012` (CDR) - call detail record when call ends

**Yeastar Webhook Payload Format:**
```json
{
  "type": 30012,
  "sn": "3658B4250123",
  "msg": "{\"call_id\":\"1769507524.51\",\"type\":\"Internal\",\"status\":\"ANSWERED\",...}"
}
```

**Webhook Configuration in Yeastar:**
1. Go to Yeastar Management Portal → Integrations → API
2. Add webhook URL: `https://your-domain.com/api/method/pbx_integration.api.webhook.receive`
3. Select events: 30011 (Call State Changed), 30012 (Call End Details)
4. Set method: POST

**Files:**
- `pbx_integration/doctype/pbx_call_log/pbx_call_log.py`
- `pbx_integration/doctype/pbx_call_log/pbx_call_log.json`
- `pbx_integration/api/webhook.py`

---

### Phase 3: Screen Pop Notifications 🔄 (In Progress)

**Goal:** Show real-time popup when calls arrive, with caller identification.

**Components to Build:**
- **Client-side JavaScript** - Listens for Socket.io events
- **Notification UI** - Toast/popup with caller info and action buttons
- **Phone Lookup API** - Searches Contacts, Leads, Customers by phone number
- **Extension-User Mapping** (optional) - Route notifications to specific users

**User Experience:**
```
Phone rings → Popup appears instantly:
┌─────────────────────────────────────┐
│ 📞 Incoming Call                    │
│                                     │
│ +45 12345678                        │
│ John Smith - ABC Company            │
│                                     │
│ [Open Contact]  [Create Lead]       │
└─────────────────────────────────────┘
```

**Technical Flow:**
1. Yeastar sends `type: 30011` webhook with `member_status: "RING"`
2. Webhook handler calls `trigger_screen_pop()`
3. `frappe.publish_realtime("pbx_incoming_call", data)` sends to browser
4. Client JS receives event and shows notification
5. User clicks to open matched record or create new

**Files (to create):**
- `pbx_integration/public/js/pbx_screen_pop.js`
- `pbx_integration/api/lookup.py`

---

### Phase 4: Click-to-Call (Future)

**Goal:** Allow users to initiate calls from within ERPNext.

**Note:** This requires Yeastar's Click-to-Call API which allows triggering calls between an extension and an external number. The PBX calls the extension first, then bridges to the destination.

**Potential Features:**
- Phone number links throughout ERPNext become clickable
- Click triggers call from user's assigned extension
- Call is logged automatically

---

### Phase 5: Advanced Features (Future)

**Potential Enhancements:**
- **Call Recording Playback** - Stream recordings directly in ERPNext
- **Call Analytics Dashboard** - Charts showing call volume, duration, missed calls
- **Extension Status Widget** - Show which team members are on calls
- **Queue Statistics** - For call center deployments
- **Voicemail Integration** - Surface voicemails as tasks or notifications

---

## Installation

```bash
# Get the app
bench get-app https://github.com/your-repo/pbx_integration

# Install on your site
bench --site your-site.local install-app pbx_integration

# Run migrations
bench --site your-site.local migrate
```

## Configuration

1. **Set up Yeastar API credentials:**
   - Go to PBX Settings in ERPNext
   - Enter your Yeastar Cloud domain, Client ID, and Client Secret
   - Click "Get Access Token"

2. **Configure Yeastar webhooks:**
   - In Yeastar Management Portal, add webhook URL
   - Enable events 30011 and 30012
   - Test the webhook connection

3. **Verify integration:**
   - Make a test call
   - Check PBX Call Log for new entries

---

## Technical Reference

### Yeastar Event Types

| Type Code | Event Name | Description |
|-----------|------------|-------------|
| 30011 | Call State Changed | Real-time status: RING, ANSWERED, BYE |
| 30012 | Call End Details | CDR with full call information |
| 30013 | Call Transfer Report | When calls are transferred |
| 30014 | Call Forwarding Report | When calls are forwarded |
| 30015 | Call Failure Report | Failed call attempts |

### Call Status Values

| Yeastar Status | Mapped Status |
|----------------|---------------|
| ANSWERED | Answered |
| NO ANSWER | Missed |
| BUSY | Busy |
| FAILED | Failed |
| VOICEMAIL | Voicemail |

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/method/pbx_integration.api.webhook.receive` | POST | Receive Yeastar webhooks |
| `/api/method/pbx_integration.api.lookup.by_phone` | GET | Look up records by phone number |

---

## Troubleshooting

**Webhooks not arriving:**
- Verify full webhook URL is saved in Yeastar (not truncated)
- Check that your server is publicly accessible via HTTPS
- Review Error Log in Frappe for any webhook errors

**Calls not being logged:**
- Ensure events 30011 and 30012 are enabled in Yeastar
- Check that the webhook returns 200 OK (test from Yeastar portal)
- Review server logs: `grep "PBX Webhook" ~/frappe-bench/logs/`

**Token expiration issues:**
- Access tokens expire after ~2 hours
- Token should auto-refresh; if not, manually click "Get Access Token" in PBX Settings

---

## License

MIT License - See LICENSE file for details.
