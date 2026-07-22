// Bootstrap + view routing for index.html: decode the `c` link-config
// param on first load, seed pillars, strip the URL, then route to the
// onboarding wizard (if no voiceProfile yet) or straight to the nav shell.

const App = (() => {
  function showAppShell() {
    document.getElementById("onboarding-view").hidden = true;
    document.getElementById("app-shell").hidden = false;
    Pipeline.init();
  }

  function switchView(viewName) {
    document.querySelectorAll("#view-container > section").forEach((section) => {
      section.hidden = section.id !== `view-${viewName}`;
    });
    document.querySelectorAll(".nav-link").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === viewName);
    });
    if (viewName === "settings") {
      Settings.render();
    }
  }

  function isValidPillarsConfig(config) {
    return !!config && typeof config === "object" && Array.isArray(config.pillars);
  }

  // --- reauth: any Api call anywhere in the app can hit an expired/invalid
  // key. handleAuthError() lets a catch block hand off a 401 here and
  // automatically retry once the user provides a working key. ---

  function ensureReauthModalExists() {
    if (document.getElementById("reauth-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "reauth-overlay";
    overlay.className = "panel-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="panel">
        <h2>Your API key was rejected</h2>
        <p id="reauth-reason"></p>
        <div class="field">
          <label for="reauth-key-input">New Anthropic API key</label>
          <input type="password" id="reauth-key-input" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" />
        </div>
        <p id="reauth-status" role="status" aria-live="polite"></p>
        <div class="step-actions">
          <button type="button" id="reauth-cancel-btn" class="btn-secondary">Cancel</button>
          <button type="button" id="reauth-save-btn" class="btn-primary">Test &amp; save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  // Serialize concurrent reauth requests through one queue -- two Api calls
  // can independently hit a 401 around the same time (e.g. two ideas
  // created back-to-back), and the modal is a singleton DOM node. Without
  // this, overlapping calls would each wire a fresh pair of Save/Cancel
  // listeners onto the same buttons, so a single click could fire every
  // stacked handler at once.
  let reauthQueue = Promise.resolve();

  function promptForNewKey(reasonMessage) {
    const next = reauthQueue.then(() => promptForNewKeyOnce(reasonMessage));
    reauthQueue = next;
    return next;
  }

  function promptForNewKeyOnce(reasonMessage) {
    ensureReauthModalExists();
    const overlay = document.getElementById("reauth-overlay");
    const input = document.getElementById("reauth-key-input");
    const statusEl = document.getElementById("reauth-status");
    const saveBtn = document.getElementById("reauth-save-btn");
    const cancelBtn = document.getElementById("reauth-cancel-btn");

    document.getElementById("reauth-reason").textContent =
      reasonMessage || "Your saved Anthropic API key was rejected.";
    input.value = "";
    statusEl.textContent = "";
    statusEl.className = "";
    overlay.hidden = false;
    input.focus();

    return new Promise((resolve) => {
      function cleanup() {
        overlay.hidden = true;
        saveBtn.removeEventListener("click", onSave);
        cancelBtn.removeEventListener("click", onCancel);
      }
      function onCancel() {
        cleanup();
        resolve(false);
      }
      async function onSave() {
        const apiKey = input.value.trim();
        if (!apiKey) {
          statusEl.textContent = "Enter an API key.";
          statusEl.className = "status-error";
          return;
        }
        saveBtn.disabled = true;
        statusEl.textContent = "Testing connection…";
        statusEl.className = "status-pending";
        try {
          await Api.testConnection({ apiKey, model: AppStorage.getModelId() });
          AppStorage.setApiKey(apiKey);
          cleanup();
          resolve(true);
        } catch (err) {
          statusEl.textContent = err.message;
          statusEl.className = "status-error";
        } finally {
          saveBtn.disabled = false;
        }
      }
      saveBtn.addEventListener("click", onSave);
      cancelBtn.addEventListener("click", onCancel);
    });
  }

  async function handleAuthError(err, retryFn) {
    if (err.status !== 401) return false;
    const gotNewKey = await promptForNewKey(err.message);
    if (gotNewKey && retryFn) {
      // Await the retry fully before returning: callers that return right
      // after this resolves also run their own `finally` block (re-enabling
      // buttons/inputs), which would race with an in-flight retry and let
      // the user submit again mid-request if we didn't wait for it here.
      await retryFn();
      return true;
    }
    return false;
  }

  async function seedPillarsFromLink() {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get(LinkConfig.QUERY_PARAM);
    if (!encoded) return;

    const decoded = LinkConfig.decodeConfig(encoded);
    if (isValidPillarsConfig(decoded)) {
      await AppStorage.savePillars(decoded);
    }

    const url = new URL(window.location.href);
    url.searchParams.delete(LinkConfig.QUERY_PARAM);
    history.replaceState({}, "", url.toString());
  }

  async function init() {
    document.querySelectorAll(".nav-link").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
    switchView("board");

    try {
      await seedPillarsFromLink();
      const voiceProfile = await AppStorage.getVoiceProfile();
      if (voiceProfile) {
        showAppShell();
      } else {
        const pillars = (await AppStorage.getPillars()) || AppStorage.emptyPillars();
        Onboarding.start(pillars);
      }
    } catch (err) {
      Onboarding.start(AppStorage.emptyPillars());
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  return { showAppShell, switchView, promptForNewKey, handleAuthError };
})();
