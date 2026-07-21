// Idea state machine, kanban board rendering, IndexedDB CRUD for the
// `ideas` store. Covers Inbox -> Interviewing -> Proposing (Drafting and
// beyond land in Phase 5+).

const Pipeline = (() => {
  const STATUSES = ["Inbox", "Interviewing", "Proposing", "Drafting", "Ready to Post", "Posted"];

  let currentIdeaId = null;
  let initialized = false;

  // --- helpers ---

  function stripCodeFences(text) {
    return text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/, "")
      .trim();
  }

  function formatQuestions(questions) {
    return questions.length === 1 ? questions[0] : questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  }

  function formatProposalSummary(idea) {
    const hooks = (idea.hookOptions || []).map((h, i) => `${i + 1}. ${h}`).join("\n");
    return [
      `Pillar: ${idea.pillar} (${idea.funnelGoal})`,
      `Story shape: ${idea.storyShape}`,
      `Hook options:\n${hooks}`,
      `Angle: ${idea.chosenAngle}`,
      `CTA: ${idea.cta}`,
    ].join("\n");
  }

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

  // --- system prompts ---

  function buildJudgmentSystemPrompt(voiceProfile, pillarsConfig) {
    return [
      "You are the first stage of a LinkedIn content pipeline, judging a raw idea note.",
      "Given this person's voice profile and content pillars for context, do two things:",
      "1. Write a short, specific title for this idea (max 8 words).",
      "2. Judge whether the raw note already contains a full story (specific events, concrete details, a clear throughline) or whether it's thin (a fragment, a topic, missing the concrete details needed to draft a post).",
      "If it's thin, write 1-3 short, natural follow-up questions that would surface the missing concrete details.",
      "Return ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:",
      `{"title": string, "thin": boolean, "questions": string[]}`,
      "questions should be an empty array when thin is false.",
      "",
      `Role: ${voiceProfile.role || "(not specified)"}`,
      `Audience: ${voiceProfile.audience || "(not specified)"}`,
      `Content pillars: ${pillarsConfig.pillars.map((p) => p.name).join(", ") || "(none)"}`,
    ].join("\n");
  }

  function buildProposingSystemPrompt(voiceProfile, pillarsConfig, idea) {
    const pillarList = pillarsConfig.pillars.map((p) => `- ${p.name} (${p.funnelGoal}): ${p.description}`).join("\n");

    return [
      "You are the proposing stage of a LinkedIn content pipeline for one specific person.",
      "Given the story below and this person's content pillars, propose how to shape it into a post.",
      "",
      "Pick the single best-fit pillar from this exact list (use the pillar's exact name) and inherit its funnel goal:",
      pillarList,
      "",
      "Funnel goal shapes the angle and CTA:",
      "- TOFU: awareness/resonance — a soft angle, a soft or no CTA.",
      "- MOFU: engagement/consideration — an angle and CTA that invites discussion.",
      "- BOFU: direct conversion — a more direct angle, an explicit CTA (follow, DM, click a link).",
      "",
      'Propose: a storyShape (the narrative shape, e.g. "mistake -> lesson", "before/after", "contrarian take"), 3-4 hookOptions (opening lines), a chosenAngle (the specific take this post will run with, shaped by the pillar\'s funnel goal), and a cta matching that funnel goal.',
      idea.userSuppliedAngle
        ? `The person has already chosen their own angle — use it verbatim as chosenAngle, don't invent a different one: "${idea.userSuppliedAngle}"`
        : "",
      "Return ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:",
      `{"pillar": string, "storyShape": string, "hookOptions": string[], "chosenAngle": string, "cta": string}`,
      "",
      `This person's voice — role: ${voiceProfile.role || "(not specified)"}, audience: ${voiceProfile.audience || "(not specified)"}, tone rules: ${(voiceProfile.toneRules || []).join("; ") || "(none)"}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  function buildProposalRequestMessage(idea) {
    const followUps = idea.conversationHistory.slice(1);
    const followUpText = followUps.length
      ? "\n\nAdditional context from follow-up questions:\n" +
        followUps.map((t) => `${t.role === "assistant" ? "Q" : "A"}: ${t.content}`).join("\n")
      : "";
    return `Raw note: ${idea.rawNote}${followUpText}`;
  }

  function buildRevisionRequestMessage(idea, pushbackText) {
    return [
      buildProposalRequestMessage(idea),
      "",
      "Current proposal:",
      `Pillar: ${idea.pillar}`,
      `Story shape: ${idea.storyShape}`,
      `Hook options: ${(idea.hookOptions || []).join(" | ")}`,
      `Chosen angle: ${idea.chosenAngle}`,
      `CTA: ${idea.cta}`,
      "",
      `The person's feedback: ${pushbackText}`,
      "Revise the proposal accordingly.",
    ].join("\n");
  }

  // --- response parsing ---

  function parseJudgment(text) {
    try {
      const parsed = JSON.parse(stripCodeFences(text));
      return {
        title: (parsed.title || "").trim(),
        thin: !!parsed.thin,
        questions: Array.isArray(parsed.questions) ? parsed.questions.filter(Boolean).slice(0, 3) : [],
      };
    } catch (err) {
      return null;
    }
  }

  function parseProposal(text, pillarsConfig) {
    try {
      const parsed = JSON.parse(stripCodeFences(text));
      const validNames = pillarsConfig.pillars.map((p) => p.name);
      const pillarName = validNames.includes(parsed.pillar) ? parsed.pillar : validNames[0];
      const pillar = pillarsConfig.pillars.find((p) => p.name === pillarName);
      return {
        pillar: pillarName,
        funnelGoal: pillar ? pillar.funnelGoal : "TOFU",
        storyShape: parsed.storyShape || "",
        hookOptions: Array.isArray(parsed.hookOptions) ? parsed.hookOptions.filter(Boolean) : [],
        chosenAngle: parsed.chosenAngle || "",
        cta: parsed.cta || "",
      };
    } catch (err) {
      return null;
    }
  }

  function applyProposalResult(idea, parsed, { isRevision }) {
    idea.pillar = parsed.pillar;
    idea.funnelGoal = parsed.funnelGoal;
    idea.storyShape = parsed.storyShape;
    idea.hookOptions = parsed.hookOptions;
    idea.chosenAngle = idea.userSuppliedAngle || parsed.chosenAngle;
    idea.cta = parsed.cta;

    if (idea.userSuppliedAngle) {
      idea.angleSource = "User-supplied";
    } else if (isRevision) {
      idea.angleSource = "User-corrected";
    } else {
      idea.angleSource = "Agent-proposed";
    }
  }

  // --- stage runners ---

  async function runJudgment(ideaId) {
    const idea = await AppStorage.getIdea(ideaId);
    if (!idea) return;

    try {
      const [voiceProfile, pillarsConfig] = await Promise.all([AppStorage.getVoiceProfile(), AppStorage.getPillars()]);
      const response = await Api.sendMessage({
        apiKey: AppStorage.getApiKey(),
        model: AppStorage.getModelId(),
        system: buildJudgmentSystemPrompt(voiceProfile, pillarsConfig),
        messages: [{ role: "user", content: idea.rawNote }],
        maxTokens: 500,
      });
      const parsed = parseJudgment(Api.extractText(response));
      if (!parsed) throw new Error("Couldn't parse the agent's response.");

      if (parsed.title) idea.title = parsed.title;

      if (parsed.thin && parsed.questions.length) {
        idea.status = "Interviewing";
        idea.conversationHistory.push({ role: "assistant", content: formatQuestions(parsed.questions) });
        await AppStorage.saveIdea(idea);
        renderBoard();
        if (currentIdeaId === ideaId) renderIdeaPanelContent(idea);
      } else {
        await AppStorage.saveIdea(idea);
        renderBoard();
        await runProposal(ideaId);
      }
    } catch (err) {
      if (currentIdeaId === ideaId) renderInboxProcessing(idea, err.message);
    }
  }

  async function runProposal(ideaId) {
    const idea = await AppStorage.getIdea(ideaId);
    if (!idea) return;

    idea.status = "Proposing";
    await AppStorage.saveIdea(idea);
    renderBoard();
    if (currentIdeaId === ideaId) renderProposingPanel(idea, { loading: true });

    try {
      const [voiceProfile, pillarsConfig] = await Promise.all([AppStorage.getVoiceProfile(), AppStorage.getPillars()]);
      const response = await Api.sendMessage({
        apiKey: AppStorage.getApiKey(),
        model: AppStorage.getModelId(),
        system: buildProposingSystemPrompt(voiceProfile, pillarsConfig, idea),
        messages: [{ role: "user", content: buildProposalRequestMessage(idea) }],
        maxTokens: 800,
      });
      const parsed = parseProposal(Api.extractText(response), pillarsConfig);
      if (!parsed) throw new Error("Couldn't parse the agent's proposal.");

      applyProposalResult(idea, parsed, { isRevision: false });
      idea.conversationHistory.push({ role: "assistant", content: formatProposalSummary(idea) });
      await AppStorage.saveIdea(idea);
      renderBoard();
      if (currentIdeaId === ideaId) renderProposingPanel(idea);
    } catch (err) {
      if (currentIdeaId === ideaId) renderProposingPanel(idea, { error: err.message });
    }
  }

  // --- Inbox processing panel ---

  function renderInboxProcessing(idea, errorMessage) {
    const container = document.getElementById("panel-content");
    container.innerHTML = `
      <h2 id="inbox-title"></h2>
      <p class="idea-raw-note" id="inbox-raw-note"></p>
      <p id="inbox-status"></p>
    `;
    document.getElementById("inbox-title").textContent = idea.title || "New idea";
    document.getElementById("inbox-raw-note").textContent = idea.rawNote;

    const statusEl = document.getElementById("inbox-status");
    if (errorMessage) {
      statusEl.textContent = errorMessage;
      statusEl.className = "warning";
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "btn-primary";
      retryBtn.textContent = "Retry";
      retryBtn.addEventListener("click", () => runJudgment(idea.id));
      container.appendChild(retryBtn);
    } else {
      statusEl.textContent = "Thinking about whether this needs a couple follow-up questions…";
      statusEl.className = "status-pending";
    }
  }

  // --- Interviewing panel ---

  function renderInterviewPanel(idea) {
    const container = document.getElementById("panel-content");
    container.innerHTML = `
      <h2>A couple quick questions</h2>
      <div id="interview-chat-log" class="chat-log"></div>
      <form id="interview-chat-form" class="chat-form">
        <input type="text" id="interview-chat-input" placeholder="Type your answer…" autocomplete="off" />
        <button type="submit" class="btn-primary">Send</button>
      </form>
      <p id="interview-status" role="status" aria-live="polite"></p>
    `;
    renderChatLogInto("interview-chat-log", idea.conversationHistory);
    document.getElementById("interview-chat-form").addEventListener("submit", (event) => handleInterviewAnswer(event, idea.id));
  }

  async function handleInterviewAnswer(event, ideaId) {
    event.preventDefault();
    const input = document.getElementById("interview-chat-input");
    const text = input.value.trim();
    if (!text) return;

    const idea = await AppStorage.getIdea(ideaId);
    idea.conversationHistory.push({ role: "user", content: text });
    input.value = "";
    await AppStorage.saveIdea(idea);
    renderChatLogInto("interview-chat-log", idea.conversationHistory);

    const statusEl = document.getElementById("interview-status");
    statusEl.textContent = "Thanks — moving to proposing…";
    statusEl.className = "status-pending";

    await runProposal(ideaId);
  }

  // --- Proposing panel ---

  function repeatableRow(value) {
    const div = document.createElement("div");
    div.className = "repeatable-row";
    div.innerHTML = `
      <input type="text" class="repeatable-input" placeholder="Hook option" />
      <button type="button" class="remove-repeatable-btn" aria-label="Remove">&times;</button>
    `;
    div.querySelector(".repeatable-input").value = value || "";
    return div;
  }

  function renderHookOptions(container, values) {
    container.innerHTML = "";
    const items = values && values.length ? values : [""];
    items.forEach((v) => container.appendChild(repeatableRow(v)));
  }

  function readProposalFormValues() {
    return {
      pillar: document.getElementById("prop-pillar").value,
      storyShape: document.getElementById("prop-story-shape").value.trim(),
      hookOptions: Array.from(document.querySelectorAll("#prop-hooks-container .repeatable-input"))
        .map((i) => i.value.trim())
        .filter(Boolean),
      chosenAngle: document.getElementById("prop-angle").value.trim(),
      cta: document.getElementById("prop-cta").value.trim(),
    };
  }

  function applyInlineEditsToIdea(idea) {
    const values = readProposalFormValues();
    if (values.pillar) idea.pillar = values.pillar;
    if (values.storyShape) idea.storyShape = values.storyShape;
    if (values.hookOptions.length) idea.hookOptions = values.hookOptions;
    if (values.chosenAngle) idea.chosenAngle = values.chosenAngle;
    if (values.cta) idea.cta = values.cta;
  }

  async function renderProposingPanel(idea, options = {}) {
    const container = document.getElementById("panel-content");

    if (options.loading) {
      container.innerHTML = `<h2>Proposing an angle…</h2><p class="status-pending">Thinking about the best pillar, hook, and angle for this idea…</p>`;
      return;
    }

    if (options.error && !idea.pillar) {
      container.innerHTML = `
        <h2>Propose the angle</h2>
        <p class="warning" id="prop-init-error"></p>
        <button type="button" id="prop-retry-btn" class="btn-primary">Retry</button>
      `;
      document.getElementById("prop-init-error").textContent = options.error;
      document.getElementById("prop-retry-btn").addEventListener("click", () => runProposal(idea.id));
      return;
    }

    const pillarsConfig = await AppStorage.getPillars();

    container.innerHTML = `
      <h2>Propose the angle</h2>
      <p class="warning" id="prop-error" ${options.error ? "" : "hidden"}></p>
      <div class="field">
        <label for="prop-pillar">Pillar</label>
        <select id="prop-pillar"></select>
      </div>
      <div class="field">
        <label>Funnel goal</label>
        <p id="prop-funnel-goal" class="readonly-value"></p>
      </div>
      <div class="field">
        <label for="prop-story-shape">Story shape</label>
        <input type="text" id="prop-story-shape" />
      </div>
      <div class="field">
        <div class="field-header"><label>Hook options</label><button type="button" id="prop-add-hook-btn" class="btn-secondary">+ Add</button></div>
        <div id="prop-hooks-container"></div>
      </div>
      <div class="field">
        <label for="prop-angle">Chosen angle</label>
        <textarea id="prop-angle" rows="2"></textarea>
      </div>
      <div class="field">
        <label for="prop-cta">Call to action</label>
        <input type="text" id="prop-cta" />
      </div>
      <p class="idea-meta" id="prop-angle-source"></p>

      <div id="prop-chat-log" class="chat-log"></div>
      <form id="prop-chat-form" class="chat-form">
        <input type="text" id="prop-chat-input" placeholder="Ask the agent to revise anything…" autocomplete="off" />
        <button type="submit" class="btn-primary">Send</button>
      </form>
      <p id="prop-status" role="status" aria-live="polite"></p>

      <div class="step-actions">
        <button type="button" id="prop-confirm-btn" class="btn-primary">Confirm angle</button>
      </div>
    `;

    if (options.error) {
      document.getElementById("prop-error").textContent = options.error;
    }
    document.getElementById("prop-angle-source").textContent = `Angle source: ${idea.angleSource || "—"}`;

    const pillarSelect = document.getElementById("prop-pillar");
    pillarsConfig.pillars.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.name;
      opt.textContent = `${p.name} (${p.funnelGoal})`;
      pillarSelect.appendChild(opt);
    });
    pillarSelect.value = idea.pillar || (pillarsConfig.pillars[0] && pillarsConfig.pillars[0].name) || "";

    function updateFunnelGoalDisplay() {
      const p = pillarsConfig.pillars.find((pp) => pp.name === pillarSelect.value);
      document.getElementById("prop-funnel-goal").textContent = p ? p.funnelGoal : "";
    }
    updateFunnelGoalDisplay();
    pillarSelect.addEventListener("change", updateFunnelGoalDisplay);

    document.getElementById("prop-story-shape").value = idea.storyShape || "";
    document.getElementById("prop-angle").value = idea.chosenAngle || "";
    document.getElementById("prop-cta").value = idea.cta || "";

    const hooksContainer = document.getElementById("prop-hooks-container");
    renderHookOptions(hooksContainer, idea.hookOptions);
    document.getElementById("prop-add-hook-btn").addEventListener("click", () => {
      hooksContainer.appendChild(repeatableRow(""));
    });
    hooksContainer.addEventListener("click", (event) => {
      const btn = event.target.closest(".remove-repeatable-btn");
      if (btn) btn.closest(".repeatable-row").remove();
    });

    renderChatLogInto("prop-chat-log", idea.conversationHistory);
    document.getElementById("prop-chat-form").addEventListener("submit", (event) => handleProposalChatSubmit(event, idea.id));
    document.getElementById("prop-confirm-btn").addEventListener("click", () => handleConfirmProposal(idea.id));
  }

  async function handleProposalChatSubmit(event, ideaId) {
    event.preventDefault();
    const input = document.getElementById("prop-chat-input");
    const text = input.value.trim();
    if (!text) return;

    const idea = await AppStorage.getIdea(ideaId);
    applyInlineEditsToIdea(idea);

    idea.conversationHistory.push({ role: "user", content: text });
    input.value = "";
    await AppStorage.saveIdea(idea);
    renderChatLogInto("prop-chat-log", idea.conversationHistory);

    const statusEl = document.getElementById("prop-status");
    statusEl.textContent = "Thinking…";
    statusEl.className = "status-pending";

    try {
      const [voiceProfile, pillarsConfig] = await Promise.all([AppStorage.getVoiceProfile(), AppStorage.getPillars()]);
      const response = await Api.sendMessage({
        apiKey: AppStorage.getApiKey(),
        model: AppStorage.getModelId(),
        system: buildProposingSystemPrompt(voiceProfile, pillarsConfig, idea),
        messages: [{ role: "user", content: buildRevisionRequestMessage(idea, text) }],
        maxTokens: 800,
      });
      const parsed = parseProposal(Api.extractText(response), pillarsConfig);
      if (!parsed) throw new Error("Couldn't parse the agent's revised proposal.");

      applyProposalResult(idea, parsed, { isRevision: true });
      idea.conversationHistory.push({ role: "assistant", content: formatProposalSummary(idea) });
      await AppStorage.saveIdea(idea);
      renderBoard();
      if (currentIdeaId === ideaId) renderProposingPanel(idea);
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = "status-error";
    }
  }

  async function handleConfirmProposal(ideaId) {
    const statusEl = document.getElementById("prop-status");
    const idea = await AppStorage.getIdea(ideaId);
    const values = readProposalFormValues();
    const pillarsConfig = await AppStorage.getPillars();
    const selectedPillar = pillarsConfig.pillars.find((p) => p.name === values.pillar);

    if (!values.pillar || !values.storyShape || !values.chosenAngle || !values.cta || values.hookOptions.length === 0) {
      statusEl.textContent = "Fill in pillar, story shape, at least one hook, angle, and CTA before confirming.";
      statusEl.className = "status-error";
      return;
    }

    const angleChanged = values.chosenAngle !== idea.chosenAngle;

    idea.pillar = values.pillar;
    idea.funnelGoal = selectedPillar ? selectedPillar.funnelGoal : idea.funnelGoal;
    idea.storyShape = values.storyShape;
    idea.hookOptions = values.hookOptions;
    idea.chosenAngle = values.chosenAngle;
    idea.cta = values.cta;

    if (angleChanged && idea.angleSource !== "User-supplied") {
      idea.angleSource = "User-corrected";
    }

    await AppStorage.saveIdea(idea);
    statusEl.textContent = "Angle confirmed and saved.";
    statusEl.className = "status-success";
    document.getElementById("prop-angle-source").textContent = `Angle source: ${idea.angleSource}`;
    renderBoard();
  }

  // --- read-only fallback (Drafting/Ready to Post/Posted — later phases) ---

  function renderReadOnlyPanel(idea) {
    const container = document.getElementById("panel-content");
    container.innerHTML = `<h2 id="ro-title"></h2><p class="idea-meta" id="ro-status"></p><p id="ro-note"></p>`;
    document.getElementById("ro-title").textContent = idea.title || "(untitled)";
    document.getElementById("ro-status").textContent = `Status: ${idea.status}`;
    document.getElementById("ro-note").textContent = "Drafting and beyond come in a later phase.";
  }

  // --- panel shell + new-idea form ---

  function ensurePanelExists() {
    if (document.getElementById("idea-panel-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "idea-panel-overlay";
    overlay.className = "panel-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="panel">
        <button type="button" id="panel-close-btn" class="panel-close" aria-label="Close">&times;</button>
        <div id="panel-content"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("panel-close-btn").addEventListener("click", closePanel);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closePanel();
    });
  }

  function showPanel() {
    document.getElementById("idea-panel-overlay").hidden = false;
  }

  function closePanel() {
    document.getElementById("idea-panel-overlay").hidden = true;
    currentIdeaId = null;
  }

  function openNewIdeaPanel() {
    currentIdeaId = null;
    showPanel();
    renderNewIdeaForm();
  }

  function renderNewIdeaForm() {
    const container = document.getElementById("panel-content");
    container.innerHTML = `
      <h2>New idea</h2>
      <div class="field">
        <label for="new-idea-note">What's the idea?</label>
        <textarea id="new-idea-note" rows="5" placeholder="Paste a raw note, a rough story, anything..."></textarea>
      </div>
      <div class="field">
        <label for="new-idea-angle">Your own angle (optional)</label>
        <input type="text" id="new-idea-angle" placeholder="Skip this if you want the agent to propose one" />
      </div>
      <p id="new-idea-error" role="status" aria-live="polite"></p>
      <div class="step-actions">
        <button type="button" id="new-idea-cancel-btn" class="btn-secondary">Cancel</button>
        <button type="button" id="new-idea-submit-btn" class="btn-primary">Create idea</button>
      </div>
    `;
    document.getElementById("new-idea-cancel-btn").addEventListener("click", closePanel);
    document.getElementById("new-idea-submit-btn").addEventListener("click", createIdea);
  }

  async function createIdea() {
    const noteInput = document.getElementById("new-idea-note");
    const angleInput = document.getElementById("new-idea-angle");
    const errorEl = document.getElementById("new-idea-error");
    const rawNote = noteInput.value.trim();
    const userAngle = angleInput.value.trim();

    if (!rawNote) {
      errorEl.textContent = "Add a raw note before creating the idea.";
      errorEl.className = "status-error";
      return;
    }

    const idea = {
      id: crypto.randomUUID(),
      title: rawNote.slice(0, 60),
      rawNote,
      dateAdded: new Date().toISOString(),
      status: "Inbox",
      pillar: null,
      funnelGoal: null,
      storyShape: null,
      hookOptions: [],
      chosenAngle: null,
      angleSource: null,
      cta: null,
      draft: null,
      postedText: null,
      conversationHistory: [{ role: "user", content: rawNote }],
      datePosted: null,
      userSuppliedAngle: userAngle || null,
    };

    await AppStorage.saveIdea(idea);
    renderBoard();
    await openIdeaPanel(idea.id);
    runJudgment(idea.id);
  }

  async function openIdeaPanel(ideaId) {
    currentIdeaId = ideaId;
    const idea = await AppStorage.getIdea(ideaId);
    if (!idea) return;
    showPanel();
    renderIdeaPanelContent(idea);
  }

  function renderIdeaPanelContent(idea) {
    if (idea.status === "Inbox") renderInboxProcessing(idea, null);
    else if (idea.status === "Interviewing") renderInterviewPanel(idea);
    else if (idea.status === "Proposing") renderProposingPanel(idea);
    else renderReadOnlyPanel(idea);
  }

  // --- board rendering ---

  function ideaCardTemplate(idea) {
    const card = document.createElement("div");
    card.className = "idea-card";
    card.dataset.id = idea.id;

    const titleEl = document.createElement("div");
    titleEl.className = "idea-card-title";
    titleEl.textContent = idea.title || "(untitled)";
    card.appendChild(titleEl);

    if (idea.pillar) {
      const metaEl = document.createElement("div");
      metaEl.className = "idea-card-meta";
      metaEl.textContent = idea.funnelGoal ? `${idea.pillar} · ${idea.funnelGoal}` : idea.pillar;
      card.appendChild(metaEl);
    }

    card.addEventListener("click", () => openIdeaPanel(idea.id));
    return card;
  }

  async function renderBoard() {
    const root = document.getElementById("board-root");
    if (!root) return;

    const ideas = await AppStorage.getIdeas();

    root.innerHTML = `
      <div class="board-header">
        <button type="button" id="new-idea-btn" class="btn-primary">+ New idea</button>
      </div>
      <div class="board-columns"></div>
    `;
    document.getElementById("new-idea-btn").addEventListener("click", openNewIdeaPanel);

    const columnsEl = root.querySelector(".board-columns");
    STATUSES.forEach((status) => {
      const columnIdeas = ideas
        .filter((i) => i.status === status)
        .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));

      const column = document.createElement("div");
      column.className = "board-column";

      const header = document.createElement("h3");
      header.textContent = `${status} (${columnIdeas.length})`;
      column.appendChild(header);

      const cardsContainer = document.createElement("div");
      cardsContainer.className = "column-cards";
      columnIdeas.forEach((idea) => cardsContainer.appendChild(ideaCardTemplate(idea)));
      column.appendChild(cardsContainer);

      columnsEl.appendChild(column);
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;
    ensurePanelExists();
    renderBoard();
  }

  return { init, renderBoard };
})();
