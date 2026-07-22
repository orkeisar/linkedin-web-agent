// Anthropic API fetch wrapper: direct browser access header, error handling.
// Reused by every later phase (onboarding, drafting, learning calls).

const Api = (() => {
  const API_URL = "https://api.anthropic.com/v1/messages";
  const ANTHROPIC_VERSION = "2023-06-01";

  async function sendMessage({ apiKey, model, messages, maxTokens, system }) {
    let response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages,
          ...(system ? { system } : {}),
        }),
      });
    } catch (err) {
      throw new Error(`Couldn't reach the Anthropic API — check your internet connection and try again. (${err.message})`);
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      throw new Error(`Anthropic API returned an unreadable response (status ${response.status}). Try again in a moment.`);
    }

    if (!response.ok) {
      let message = data?.error?.message || `Anthropic API request failed with status ${response.status}.`;
      if (response.status === 429) {
        message = `Rate limited by Anthropic: ${message} Wait a moment and try again.`;
      } else if (response.status >= 500) {
        message = `Anthropic's API is having issues (${response.status}): ${message} Try again shortly.`;
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    return data;
  }

  async function testConnection({ apiKey, model }) {
    return sendMessage({
      apiKey,
      model,
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 8,
    });
  }

  function extractText(response) {
    if (!response || !Array.isArray(response.content)) return "";
    return response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  }

  return { sendMessage, testConnection, extractText };
})();
