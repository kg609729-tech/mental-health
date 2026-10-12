'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
// Small .env loader keeps the prototype dependency-free. Existing environment
// variables always win, so deployment secrets are not overwritten by a file.
function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
loadEnvFile();
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 24;
const requestsByIp = new Map();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function rateLimited(ip) {
  const now = Date.now();
  const entry = requestsByIp.get(ip);
  if (!entry || now - entry.start >= WINDOW_MS) {
    requestsByIp.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

function readJson(req, maxBytes = 48_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Please send valid JSON.'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// A conservative first-pass safety net. This is not a full risk assessment;
// it catches some urgent phrases before they are sent to the language model.
const URGENT_PHRASES = [
  /\b(kill myself|suicide|suicidal|end my life|end it all|hurt myself|harm myself|self[- ]harm|don't want to live|do not want to live|can't keep myself safe|cannot keep myself safe)\b/i,
  /\b(want to die|wish i were dead|wish i was dead)\b/i
];
function needsUrgentSupport(text) {
  return URGENT_PHRASES.some((pattern) => pattern.test(text));
}

const SYSTEM_PROMPT = `You are Sukoon, a warm, non-judgmental wellbeing check-in assistant. Help the user reflect on possible stress or anxiety cues in their wording and offer small, practical calming options.

Boundaries:
- You are not a clinician. Never diagnose a disorder or claim certainty about a person's mental state. Use phrasing such as "your message may suggest..." and "I could be wrong".
- Be empathetic, brief, and conversational. Ask at most one gentle follow-up question.
- Suggest 1–2 practical options tailored to the message: gentle paced breathing (no breath-holding), a simple grounding exercise, a short break/stretch/water, or calming music such as soft piano, rain sounds, acoustic instrumentals, or gentle nature ambience. Do not claim to play music in this app.
- For breathing, say to breathe comfortably and return to normal breathing if dizzy or uncomfortable.
- Do not prescribe medication, shame the user, or promise that a technique will fix everything. Encourage a trusted adult or qualified professional if distress is persistent or interfering with daily life, especially for young people.
- If the user expresses immediate danger or potential self-harm, respond with compassion and urge them to tell a trusted adult/person nearby now and contact local emergency services if they are in immediate danger. Do not provide graphic details or methods.
- Reply in the language the user uses when practical, including Indian languages.

Return ONLY valid JSON with these keys:
{"reply":"empathetic response with a small next step","signal":"calm|possible_stress|possible_anxiety|high_distress","signal_note":"short non-diagnostic explanation","suggestion_type":"breathing|grounding|music|small_break|conversation","suggestion_title":"short title","suggestion":"one concise practical suggestion"}
Use "possible_stress" or "possible_anxiety" only as tentative language cues, not diagnoses. If there is not enough context, use "calm" and ask how they are feeling.`;

function fallbackFor(text) {
  const lower = text.toLowerCase();
  if (/music|song|listen|sound/.test(lower)) {
    return {
      reply: 'Let’s make the next few minutes feel a little softer. Try a sound that feels comfortable rather than intense, and let yourself listen without needing to solve anything right away.',
      signal: 'calm',
      signal_note: 'You asked for a calming music idea.',
      suggestion_type: 'music',
      suggestion_title: 'A quieter soundscape',
      suggestion: 'Try soft piano, gentle rain, or mellow instrumental music at a comfortable volume.'
    };
  }
  if (/breath|panic|overwhelm|anxious|anxiety|stress|nervous|tense|worried|worry/.test(lower)) {
    return {
      reply: 'That sounds like a lot to carry. You do not have to solve everything at once. Let’s start with one small, manageable moment.',
      signal: /panic|anxious|anxiety/.test(lower) ? 'possible_anxiety' : 'possible_stress',
      signal_note: 'Your wording may suggest tension or worry; this is not a diagnosis.',
      suggestion_type: 'breathing',
      suggestion_title: 'Gentle, slower breathing',
      suggestion: 'Breathe in comfortably for about 4 counts, then breathe out gently for about 6. Repeat for up to a minute; skip counting and breathe normally if it feels uncomfortable.'
    };
  }
  return {
    reply: 'Thank you for sharing that with me. We can take it one step at a time. What feels most important about this for you right now?',
    signal: 'calm',
    signal_note: 'There is not enough context to infer a stress pattern.',
    suggestion_type: 'grounding',
    suggestion_title: 'Come back to the present',
    suggestion: 'Notice your feet touching the floor, relax your shoulders if you can, and name three things you can see around you.'
  };
}

function normalizeResult(value) {
  const allowedSignals = new Set(['calm', 'possible_stress', 'possible_anxiety', 'high_distress']);
  const allowedTypes = new Set(['breathing', 'grounding', 'music', 'small_break', 'conversation']);
  if (!value || typeof value !== 'object') return null;
  const signal = allowedSignals.has(value.signal) ? value.signal : 'calm';
  const suggestionType = allowedTypes.has(value.suggestion_type) ? value.suggestion_type : 'conversation';
  const safeText = (field, max = 900) => typeof value[field] === 'string' ? value[field].trim().slice(0, max) : '';
  const normalized = {
    reply: safeText('reply'),
    signal,
    signal_note: safeText('signal_note', 180),
    suggestion_type: suggestionType,
    suggestion_title: safeText('suggestion_title', 100),
    suggestion: safeText('suggestion', 450)
  };
  return normalized.reply ? normalized : null;
}

async function handleChat(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return json(res, 429, { error: 'A few too many messages arrived at once. Please pause briefly and try again.' });

  let payload;
  try {
    payload = await readJson(req);
  } catch (error) {
    return json(res, error.statusCode || 400, { error: error.message || 'Could not read request.' });
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const lastUserMessage = [...messages].reverse().find((message) => message && message.role === 'user' && typeof message.content === 'string');
  if (!lastUserMessage || !lastUserMessage.content.trim()) return json(res, 400, { error: 'Write a little about how you are feeling first.' });
  if (lastUserMessage.content.length > 4000) return json(res, 413, { error: 'Please keep each message under 4,000 characters.' });

  // Handle detected urgent wording locally, without forwarding that message to Sarvam.
  if (needsUrgentSupport(lastUserMessage.content)) {
    return json(res, 200, {
      result: {
        reply: 'I’m really sorry things feel this hard. Your safety matters. Please tell a trusted adult or someone nearby you trust right now, and stay with them. If you are in immediate danger, contact your local emergency service. You deserve real support from a person who can be with you.',
        signal: 'high_distress',
        signal_note: 'Your message sounds like it may need immediate human support.',
        suggestion_type: 'conversation',
        suggestion_title: 'Reach out to someone now',
        suggestion: 'Send a simple message such as: “I’m having a hard time and need you to sit with me or talk with me now.”'
      },
      mode: 'safety'
    });
  }

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey || apiKey === 'replace_with_your_rotated_key') {
    return json(res, 200, { result: fallbackFor(lastUserMessage.content), mode: 'preview' });
  }

  const safeHistory = messages
    .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && !(m.role === 'user' && needsUrgentSupport(m.content)))
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  try {
    const response = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': apiKey
      },
      body: JSON.stringify({
        model: process.env.SARVAM_MODEL || 'sarvam-105b-conversations',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...safeHistory],
        temperature: 0.5,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      }),
      signal: AbortSignal.timeout(30_000)
    });

    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = null; }
    if (!response.ok) {
      const detail = data?.error?.message || data?.message || `Sarvam returned HTTP ${response.status}.`;
      console.error('Sarvam request failed:', response.status, detail);
      return json(res, 502, { error: 'Sarvam could not answer this time. Check your API key and model access, then try again.' });
    }

    const content = data?.choices?.[0]?.message?.content;
    let parsed;
    try { parsed = typeof content === 'string' ? JSON.parse(content) : content; } catch { parsed = null; }
    const result = normalizeResult(parsed);
    if (!result) {
      console.error('Sarvam response did not match the expected JSON shape.');
      return json(res, 502, { error: 'The reply came back in an unexpected format. Please try again.' });
    }
    return json(res, 200, { result, mode: 'sarvam' });
  } catch (error) {
    console.error('Sarvam connection error:', error.name || 'Error');
    return json(res, 502, { error: 'Could not connect to Sarvam. Check your connection and try again.' });
  }
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'Forbidden.' });
  fs.readFile(resolved, (err, file) => {
    if (err) return json(res, 404, { error: 'Not found.' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    });
    res.end(file);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/status') {
    return json(res, 200, {
      configured: Boolean(process.env.SARVAM_API_KEY && process.env.SARVAM_API_KEY !== 'replace_with_your_rotated_key'),
      model: process.env.SARVAM_MODEL || 'sarvam-105b-conversations'
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/chat') return handleChat(req, res);
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  serveStatic(req, res, decodeURIComponent(url.pathname));
});

server.listen(PORT, () => {
  console.log(`Sukoon is running at http://localhost:${PORT}`);
  if (!process.env.SARVAM_API_KEY || process.env.SARVAM_API_KEY === 'replace_with_your_rotated_key') {
    console.log('Preview mode: copy .env.example to .env and add your rotated Sarvam API key to enable live replies.');
  }
});
