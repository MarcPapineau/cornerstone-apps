# CRM-CALENDARS-LAYER-v1

## Purpose
Calendar structure for the controlled CRM shell build.

---

## Calendar Set

### 1. Discovery Call Calendar
**Use:** first conversations, early-stage lead qualification

### 2. Qualification Call Calendar
**Use:** deeper fit assessment and next-step decision

### 3. Strategy / Consultation Calendar
**Use:** higher-intent leads ready for recommendation or formal consultation

### 4. Follow-Up / Recovery Calendar
**Use:** no-show recovery, reschedules, dormant lead restarts

---

## Calendar Routing Rules
- New Lead does not book directly into Strategy unless manually approved
- Qualified leads route into Qualification or Strategy based on fit
- No-Show routes into Follow-Up / Recovery only
- Reactivation can route to Discovery or Qualification depending on prior stage

---

## Required Data on Booking
- contact_id
- opportunity_id
- appointment_type
- calendar_name
- owner
- confirmation_channel
- booked_at
- reminder_status

---

## Stage Movement Rules
- booking created → stage becomes Booking Requested or Booked
- appointment confirmed → Booked
- attended → Showed
- missed → No-Show
- rescheduled → stays in booking lane with updated timestamp

---

## Reminder / Confirmation Structure
### Discovery / Qualification
- instant confirmation
- 24h reminder
- 2h reminder

### Strategy / Consultation
- instant confirmation
- 24h reminder
- 3h reminder
- optional prep note

### Follow-Up / Recovery
- confirmation only
- same-day reminder

---

## Approval Notes
### Marc review will be needed on
- exact calendar naming
- which call types Marc personally wants on-calendar
- reminder timing preference
