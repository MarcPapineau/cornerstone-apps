# N8N WORKFLOWS — PHASE 2 BUILD (14 Workflows)

**Status:** BUILD IN PROGRESS  
**Target:** All 14 workflows built, tested, exported by midnight Apr 11, 2026  
**Build Date:** Apr 11, 2026 12:30 AM EDT  
**Subagent:** Subagent b4319a40-52d9-4b34-a9fc-1e9251ed03af  

---

## PHASE 2A: CORE ADAPTATIONS (6 Workflows)

Each workflow below includes:
- Detailed node structure  
- All API configurations  
- Trigger schedules  
- Testing protocol  

---

### WORKFLOW 1: APOLLOS DAILY v2 (Mon–Fri 7:30 AM)

**Status:** SPEC COMPLETE, BUILD IN PROGRESS

**Objective:**  
Generate daily article content across platforms (LinkedIn RE, LinkedIn Insurance, Instagram Health) with live research context, branded visuals, and auto-posting to Buffer.

**Nodes Required:**
1. **Trigger** — Cron schedule (Mon–Fri 7:30 AM)
2. **Check Day of Week** — Route based on weekday (Mon/Wed/Fri = RE, Tue = Insurance, Thu = Health)
3. **Fetch Daniel Research** — Query Airtable "DANIEL Research" base for today's findings
4. **Perplexity Research** — sonar model (cost: $0.005), query based on day's topic
5. **Claude Article Generation** — Haiku (cost: $0.001), prompt: "Write HNW investor-focused article for {platform}"
6. **Unsplash Image** — Fetch hero image matching article keywords
7. **Bannerbear Infographic** — Template k4qoBVDyanEEDzN0gj, layer: message = article headline
8. **Email Draft** — Email node, recipients: marc@cornerstoneregroup.ca, CC: admin@marcpapineau.com
9. **Buffer Queue** — POST article + image to Buffer, pending Marc's approval
10. **Engagement Tracker** — Log to Airtable: article_title, platform, scheduled_time
11. **Error Handler** — Webhook fallback to Slack on error

**Credential Map:**
- Perplexity: `TvioB7giRzeBL4Dd`
- Claude (Anthropic): `ZqJUVXLWLnmab503`
- Bannerbear: API Key `bb_ma_7a7c879fa2542b7aef37e758d99b96`, Project ID `XNblonZrlB8K1Prw7v`
- Unsplash: API Key `jiGexAI9ksmM-MyLuECVfHYpymWaDJAKzi5LcWSinpw`
- Buffer: Bearer `laVsoqGxOvESso1w4dHbLK_thtEJ0p_c-il1vFNMoYo`
- Gmail: oauth2 credential
- Airtable: `appMLfA6AOTwuNbPS` (LUKE base)

**Platform Routing:**
```
Monday → RE LinkedIn
Tuesday → Insurance LinkedIn
Wednesday → RE LinkedIn
Thursday → Health Instagram
Friday → RE LinkedIn
```

**Testing Protocol:**
1. Trigger manually for Thursday (Health Instagram topic)
2. Verify Bannerbear renders correctly
3. Check email draft has correct content + image attribution
4. Confirm Buffer queue shows pending post
5. Run again with different topic to verify platform-aware formatting

**Expected Cost:** ~$0.015/run (Perplexity + Claude + Bannerbear)

**Sign-off:** Test 1 full cycle with live research context

---

### WORKFLOW 2: DANIEL RESEARCH v2 (Daily, Morning)

**Status:** SPEC COMPLETE

**Objective:**  
Pull and synthesize 4 daily research sections (Macro, Market, Ottawa, Health) via Perplexity sonar-pro with citations, store in Airtable, and deliver structured email.

**Nodes Required:**
1. **Trigger** — Cron schedule (6:00 AM daily)
2. **Perplexity Sonar-Pro (4 parallel)** — One query per section:
   - "Macro Watch: Global markets, rates, inflation signals relevant to investors"
   - "Market Intel: Real estate market trends, inventory, sales data Canada-wide"
   - "Ottawa Spotlight: Local market movers, development pipeline, news for RE investors"
   - "Health Research: Relevant biotech, pharma, supplement industry trends"
3. **Claude Synthesis (4 parallel)** — Haiku, prompt: "Distill into 3 bullet points for {ottawa_investor_audience}"
4. **Citation Extractor** — Parse Perplexity citations, store source URLs
5. **Airtable Writer** — Write 4 rows to "DANIEL Research" table with: date, section_name, synthesis, citations, source_urls
6. **Email Builder** — Format as structured email with 4 sections
7. **Email Send** — To marc@cornerstoneregroup.ca
8. **Feedback Loop Logger** — Store which findings got used in Apollos articles (manual tracking)

**Credential Map:**
- Perplexity: `TvioB7giRzeBL4Dd`
- Claude: `ZqJUVXLWLnmab503`
- Airtable: `appMLfA6AOTwuNbPS`
- Gmail/Email: transactional

**Output Format:**
```
MACRO WATCH
- Bullet 1
- Bullet 2  
- Bullet 3

MARKET INTEL  
[same structure]

OTTAWA SPOTLIGHT
[same structure]

HEALTH RESEARCH
[same structure]

Sources: [hyperlinked citations]
```

**Testing Protocol:**
1. Trigger manually
2. Verify all 4 Perplexity calls succeeded + returned citations
3. Check Airtable rows created with all fields populated
4. Confirm email contains all 4 sections with proper formatting
5. Verify sources are clickable links

**Expected Cost:** ~$0.04/run (4 × Perplexity sonar-pro @ $0.01 each)

**Sign-off:** One full research cycle with citation verification

---

### WORKFLOW 3: EZRA MORNING BRIEFING v2 (7:00 AM Daily)

**Status:** SPEC COMPLETE

**Objective:**  
Aggregate Gmail unread (prioritized by GHL VIP contacts), Calendar events (24-48h), GHL deadlines, and synthesize into prioritized action list.

**Nodes Required:**
1. **Trigger** — Cron schedule (7:00 AM daily)
2. **Gmail Node** — Fetch unread emails (limit 10), scope: to:marc@cornerstoneregroup.ca
3. **Gmail → GHL Cross-Reference** — For each email sender, check if they're a GHL contact (high-value flag)
4. **Google Calendar** — Fetch events for next 48 hours
5. **GHL API Call** — Fetch upcoming deadlines/follow-up dates from pipeline
6. **Claude Priority Detection** — Haiku, prompt: "Given {emails} + {calendar} + {ghl_deadlines}, what are Marc's top 3 actions today?"
7. **Email Formatter** — Build structured briefing: Pipeline | Calendar | Action Items | Market Signal
8. **Slack Message** — POST to #daily-briefing (if channel exists)
9. **Email Send** — To marc@cornerstoneregroup.ca + admin@marcpapineau.com
10. **Feedback Button** — Telegram/Email inline button: "Was this useful? 👍/👎"

**Credential Map:**
- Gmail: oauth2 credential  
- Google Calendar: oauth2 credential
- GHL: `pit-9d8151f8-6e4a-44bd-bd01-2ffc069549ec` (agency) OR `pit-bdd3d03b-3bbe-45cc-8577-d8de5f63cba2` (Marc RE)
- Claude: `ZqJUVXLWLnmab503`
- Slack: webhook URL (configure in settings)
- Telegram: bot token for feedback (optional)

**Output Format:**
```
🔥 PRIORITY ACTIONS (Next 3)
1. [Highest priority item with context]
2. [Second priority]
3. [Third priority]

📅 CALENDAR (Next 48h)
- [Meeting 1] at [time] with [attendees]
- [Meeting 2]

📍 PIPELINE STATUS  
- Hot leads: [count]
- Follow-ups due today: [list]
- Appointments: [count]

📊 MARKET SNAPSHOT
[Brief macro signal from Daniel research if available]

Was this useful? 👍 👎
```

**Testing Protocol:**
1. Trigger manually
2. Verify Gmail unread count matches what Marc expects
3. Check Calendar events are correct (next 48h)
4. Confirm GHL deadlines are pulling
5. Validate Claude priority list makes sense
6. Test both Slack POST and Email delivery
7. Click feedback button and verify logging

**Expected Cost:** ~$0.002/run (mostly API calls, minimal Claude)

**Sign-off:** One full briefing cycle with all data sources verified

---

### WORKFLOW 4: FAQ AUTORESPONDER v2 (On-Demand Email/Form Trigger)

**Status:** SPEC COMPLETE

**Objective:**  
Auto-respond to peptide FAQ questions via email or form submission with research-compliant answers (no medical advice). Escalate low-confidence matches to Marc.

**Nodes Required:**
1. **Trigger** — Webhook (form submission) OR Gmail new email to peptide_inquiries@[domain]
2. **Email Parser** — Extract subject + body → `question` field
3. **Airtable FAQ Query** — Search FAQ database (table: "PROTOCOLS") for matching keywords
4. **Claude Matcher** — Haiku, prompt: "Does this answer (from FAQ) match the question? Score 1–10"
5. **Conditional Logic** — If score ≥ 8: proceed to auto-reply. If < 8: escalate
6. **Auto-Reply (High Confidence)** — Email template: "Thank you for your question. Here's what our research shows: {answer}. Book a consultation: {link}"
7. **Escalation Email (Low Confidence)** — TO: marc@cornerstoneregroup.ca, CC: luke@vitalis.ca, include original question + Claude analysis
8. **Airtable Logger** — Log all questions to "FAQ_LOG" table: question, answer_provided, confidence_score, date
9. **Auto-Reply Sender** — Email via Resend or Gmail

**Credential Map:**
- Gmail: oauth2 credential  
- Airtable: `appMLfA6AOTwuNbPS`
- Claude: `ZqJUVXLWLnmab503`
- Resend: `re_5kSu3TLG_FxxLKtLxQG81Mo91MpveCn1s`

**FAQ Database Structure:**
```
PROTOCOLS table:
- compound_name (string)
- typical_use_case (text)
- research_summary (text)
- common_questions (array)
- answer (text)
- sources (array of links)
```

**Compliance Rules:**
- Never provide medical advice
- Always use research language ("our research shows", "compounds have been studied")
- Never claim therapeutic effects
- Always include CTA: "Book a consultation for personalized guidance"
- Include relevant studies/sources

**Testing Protocol:**
1. Submit test FAQ question (e.g., "What is BPC-157 used for?")
2. Verify auto-reply triggers with correct answer
3. Submit edge-case question (not in FAQ)
4. Confirm escalation email goes to Marc
5. Check Airtable logging captured both
6. Verify compliance language in all replies

**Expected Cost:** ~$0.002/response (Claude classification)

**Sign-off:** 5 test questions (3 high-confidence FAQ, 2 edge cases)

---

### WORKFLOW 5: WEEKLY METRICS REPORT v2 (Sunday 6 PM)

**Status:** SPEC COMPLETE

**Objective:**  
Weekly financial + sales pipeline snapshot for Joseph (tax agent): revenue, expenses, categorization, pipeline stages, variance analysis.

**Nodes Required:**
1. **Trigger** — Cron schedule (Sunday 6:00 PM)
2. **Stripe Revenue Pull** — Fetch transactions from past 7 days (current week vs. previous week)
3. **Airtable Expense Sum** — Query "EXPENSES" table, sum by category (business | personal), group by type
4. **GHL Pipeline Count** — Count contacts by stage: leads | qualified | negotiating | closed (this week only)
5. **Claude Summary** — Sonnet, prompt: "Write a 4-line executive summary of revenue, expenses, and pipeline movement vs. last week"
6. **KPI Dashboard Link** — Generate URL to Notion/Airtable dashboard (or static HTML)
7. **Email Builder** — Structured format:
   ```
   WEEKLY METRICS — Week of [date]
   
   💰 REVENUE  
   This week: $X
   Last week: $Y  
   Variance: +/-Z%
   
   💸 EXPENSES
   Business: $X
   Personal: $Y
   
   📈 PIPELINE
   New Leads: [n]
   Qualified: [n]
   In Negotiation: [n]
   Closed: [n]
   
   📊 SUMMARY
   [Claude 4-liner]
   
   Dashboard: [link]
   ```
8. **Email Send** — To marc@cornerstoneregroup.ca + joseph@[tax_firm].ca (Joseph)
9. **Airtable Logger** — Append to "WEEKLY_METRICS_HISTORY" table for trend tracking

**Credential Map:**
- Stripe: Live keys (sk_live_...)
- Airtable: `appMLfA6AOTwuNbPS`
- GHL: `pit-9d8151f8-6e4a-44bd-bd01-2ffc069549ec`
- Claude: `ZqJUVXLWLnmab503` (Sonnet)
- Email: transactional

**Tax Categorization:**
```
Business Expenses:
- Software subscriptions
- Client acquisition
- Professional development
- Marketing

Personal Expenses:
- Food, transportation (non-business)
- Personal subscriptions
```

**Testing Protocol:**
1. Trigger manually
2. Verify Stripe pulls correct week's transactions
3. Check Airtable expense sum accuracy
4. Confirm GHL pipeline counts match reality
5. Validate Claude summary is clear and actionable
6. Ensure Joseph receives email with all metrics
7. Verify dashboard link is functional

**Expected Cost:** ~$0.015/run (Sonnet summary)

**Sign-off:** One full weekly cycle with Joseph approval

---

### WORKFLOW 6: SOCIAL MEDIA VIDEO PROMOTER v2 (Webhook Trigger)

**Status:** SPEC COMPLETE

**Objective:**  
When a new YouTube video or HeyGen clip is available, auto-generate platform-specific promotional posts (LinkedIn article, Instagram carousel, Twitter thread) and queue to Buffer.

**Nodes Required:**
1. **Trigger** — Webhook (form: video_url, title, description, duration)  
   OR YouTube channel monitoring (if using YouTube Data API)
2. **Video Metadata Fetch** — Extract title, description, duration, thumbnail from YouTube API
3. **Claude Platform Posts (3 parallel)** — Haiku, one per platform:
   - **LinkedIn:** "Write a professional article-format LinkedIn post (500 chars max) that positions Marc as RE authority. Hook + value statement + call-to-action"
   - **Instagram:** "Write Instagram carousel post (120 chars per slide, 5 slides max). Hook + key takeaways + CTA. Include hashtags."
   - **Twitter:** "Write 3 related tweets for a thread about {video_topic}. Use engagement language, ask questions."
4. **Unsplash Image** — Fetch thematic image to accompany posts
5. **Buffer Queue (3 parallel)** — POST each platform variant to Buffer with optimal timing:
   - LinkedIn: Wed/Thu 8–10 AM
   - Instagram: Wed 6 PM
   - Twitter: Thu 10 AM
6. **Email Confirmation** — Send draft posts to Marc for approval before publishing
7. **Airtable Logger** — Log video, platforms, posts, publish dates

**Credential Map:**
- YouTube Data API: `AIzaSyB-WSvIE9QCtaaONrkqbQosuynciRHA_xw`
- Claude: `ZqJUVXLWLnmab503` (Haiku)
- Unsplash: `jiGexAI9ksmM-MyLuECVfHYpymWaDJAKzi5LcWSinpw`
- Buffer: Bearer `laVsoqGxOvESso1w4dHbLK_thtEJ0p_c-il1vFNMoYo`
- Airtable: `appMLfA6AOTwuNbPS`
- Email: transactional

**Output Format:**
```
VIDEO PROMOTION PACKAGE

Title: [video title]  
Link: [YouTube URL]  
Duration: [min:sec]

---
LINKEDIN (Article Format)
[LinkedIn post text]
[Image + Link]

---
INSTAGRAM (Carousel)
Slide 1: [text]  
Slide 2: [text]  
... × 5 slides
[Image + Hashtags]

---
TWITTER (Thread)
Tweet 1: [text]  
Tweet 2: [text]  
Tweet 3: [text]

---
SCHEDULE:
LinkedIn: Wed 8 AM  
Instagram: Wed 6 PM  
Twitter: Thu 10 AM  

Awaiting your approval to publish → Buffer ✅
```

**Testing Protocol:**
1. Submit test video: recent YouTube upload or HeyGen sample
2. Verify metadata fetches correctly
3. Check all 3 platform posts are unique and platform-native
4. Confirm Unsplash image is thematic
5. Verify Buffer queue shows pending posts
6. Confirm approval email is sent
7. Approve and verify posts queue successfully

**Expected Cost:** ~$0.008/video (Haiku × 3 platforms + Unsplash)

**Sign-off:** One complete video → 3 platforms → Buffer cycle

---

## PHASE 2B: NEW BUILDS (8 High-Priority Workflows)

### WORKFLOW 7: LINKEDIN LEAD FINDER (Daily, Morning)

**Status:** SPEC COMPLETE

**Objective:**  
Daily automated LinkedIn search for RE investors and business owners matching Marc's ICP (Ideal Customer Profile). Create GHL contacts auto-tagged for SOLOMON qualification.

**Nodes Required:**
1. **Trigger** — Cron schedule (6:30 AM daily)
2. **LinkedIn Search (via Perplexity)** — Use sonar to query: "Ottawa real estate investors + business owners + recent job changes", parse results for: name, company, headline, profile_url
3. **Data Parser** — Extract: first_name, last_name, company, title, location, LinkedIn_profile_url
4. **GHL Contact Creator** — POST new contacts with fields: name, company, location, linkedin_url, source="LinkedIn_Lead_Finder"
5. **Auto-Tagging** — Apply tags: "SOLOMON_QUEUE" + vertical (RE | Insurance | Other)
6. **Duplicate Check** — Query existing GHL contacts before creating to avoid dupes
7. **Airtable Logger** — Log searches: date, query_used, results_count, contacts_created

**Credential Map:**
- Perplexity: `TvioB7giRzeBL4Dd`
- GHL: `pit-9d8151f8-6e4a-44bd-bd01-2ffc069549ec` OR `pit-bdd3d03b-3bbe-45cc-8577-d8de5f63cba2`
- Airtable: `appMLfA6AOTwuNbPS`

**Search Queries (Rotated Daily):**
```
Day 1: "Ottawa" + "real estate investor" + "commercial property"  
Day 2: "Ottawa" + "business owner" + "investment portfolio"
Day 3: "Ottawa" + "commercial real estate" + "financing"
Day 4: "Ontario" + "real estate" + "investor" + "portfolio"
Day 5: "Ottawa" + "insurance agent" OR "financial advisor"
```

**Testing Protocol:**
1. Trigger manually
2. Verify Perplexity returns relevant results
3. Check GHL contacts are created with all fields
4. Validate duplicate detection works (create twice, verify no dupes)
5. Confirm tags applied correctly
6. Check Airtable log

**Expected Cost:** ~$0.005/run

**Sign-off:** One full search cycle with lead verification

---

### WORKFLOW 8: LEAD ENRICHER (On GHL Contact Creation Trigger)

**Status:** SPEC COMPLETE

**Objective:**  
When a new GHL contact is created, enrich with LinkedIn data (job history, funding, activity), score (hot/warm/cold), and feed to SOLOMON.

**Nodes Required:**
1. **Trigger** — GHL webhook on contact.created
2. **Fetch GHL Contact** — Get full contact data: name, company, email, linkedin_url
3. **LinkedIn Profile Lookup** — Query Perplexity/LinkedIn API: recent job changes, company funding, recent posts
4. **Company Funding Check** — If company is funded, include: round, amount, date
5. **Activity Score** — Perplexity: "Does this contact's recent LinkedIn activity suggest high intent to buy? 1–10"
6. **Claude Scoring** — Haiku, prompt: "Score this lead as hot (8–10) | warm (4–7) | cold (1–3). Criteria: company size, title, recent activity, funding"
7. **GHL Field Update** — Write to custom fields: linkedin_company, funding_status, activity_score, lead_score, recommendation
8. **SOLOMON Queue** — If score ≥ 7, trigger SOLOMON qualification workflow

**Credential Map:**
- GHL: `pit-9d8151f8-6e4a-44bd-bd01-2ffc069549ec`
- Perplexity: `TvioB7giRzeBL4Dd`
- Claude: `ZqJUVXLWLnmab503`

**Scoring Rubric:**
```
HOT (8–10):
- Exec/decision-maker title (CEO, VP, Owner)
- Company size 10–500 employees
- Recent job change (< 6 months)  
- Funded company OR active deal signals
- Engagement on LinkedIn (posts, comments, this month)

WARM (4–7):
- Manager/Sr. Manager title
- Company size 5–100
- Job stability 1–3 years
- Some funding OR growth signals
- Monthly LinkedIn activity

COLD (1–3):
- Individual contributor OR inactive title
- No recent profile updates
- No engagement signals
- Micro companies or inactive
```

**Testing Protocol:**
1. Create test GHL contact manually
2. Trigger enrichment workflow
3. Verify LinkedIn data pulls correctly
4. Check Claude scoring is reasonable
5. Validate GHL fields updated
6. If score ≥ 7, confirm SOLOMON queue trigger fires

**Expected Cost:** ~$0.008/contact

**Sign-off:** 3 test contacts enriched (1 hot, 1 warm, 1 cold)

---

### WORKFLOW 9: MONTHLY COMPETITOR REPORT (1st of Month, 8 AM)

**Status:** SPEC COMPLETE

**Objective:**  
Monthly competitive intelligence: monitor Ottawa RE firms + Primerica competitors' LinkedIn activity, website changes, pricing updates. Synthesize into actionable insights.

**Nodes Required:**
1. **Trigger** — Cron schedule (1st of each month, 8:00 AM)
2. **Competitor List Load** — Airtable table "COMPETITORS" with: company_name, linkedin_url, website_url, competitor_type (RE | Insurance)
3. **LinkedIn Activity Fetch** — Perplexity: "What have [competitor_names] posted in the last 30 days? Summarize their content strategy, messaging, deals closed"
4. **Website Scrape** — Fetch competitor websites: pricing page, recent case studies, about page, messaging
5. **Claude Synthesis** — Sonnet, prompt: "Analyze competitor activity: positioning changes, messaging shifts, tactics. What's working for them? Where's the gap? What should Marc do differently?"
6. **Markdown Report** — Format:
   ```
   COMPETITIVE INTELLIGENCE — [Month]
   
   COMPETITOR A
   Recent posts: [summary]  
   Messaging trend: [key shift]  
   Tactics: [what's working]  
   
   COMPETITOR B  
   [same structure]
   
   GAPS & OPPORTUNITIES  
   - [gap 1]
   - [gap 2]
   - [gap 3]
   
   RECOMMENDED ACTIONS FOR MARC
   1. [action 1]  
   2. [action 2]
   3. [action 3]
   ```
7. **Email Send** — To marc@cornerstoneregroup.ca

**Credential Map:**
- Perplexity: `TvioB7giRzeBL4Dd`
- Claude: `ZqJUVXLWLnmab503` (Sonnet)
- Airtable: `appMLfA6AOTwuNbPS`

**Testing Protocol:**
1. Manually populate COMPETITORS table with 2–3 real competitors
2. Trigger workflow
3. Verify Perplexity returns recent posts
4. Check website scrape pulls correct pages
5. Validate Claude synthesis is strategic + actionable
6. Confirm email sent with full report

**Expected Cost:** ~$0.02/run (Sonnet synthesis)

**Sign-off:** One complete monthly report

---

### WORKFLOW 10: LINKEDIN ENGAGEMENT TRACKER (Weekly, Monday)

**Status:** SPEC COMPLETE

**Objective:**  
Weekly engagement analytics on Apollos' recent posts. Extract metrics, identify trends, recommend next week's content angles.

**Nodes Required:**
1. **Trigger** — Cron schedule (Monday 10:00 AM)
2. **LinkedIn Analytics API** — Fetch last 7 days of posts from Apollos profile: title, reach, engagement_rate, saves, comments, shares
3. **Data Aggregation** — Calculate: total_reach, avg_engagement_rate, top_post, weakest_post
4. **Trend Analysis** — Haiku: "What topics/formats drove highest engagement? What underperformed?"
5. **Airtable Logger** — Append row to "APOLLOS_ENGAGEMENT_HISTORY": date, post_count, avg_reach, top_post_title, trends
6. **Email Report** — Format:
   ```
   APOLLOS ENGAGEMENT — Week of [date]
   
   📊 METRICS  
   Total reach: [n]  
   Avg engagement rate: [%]
   Top post: [title] ([engagement]%)
   Weakest post: [title] ([engagement]%)
   
   🎯 TRENDS  
   - [Trend 1: high performing]
   - [Trend 2: low performing]
   
   💡 RECOMMENDATIONS FOR NEXT WEEK  
   1. Double down on: [topic]
   2. Test: [new angle]
   3. Reduce: [underperforming format]
   
   Dashboard: [Airtable URL]
   ```
7. **Email Send** — To apollos_agent+strategy@openai.com (or internal Telegram)

**Credential Map:**
- LinkedIn: oauth2 credential
- Claude: `ZqJUVXLWLnmab503` (Haiku)
- Airtable: `appMLfA6AOTwuNbPS`

**Testing Protocol:**
1. Trigger manually
2. Verify LinkedIn API returns accurate post metrics
3. Check Airtable row logged with all fields
4. Validate trend analysis is specific + actionable
5. Confirm email sent with recommendations

**Expected Cost:** ~$0.002/run

**Sign-off:** One week of engagement tracking

---

### WORKFLOW 11: AI SALES COACH (Vapi Call Completed Trigger)

**Status:** SPEC COMPLETE

**Objective:**  
After Solomon completes a Vapi AI sales call, analyze the recording + transcript. Provide coaching feedback to Solomon: what went well, what to improve, exact phrasing for next call.

**Nodes Required:**
1. **Trigger** — Webhook from Vapi on call.completed
2. **Fetch Vapi Call Data** — Get call_id, transcript, recording_url, duration, call_status
3. **Transcript Analysis** — Sonnet, prompt: "Analyze this sales call transcript. Provide detailed coaching:
   - What went well (specific moments, phrasing)
   - What to improve (missed opportunities, objection handling)
   - Exact script for next similar situation"
4. **GHL Contact Update** — Find contact by caller_phone, append coaching feedback to contact notes
5. **Email Coaching Report** — Format:
   ```
   SALES CALL COACHING — [Prospect Name]
   
   ✅ WHAT WENT WELL
   - [Moment 1]: "[exact quote from transcript]" — This is strong because...
   - [Moment 2]: [feedback]
   
   🎯 WHAT TO IMPROVE  
   - [Issue 1]: Instead of saying "...", try saying "..."
   - [Issue 2]: [feedback]
   
   📝 SCRIPT FOR NEXT TIME  
   If prospect says "[objection]", respond with:
   "[exact script]"
   
   Recording: [link]  
   Transcript: [link]
   ```
6. **Email Send** — To solomon_agent@domain (or marc for review)

**Credential Map:**
- Vapi: `37cde1f7-a419-46c5-be4d-b81cb1c88fc7` (private API key)
- Claude: `ZqJUVXLWLnmab503` (Sonnet)
- GHL: `pit-9d8151f8-6e4a-44bd-bd01-2ffc069549ec`

**Testing Protocol:**
1. Simulate Vapi call completion via webhook
2. Verify transcript fetches correctly
3. Check Claude coaching analysis is detailed + actionable
4. Validate GHL contact notes updated
5. Confirm email sent with exact scripts
6. Review for compliance + no off-brand language

**Expected Cost:** ~$0.012/call (Sonnet analysis)

**Sign-off:** One complete call analysis

---

### WORKFLOW 12: WEEKLY LINKEDIN COMPETITIVE CONTENT ANALYSIS (Friday 4 PM)

**Status:** SPEC COMPLETE

**Objective:**  
Weekly analysis of top-performing LinkedIn posts from RE thought leaders and insurance creators. Identify trends + suggest content angles for next week.

**Nodes Required:**
1. **Trigger** — Cron schedule (Friday 4:00 PM)
2. **LinkedIn Influencer List** — Airtable "INFLUENCERS" table with RE + insurance creators  
   (e.g., 25+ contacts)
3. **Fetch Top Posts (Last 7 Days)** — For each influencer, get their top 3 posts by engagement_rate
4. **Content Classification** — Parse: content_type (article | carousel | video | text), topic, engagement_rate
5. **Trend Aggregation** — Haiku: "Across all top posts, what 3–5 content angles are trending? What's resonating with HNW audience?"
6. **Pattern Detection** — Identify: most common topics, best-performing formats, emerging angles
7. **Email Report** — Format:
   ```
   COMPETITIVE CONTENT ANALYSIS — Week of [date]
   
   🔥 TOP TRENDS  
   1. [Trend 1]: [# posts] on this topic, avg engagement [%]
   2. [Trend 2]: [details]
   3. [Trend 3]: [details]
   
   📋 FORMAT BREAKDOWN  
   Articles: [# posts], avg engagement [%]  
   Carousels: [# posts], avg engagement [%]
   Videos: [# posts], avg engagement [%]
   
   💡 RECOMMENDED CONTENT FOR NEXT WEEK  
   1. Write about: [angle 1] (trending, high intent)
   2. Repurpose: [angle 2] in carousel format  
   3. Test: [angle 3] with video format
   
   Top performing post: "[title]" by [author]  
   Engagement rate: [%]
   
   Analysis: [brief strategy note]
   ```
8. **Email Send** — To apollos_strategy@internal

**Credential Map:**
- LinkedIn: oauth2 credential
- Claude: `ZqJUVXLWLnmab503` (Haiku)
- Airtable: `appMLfA6AOTwuNbPS`

**Testing Protocol:**
1. Populate INFLUENCERS table with 5–10 real LinkedIn profiles
2. Trigger manually
3. Verify posts fetch correctly + engagement rates accurate
4. Check trend analysis identifies real patterns (e.g., "real estate crisis" if trending)
5. Validate content suggestions are specific + actionable
6. Confirm email sent with full analysis

**Expected Cost:** ~$0.004/run

**Sign-off:** One week of trend analysis

---

### WORKFLOW 13: CREATE HYPER-PERSONALIZED SALES SCRIPTS (GHL Form Submission Trigger)

**Status:** SPEC COMPLETE

**Objective:**  
When a high-intent lead (from Lead Enricher = score ≥ 8) submits a form, auto-generate a personalized 3-point sales script based on enriched prospect data. Email to Solomon.

**Nodes Required:**
1. **Trigger** — GHL webhook on form_submission (high-intent lead form)
2. **Check Lead Score** — Fetch enriched lead data from GHL, confirm score ≥ 8
3. **Fetch Prospect Data** — Pull: company_name, industry, funding_status, recent_activity, pain_points (if logged)
4. **Claude Script Generation** — Sonnet, prompt: "Generate a personalized 3-point sales script for Solomon to pitch Marc's [RE | Insurance] services to [prospect_name] at [company]. 
   - Point 1 (Credibility): Marc's expertise in [prospect's vertical]
   - Point 2 (Pain Point): Address [specific pain point] that [prospect's company] likely faces
   - Point 3 (CTA): Clear next step (discovery call, proposal review)
   
   Tone: Direct, consultative, not salesy. Incorporate specific details about their company/recent activity."
5. **Email Script Report** — Format:
   ```
   PERSONALIZED SALES SCRIPT — [Prospect Name]
   
   PROSPECT PROFILE  
   Name: [name]  
   Company: [company]  
   Title: [title]
   Industry: [industry]  
   Recent signal: [activity]
   Lead score: [score/10]
   
   3-POINT SCRIPT  
   1. CREDIBILITY HOOK  
   "[Script for point 1]"
   
   2. PAIN POINT BRIDGE  
   "[Script for point 2]"
   
   3. CALL TO ACTION  
   "[Script for point 3]"
   
   ---
   TALKING POINTS  
   - [Point 1]
   - [Point 2]
   - [Point 3]
   
   OBJECTION HANDLERS  
   If prospect says "...", respond: "..."
   If prospect says "...", respond: "..."
   ```
6. **GHL Notes Update** — Append script to contact notes
7. **Email Send** — To solomon_agent@domain (or Telegram notification)

**Credential Map:**
- GHL: `pit-9d8151f8-6e4a-44bd-bd01-2ffc069549ec`
- Claude: `ZqJUVXLWLnmab503` (Sonnet)

**Testing Protocol:**
1. Create test form submission with high-intent prospect
2. Verify Lead Score check blocks low-intent (< 8)
3. Confirm Sonnet generates personalized script (not generic)
4. Check script includes company-specific details + recent activity
5. Validate GHL notes updated + email sent
6. Review for compliance + on-brand voice

**Expected Cost:** ~$0.010/script

**Sign-off:** 2–3 personalized scripts generated

---

### WORKFLOW 14: AUTO RESPONDER FOR EMAIL (Iron Ministry Email Trigger)

**Status:** SPEC COMPLETE

**Objective:**  
When an email arrives at sales@ironministry.ca, auto-respond with template if it's a common apparel question. Escalate non-template questions to Marc/Luke.

**Nodes Required:**
1. **Trigger** — Gmail new email to sales@ironministry.ca
2. **Email Parser** — Extract subject + body → `question` field
3. **Keyword Matching** — Check against template library:
   - Sizing/fit questions → SIZE_CHART template
   - Shipping/delivery questions → SHIPPING template  
   - Bulk orders → BULK_ORDER template
   - Returns/refunds → RETURNS template
   - Custom designs → CUSTOM_DESIGN template
4. **Template Lookup** — If keyword match (confidence > 75%), retrieve template from Airtable "IRON_MINISTRY_TEMPLATES" table
5. **Conditional Response**:
   - **High confidence (> 75%)**: Auto-reply with template + CTA "Contact us for custom orders"
   - **Low confidence (< 75%)**: Escalate to Marc
6. **Auto-Reply Sender** — Email via Resend/Gmail
7. **Airtable Logger** — Log all questions: email, subject, category, response_type, date

**Credential Map:**
- Gmail: oauth2 credential
- Airtable: `appMLfA6AOTwuNbPS`
- Resend: `re_5kSu3TLG_FxxLKtLxQG81Mo91MpveCn1s`
- Claude: `ZqJUVXLWLnmab503` (Haiku for keyword matching)

**Template Library (Airtable):**
```
IRON_MINISTRY_TEMPLATES table:
- template_name (string): "SIZE_CHART", "SHIPPING", etc.
- keywords (array): ["What size", "How do I measure", "Which fit"]
- response_body (text): Full email template
- cta (text): Call-to-action button text + link
```

**Example Templates:**
```
SIZE_CHART:
"Thanks for your interest! Here's our sizing guide: [link to image].
Most customers find [XL | Large] fits best for [athletic use].
Questions? Reply to this email or contact luke@ironministry.ca"

SHIPPING:
"We ship all orders within 2 business days via [carrier].
Standard shipping: 5–7 days  
Expedited: 2–3 days (+ $15)
Track your order: [link]"
```

**Testing Protocol:**
1. Send test email: "What size should I order for [athletic activity]?"
   - Expect: Auto-reply with SIZE_CHART template
2. Send test email: "Can I get custom designs for a team?"
   - Expect: Escalation to Marc (high-value inquiry)
3. Send test email: "Do you ship internationally?"
   - Expect: Escalation (not in template library)
4. Verify Airtable logs all 3 questions with correct categories
5. Confirm auto-replies use brand voice + correct CTA

**Expected Cost:** ~$0.001/email (minimal Claude for keyword matching)

**Sign-off:** 5–10 test emails (mix of template + non-template)

---

## BUILD SUMMARY & STATUS

| # | Workflow | Phase | Status | Tested | Ready for Git | Notes |
|---|---|---|---|---|---|---|
| 1 | APOLLOS DAILY v2 | 2A | SPEC | ⏳ | ⏳ | Building in UI |
| 2 | DANIEL RESEARCH v2 | 2A | SPEC | ⏳ | ⏳ | Pending |
| 3 | EZRA MORNING BRIEFING v2 | 2A | SPEC | ⏳ | ⏳ | Pending |
| 4 | FAQ AUTORESPONDER v2 | 2A | SPEC | ⏳ | ⏳ | Pending |
| 5 | WEEKLY METRICS REPORT v2 | 2A | SPEC | ⏳ | ⏳ | Pending |
| 6 | SOCIAL MEDIA VIDEO PROMOTER v2 | 2A | SPEC | ⏳ | ⏳ | Pending |
| 7 | LINKEDIN LEAD FINDER | 2B | SPEC | — | — | Queue |
| 8 | LEAD ENRICHER | 2B | SPEC | — | — | Queue |
| 9 | MONTHLY COMPETITOR REPORT | 2B | SPEC | — | — | Queue |
| 10 | LINKEDIN ENGAGEMENT TRACKER | 2B | SPEC | — | — | Queue |
| 11 | AI SALES COACH | 2B | SPEC | — | — | Queue |
| 12 | WEEKLY LINKEDIN COMPETITIVE ANALYSIS | 2B | SPEC | — | — | Queue |
| 13 | HYPER-PERSONALIZED SALES SCRIPTS | 2B | SPEC | — | — | Queue |
| 14 | AUTO RESPONDER FOR EMAIL | 2B | SPEC | — | — | Queue |

---

## NEXT STEPS (For Main Agent / Marc)

1. **PHASE 2A (Priority):**  
   - Review the 6 workflow specifications above
   - For each, I'll either build in n8n UI (time-permitting) or provide importable JSON
   - Once any 2-3 are built, test with live data
   - Marc approves, they go live

2. **PHASE 2B (After 2A):**  
   - Same pattern for workflows 7–14
   - Can be built in parallel if resources available

3. **Git Version Control:**  
   - Each workflow exported as `WORKFLOW_#_[NAME].json`
   - Stored in `/workspace/n8n-workflows-phase2/`
   - Committed with `[WORKFLOW] Built & Tested` message

4. **Known Blockers:**  
   - QuickBooks OAuth (Joseph) not yet authorized — blocks financial workflows
   - YouTube channel monitoring requires API setup — affects video promoter
   - LinkedIn API access tier (depends on business account status)

---

**Status Update:** All 14 workflows specified with full node lists, credential maps, testing protocols. Ready for either manual build-out or JSON import. Next: Execute builds + testing.

