// localStorage + IndexedDB wrapper: apiKey/modelId, pillars, voiceProfile,
// learnedGuidelines, ideas.

const AppStorage = (() => {
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

  function clearModelId() {
    localStorage.removeItem(MODEL_ID_STORAGE_KEY);
  }

  // --- IndexedDB: pillars + voiceProfile (single record each) ---

  const DB_NAME = "linkedinStoryPipeline";
  const DB_VERSION = 3;
  const PILLARS_STORE = "pillars";
  const VOICE_PROFILE_STORE = "voiceProfile";
  const IDEAS_STORE = "ideas";
  const LEARNED_GUIDELINES_STORE = "learnedGuidelines";
  const SINGLETON_KEY = "current";

  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(PILLARS_STORE)) {
            db.createObjectStore(PILLARS_STORE);
          }
          if (!db.objectStoreNames.contains(VOICE_PROFILE_STORE)) {
            db.createObjectStore(VOICE_PROFILE_STORE);
          }
          if (!db.objectStoreNames.contains(IDEAS_STORE)) {
            db.createObjectStore(IDEAS_STORE, { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains(LEARNED_GUIDELINES_STORE)) {
            db.createObjectStore(LEARNED_GUIDELINES_STORE, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return dbPromise;
  }

  async function idbGet(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGetAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(storeName, key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbPutKeyed(storeName, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbReplaceAll(storeName, items) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error(`${storeName} replace failed.`));
      tx.onabort = () => reject(tx.error || new Error(`${storeName} replace was aborted.`));
      try {
        store.clear();
        items.forEach((item) => store.put(item));
      } catch (err) {
        // put() throws synchronously on a bad key (e.g. missing/invalid
        // `id`) without aborting the transaction on its own -- the already
        // -queued clear()/put()s would otherwise still commit, leaving the
        // store half-replaced. Abort explicitly so this is all-or-nothing.
        tx.abort();
      }
    });
  }

  async function clearAllData() {
    const db = await openDb();
    const storeNames = Array.from(db.objectStoreNames);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, "readwrite");
      storeNames.forEach((name) => tx.objectStore(name).clear());
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function emptyPillars() {
    return { recipientName: "", contentStrategyNotes: "", pillars: [] };
  }

  function getPillars() {
    return idbGet(PILLARS_STORE, SINGLETON_KEY);
  }

  function savePillars(pillarsConfig) {
    return idbPut(PILLARS_STORE, SINGLETON_KEY, pillarsConfig);
  }

  function getVoiceProfile() {
    return idbGet(VOICE_PROFILE_STORE, SINGLETON_KEY);
  }

  function saveVoiceProfile(voiceProfile) {
    return idbPut(VOICE_PROFILE_STORE, SINGLETON_KEY, voiceProfile);
  }

  function getIdeas() {
    return idbGetAll(IDEAS_STORE);
  }

  function getIdea(id) {
    return idbGet(IDEAS_STORE, id);
  }

  function saveIdea(idea) {
    return idbPutKeyed(IDEAS_STORE, idea);
  }

  function getLearnedGuidelines() {
    return idbGetAll(LEARNED_GUIDELINES_STORE);
  }

  // Upsert: also used to edit an existing guideline (pass its existing id).
  function saveLearnedGuideline(guideline) {
    return idbPutKeyed(LEARNED_GUIDELINES_STORE, guideline);
  }

  function deleteLearnedGuideline(id) {
    return idbDelete(LEARNED_GUIDELINES_STORE, id);
  }

  function replaceLearnedGuidelines(guidelines) {
    return idbReplaceAll(LEARNED_GUIDELINES_STORE, guidelines);
  }

  function replaceIdeas(ideas) {
    return idbReplaceAll(IDEAS_STORE, ideas);
  }

  return {
    DEFAULT_MODEL_ID,
    getApiKey,
    setApiKey,
    clearApiKey,
    getModelId,
    setModelId,
    clearModelId,
    emptyPillars,
    getPillars,
    savePillars,
    getVoiceProfile,
    saveVoiceProfile,
    getIdeas,
    getIdea,
    saveIdea,
    replaceIdeas,
    getLearnedGuidelines,
    saveLearnedGuideline,
    deleteLearnedGuideline,
    replaceLearnedGuidelines,
    clearAllData,
  };
})();
