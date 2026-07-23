const api = typeof browser !== 'undefined' ? browser : chrome;

(async function () {
  let originalTitle = document.title;
  let currentPrefix = '';

  // Get current window name and options
  try {
    const response = await api.runtime.sendMessage({ type: 'GET_WINDOW_NAME' });
    if (response && response.success) {
      const { windowName, options } = response;
      if (options && options.enableTitleDecorator && windowName) {
        applyPrefix(windowName);
      }
    }
  } catch (e) {
    // Content scripts may fail on certain special restricted pages
  }

  function applyPrefix(windowName) {
    if (!windowName) return;
    currentPrefix = `[${windowName}] `;
    
    // Clean original title if already prefixed
    let cleanTitle = document.title;
    if (cleanTitle.startsWith(currentPrefix)) {
      cleanTitle = cleanTitle.substring(currentPrefix.length);
    }
    
    document.title = currentPrefix + cleanTitle;
  }

  // Listen for runtime updates when user changes window name in popup
  api.runtime.onMessage.addListener((message) => {
    if (message.type === 'WINDOW_NAME_UPDATED') {
      if (message.windowName) {
        applyPrefix(message.windowName);
      }
    }
  });
})();
