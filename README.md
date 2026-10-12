# Sukoon — Sarvam-powered calming assistant

A small, responsive prototype for a conversational wellbeing check-in. It uses Sarvam Chat Completions on the server to respond empathetically, tentatively notice possible stress/anxiety cues in language, and suggest a calming step such as comfortable-paced breathing, grounding, or music ideas.

> **Important:** This is a wellness prototype, not a diagnostic or crisis service. Language cues are uncertain and must never be treated as a clinical assessment. If someone may be in immediate danger, they need human support and local emergency help.

## Interface

- Responsive, calming sage-and-cream visual design with decorative hero artwork, large readable chat bubbles, message state styling, and distinct breathing/music cards.
- Relative CSS and JavaScript asset paths so the interface styles also load when opened directly as a local HTML file.
- Local browser-only demo mode for trying the interaction without a server or API key.

## Features

- Chat interface with starter prompts.
- Sarvam AI replies using `sarvam-105b-conversations` by default.
- JSON response format with a non-diagnostic check-in label and one suggested next step.
- Local keyword safety fallback that encourages contacting a trusted person / local emergency service for urgent messages. It is a simple safety net, not a complete risk detector.
- Guided one-minute breathing animation, music ideas, and a grounding prompt.
- No chat transcript is saved to disk by this app; conversation is kept in the open browser tab. Messages are sent to Sarvam when live mode is configured.
- If no API key is configured, the interface works in preview mode using local fallback replies.

## Run locally

Requirements: Node.js 18 or newer. No npm dependencies are needed.

1. Copy `.env.example` to `.env`.
2. Open `.env` and replace `replace_with_your_rotated_key` with your Sarvam API key. Keep `.env` private and never commit it.
3. Optionally set `SARVAM_MODEL=sarvam-105b-conversations` and `PORT=3000`.
4. In this directory, run:

   ```bash
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000).

Without a key, the app starts in preview mode, so you can test the interface and local demo responses first. You can also open `public/index.html` directly to preview the responsive design and try browser-only demo replies; live Sarvam calls require running the Node server.

## API integration

The server sends requests to `POST https://api.sarvam.ai/v1/chat/completions` with the `api-subscription-key` header. The API key stays on the server and is never sent to the browser. The default model is `sarvam-105b-conversations`; change `SARVAM_MODEL` in `.env` if your Sarvam account uses another supported V1 chat model.

The prototype asks Sarvam for a JSON object and validates the main response fields before showing them. If your account doesn't support the selected model or request format, check the error in your Sarvam dashboard / API documentation and adjust the model or prompt format as needed.

## Safety and privacy notes before production

- The included urgent-phrase screening is deliberately simple; it can miss risky messages and can also flag benign references. Do not market it as a safety detector or use it as the only crisis safeguard.
- Add a well-tested moderation / escalation design, professional review, rate limiting at the deployment edge, monitoring, privacy notices, and age-appropriate consent before public release.
- The app doesn't store conversation transcripts, but live messages are sent to Sarvam AI to generate replies. Review Sarvam's current data and retention terms before using real user data.
- This server is a local prototype. Before deployment, use HTTPS, a production secret manager, stricter request controls, appropriate access logging minimization, and a privacy/security review.
- There is no audio playback; music options are suggestions only.
