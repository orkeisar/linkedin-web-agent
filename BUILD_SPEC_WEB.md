# LinkedIn Story Pipeline — Web Edition — Build Spec

A tool that turns a raw idea into a finished, on-voice LinkedIn post — a
zero-cost, zero-backend static site with no server, no shared database, and
no accounts. Or personalizes a link per person before sending it, setting
their content pillars and content strategy in advance, and the recipient
completes their own onboarding (their own Anthropic API key, their own
voice and writing style) after opening it. Once onboarded, the bot keeps
sharpening its understanding of that person's voice over time by comparing
every post it drafts against what they actually publish.

Build this end to end, one phase at a time. A working, deployed site is the
definition of done for each phase below — don't stop at a skeleton.

## Two roles, one static site

**Admin (Or).** Uses `admin.html` — a simple form, no AI involved. Sets the
content strategy for one specific person, generates a personalized link,
copies it, sends it. Nothing here is secret or sensitive; it's just a
link-generation tool.

**User (whoever Or sends the link to).** Opens their personalized link,
which lands on `index.html`. Completes their own onboarding (API key,
voice/style, role, ICP, etc.), then uses the idea pipeline going forward.
Their pillars start out as whatever Or set, but are editable afterward —
this stays dynamic, not locked in at send time.

## How personalization works without a backend

Or's per-person config (pillars, strategy) is encoded into the URL itself —
there's no server to store it on. `admin.html` builds a JSON object, base64-
encodes it, and appends it as a query param: `index.html?c=<encoded>`.

On first load, `index.html` reads `c`, decodes it, and writes it into that
browser's IndexedDB as the starting pillar set. It then strips the param
from the address bar (`history.replaceState`) so the URL doesn't stay
enormous and the config isn't re-processed on every reload — from that point
on, the app reads only from IndexedDB. If a config is missing or fails to
decode, the app falls back to an empty pillar set the user fills in
themselves during onboarding, rather than blocking them.

Practical note for the admin form: keep pillar descriptions and example
angles reasonably tight. A handful of pillars with a paragraph each will
comfortably fit in a URL, but some chat apps/email clients mangle very long
URLs — worth a soft length warning in `admin.html` if the encoded config
gets unusually large.

## Storage schema

**localStorage**
```
apiKey            — the user's own Anthropic API key
modelId           — defaults to "claude-sonnet-5", editable in Settings
```

**IndexedDB — `pillars` (set by Or via the link, editable by the user after)**
```js
{
  recipientName: string,           // optional, for a personalized onboarding greeting
  contentStrategyNotes: string,    // free text, Or's overall direction for this person
  pillars: [
    {
      name: string,
      description: string,
      exampleAngles: string[],     // sample post ideas/angles for this pillar
      funnelGoal: "TOFU" | "MOFU" | "BOFU"
    }
  ]
}
```
`funnelGoal` shapes what the agent proposes at the Proposing stage — TOFU
angles aim for awareness/resonance with a soft or no CTA, MOFU for
engagement/consideration with a discussion-inviting CTA, BOFU for direct
conversion with an explicit ask (follow, DM, link click). Bake this mapping
into the system prompt as guidance, not a rigid template.

**IndexedDB — `voiceProfile` (single record, built during onboarding)**
```js
{
  role: string,                    // the user's job/role, for context
  audience: string,                // ICP
  goals: string,
  toneRules: string[],
  structuralPatterns: string,
  hashtagsEmojiPolicy: string,
  forbiddenPhrases: string[],
  avoidedPostTypes: string[],
  admiredExamples: string[],       // posts/accounts they admire, as reference
  rawExamples: string[],           // writing samples pasted at onboarding — posts or any other writing; optional, can be empty
  createdAt, updatedAt
}
```

**IndexedDB — `learnedGuidelines` (grows over time, editable/removable by the user)**
```js
[
  {
    id,
    description: string,           // the pattern noticed, e.g. "removes rhetorical questions from hooks"
    evidence: { draftExcerpt, postedExcerpt },
    dateAdded,
  }
]
```

**IndexedDB — `ideas` (one record per idea)**
```js
{
  id, title, rawNote, dateAdded,
  status: "Inbox" | "Interviewing" | "Proposing" | "Drafting" | "Ready to Post" | "Posted",
  pillar, funnelGoal, storyShape,
  hookOptions, chosenAngle,
  angleSource: "Agent-proposed" | "User-supplied" | "User-corrected",
  cta, draft,
  postedText,                      // what was actually published, if different from draft
  conversationHistory: [{ role, content }],
  datePosted
}
```

## Onboarding flow (Stage B, on the user's first load)

1. **Pillars review** — show the pillars Or set (pre-filled from the URL
   config), editable inline. User confirms or adjusts before continuing.
2. **API key** — paste key, test connection, save to localStorage. (Same
   mechanic as the original Phase 1 design.)
3. **Writing samples** — paste writing samples, explicitly framed as *any*
   writing, not just LinkedIn posts — the goal is tone and style, not post
   structure. Skippable; zero examples is a fully supported path, since the
   bot also learns from future posts.
4. **Guided conversation** — back-and-forth chat, not a static form,
   covering: role, ICP, phrases to avoid, types of posts to avoid, posts or
   accounts they admire. The agent asks follow-ups based on what's said
   rather than firing a fixed question list.
5. **Editable summary** — synthesizes steps 2-4 into the `voiceProfile`
   record, shown fully editable before saving. Nothing saves silently.

After this, the user lands on the idea board. Pillars, voice profile, and
(once it exists) learned guidelines are all reachable and editable from
Settings going forward — none of this is locked in after onboarding.

## Idea pipeline / state machine

Six stages, run per-idea on a kanban board rather than a single chat
thread — so multiple ideas can be in flight at once:

1. **Inbox** — "+ New idea," raw note captured.
2. **Interviewing** — only if the note is thin; skipped for a full story.
3. **Proposing** — agent proposes pillar, funnel goal (inherited from the
   chosen pillar), story shape, hook options, and an angle shaped by that
   funnel goal — unless the user already supplied one. `angleSource` tagged
   as `Agent-proposed`, `User-supplied`, or `User-corrected`.
4. **Drafting** — full post written using: the base voice profile, the
   chosen pillar's funnel goal, the growing `learnedGuidelines` list, and
   live few-shot examples pulled fresh from every `Posted` idea's `draft`.
   Revision loop is plain-language chat in the same panel.
5. **Ready to Post** — final text shown with copy-to-clipboard.
6. **Posted** — this is where the learning loop kicks in (below).

## How the drafting system prompt is assembled

Every Drafting-stage call layers four sources of guidance, in this order of
precedence — later layers override earlier ones where they conflict:

1. **Generic LinkedIn best practices** — a static baseline (hook
   conventions, structure, length, formatting, hashtag/emoji norms, native
   vs. external-link considerations). This lives in
   `linkedin-best-practices.md`, a static file in the repo that `draft.js`
   fetches at runtime and includes as the floor everyone starts from.
2. **This person's voice profile** — tone rules, structural patterns,
   forbidden phrases, avoided post types. Explicitly overrides the generic
   baseline wherever they conflict (e.g. if the baseline says "hashtags
   help reach" but the voice profile says "no hashtags," the voice profile
   wins).
3. **The chosen pillar's funnel goal** — shapes angle and CTA direction
   (TOFU/MOFU/BOFU, as described above) within whatever the voice profile
   already allows.
4. **`learnedGuidelines`** — the most specific and most recent layer;
   concrete, evolving patterns this person's actual posting behavior has
   revealed, which take priority over general voice-profile assumptions
   where they'd otherwise disagree.

Few-shot examples from `Posted` drafts are injected separately, alongside
this layered instruction stack, not as a substitute for it — they show what
"good" looks like, the layers above explain why.

## The dynamic learning loop

This is what keeps the bot's understanding of the user's voice improving
after onboarding instead of staying fixed. Marking an idea Posted asks:
*"Paste what you actually posted, or confirm it went out as drafted."*

- **Posted as-is** — no further action. (Optionally worth quietly counting
  these as a positive signal that the draft nailed it, but no insight
  extraction needed since there's nothing to compare.)
- **Pasted a different final version** — run a cheap local diff first
  (string comparison) purely to check whether the change is substantive
  enough to be worth an API call. If it is, one Claude call compares
  `draft` vs `postedText`, extracts specific, concrete patterns (not vague
  restatements), and appends them to `learnedGuidelines`.

Every future Drafting-stage call injects `learnedGuidelines` into the
system prompt alongside the base voice profile and the few-shot `Posted`
examples — so the agent's understanding of how this specific person writes
keeps sharpening after every post, not just at onboarding. The list stays
visible and editable in Settings, same transparency principle as pillars
and the voice profile — if the bot infers something wrong, the user can
delete it.

## File layout

```
linkedin-web-agent/
  index.html            # user-facing app: onboarding, board, drafting, settings
  admin.html            # Or's link-generator tool
  styles.css
  app.js                 # bootstrap, view routing, first-load detection for index.html
  admin.js                # pillar/strategy form, link generation, for admin.html
  linkConfig.js           # shared encode/decode helpers used by both app.js and admin.js
  api.js                  # Anthropic fetch wrapper (direct browser access header, error handling)
  storage.js               # localStorage + IndexedDB wrapper (pillars, voiceProfile, learnedGuidelines, ideas)
  onboarding.js            # Stage B wizard/conversation + synthesis call
  pipeline.js              # idea state machine, kanban board rendering, IndexedDB CRUD
  draft.js                 # per-idea chat/drafting UI, revision loop, few-shot + learnedGuidelines injection
  learning.js               # local diff check + insight-extraction call, triggered from Mark Posted
  settings.js               # key management, pillar/profile/guideline editing, export/import, reset
  linkedin-best-practices.md  # static baseline drafting guidance, fetched at runtime by draft.js
  README.md
```

## Build phases

**Phase 1 — Scaffold, hosting, API key gate.** Static shell for
`index.html`, deployed and live on GitHub Pages. Paste-key + test-connection
flow, saved to localStorage. Nav shell in place, other views placeholders.

**Phase 2 — Admin link generator.** `admin.html`: form for recipient name,
content strategy notes, and a repeatable pillar block (name, description,
example angles, funnel goal). Encodes to a shareable URL via
`linkConfig.js`, with a copy button and a soft length warning if the config
is unusually large.

**Phase 3 — Onboarding (Stage B).** Reads the `c` param on first load,
seeds the `pillars` store, strips the URL. Implements the five-step flow
above: pillars review → API key → writing samples → guided conversation →
editable summary → save. Settings entry point to redo/edit any of it later
comes in Phase 7, but the wizard itself is fully built here.

**Phase 4 — Idea pipeline & board.** Kanban board backed by IndexedDB,
Inbox → Interviewing → Proposing with correct skip logic, angle-source
tagging, and pillar-driven funnel-goal shaping of proposed angles.

**Phase 5 — Drafting, revisions, few-shot library.** Full drafting and
revision loop, Ready to Post screen, live few-shot injection from prior
`Posted` drafts on every new Drafting call, and system prompt assembly
following the four-layer precedence order above (`linkedin-best-practices.md`
fetched at runtime as the base layer, overridden by voice profile, then
pillar funnel goal, then `learnedGuidelines`).

**Phase 6 — Dynamic learning loop.** Mark Posted flow (posted-as-is vs.
paste-final), local diff gate, insight-extraction call, `learnedGuidelines`
store, and injection of that store into every future Drafting call.

**Phase 7 — Settings, backup, polish.** Full editability of pillars, voice
profile, and learned guidelines from one place; API key management; JSON
export/import (profile + pillars + guidelines + ideas, never the key);
error handling audit across every API call; responsive pass; README for a
new user.

## Testing checklist before calling a phase done

- Opening a personalized link seeds pillars correctly; opening `index.html`
  with no config falls back to empty pillars instead of breaking.
- Onboarding produces an editable, savable profile even with zero pasted
  writing samples.
- Pillars, voice profile, and learned guidelines are all editable after
  onboarding, not just during it.
- A thin raw note triggers Interviewing; a detailed one skips it.
- `angleSource` is tagged correctly in all three cases, and proposed angles
  visibly differ in tone between a TOFU and a BOFU pillar.
- Multiple ideas can be in progress at once without cross-contaminating
  conversation history or drafts.
- Posting-as-is skips insight extraction; pasting a meaningfully different
  final version triggers the local diff, then the API call, and produces a
  concrete (not vague) entry in `learnedGuidelines`.
- A later Drafting call visibly reflects an existing `learnedGuidelines`
  entry (verifiable via the request payload in devtools).
- Export/import round-trips pillars, voice profile, learned guidelines, and
  ideas exactly, without ever including the API key in the exported file.
