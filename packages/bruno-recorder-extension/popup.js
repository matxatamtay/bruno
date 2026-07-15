const portInput = document.getElementById('port');
const tokenInput = document.getElementById('token');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const statusElement = document.getElementById('status');

const send = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));

const setStatus = (message, kind = '') => {
  statusElement.textContent = message;
  statusElement.className = kind;
};

const refresh = async () => {
  const saved = await chrome.storage.local.get(['brunoRecorderPort', 'brunoRecorderToken']);
  portInput.value = saved.brunoRecorderPort || 6174;
  tokenInput.value = saved.brunoRecorderToken || '';
  const status = await send({ type: 'BRUNO_RECORDER_STATUS_COMMAND' });
  startButton.disabled = Boolean(status?.recording);
  stopButton.disabled = !status?.recording;
  if (status?.recording) setStatus(`Recording tab ${status.tabId} into session ${status.sessionId}`, 'ok');
};

const normalizePairingInput = () => {
  const raw = tokenInput.value.trim();
  if (!raw.startsWith('{')) return raw;
  try {
    const pairing = JSON.parse(raw);
    if (pairing.port) portInput.value = String(pairing.port);
    if (pairing.token) tokenInput.value = String(pairing.token);
    return String(pairing.token || '').trim();
  } catch {
    return raw;
  }
};

tokenInput.addEventListener('paste', () => setTimeout(normalizePairingInput, 0));

startButton.addEventListener('click', async () => {
  setStatus('Attaching to current tab…');
  startButton.disabled = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || /^(chrome|edge|about|devtools):/i.test(tab.url || '')) {
    setStatus('Open a normal http/https page first.', 'error');
    startButton.disabled = false;
    return;
  }
  const result = await send({
    type: 'BRUNO_RECORDER_START_COMMAND',
    tabId: tab.id,
    port: Number(portInput.value),
    token: normalizePairingInput()
  });
  if (result?.error) {
    setStatus(result.error, 'error');
    startButton.disabled = false;
    return;
  }
  stopButton.disabled = false;
  setStatus(`Recording “${tab.title || tab.url}”`, 'ok');
});

stopButton.addEventListener('click', async () => {
  stopButton.disabled = true;
  const result = await send({ type: 'BRUNO_RECORDER_STOP_COMMAND' });
  if (result?.error) setStatus(result.error, 'error');
  else setStatus('Recorder detached. Stop the session in Bruno when finished.');
  startButton.disabled = false;
});

refresh().catch((error) => setStatus(error.message, 'error'));
