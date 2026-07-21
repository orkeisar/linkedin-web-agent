// Bootstrap + view routing for index.html: decode the `c` link-config
// param on first load, seed pillars, strip the URL, then route to the
// onboarding wizard (if no voiceProfile yet) or straight to the nav shell.

const App = (() => {
  function showAppShell() {
    document.getElementById("onboarding-view").hidden = true;
    document.getElementById("app-shell").hidden = false;
  }

  function switchView(viewName) {
    document.querySelectorAll("#view-container > section").forEach((section) => {
      section.hidden = section.id !== `view-${viewName}`;
    });
    document.querySelectorAll(".nav-link").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === viewName);
    });
  }

  function isValidPillarsConfig(config) {
    return !!config && typeof config === "object" && Array.isArray(config.pillars);
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

  return { showAppShell, switchView };
})();
