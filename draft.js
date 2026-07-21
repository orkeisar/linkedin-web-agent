// Per-idea drafting chat/revision UI. Assembles the layered system prompt
// (best-practices baseline, voice profile, funnel goal -- learnedGuidelines
// slot reserved for Phase 6) plus live few-shot examples from Posted
// drafts, and owns the Drafting / Ready to Post / Posted panel views.

const Draft = (() => {
  // --- helpers ---

  function renderChatLogInto(containerId, history) {
    const log = document.getElementById(containerId);
    if (!log) return;
    log.innerHTML = "";
    history.forEach((turn) => {
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble chat-${turn.role}`;
      bubble.textContent = turn.content;
      log.appendChild(bubble);
    });
    log.scrollTop = log.scrollHeight;
  }

  // Same guard as pipeline.js's pushUserTurn: merges into a trailing user
  // turn instead of stacking a new one, so a request that got saved
  // optimistically but never received its assistant reply (a failed call)
  // can't leave conversationHistory ending on two consecutive user turns --
  // which would break the strict alternation runDraft's message replay
  // depends on.
  function pushUserTurn(idea, content) {
    const last = idea.conversationHistory[idea.conversationHistory.length - 1];
    if (last && last.role === "user") {
      last.content = `${last.content}\n\n${content}`;
    } else {
      idea.conversationHistory.push({ role: "user", content });
    }
  }

  function setDraftPanelBusy(busy) {
    const sendBtn = document.querySelector("#draft-chat-form button[type='submit']");
    const input = document.getElementById("draft-chat-input");
    const readyBtn = document.getElementById("draft-ready-btn");
    if (sendBtn) sendBtn.disabled = busy;
    if (input) input.disabled = busy;
    if (readyBtn) readyBtn.disabled = busy;
  }

  function cleanDraftText(text) {
    let cleaned = text.trim();
    cleaned = cleaned
      .replace(/^```(?:\w+)?\s*/, "")
      .replace(/```$/, "")
      .trim();
    if (cleaned.length > 1 && cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.slice(1, -1).trim();
    }
    return cleaned;
  }

  // --- system prompt assembly (the four-layer stack + few-shot) ---

  async function fetchBestPractices() {
    try {
      const response = await fetch("linkedin-best-practices.md");
      if (!response.ok) throw new Error(`status ${response.status}`);
      return await response.text();
    } catch (err) {
      return "(Could not load linkedin-best-practices.md — proceeding without the baseline layer.)";
    }
  }

  async function fetchFewShotExamples() {
    const ideas = await AppStorage.getIdeas();
    return ideas.filter((i) => i.status === "Posted" && i.draft).map((i) => i.draft);
  }

  function buildVoiceProfileLayer(voiceProfile) {
    return [
      `Role: ${voiceProfile.role || "(not specified)"}`,
      `Audience: ${voiceProfile.audience || "(not specified)"}`,
      `Goals: ${voiceProfile.goals || "(not specified)"}`,
      `Tone rules: ${(voiceProfile.toneRules || []).join("; ") || "(none)"}`,
      `Structural patterns: ${voiceProfile.structuralPatterns || "(none specified)"}`,
      `Hashtags/emoji policy: ${voiceProfile.hashtagsEmojiPolicy || "(not specified)"}`,
      `Forbidden phrases (never use these): ${(voiceProfile.forbiddenPhrases || []).join("; ") || "(none)"}`,
      `Avoided post types (never write these): ${(voiceProfile.avoidedPostTypes || []).join("; ") || "(none)"}`,
      `Admired examples (tone reference only, don't copy): ${(voiceProfile.admiredExamples || []).join("; ") || "(none)"}`,
    ].join("\n");
  }

  function buildFunnelGoalLayer(funnelGoal) {
    const guidance = {
      TOFU: "TOFU (awareness/resonance): a soft angle aimed at resonance and reach. Soft CTA, or none at all.",
      MOFU: "MOFU (engagement/consideration): angle and CTA should invite discussion and consideration.",
      BOFU: "BOFU (direct conversion): a more direct angle, an explicit CTA (follow, DM, click a link).",
    };
    return guidance[funnelGoal] || `Funnel goal: ${funnelGoal || "(not set)"}`;
  }

  async function buildDraftingSystemPrompt(idea) {
    const [bestPractices, voiceProfile, fewShotExamples] = await Promise.all([
      fetchBestPractices(),
      AppStorage.getVoiceProfile(),
      fetchFewShotExamples(),
    ]);

    const parts = [
      "You are ghostwriting a LinkedIn post for this specific person, in their voice.",
      "Layers below are listed in increasing order of precedence -- later layers override earlier ones wherever they conflict.",
      "",
      "=== Layer 1: generic LinkedIn best practices (the floor everyone starts from) ===",
      bestPractices,
      "",
      "=== Layer 2: this person's voice profile (overrides layer 1 wherever they conflict) ===",
      buildVoiceProfileLayer(voiceProfile),
      "",
      "=== Layer 3: this post's funnel goal (shapes angle/CTA within whatever layer 2 allows) ===",
      buildFunnelGoalLayer(idea.funnelGoal),
      "",
      // Layer 4 (learnedGuidelines) intentionally not built yet. Phase 6 adds
      // the learnedGuidelines store and injects it here as the most specific,
      // most recent layer -- it will take priority over layers 1-3 above
      // wherever they conflict, same pattern as the layers before it.
    ];

    if (fewShotExamples.length) {
      parts.push(
        "=== Examples: posts this person has actually published (their real voice — weigh this alongside the layers above, it's not a substitute for them) ===",
        fewShotExamples.map((text, i) => `Example ${i + 1}:\n${text}`).join("\n\n"),
        ""
      );
    }

    parts.push(
      "=== The task ===",
      `Pillar: ${idea.pillar} (${idea.funnelGoal})`,
      `Story shape: ${idea.storyShape}`,
      `Locked hook options (use the strongest, or adapt lightly — don't ignore them): ${(idea.hookOptions || []).join(" | ")}`,
      `Locked angle: ${idea.chosenAngle}`,
      `Locked call to action: ${idea.cta}`,
      "",
      "Write the full LinkedIn post, ready to publish. Return ONLY the post text — no preamble, no markdown formatting, no commentary, no wrapping quotation marks."
    );

    return parts.join("\n");
  }

  // --- stage runner (shared by the first draft and every revision) ---

  async function runDraft(ideaId) {
    const idea = await AppStorage.getIdea(ideaId);
    if (!idea) return;

    try {
      const system = await buildDraftingSystemPrompt(idea);
      const messages = idea.conversationHistory.map((t) => ({ role: t.role, content: t.content }));

      const response = await Api.sendMessage({
        apiKey: AppStorage.getApiKey(),
        model: AppStorage.getModelId(),
        system,
        messages,
        maxTokens: 1024,
      });

      const draftText = cleanDraftText(Api.extractText(response));

      // Re-fetch fresh right before writing, rather than reusing the `idea`
      // read at the top of this function: a status change made elsewhere
      // (e.g. "Mark Ready to Post", clicked while this call was in flight)
      // would otherwise get silently clobbered by writing back the stale
      // pre-call snapshot.
      const current = await AppStorage.getIdea(ideaId);
      if (!current) return;
      current.draft = draftText;
      current.conversationHistory.push({ role: "assistant", content: draftText });
      await AppStorage.saveIdea(current);
      Pipeline.renderBoard();
      if (Pipeline.getCurrentIdeaId() === ideaId) renderDraftingPanel(current);
    } catch (err) {
      if (await App.handleAuthError(err, () => runDraft(ideaId))) return;
      if (Pipeline.getCurrentIdeaId() === ideaId) renderDraftingPanel(idea, { error: err.message });
    }
  }

  async function startDrafting(ideaId) {
    const idea = await AppStorage.getIdea(ideaId);
    if (!idea) return;

    idea.status = "Drafting";
    pushUserTurn(idea, "Write the full post now.");
    await AppStorage.saveIdea(idea);
    Pipeline.renderBoard();
    if (Pipeline.getCurrentIdeaId() === ideaId) renderDraftingPanel(idea, { loading: true });

    await runDraft(ideaId);
  }

  // --- Drafting panel ---

  function renderDraftingPanel(idea, options = {}) {
    const container = document.getElementById("panel-content");

    if (options.loading) {
      container.innerHTML = `<h2>Drafting…</h2><p class="status-pending">${
        idea.draft ? "Revising…" : "Writing the first draft…"
      }</p>`;
      return;
    }

    if (options.error && !idea.draft) {
      container.innerHTML = `
        <h2>Drafting</h2>
        <p class="warning" id="draft-init-error"></p>
        <button type="button" id="draft-retry-btn" class="btn-primary">Retry</button>
      `;
      document.getElementById("draft-init-error").textContent = options.error;
      document.getElementById("draft-retry-btn").addEventListener("click", () => runDraft(idea.id));
      return;
    }

    container.innerHTML = `
      <h2>Drafting</h2>
      <p class="warning" id="draft-error" ${options.error ? "" : "hidden"}></p>
      <div class="field">
        <label>Current draft</label>
        <div class="idea-raw-note" id="draft-text-display"></div>
      </div>
      <div id="draft-chat-log" class="chat-log"></div>
      <form id="draft-chat-form" class="chat-form">
        <textarea id="draft-chat-input" placeholder='Ask for changes… (e.g. "shorter", "cut the third paragraph", "sharper hook")' rows="1"></textarea>
        <button type="submit" class="btn-primary">Send</button>
      </form>
      <p id="draft-status" role="status" aria-live="polite"></p>
      <div class="step-actions">
        <button type="button" id="draft-ready-btn" class="btn-primary">Mark Ready to Post</button>
      </div>
    `;

    if (options.error) {
      document.getElementById("draft-error").textContent = options.error;
    }
    document.getElementById("draft-text-display").textContent = idea.draft || "";

    renderChatLogInto("draft-chat-log", idea.conversationHistory);
    document.getElementById("draft-chat-form").addEventListener("submit", (event) => handleRevisionSubmit(event, idea.id));
    document.getElementById("draft-chat-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        document.getElementById("draft-chat-form").requestSubmit();
      }
    });
    document.getElementById("draft-ready-btn").addEventListener("click", () => handleMarkReadyToPost(idea.id));
  }

  async function handleRevisionSubmit(event, ideaId) {
    event.preventDefault();
    const input = document.getElementById("draft-chat-input");
    const text = input.value.trim();
    if (!text) return;

    const idea = await AppStorage.getIdea(ideaId);
    pushUserTurn(idea, text);
    input.value = "";
    await AppStorage.saveIdea(idea);
    renderChatLogInto("draft-chat-log", idea.conversationHistory);

    const statusEl = document.getElementById("draft-status");
    statusEl.textContent = "Revising…";
    statusEl.className = "status-pending";
    setDraftPanelBusy(true);

    await runDraft(ideaId);
  }

  async function handleMarkReadyToPost(ideaId) {
    const readyBtn = document.getElementById("draft-ready-btn");
    if (readyBtn) readyBtn.disabled = true;
    const idea = await AppStorage.getIdea(ideaId);
    if (!idea) return;
    idea.status = "Ready to Post";
    await AppStorage.saveIdea(idea);
    Pipeline.renderBoard();
    if (Pipeline.getCurrentIdeaId() === ideaId) renderPanel(idea);
  }

  // --- Ready to Post panel ---

  function renderReadyToPostPanel(idea) {
    const container = document.getElementById("panel-content");
    container.innerHTML = `
      <h2>Ready to post</h2>
      <div class="field">
        <label>Final draft</label>
        <div class="idea-raw-note" id="ready-text-display"></div>
      </div>
      <button type="button" id="ready-copy-btn" class="btn-secondary">Copy to clipboard</button>
      <p id="ready-copy-status" role="status" aria-live="polite"></p>
      <div class="step-actions">
        <button type="button" id="ready-mark-posted-btn" class="btn-primary">Mark Posted</button>
      </div>
    `;
    document.getElementById("ready-text-display").textContent = idea.draft || "";

    document.getElementById("ready-copy-btn").addEventListener("click", async () => {
      const statusEl = document.getElementById("ready-copy-status");
      try {
        await navigator.clipboard.writeText(idea.draft || "");
        statusEl.textContent = "Copied.";
        statusEl.className = "status-success";
      } catch (err) {
        statusEl.textContent = "Couldn't copy automatically — select the text above and copy manually.";
        statusEl.className = "status-error";
      }
    });

    document.getElementById("ready-mark-posted-btn").addEventListener("click", () => handleMarkPosted(idea.id));
  }

  async function handleMarkPosted(ideaId) {
    const postedBtn = document.getElementById("ready-mark-posted-btn");
    if (postedBtn) postedBtn.disabled = true;
    const idea = await AppStorage.getIdea(ideaId);
    if (!idea) return;
    idea.status = "Posted";
    idea.datePosted = new Date().toISOString();
    await AppStorage.saveIdea(idea);
    Pipeline.renderBoard();
    Pipeline.closePanel();
  }

  // --- Posted panel (read-only) ---

  function renderPostedPanel(idea) {
    const container = document.getElementById("panel-content");
    container.innerHTML = `
      <h2>Posted</h2>
      <p class="idea-meta" id="posted-date"></p>
      <div class="field">
        <label>Final draft</label>
        <div class="idea-raw-note" id="posted-text-display"></div>
      </div>
    `;
    document.getElementById("posted-date").textContent = idea.datePosted
      ? `Posted ${new Date(idea.datePosted).toLocaleString()}`
      : "Posted";
    document.getElementById("posted-text-display").textContent = idea.postedText || idea.draft || "";
  }

  // --- dispatcher ---

  function renderPanel(idea, options = {}) {
    if (idea.status === "Drafting") renderDraftingPanel(idea, options);
    else if (idea.status === "Ready to Post") renderReadyToPostPanel(idea);
    else if (idea.status === "Posted") renderPostedPanel(idea);
  }

  return { renderPanel, startDrafting };
})();
