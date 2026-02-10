# Complete Configuration Guide: Twilio → Yeastar → Frappe WebRTC

This guide walks you through configuring inbound calls from a Twilio phone number to be handled by Yeastar PBX and answered via WebRTC in Frappe.

---

## How It Works

```
Customer (Kenya/TZ) dials Twilio number (+45-XXX-XXXX)
                    ↓
            [TWILIO receives call]
            Checks configuration: "Forward to Yeastar"
                    ↓
            [YEASTAR receives call]
            Inbound route → IVR Menu
                    ↓
            [IVR plays options]
            "Press 1 for Sales, 2 for Support..."
                    ↓
            Customer presses 1
                    ↓
            [Routes to Ring Group/Queue]
            Agent extensions ring
                    ↓
            [Webhook fires to Frappe]
            Screen pop: "Incoming call from +254..."
                    ↓
            Agent clicks "Answer" in Frappe
                    ↓
            [WebRTC connects via Linkus SDK]
            Agent talks to customer in browser
                    ↓
            Call ends → CDR webhook → Call logged in Frappe
```

---

## Prerequisites

Before starting, gather this information:

| Item | Where to Find It | Your Value |
|------|------------------|------------|
| Twilio Account SID | Twilio Console → Dashboard | |
| Twilio Auth Token | Twilio Console → Dashboard | |
| Twilio Phone Number | Twilio Console → Phone Numbers | +45-__________ |
| Yeastar Cloud Domain | Your URL (e.g., zngreal.euycm.yeastarcloud.com) | |
| Yeastar Admin Login | Your credentials | |
| Agent Extensions | Yeastar → Extensions | e.g., 100, 101, 102 |

---

## Phase 1: Configure Yeastar (Do This First)

Yeastar must be ready to RECEIVE calls before Twilio can send them.

### Step 1.1: Create Extensions for Agents

> **Location:** Extensions & Trunks → Extensions → Add

If you haven't already, create an extension for each agent:

```
Extension Number: 100
Caller ID Name: Agent Name
Email: agent@yourcompany.com    ← Important for WebRTC login
Extension Type: SIP Extension
```

**Repeat for each agent** (101, 102, etc.)

- [ ] Extension 100 created
- [ ] Extension 101 created
- [ ] Extension 102 created
- [ ] (Add more as needed)

---

### Step 1.2: Create a SIP Trunk for Twilio

> **Location:** Call Control → Trunks → Add → VoIP Trunk

Fill in the following:

#### Basic Settings
| Field | Value |
|-------|-------|
| Trunk Name | `Twilio-Denmark` |
| Trunk Status | Enabled ✓ |

#### Provider Settings
| Field | Value |
|-------|-------|
| Select Provider | Other |
| Hostname/IP | `<your-account-sid>.pstn.twilio.com` |
| Port | `5060` |
| Transport | UDP |

#### Authentication
| Field | Value |
|-------|-------|
| Authentication Mode | Credentials |
| Username | Your Twilio Account SID |
| Password | Your Twilio Auth Token |

#### Codec Settings
| Codec | Enable |
|-------|--------|
| PCMU (G.711 μ-law) | ✓ |
| PCMA (G.711 a-law) | ✓ |

Click **Save**

- [ ] Trunk "Twilio-Denmark" created

---

### Step 1.3: Create a Ring Group (Optional - For Multiple Agents)

> **Location:** Call Features → Ring Groups → Add

| Field | Value |
|-------|-------|
| Ring Group Name | `Sales Team` |
| Ring Group Number | `600` |
| Ring Strategy | Ring All (or Least Recent for fair distribution) |
| Ring Timeout | 30 seconds |

**Members:**
- 100 (Agent 1)
- 101 (Agent 2)
- 102 (Agent 3)

**If No Answer:**
| Field | Value |
|-------|-------|
| Destination | Voicemail / Queue / Extension |

Click **Save**

- [ ] Ring Group "Sales Team" (600) created

---

### Step 1.4: Create a Call Queue (For "Please Hold" Functionality)

> **Location:** Call Features → Queues → Add

| Field | Value |
|-------|-------|
| Queue Name | `Support Queue` |
| Queue Number | `700` |
| Ring Strategy | Least Recent |
| Max Wait Time | 300 seconds (5 min) |
| Max Callers | 10 |

**Static Agents:**
- 100
- 101
- 102

**Queue Settings:**
| Field | Value |
|-------|-------|
| Music on Hold | default |
| Announce Position | Yes ✓ |
| Announce Hold Time | Yes ✓ |

**If No Agent Available:**
| Field | Value |
|-------|-------|
| Destination | Voicemail |

Click **Save**

- [ ] Queue "Support Queue" (700) created

---

### Step 1.5: Create an IVR Menu

> **Location:** Call Features → IVR → Add

| Field | Value |
|-------|-------|
| IVR Name | `Main Menu` |
| IVR Number | `800` |
| Timeout | 10 seconds |

**Prompt:** Upload or record your greeting:
> "Thank you for calling [Company Name]. Press 1 for Sales. Press 2 for Support. Or stay on the line to speak with an operator."

**Key Press Events:**

| Key | Destination Type | Destination |
|-----|------------------|-------------|
| 1 | Ring Group | 600 (Sales Team) |
| 2 | Queue | 700 (Support Queue) |
| Timeout | Ring Group | 600 (Sales Team) |
| Invalid | Replay IVR | - |

Click **Save**

- [ ] IVR "Main Menu" (800) created

---

### Step 1.6: Create the Inbound Route (CRITICAL)

> **Location:** Call Control → Inbound Routes → Add

This tells Yeastar: "When calls arrive from Twilio, route them to the IVR"

| Field | Value |
|-------|-------|
| Route Name | `Twilio-Inbound` |
| Trunk | Twilio-Denmark |
| DID Pattern | (leave blank or enter your Twilio number) |

**Destination:**
| Field | Value |
|-------|-------|
| Type | IVR |
| Destination | Main Menu (800) |

Click **Save**

- [ ] Inbound Route "Twilio-Inbound" created

---

### Step 1.7: Create an Outbound Route (For Calling Out via Twilio)

> **Location:** Call Control → Outbound Routes → Add

| Field | Value |
|-------|-------|
| Route Name | `International-via-Twilio` |
| Dial Pattern | `_00.` or `_+.` (international format) |
| Strip | 0 (to remove leading zeros if needed) |
| Prepend | + (if needed) |
| Trunk | Twilio-Denmark |

Click **Save**

- [ ] Outbound Route created

---

### Yeastar Configuration Checklist

- [ ] Extensions created for all agents
- [ ] Trunk "Twilio-Denmark" created and enabled
- [ ] Ring Group created (if using)
- [ ] Queue created (if using)
- [ ] IVR "Main Menu" created with options
- [ ] Inbound Route points Twilio trunk → IVR
- [ ] Outbound Route created (for outgoing calls)

---

## Phase 2: Configure Twilio

Now tell Twilio to forward calls to Yeastar.

### Step 2.1: Determine Your Yeastar SIP Address

Based on your Yeastar domain, your SIP address is:

```
sip:800@zngreal.euycm.yeastarcloud.com
```

> **Note:** Replace `800` with your IVR number (or extension/ring group number)

---

### Step 2.2: Create a TwiML Bin

> **Location:** Twilio Console → Explore Products → Developer Tools → TwiML Bins

1. Click **Create new TwiML Bin**
2. Fill in:

| Field | Value |
|-------|-------|
| Friendly Name | `Forward-to-Yeastar` |

**TwiML Content:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="+45XXXXXXXXXX">
    <Sip>sip:800@zngreal.euycm.yeastarcloud.com</Sip>
  </Dial>
</Response>
```

> **Important:** Replace:
> - `+45XXXXXXXXXX` with your actual Twilio Denmark number
> - `800` with your IVR number
> - `zngreal.euycm.yeastarcloud.com` with your Yeastar domain (if different)

3. Click **Save**

- [ ] TwiML Bin "Forward-to-Yeastar" created

---

### Step 2.3: Configure Your Phone Number

> **Location:** Twilio Console → Phone Numbers → Manage → Active Numbers

1. Click on your Denmark number (+45-XXX-XXXX)
2. Scroll to **Voice Configuration**
3. Configure:

| Field | Value |
|-------|-------|
| Configure With | TwiML Bin |
| A Call Comes In | Forward-to-Yeastar |

4. Click **Save Configuration**

- [ ] Phone number configured to use TwiML Bin

---

### Twilio Configuration Checklist

- [ ] TwiML Bin created with correct Yeastar SIP address
- [ ] Phone number configured to use the TwiML Bin

---

## Phase 3: Configure Frappe

Ensure Frappe can receive and display calls via WebRTC.

### Step 3.1: Verify PBX Settings in Frappe

> **Location:** Frappe → Search "PBX Settings"

Ensure these fields are configured:

#### Basic Settings
| Field | Value |
|-------|-------|
| Enabled | ✓ |
| API Host | `https://zngreal.euycm.yeastarcloud.com` |
| Client ID | Your Yeastar OAuth Client ID |
| Client Secret | Your Yeastar OAuth Client Secret |

#### WebRTC Settings
| Field | Value |
|-------|-------|
| Enable Browser-Based Calling | ✓ |
| Use WebRTC as Default | ✓ (optional) |
| Linkus SDK Access ID | Your SDK Access ID |
| Linkus SDK Access Key | Your SDK Access Key |

Click **Test Connection** to verify.

- [ ] PBX Settings configured
- [ ] Test Connection successful

---

### Step 3.2: Map Users to Extensions

> **Location:** Frappe → Search "PBX User Extension" → Add New

For each agent, create a mapping:

| Field | Value |
|-------|-------|
| User | agent@yourcompany.com |
| Extension | 100 |
| Enabled | ✓ |

**Repeat for all agents.**

- [ ] User → Extension mapping for Agent 1
- [ ] User → Extension mapping for Agent 2
- [ ] User → Extension mapping for Agent 3

---

### Step 3.3: Configure Webhook in Yeastar (For Real-time Notifications)

> **Location:** Yeastar Admin → Integrations → Webhook (or API → Webhook)

Add a webhook pointing to Frappe:

| Field | Value |
|-------|-------|
| URL | `https://your-frappe-site.com/api/method/pbx_integration.api.webhook.receive` |
| Events | Call Status (30011) ✓, CDR (30012) ✓ |

This enables:
- Screen pop notifications on incoming calls
- Automatic call logging when calls end

- [ ] Webhook configured in Yeastar

---

### Frappe Configuration Checklist

- [ ] PBX Settings configured and connected
- [ ] All agents mapped to extensions
- [ ] Webhook configured in Yeastar pointing to Frappe

---

## Phase 4: Testing

### Test 1: Basic Inbound Call

1. Call your Twilio Denmark number from a phone in Kenya/TZ
2. **Expected:**
   - Twilio answers and forwards to Yeastar
   - IVR plays: "Thank you for calling... Press 1 for Sales..."
   - Press 1
   - Agent extension rings
   - Screen pop appears in Frappe
   - Agent can answer via WebRTC in browser

- [ ] Basic inbound call works

---

### Test 2: Queue Functionality

1. Have **two people** call the Twilio number simultaneously
2. **Expected:**
   - First caller connects to an agent
   - Second caller hears "Please hold" music
   - When first call ends, second caller connects

- [ ] Queue/hold functionality works

---

### Test 3: Call Logging

1. Complete a test call
2. Check **PBX Call Log** in Frappe
3. **Expected:**
   - Call is logged with caller number
   - Duration recorded
   - Status shows (Answered/Missed)
   - Customer/Lead linked (if phone number matched)

- [ ] Calls are being logged

---

### Test 4: Outbound Calling

1. In Frappe, click on a phone number to initiate a call
2. **Expected:**
   - WebRTC dialog appears (or desk phone rings)
   - Outbound call connects via Twilio trunk

- [ ] Outbound calls work

---

## Troubleshooting

| Problem | Possible Cause | Solution |
|---------|---------------|----------|
| Call doesn't reach Yeastar | TwiML SIP address wrong | Verify SIP address in TwiML Bin |
| IVR doesn't play | Inbound route misconfigured | Check Inbound Route points to IVR |
| Extension doesn't ring | Extension not in ring group | Add extension to Ring Group members |
| No screen pop in Frappe | Webhook not configured | Configure webhook in Yeastar |
| Can't answer via WebRTC | SDK credentials wrong | Verify Linkus SDK Access ID/Key |
| Calls not logged | CDR webhook disabled | Enable CDR (30012) event in webhook |
| "Oops" or call fails | Trunk registration failed | Check Twilio credentials in trunk |
| One-way audio | NAT/firewall issue | Check SIP Settings → NAT in Yeastar |

---

## Quick Reference

### Your Key Endpoints

| System | Address |
|--------|---------|
| Yeastar Admin | `https://zngreal.euycm.yeastarcloud.com` |
| Yeastar SIP | `sip:800@zngreal.euycm.yeastarcloud.com` |
| Frappe Webhook | `https://your-site.com/api/method/pbx_integration.api.webhook.receive` |
| Twilio Console | `https://console.twilio.com` |

### Your Key Numbers

| Item | Number |
|------|--------|
| Twilio DK Number | +45-__________ |
| IVR Number | 800 |
| Ring Group | 600 |
| Queue | 700 |
| Agent Extensions | 100, 101, 102 |

---

## Summary

| System | Role |
|--------|------|
| **Twilio** | Owns the phone number. Forwards calls via SIP. |
| **Yeastar** | PBX - handles IVR, queues, routing, extensions. |
| **Frappe** | Shows notifications, logs calls, provides WebRTC UI. |

---

## Next Steps After Setup

1. **Record professional IVR prompts** - Replace default with branded messages
2. **Configure business hours** - Route calls differently after hours
3. **Set up voicemail** - For missed calls
4. **Add more agents** - As your team grows
5. **Enable call recording** - For quality assurance (check legal requirements)

---

*Guide created for ZNG Real - PBX Integration Project*
