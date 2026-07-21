// Stage B wizard: pillars review -> API key -> writing samples -> guided
// conversation -> editable summary -> save.

const Onboarding = (() => {
  const HIDDEN_KICKOFF_MESSAGE = { role: "user", content: "(begin the conversation)" };

  const state = {
    step: 1,
    pillarsConfig: null,
    rawExamples: [],
    conversationHistory: [],
    draftProfile: null,
    synthesisError: null,
  };

  // --- shared field helpers (pillar blocks + generic repeatable lists) ---

  function pillarBlockTemplate(pillar = {}) {
    const div = document.createElement("div");
    div.className = "pillar-block";
    div.innerHTML = `
      <div class="pillar-block-header">
        <strong>Pillar</strong>
        <button type="button" class="remove-pillar-btn">Remove pillar</button>
      </div>
      <label>Name
        <input type="text" class="pillar-name" />
      </label>
      <label>Description
        <textarea class="pillar-description" rows="3"></textarea>
      </label>
      <label>Funnel goal
        <select class="pillar-funnel-goal">
          <option value="TOFU">TOFU — awareness</option>
          <option value="MOFU">MOFU — consideration</option>
          <option value="BOFU">BOFU — conversion</option>
        </select>
      </label>
      <div class="field-header">
        <label>Example angles</label>
        <button type="button" class="add-angle-btn">+ Add angle</button>
      </div>
      <div class="angles-container"></div>
    `;
    div.querySelector(".pillar-name").value = pillar.name || "";
    div.querySelector(".pillar-description").value = pillar.description || "";
    div.querySelector(".pillar-funnel-goal").value = pillar.funnelGoal || "TOFU";
    const anglesContainer = div.querySelector(".angles-container");
    const angles = pillar.exampleAngles && pillar.exampleAngles.length ? pillar.exampleAngles : [""];
    angles.forEach((angle) => anglesContainer.appendChild(angleRowTemplate(angle)));
    return div;
  }

  function angleRowTemplate(value = "") {
    const div = document.createElement("div");
    div.className = "angle-row";
    div.innerHTML = `
      <input type="text" class="angle-input" placeholder="Example angle" />
      <button type="button" class="remove-angle-btn" aria-label="Remove angle">&times;</button>
    `;
    div.querySelector(".angle-input").value = value;
    return div;
  }

  function repeatableRowTemplate(value, placeholder, multiline) {
    const div = document.createElement("div");
    div.className = "repeatable-row";
    div.innerHTML = multiline
      ? `<textarea class="repeatable-input" rows="2" placeholder="${placeholder}"></textarea>
         <button type="button" class="remove-repeatable-btn" aria-label="Remove">&times;</button>`
      : `<input type="text" class="repeatable-input" placeholder="${placeholder}" />
         <button type="button" class="remove-repeatable-btn" aria-label="Remove">&times;</button>`;
    div.querySelector(".repeatable-input").value = value || "";
    return div;
  }

  function renderRepeatableList(container, values, { placeholder = "", multiline = false } = {}) {
    container.innerHTML = "";
    const items = values && values.length ? values : [""];
    items.forEach((val) => container.appendChild(repeatableRowTemplate(val, placeholder, multiline)));
  }

  function wireRepeatableList(container, addBtn, opts) {
    container.addEventListener("click", (event) => {
      const btn = event.target.closest(".remove-repeatable-btn");
      if (btn) btn.closest(".repeatable-row").remove();
    });
    addBtn.addEventListener("click", () => {
      container.appendChild(repeatableRowTemplate("", opts.placeholder, opts.multiline));
    });
  }

  function collectRepeatableList(container) {
    return Array.from(container.querySelectorAll(".repeatable-input"))
      .map((el) => el.value.trim())
      .filter(Boolean);
  }

  function setupRepeatableField(containerId, addBtnId, values, opts) {
    const container = document.getElementById(containerId);
    renderRepeatableList(container, values, opts);
    wireRepeatableList(container, document.getElementById(addBtnId), opts);
  }

  // --- wizard shell ---

  function start(seedPillars) {
    state.step = 1;
    state.pillarsConfig = seedPillars;
    state.rawExamples = [];
    state.conversationHistory = [];
    state.draftProfile = null;
    state.synthesisError = null;

    document.getElementById("app-shell").hidden = true;
    document.getElementById("onboarding-view").hidden = false;
    renderStep();
  }

  function renderStep() {
    document.getElementById("onboarding-step-indicator").textContent = `Step ${state.step} of 5`;
    if (state.step === 1) renderStep1();
    else if (state.step === 2) renderStep2();
    else if (state.step === 3) renderStep3();
    else if (state.step === 4) renderStep4();
    else if (state.step === 5) renderStep5();
  }

  function goBack() {
    if (state.step <= 1) return;
    state.step -= 1;
    if (state.step < 5) {
      // Leaving step 5 behind invalidates the cached synthesis — regenerate
      // next time step 5 is reached so it reflects whatever changed upstream.
      state.draftProfile = null;
      state.synthesisError = null;
    }
    renderStep();
  }

  // --- Step 1: pillars review ---

  function renderStep1() {
    const container = document.getElementById("onboarding-step-container");
    container.innerHTML = `
      <h2>Review your content pillars</h2>
      <p>${
        state.pillarsConfig.pillars.length
          ? "Here's the starting strategy — edit anything before continuing."
          : "No pillars were pre-filled — add at least one, or come back to this later in Settings."
      }</p>
      <div class="field">
        <label for="ob-recipient-name">Your name (optional)</label>
        <input type="text" id="ob-recipient-name" />
      </div>
      <div class="field">
        <label for="ob-strategy-notes">Content strategy notes (optional)</label>
        <textarea id="ob-strategy-notes" rows="4"></textarea>
      </div>
      <div class="field">
        <div class="field-header">
          <label>Pillars</label>
          <button type="button" id="ob-add-pillar-btn" class="btn-secondary">+ Add pillar</button>
        </div>
        <div id="ob-pillars-container"></div>
      </div>
      <p id="ob-step1-error" role="status" aria-live="polite"></p>
      <button type="button" id="ob-step1-continue-btn" class="btn-primary">Continue</button>
    `;

    document.getElementById("ob-recipient-name").value = state.pillarsConfig.recipientName || "";
    document.getElementById("ob-strategy-notes").value = state.pillarsConfig.contentStrategyNotes || "";

    const pillarsContainer = document.getElementById("ob-pillars-container");
    const pillars = state.pillarsConfig.pillars.length ? state.pillarsConfig.pillars : [{}];
    pillars.forEach((pillar) => pillarsContainer.appendChild(pillarBlockTemplate(pillar)));

    document.getElementById("ob-add-pillar-btn").addEventListener("click", () => {
      pillarsContainer.appendChild(pillarBlockTemplate({}));
    });

    pillarsContainer.addEventListener("click", (event) => {
      const removePillarBtn = event.target.closest(".remove-pillar-btn");
      if (removePillarBtn) {
        removePillarBtn.closest(".pillar-block").remove();
        return;
      }
      const addAngleBtn = event.target.closest(".add-angle-btn");
      if (addAngleBtn) {
        addAngleBtn.closest(".pillar-block").querySelector(".angles-container").appendChild(angleRowTemplate());
        return;
      }
      const removeAngleBtn = event.target.closest(".remove-angle-btn");
      if (removeAngleBtn) {
        removeAngleBtn.closest(".angle-row").remove();
      }
    });

    document.getElementById("ob-step1-continue-btn").addEventListener("click", async () => {
      const errorEl = document.getElementById("ob-step1-error");
      const recipientName = document.getElementById("ob-recipient-name").value.trim();
      const contentStrategyNotes = document.getElementById("ob-strategy-notes").value.trim();
      const validation = validatePillarBlocks(readPillarBlocks());

      if (validation.error) {
        errorEl.textContent = validation.error;
        errorEl.className = "status-error";
        return;
      }

      const config = { recipientName, contentStrategyNotes, pillars: validation.pillars };
      state.pillarsConfig = config;
      await AppStorage.savePillars(config);
      state.step = 2;
      renderStep();
    });
  }

  function readPillarBlocks() {
    return Array.from(document.querySelectorAll("#ob-pillars-container .pillar-block")).map((block) => ({
      name: block.querySelector(".pillar-name").value.trim(),
      description: block.querySelector(".pillar-description").value.trim(),
      funnelGoal: block.querySelector(".pillar-funnel-goal").value,
      exampleAngles: Array.from(block.querySelectorAll(".angle-input"))
        .map((input) => input.value.trim())
        .filter(Boolean),
    }));
  }

  function validatePillarBlocks(blocks) {
    const nonEmptyBlocks = blocks.filter((b) => b.name || b.description || b.exampleAngles.length);
    if (nonEmptyBlocks.length === 0) {
      return { error: "Add at least one pillar before continuing." };
    }
    for (let i = 0; i < nonEmptyBlocks.length; i++) {
      if (!nonEmptyBlocks[i].name) return { error: `Pillar ${i + 1} needs a name.` };
      if (!nonEmptyBlocks[i].description) return { error: `Pillar ${i + 1} needs a description.` };
    }
    return { pillars: nonEmptyBlocks };
  }

  // --- Step 2: API key ---

  function renderStep2() {
    const container = document.getElementById("onboarding-step-container");
    const existingKey = AppStorage.getApiKey();

    if (existingKey) {
      container.innerHTML = `
        <h2>Connect your Anthropic API key</h2>
        <p>Using the key already saved in this browser.</p>
        <div class="step-actions">
          <button type="button" id="ob-step2-back-btn" class="btn-secondary">Back</button>
          <button type="button" id="ob-step2-continue-btn" class="btn-primary">Continue</button>
          <button type="button" id="ob-step2-change-key-btn" class="btn-secondary">Use a different key</button>
        </div>
      `;
      document.getElementById("ob-step2-back-btn").addEventListener("click", goBack);
      document.getElementById("ob-step2-continue-btn").addEventListener("click", () => {
        state.step = 3;
        renderStep();
      });
      document.getElementById("ob-step2-change-key-btn").addEventListener("click", () => {
        renderStep2KeyForm();
      });
      return;
    }

    renderStep2KeyForm();
  }

  function renderStep2KeyForm() {
    const container = document.getElementById("onboarding-step-container");
    container.innerHTML = `
      <h2>Connect your Anthropic API key</h2>
      <p>Paste your Anthropic API key. It's stored only in this browser's localStorage, and sent only to Anthropic's API.</p>
      <div class="field">
        <label for="ob-api-key-input">Anthropic API key</label>
        <input type="password" id="ob-api-key-input" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" />
      </div>
      <div class="step-actions">
        <button type="button" id="ob-step2-back-btn" class="btn-secondary">Back</button>
        <button type="button" id="ob-test-connection-btn" class="btn-primary">Test connection</button>
      </div>
      <p id="ob-connection-status" role="status" aria-live="polite"></p>
    `;

    document.getElementById("ob-step2-back-btn").addEventListener("click", goBack);
    document.getElementById("ob-test-connection-btn").addEventListener("click", async () => {
      const input = document.getElementById("ob-api-key-input");
      const button = document.getElementById("ob-test-connection-btn");
      const statusEl = document.getElementById("ob-connection-status");
      const apiKey = input.value.trim();

      if (!apiKey) {
        statusEl.textContent = "Enter an API key first.";
        statusEl.className = "status-error";
        return;
      }

      button.disabled = true;
      statusEl.textContent = "Testing connection…";
      statusEl.className = "status-pending";

      try {
        await Api.testConnection({ apiKey, model: AppStorage.getModelId() });
        AppStorage.setApiKey(apiKey);
        statusEl.textContent = "Connected — key saved.";
        statusEl.className = "status-success";

        if (!document.getElementById("ob-step2-continue-btn")) {
          const continueBtn = document.createElement("button");
          continueBtn.type = "button";
          continueBtn.id = "ob-step2-continue-btn";
          continueBtn.className = "btn-primary";
          continueBtn.textContent = "Continue";
          continueBtn.addEventListener("click", () => {
            state.step = 3;
            renderStep();
          });
          document.getElementById("onboarding-step-container").appendChild(continueBtn);
        }
      } catch (err) {
        statusEl.textContent = err.message;
        statusEl.className = "status-error";
      } finally {
        button.disabled = false;
      }
    });
  }

  // --- Step 3: writing samples ---

  function renderStep3() {
    const container = document.getElementById("onboarding-step-container");
    container.innerHTML = `
      <h2>Writing samples (optional)</h2>
      <p>Paste any writing samples — posts, emails, docs, anything that shows your natural voice. Not just LinkedIn posts. Skip this entirely if you'd rather not — the bot also learns from what you post going forward.</p>
      <div id="ob-samples-container"></div>
      <button type="button" id="ob-add-sample-btn" class="btn-secondary">+ Add another sample</button>
      <div class="step-actions">
        <button type="button" id="ob-step3-back-btn" class="btn-secondary">Back</button>
        <button type="button" id="ob-step3-skip-btn" class="btn-secondary">Skip this step</button>
        <button type="button" id="ob-step3-continue-btn" class="btn-primary">Continue</button>
      </div>
    `;

    setupRepeatableField("ob-samples-container", "ob-add-sample-btn", state.rawExamples, {
      placeholder: "Paste a writing sample…",
      multiline: true,
    });

    document.getElementById("ob-step3-back-btn").addEventListener("click", goBack);
    document.getElementById("ob-step3-skip-btn").addEventListener("click", () => {
      state.rawExamples = [];
      state.step = 4;
      renderStep();
    });

    document.getElementById("ob-step3-continue-btn").addEventListener("click", () => {
      state.rawExamples = collectRepeatableList(document.getElementById("ob-samples-container"));
      state.step = 4;
      renderStep();
    });
  }

  // --- Step 4: guided conversation ---

  function buildConversationSystemPrompt() {
    const { pillarsConfig, rawExamples } = state;
    const pillarSummary =
      pillarsConfig.pillars.map((p) => `- ${p.name}: ${p.description} (${p.funnelGoal})`).join("\n") || "(none yet)";
    return [
      "You are conducting a short, natural onboarding conversation for a LinkedIn ghostwriting assistant.",
      "Your goal is to learn, through natural back-and-forth, this person's: role, audience/ICP, phrases they want to avoid, types of posts they want to avoid, and posts or accounts they admire.",
      "Ask ONE question at a time. Ask natural follow-ups based on what they actually say rather than working through a fixed checklist — if an answer already covers another topic, don't ask it again.",
      "Keep your messages short and conversational, like a person chatting, not a form.",
      "Start the conversation now with a brief, friendly opening question.",
      "",
      "Context already known about this person:",
      `Content strategy notes: ${pillarsConfig.contentStrategyNotes || "(none)"}`,
      `Pillars:\n${pillarSummary}`,
      rawExamples.length ? `They pasted ${rawExamples.length} writing sample(s) already.` : "They didn't paste any writing samples.",
    ].join("\n");
  }

  function buildApiMessages() {
    return [HIDDEN_KICKOFF_MESSAGE, ...state.conversationHistory.map((t) => ({ role: t.role, content: t.content }))];
  }

  function renderStep4() {
    const container = document.getElementById("onboarding-step-container");
    container.innerHTML = `
      <h2>Let's talk about your voice</h2>
      <div id="ob-chat-log" class="chat-log"></div>
      <form id="ob-chat-form" class="chat-form">
        <input type="text" id="ob-chat-input" placeholder="Type your reply…" autocomplete="off" />
        <button type="submit" id="ob-chat-send-btn" class="btn-primary">Send</button>
      </form>
      <p id="ob-chat-status" role="status" aria-live="polite"></p>
      <div class="step-actions">
        <button type="button" id="ob-step4-back-btn" class="btn-secondary">Back</button>
        <button type="button" id="ob-step4-continue-btn" class="btn-primary" hidden>Continue to summary</button>
      </div>
    `;

    renderChatLog();

    document.getElementById("ob-chat-form").addEventListener("submit", handleChatSubmit);
    document.getElementById("ob-step4-back-btn").addEventListener("click", goBack);
    document.getElementById("ob-step4-continue-btn").addEventListener("click", () => {
      state.step = 5;
      renderStep();
    });

    if (state.conversationHistory.length === 0) {
      requestAssistantTurn();
    } else {
      maybeShowContinueButton();
    }
  }

  function renderChatLog() {
    const log = document.getElementById("ob-chat-log");
    log.innerHTML = "";
    state.conversationHistory.forEach((turn) => {
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble chat-${turn.role}`;
      bubble.textContent = turn.content;
      log.appendChild(bubble);
    });
    log.scrollTop = log.scrollHeight;
  }

  function maybeShowContinueButton() {
    const hasUserReply = state.conversationHistory.some((t) => t.role === "user");
    document.getElementById("ob-step4-continue-btn").hidden = !hasUserReply;
  }

  async function requestAssistantTurn() {
    const statusEl = document.getElementById("ob-chat-status");
    const sendBtn = document.getElementById("ob-chat-send-btn");
    const input = document.getElementById("ob-chat-input");
    sendBtn.disabled = true;
    input.disabled = true;
    statusEl.textContent = "Thinking…";
    statusEl.className = "status-pending";

    try {
      const response = await Api.sendMessage({
        apiKey: AppStorage.getApiKey(),
        model: AppStorage.getModelId(),
        system: buildConversationSystemPrompt(),
        messages: buildApiMessages(),
        maxTokens: 400,
      });
      const text = Api.extractText(response);
      state.conversationHistory.push({ role: "assistant", content: text });
      renderChatLog();
      statusEl.textContent = "";
      maybeShowContinueButton();
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = "status-error";
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  async function handleChatSubmit(event) {
    event.preventDefault();
    const input = document.getElementById("ob-chat-input");
    const text = input.value.trim();
    if (!text) return;
    state.conversationHistory.push({ role: "user", content: text });
    input.value = "";
    renderChatLog();
    maybeShowContinueButton();
    await requestAssistantTurn();
  }

  // --- Step 5: editable summary ---

  function buildSynthesisPrompt() {
    const { pillarsConfig, rawExamples, conversationHistory } = state;
    const pillarSummary =
      pillarsConfig.pillars.map((p) => `- ${p.name}: ${p.description} (${p.funnelGoal})`).join("\n") || "(none)";
    const convoTranscript =
      conversationHistory.map((t) => `${t.role === "assistant" ? "Assistant" : "Person"}: ${t.content}`).join("\n") ||
      "(no conversation)";
    const samplesBlock = rawExamples.length
      ? rawExamples.map((s, i) => `Sample ${i + 1}:\n${s}`).join("\n\n")
      : "(no writing samples provided)";

    return [
      "Synthesize everything below into a single JSON object describing this person's LinkedIn writing voice.",
      "Return ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:",
      `{
  "role": string,
  "audience": string,
  "goals": string,
  "toneRules": string[],
  "structuralPatterns": string,
  "hashtagsEmojiPolicy": string,
  "forbiddenPhrases": string[],
  "avoidedPostTypes": string[],
  "admiredExamples": string[]
}`,
      "Base it on concrete things said below, not generic filler. If something wasn't covered, use a reasonable empty value (empty string or empty array) rather than inventing detail.",
      "",
      "Content strategy notes:",
      pillarsConfig.contentStrategyNotes || "(none)",
      "",
      "Pillars:",
      pillarSummary,
      "",
      "Conversation transcript:",
      convoTranscript,
      "",
      "Writing samples:",
      samplesBlock,
    ].join("\n");
  }

  function parseSynthesizedProfile(text) {
    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/, "")
      .trim();
    try {
      const parsed = JSON.parse(cleaned);
      return {
        role: parsed.role || "",
        audience: parsed.audience || "",
        goals: parsed.goals || "",
        toneRules: Array.isArray(parsed.toneRules) ? parsed.toneRules : [],
        structuralPatterns: parsed.structuralPatterns || "",
        hashtagsEmojiPolicy: parsed.hashtagsEmojiPolicy || "",
        forbiddenPhrases: Array.isArray(parsed.forbiddenPhrases) ? parsed.forbiddenPhrases : [],
        avoidedPostTypes: Array.isArray(parsed.avoidedPostTypes) ? parsed.avoidedPostTypes : [],
        admiredExamples: Array.isArray(parsed.admiredExamples) ? parsed.admiredExamples : [],
      };
    } catch (err) {
      return null;
    }
  }

  function emptyVoiceProfileDraft() {
    return {
      role: "",
      audience: "",
      goals: "",
      toneRules: [],
      structuralPatterns: "",
      hashtagsEmojiPolicy: "",
      forbiddenPhrases: [],
      avoidedPostTypes: [],
      admiredExamples: [],
    };
  }

  async function renderStep5() {
    const container = document.getElementById("onboarding-step-container");
    container.innerHTML = `<h2>Review your voice profile</h2><p id="ob-synthesis-status">Synthesizing from your answers…</p>`;

    if (!state.draftProfile) {
      let draft = null;
      let errorMessage = null;
      try {
        const response = await Api.sendMessage({
          apiKey: AppStorage.getApiKey(),
          model: AppStorage.getModelId(),
          messages: [{ role: "user", content: buildSynthesisPrompt() }],
          maxTokens: 1024,
        });
        draft = parseSynthesizedProfile(Api.extractText(response));
        if (!draft) errorMessage = "Couldn't parse the synthesized profile — starting from a blank form instead.";
      } catch (err) {
        errorMessage = `Synthesis call failed (${err.message}) — starting from a blank form instead.`;
      }
      state.draftProfile = draft || emptyVoiceProfileDraft();
      state.synthesisError = errorMessage;
    }

    renderStep5Form(state.draftProfile, state.synthesisError);
  }

  function renderStep5Form(draft, errorMessage) {
    const container = document.getElementById("onboarding-step-container");
    container.innerHTML = `
      <h2>Review your voice profile</h2>
      ${errorMessage ? `<p class="warning">${errorMessage}</p>` : ""}
      <p>Edit anything before saving — nothing is saved until you confirm.</p>
      <div class="field"><label for="ob-vp-role">Role</label><input type="text" id="ob-vp-role" /></div>
      <div class="field"><label for="ob-vp-audience">Audience</label><input type="text" id="ob-vp-audience" /></div>
      <div class="field"><label for="ob-vp-goals">Goals (optional)</label><textarea id="ob-vp-goals" rows="2"></textarea></div>
      <div class="field">
        <div class="field-header"><label>Tone rules (optional)</label><button type="button" id="ob-vp-tone-add" class="btn-secondary">+ Add</button></div>
        <div id="ob-vp-tone-container"></div>
      </div>
      <div class="field"><label for="ob-vp-structure">Structural patterns (optional)</label><textarea id="ob-vp-structure" rows="2"></textarea></div>
      <div class="field"><label for="ob-vp-hashtags">Hashtags/emoji policy (optional)</label><input type="text" id="ob-vp-hashtags" /></div>
      <div class="field">
        <div class="field-header"><label>Forbidden phrases (optional)</label><button type="button" id="ob-vp-forbidden-add" class="btn-secondary">+ Add</button></div>
        <div id="ob-vp-forbidden-container"></div>
      </div>
      <div class="field">
        <div class="field-header"><label>Avoided post types (optional)</label><button type="button" id="ob-vp-avoided-add" class="btn-secondary">+ Add</button></div>
        <div id="ob-vp-avoided-container"></div>
      </div>
      <div class="field">
        <div class="field-header"><label>Admired examples (optional)</label><button type="button" id="ob-vp-admired-add" class="btn-secondary">+ Add</button></div>
        <div id="ob-vp-admired-container"></div>
      </div>
      <div class="field">
        <div class="field-header"><label>Writing samples (optional)</label><button type="button" id="ob-vp-samples-add" class="btn-secondary">+ Add</button></div>
        <div id="ob-vp-samples-container"></div>
      </div>
      <p id="ob-save-status" role="status" aria-live="polite"></p>
      <div class="step-actions">
        <button type="button" id="ob-step5-back-btn" class="btn-secondary">Back</button>
        <button type="button" id="ob-save-profile-btn" class="btn-primary">Save and continue</button>
      </div>
    `;

    document.getElementById("ob-vp-role").value = draft.role;
    document.getElementById("ob-vp-audience").value = draft.audience;
    document.getElementById("ob-vp-goals").value = draft.goals;
    document.getElementById("ob-vp-structure").value = draft.structuralPatterns;
    document.getElementById("ob-vp-hashtags").value = draft.hashtagsEmojiPolicy;

    setupRepeatableField("ob-vp-tone-container", "ob-vp-tone-add", draft.toneRules, {
      placeholder: 'e.g. "no rhetorical questions in hooks"',
    });
    setupRepeatableField("ob-vp-forbidden-container", "ob-vp-forbidden-add", draft.forbiddenPhrases, {
      placeholder: 'e.g. "game-changer"',
    });
    setupRepeatableField("ob-vp-avoided-container", "ob-vp-avoided-add", draft.avoidedPostTypes, {
      placeholder: "e.g. generic listicles",
    });
    setupRepeatableField("ob-vp-admired-container", "ob-vp-admired-add", draft.admiredExamples, {
      placeholder: "e.g. a post or account you admire",
    });
    setupRepeatableField("ob-vp-samples-container", "ob-vp-samples-add", state.rawExamples, {
      placeholder: "Paste a writing sample…",
      multiline: true,
    });

    document.getElementById("ob-step5-back-btn").addEventListener("click", goBack);
    document.getElementById("ob-save-profile-btn").addEventListener("click", handleSaveProfile);
  }

  async function handleSaveProfile() {
    const statusEl = document.getElementById("ob-save-status");
    const saveBtn = document.getElementById("ob-save-profile-btn");

    const role = document.getElementById("ob-vp-role").value.trim();
    const audience = document.getElementById("ob-vp-audience").value.trim();
    if (!role || !audience) {
      statusEl.textContent = "Role and audience are required before saving.";
      statusEl.className = "status-error";
      return;
    }

    saveBtn.disabled = true;
    statusEl.textContent = "Saving…";
    statusEl.className = "status-pending";

    const now = new Date().toISOString();
    const voiceProfile = {
      role,
      audience,
      goals: document.getElementById("ob-vp-goals").value.trim(),
      toneRules: collectRepeatableList(document.getElementById("ob-vp-tone-container")),
      structuralPatterns: document.getElementById("ob-vp-structure").value.trim(),
      hashtagsEmojiPolicy: document.getElementById("ob-vp-hashtags").value.trim(),
      forbiddenPhrases: collectRepeatableList(document.getElementById("ob-vp-forbidden-container")),
      avoidedPostTypes: collectRepeatableList(document.getElementById("ob-vp-avoided-container")),
      admiredExamples: collectRepeatableList(document.getElementById("ob-vp-admired-container")),
      rawExamples: collectRepeatableList(document.getElementById("ob-vp-samples-container")),
      createdAt: now,
      updatedAt: now,
    };

    try {
      await AppStorage.saveVoiceProfile(voiceProfile);
      App.showAppShell();
    } catch (err) {
      statusEl.textContent = `Couldn't save: ${err.message}`;
      statusEl.className = "status-error";
      saveBtn.disabled = false;
    }
  }

  return { start };
})();
