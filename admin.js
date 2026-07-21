// admin.html logic: recipient name, content strategy notes, repeatable
// pillar blocks, encode via linkConfig.js, copy-link button, length
// warning.

(function () {
  // Chosen conservative threshold: legacy Internet Explorer capped URLs at
  // 2083 characters, and that number still gets cited as the practical
  // "safe everywhere" ceiling for URLs pasted into email/chat clients that
  // may quote, wrap, or truncate them. Warn a bit under that so there's
  // room before anything actually breaks.
  const LINK_LENGTH_WARNING_THRESHOLD = 2000;

  function pillarBlockTemplate() {
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
    return div;
  }

  function angleRowTemplate() {
    const div = document.createElement("div");
    div.className = "angle-row";
    div.innerHTML = `
      <input type="text" class="angle-input" placeholder="Example angle" />
      <button type="button" class="remove-angle-btn" aria-label="Remove angle">&times;</button>
    `;
    return div;
  }

  function addPillarBlock() {
    const container = document.getElementById("pillars-container");
    const block = pillarBlockTemplate();
    container.appendChild(block);
    block.querySelector(".angles-container").appendChild(angleRowTemplate());
  }

  function collectConfig() {
    const recipientName = document.getElementById("recipient-name").value.trim();
    const contentStrategyNotes = document.getElementById("content-strategy-notes").value.trim();

    const pillars = Array.from(document.querySelectorAll(".pillar-block"))
      .map((block) => {
        const name = block.querySelector(".pillar-name").value.trim();
        const description = block.querySelector(".pillar-description").value.trim();
        const funnelGoal = block.querySelector(".pillar-funnel-goal").value;
        const exampleAngles = Array.from(block.querySelectorAll(".angle-input"))
          .map((input) => input.value.trim())
          .filter(Boolean);
        return { name, description, exampleAngles, funnelGoal };
      })
      .filter((pillar) => pillar.name || pillar.description || pillar.exampleAngles.length);

    return { recipientName, contentStrategyNotes, pillars };
  }

  function handlePillarsContainerClick(event) {
    const removePillarBtn = event.target.closest(".remove-pillar-btn");
    if (removePillarBtn) {
      removePillarBtn.closest(".pillar-block").remove();
      return;
    }

    const addAngleBtn = event.target.closest(".add-angle-btn");
    if (addAngleBtn) {
      const anglesContainer = addAngleBtn.closest(".pillar-block").querySelector(".angles-container");
      anglesContainer.appendChild(angleRowTemplate());
      return;
    }

    const removeAngleBtn = event.target.closest(".remove-angle-btn");
    if (removeAngleBtn) {
      removeAngleBtn.closest(".angle-row").remove();
    }
  }

  function showLinkOutput(url) {
    const output = document.getElementById("link-output");
    const input = document.getElementById("generated-link");
    const warning = document.getElementById("link-length-warning");
    const copyStatus = document.getElementById("link-copy-status");

    input.value = url;
    output.hidden = false;
    copyStatus.textContent = "";

    if (url.length > LINK_LENGTH_WARNING_THRESHOLD) {
      warning.hidden = false;
      warning.textContent = `Heads up: this link is ${url.length} characters. Some chat apps and email clients mangle very long URLs — consider trimming pillar descriptions or angles if the recipient reports a broken link.`;
    } else {
      warning.hidden = true;
      warning.textContent = "";
    }
  }

  async function handleCopyLink() {
    const input = document.getElementById("generated-link");
    const copyStatus = document.getElementById("link-copy-status");
    try {
      await navigator.clipboard.writeText(input.value);
      copyStatus.textContent = "Copied.";
    } catch (err) {
      input.select();
      copyStatus.textContent = "Couldn't copy automatically — link is selected, press Cmd/Ctrl+C.";
    }
  }

  function handleGenerateLink(event) {
    event.preventDefault();
    const config = collectConfig();
    const indexUrl = new URL("index.html", window.location.href).toString();
    const url = LinkConfig.buildLink(indexUrl, config);
    showLinkOutput(url);
  }

  function init() {
    document.getElementById("add-pillar-btn").addEventListener("click", addPillarBlock);
    document.getElementById("pillars-container").addEventListener("click", handlePillarsContainerClick);
    document.getElementById("admin-form").addEventListener("submit", handleGenerateLink);
    document.getElementById("copy-link-btn").addEventListener("click", handleCopyLink);

    addPillarBlock();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
