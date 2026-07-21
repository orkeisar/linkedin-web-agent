// Shared encode/decode helpers for the admin.html -> index.html "c" query
// param handoff. Used by admin.js (encode, Phase 2) and app.js (decode,
// Phase 3) so both directions stay in one place.

const LinkConfig = (() => {
  const QUERY_PARAM = "c";

  function encodeConfig(config) {
    const json = JSON.stringify(config);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function decodeConfig(encoded) {
    try {
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const json = new TextDecoder().decode(bytes);
      return JSON.parse(json);
    } catch (err) {
      return null;
    }
  }

  function buildLink(indexUrl, config) {
    const url = new URL(indexUrl);
    url.searchParams.set(QUERY_PARAM, encodeConfig(config));
    return url.toString();
  }

  return { QUERY_PARAM, encodeConfig, decodeConfig, buildLink };
})();
