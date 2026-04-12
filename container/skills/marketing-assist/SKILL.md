---
name: marketing-assist
description: >
  Marketing content creation tool for Sanjay's products. Use this skill whenever someone asks
  to write a blog post, create marketing content, draft copy, or produce any marketing material
  for RecoCards.com or HostFavorite.com. Common triggers: "write a blog post", "marketing content",
  "draft a post about", "create content for reco", "create content for hostfavorite",
  "blog for recocards", "blog for hostfavorite", "marketing for reco", "marketing for hostfavorite".
---

# marketing-assist

Routes marketing content requests to the right **personality** (brand context) and **speciality** (content type). Every request needs both — a personality tells you *who* you're writing for, and a speciality tells you *what* you're writing.

## How It Works

```
┌──────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│  1. IDENTIFY      │ →  │  2. LOAD PERSONALITY  │ →  │  3. RUN SPECIALITY   │
│  (Brand + Type)   │    │  (Brand context)      │    │  (Content creation)  │
└──────────────────┘    └──────────────────────┘    └──────────────────────┘
```

---

### Step 1: Identify Brand and Content Type

Determine which **personality** and **speciality** to use based on the user's request.

**Personalities** (pick one):
| Brand | File | Triggers |
|-------|------|----------|
| RecoCards.com | [RECO-MARKETER.md](personalities/RECO-MARKETER.md) | "reco", "recocards", "recommendation cards" |
| HostFavorite.com | [HOSTFAVORITE-MARKETER.md](personalities/HOSTFAVORITE-MARKETER.md) | "hostfavorite", "host favorite", "airbnb", "vacation rental" |

**Specialities** (pick one):
| Content Type | File | Triggers |
|--------------|------|----------|
| Blog Post | [BLOG-POST-WRITER.md](specialities/BLOG-POST-WRITER.md) | "blog", "blog post", "article", "write a post" |

If the user doesn't specify a brand, ask which product they want content for. If the content type is ambiguous, default to blog post (the most common request).

---

### Step 2: Load Personality

Read the personality file for the chosen brand. This gives you:
- Brand voice and tone guidelines
- Target audience
- Product details and value propositions
- Key messaging and positioning
- Topics and themes to lean into
- Things to avoid

**You must read the personality file fresh for each request.** Brand positioning evolves over time.

---

### Step 3: Run Speciality

Read and follow the speciality file for the chosen content type. The speciality file contains:
- Content structure and format
- Writing process (research → outline → draft → polish)
- Quality standards
- Output format

Apply the personality context while following the speciality's process. The personality is *who you are*; the speciality is *how you work*.

---

## Adding New Personalities and Specialities

- **New personality:** Add a markdown file to `personalities/` with brand context, voice, audience, and messaging.
- **New speciality:** Add a markdown file to `specialities/` with the content creation process, structure, and quality standards.
- **Update this file** to add the new entry to the routing tables above.

## Important Notes

- Always read both the personality and speciality files fresh — don't rely on memory.
- Stay in the brand's voice throughout. If the personality says "conversational and friendly," don't write academic prose.
- Every piece of content should have a clear purpose and call to action aligned with the brand's goals.
- Ask the user for the topic/angle if they haven't provided one. Don't guess at what they want to write about.
