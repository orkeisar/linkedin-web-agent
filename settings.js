// Settings view: API key management, model selection, full editability of
// pillars/voiceProfile/learnedGuidelines, JSON export/import, and reset.

const Settings = (() => {
  // --- shared field helpers (same pattern as onboarding.js/pipeline.js) ---

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

  // --- shell ---

  function render() {
    const container = document.getElementById("view-settings");
    container.innerHTML = `
      <h2>Settings</h2>

      <section class="settings-section">
        <h3>API key</h3>
        <p id="settings-key-status" class="idea-meta"></p>
        <div class="field">
          <label for="settings-key-input">New Anthropic API key</label>
          <input type="password" id="settings-key-input" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" />
        </div>
        <p id="settings-key-msg" role="status" aria-live="polite"></p>
        <div class="step-actions">
          <button type="button" id="settings-key-test-btn" class="btn-primary">Test &amp; save</button>
          <button type="button" id="settings-key-clear-btn" class="btn-secondary">Clear saved key</button>
        </div>
      </section>

      <section class="settings-section">
        <h3>Model</h3>
        <div class="field">
          <label for="settings-model-select">Claude model</label>
          <select id="settings-model-select">
            <option value="claude-sonnet-5">Sonnet 5 (default)</option>
            <option value="claude-opus-4-8">Opus 4.8</option>
            <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
            <option value="claude-fable-5">Fable 5</option>
          </select>
        </div>
        <p id="settings-model-msg" role="status" aria-live="polite"></p>
      </section>

      <section class="settings-section">
        <h3>Pillars</h3>
        <div class="field">
          <label for="settings-recipient-name">Your name (optional)</label>
          <input type="text" id="settings-recipient-name" />
        </div>
        <div class="field">
          <label for="settings-strategy-notes">Content strategy notes (optional)</label>
          <textarea id="settings-strategy-notes" rows="3"></textarea>
        </div>
        <div class="field">
          <div class="field-header">
            <label>Pillars</label>
            <button type="button" id="settings-add-pillar-btn" class="btn-secondary">+ Add pillar</button>
          </div>
          <div id="settings-pillars-container"></div>
        </div>
        <p id="settings-pillars-msg" role="status" aria-live="polite"></p>
        <button type="button" id="settings-save-pillars-btn" class="btn-primary">Save pillars</button>
      </section>

      <section class="settings-section">
        <h3>Voice profile</h3>
        <div class="field"><label for="settings-vp-role">Role</label><input type="text" id="settings-vp-role" /></div>
        <div class="field"><label for="settings-vp-audience">Audience</label><input type="text" id="settings-vp-audience" /></div>
        <div class="field"><label for="settings-vp-goals">Goals (optional)</label><textarea id="settings-vp-goals" rows="2"></textarea></div>
        <div class="field">
          <div class="field-header"><label>Tone rules (optional)</label><button type="button" id="settings-vp-tone-add" class="btn-secondary">+ Add</button></div>
          <div id="settings-vp-tone-container"></div>
        </div>
        <div class="field"><label for="settings-vp-structure">Structural patterns (optional)</label><textarea id="settings-vp-structure" rows="2"></textarea></div>
        <div class="field"><label for="settings-vp-hashtags">Hashtags/emoji policy (optional)</label><input type="text" id="settings-vp-hashtags" /></div>
        <div class="field">
          <div class="field-header"><label>Forbidden phrases (optional)</label><button type="button" id="settings-vp-forbidden-add" class="btn-secondary">+ Add</button></div>
          <div id="settings-vp-forbidden-container"></div>
        </div>
        <div class="field">
          <div class="field-header"><label>Avoided post types (optional)</label><button type="button" id="settings-vp-avoided-add" class="btn-secondary">+ Add</button></div>
          <div id="settings-vp-avoided-container"></div>
        </div>
        <div class="field">
          <div class="field-header"><label>Admired examples (optional)</label><button type="button" id="settings-vp-admired-add" class="btn-secondary">+ Add</button></div>
          <div id="settings-vp-admired-container"></div>
        </div>
        <div class="field">
          <div class="field-header"><label>Writing samples (optional)</label><button type="button" id="settings-vp-samples-add" class="btn-secondary">+ Add</button></div>
          <div id="settings-vp-samples-container"></div>
        </div>
        <p id="settings-profile-msg" role="status" aria-live="polite"></p>
        <button type="button" id="settings-save-profile-btn" class="btn-primary">Save voice profile</button>
      </section>

      <section class="settings-section">
        <h3>Learned guidelines</h3>
        <p>Patterns the agent has picked up from comparing your drafts to what you actually posted. Delete anything that's wrong.</p>
        <div id="settings-guidelines-container"></div>
        <div class="field" id="settings-add-guideline-form" hidden>
          <label for="settings-new-guideline-desc">Pattern description</label>
          <textarea id="settings-new-guideline-desc" rows="2" placeholder='e.g. "removes rhetorical questions from hooks"'></textarea>
          <div class="step-actions">
            <button type="button" id="settings-new-guideline-cancel" class="btn-secondary">Cancel</button>
            <button type="button" id="settings-new-guideline-save" class="btn-primary">Add</button>
          </div>
        </div>
        <button type="button" id="settings-add-guideline-btn" class="btn-secondary">+ Add manually</button>
      </section>

      <section class="settings-section">
        <h3>Backup</h3>
        <p>Export everything (pillars, voice profile, learned guidelines, ideas) as a JSON file. Your API key is never included. Importing replaces the current data in this browser with the file's contents.</p>
        <div class="step-actions">
          <button type="button" id="settings-export-btn" class="btn-secondary">Export data</button>
          <button type="button" id="settings-import-btn" class="btn-secondary">Import data</button>
          <input type="file" id="settings-import-file" accept="application/json" hidden />
        </div>
        <p id="settings-backup-msg" role="status" aria-live="polite"></p>
      </section>

      <section class="settings-section settings-danger">
        <h3>Reset</h3>
        <p>Clears your API key, pillars, voice profile, learned guidelines, and every idea in this browser. This can't be undone.</p>
        <button type="button" id="settings-reset-btn" class="btn-danger">Reset all data</button>
      </section>
    `;

    renderApiKeySection();
    renderModelSection();
    renderPillarsSection();
    renderVoiceProfileSection();
    renderGuidelinesList();
    wireGuidelinesForm();
    renderBackupSection();
    document.getElementById("settings-reset-btn").addEventListener("click", handleReset);
  }

  // --- API key ---

  function renderApiKeySection() {
    const hasKey = !!AppStorage.getApiKey();
    document.getElementById("settings-key-status").textContent = hasKey
      ? "A key is currently saved in this browser."
      : "No key saved.";
    document.getElementById("settings-key-test-btn").addEventListener("click", handleTestAndSaveKey);
    document.getElementById("settings-key-clear-btn").addEventListener("click", handleClearKey);
  }

  async function handleTestAndSaveKey() {
    const input = document.getElementById("settings-key-input");
    const btn = document.getElementById("settings-key-test-btn");
    const msgEl = document.getElementById("settings-key-msg");
    const apiKey = input.value.trim();

    if (!apiKey) {
      msgEl.textContent = "Enter a key first.";
      msgEl.className = "status-error";
      return;
    }

    btn.disabled = true;
    msgEl.textContent = "Testing connection…";
    msgEl.className = "status-pending";

    try {
      await Api.testConnection({ apiKey, model: AppStorage.getModelId() });
      AppStorage.setApiKey(apiKey);
      msgEl.textContent = "Connected — key saved.";
      msgEl.className = "status-success";
      input.value = "";
      document.getElementById("settings-key-status").textContent = "A key is currently saved in this browser.";
    } catch (err) {
      msgEl.textContent = err.message;
      msgEl.className = "status-error";
    } finally {
      btn.disabled = false;
    }
  }

  function handleClearKey() {
    AppStorage.clearApiKey();
    document.getElementById("settings-key-status").textContent = "No key saved.";
    const msgEl = document.getElementById("settings-key-msg");
    msgEl.textContent = "Key cleared.";
    msgEl.className = "status-success";
  }

  // --- model ---

  function renderModelSection() {
    const select = document.getElementById("settings-model-select");
    select.value = AppStorage.getModelId();
    select.addEventListener("change", () => {
      AppStorage.setModelId(select.value);
      const msgEl = document.getElementById("settings-model-msg");
      msgEl.textContent = "Saved.";
      msgEl.className = "status-success";
    });
  }

  // --- pillars ---

  async function renderPillarsSection() {
    const pillars = (await AppStorage.getPillars()) || AppStorage.emptyPillars();
    document.getElementById("settings-recipient-name").value = pillars.recipientName || "";
    document.getElementById("settings-strategy-notes").value = pillars.contentStrategyNotes || "";

    const container = document.getElementById("settings-pillars-container");
    const list = pillars.pillars.length ? pillars.pillars : [{}];
    list.forEach((p) => container.appendChild(pillarBlockTemplate(p)));

    document.getElementById("settings-add-pillar-btn").addEventListener("click", () => {
      container.appendChild(pillarBlockTemplate({}));
    });
    container.addEventListener("click", (event) => {
      const removeBtn = event.target.closest(".remove-pillar-btn");
      if (removeBtn) {
        removeBtn.closest(".pillar-block").remove();
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

    document.getElementById("settings-save-pillars-btn").addEventListener("click", handleSavePillars);
  }

  function validatePillarBlocks(blocks) {
    const nonEmpty = blocks.filter((b) => b.name || b.description || b.exampleAngles.length);
    for (let i = 0; i < nonEmpty.length; i++) {
      if (!nonEmpty[i].name) return { error: `Pillar ${i + 1} needs a name.` };
      if (!nonEmpty[i].description) return { error: `Pillar ${i + 1} needs a description.` };
    }
    return { pillars: nonEmpty };
  }

  async function handleSavePillars() {
    const msgEl = document.getElementById("settings-pillars-msg");
    const recipientName = document.getElementById("settings-recipient-name").value.trim();
    const contentStrategyNotes = document.getElementById("settings-strategy-notes").value.trim();
    const blocks = Array.from(document.querySelectorAll("#settings-pillars-container .pillar-block")).map((block) => ({
      name: block.querySelector(".pillar-name").value.trim(),
      description: block.querySelector(".pillar-description").value.trim(),
      funnelGoal: block.querySelector(".pillar-funnel-goal").value,
      exampleAngles: Array.from(block.querySelectorAll(".angle-input"))
        .map((i) => i.value.trim())
        .filter(Boolean),
    }));

    const validation = validatePillarBlocks(blocks);
    if (validation.error) {
      msgEl.textContent = validation.error;
      msgEl.className = "status-error";
      return;
    }

    await AppStorage.savePillars({ recipientName, contentStrategyNotes, pillars: validation.pillars });
    msgEl.textContent = "Saved.";
    msgEl.className = "status-success";
  }

  // --- voice profile ---

  async function renderVoiceProfileSection() {
    const vp = (await AppStorage.getVoiceProfile()) || {};
    document.getElementById("settings-vp-role").value = vp.role || "";
    document.getElementById("settings-vp-audience").value = vp.audience || "";
    document.getElementById("settings-vp-goals").value = vp.goals || "";
    document.getElementById("settings-vp-structure").value = vp.structuralPatterns || "";
    document.getElementById("settings-vp-hashtags").value = vp.hashtagsEmojiPolicy || "";

    setupRepeatableField("settings-vp-tone-container", "settings-vp-tone-add", vp.toneRules, {
      placeholder: 'e.g. "no rhetorical questions in hooks"',
    });
    setupRepeatableField("settings-vp-forbidden-container", "settings-vp-forbidden-add", vp.forbiddenPhrases, {
      placeholder: 'e.g. "game-changer"',
    });
    setupRepeatableField("settings-vp-avoided-container", "settings-vp-avoided-add", vp.avoidedPostTypes, {
      placeholder: "e.g. generic listicles",
    });
    setupRepeatableField("settings-vp-admired-container", "settings-vp-admired-add", vp.admiredExamples, {
      placeholder: "e.g. a post or account you admire",
    });
    setupRepeatableField("settings-vp-samples-container", "settings-vp-samples-add", vp.rawExamples, {
      placeholder: "Paste a writing sample…",
      multiline: true,
    });

    document.getElementById("settings-save-profile-btn").addEventListener("click", handleSaveVoiceProfile);
  }

  async function handleSaveVoiceProfile() {
    const msgEl = document.getElementById("settings-profile-msg");
    const role = document.getElementById("settings-vp-role").value.trim();
    const audience = document.getElementById("settings-vp-audience").value.trim();
    if (!role || !audience) {
      msgEl.textContent = "Role and audience are required.";
      msgEl.className = "status-error";
      return;
    }

    const existing = (await AppStorage.getVoiceProfile()) || {};
    const voiceProfile = {
      role,
      audience,
      goals: document.getElementById("settings-vp-goals").value.trim(),
      toneRules: collectRepeatableList(document.getElementById("settings-vp-tone-container")),
      structuralPatterns: document.getElementById("settings-vp-structure").value.trim(),
      hashtagsEmojiPolicy: document.getElementById("settings-vp-hashtags").value.trim(),
      forbiddenPhrases: collectRepeatableList(document.getElementById("settings-vp-forbidden-container")),
      avoidedPostTypes: collectRepeatableList(document.getElementById("settings-vp-avoided-container")),
      admiredExamples: collectRepeatableList(document.getElementById("settings-vp-admired-container")),
      rawExamples: collectRepeatableList(document.getElementById("settings-vp-samples-container")),
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await AppStorage.saveVoiceProfile(voiceProfile);
    msgEl.textContent = "Saved.";
    msgEl.className = "status-success";
  }

  // --- learned guidelines ---

  // Rebuilds only the guideline cards -- safe to call repeatedly (after
  // add/edit/delete) since each card is a freshly created element. The
  // add-form's buttons are static, persistent elements wired exactly once
  // by wireGuidelinesForm() (called only from the top-level render()), so
  // re-running this never stacks duplicate listeners on them.
  async function renderGuidelinesList() {
    const guidelines = await AppStorage.getLearnedGuidelines();
    const container = document.getElementById("settings-guidelines-container");
    container.innerHTML = "";

    if (!guidelines.length) {
      const p = document.createElement("p");
      p.className = "idea-meta";
      p.textContent = "No learned guidelines yet.";
      container.appendChild(p);
    } else {
      guidelines
        .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
        .forEach((g) => container.appendChild(guidelineCardTemplate(g)));
    }
  }

  function wireGuidelinesForm() {
    const addBtn = document.getElementById("settings-add-guideline-btn");
    const form = document.getElementById("settings-add-guideline-form");
    addBtn.addEventListener("click", () => {
      form.hidden = false;
      addBtn.hidden = true;
      document.getElementById("settings-new-guideline-desc").focus();
    });
    document.getElementById("settings-new-guideline-cancel").addEventListener("click", () => {
      form.hidden = true;
      addBtn.hidden = false;
      document.getElementById("settings-new-guideline-desc").value = "";
    });
    document.getElementById("settings-new-guideline-save").addEventListener("click", handleAddGuideline);
  }

  function guidelineCardTemplate(guideline) {
    const card = document.createElement("div");
    card.className = "pillar-block";
    card.innerHTML = `
      <div class="pillar-block-header">
        <strong class="guideline-date"></strong>
        <button type="button" class="remove-pillar-btn">Delete</button>
      </div>
      <label>Description
        <textarea class="guideline-description" rows="2"></textarea>
      </label>
      <p class="idea-meta guideline-evidence"></p>
      <button type="button" class="btn-secondary guideline-save-btn">Save changes</button>
    `;
    card.querySelector(".guideline-date").textContent = guideline.dateAdded
      ? new Date(guideline.dateAdded).toLocaleDateString()
      : "Added manually";
    card.querySelector(".guideline-description").value = guideline.description || "";

    const evidence = guideline.evidence || {};
    const evidenceEl = card.querySelector(".guideline-evidence");
    if (evidence.draftExcerpt || evidence.postedExcerpt) {
      evidenceEl.textContent = `Draft: "${evidence.draftExcerpt || ""}" → Posted: "${evidence.postedExcerpt || ""}"`;
    } else {
      evidenceEl.hidden = true;
    }

    card.querySelector(".remove-pillar-btn").addEventListener("click", () => handleDeleteGuideline(guideline.id));
    card.querySelector(".guideline-save-btn").addEventListener("click", () => handleSaveGuideline(guideline, card));
    return card;
  }

  async function handleDeleteGuideline(id) {
    await AppStorage.deleteLearnedGuideline(id);
    renderGuidelinesList();
  }

  async function handleSaveGuideline(guideline, card) {
    const newDescription = card.querySelector(".guideline-description").value.trim();
    if (!newDescription) return;
    await AppStorage.saveLearnedGuideline({ ...guideline, description: newDescription });
    renderGuidelinesList();
  }

  async function handleAddGuideline() {
    const textarea = document.getElementById("settings-new-guideline-desc");
    const description = textarea.value.trim();
    if (!description) return;
    await AppStorage.saveLearnedGuideline({
      id: crypto.randomUUID(),
      description,
      evidence: { draftExcerpt: "", postedExcerpt: "" },
      dateAdded: new Date().toISOString(),
    });
    textarea.value = "";
    document.getElementById("settings-add-guideline-form").hidden = true;
    document.getElementById("settings-add-guideline-btn").hidden = false;
    renderGuidelinesList();
  }

  // --- backup: export / import ---

  function renderBackupSection() {
    document.getElementById("settings-export-btn").addEventListener("click", handleExport);
    document.getElementById("settings-import-btn").addEventListener("click", () => {
      document.getElementById("settings-import-file").click();
    });
    document.getElementById("settings-import-file").addEventListener("change", handleImportFileSelected);
  }

  async function handleExport() {
    const msgEl = document.getElementById("settings-backup-msg");
    try {
      const [pillars, voiceProfile, learnedGuidelines, ideas] = await Promise.all([
        AppStorage.getPillars(),
        AppStorage.getVoiceProfile(),
        AppStorage.getLearnedGuidelines(),
        AppStorage.getIdeas(),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        version: 1,
        pillars: pillars || AppStorage.emptyPillars(),
        voiceProfile: voiceProfile || null,
        learnedGuidelines,
        ideas,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `linkedin-story-pipeline-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      msgEl.textContent = "Exported.";
      msgEl.className = "status-success";
    } catch (err) {
      msgEl.textContent = `Couldn't export: ${err.message}`;
      msgEl.className = "status-error";
    }
  }

  // Pure restore logic, reused by the onboarding "restore from backup" path
  // so a completely fresh browser can skip onboarding entirely.
  // Validates shape BEFORE writing anything, so a malformed file can't
  // leave the stores in a mixed old/new state (some pieces imported,
  // others not) or crash a later render on an unexpected shape.
  function validateImportPayload(parsed) {
    if (!parsed || typeof parsed !== "object") {
      return "That doesn't look like a valid export file.";
    }
    if (parsed.pillars !== undefined) {
      if (typeof parsed.pillars !== "object" || parsed.pillars === null || !Array.isArray(parsed.pillars.pillars)) {
        return "The pillars section of that file isn't shaped right.";
      }
    }
    if (parsed.voiceProfile !== undefined && parsed.voiceProfile !== null) {
      if (typeof parsed.voiceProfile !== "object") {
        return "The voice profile section of that file isn't shaped right.";
      }
    }
    if (parsed.learnedGuidelines !== undefined && !Array.isArray(parsed.learnedGuidelines)) {
      return "The learned guidelines section of that file isn't shaped right.";
    }
    if (parsed.ideas !== undefined && !Array.isArray(parsed.ideas)) {
      return "The ideas section of that file isn't shaped right.";
    }
    return null;
  }

  async function performImport(jsonText) {
    const parsed = JSON.parse(jsonText);
    const validationError = validateImportPayload(parsed);
    if (validationError) throw new Error(validationError);

    if (parsed.pillars) await AppStorage.savePillars(parsed.pillars);
    if (parsed.voiceProfile) await AppStorage.saveVoiceProfile(parsed.voiceProfile);
    await AppStorage.replaceLearnedGuidelines(Array.isArray(parsed.learnedGuidelines) ? parsed.learnedGuidelines : []);
    await AppStorage.replaceIdeas(Array.isArray(parsed.ideas) ? parsed.ideas : []);
  }

  async function handleImportFileSelected(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;

    const msgEl = document.getElementById("settings-backup-msg");
    try {
      const text = await file.text();
      await performImport(text);
      msgEl.textContent = "Imported. Reloading…";
      msgEl.className = "status-success";
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      msgEl.textContent = `Couldn't import: ${err.message}`;
      msgEl.className = "status-error";
    }
  }

  // --- reset ---

  async function handleReset() {
    const confirmed = window.confirm(
      "This clears your API key, pillars, voice profile, learned guidelines, and every idea in this browser. This can't be undone. Continue?"
    );
    if (!confirmed) return;

    AppStorage.clearApiKey();
    AppStorage.clearModelId();
    await AppStorage.clearAllData();
    window.location.reload();
  }

  return { render, performImport };
})();
