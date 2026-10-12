'use strict';

const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const connectionStatus = document.getElementById('connection-status');
const toast = document.getElementById('toast');
const breathingButton = document.getElementById('breathing-button');
const breathingVisual = document.getElementById('breathing-visual');
const breathPhase = document.getElementById('breath-phase');
const breathingInstruction = document.getElementById('breathing-instruction');

let conversation = [];
let isSending = false;
let breathingTimer = null;
let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}

function setConnectionStatus(text, mode) {
  connectionStatus.className = `connection-status ${mode || ''}`.trim();
  connectionStatus.querySelector('span').textContent = text;
}

async function loadStatus() {
  if (window.location.protocol === 'file:') {
    setConnectionStatus('Local preview', 'preview');
    return;
  }
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    if (data.configured) setConnectionStatus('Sarvam connected', 'live');
    else setConnectionStatus('Preview mode', 'preview');
  } catch {
    setConnectionStatus('Offline preview', 'preview');
  }
}

function addMessage(role, text, result = null, mode = 'sarvam') {
  const row = document.createElement('div');
  row.className = `message ${role === 'user' ? 'user-message' : 'assistant-message'}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = role === 'user' ? 'you' : 's.';

  const content = document.createElement('div');
  content.className = 'message-content';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  // Use textContent rather than HTML injection for user- and model-supplied text.
  for (const paragraph of String(text).split(/\n+/).filter(Boolean)) {
    const p = document.createElement('p');
    p.textContent = paragraph;
    bubble.appendChild(p);
  }
  content.appendChild(bubble);

  if (role !== 'user' && result) {
    const signal = document.createElement('div');
    signal.className = 'signal-card';
    const signalTitle = document.createElement('strong');
    signalTitle.textContent = signalLabel(result.signal);
    const signalNote = document.createElement('span');
    signalNote.textContent = result.signal_note || 'This is a tentative reading of language, not a diagnosis.';
    signal.append(signalTitle, signalNote);
    content.appendChild(signal);

    if (result.suggestion && result.suggestion_title) {
      const suggestion = document.createElement('div');
      suggestion.className = 'suggestion-card';
      const kicker = document.createElement('div');
      kicker.className = 'suggestion-kicker';
      kicker.textContent = `A small next step · ${suggestionTypeLabel(result.suggestion_type)}`;
      const title = document.createElement('strong');
      title.textContent = result.suggestion_title;
      const desc = document.createElement('p');
      desc.textContent = result.suggestion;
      suggestion.append(kicker, title, desc);
      content.appendChild(suggestion);
    }
    if (mode === 'preview') {
      const note = document.createElement('div');
      note.className = 'message-time';
      note.textContent = 'Preview reply · add a Sarvam API key to enable live model responses';
      content.appendChild(note);
    } else if (mode === 'safety') {
      const note = document.createElement('div');
      note.className = 'message-time';
      note.textContent = 'Safety response · please connect with a person who can support you';
      content.appendChild(note);
    }
  }

  const time = document.createElement('span');
  time.className = 'message-time';
  if (role === 'user') time.textContent = 'Just now';
  else if (!result) time.textContent = 'Sukoon';
  if (time.textContent) content.appendChild(time);

  row.append(avatar, content);
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
  return row;
}

function signalLabel(signal) {
  const labels = {
    calm: 'Check-in · still getting to know the moment',
    possible_stress: 'Possible stress cues in your wording',
    possible_anxiety: 'Possible worry or anxiety cues in your wording',
    high_distress: 'It may be important to get human support now'
  };
  return labels[signal] || labels.calm;
}

function suggestionTypeLabel(type) {
  const labels = { breathing: 'BREATHING', grounding: 'GROUNDING', music: 'MUSIC', small_break: 'SMALL BREAK', conversation: 'CHECK-IN' };
  return labels[type] || 'CHECK-IN';
}

// Small browser-only demo for users who open index.html directly. This never calls Sarvam.
function localPreviewFor(text) {
  const lower = String(text || '').toLowerCase();
  const urgent = /\b(kill myself|suicide|suicidal|end my life|end it all|hurt myself|harm myself|self[- ]harm|don't want to live|do not want to live|can't keep myself safe|cannot keep myself safe|want to die|wish i were dead|wish i was dead)\b/i.test(text);
  if (urgent) return {
    reply: 'I’m really sorry things feel this hard. Your safety matters. Please tell a trusted adult or someone nearby you trust right now, and stay with them. If you are in immediate danger, contact your local emergency service. You deserve real support from a person who can be with you.',
    signal: 'high_distress', signal_note: 'Your message sounds like it may need immediate human support.',
    suggestion_type: 'conversation', suggestion_title: 'Reach out to someone now',
    suggestion: 'Send a simple message such as: “I’m having a hard time and need you to sit with me or talk with me now.”'
  };
  if (/music|song|listen|sound|piano|rain/.test(lower)) return {
    reply: 'Let’s make the next few minutes feel a little softer. Try a sound that feels comfortable rather than intense, and let yourself listen without needing to solve anything right away.',
    signal: 'calm', signal_note: 'You asked for a calming music idea.', suggestion_type: 'music',
    suggestion_title: 'A quieter soundscape', suggestion: 'Try soft piano, gentle rain, or mellow instrumental music at a comfortable volume.'
  };
  if (/ground|present|overwhelm|stress|anxious|anxiety|panic|nervous|tense|worried|worry|breath/.test(lower)) return {
    reply: 'That sounds like a lot to carry. You do not have to solve everything at once. Let’s start with one small, manageable moment.',
    signal: /anxious|anxiety|panic/.test(lower) ? 'possible_anxiety' : 'possible_stress',
    signal_note: 'Your wording may suggest tension or worry; this is not a diagnosis.',
    suggestion_type: /ground|present/.test(lower) ? 'grounding' : 'breathing',
    suggestion_title: /ground|present/.test(lower) ? 'Come back to the present' : 'Gentle, slower breathing',
    suggestion: /ground|present/.test(lower) ? 'Notice your feet touching the floor, relax your shoulders if you can, and name three things you can see around you.' : 'Breathe in comfortably for about 4 counts, then breathe out gently for about 6. Repeat for up to a minute; skip counting and breathe normally if it feels uncomfortable.'
  };
  return { reply: 'Thank you for sharing that with me. We can take it one step at a time. What feels most important about this for you right now?', signal: 'calm', signal_note: 'There is not enough context to infer a stress pattern.', suggestion_type: 'grounding', suggestion_title: 'One small grounding moment', suggestion: 'Notice your feet touching the floor and name three things you can see around you.' };
}

function showTyping() {
  const row = document.createElement('div');
  row.className = 'message assistant-message';
  row.id = 'typing-indicator';
  const avatar = document.createElement('div');
  avatar.className = 'avatar'; avatar.textContent = 's.'; avatar.setAttribute('aria-hidden', 'true');
  const content = document.createElement('div'); content.className = 'message-content';
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  const dots = document.createElement('span'); dots.className = 'typing-dots'; dots.setAttribute('aria-label', 'Sukoon is thinking');
  for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('i'));
  bubble.appendChild(dots); content.appendChild(bubble); row.append(avatar, content); chatLog.appendChild(row); chatLog.scrollTop = chatLog.scrollHeight;
}
function removeTyping() { document.getElementById('typing-indicator')?.remove(); }

async function submitMessage(text) {
  const clean = String(text || '').trim();
  if (!clean || isSending) return;
  isSending = true;
  sendButton.disabled = true;
  messageInput.disabled = true;
  addMessage('user', clean);
  conversation.push({ role: 'user', content: clean });
  if (conversation.length > 20) conversation = conversation.slice(-20);
  showTyping();

  try {
    let data;
    if (window.location.protocol === 'file:') {
      // Static-file preview: keeps the UI interactive without a backend or API key.
      await new Promise((resolve) => setTimeout(resolve, 350));
      data = { result: localPreviewFor(clean), mode: 'preview' };
    } else {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversation.slice(-12) })
      });
      data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not get a reply. Please try again.');
    }
    removeTyping();
    if (!data.result) throw new Error(data.error || 'Could not get a reply. Please try again.');
    const result = data.result;
    conversation.push({ role: 'assistant', content: JSON.stringify(result) });
    // The API receives normal conversational text for its history; don't use the
    // JSON wrapper as a history message on the next turn.
    conversation[conversation.length - 1].content = result.reply;
    addMessage('assistant', result.reply, result, data.mode);
    if (data.mode === 'preview') setConnectionStatus('Preview mode', 'preview');
  } catch (error) {
    removeTyping();
    addMessage('assistant', error.message || 'I couldn’t connect just now. Please try once more, or choose a quick reset from the tools on the side.');
    showToast('Message not sent to Sarvam. Please try again.');
  } finally {
    isSending = false;
    sendButton.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = messageInput.value;
  messageInput.value = '';
  messageInput.style.height = 'auto';
  submitMessage(text);
});

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 115)}px`;
});
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => submitMessage(button.dataset.prompt));
});

document.querySelectorAll('[data-music]').forEach((button) => {
  button.addEventListener('click', () => {
    submitMessage(`Suggest a calming listening idea for me. I am interested in ${button.dataset.music.toLowerCase()}.`);
  });
});

function stopBreathing() {
  clearInterval(breathingTimer);
  breathingTimer = null;
  breathingVisual.classList.remove('active');
  breathPhase.textContent = 'Ready?';
  breathingInstruction.textContent = 'Breathe comfortably. No need to force it.';
  breathingButton.textContent = 'Start 1-minute reset ↗';
  breathingButton.disabled = false;
}

breathingButton.addEventListener('click', () => {
  if (breathingTimer) {
    stopBreathing();
    return;
  }
  const phases = [
    { label: 'Breathe in', text: 'Gently breathe in for about 4 counts.', seconds: 4 },
    { label: 'Breathe out', text: 'Let your breath out slowly for about 6 counts.', seconds: 6 }
  ];
  let elapsed = 0;
  let phaseIndex = 0;
  let phaseRemaining = phases[0].seconds;
  breathingVisual.classList.add('active');
  breathPhase.textContent = phases[0].label;
  breathingInstruction.textContent = phases[0].text;
  breathingButton.textContent = 'Stop breathing guide';
  breathingTimer = setInterval(() => {
    elapsed += 1;
    phaseRemaining -= 1;
    if (elapsed >= 60) {
      stopBreathing();
      breathingInstruction.textContent = 'Well done for taking a pause. Return to your natural breathing.';
      showToast('A minute just for you.');
      return;
    }
    if (phaseRemaining <= 0) {
      phaseIndex = (phaseIndex + 1) % phases.length;
      phaseRemaining = phases[phaseIndex].seconds;
      breathPhase.textContent = phases[phaseIndex].label;
      breathingInstruction.textContent = phases[phaseIndex].text;
      // Reduce-motion preference is respected by CSS; this counter only guides the pace.
    }
  }, 1000);
});

loadStatus();
