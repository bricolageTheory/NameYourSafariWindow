const api = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  const searchContainer = document.getElementById('searchContainer');
  const filterToggleBtn = document.getElementById('filterToggleBtn');
  const windowList = document.getElementById('windowList');
  const windowCount = document.getElementById('windowCount');
  const emptyState = document.getElementById('emptyState');

  const QUICK_KEY_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];

  let allWindows = [];
  let currentWindowId = null;
  let selectedIndex = 0;
  let editingWindowId = null; // Tracks which window is currently being edited inline
  let quickKeyMap = {}; // Maps letter -> windowId

  // Load windows and populate UI
  async function loadWindows() {
    try {
      const response = await api.runtime.sendMessage({ type: 'GET_WINDOWS' });
      if (response && response.success) {
        allWindows = response.windows;
        currentWindowId = response.currentWindowId;
        renderWindowList(allWindows);
      }
    } catch (error) {
      console.error('Failed to load windows:', error);
    }
  }

  // Safe DOM construction using native HTML <button> elements for items
  function renderWindowList(windowsToRender) {
    windowList.textContent = ''; // Clear previous items safely
    quickKeyMap = {};
    const query = searchInput.value.toLowerCase().trim();

    const filtered = windowsToRender.filter(w => {
      const nameMatch = w.name.toLowerCase().includes(query);
      const tabMatch = w.activeTabTitle.toLowerCase().includes(query);
      return nameMatch || tabMatch;
    });

    windowCount.textContent = filtered.length;

    if (filtered.length === 0) {
      emptyState.classList.remove('hidden');
      windowList.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    windowList.classList.remove('hidden');

    if (selectedIndex >= filtered.length) {
      selectedIndex = Math.max(0, filtered.length - 1);
    }

    filtered.forEach((win, index) => {
      const item = document.createElement('button'); // Render as native <button>
      item.type = 'button';
      item.className = `window-item ${win.focused ? 'is-current' : ''} ${index === selectedIndex ? 'active-selection' : ''}`;
      item.setAttribute('role', 'option');
      item.setAttribute('tabindex', '0');
      item.dataset.windowId = win.id;
      item.dataset.index = index;

      // Assign Quick-Key badge letter
      const quickKey = QUICK_KEY_LETTERS[index];
      if (quickKey) {
        quickKeyMap[quickKey] = win.id;
        const keyBadge = document.createElement('span');
        keyBadge.className = 'quick-key-badge';
        keyBadge.textContent = quickKey;
        item.appendChild(keyBadge);
      }

      // Window Info container
      const info = document.createElement('div');
      info.className = 'window-info';

      if (editingWindowId === win.id) {
        // INLINE EDITING MODE
        const editWrapper = document.createElement('div');
        editWrapper.className = 'inline-edit-wrapper';

        const editContainer = document.createElement('div');
        editContainer.className = 'inline-edit-container';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'inline-edit-input';
        input.value = win.name || '';
        input.maxLength = 50;
        input.placeholder = 'Enter unique window name...';

        const errorBanner = document.createElement('div');
        errorBanner.className = 'inline-error-text hidden';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'inline-btn';
        saveBtn.textContent = '✔️';
        saveBtn.title = 'Save name';

        const validateInput = () => {
          const val = input.value.trim().toLowerCase();
          if (!val) {
            errorBanner.classList.add('hidden');
            input.classList.remove('has-error');
            return true;
          }
          const duplicate = allWindows.find(other => other.id !== win.id && (other.name || '').trim().toLowerCase() === val);
          if (duplicate) {
            errorBanner.textContent = `⚠️ "${input.value.trim()}" is already assigned to another window. Please choose a unique name.`;
            errorBanner.classList.remove('hidden');
            input.classList.add('has-error');
            return false;
          }
          errorBanner.classList.add('hidden');
          input.classList.remove('has-error');
          return true;
        };

        const commitInlineSave = async () => {
          if (!validateInput()) {
            input.focus();
            input.select();
            return;
          }

          const newName = input.value.trim();
          const response = await api.runtime.sendMessage({
            type: 'SET_WINDOW_NAME',
            windowId: win.id,
            name: newName
          });

          if (response && !response.success && response.error === 'DUPLICATE_NAME') {
            errorBanner.textContent = `⚠️ "${response.duplicateName}" is already assigned to another window. Please choose a unique name.`;
            errorBanner.classList.remove('hidden');
            input.classList.add('has-error');
            input.focus();
            input.select();
            return;
          }

          editingWindowId = null;
          await loadWindows();
        };

        saveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          commitInlineSave();
        });

        input.addEventListener('input', () => {
          validateInput();
        });

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.stopPropagation();
            commitInlineSave();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            editingWindowId = null;
            renderWindowList(allWindows);
          }
        });

        editContainer.appendChild(input);
        editContainer.appendChild(saveBtn);
        
        editWrapper.appendChild(editContainer);
        editWrapper.appendChild(errorBanner);
        info.appendChild(editWrapper);

        setTimeout(() => {
          input.focus();
          input.select();
        }, 50);

      } else {
        // NORMAL DISPLAY MODE
        const titleRow = document.createElement('div');
        titleRow.className = 'title-row';

        const title = document.createElement('div');
        title.className = 'window-title';
        title.textContent = win.name ? win.name : `Window #${win.id} (Unnamed)`;

        const editIcon = document.createElement('button');
        editIcon.type = 'button';
        editIcon.className = 'icon-edit-btn';
        editIcon.textContent = '✏️';
        editIcon.title = 'Rename this window';

        editIcon.addEventListener('click', (e) => {
          e.stopPropagation();
          editingWindowId = win.id;
          renderWindowList(allWindows);
        });

        titleRow.appendChild(title);
        titleRow.appendChild(editIcon);

        const subtitle = document.createElement('div');
        subtitle.className = 'window-subtitle';
        subtitle.textContent = win.activeTabTitle;

        info.appendChild(titleRow);
        info.appendChild(subtitle);
      }

      // Window Metadata & Switch button
      const meta = document.createElement('div');
      meta.className = 'window-meta';

      const tabBadge = document.createElement('span');
      tabBadge.className = 'tab-badge';
      tabBadge.textContent = `${win.tabCount} tab${win.tabCount === 1 ? '' : 's'}`;

      const focusBtn = document.createElement('span');
      focusBtn.className = 'focus-btn';
      focusBtn.textContent = win.focused ? 'Active' : 'Focus';

      meta.appendChild(tabBadge);
      meta.appendChild(focusBtn);

      item.appendChild(info);
      item.appendChild(meta);

      // Native Button Click & Enter key handler
      item.addEventListener('click', (e) => {
        if (editingWindowId !== win.id) {
          switchWindow(win.id);
        }
      });

      windowList.appendChild(item);
    });

    scrollSelectedIntoView();
  }

  // Update selection and defer physical DOM focus to next event loop tick
  function updateSelection(newIndex) {
    const items = windowList.querySelectorAll('.window-item');
    if (items.length === 0) return;

    if (selectedIndex >= 0 && selectedIndex < items.length) {
      items[selectedIndex].classList.remove('active-selection');
    }

    selectedIndex = Math.max(0, Math.min(newIndex, items.length - 1));
    const targetItem = items[selectedIndex];
    if (targetItem) {
      targetItem.classList.add('active-selection');
      scrollSelectedIntoView();

      // Defer focus transfer to next event-loop tick so WebKit input lock is broken!
      setTimeout(() => {
        if (document.activeElement === searchInput) {
          searchInput.blur();
        }
        targetItem.focus();
      }, 10);
    }
  }

  function scrollSelectedIntoView() {
    const items = windowList.querySelectorAll('.window-item');
    if (items[selectedIndex]) {
      items[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // Switch to selected window with explicit integer parsing
  async function switchWindow(windowId) {
    try {
      const targetId = parseInt(windowId, 10);
      if (targetId) {
        await api.runtime.sendMessage({ type: 'FOCUS_WINDOW', windowId: targetId });
      }
      window.close(); // Close popup after switching
    } catch (e) {
      console.error('Error switching window:', e);
    }
  }

  // Toggle filter search bar
  function toggleSearchFilter(show) {
    const isHidden = searchContainer.classList.contains('hidden');
    const shouldShow = typeof show === 'boolean' ? show : isHidden;

    if (shouldShow) {
      searchContainer.classList.remove('hidden');
      filterToggleBtn.classList.add('active');
      searchInput.focus();
    } else {
      searchContainer.classList.add('hidden');
      filterToggleBtn.classList.remove('active');
      searchInput.value = '';
      renderWindowList(allWindows);
      searchInput.blur();
    }
  }

  filterToggleBtn.addEventListener('click', () => toggleSearchFilter());

  searchInput.addEventListener('input', () => {
    selectedIndex = 0;
    renderWindowList(allWindows);
  });

  // Strict 3-Outcome Enter Key & ArrowDown Focus Transfer in Search Input
  searchInput.addEventListener('keydown', (e) => {
    const query = searchInput.value.toLowerCase().trim();
    const filtered = allWindows.filter(w => {
      const nameMatch = w.name.toLowerCase().includes(query);
      const tabMatch = w.activeTabTitle.toLowerCase().includes(query);
      return nameMatch || tabMatch;
    });

    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length === 0) {
        // Outcome 1: 0 matching windows -> Do nothing
        return;
      } else if (filtered.length === 1) {
        // Outcome 2: Exactly 1 matching window -> Focus immediately!
        switchWindow(filtered[0].id);
        return;
      } else {
        // Outcome 3: Multiple (2+) matching windows -> Shift focus to list button #0
        updateSelection(0);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length > 0) {
        updateSelection(0);
      }
    } else if (e.key === 'Escape') {
      toggleSearchFilter(false);
    }
  });

  // Global Keyboard Navigation (Vim j/k, Arrows, Quick-Keys, Filter Toggle)
  document.addEventListener('keydown', (e) => {
    if (editingWindowId) return; // Do not intercept keys while editing a window name inline

    const isEditingSearch = (document.activeElement === searchInput);
    const items = windowList.querySelectorAll('.window-item');

    // Press '/' or 'Cmd+F' to open filter search bar
    if (!isEditingSearch && (e.key === '/' || (e.key === 'f' && (e.metaKey || e.ctrlKey)))) {
      e.preventDefault();
      toggleSearchFilter(true);
      return;
    }

    // 1. Navigation Keys (j/k or Arrows)
    if (!isEditingSearch) {
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        updateSelection(selectedIndex + 1);
        return;
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        updateSelection(selectedIndex - 1);
        return;
      } else if (e.key === 'Enter') {
        if (items[selectedIndex]) {
          e.preventDefault();
          const winId = items[selectedIndex].dataset.windowId;
          if (winId) switchWindow(winId);
          return;
        }
      }
    }

    // 2. Quick-Key Letter Jump (Option + Letter, or direct letter when not typing in search)
    const key = e.key.toLowerCase();
    if (quickKeyMap[key] && (!isEditingSearch || e.altKey)) {
      e.preventDefault();
      switchWindow(quickKeyMap[key]);
    }
  });

  // Initial setup
  loadWindows();
});
