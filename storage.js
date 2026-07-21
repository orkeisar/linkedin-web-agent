// localStorage + IndexedDB wrapper: apiKey/modelId, pillars, voiceProfile,
// learnedGuidelines, ideas. IndexedDB stores land in Phase 3+.

const Storage = (() => {
  const API_KEY_STORAGE_KEY = "apiKey";
  const MODEL_ID_STORAGE_KEY = "modelId";
  const DEFAULT_MODEL_ID = "claude-sonnet-5";

  function getApiKey() {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
  }

  function setApiKey(key) {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  }

  function clearApiKey() {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }

  function getModelId() {
    return localStorage.getItem(MODEL_ID_STORAGE_KEY) || DEFAULT_MODEL_ID;
  }

  function setModelId(modelId) {
    localStorage.setItem(MODEL_ID_STORAGE_KEY, modelId);
  }

  return {
    DEFAULT_MODEL_ID,
    getApiKey,
    setApiKey,
    clearApiKey,
    getModelId,
    setModelId,
  };
})();
