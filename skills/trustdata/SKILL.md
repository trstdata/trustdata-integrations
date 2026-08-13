---
name: trustdata
description: Query TrustData marketing analytics over MCP. Load when answering questions about traffic, conversions, attribution, ad spend, SEO keywords, AI search visibility, alerts, or anomaly investigations against a TrustData account. Covers which tool answers which question, and how to read the numbers without misreporting them.
---

# TrustData

TrustData is a first-party marketing analytics platform. It reports traffic,
conversions, multi-touch attribution, paid performance, SEO rankings, and AI
search visibility for one organization at a time.

The server is the source of truth. This skill routes you to the right tool and
tells you how to read the result. It does not document tool arguments.

## Read this first

Call `get_query_instructions` before your first `query_metrics` call. It returns
the valid dimensions, the metrics each one supports, the query spec fields, and
the current limits. It is generated from the live registry, so it cannot go
stale. Call `list_analytics_queries` for the query types your token can reach.

Where this skill and the server disagree, the server is right. Tool names and
metric names change. Do not carry an argument shape from memory into a call.

Call `list_properties` first in any session. Every property-scoped tool needs a
property id, and an organization usually has several.

## Which tool answers which question

**Start here**
`list_properties` · `get_query_instructions` · `list_analytics_queries`

**Traffic, conversions, and spend**
- One dimension broken out over a date range: `query_metrics`
- One metric as a time series: `get_timeline`
- Multi-touch journeys and Sankey data: `get_attribution`
- Country breakdown: `get_geo`
- Cohort retention: `get_retention`
- Cumulative lifetime value: `get_ltv`

**AI search visibility**
- Visibility KPIs and keyword gaps: `get_geo_visibility`
- Prompts tracked for probing: `list_brand_prompts`
- Competitors tracked: `list_competitors`
- Domains LLMs cite that do not link back: `list_citation_gaps`

**SEO**
- Rankings joined with volume and difficulty: `list_seo_keywords`

**Alerts and anomalies**
- Open, acknowledged, or resolved alerts: `list_alerts`
- Acknowledge one: `acknowledge_alert`
- Resolve one: `resolve_alert`
- Anomaly investigations and their verdicts: `list_anomalies`
- One investigation in full: `get_investigation`
- Ask about the evidence already gathered: `ask_investigation`
- Request an extra data check: `ask_investigation_followup`
- Report whether a diagnosis was right: `submit_verdict`

**Recommendations and experiments**
- Open recommendations: `list_recommendations`
- Create one: `create_recommendation`
- Dismiss one: `dismiss_recommendation`
- Mark one followed: `mark_recommendation_done`
- Concluded experiments and their verdicts: `list_concluded_experiments`

**Account inventory**
- Connected ad platforms: `list_data_sources`
- Tracking stream ids: `list_attribution_ids`

**Change ledger**
- Known annotations: `list_change_events`
- Record a change you made: `create_change_event`

Two tools start with `get_geo` and mean different things. `get_geo` is
geography. `get_geo_visibility` is AI search visibility. Check which one the
question needs.

## Read the numbers correctly

### A breakdown does not sum to its KPI

Breakdown rows covering fewer than ten people are dropped. Remaining counts
round to the nearest ten. Money and ad-platform totals stay exact.

So the channel rows will not add up to the total sessions figure. This is
k-anonymity working, not a data defect. Report the KPI as the total. Do not
sum a breakdown and present the result as the truth. Do not tell the user
their data is broken.

### Dimensions do not reconcile against each other

Attribution is computed per dimension, independently. The channel breakdown and
the campaign breakdown each resolve last-non-direct-click on their own.

Two dimensions that disagree are expected. Do not cross-check one against
another and report the gap as an error.

### Ask before you compare windows

A 30-day window and a 31-day window are not comparable. Confirm the date ranges
match before you state a delta.

## Do not claim AI visibility caused revenue

AI search visibility and revenue are measured separately. Nothing in this
platform establishes that one caused the other.

State the correlation and name the limit:

> AI visibility rose 18% over the same period that attributed revenue rose 6%.
> These are measured separately. This data does not show that one caused the
> other.

Never write that AI visibility drove, delivered, or generated revenue. The same
rule covers GEO probes, citation gaps, and share of voice.

## Scopes

Every tool needs a scope on the API token. A missing scope returns an error
naming the scope. Tell the user which scope to add and where. Do not retry the
call.

## Limits

Read the current values from `get_query_instructions`. It reports the maximum
days per query, maximum rows, and one dimension per query. Do not assume a
limit from a previous session.
