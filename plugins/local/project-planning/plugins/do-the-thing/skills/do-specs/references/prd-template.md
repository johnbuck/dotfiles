# PRD Template

Use this template as the structure for all PRDs. Fill in each section based on discovery answers. Remove placeholder text but keep all headings. Mark sections that need human input with `[@humanUser description of what goes here]`.

## Writing Guidelines

- Write plainly and clearly
- Avoid flowery language or jargon
- Write as if you want to be understood, with a clear, casual tone
- Avoid overcomplication, clear and simple is what we want
- Avoid using Emdash characters
- Avoid altering the format of the document. Maintain the heading structure
- "The long version" should summarize at a high level and touch on the "why" - save detailed specs for Requirements section. Avoid bolded sub-headers in "The long version"
- Use "should" instead of "must" when writing requirements
- Use "interact" or "interaction" instead of "click" or "tap" when describing user actions (exception: standard terms like "click-through rate" are acceptable)
- Success metrics should identify what to measure, not prescriptive targets
- Exclude all llm-oriented instructions in the final output

---

```markdown
# 1. Summary
## 1.1 At a glance
Provide a one sentence summary of the feature/product that you're covering here. Keep it simple, short, conversational, and clear.

## 1.2 Table of Contents
[@humanUser Insert Table of Contents here after PRD is complete]

# 2. Overview of the Feature
## 2.1 What are we building?

**tl;dr:**
Here's a super short, max two sentence description of the feature/product, and an introduction into the "what."

**The long version**

1-2 paragraphs summarizing the feature at a high level and touching on the "why". Keep it concise - detailed specifications belong in the Requirements section. Avoid bolded sub-headers.

## 2.2 What problem are we solving for?
Here's a description of the primary user pain point, and the problem the feature solves for.

## 2.3 Why are we building this?

### 2.3.1 Business/market opportunity
*   Here's a description of the market opportunity of the feature.
*   Here's another bullet point for the business/market opportunity

### 2.3.2 Benefits to the user
*   Bulleted list of benefits to the user
*   Bulleted list of benefits to the user

# 3. Who is the target user?
## 3.1 Target user segment
Describe the primary user segment(s) for this feature/product.

## 3.2 Characteristics
Bulleted list of user characteristics per segment.

## 3.3 Needs + Goals
*   **Needs:** What the target user needs from this feature.
*   **Goals:** What the target user is trying to achieve.

# 4. Scope + Requirements
## 4.1 User Stories
Write one to two user stories maximum.
*   As a target user, I want to do a thing, so I can achieve a goal or complete a job to be done.
*   As a target user, I want to do a thing, so I can achieve a goal or complete a job to be done.

## 4.2 Use Cases
### Use Case 1: [Use Case Title Here]

**Actors:** [List of involved actors or systems]

**Preconditions:**
*   [Describe the required state or data that must exist before the use case begins]
*   [Additional setup or system conditions]

**Flow:**
1.  [Primary actor] performs an action.
2.  The system responds.
3.  Continue the flow.

**Postconditions:**
*   The expected end state after the use case completes.

## 4.3 End State Requirements
### 4.3.1 Non-Functional Requirements
Consider performance, scalability, response times, uptime, and other non-functional concerns.

### 4.3.2 Front End Requirements
#### High-Level Requirements
- [Frontend requirements here]

#### Gherkin Scenarios
Write minimum of three Gherkin scenarios. Consider all the requirements necessary for the feature or product.

Example format:
**Scenario: User completes primary action successfully**
GIVEN I am a [role] using [system/interface]
WHEN I perform [primary action] with all required data present
THEN the system [expected behavior]
AND I see [confirmation or feedback]
AND the [affected element] reflects my changes

### 4.3.3 Backend Requirements
#### High-Level Requirements
- [Backend requirements here]

#### Gherkin Scenarios
Write minimum of three Gherkin scenarios for backend requirements.

### 4.3.4 Content Requirements
- [Content Requirements here]

### 4.3.5 Security Requirements
- Authentication and authorization model
- Input validation and sanitization expectations
- Data encryption requirements (at rest, in transit)
- Secrets management approach
- Any compliance requirements (HIPAA, SOC2, GDPR, etc.)

### 4.3.6 SEO Requirements
[@humanUser Link SEO Requirements here if applicable]

## 4.5 Designs
[@humanUser Link designs here]

## 4.6 Scope

### 4.6.1 Iteration 1 (MVP)
- [Deliverable Requirement]
- [Deliverable Requirement]

### 4.6.2 Iteration X (future state/possible enhancements/unplanned)
- [Deliverable Requirement]
- [Deliverable Requirement]

### 4.6.3 Current Status
[@humanUser Insert status tracking here after PRD is complete]

# 5. SEO Recommendations
[@humanUser Link SEO Requirements here if applicable]

# 7. Dependencies + Integrations
## 7.1 Dependencies
This work is dependent on:
- Dependency
- Dependency

## 7.2 Integrations
Key integrations include:
- Integration
- Integration

# 8. Testing + UAT
## 8.1 Testing Requirements
Testing will cover both functional and non-functional aspects, including:

**Unit Testing:**
- [Critical logic and data transformations to cover]
- [Coverage expectations or philosophy]

**Integration Testing:**
- [API endpoint testing]
- [Database/storage round-trip validation]

**E2E Testing:**
- [Core user flows to validate end-to-end]
- [Browser/platform coverage]

**Code Quality:**
- [Linting and formatting enforcement]
- [Type checking requirements]

## 8.2 UAT Requirements
[@humanUser Define UAT acceptance criteria and test scenarios]

# 9. Key Stakeholders
- Stakeholder
- Stakeholder

# 10. Compliance
## 10.1 Legal

### Summary: What data is collected, processed, or shared?

| Data Type | Collected | Processed | Shared Externally |
| --- | --- | --- | --- |
| [Data type] | [Yes/No] | [Description] | [Yes/No] |

# 11. Goals and Success Metrics
## 11.1 What does a successful launch look like?
*   [What makes this launch successful?]

## 11.2 How will we measure that?
*   [How will we measure that?]

# 12. Documentation
## 12.1 Documentation Section Name
[@humanUser Documentation goes here]
```
