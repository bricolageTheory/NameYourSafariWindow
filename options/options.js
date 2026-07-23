const api = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', async () => {
  const enableTitleDecorator = document.getElementById('enableTitleDecorator');
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
});
