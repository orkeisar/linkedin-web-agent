// Mark-Posted flow support: a cheap local diff decides whether a pasted
// final version differs enough from the draft to be worth an API call,
// then one Claude call extracts concrete, reusable patterns into the
// learnedGuidelines IndexedDB store.

const Learning = (() => {
  // Threshold for the local diff. Deliberately loose and cheap (no API
  // call): a length change of more than 15%, OR word-level similarity
  // (Jaccard overlap) below 80%, counts as "substantive." Length alone
  // would miss a same-length post that got completely reworded, so both
  // checks run. False positives just cost one extra API call; false
  // negatives cost a learning opportunity, which is worse -- so this
  // leans toward flagging more edits as substantive, not fewer.
  const LENGTH_CHANGE_THRESHOLD = 0.15;
  const SIMILARITY_THRESHOLD = 0.8;

  function isSubstantiveChange(draftText, postedText) {
    const a = (draftText || "").trim();
    const b = (postedText || "").trim();
    if (a === b) return false;
    if (!a || !b) return true;

    const maxLength = Math.max(a.length, b.length, 1);
    const lengthChangeRatio = Math.abs(a.length - b.length) / maxLength;

    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
    const overlap = [...wordsA].filter((w) => wordsB.has(w)).length;
    const unionSize = new Set([...wordsA, ...wordsB]).size || 1;
    const similarity = overlap / unionSize;

    return lengthChangeRatio > LENGTH_CHANGE_THRESHOLD || similarity < SIMILARITY_THRESHOLD;
  }

  // --- extraction call ---

  function buildExtractionSystemPrompt() {
    return [
      "You compare a drafted LinkedIn post against what the person actually published, to learn concrete, reusable patterns about how they edit.",
      "Extract SPECIFIC, CONCRETE patterns only — things a future drafting pass could actually apply. Never vague restatements.",
      'Good: "removes rhetorical questions from hooks", "cuts the closing CTA down to one short sentence", "replaces em-dashes with periods", "always starts with a one-line paragraph, never a full sentence block".',
      'Bad — do not produce these: "made it more concise", "improved the tone", "better flow", "made it stronger".',
      "If there's truly nothing concrete and reusable to learn from this specific edit, return an empty array — don't invent a pattern to fill space.",
      "Return ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:",
      `{"patterns": [{"description": string, "draftExcerpt": string, "postedExcerpt": string}]}`,
      "draftExcerpt and postedExcerpt are short (under ~150 characters) — the specific snippet from each version that illustrates the pattern.",
    ].join("\n");
  }

  function buildExtractionUserMessage(draftText, postedText) {
    return ["Draft (what the agent wrote):", draftText, "", "Actually posted (what the person published):", postedText].join(
      "\n"
    );
  }

  function parseExtractionResponse(text) {
    try {
      const cleaned = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```$/, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed.patterns)) return [];
      return parsed.patterns
        .filter((p) => p && p.description)
        .map((p) => ({
          description: String(p.description).trim(),
          draftExcerpt: p.draftExcerpt ? String(p.draftExcerpt).trim() : "",
          postedExcerpt: p.postedExcerpt ? String(p.postedExcerpt).trim() : "",
        }));
    } catch (err) {
      return [];
    }
  }

  async function extractAndSaveGuidelines(idea, postedText) {
    try {
      const response = await Api.sendMessage({
        apiKey: AppStorage.getApiKey(),
        model: AppStorage.getModelId(),
        system: buildExtractionSystemPrompt(),
        messages: [{ role: "user", content: buildExtractionUserMessage(idea.draft || "", postedText) }],
        maxTokens: 1024,
      });

      const patterns = parseExtractionResponse(Api.extractText(response));
      const now = new Date().toISOString();
      for (const pattern of patterns) {
        await AppStorage.addLearnedGuideline({
          id: crypto.randomUUID(),
          description: pattern.description,
          evidence: { draftExcerpt: pattern.draftExcerpt, postedExcerpt: pattern.postedExcerpt },
          dateAdded: now,
        });
      }
      return patterns.length;
    } catch (err) {
      // Best-effort enrichment: the idea is already safely marked Posted
      // by the time this runs, so a failure here (auth, network, a
      // malformed response) shouldn't block or reauth-prompt the user --
      // just skip it silently and try again next time they post.
      console.warn("learnedGuidelines extraction skipped:", err.message);
      return 0;
    }
  }

  return { isSubstantiveChange, extractAndSaveGuidelines };
})();
