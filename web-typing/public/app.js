const app = document.getElementById('app');

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function normalizeTypingText(s) {
  return String(s)
    .replace(/\xa0/g, ' ')
    .toLowerCase()
    .replace(/[^a-z ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWord(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function wpmFromNormalizedLength(len, elapsedSec) {
  if (elapsedSec <= 0) return 0;
  const words = len / 5.0;
  return Math.round((words / elapsedSec) * 60.0 * 100) / 100;
}

function firstErrorIndex(w, att) {
  for (let j = 0; j < Math.min(w.length, att.length); j += 1) {
    if (w[j] !== att[j]) return j;
  }
  if (att.length > w.length) return w.length;
  return -1;
}

function prefixMatchLen(w, att) {
  for (let j = 0; j < Math.min(w.length, att.length); j += 1) {
    if (w[j] !== att[j]) return j;
  }
  return Math.min(w.length, att.length);
}

const ICON_TIMER = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="#f97316" stroke-width="1.75"/><path d="M12 7v5l3.5 2" stroke="#f97316" stroke-width="1.75" stroke-linecap="round"/></svg>`;
const ICON_SPEED = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3a9 9 0 109 9" stroke="#64748b" stroke-width="1.75" stroke-linecap="round"/><path d="M12 7v5l3 2" stroke="#a78bfa" stroke-width="1.75" stroke-linecap="round"/></svg>`;
const ICON_ACCURACY = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="#94a3b8" stroke-width="1.5"/><path d="M8 12l2.5 2.5L16 9" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let lamejsLoadPromise = null;
function loadLamejs() {
  if (!lamejsLoadPromise) {
    lamejsLoadPromise = import('https://esm.sh/lamejs@1.2.1').then((m) => m.default || m);
  }
  return lamejsLoadPromise;
}

async function resampleTo44100(audioBuffer) {
  if (audioBuffer.sampleRate === 44100) return audioBuffer;
  const ch = audioBuffer.numberOfChannels;
  const length = Math.ceil(audioBuffer.duration * 44100);
  const offline = new OfflineAudioContext(ch, length, 44100);
  const src = offline.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(offline.destination);
  src.start(0);
  return offline.startRendering();
}

function audioBufferToMonoInt16(audioBuffer) {
  const { numberOfChannels, length } = audioBuffer;
  const out = new Int16Array(length);
  if (numberOfChannels === 1) {
    const ch0 = audioBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const s = Math.max(-1, Math.min(1, ch0[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (let c = 0; c < numberOfChannels; c += 1) {
      sum += audioBuffer.getChannelData(c)[i];
    }
    const s = Math.max(-1, Math.min(1, sum / numberOfChannels));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

async function audioBlobToMp3File(blob) {
  const mime = String(blob.type || '').toLowerCase();
  const name = String(blob instanceof File ? blob.name : '').toLowerCase();
  if (mime === 'audio/mpeg' || name.endsWith('.mp3')) {
    if (blob instanceof File && blob.name && blob.name.toLowerCase().endsWith('.mp3')) return blob;
    return new File([blob], 'voice-note.mp3', { type: 'audio/mpeg' });
  }

  const raw = await blob.arrayBuffer();
  const ctx = new AudioContext();
  let audioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(raw.slice(0));
  } finally {
    await ctx.close();
  }

  const atRate = await resampleTo44100(audioBuffer);
  const samples = audioBufferToMonoInt16(atRate);
  if (samples.length === 0) {
    throw new Error('Empty audio');
  }

  const lamejs = await loadLamejs();
  if (!lamejs || typeof lamejs.Mp3Encoder !== 'function') {
    throw new Error('MP3 encoder failed to load');
  }
  const encoder = new lamejs.Mp3Encoder(1, 44100, 128);
  const block = 1152;
  const parts = [];
  for (let i = 0; i < samples.length; i += block) {
    const chunk = samples.subarray(i, i + block);
    const buf = encoder.encodeBuffer(chunk);
    if (buf.length > 0) parts.push(buf);
  }
  const end = encoder.flush();
  if (end.length > 0) parts.push(end);

  const mp3Blob = new Blob(parts, { type: 'audio/mpeg' });
  return new File([mp3Blob], 'voice-note.mp3', { type: 'audio/mpeg' });
}

function initVantaBg() {
  const el = document.getElementById('vanta-bg');
  if (!el || typeof window.VANTA === 'undefined' || window.__vantaNetStarted) return;
  try {
    window.VANTA.NET({
      el: '#vanta-bg',
      mouseControls: false,
      touchControls: false,
      gyroControls: false,
      minHeight: 200.0,
      minWidth: 200.0,
      scale: 1.0,
      scaleMobile: 1.0,
      color: 0x7c3aed,
      backgroundColor: 0x07080c,
      points: 10,
      maxDistance: 22.0,
      spacing: 18.0,
    });
    window.__vantaNetStarted = true;
  } catch (e) {
    console.warn('Background effect failed:', e);
  }
}

const token = qs('t');
if (!token) {
  app.innerHTML =
    '<div class="err-screen"><p>Missing session. Open the link from Discord (<code>?t=…</code>).</p></div>';
} else {
  load();
}

async function load() {
  app.innerHTML =
    '<div class="loading-screen"><div class="pulse"></div><p>Loading session…</p></div>';
  let data;
  try {
    const r = await fetch(`/api/session?t=${encodeURIComponent(token)}`);
    const raw = await r.text();
    try {
      data = JSON.parse(raw);
    } catch {
      app.innerHTML = `<div class="err-screen"><p>Session API error (<strong>${r.status}</strong>).</p></div>`;
      return;
    }
    if (!r.ok) {
      let hint = data.hint || '';
      if (data.error === 'invalid_or_expired') {
        if (data.reason === 'sig_mismatch') {
          hint =
            hint ||
            'Signature failed. For preview URLs, set <strong>WEB_TYPING_SHARED_SECRET</strong> under Preview in Pages.';
        } else if (data.reason === 'expired') {
          hint = hint || 'Link expired (15 min). Request a new link from Discord.';
        } else if (!hint) {
          hint = 'Re-check <strong>WEB_TYPING_SHARED_SECRET</strong> on Cloudflare matches <strong>config.py</strong>.';
        }
      } else if (data.error === 'missing_secret') {
        hint = data.hint || 'Add <strong>WEB_TYPING_SHARED_SECRET</strong> in Pages.';
      }
      const reason = data.reason ? ` <code>${data.reason}</code>` : '';
      app.innerHTML = `<div class="err-screen"><p>Could not load session (<code>${data.error || r.status}</code>)${reason}. ${hint}</p></div>`;
      return;
    }
  } catch (e) {
    app.innerHTML = `<div class="err-screen"><p>Could not load session: ${String(e.message || e)}</p></div>`;
    return;
  }

  const passages = Array.isArray(data.passages) ? data.passages : [];
  const { exp, minWpm } = data;
  const targetWpm = typeof minWpm === 'number' && Number.isFinite(minWpm) ? minWpm : 65;
  if (passages.length === 0) {
    app.innerHTML =
      '<div class="err-screen"><p>No passage in this session. Request a new link from Discord.</p></div>';
    return;
  }
  if (typeof data.roundProof !== 'string' || !data.roundProof) {
    app.innerHTML =
      '<div class="err-screen"><p>Session response missing round proof. Redeploy the typing site or reload.</p></div>';
    return;
  }
  if (!Array.isArray(data.speedQuestions) || data.speedQuestions.length < 1 || typeof data.speedQaProof !== 'string') {
    app.innerHTML =
      '<div class="err-screen"><p>Session response missing Speed Q&A data. Redeploy the typing site.</p></div>';
    return;
  }
  if (!Array.isArray(data.applicationQuestions) || data.applicationQuestions.length < 1) {
    app.innerHTML =
      '<div class="err-screen"><p>Session response missing questionnaire data. Redeploy the typing site.</p></div>';
    return;
  }
  let roundProof = data.roundProof;
  let speedQuestions = data.speedQuestions;
  let speedQaProof = data.speedQaProof;
  const applicationQuestions = data.applicationQuestions;
  let expectedNorm = passages.join(' ');
  let wordList = expectedNorm.split(' ').filter((w) => w.length > 0);

  const wrap = document.createElement('div');
  wrap.className = 'page';
  wrap.innerHTML = `
    <div class="shell">
      <header class="hero">
        <div class="hero__brand">
          <img class="logo" src="/logo.png" width="52" height="52" alt="" />
          <div class="hero-text">
            <p class="hero__eyebrow">RISE</p>
            <h1><span class="brand-accent">RISE</span><span class="brand-rest"> chatting test</span></h1>
            <p class="badge">Session <span id="exp-left"></span> · need <strong>${targetWpm}+ WPM</strong> to submit</p>
          </div>
        </div>
      </header>

      <div id="phaseTyping">
      <div class="stats-bar" id="statsBar" aria-live="polite"></div>

      <div class="race-card" id="raceCard">
        <div class="race-card__inner">
          <div class="race-passage-block">
            <div class="race-overlay" id="raceOverlay" aria-hidden="false">
              <div class="race-overlay__inner">
                <p class="race-overlay__kicker">Start</p>
                <p class="race-overlay__title">Test begins when you start typing</p>
                <p class="race-overlay__body">Type the highlighted words as fast as you can. Press <kbd>space</kbd> after each word to lock it — fix mistakes before you move on.</p>
                <p class="race-overlay__fine">Click to focus the box · paste is off</p>
              </div>
            </div>
            <div class="race-passage" id="racePassage" aria-live="polite"></div>
          </div>

          <div class="race-input-shell">
            <label class="sr-only" for="wordInput">Current word</label>
            <input type="text" id="wordInput" class="word-input" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off" placeholder="Type the highlighted word, then space…" />
          </div>
        </div>

        <div class="complete-panel complete-panel--overlay" id="completePanel" hidden aria-hidden="true">
          <div class="complete-panel__sheet">
            <p class="complete-panel__msg" id="completeMsg"></p>
            <div class="action-row">
              <button type="button" class="btn-secondary" id="retakeBtn">Retake</button>
              <button type="button" class="submit-btn submit-btn--next" id="submitBtn" disabled>Submit &amp; go to next test</button>
            </div>
            <p class="panel-footer-hint">Need ${targetWpm}+ WPM to continue. You can retake anytime.</p>
          </div>
        </div>

        <div class="session-submitted" id="submittedPanel" hidden aria-hidden="true">
          <div class="session-submitted__sheet">
            <p class="session-submitted__kicker" id="submittedKicker"></p>
            <p class="session-submitted__title" id="submittedTitle"></p>
            <p class="session-submitted__detail" id="submittedDetail"></p>
            <p class="session-submitted__fine" id="submittedFine"></p>
          </div>
        </div>
      </div>
      </div>

      <section class="of-chat-phase" id="phaseSpeed" hidden aria-hidden="true">
        <div class="speed-qa-intro" id="speedQaIntro" hidden>
          <p class="speed-qa-intro__kicker">Next step</p>
          <h2 class="speed-qa-intro__title">Speed Q&amp;A</h2>
          <p class="speed-qa-intro__body">
            This is a very quick benchmark — not a high-pressure exam. It’s mainly to get a sense of how comfortable you are with chat-style replies and your overall experience.
            A fan will message you like a real chat — answer each message the best way you can, as naturally as possible. There are <strong>${speedQuestions.length}</strong> prompts.
          </p>
          <button type="button" class="submit-btn speed-qa-intro__start" id="speedQaStartBtn">Start Speed Q&amp;A</button>
        </div>
        <div class="of-chat-outer" id="speedQaChatWrap" hidden>
        <div class="of-chat">
          <div class="of-chat__top">
            <span class="of-chat__brand">Chat</span>
            <span class="of-chat__hint">Messages</span>
          </div>
          <div class="of-chat__stream" id="speedChatStream" aria-live="polite"></div>
          <div class="of-chat__composer">
            <input type="text" id="speedChatInput" class="of-chat__input" maxlength="900" autocomplete="off" placeholder="Message…" disabled />
            <button type="button" class="of-chat__send" id="speedChatSend" disabled>Send</button>
          </div>
        </div>
        </div>
      </section>

      <section class="web-phase-card" id="phaseQuestions" hidden aria-hidden="true">
        <p class="web-phase-card__kicker">Next step</p>
        <h2 class="web-phase-card__title">Questionnaire</h2>
        <p class="web-phase-card__body">
          Answer these honestly and clearly.
        </p>
        <div class="questionnaire-form" id="questionnaireFields"></div>
        <div class="web-phase-card__actions">
          <button type="button" class="submit-btn" id="questionnaireContinueBtn">Continue to voice note</button>
        </div>
      </section>

      <section class="web-phase-card" id="phaseVoice" hidden aria-hidden="true">
        <p class="web-phase-card__kicker">Final step</p>
        <h2 class="web-phase-card__title">Voice Note</h2>
        <p class="web-phase-card__body">
          Record your voice note directly here or upload an audio file instead. When you submit, everything will be sent together into one private RISE ticket.
        </p>
        <div class="voice-note-card">
          <div class="voice-note-card__record">
            <div class="voice-note-card__actions">
              <button type="button" class="btn-secondary" id="voiceRecordStartBtn">Start recording</button>
              <button type="button" class="btn-secondary" id="voiceRecordStopBtn" disabled>Stop</button>
            </div>
            <p class="voice-note-card__hint" id="voiceRecordStatus">You can record here or upload an audio file below.</p>
          </div>
          <label class="voice-note-card__upload">
            <span class="voice-note-card__uploadLabel">Upload audio instead</span>
            <input type="file" id="voiceNoteInput" accept="audio/*,.mp3,.m4a,.wav,.webm,.ogg" />
          </label>
          <div class="voice-note-card__preview" id="voicePreviewWrap" hidden>
            <p class="voice-note-card__file" id="voicePreviewName"></p>
            <audio id="voicePreview" controls preload="metadata"></audio>
          </div>
        </div>
        <div class="web-phase-card__actions">
          <button type="button" class="submit-btn" id="finalSubmitBtn">Submit full application</button>
        </div>
      </section>

      <div class="phase-all-done" id="phaseAllDone" hidden>
        <div class="phase-all-done__card">
          <div class="phase-all-done__icon" aria-hidden="true">✓</div>
          <p class="phase-all-done__title">All set</p>
          <p class="phase-all-done__body" id="phaseAllDoneBody">
            Your results have been submitted. A <strong>private ticket</strong> has been created for you inside the <strong>RISE</strong> Discord with your full application — please continue there.
          </p>
          <button type="button" class="phase-all-done__btn" id="phaseAllDoneBtn">Exit</button>
          <p class="phase-all-done__fine" id="phaseAllDoneFine" hidden>If the tab didn&apos;t close, close it from your browser.</p>
        </div>
      </div>

      <div class="msg" id="msgEl" hidden></div>
    </div>
  `;
  app.replaceChildren(wrap);

  const expLeftEl = wrap.querySelector('#exp-left');
  const statsBar = wrap.querySelector('#statsBar');
  const racePassage = wrap.querySelector('#racePassage');
  const raceOverlay = wrap.querySelector('#raceOverlay');
  const wordInput = wrap.querySelector('#wordInput');
  const completePanel = wrap.querySelector('#completePanel');
  const completeMsg = wrap.querySelector('#completeMsg');
  const retakeBtn = wrap.querySelector('#retakeBtn');
  const submitBtn = wrap.querySelector('#submitBtn');
  const msgEl = wrap.querySelector('#msgEl');
  const submittedPanel = wrap.querySelector('#submittedPanel');
  const submittedKicker = wrap.querySelector('#submittedKicker');
  const submittedTitle = wrap.querySelector('#submittedTitle');
  const submittedDetail = wrap.querySelector('#submittedDetail');
  const submittedFine = wrap.querySelector('#submittedFine');
  const phaseTyping = wrap.querySelector('#phaseTyping');
  const phaseSpeed = wrap.querySelector('#phaseSpeed');
  const phaseQuestions = wrap.querySelector('#phaseQuestions');
  const phaseVoice = wrap.querySelector('#phaseVoice');
  const phaseAllDone = wrap.querySelector('#phaseAllDone');
  const speedQaIntro = wrap.querySelector('#speedQaIntro');
  const speedQaChatWrap = wrap.querySelector('#speedQaChatWrap');
  const speedQaStartBtn = wrap.querySelector('#speedQaStartBtn');
  const questionnaireFields = wrap.querySelector('#questionnaireFields');
  const questionnaireContinueBtn = wrap.querySelector('#questionnaireContinueBtn');
  const voiceRecordStartBtn = wrap.querySelector('#voiceRecordStartBtn');
  const voiceRecordStopBtn = wrap.querySelector('#voiceRecordStopBtn');
  const voiceRecordStatus = wrap.querySelector('#voiceRecordStatus');
  const voiceNoteInput = wrap.querySelector('#voiceNoteInput');
  const voicePreviewWrap = wrap.querySelector('#voicePreviewWrap');
  const voicePreviewName = wrap.querySelector('#voicePreviewName');
  const voicePreview = wrap.querySelector('#voicePreview');
  const finalSubmitBtn = wrap.querySelector('#finalSubmitBtn');
  const phaseAllDoneBtn = wrap.querySelector('#phaseAllDoneBtn');
  const phaseAllDoneFine = wrap.querySelector('#phaseAllDoneFine');

  const accepted = [];
  let wordIndex = 0;
  let badSpaceCount = 0;
  let startAt = null;
  let completed = false;
  let finalWpm = 0;
  let finalElapsed = 0;
  let statsLoop = null;
  let overlayDismissed = false;
  let typingReceipt = null;
  let speedQaItems = [];
  let questionnaireAnswers = [];
  let voiceNoteFile = null;
  let voicePreviewUrl = '';
  let activeRecorder = null;
  let activeRecorderStream = null;
  let activeChunks = [];

  function renderQuestionnaireFields() {
    if (!questionnaireFields) return;
    questionnaireFields.innerHTML = applicationQuestions
      .map((q, i) => {
        const maxLength = Number.isFinite(Number(q.maxLength)) ? Number(q.maxLength) : 1000;
        const label = escapeHtml(q.label || `Question ${i + 1}`);
        const placeholder = escapeHtml(q.placeholder || '');
        const value = escapeHtml(questionnaireAnswers[i] || '');
        if (q.style === 'paragraph') {
          return `<label class="questionnaire-field">
            <span class="questionnaire-field__label">${label}</span>
            <textarea class="questionnaire-field__input questionnaire-field__input--area" data-question-index="${i}" maxlength="${maxLength}" placeholder="${placeholder}">${value}</textarea>
          </label>`;
        }
        return `<label class="questionnaire-field">
          <span class="questionnaire-field__label">${label}</span>
          <input class="questionnaire-field__input" data-question-index="${i}" maxlength="${maxLength}" placeholder="${placeholder}" value="${value}" />
        </label>`;
      })
      .join('');
  }

  function showQuestionsPhase() {
    phaseSpeed.hidden = true;
    phaseSpeed.setAttribute('aria-hidden', 'true');
    phaseQuestions.hidden = false;
    phaseQuestions.setAttribute('aria-hidden', 'false');
    phaseVoice.hidden = true;
    phaseVoice.setAttribute('aria-hidden', 'true');
    renderQuestionnaireFields();
  }

  function showVoicePhase() {
    phaseQuestions.hidden = true;
    phaseQuestions.setAttribute('aria-hidden', 'true');
    phaseVoice.hidden = false;
    phaseVoice.setAttribute('aria-hidden', 'false');
  }

  function clearVoicePreview() {
    voiceNoteFile = null;
    if (voicePreview) {
      voicePreview.pause();
      voicePreview.removeAttribute('src');
      voicePreview.load();
    }
    if (voicePreviewUrl) {
      URL.revokeObjectURL(voicePreviewUrl);
      voicePreviewUrl = '';
    }
    if (voicePreviewWrap) voicePreviewWrap.hidden = true;
    if (voicePreviewName) voicePreviewName.textContent = '';
    if (voiceNoteInput) voiceNoteInput.value = '';
  }

  function setVoiceNoteFile(file, sourceLabel) {
    clearVoicePreview();
    voiceNoteFile = file;
    if (!file) return;
    if (voicePreviewName) {
      const kb = typeof file.size === 'number' ? ` · ${(file.size / 1024).toFixed(1)} KB` : '';
      voicePreviewName.textContent = `${sourceLabel}: ${file.name || 'voice-note'}${kb}`;
    }
    if (voicePreview && file instanceof Blob) {
      voicePreviewUrl = URL.createObjectURL(file);
      voicePreview.src = voicePreviewUrl;
    }
    if (voicePreviewWrap) voicePreviewWrap.hidden = false;
  }

  function stopActiveRecorderTracks() {
    if (activeRecorderStream) {
      for (const track of activeRecorderStream.getTracks()) track.stop();
    }
    activeRecorderStream = null;
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') {
      if (voiceRecordStatus) voiceRecordStatus.textContent = 'Recording is not available in this browser. Upload an audio file instead.';
      return;
    }
    try {
      clearVoicePreview();
      activeRecorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeChunks = [];
      activeRecorder = new window.MediaRecorder(activeRecorderStream);
      activeRecorder.addEventListener('dataavailable', (e) => {
        if (e.data && e.data.size > 0) activeChunks.push(e.data);
      });
      activeRecorder.addEventListener('stop', () => {
        const type = activeChunks[0]?.type || activeRecorder?.mimeType || 'audio/webm';
        const ext = type.includes('mp4') || type.includes('aac') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(activeChunks, { type });
        const file = new File([blob], `voice-note.${ext}`, { type });
        setVoiceNoteFile(file, 'Recorded voice note');
        stopActiveRecorderTracks();
        activeRecorder = null;
        activeChunks = [];
        if (voiceRecordStartBtn) voiceRecordStartBtn.disabled = false;
        if (voiceRecordStopBtn) voiceRecordStopBtn.disabled = true;
        if (voiceRecordStatus) voiceRecordStatus.textContent = 'Recording saved. You can submit now or upload a different file.';
      });
      activeRecorder.start();
      if (voiceRecordStartBtn) voiceRecordStartBtn.disabled = true;
      if (voiceRecordStopBtn) voiceRecordStopBtn.disabled = false;
      if (voiceRecordStatus) voiceRecordStatus.textContent = 'Recording… click Stop when you are done.';
    } catch (e) {
      stopActiveRecorderTracks();
      activeRecorder = null;
      if (voiceRecordStatus) voiceRecordStatus.textContent = `Could not start recording: ${String(e.message || e)}`;
    }
  }

  function stopVoiceRecording() {
    if (activeRecorder && activeRecorder.state !== 'inactive') {
      activeRecorder.stop();
    }
  }

  function tickExp() {
    const left = exp - Math.floor(Date.now() / 1000);
    if (left <= 0) {
      expLeftEl.textContent = 'expired';
      return;
    }
    const m = Math.floor(left / 60);
    const s = left % 60;
    expLeftEl.textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  tickExp();
  const expTimer = setInterval(tickExp, 1000);

  function dismissOverlay() {
    if (overlayDismissed) return;
    overlayDismissed = true;
    raceOverlay.hidden = true;
    raceOverlay.setAttribute('aria-hidden', 'true');
  }

  function builtPassage() {
    return accepted.join(' ');
  }

  function renderCurrentWordInner(w, inputRaw) {
    const att = normalizeWord(inputRaw);
    const fe = firstErrorIndex(w, att);
    let html = '';
    for (let j = 0; j < w.length; j += 1) {
      let cls = 'rw-ch rw-ch--todo';
      if (fe === -1) {
        if (j < att.length) cls = 'rw-ch rw-ch--ok';
        else cls = 'rw-ch rw-ch--todo';
      } else if (j < fe) {
        cls = 'rw-ch rw-ch--ok';
      } else {
        cls = 'rw-ch rw-ch--bad';
      }
      html += `<span class="${cls}">${escapeHtml(w[j])}</span>`;
    }
    if (att.length > w.length) {
      for (let k = w.length; k < att.length; k += 1) {
        html += `<span class="rw-ch rw-ch--extra">${escapeHtml(att[k])}</span>`;
      }
    }
    return html;
  }

  function renderPassage() {
    if (completed) {
      racePassage.innerHTML = `<div class="race-flow"><span class="race-done-run">${escapeHtml(expectedNorm)}</span></div>`;
      return;
    }

    let html = '<div class="race-flow">';
    if (wordIndex > 0) {
      html += `<span class="race-done-run">${escapeHtml(accepted.join(' '))}</span>`;
    }
    if (wordIndex < wordList.length) {
      const w = wordList[wordIndex];
      if (wordIndex > 0) html += ' ';
      const pm = prefixMatchLen(w, normalizeWord(wordInput.value));
      const up = w.length ? (pm / w.length) * 100 : 0;
      const inner = renderCurrentWordInner(w, wordInput.value);
      html += `<span class="race-current" style="--u:${up}"><span class="race-word__inner">${inner}</span></span>`;
      const rest = wordList.slice(wordIndex + 1);
      if (rest.length > 0) {
        html += ` <span class="race-future-plain">${escapeHtml(rest.join(' '))}</span>`;
      }
    }
    html += '</div>';
    racePassage.innerHTML = html;
  }

  function accuracyLive() {
    const good = completed ? wordList.length : wordIndex;
    const bad = badSpaceCount;
    const tot = good + bad;
    if (tot === 0) return 100;
    return Math.min(100, Math.round((good / tot) * 1000) / 10);
  }

  function refreshAll() {
    renderPassage();
    syncStats();
  }

  function completeRun() {
    completed = true;
    const end = performance.now();
    finalElapsed = startAt != null ? (end - startAt) / 1000 : 0;
    const full = builtPassage();
    finalWpm = wpmFromNormalizedLength(normalizeTypingText(full).length, finalElapsed);
    wordInput.disabled = true;
    wordInput.value = '';
    renderPassage();
    completePanel.hidden = false;
    completePanel.setAttribute('aria-hidden', 'false');
    if (finalWpm >= targetWpm) {
      completeMsg.className = 'complete-panel__msg';
      completeMsg.textContent = `Done — ${finalWpm.toFixed(0)} WPM in ${finalElapsed.toFixed(1)}s. Submit or retake.`;
    } else {
      completeMsg.className = 'complete-panel__msg complete-panel__msg--warn';
      completeMsg.textContent = `Done — ${finalWpm.toFixed(0)} WPM (need ≥ ${targetWpm} to submit). Retake?`;
    }
    syncStats();
  }

  function syncStats() {
    const full = builtPassage();
    const partialRaw =
      full && wordInput.value ? `${full} ${wordInput.value}` : full || wordInput.value || '';
    const partialLen = normalizeTypingText(partialRaw).length;
    const elapsed =
      startAt != null && !completed
        ? (performance.now() - startAt) / 1000
        : completed
          ? finalElapsed
          : 0;
    const wpm =
      completed
        ? finalWpm
        : startAt != null && elapsed > 0
          ? wpmFromNormalizedLength(partialLen, elapsed)
          : 0;
    const acc = accuracyLive();

    statsBar.innerHTML = `
      <div class="stat">${ICON_TIMER}<div class="stat-body"><span class="stat-val">${elapsed > 0 ? elapsed.toFixed(1) : '0.0'}s</span><span class="stat-label">Time</span></div></div>
      <div class="stat">${ICON_SPEED}<div class="stat-body"><span class="stat-val">${wpm.toFixed(0)}</span><span class="stat-label">WPM</span></div></div>
      <div class="stat">${ICON_ACCURACY}<div class="stat-body"><span class="stat-val">${acc.toFixed(0)}%</span><span class="stat-label">Accuracy</span></div></div>
    `;

    const canSubmit = completed && finalWpm >= targetWpm;
    submitBtn.disabled = !canSubmit;
    submitBtn.title = !completed ? 'Complete all words' : finalWpm < targetWpm ? `Need ${targetWpm}+ WPM` : '';
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function runSpeedQaChat() {
    const stream = wrap.querySelector('#speedChatStream');
    const input = wrap.querySelector('#speedChatInput');
    const sendBtn = wrap.querySelector('#speedChatSend');
    if (!stream || !input || !sendBtn) return;
    stream.innerHTML = '';
    const items = [];

    function appendFan(text) {
      const row = document.createElement('div');
      row.className = 'of-msg of-msg--fan';
      row.innerHTML = `<div class="of-msg__avatar" aria-hidden="true">$</div>
        <div class="of-msg__fanCol">
          <span class="of-msg__name">Gooner</span>
          <div class="of-msg__bubble">${escapeHtml(text)}</div>
        </div>`;
      stream.appendChild(row);
      stream.scrollTop = stream.scrollHeight;
    }
    function appendUser(text) {
      const row = document.createElement('div');
      row.className = 'of-msg of-msg--user';
      row.innerHTML = `<div class="of-msg__bubble">${escapeHtml(text)}</div>`;
      stream.appendChild(row);
      stream.scrollTop = stream.scrollHeight;
    }
    function showTypingBubble() {
      const row = document.createElement('div');
      row.className = 'of-typing-wrap';
      row.innerHTML = `<div class="of-msg of-msg--fan">
        <div class="of-msg__avatar" aria-hidden="true">$</div>
        <div class="of-msg__fanCol">
          <span class="of-msg__name">Gooner</span>
          <div class="of-typing" aria-hidden="true"><span></span><span></span><span></span></div>
        </div>
      </div>`;
      stream.appendChild(row);
      stream.scrollTop = stream.scrollHeight;
      return row;
    }

    function waitReply() {
      return new Promise((resolve) => {
        const done = () => {
          const t = input.value.trim();
          if (!t) return;
          input.value = '';
          sendBtn.removeEventListener('click', onClick);
          input.removeEventListener('keydown', onKey);
          resolve(t);
        };
        const onClick = () => done();
        const onKey = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            done();
          }
        };
        sendBtn.addEventListener('click', onClick);
        input.addEventListener('keydown', onKey);
      });
    }

    for (let i = 0; i < speedQuestions.length; i += 1) {
      const typingRow = showTypingBubble();
      await sleep(1300 + Math.floor(Math.random() * 500));
      typingRow.remove();
      appendFan(speedQuestions[i]);
      const t0 = performance.now();
      input.disabled = false;
      sendBtn.disabled = false;
      input.placeholder = 'Reply…';
      input.focus();
      const text = await waitReply();
      const elapsed = (performance.now() - t0) / 1000;
      items.push({ reply: text, elapsed_sec: elapsed });
      appendUser(text);
      input.disabled = true;
      sendBtn.disabled = true;
    }

    if (!typingReceipt) {
      msgEl.hidden = false;
      msgEl.className = 'msg msg--err';
      msgEl.textContent = 'Missing typing receipt. Submit your typing score again, then run Speed Q&A.';
      phaseTyping.style.display = '';
      phaseSpeed.hidden = true;
      phaseSpeed.setAttribute('aria-hidden', 'true');
      if (speedQaIntro) speedQaIntro.hidden = false;
      if (speedQaChatWrap) speedQaChatWrap.hidden = true;
      submitBtn.disabled = false;
      retakeBtn.disabled = false;
      return;
    }

    speedQaItems = items;
    input.placeholder = 'Message…';
    showQuestionsPhase();
  }

  function tryCommitWord() {
    const target = wordList[wordIndex];
    const cand = normalizeWord(wordInput.value);
    if (cand !== target) {
      badSpaceCount += 1;
      syncStats();
      wordInput.classList.add('word-input--shake');
      setTimeout(() => wordInput.classList.remove('word-input--shake'), 350);
      return;
    }
    accepted.push(target);
    wordIndex += 1;
    wordInput.value = '';
    if (wordIndex >= wordList.length) {
      completeRun();
    } else {
      refreshAll();
    }
  }

  wordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') e.preventDefault();
    if (completed) return;
    dismissOverlay();
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      tryCommitWord();
    }
  });

  wordInput.addEventListener('input', () => {
    if (completed) return;
    dismissOverlay();
    if (wordInput.value.length > 0 && startAt == null) {
      startAt = performance.now();
    }
    refreshAll();
  });

  wordInput.addEventListener('paste', (e) => e.preventDefault());

  retakeBtn.addEventListener('click', async () => {
    msgEl.hidden = true;
    stopVoiceRecording();
    stopActiveRecorderTracks();
    try {
      const r = await fetch(`/api/session?t=${encodeURIComponent(token)}`);
      const raw = await r.text();
      let next;
      try {
        next = JSON.parse(raw);
      } catch {
        msgEl.hidden = false;
        msgEl.className = 'msg msg--err';
        msgEl.textContent = 'Could not load a new passage.';
        return;
      }
      if (!r.ok || !Array.isArray(next.passages) || next.passages.length === 0 || typeof next.roundProof !== 'string') {
        msgEl.hidden = false;
        msgEl.className = 'msg msg--err';
        msgEl.textContent = next.hint || next.error || 'Could not load a new passage.';
        return;
      }
      roundProof = next.roundProof;
      expectedNorm = next.passages.join(' ');
      wordList = expectedNorm.split(' ').filter((w) => w.length > 0);
      if (Array.isArray(next.speedQuestions) && next.speedQuestions.length && next.speedQaProof) {
        speedQuestions = next.speedQuestions;
        speedQaProof = next.speedQaProof;
      }
    } catch (e) {
      msgEl.hidden = false;
      msgEl.className = 'msg msg--err';
      msgEl.textContent = String(e.message || e);
      return;
    }
    wordIndex = 0;
    accepted.length = 0;
    badSpaceCount = 0;
    startAt = null;
    completed = false;
    finalWpm = 0;
    finalElapsed = 0;
    wordInput.value = '';
    wordInput.disabled = false;
    completePanel.hidden = true;
    completePanel.setAttribute('aria-hidden', 'true');
    overlayDismissed = false;
    raceOverlay.hidden = false;
    raceOverlay.setAttribute('aria-hidden', 'false');
    phaseTyping.style.display = '';
    phaseSpeed.hidden = true;
    phaseSpeed.setAttribute('aria-hidden', 'true');
    phaseQuestions.hidden = true;
    phaseQuestions.setAttribute('aria-hidden', 'true');
    phaseVoice.hidden = true;
    phaseVoice.setAttribute('aria-hidden', 'true');
    phaseAllDone.hidden = true;
    typingReceipt = null;
    speedQaItems = [];
    questionnaireAnswers = [];
    clearVoicePreview();
    if (voiceRecordStatus) voiceRecordStatus.textContent = 'You can record here or upload an audio file below.';
    if (voiceRecordStartBtn) voiceRecordStartBtn.disabled = false;
    if (voiceRecordStopBtn) voiceRecordStopBtn.disabled = true;
    if (finalSubmitBtn) finalSubmitBtn.disabled = false;
    if (phaseAllDoneBtn) phaseAllDoneBtn.disabled = false;
    if (phaseAllDoneFine) phaseAllDoneFine.hidden = true;
    if (speedQaIntro) speedQaIntro.hidden = true;
    if (speedQaChatWrap) speedQaChatWrap.hidden = true;
    renderQuestionnaireFields();
    const sc = wrap.querySelector('#speedChatStream');
    if (sc) sc.innerHTML = '';
    refreshAll();
    wordInput.focus();
  });

  if (speedQaStartBtn) {
    speedQaStartBtn.addEventListener('click', () => {
      msgEl.hidden = true;
      if (speedQaIntro) speedQaIntro.hidden = true;
      if (speedQaChatWrap) speedQaChatWrap.hidden = false;
      void runSpeedQaChat().catch((e) => {
        msgEl.hidden = false;
        msgEl.className = 'msg msg--err';
        msgEl.textContent = String(e.message || e);
        phaseTyping.style.display = '';
        phaseSpeed.hidden = true;
        phaseSpeed.setAttribute('aria-hidden', 'true');
        if (speedQaIntro) speedQaIntro.hidden = false;
        if (speedQaChatWrap) speedQaChatWrap.hidden = true;
        submitBtn.disabled = false;
        retakeBtn.disabled = false;
      });
    });
  }

  if (questionnaireContinueBtn) {
    questionnaireContinueBtn.addEventListener('click', () => {
      msgEl.hidden = true;
      const nextAnswers = [];
      for (let i = 0; i < applicationQuestions.length; i += 1) {
        const field = wrap.querySelector(`[data-question-index="${i}"]`);
        const answer = String(field?.value ?? '').trim();
        if (!answer) {
          msgEl.hidden = false;
          msgEl.className = 'msg msg--err';
          msgEl.textContent = `Please answer question ${i + 1} before continuing.`;
          field?.focus();
          return;
        }
        nextAnswers.push(answer);
      }
      questionnaireAnswers = nextAnswers;
      showVoicePhase();
    });
  }

  if (voiceRecordStartBtn) {
    voiceRecordStartBtn.addEventListener('click', () => {
      void startVoiceRecording();
    });
  }

  if (voiceRecordStopBtn) {
    voiceRecordStopBtn.addEventListener('click', () => {
      stopVoiceRecording();
    });
  }

  if (voiceNoteInput) {
    voiceNoteInput.addEventListener('change', () => {
      const file = voiceNoteInput.files && voiceNoteInput.files[0];
      if (!file) return;
      setVoiceNoteFile(file, 'Uploaded voice note');
      if (voiceRecordStatus) voiceRecordStatus.textContent = 'Audio file attached. You can submit now.';
    });
  }

  if (finalSubmitBtn) {
    finalSubmitBtn.addEventListener('click', async () => {
      msgEl.hidden = true;
      if (!typingReceipt) {
        msgEl.hidden = false;
        msgEl.className = 'msg msg--err';
        msgEl.textContent = 'Missing typing receipt. Restart from the typing step.';
        return;
      }
      if (!Array.isArray(speedQaItems) || speedQaItems.length !== speedQuestions.length) {
        msgEl.hidden = false;
        msgEl.className = 'msg msg--err';
        msgEl.textContent = 'Speed Q&A is incomplete. Finish that step before submitting.';
        return;
      }
      if (questionnaireAnswers.length !== applicationQuestions.length) {
        msgEl.hidden = false;
        msgEl.className = 'msg msg--err';
        msgEl.textContent = 'Finish the questionnaire before submitting.';
        return;
      }
      if (!voiceNoteFile) {
        msgEl.hidden = false;
        msgEl.className = 'msg msg--err';
        msgEl.textContent = 'Please record or upload a voice note before submitting.';
        return;
      }
      if (typeof voiceNoteFile.size === 'number' && voiceNoteFile.size > 8 * 1024 * 1024) {
        msgEl.hidden = false;
        msgEl.className = 'msg msg--err';
        msgEl.textContent = 'Voice note is too large. Keep it under 8 MB.';
        return;
      }

      finalSubmitBtn.disabled = true;
      if (voiceRecordStartBtn) voiceRecordStartBtn.disabled = true;
      if (voiceRecordStopBtn) voiceRecordStopBtn.disabled = true;
      try {
        if (voiceRecordStatus) voiceRecordStatus.textContent = 'Converting voice note to MP3…';
        let voiceForSubmit;
        try {
          voiceForSubmit = await audioBlobToMp3File(voiceNoteFile);
        } catch (convErr) {
          msgEl.hidden = false;
          msgEl.className = 'msg msg--err';
          msgEl.textContent = `Could not convert voice note to MP3: ${String(convErr.message || convErr)}. Try uploading an MP3 file, or use Chrome/Edge for recording.`;
          finalSubmitBtn.disabled = false;
          if (voiceRecordStartBtn && !activeRecorder) voiceRecordStartBtn.disabled = false;
          if (voiceRecordStopBtn && activeRecorder) voiceRecordStopBtn.disabled = false;
          if (voiceRecordStatus) voiceRecordStatus.textContent = 'You can record here or upload an audio file below.';
          return;
        }
        if (typeof voiceForSubmit.size === 'number' && voiceForSubmit.size > 8 * 1024 * 1024) {
          msgEl.hidden = false;
          msgEl.className = 'msg msg--err';
          msgEl.textContent = 'Voice note is too large after conversion. Keep the recording shorter or under 8 MB.';
          finalSubmitBtn.disabled = false;
          if (voiceRecordStartBtn && !activeRecorder) voiceRecordStartBtn.disabled = false;
          if (voiceRecordStopBtn && activeRecorder) voiceRecordStopBtn.disabled = false;
          if (voiceRecordStatus) voiceRecordStatus.textContent = 'You can record here or upload an audio file below.';
          return;
        }
        if (voiceRecordStatus) voiceRecordStatus.textContent = 'Submitting…';

        const fd = new FormData();
        fd.append('token', token);
        fd.append('typingReceipt', typingReceipt);
        fd.append('speedQaProof', speedQaProof);
        fd.append('questionnaire', JSON.stringify(questionnaireAnswers));
        fd.append('items', JSON.stringify(speedQaItems));
        fd.append('voiceNote', voiceForSubmit);

        const r = await fetch('/api/final-submit', {
          method: 'POST',
          body: fd,
        });
        let out = {};
        try {
          out = await r.json();
        } catch {
          out = {};
        }
        if (!r.ok) {
          msgEl.hidden = false;
          msgEl.className = 'msg msg--err';
          msgEl.textContent = [out.error, out.detail, out.hint].filter(Boolean).join(' — ') || 'Final submit failed.';
          finalSubmitBtn.disabled = false;
          if (voiceRecordStartBtn && !activeRecorder) voiceRecordStartBtn.disabled = false;
          if (voiceRecordStopBtn && activeRecorder) voiceRecordStopBtn.disabled = false;
          if (voiceRecordStatus) voiceRecordStatus.textContent = 'You can record here or upload an audio file below.';
          return;
        }

        phaseVoice.hidden = true;
        phaseVoice.setAttribute('aria-hidden', 'true');
        phaseAllDone.hidden = false;
        phaseAllDone.setAttribute('aria-hidden', 'false');
      } catch (e) {
        msgEl.hidden = false;
        msgEl.className = 'msg msg--err';
        msgEl.textContent = `Final submit failed: ${String(e.message || e)}.`;
        finalSubmitBtn.disabled = false;
        if (voiceRecordStartBtn && !activeRecorder) voiceRecordStartBtn.disabled = false;
        if (voiceRecordStopBtn && activeRecorder) voiceRecordStopBtn.disabled = false;
        if (voiceRecordStatus) voiceRecordStatus.textContent = 'You can record here or upload an audio file below.';
      }
    });
  }

  submitBtn.addEventListener('click', async () => {
    msgEl.hidden = true;
    const actual = builtPassage();
    if (!completed || normalizeTypingText(actual) !== expectedNorm) {
      msgEl.hidden = false;
      msgEl.className = 'msg msg--err';
      msgEl.textContent = 'Complete every word to submit.';
      return;
    }
    if (finalWpm < targetWpm) {
      msgEl.hidden = false;
      msgEl.className = 'msg msg--err';
      msgEl.textContent = `Need at least ${targetWpm} WPM.`;
      return;
    }

    submitBtn.disabled = true;
    retakeBtn.disabled = true;
    try {
      const r = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          roundProof,
          lines: [{ actual, elapsed_sec: finalElapsed }],
        }),
      });
      let out = {};
      try {
        out = await r.json();
      } catch {
        out = {};
      }
      if (!r.ok) {
        msgEl.hidden = false;
        msgEl.className = 'msg msg--err';
        const bits = [out.error || `HTTP ${r.status}`];
        if (out.detail) bits.push(out.detail);
        if (out.hint) bits.push(out.hint);
        if (out.error === 'server_misconfigured') bits.push('Set DISCORD_BOT_TOKEN in Cloudflare Pages.');
        msgEl.textContent = bits.join(' — ');
        submitBtn.disabled = false;
        retakeBtn.disabled = false;
        return;
      }
      if (!out.eliminated && typeof out.typingReceipt !== 'string') {
        msgEl.hidden = false;
        msgEl.className = 'msg msg--err';
        msgEl.textContent = 'Server did not return a typing receipt. Redeploy the typing site and try again.';
        submitBtn.disabled = false;
        retakeBtn.disabled = false;
        return;
      }
      typingReceipt = out.eliminated ? null : out.typingReceipt;
      clearInterval(expTimer);
      clearInterval(statsLoop);
      completePanel.hidden = true;
      completePanel.setAttribute('aria-hidden', 'true');
      msgEl.hidden = true;
      if (out.eliminated) {
        phaseTyping.style.display = '';
        submittedKicker.textContent = 'Recorded';
        submittedTitle.textContent = 'Result logged — below minimum WPM';
        submittedDetail.textContent = `Your run (${finalWpm.toFixed(0)} WPM, ${finalElapsed.toFixed(1)}s) was below the minimum of ${targetWpm} WPM.`;
        submittedFine.textContent =
          'This session is closed. Retaking is not available after submit.';
        submittedPanel.classList.add('session-submitted--warn');
        submittedPanel.hidden = false;
        submittedPanel.setAttribute('aria-hidden', 'false');
      } else {
        phaseTyping.style.display = 'none';
        phaseAllDone.hidden = true;
        const sc = wrap.querySelector('#speedChatStream');
        if (sc) sc.innerHTML = '';
        if (speedQaIntro) speedQaIntro.hidden = false;
        if (speedQaChatWrap) speedQaChatWrap.hidden = true;
        phaseSpeed.hidden = false;
        phaseSpeed.setAttribute('aria-hidden', 'false');
      }
    } catch (e) {
      msgEl.hidden = false;
      msgEl.className = 'msg msg--err';
      msgEl.textContent = `Submit failed: ${e.message || e}.`;
      submitBtn.disabled = false;
      retakeBtn.disabled = false;
    }
  });

  statsLoop = setInterval(() => {
    if (!completed && startAt != null) syncStats();
  }, 80);

  raceOverlay.addEventListener('click', () => {
    dismissOverlay();
    wordInput.focus();
  });

  if (phaseAllDoneBtn && phaseAllDoneFine) {
    phaseAllDoneBtn.addEventListener('click', () => {
      try {
        window.close();
      } catch {
      }
      phaseAllDoneFine.hidden = false;
      phaseAllDoneBtn.disabled = true;
    });
  }

  renderQuestionnaireFields();
  if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') {
    if (voiceRecordStatus) voiceRecordStatus.textContent = 'Recording is not available in this browser. Upload an audio file instead.';
    if (voiceRecordStartBtn) voiceRecordStartBtn.disabled = true;
    if (voiceRecordStopBtn) voiceRecordStopBtn.disabled = true;
  }

  refreshAll();
  wordInput.focus();
}

initVantaBg();
