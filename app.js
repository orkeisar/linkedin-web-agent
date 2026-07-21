// Bootstrap + view routing for index.html: API key gate on first load,
// then nav routing between placeholder views. First-load `c` param
// decoding (linkConfig.js) lands in Phase 3.

(function () {
  function showLanding() {
    document.getElementById("landing-view").hidden = false;
    document.getElementById("app-shell").hidden = true;
  }

  function showAppShell() {
    document.getElementById("landing-view").hidden = true;
    document.getElementById("app-shell").hidden = false;
  }

  function setStatus(message, type) {
    const statusEl = document.getElementById("connection-status");
    statusEl.textContent = message;
    statusEl.className = type ? `status-${type}` : "";
  }

  function switchView(viewName) {
    document.querySelectorAll("#view-container > section").forEach((section) => {
      section.hidden = section.id !== `view-${viewName}`;
    });
    document.querySelectorAll(".nav-link").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === viewName);
    });
  }

  async function handleTestConnection() {
    const input = document.getElementById("api-key-input");
    const button = document.getElementById("test-connection-btn");
    const apiKey = input.value.trim();

    if (!apiKey) {
      setStatus("Enter an API key first.", "error");
      return;
    }

    button.disabled = true;
    setStatus("Testing connection…", "pending");

    try {
      await Api.testConnection({ apiKey, model: AppStorage.getModelId() });
      AppStorage.setApiKey(apiKey);
      setStatus("Connected — key saved.", "success");
      setTimeout(showAppShell, 1500);
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  function init() {
    document.getElementById("test-connection-btn").addEventListener("click", handleTestConnection);
    document.querySelectorAll(".nav-link").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
    switchView("board");

    if (AppStorage.getApiKey()) {
      showAppShell();
    } else {
      showLanding();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
