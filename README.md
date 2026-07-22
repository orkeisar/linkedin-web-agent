# LinkedIn Story Pipeline

A tool that turns a raw idea into a finished, on-voice LinkedIn post — and
keeps getting better at sounding like you, automatically, every time you
post. It's a zero-cost, zero-backend static site: no server, no shared
database, no accounts. Everything runs in your own browser.

Live at: **https://orkeisar.github.io/linkedin-web-agent/**

## If you were sent a personalized link

Open it. It's a normal-looking link that quietly carries a starting set of
content pillars (topics/angles someone set up for you) — the first thing
you'll see is a short setup flow:

1. **Review your pillars** — the topics pre-filled for you, fully editable.
2. **Connect your Anthropic API key** — see below for how to get one.
3. **Paste a few writing samples** (optional) — any writing, not just
   LinkedIn posts. Skippable entirely.
4. **A short conversation** with the agent about your role, audience, and
   what you do and don't want in your posts.
5. **Review and save** a summary of your voice — fully editable before
   anything is saved.

After that you land on a kanban board. Click **+ New idea**, jot down a
raw note, and the agent walks it through Interviewing (if it needs more
detail), Proposing an angle/hook/CTA, Drafting the full post, revisions,
and finally Posted — where it learns from anything you changed before
publishing, so every future draft sounds a little more like you.

Everything — pillars, your voice profile, learned patterns, every idea and
draft — is editable later from **Settings**, not just during setup.

### Getting an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign
   up or log in.
2. Add billing (usage is pay-as-you-go and, for this kind of use, cheap —
   typically cents per post).
3. Go to **API Keys** and create a new key.
4. Paste it into the app when asked. That's it.

### Your privacy

Your API key and everything you write — pillars, voice profile, writing
samples, ideas, drafts — is stored **only in your own browser**
(`localStorage`/`IndexedDB`) and sent **only directly from your browser to
Anthropic's API**. There is no server in between. The person who sent you
this link, and anyone else running this same site, has no way to see your
key or your data — it never leaves your device except to Anthropic
directly. Clearing your browser data or using **Settings → Reset all
data** deletes it completely and irreversibly.

## If you're sending someone a link

Open `admin.html` (**https://orkeisar.github.io/linkedin-web-agent/admin.html**).
Fill in their name (optional), your overall content strategy notes for
them, and one or more content pillars — each with a name, description,
example angles, and a funnel goal (TOFU/MOFU/BOFU, which shapes how
directly the agent pitches things for that pillar). Click **Generate
link**, copy it, send it. Nothing on this page is sensitive — it's just a
link-encoding tool, and the recipient can edit everything you set once
they open it.

## Settings

Reachable any time after onboarding, from the nav bar:

- **API key** — replace or clear the saved key.
- **Model** — switch which Claude model drafts your posts.
- **Pillars** — add, edit, or remove pillars and content strategy notes.
- **Voice profile** — edit role, audience, tone rules, forbidden phrases,
  and everything else captured during onboarding.
- **Learned guidelines** — the patterns the agent has picked up from
  comparing your drafts to what you actually posted. Add one manually, or
  delete anything it got wrong.
- **Backup** — export everything (pillars, voice profile, learned
  guidelines, ideas) as a JSON file. Your API key is **never** included in
  an export. Import restores from that file — works on a completely fresh
  browser too (there's also an "Import your backup" option right on the
  onboarding screen, so you don't have to fake your way through setup
  first).
- **Reset all data** — wipes everything in this browser. Can't be undone.

## Running locally

No build step. Serve the repo root with any static file server, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/index.html` (the user-facing app) or
`http://localhost:8000/admin.html` (the link generator).

## Deployment

Static hosting via GitHub Pages, serving directly from the repo root on
`main`. Pushing to `main` deploys automatically.

## Architecture

Full architecture, storage schema, onboarding flow, and phase-by-phase
build notes live in [BUILD_SPEC_WEB.md](BUILD_SPEC_WEB.md).
