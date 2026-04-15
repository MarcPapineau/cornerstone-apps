# CRM-SHELL-BUILD-BLUEPRINT-v1

## Purpose
Controlled CRM shell build start for Phase 3A.
This is structural build work only.
It is not a claim that the CRM is finished, validated, or customer-ready.

---

## 1. PIPELINE SKELETON

### Core pipeline stages
1. New Lead
2. Unworked
3. Attempting Contact
4. Connected
5. Qualification In Progress
6. Qualified
7. Booking Requested
8. Booked
9. Showed
10. No-Show
11. Nurture
12. Reactivation
13. Closed Won
14. Closed Lost

### Stage logic
- early stages focus on response speed and contact confirmation
- middle stages focus on qualification and booking conversion
- later stages split no-show, nurture, and reactivation instead of dropping leads into one dead bucket

---

## 2. STAGE STRUCTURE RULES

### Required fields by stage family
- contact identity
- lead source
- intent category
- owner
- last contact date
- next action date
- pipeline stage
- qualification status
- booking status
- nurture status
- reactivation status

### Non-negotiable structure rules
- every stage must imply the next system action
- nurture and reactivation must be explicit states, not vague notes
- no-show must branch separately from unresponsive leads
- closed lost requires a reason code

---

## 3. FORMS LAYER

### Forms to create
1. Lead Capture Form
   - name
   - email
   - phone
   - source
   - inquiry type
   - interest type
   - notes

2. Qualification Form
   - timeline
   - budget / range
   - decision-maker status
   - urgency
   - current problem
   - fit score
   - disqualifier flags

3. Booking Form
   - appointment type
   - preferred time window
   - assigned calendar
   - confirmation channel

4. No-Show Recovery Form
   - no-show reason if known
   - reschedule interest
   - follow-up owner

5. Reactivation Form
   - prior stage
   - reactivation trigger
   - updated need
   - restart priority

---

## 4. CALENDARS LAYER

### Calendar structure
- Discovery Call Calendar
- Qualification Call Calendar
- Strategy / Consultation Calendar
- Follow-Up Call Calendar

### Calendar rules
- one pipeline stage change must occur when a booking is created
- one stage change must occur on show / no-show outcome
- confirmation and reminder sequences must map to calendar type

---

## 5. IMPORT SCHEMA

### Core import columns
- external_id
- first_name
- last_name
- full_name
- email
- phone
- company
- source
- source_detail
- lead_type
- owner
- stage
- status
- last_contact_at
- next_action_at
- booked_at
- nurture_flag
- reactivation_flag
- notes
- tags

### Import rules
- normalize phone and email before import
- map legacy statuses into the new stage structure
- preserve source attribution
- preserve owner if valid, otherwise route to intake owner

---

## 6. COMMUNICATION ARCHITECTURE MAP

### Channel stack
- SMS for speed-to-lead and reminders
- email for longer-form follow-up and nurture
- call tasks for high-intent leads
- calendar confirmations for booked leads
- internal task creation for owner follow-up

### Communication rule by state
- New Lead / Attempting Contact = fast outbound touch
- Qualification In Progress = short, clear, data-gathering communication
- Booking Requested / Booked = reminders + confirmation
- No-Show = recovery sequence
- Nurture = spaced value sequence
- Reactivation = renewed outreach based on prior context

---

## 7. WORKFLOW MAP

### Lead Capture
Trigger:
- form submitted
Actions:
- create contact
- assign source
- set stage to New Lead
- create first task
- fire first-touch communication

### Qualification
Trigger:
- contact connected or qualification form completed
Actions:
- update qualification fields
- set stage to Qualification In Progress or Qualified
- branch based on fit

### Booking
Trigger:
- qualified lead requests appointment
Actions:
- assign calendar
- create appointment
- set stage to Booking Requested / Booked
- send confirmation

### Follow-Up
Trigger:
- no response after outreach or post-call follow-up due
Actions:
- create task
- send follow-up sequence
- update last_contact_at / next_action_at

### Nurture
Trigger:
- qualified but not ready
Actions:
- move to Nurture
- assign nurture sequence
- schedule future check-in

### No-Show
Trigger:
- appointment missed
Actions:
- move to No-Show
- send recovery outreach
- create reschedule task

### Reactivation
Trigger:
- dormant lead re-engages or scheduled reactivation date hits
Actions:
- move to Reactivation
- refresh qualification data
- route back to Qualification In Progress or Booking Requested

---

## 8. BUILD STATUS

### This document now establishes
- pipeline skeleton
- stage structure
- forms layer
- calendars layer
- import schema
- communication architecture map
- workflow map

### This document does not yet claim
- live GHL implementation complete
- QA validated
- customer-ready release
