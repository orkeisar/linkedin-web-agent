// Per-idea drafting chat/revision UI. Assembles the four-layer system
// prompt (best-practices baseline, voice profile, funnel goal, learned
// guidelines) plus live few-shot examples from Posted drafts, and owns
// the Drafting / Ready to Post / Posted panel views.

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
    const editSaveBtn = document.getElementById("draft-edit-save-btn");
    if (sendBtn) sendBtn.disabled = busy;
    if (input) input.disabled = busy;
    if (readyBtn) readyBtn.disabled = busy;
    if (editSaveBtn) editSaveBtn.disabled = busy;
  }

  // Mirrors setDraftPanelBusy: without this, a second manual-edit save
  // (or Mark Posted) could fire while an earlier save's extraction call is
  // still in flight, and the two lastAgentDraft writes could land out of
  // network-completion order, leaving the baseline pointing at a
  // superseded draft.
  function setReadyPanelBusy(busy) {
    const saveBtn = document.getElementById("ready-edit-save-btn");
    const markPostedBtn = document.getElementById("ready-mark-posted-btn");
    if (saveBtn) saveBtn.disabled = busy;
    if (markPostedBtn) markPostedBtn.disabled = busy;
  }

  // Anthropic's Messages API only accepts "user"/"assistant" roles and
  // requires strict alternation. conversationHistory can also hold
  // "system" notes (e.g. "the user manually edited the draft") for the UI's
  // benefit -- fold those into the surrounding user turn when building the
  // actual API payload, same merge logic as pushUserTurn.
  function buildApiMessages(conversationHistory) {
    const messages = [];
    conversationHistory.forEach((turn) => {
      const role = turn.role === "assistant" ? "assistant" : "user";
      const last = messages[messages.length - 1];
      if (last && last.role === role) {
        last.content = `${last.content}\n\n${turn.content}`;
      } else {
        messages.push({ role, content: turn.content });
      }
    });
    return messages;
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
    return ideas
      .filter((i) => i.status === "Posted" && (i.postedText || i.draft))
      .map((i) => i.postedText || i.draft);
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

  function buildLearnedGuidelinesLayer(learnedGuidelines) {
    if (!learnedGuidelines.length) {
      return "No learned guidelines yet — this person hasn't posted enough for patterns to emerge.";
    }
    return learnedGuidelines.map((g) => `- ${g.description}`).join("\n");
  }

  async function buildDraftingSystemPrompt(idea) {
    const [bestPractices, voiceProfile, fewShotExamples, learnedGuidelines] = await Promise.all([
      fetchBestPractices(),
      AppStorage.getVoiceProfile(),
      fetchFewShotExamples(),
      AppStorage.getLearnedGuidelines(),
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
      "=== Layer 4: learned guidelines for this specific person (most specific, most recent -- overrides layers 1-3 above wherever they conflict) ===",
      buildLearnedGuidelinesLayer(learnedGuidelines),
      "",
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

  // --- manual editing (Drafting + Ready to Post) ---

  // Shared by both the Drafting-panel and Ready-to-Post-panel "Save edit"
  // buttons. lastAgentDraft is a sticky baseline: the first manual edit
  // after an agent draft snapshots the pre-edit text into it (if not
  // already set), and it's only ever moved forward again once an edit is
  // judged substantive -- so a string of small edits keeps accumulating
  // against the same baseline until they cross the threshold together,
  // rather than each being diffed in isolation and mostly ignored.
  async function handleManualEdit(ideaId, newText, { appendChatNote = false } = {}) {
    const idea = await AppStorage.getIdea(ideaId);
    if (!idea) return null;

    const previousDraft = idea.draft || "";
    if (newText === previousDraft) {
      return { idea, noChange: true, ran: false, savedCount: 0, error: null };
    }

    const baseline = idea.lastAgentDraft != null ? idea.lastAgentDraft : previousDraft;
    if (idea.lastAgentDraft == null) {
      idea.lastAgentDraft = previousDraft;
    }
    idea.draft = newText;
    if (appendChatNote) {
      idea.conversationHistory.push({
        role: "system",
        content: `The user manually edited the draft outside this chat. The draft now reads exactly as follows -- treat this as current, not what you last wrote:\n\n${newText}`,
      });
    }
    await AppStorage.saveIdea(idea);
    Pipeline.renderBoard();

    const { ran, savedCount, error } = await Learning.checkAndExtractIfSubstantive(baseline, newText);

    if (ran && !error) {
      // Re-fetch fresh: the extraction call was async, so re-read before
      // writing rather than reusing the `idea` snapshot from above.
      const fresh = await AppStorage.getIdea(ideaId);
      if (fresh) {
        fresh.lastAgentDraft = newText;
        await AppStorage.saveIdea(fresh);
      }
    }

    return { idea, noChange: false, ran, savedCount, error };
  }

  function renderManualEditStatus(statusEl, result) {
    if (!statusEl) return;
    if (!result) {
      statusEl.textContent = "Couldn't save — this idea may have been removed.";
      statusEl.className = "status-error";
    } else if (result.noChange) {
      statusEl.textContent = "";
      statusEl.className = "";
    } else if (result.error) {
      statusEl.textContent = `Saved. Couldn't check for a new writing pattern this time (${result.error}).`;
      statusEl.className = "status-error";
    } else if (result.ran) {
      statusEl.textContent = result.savedCount
        ? `Saved. Learned ${result.savedCount} new pattern${result.savedCount === 1 ? "" : "s"}.`
        : "Saved. Nothing concrete enough to learn from this edit.";
      statusEl.className = "status-success";
    } else {
      statusEl.textContent = "Saved.";
      statusEl.className = "status-success";
    }
  }

  // --- stage runner (shared by the first draft and every revision) ---

  async function runDraft(ideaId) {
    const idea = await AppStorage.getIdea(ideaId);
    if (!idea) return;

    try {
      const system = await buildDraftingSystemPrompt(idea);
      const messages = buildApiMessages(idea.conversationHistory);

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
      // A fresh agent draft supersedes any prior manual-edit baseline -- the
      // next manual edit should snapshot against *this* draft, not a
      // now-stale one from before this revision.
      current.lastAgentDraft = null;
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
        <label for="draft-edit-textarea">Current draft — edit directly, or use the chat below</label>
        <textarea id="draft-edit-textarea" rows="10"></textarea>
        <div class="step-actions">
          <button type="button" id="draft-edit-save-btn" class="btn-secondary">Save edit</button>
        </div>
        <p id="draft-edit-status" role="status" aria-live="polite"></p>
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
    document.getElementById("draft-edit-textarea").value = idea.draft || "";

    renderChatLogInto("draft-chat-log", idea.conversationHistory);
    document.getElementById("draft-chat-form").addEventListener("submit", (event) => handleRevisionSubmit(event, idea.id));
    document.getElementById("draft-chat-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        document.getElementById("draft-chat-form").requestSubmit();
      }
    });
    document.getElementById("draft-edit-save-btn").addEventListener("click", () => handleDraftEditSave(idea.id));
    document.getElementById("draft-ready-btn").addEventListener("click", () => handleMarkReadyToPost(idea.id));
  }

  async function handleDraftEditSave(ideaId) {
    const textarea = document.getElementById("draft-edit-textarea");
    const statusEl = document.getElementById("draft-edit-status");
    const newText = textarea.value.trim();

    // Also blocks the chat form for the duration: a concurrent revision
    // could otherwise finish its own draft/lastAgentDraft write mid-way
    // through this edit's (slower) extraction call and have it clobbered.
    setDraftPanelBusy(true);
    if (statusEl) {
      statusEl.textContent = "Saving…";
      statusEl.className = "status-pending";
    }

    const result = await handleManualEdit(ideaId, newText, { appendChatNote: true });

    setDraftPanelBusy(false);
    renderManualEditStatus(statusEl, result);

    if (result && !result.noChange && Pipeline.getCurrentIdeaId() === ideaId) {
      const fresh = await AppStorage.getIdea(ideaId);
      if (fresh) renderChatLogInto("draft-chat-log", fresh.conversationHistory);
    }
  }

  async function handleRevisionSubmit(event, ideaId) {
    event.preventDefault();
    const input = document.getElementById("draft-chat-input");
    const text = input.value.trim();
    if (!text) return;

    // Disable before any async work starts (not just before the API call)
    // so a concurrent Save-edit can't race this function's own
    // read-modify-write of conversationHistory/draft.
    setDraftPanelBusy(true);

    const idea = await AppStorage.getIdea(ideaId);
    pushUserTurn(idea, text);
    input.value = "";
    await AppStorage.saveIdea(idea);
    renderChatLogInto("draft-chat-log", idea.conversationHistory);

    const statusEl = document.getElementById("draft-status");
    statusEl.textContent = "Revising…";
    statusEl.className = "status-pending";

    await runDraft(ideaId);
  }

  async function handleMarkReadyToPost(ideaId) {
    const readyBtn = document.getElementById("draft-ready-btn");
    if (readyBtn) readyBtn.disabled = true;

    // Don't lose an edit sitting in the textarea that was never explicitly
    // saved before the user moved on.
    const editTextarea = document.getElementById("draft-edit-textarea");
    if (editTextarea) {
      const pending = editTextarea.value.trim();
      const latest = (await AppStorage.getIdea(ideaId))?.draft || "";
      if (pending !== latest) await handleManualEdit(ideaId, pending, { appendChatNote: true });
    }

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
        <label for="ready-edit-textarea">Final draft — edit directly if needed</label>
        <textarea id="ready-edit-textarea" rows="10"></textarea>
        <div class="step-actions">
          <button type="button" id="ready-edit-save-btn" class="btn-secondary">Save edit</button>
        </div>
        <p id="ready-edit-status" role="status" aria-live="polite"></p>
      </div>
      <button type="button" id="ready-copy-btn" class="btn-secondary">Copy to clipboard</button>
      <p id="ready-copy-status" role="status" aria-live="polite"></p>
      <div class="step-actions">
        <button type="button" id="ready-mark-posted-btn" class="btn-primary">Mark Posted</button>
      </div>
    `;
    document.getElementById("ready-edit-textarea").value = idea.draft || "";

    document.getElementById("ready-edit-save-btn").addEventListener("click", () => handleReadyEditSave(idea.id));

    document.getElementById("ready-copy-btn").addEventListener("click", async () => {
      const statusEl = document.getElementById("ready-copy-status");
      try {
        await navigator.clipboard.writeText(document.getElementById("ready-edit-textarea").value || "");
        statusEl.textContent = "Copied.";
        statusEl.className = "status-success";
      } catch (err) {
        statusEl.textContent = "Couldn't copy automatically — select the text above and copy manually.";
        statusEl.className = "status-error";
      }
    });

    document.getElementById("ready-mark-posted-btn").addEventListener("click", () => handleMarkPostedClick(idea.id));
  }

  async function handleReadyEditSave(ideaId) {
    const textarea = document.getElementById("ready-edit-textarea");
    const statusEl = document.getElementById("ready-edit-status");
    const newText = textarea.value.trim();

    setReadyPanelBusy(true);
    if (statusEl) {
      statusEl.textContent = "Saving…";
      statusEl.className = "status-pending";
    }

    const result = await handleManualEdit(ideaId, newText, { appendChatNote: false });

    setReadyPanelBusy(false);
    renderManualEditStatus(statusEl, result);
  }

  async function handleMarkPostedClick(ideaId) {
    setReadyPanelBusy(true);

    // Same reasoning as handleMarkReadyToPost: don't silently drop an edit
    // the user never explicitly saved before moving on.
    const textarea = document.getElementById("ready-edit-textarea");
    if (textarea) {
      const pending = textarea.value.trim();
      const latest = (await AppStorage.getIdea(ideaId))?.draft || "";
      if (pending !== latest) await handleManualEdit(ideaId, pending, { appendChatNote: false });
    }

    const idea = await AppStorage.getIdea(ideaId);
    setReadyPanelBusy(false);
    if (!idea) return;
    renderMarkPostedConfirm(idea);
  }

  // --- Mark Posted confirmation (the learning-loop entry point) ---

  function renderMarkPostedConfirm(idea) {
    const container = document.getElementById("panel-content");
    container.innerHTML = `
      <h2>Mark as posted</h2>
      <p>Paste what you actually posted, or confirm it went out as drafted.</p>
      <div class="field">
        <label for="posted-text-input">What was actually posted (leave blank if it went out exactly as drafted)</label>
        <textarea id="posted-text-input" rows="8" placeholder="Paste the final published text here…"></textarea>
      </div>
      <p id="mark-posted-status" role="status" aria-live="polite"></p>
      <div class="step-actions">
        <button type="button" id="posted-as-is-btn" class="btn-secondary">Posted as-is</button>
        <button type="button" id="posted-save-btn" class="btn-primary">Save &amp; mark posted</button>
      </div>
    `;

    document.getElementById("posted-as-is-btn").addEventListener("click", () => {
      setMarkPostedButtonsDisabled(true);
      handleMarkPosted(idea.id, null);
    });
    document.getElementById("posted-save-btn").addEventListener("click", () => {
      const text = document.getElementById("posted-text-input").value.trim();
      setMarkPostedButtonsDisabled(true);
      handleMarkPosted(idea.id, text || null);
    });
  }

  function setMarkPostedButtonsDisabled(disabled) {
    const asIsBtn = document.getElementById("posted-as-is-btn");
    const saveBtn = document.getElementById("posted-save-btn");
    if (asIsBtn) asIsBtn.disabled = disabled;
    if (saveBtn) saveBtn.disabled = disabled;
  }

  async function handleMarkPosted(ideaId, pastedText) {
    const statusEl = document.getElementById("mark-posted-status");
    let idea;
    try {
      idea = await AppStorage.getIdea(ideaId);
      if (!idea) return;

      // "Store postedText regardless of whether it differs from draft" --
      // when posted as-is, postedText is simply a copy of the draft, so it
      // always reflects the true published text once available.
      const finalText = pastedText || idea.draft || "";
      idea.postedText = finalText;
      idea.status = "Posted";
      idea.datePosted = new Date().toISOString();
      await AppStorage.saveIdea(idea);
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `Couldn't save: ${err.message}`;
        statusEl.className = "status-error";
      }
      setMarkPostedButtonsDisabled(false);
      return;
    }

    Pipeline.renderBoard();
    const finalText = idea.postedText;

    if (statusEl) {
      statusEl.textContent = "Comparing what changed to sharpen future drafts…";
      statusEl.className = "status-pending";
    }

    // Harmless when pastedText was empty/omitted: finalText then equals
    // idea.draft exactly, so the diff is a no-op and this resolves
    // instantly with ran: false, no API call made.
    const { ran, savedCount, error: extractionError } = await Learning.checkAndExtractIfSubstantive(idea.draft || "", finalText);
    if (!ran) {
      Pipeline.closePanel();
      return;
    }

    if (statusEl) {
      if (extractionError) {
        statusEl.textContent = `Posted. Couldn't check for a new writing pattern this time (${extractionError}) — nothing else is affected. Closing…`;
        statusEl.className = "status-error";
      } else {
        statusEl.textContent = savedCount
          ? `Posted. Learned ${savedCount} new pattern${savedCount === 1 ? "" : "s"} — closing…`
          : "Posted. Nothing concrete enough to learn from this edit — closing…";
        statusEl.className = "status-success";
      }
    }

    setTimeout(() => {
      if (Pipeline.getCurrentIdeaId() === ideaId) Pipeline.closePanel();
    }, 1500);
  }

  // --- Posted panel (read-only) ---

  function renderPostedPanel(idea) {
    const container = document.getElementById("panel-content");
    container.innerHTML = `
      <h2>Posted</h2>
      <p class="idea-meta" id="posted-date"></p>
      <div class="field">
        <label>What was posted</label>
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
