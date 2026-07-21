// Anthropic API fetch wrapper: direct browser access header, error handling.
// Reused by every later phase (onboarding, drafting, learning calls).

const Api = (() => {
  const API_URL = "https://api.anthropic.com/v1/messages";
  const ANTHROPIC_VERSION = "2023-06-01";

  async function sendMessage({ apiKey, model, messages, maxTokens }) {
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
        }),
      });
    } catch (err) {
      throw new Error(`Network error reaching the Anthropic API: ${err.message}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      throw new Error(`Anthropic API returned an unreadable response (status ${response.status}).`);
    }

    if (!response.ok) {
      const message = data?.error?.message || `Anthropic API request failed with status ${response.status}.`;
      throw new Error(message);
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

  return { sendMessage, testConnection };
})();
