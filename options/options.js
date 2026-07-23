const api = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', async () => {
  const enableTitleDecorator = document.getElementById('enableTitleDecorator');
  const resetAllNamesBtn = document.getElementById('resetAllNamesBtn');
  const statusToast = document.getElementById('statusToast');

  // Load saved options
  try {
    const { options = {} } = await api.storage.local.get('options');
    enableTitleDecorator.checked = !!options.enableTitleDecorator;
  } catch (e) {
    console.error('Failed to load options:', e);
  }

  // Show Toast notification
  function showToast(msg) {
    statusToast.textContent = msg;
    statusToast.classList.remove('hidden');
    setTimeout(() => {
      statusToast.classList.add('hidden');
    }, 2000);
  }

  // Save changes
  enableTitleDecorator.addEventListener('change', async () => {
    try {
      const { options = {} } = await api.storage.local.get('options');
      options.enableTitleDecorator = enableTitleDecorator.checked;
      await api.storage.local.set({ options });
      showToast('Settings saved!');
    } catch (e) {
      console.error('Failed to save option:', e);
    }
  });

  // Reset all names
  if (resetAllNamesBtn) {
    resetAllNamesBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all custom window names? This action cannot be undone.')) {
        try {
          await api.runtime.sendMessage({ type: 'CLEAR_ALL_NAMES' });
          showToast('All custom window names cleared!');
        } catch (e) {
          console.error('Failed to reset names:', e);
        }
      }
    });
  }
});
