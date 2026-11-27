/**
 * Public configuration for the Learning Engineer (LE) Agent Annotation Studio (`v0.3.2`).
 *
 * SECURITY NOTES:
 * 1. NEVER place a raw LLM API key (`GEMINI_API_KEY`, `LLM_API_KEY`) or plaintext passcode here!
 * 2. `ACCESS_GATE` stores ONLY a 120,000-iteration PBKDF2-HMAC-SHA256 salt + digest.
 *    Rotate your pilot passcode anytime in 1 command:
 *      npm run set-passcode -- "YourNewPilotPasscode"
 * 3. Once you deploy `proxy/cloudflare-worker.js`, paste your `https://...workers.dev` URL
 *    into `DEFAULT_PROXY_URL` below.
 */
export const LE_CONFIG = {
  RUBRIC_VERSION: '0.3.2',
  ACCESS_GATE: {
    ENABLED: true,
    ITERATIONS: 120000,
    SALT_HEX: 'deb96a1c15c9732e749ac80cf5aefc59',
    HASH_HEX: '26310534ce55980128ef9e0efbe72cb4f7099b2cb47c7e1eeb15f8c5cff227e1',
  },
  DEFAULT_PROXY_URL: '',
  PILOT_LLM_PROVIDER: 'gemini',
  DEFAULT_LLM_MODEL: 'gemini-2.5-flash',
  REPO_URL: 'https://github.com/gautamyadavs/learning-engineer-agent',
  SETUP_GUIDE_URL:
    'https://github.com/gautamyadavs/learning-engineer-agent/blob/main/docs/llm-pilot-setup-guide.md',
  SCORING_DOC_URL:
    'https://github.com/gautamyadavs/learning-engineer-agent/blob/main/docs/rubric/rubric-v0.3.json',
};
