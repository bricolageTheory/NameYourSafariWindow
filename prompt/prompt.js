const api = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', async () => {
  const windowNameInput = document.getElementById('windowNameInput');
  const applyBtn = document.getElementById('applyBtn');
  const skipBtn = document.getElementById('skipBtn');

  // Extract targetWindowId from URL query string
  const urlParams = new URLSearchParams(window.location.search);
  const targetWindowId = parseInt(urlParams.get('targetWindowId'), 10);

  windowNameInput.focus();

  async function applyName() {
    const name = windowNameInput.value.trim();
    if (name && targetWindowId) {
      await api.runtime.sendMessage({
        type: 'SET_WINDOW_NAME',
        windowId: targetWindowId,
        name
      });
    }
    window.close();
  }

  function skipPrompt() {
    window.close();
  }

  applyBtn.addEventListener('click', applyName);
  skipBtn.addEventListener('click', skipPrompt);

  windowNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      applyName();
    } else if (e.key === 'Escape') {
      skipPrompt();
    }
  });
});
