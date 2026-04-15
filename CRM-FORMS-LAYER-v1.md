# CRM-FORMS-LAYER-v1

## Purpose
Detailed forms layer for the controlled CRM shell build.

---

## 1. Lead Capture Form
### Goal
Capture a new inbound lead cleanly and route it into the pipeline.

### Fields
- first_name
- last_name
- email
- phone
- lead_source
- source_detail
- inquiry_type
- interest_category
- preferred_contact_method
- notes
- consent_status

### System actions on submit
- create contact
- attach source metadata
- assign owner or intake queue
- create opportunity in New Lead
- fire first-touch workflow

---

## 2. Qualification Form
### Goal
Determine fit, urgency, and route to booking or nurture.

### Fields
- contact_id
- timeline
- budget_range
- motivation_level
- decision_maker_status
- current_problem
- desired_outcome
- fit_score
- risk_flags
- disqualifier_reason
- next_step_recommendation

### System actions on submit
- update qualification record
- move stage to Qualification In Progress or Qualified
- branch to booking, nurture, or disqualify path

---

## 3. Booking Request Form
### Goal
Capture appointment intent and match the right calendar.

### Fields
- contact_id
- appointment_type
- preferred_day_range
- preferred_time_range
- timezone
- assigned_owner
- preferred_channel
- booking_notes

### System actions on submit
- map to correct calendar
- create booking record
- move stage to Booking Requested
- trigger confirmation flow

---

## 4. No-Show Recovery Form
### Goal
Standardize missed appointment recovery.

### Fields
- contact_id
- appointment_id
- no_show_reason_known
- reason_detail
- reschedule_interest
- follow_up_owner
- follow_up_date
- recovery_priority

### System actions on submit
- move stage to No-Show
- trigger recovery sequence
- create reschedule task if interest exists

---

## 5. Reactivation Form
### Goal
Re-open dormant opportunities with context.

### Fields
- contact_id
- last_known_stage
- reactivation_trigger
- updated_need
- urgency_now
- owner
- restart_path
- notes

### System actions on submit
- move stage to Reactivation
- refresh qualification fields where needed
- route back to Qualification In Progress or Booking Requested

---

## Approval Notes
### Marc review will be needed on
- required field list
- qualification questions
- disqualifier logic
- lead-source naming standard
