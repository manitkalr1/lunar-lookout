// Mission advisor (chatbot) settings.
//
// CHAT_PROXY_URL: the address of your deployed Cloudflare Worker (see worker/README.md),
// e.g. 'https://lunar-lookout-advisor.yourname.workers.dev/chat'. When it is set,
// everyone can use the advisor and your Gemini key stays secret on the Worker.
// When it is empty, visitors can paste their own Gemini API key instead; it is
// kept only in their browser.
export const CHAT_PROXY_URL = 'https://lunar-lookout-advisor.reyanshpparekh.workers.dev';

// Gemini model used when a visitor brings their own key (the Worker sets its own).
export const GEMINI_MODEL = 'gemini-3.8-flash';
