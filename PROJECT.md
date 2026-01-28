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
┌─────────────────────┐         ┌──────────────────────────────┐
│   Yeastar P-Series  │         │      Frappe/ERPNext          │
│   Cloud PBX         │         │                              │
│                     │         │  ┌────────────────────────┐  │
│  - Handles calls    │ webhook │  │ Webhook API            │  │
│  - Linkus app       │────────▶│  │ /webhook/receive       │  │
│  - Extensions       │         │  └──────────┬─────────────┘  │
│                     │         │             │                │
│                     │◀────────┤  Call       │                │
│                     │ Control │  Control    ▼                │
│  - Answer API       │  API    │  ┌──────────────────────┐   │
│  - Hangup API       │◀───────│  │ ERPNext Call Log     │   │
│  - Dial API         │         │  │ + PBX Call Log       │   │
│                     │         │  └──────────┬───────────┘   │
│                     │         │             │                │
│                     │  socket │             ▼                │
│                     │◀───────│  ┌──────────────────────┐   │
│                     │         │  │ Frappe Telephony     │   │
│                     │         │  │ - CallPopup UI       │   │
│                     │         │  │ - Answer/Hangup btns │   │
│                     │         │  │ - Click-to-call      │   │
└─────────────────────┘         │  └──────────────────────┘   │
                                └──────────────────────────────┘
```

## Integration Model

**Hybrid Integration:** Combines passive event monitoring with active call control.

| Aspect | This Integration (Yeastar PBX) |
|--------|--------------------------------|
| **Call initiation** | ✅ Via API (`make_call`) or phone/Linkus app |
| **Call control** | ✅ Can answer, hangup via API |
| **Call monitoring** | ✅ Real-time webhooks for all call events |
| **Call logging** | ✅ Automatic to ERPNext Call Log |
| **Click-to-call** | ✅ From any phone field in ERPNext |
| **Screen pop** | ✅ Using ERPNext's built-in CallPopup |
| **Data flow** | ↔️ Bidirectional (webhooks + API commands) |

**Integration Type:** Full telephony provider integration using Frappe/ERPNext's standard telephony system, similar to Twilio and Exotel integrations.

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

### Phase 3: Frappe Telephony Integration ✅

**Goal:** Full integration with Frappe/ERPNext's built-in telephony system for call management.

**Architecture:** Integrates as a telephony provider alongside Twilio, Exotel, etc.

**Components Built:**

#### 1. **ERPNext Call Log Integration**
- Creates entries in ERPNext's standard "Call Log" DocType
- Automatically links calls to Contact, Customer, and Lead records
- Tracks call status: Ringing → In Progress → Completed
- Stores recording URLs and call duration

#### 2. **Enhanced CallPopup UI**
- Uses ERPNext's built-in `CallPopup` class for incoming calls
- Shows caller information with linked records
- **New:** Answer and Hangup buttons for call control
- Real-time status updates (Ringing/In Progress/Completed)
- Auto-dismisses on call end

**User Experience:**
```
Phone rings → ERPNext CallPopup appears:
┌─────────────────────────────────────┐
│ 📞 Incoming Call (Ringing)          │
│                                     │
│ +45 12345678                        │
│ John Smith                          │
│ ABC Company                         │
│                                     │
│ [Answer]  [Hangup]  [Open Contact]  │
└─────────────────────────────────────┘
```

#### 3. **Call Control API**
- `answer_call(call_id)` - Answer incoming call via Yeastar API
- `hangup_call(call_id)` - End active call via Yeastar API
- Real-time status synchronization with Call Log

#### 4. **Extension-User Mapping**
- **PBX User Extension** DocType maps Frappe users to PBX extensions
- Routes incoming call notifications to specific users
- Required for click-to-call and call control features

#### 5. **Click-to-Call Handler**
- Registers `frappe.phone_call.handler` for phone field icons
- Clicking any phone number in ERPNext initiates a call
- Shows real-time call status alerts

**Technical Flow:**

**Incoming Call:**
```
1. Yeastar sends webhook: type 30011 (RING)
2. create_erpnext_call_log() creates Call Log entry
3. trigger_screen_pop() publishes "show_call_popup" event
4. ERPNext CallPopup appears with Answer/Hangup buttons
5. User clicks Answer → answer_call() API → Yeastar answers call
6. Webhook sends type 30012 (CDR) → Call Log updated
```

**Outgoing Call (Click-to-Call):**
```
1. User clicks phone number in ERPNext
2. frappe.phone_call.handler() triggered
3. make_call() API → Yeastar API /call/dial
4. PBX rings user's extension
5. User answers → PBX dials external number
6. Calls bridged together
7. Webhook CDR → Call Log created
```

**Features:**
- Full integration with ERPNext telephony system
- Answer/hangup calls directly from browser
- Automatic call logging to standard Call Log DocType
- Click-to-call from any phone field
- Real-time call status tracking
- Recording URL storage
- User-to-extension mapping

**Files:**
- `pbx_integration/doctype/pbx_user_extension/` - Extension mapping DocType
- `pbx_integration/api/call.py` - Call control API (answer, hangup, make_call)
- `pbx_integration/api/webhook.py` - Enhanced with ERPNext Call Log support
- `pbx_integration/public/js/pbx_telephony.js` - Main telephony integration
- `pbx_integration/api/lookup.py` - Phone lookup API endpoints

---

### Phase 4: Recording & Analytics (Future)

**Goal:** Advanced call analysis and recording management.

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
   - Go to **PBX Settings** in ERPNext
   - Enter your Yeastar Cloud domain, Client ID, and Client Secret
   - Click "Get Access Token"
   - Verify "Enabled" is checked

2. **Configure Yeastar webhooks:**
   - In Yeastar Management Portal → Integrations → API
   - Add webhook URL: `https://your-domain.com/api/method/pbx_integration.api.webhook.receive`
   - Enable events: **30011** (Call State Changed), **30012** (Call End Details)
   - Set method: **POST**
   - Test the webhook connection

3. **Map users to extensions:**
   - Go to **PBX User Extension** list
   - Create new entry for each user:
     - **User**: Select Frappe user
     - **Extension**: Enter PBX extension number (e.g., 1001)
     - **Extension Name**: Optional display name
     - **Enabled**: Check to activate
   - Save

4. **Verify integration:**
   - Make a test call
   - Check **Call Log** for new entries
   - Click a phone number in ERPNext to test click-to-call
   - Incoming call should show CallPopup with Answer/Hangup buttons

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
| `/api/method/pbx_integration.api.lookup.search` | GET | Search records by phone or name |
| `/api/method/pbx_integration.api.call.make_call` | POST | Initiate outgoing call (click-to-call) |
| `/api/method/pbx_integration.api.call.answer_call` | POST | Answer incoming call |
| `/api/method/pbx_integration.api.call.hangup_call` | POST | Hang up active call |
| `/api/method/pbx_integration.api.call.check_click_to_call_enabled` | GET | Check if user has call control enabled |

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
