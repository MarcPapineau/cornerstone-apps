# CRM-COMMUNICATION-AND-WORKFLOW-MAP-v1

## Purpose
Communication architecture and workflow map for the controlled CRM shell build.

---

## Communication Architecture

### Channel roles
- **SMS** → speed-to-lead, confirmations, reminders, no-show recovery
- **Email** → richer follow-up, nurture, recap, reactivation
- **Call task** → high-intent human contact
- **Internal tasking** → owner follow-up and accountability

### State-by-state communication behavior
- **New Lead** → immediate acknowledgement + first touch
- **Attempting Contact** → short follow-up sequence
- **Qualification In Progress** → question-driven follow-up
- **Qualified** → booking prompt
- **Booked** → reminders and prep communication
- **No-Show** → recovery outreach
- **Nurture** → spaced value-based touchpoints
- **Reactivation** → context-aware restart communication

---

## Workflow Map

### 1. Lead Capture Workflow
**Trigger**
- lead capture form submitted

**Actions**
- create/update contact
- create opportunity
- stamp source
- assign owner/intake queue
- trigger first touch

### 2. Qualification Workflow
**Trigger**
- contact responds or qualification form submitted

**Actions**
- update qualification fields
- set fit state
- branch to qualified, nurture, or disqualify path

### 3. Booking Workflow
**Trigger**
- qualified lead requests meeting

**Actions**
- select calendar
- create appointment
- move opportunity to Booking Requested / Booked
- send confirmation and reminders

### 4. Follow-Up Workflow
**Trigger**
- no reply window expires or manual follow-up due

**Actions**
- create follow-up task
- send follow-up message
- advance or downgrade cadence based on engagement

### 5. Nurture Workflow
**Trigger**
- lead not ready but still relevant

**Actions**
- move to Nurture
- assign nurture sequence
- set next action date
- monitor re-engagement events

### 6. No-Show Workflow
**Trigger**
- appointment marked missed

**Actions**
- move to No-Show
- send recovery message
- create reschedule task
- branch into recovery or nurture

### 7. Reactivation Workflow
**Trigger**
- dormant lead hits reactivation date or re-engages

**Actions**
- move to Reactivation
- refresh context
- route back to qualification or booking path

---

## Approval Notes
### Marc review will be needed on
- first-touch tone
- nurture cadence philosophy
- when a human call task should override automation
- no-show recovery aggressiveness
