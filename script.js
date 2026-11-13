/* 2026 尾牙四碼抽獎系統：平滑循環滾輪版
 * allNames: 完整名單，現金加碼以工號查找，不要求抽獎碼。
 * eligibleNames: 僅有效四碼者，正式抽獎只能從此名單抽出。
 */
let allNames = [];
let eligibleNames = [];
let winnerData = [];
let drawnWinners = new Set();
let isDrawing = false;
let isImportingNames = false;
let autoScrollId = null;
let lastAutoTime = 0;

const ITEM_HEIGHT = 90;
const REEL_COUNT = 4;
const MIN_REEL_ITEMS = 120;
const AUTO_SPEED = 72;
const STOP_GAP = 550;
const BASE_SPIN_DURATION = 3200;
const DECELERATION_DURATION = 800;
const EXTRA_LOOPS = 5;
const STORAGE_KEY = 'lucky-draw-formal_2026';


const $ = selector => document.querySelector(selector);
const scrollArea = $('#scroll-area');
const scrollViewport = scrollArea?.parentElement;
const prizeBtn = $('#prize-btn');
const winnerList = $('#winner-list');
const winnerAnnouncement = $('#winner-announcement');
const winnerAnnouncementCode = $('#winner-announcement-code');
const winnerAnnouncementName = $('#winner-announcement-name');
const fileInput = $('#file-input');
const cashInput = $('#special-prize-input2');
const cashDropdown = $('#special-prize-dropdown2');
const amountInput = $('#special-prize-amount-input');
const shareInput = $('#special-prize-input');
const shareDropdown = $('#winner-dropdown');
const specialContainer = $('#special-prize-container');
const balanceBtn = $('#special-balance-btn');
const balanceInput = $('#special-balance-input');
const cashBonusLabel = $('#cash-bonus-label');
const lever = $('.lever');
const stick = $('.stick');
const drawSound = $('#draw-sound');
const winSound = $('#win-sound');
const donSound = $('#win-don');

//獎項金額
const prizeAmounts = {
  1: 30000, 2: 20000, 3: 15000, 4: 10000,
  5: 8000, 6: 7000, 7: 6000, 8: 5000,
  12: 3600, 13: 9000
};

const prizeLimits = {
  '1': 1, '2': 1, '3': 1, '4': 1,
  '5': 2, '6': 2, '7': 6, '8': 6,
  '9': Infinity, '10': Infinity, '11': Infinity,
  '12': 15, '13': 2
};

function normalizeId(value) { return String(value ?? '').trim(); }
function normalizeCode(value) {
  const code = String(value ?? '').trim();
  return code ? code.padStart(4, '0') : '';
}
function isCurrentEligibleEntry(person) {
  return allNames.includes(person) &&
    eligibleNames.includes(person) &&
    /^\d{4}$/.test(person.drawCode);
}
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function showToast(message) {
  const body = $('#list-toast-body');
  const element = $('#list-toast');
  if (!body || !element) return;
  // Toast 訊息一律以純文字呈現，避免匯入資料被解析成 HTML。
  const paragraph = document.createElement('p');
  paragraph.className = 'm-0';
  paragraph.textContent = message;
  body.replaceChildren(paragraph);
  new bootstrap.Toast(element).show();
}
function askConfirmToast(message, yesLabel, noLabel) {
  const body = $('#confirm-toast-body');
  const element = $('#confirm-toast');
  const yesButton = $('#confirm-yes');
  const noButton = $('#confirm-no');
  if (!body || !element || !yesButton || !noButton) {
    throw new Error('找不到確認通知元件');
  }

  body.innerHTML = message;
  yesButton.textContent = yesLabel;
  noButton.textContent = noLabel;
  const toast = bootstrap.Toast.getOrCreateInstance(element, { autohide: false });

  return new Promise(resolve => {
    const cleanup = () => {
      yesButton.removeEventListener('click', onYes);
      noButton.removeEventListener('click', onNo);
    };
    const finish = answer => {
      cleanup();
      toast.hide();
      resolve(answer);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);

    yesButton.addEventListener('click', onYes, { once: true });
    noButton.addEventListener('click', onNo, { once: true });
    toast.show();
  });
}
function playAudio(audio) {
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}
function stopAudio(audio) {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
}
function playDon() {
  if (!donSound) return;
  const audio = new Audio(donSound.src);
  audio.play().catch(() => {});
}
function duplicates(values) {
  const seen = new Set();
  const duplicate = new Set();
  values.forEach(value => seen.has(value) ? duplicate.add(value) : seen.add(value));
  return [...duplicate];
}

function makeRecordId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `record-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function randomIndex(length) {
  if (!Number.isInteger(length) || length <= 0) throw new Error('無有效抽獎人數');
  if (!globalThis.crypto?.getRandomValues) return Math.floor(Math.random() * length);
  const limit = Math.floor(0x100000000 / length) * length;
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer); while (buffer[0] >= limit);
  return buffer[0] % length;
}
function recordReceivedAmount(record) {
  return Number(record.prizeAmounts || 0) + Number(record.specialBonus || 0);
}
function recordSharedAmount(record) {
  return Number(record.sharedAmount || 0);
}
function recordAvailableAmount(record) {
  return Math.max(Number(record.prizeAmounts || 0) - recordSharedAmount(record), 0);
}
function findShareSource() {
  const recordId = shareInput?.dataset.recordId || '';
  if (recordId) return winnerData.find(record => record.recordId === recordId) || null;
  const id = normalizeId(shareInput?.dataset.id);
  return id ? winnerData.slice().reverse().find(record => normalizeId(record.id) === id) || null : null;
}


let shareOveragePromptOpen = false;
async function handleShareAmountInput() {
  if (
    shareOveragePromptOpen ||
    prizeBtn.dataset.value !== '9'
  ) return;

  const source = findShareSource();
  const enteredAmount = Number(amountInput.value);

  if (
    !source ||
    !Number.isFinite(enteredAmount) ||
    enteredAmount <= 0
  ) return;

  const available = recordAvailableAmount(source);

  if (enteredAmount <= available) return;

  const excess = enteredAmount - available;

  shareOveragePromptOpen = true;
  amountInput.disabled = true;

  try {
    const convertToBonus = await askConfirmToast(
      `
        <p class="mb-2">
          分享金額超出可分享額度。
        </p>

        <p class="mb-1">
          可分享餘額：
          <strong class="text-danger">${available.toLocaleString()} 元</strong>
        </p>

        <p class="mb-2">
          超出金額：
          <strong class="text-danger">${excess.toLocaleString()} 元</strong>
        </p>

        <p class="mb-0">
          是否將超出金額轉為現金加碼？
        </p>
      `,
      '是',
      '否'
    );

    // 使用者等待確認期間，若切換獎項或分享來源，就不再處理
    if (
      prizeBtn.dataset.value !== '9' ||
      findShareSource() !== source
    ) {
      return;
    }

    // 分享金額最多只保留可分享餘額
    amountInput.value = String(available);

    if (convertToBonus) {
      const currentBonus = Number(balanceInput.value || 0);

      // 顯示現金加碼欄位
      balanceInput.style.display = 'block';
      balanceBtn.style.display = 'none';
      cashBonusLabel.style.display = 'block';

      // 超出金額累加至現金加碼
      balanceInput.value = String(currentBonus + excess);
    }
  } finally {
    amountInput.disabled = false;
    shareOveragePromptOpen = false;
  }
}
function renderWinnerList() {
  winnerList.innerHTML = '';
  winnerData.slice().reverse().forEach(record => winnerList.appendChild(createWinnerItem(record)));
}

const reels = Array.from({ length: REEL_COUNT }, () => ({
  el: document.createElement('div'),
  items: [],
  positionPx: 0,
  cycleHeight: 0,
  finalItemIndex: -1,
  highlightedItemIndex: -1
}));

reels.forEach(reel => {
  reel.el.className = 'reel';
  scrollArea?.appendChild(reel.el);
});

// ===== 四個固定停止框 =====
const stopIndicators = Array.from(
  { length: REEL_COUNT },
  (_, index) => {
    const indicator = document.createElement('div');

    indicator.className = 'stop-indicator';
    indicator.dataset.reelIndex = index;

    scrollViewport?.appendChild(indicator);

    return indicator;
  }
);

function clearReels() {
  reels.forEach(reel => {
    reel.el.innerHTML = '';
    reel.items = [];
    reel.positionPx = 0;
    reel.cycleHeight = 0;
    reel.finalItemIndex = -1;
    reel.highlightedItemIndex = -1;
    reel.el.style.zIndex = '';
    reel.el.style.transform = 'translate3d(0, 0, 0)';
  });
}

function populateReels() {
  clearReels();

  // 純視覺隨機序列：四軸各自產生 0～9，與名單流水碼完全脫鉤。
  // 同一段序列複製兩次，讓待機自動滾動可以無縫回捲。
  const baseItemCount = Math.max(120, Math.ceil(MIN_REEL_ITEMS / 2));

  reels.forEach(reel => {
    const baseDigits = Array.from(
      { length: baseItemCount },
      () => randomIndex(10)
    );

    [...baseDigits, ...baseDigits].forEach(digit => {
      const symbol = document.createElement('div');
      symbol.className = 'symbol digit-symbol';
      symbol.textContent = String(digit);
      reel.el.appendChild(symbol);
      reel.items.push(symbol);
    });

    reel.cycleHeight = baseItemCount * ITEM_HEIGHT;
    reel.positionPx = 0;
    applyReelPosition(reel);
  });
}

function applyReelPosition(reel) {
  reel.el.style.transform = `translate3d(0, -${reel.positionPx}px, 0)`;
}


function normalizeAutoPosition(reel) {
  if (!reel.cycleHeight) return;
  reel.positionPx =
    ((reel.positionPx % reel.cycleHeight) +
      reel.cycleHeight) %
    reel.cycleHeight;
}

// 導正抽獎邏輯
function normalizeStoppedReel(reel, targetDigit) {
  if (!reel.cycleHeight || !reel.items.length) return null;

  const viewport = $('.scroll-viewport');
  const centerOffset =
    viewport.offsetHeight / 2 - ITEM_HEIGHT / 2;

  /*
   * 將抽獎後累積很大的 positionPx，
   * 立即換算回基本循環範圍。
   */
  reel.positionPx =
    ((reel.positionPx % reel.cycleHeight) + reel.cycleHeight) %
    reel.cycleHeight;

  /*
   * 由正規化後的位置重新找出畫面中央格。
   */
  const normalizedItemIndex = Math.round(
    (reel.positionPx + centerOffset) / ITEM_HEIGHT
  );

  /*
   * 保證正規化後的中央格仍然是本次中獎數字。
   */
  if (reel.items[normalizedItemIndex]) {
    reel.items[normalizedItemIndex].textContent =
      String(targetDigit);
  }

  reel.finalItemIndex = normalizedItemIndex;

  applyReelPosition(reel);

  return normalizedItemIndex;
}

function startAutoScroll() {
  if (autoScrollId !== null || !eligibleNames.length || isDrawing) return;

  // 先直接啟動一幀，並以 performance.now() 作為基準。
  // 這樣 Excel 匯入完成後不依賴其他事件，就會立即開始移動。
  lastAutoTime = performance.now();

  function frame(now) {
    if (isDrawing) {
      autoScrollId = null;
      return;
    }

    const delta = Math.max(0, Math.min(now - lastAutoTime, 40));
    lastAutoTime = now;

    reels.forEach(reel => {
      if (!reel.items.length) return;
      reel.positionPx += AUTO_SPEED * (delta / 1000);
      normalizeAutoPosition(reel);
      applyReelPosition(reel);
    });

    autoScrollId = requestAnimationFrame(frame);
  }

  autoScrollId = requestAnimationFrame(frame);
}

function stopAutoScroll() {
  if (autoScrollId !== null) {
    cancelAnimationFrame(autoScrollId);
    autoScrollId = null;
  }
}

function calculateTargetPosition(reel, targetDigit, extraLoops) {
  const viewport = $('.scroll-viewport');
  const centerOffset =
    viewport.offsetHeight / 2 - ITEM_HEIGHT / 2;
  const currentCenterItem = Math.ceil(
    (reel.positionPx + centerOffset) / ITEM_HEIGHT
  );

  const minimumAdvanceItems =
    extraLoops * 10 + 8;

  const targetItem =
    currentCenterItem +
    minimumAdvanceItems +
    randomIndex(10);

  extendReels(targetItem + 12);

  /*
   * 單一循環實際包含的格數。
   * 例如 cycleHeight 是 120 格的高度，
   * baseItemCount 就會是 120。
   */
  const baseItemCount = Math.round(
    reel.cycleHeight / ITEM_HEIGHT
  );

  /*
   * 找出 targetItem 在基本循環中的對應位置。
   *
   * 例如：
   * targetItem = 265
  const logicalIndex =
    ((targetItem % baseItemCount) + baseItemCount) %
    baseItemCount;

  for (
    let itemIndex = logicalIndex;
    itemIndex < reel.items.length;
    itemIndex += baseItemCount
  ) {
    reel.items[itemIndex].textContent =
      String(targetDigit);
  }

  /*
   * 額外確保實際停止位置一定正確。
   */
  reel.items[targetItem].textContent =
    String(targetDigit);

  return {
    targetItem,
    targetPositionPx:
      targetItem * ITEM_HEIGHT - centerOffset
  };
}

function extendReels(requiredLength) {
  reels.forEach(reel => {
    while (reel.items.length < requiredLength) {
      const symbol = document.createElement('div');
      symbol.className = 'symbol digit-symbol';
      symbol.textContent = String(randomIndex(10));
      reel.el.appendChild(symbol);
      reel.items.push(symbol);
    }
  });
}


function rebaseReelsToWinner(winnerCode) {
  const viewport = $('.scroll-viewport');
  const centerOffset = viewport.offsetHeight / 2 - ITEM_HEIGHT / 2;
  const winnerDigits = String(winnerCode)
    .padStart(REEL_COUNT, '0')
    .split('');

  // 重建下一輪使用的隨機序列，但視覺中心仍保持剛才的中獎碼。
  populateReels();
  const safeItemIndex = 20;

  reels.forEach((reel, reelIndex) => {
    reel.items[safeItemIndex].textContent = winnerDigits[reelIndex];
    reel.positionPx = safeItemIndex * ITEM_HEIGHT - centerOffset;
    reel.finalItemIndex = safeItemIndex;
    applyReelPosition(reel);
  });
}

function spinReel(
  reel,
  targetDigit,
  extraLoops,
  pixelsPerMs,
  onStop
) {
  return new Promise(resolve => {
    const startPosition = reel.positionPx;

    const target = calculateTargetPosition(
      reel,
      targetDigit,
      extraLoops
    );

    const distance =
      target.targetPositionPx - startPosition;
    const cruiseDuration =
      distance / pixelsPerMs - DECELERATION_DURATION / 2;
    const decelerationDistance =
      pixelsPerMs * DECELERATION_DURATION / 2;
    const duration = cruiseDuration + DECELERATION_DURATION;

    const startTime = performance.now();

    function frame(now) {
      const elapsed = now - startTime;

      if (elapsed < duration) {
        if (elapsed <= cruiseDuration) {
          reel.positionPx = startPosition + pixelsPerMs * elapsed;
        } else {
          const decelerationElapsed = elapsed - cruiseDuration;
          const decelerationProgress =
            decelerationElapsed / DECELERATION_DURATION;
          reel.positionPx =
            startPosition +
            distance -
            decelerationDistance +
            pixelsPerMs *
            DECELERATION_DURATION *
            (
              decelerationProgress / 2 +
              Math.sin(Math.PI * decelerationProgress) / (2 * Math.PI)
            );
        }

        applyReelPosition(reel);

        requestAnimationFrame(frame);
        return;
      }

       //先精確走到原始計算出的停止位置
        reel.positionPx = target.targetPositionPx;

        /*
        * 停止當下就將位置正規化回基本循環，
        * 不要等重新啟動自動滾動後才回捲。
        */
        const normalizedItemIndex = normalizeStoppedReel(
          reel,
          targetDigit
        );

        /*
        * 框選正規化後真正位於中央的格子。
        */
        reel.highlightedItemIndex = normalizedItemIndex;

        if (
          normalizedItemIndex !== null &&
          reel.items[normalizedItemIndex]
        ) {
          reel.items[normalizedItemIndex]
            .classList.add('winner-highlight');
        }

        reel.el.style.zIndex = '21';

        onStop?.();

      // 在同一個繪製週期內更新滾輪與停止框，避免框線延後一幀。
      void scrollArea.offsetHeight;

      // 下一個畫面才視為本軸完成
      requestAnimationFrame(() => {
        resolve();
      });
    }

    requestAnimationFrame(frame);
  });
}

function highlightReel(index) {
  stopIndicators[index]
    ?.classList.add('is-visible');
}

function clearReelHighlights() {
  reels.forEach(reel => {
    reel.items[reel.highlightedItemIndex]
      ?.classList.remove('winner-highlight');
    reel.highlightedItemIndex = -1;
    reel.el.style.zIndex = '';
  });
}

fileInput?.addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (isDrawing) {
    fileInput.value = '';
    showToast('抽獎進行中，請待本次抽獎完成後再匯入名單。');
    return;
  }

  isImportingNames = true;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      if (isDrawing) {
        showToast('抽獎已開始，本次匯入取消，請稍後重新匯入。');
        return;
      }

      stopAutoScroll();
      const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      allNames = rows.slice(1).map((row, rowIndex) => {
        const dept = String(row[0] ?? '').trim();
        const id = normalizeId(row[1]);
        const name = String(row[2] ?? '').trim();
        const drawCode = normalizeCode(row[3]);

        if (!dept || !id || !name) {
          console.warn(`Excel 第 ${rowIndex + 2} 列基本資料不完整，已略過。`);
          return null;
        }
        if (drawCode && !/^\d{4}$/.test(drawCode)) {
          console.warn(`工號 ${id} 的抽獎碼格式不正確：${drawCode}`);
          return null;
        }
        return { dept, id, name, drawCode };
      }).filter(Boolean);

      const duplicateIds = duplicates(allNames.map(person => person.id));
      if (duplicateIds.length) {
        allNames = [];
        eligibleNames = [];
        clearReels();
        updateCounts();
        showToast(`發現重複工號：${duplicateIds.join('、')}`);
        return;
      }

      eligibleNames = allNames.filter(person => /^\d{4}$/.test(person.drawCode));
      const duplicateCodes = duplicates(eligibleNames.map(person => person.drawCode));
      if (duplicateCodes.length) {
        eligibleNames = [];
        clearReels();
        updateCounts();
        showToast(`發現重複抽獎碼：${duplicateCodes.join('、')}`);
        return;
      }

      populateReels();
      startAutoScroll();
      updateCounts();
      showToast(`完整名單 ${allNames.length} 人；有抽獎碼 ${eligibleNames.length} 人。`);
    } catch (error) {
      console.error(error);
      showToast('Excel 匯入失敗，請檢查檔案格式。');
    } finally {
      isImportingNames = false;
    }
  };
  reader.onerror = () => {
    isImportingNames = false;
    console.error('Excel 檔案讀取失敗：', reader.error);
    showToast('Excel 檔案讀取失敗，請重新選擇檔案。');
  };
  reader.readAsArrayBuffer(file);
});

/* 獎項選擇 */
document.querySelectorAll('.dropdown-menu .dropdown-item').forEach(item => {
  item.addEventListener('click', event => {
    event.preventDefault();
    const value = item.dataset.value;
    prizeBtn.dataset.value = value;
    prizeBtn.textContent = item.textContent.trim();

    cashInput.value = '';
    cashInput.dataset.id = '';
    shareInput.value = '';
    shareInput.dataset.id = '';
    shareInput.dataset.recordId = '';
    shareInput.readOnly = false;
    shareDropdown.style.display = 'none';
    amountInput.value = '';
    balanceInput.value = '';

    const special = ['9', '10', '11'].includes(value);
    $('.slot-machine-shell')?.classList.toggle(
      'hide-slot-crown',
      ['9', '10', '11'].includes(value)
    );
    specialContainer.style.display = special ? 'block' : 'none';
    shareInput.style.display = value === '9' ? 'inline-block' : 'none';
    cashInput.style.display = value === '10' ? 'inline-block' : 'none';
    amountInput.style.display = special ? 'block' : 'none';
    balanceBtn.style.display = value === '9' ? 'block' : 'none';
    balanceInput.style.display = 'none';
    cashBonusLabel.style.display = 'none';
    if (stick) stick.style.transform = `translateY(${value === '9' ? 100 : value === '10' ? 40 : 0}px)`;
  });
});

/* 現金加碼：完整名單搜尋，以工號 dataset.id 驗證，不要求抽獎碼。 */
function renderCashMatches(keyword) {
  cashDropdown.innerHTML = '';
  const key = keyword.toLowerCase();
  const matches = allNames.filter(person =>
    `${person.id} ${person.dept} ${person.name}`.toLowerCase().includes(key)
  );

  matches.slice(0, 100).forEach(person => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'dropdown-item';
    row.textContent = `${person.id} - ${person.dept} - ${person.name}`;
    row.addEventListener('mousedown', event => {
      event.preventDefault();
      cashInput.dataset.id = person.id;
      cashInput.value = row.textContent;
      cashDropdown.style.display = 'none';
    });
    cashDropdown.appendChild(row);
  });
  cashDropdown.style.display = matches.length ? 'block' : 'none';
}

cashInput?.addEventListener('input', () => {
  cashInput.dataset.id = '';
  const keyword = cashInput.value.trim();
  if (!keyword) {
    cashDropdown.style.display = 'none';
    return;
  }
  renderCashMatches(keyword);
});
function getCashProvider() {
  const id = normalizeId(cashInput?.dataset.id);
  return id ? allNames.find(person => normalizeId(person.id) === id) || null : null;
}

/* 幸運分享：只選仍有可分享餘額的既有中獎紀錄。 */
function renderShareMatches() {
  shareDropdown.innerHTML = '';
  if (shareInput.readOnly) {
    shareDropdown.style.display = 'none';
    return;
  }

  const keyword = shareInput.value.trim().toLowerCase();
  const shareable = winnerData.slice().reverse().filter(record => recordAvailableAmount(record) > 0);
  // 依使用者輸入的關鍵字篩選可分享的中獎紀錄。
  const matches = shareable.filter(record =>
    `${record.drawCode} ${record.id} ${record.name}`.toLowerCase().includes(keyword)
  );
  matches.forEach(record => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'list-group-item list-group-item-action';
    button.textContent = `${record.drawCode}｜${record.id}｜${record.name}`;
    button.addEventListener('mousedown', event => {
      event.preventDefault();
      shareInput.dataset.id = record.id;
      shareInput.dataset.recordId = record.recordId;
      shareInput.value = button.textContent;
      shareDropdown.style.display = 'none';
      handleShareAmountInput();
    });
    shareDropdown.appendChild(button);
  });
  shareDropdown.style.display = matches.length ? 'block' : 'none';
  if (!shareable.length) showToast('目前沒有可分享餘額的中獎者。');
}
shareInput?.addEventListener('focus', renderShareMatches);
shareInput?.addEventListener('input', () => {
  shareInput.dataset.id = '';
  shareInput.dataset.recordId = '';
  renderShareMatches();
});
amountInput?.addEventListener('input', handleShareAmountInput);
balanceBtn?.addEventListener('click', () => {
  balanceInput.style.display = 'block';
  balanceBtn.style.display = 'none';
  cashBonusLabel.style.display = 'block';
});

function buildDrawContext(value) {
  const amount = Number(amountInput?.value || 0);
  const extraBonus = Number(balanceInput?.value || 0);
  const context = {
    value,
    prizeName: prizeBtn.textContent.trim(),
    amount,
    extraBonus,
    shareSource: null,
    cashProvider: null
  };
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(extraBonus) || extraBonus < 0) {
    showToast('金額不可為負數或無效數字。');
    return null;
  }
  if (value === '9') {
    context.shareSource = findShareSource();
    if (!context.shareSource || amount <= 0) {
      showToast('請從清單選擇分享人並輸入分享金額。');
      return null;
    }
    const available = recordAvailableAmount(context.shareSource);
    if (amount > available) {
      showToast(`分享金額超過可用餘額。最多可分享 ${available.toLocaleString()} 元。`);
      amountInput.focus();
      return null;
    }
  }
  if (value === '10') {
    context.cashProvider = getCashProvider();
    if (!context.cashProvider) {
      showToast('請從完整名單點選一位現金加碼人。');
      return null;
    }
    if (amount <= 0) {
      showToast('請輸入現金加碼金額。');
      return null;
    }
  }
  if (value === '11' && amount <= 0) {
    showToast('請輸入金額。');
    return null;
  }
  return context;
}
async function requestDraw(event) {
  event?.preventDefault();
  event?.stopPropagation();
  const value = prizeBtn.dataset.value;
  if (!value) return showToast('請先選擇獎項。');
  if (isDrawing) return;
  if (isImportingNames) return showToast('名單匯入中，請完成後再開始抽獎。');
  if (!allNames.length) return showToast('請先匯入完整名單。');
  if (!eligibleNames.length) return showToast('沒有具備抽獎碼的人員可抽。');
  const count = winnerData.filter(winner => String(winner.prizeValue) === value).length;
  if (count >= (prizeLimits[value] ?? 0)) return showToast('獎項已全數抽完。');
  const context = buildDrawContext(value);
  if (!context) return;
  await doDraw(context);
}
document.querySelectorAll('.lever .prize-btn').forEach(button => {
  button.addEventListener('click', requestDraw);
});

$('#start-draw-btn')?.addEventListener('click', requestDraw);

function announceWinner(winner) {
  if (!winnerAnnouncement || !winnerAnnouncementCode || !winnerAnnouncementName) {
    throw new Error('找不到中獎揭曉元件');
  }

  winnerAnnouncementCode.textContent = winner.drawCode;
  winnerAnnouncementName.textContent = `🎉🎉 ${winner.dept} - ${winner.name} 🎉🎉`;
  winnerAnnouncement.hidden = false;
  winnerAnnouncement.setAttribute('aria-hidden', 'false');
  winnerAnnouncement.classList.remove('is-active');
  void winnerAnnouncement.offsetWidth;
  winnerAnnouncement.classList.add('is-active');

  return new Promise(resolve => {
    setTimeout(() => {
      winnerAnnouncement.classList.remove('is-active');
      winnerAnnouncement.hidden = true;
      winnerAnnouncement.setAttribute('aria-hidden', 'true');
      resolve();
    }, 6200);
  });
}

async function doDraw(context) {
  // 先從未中獎者的抽獎碼中抽取，再以唯一抽獎碼對應中獎人員。
  const availableByCode = new Map(
    eligibleNames
      .filter(person => !drawnWinners.has(person.id))
      .map(person => [person.drawCode, person])
  );
  const availableCodes = [...availableByCode.keys()];
  if (!availableCodes.length) return showToast('所有具備抽獎碼的人都已中獎。');
  const winner = availableByCode.get(availableCodes[randomIndex(availableCodes.length)]);
  if (!winner) {
    showToast('抽獎碼與目前名單不一致，已取消本次抽獎。');
    return;
  }
  if (!isCurrentEligibleEntry(winner)) {
    showToast('抽獎資料與目前名單不一致，已取消本次抽獎。');
    return;
  }
  const lotteryButton = document.querySelector(".lottery-button");
  let shareDrawRecorded = false;
  isDrawing = true;
  if (context.value === '9') {
    shareInput.readOnly = true;
    shareDropdown.style.display = 'none';
  }
  $('#start-draw-btn')?.setAttribute('disabled', 'disabled');
  if (fileInput) fileInput.disabled = true;
  lotteryButton?.classList.add("pull");

  stopAutoScroll();
  clearReelHighlights();

  stopIndicators.forEach(indicator => {
    indicator.classList.remove('is-visible');
  });

  lever?.classList.add('no-glow');
  const winnerDigits = winner.drawCode.split('');
  drawnWinners.add(winner.id);

  try {
    playAudio(drawSound);

    const nominalDistance =
      (EXTRA_LOOPS * 10 + 8) * ITEM_HEIGHT;
    const pixelsPerMs = nominalDistance / BASE_SPIN_DURATION;
    const loopsPerStop = Math.max(
      1,
      Math.ceil(
        (pixelsPerMs * STOP_GAP) /
        (10 * ITEM_HEIGHT)
      )
    );

    const spinTasks = reels.map((reel, index) =>
      spinReel(
        reel,
        winnerDigits[index],
        EXTRA_LOOPS + index * loopsPerStop,
        pixelsPerMs,
        () => highlightReel(index)
      ).then(() => {
        playDon();
      })
    );

    await Promise.all(spinTasks);
    const stoppedDrawCode = reels.map(reel =>
      reel.items[reel.highlightedItemIndex]?.textContent.trim() || ''
    ).join('');
    if (stoppedDrawCode !== winner.drawCode) {
      throw new Error('轉輪停止碼與中獎名單不一致，本次未登記，請重新抽獎。');
    }
    lotteryButton?.classList.remove("pull");
    recordWinner(winner, context);
    shareDrawRecorded = true;
    stopAudio(drawSound);
    playAudio(winSound);
    try {
      await announceWinner(winner);
    } catch (error) {
      console.error('中獎紀錄已完成，但無法顯示揭曉動畫。', error);
      showToast('中獎紀錄已完成，但揭曉動畫無法顯示。');
    }
  } catch (error) {
    console.error(error);
    drawnWinners.delete(winner.id);
    if (context.value === '9' && !shareDrawRecorded) shareInput.readOnly = false;
    showToast(error instanceof Error && error.message.includes('本次未登記')
      ? error.message
      : '抽獎發生錯誤，本次未記錄。');
  } finally {
    isDrawing = false;
    lotteryButton?.classList.remove("pull");
    $('#start-draw-btn')?.removeAttribute('disabled');
    if (fileInput) fileInput.disabled = false;
    lever?.classList.remove('no-glow');
    // 不立刻重啟，保留結果短暫停格後再平順滾動。
    setTimeout(() => {
      stopIndicators.forEach(indicator => {
        indicator.classList.remove('is-visible');
      });
      clearReelHighlights();
      startAutoScroll();
    }, 1000);
  }
}

function recordWinner(winner, context) {
  const value = context.value;
  const source = context.shareSource;
  if (!isCurrentEligibleEntry(winner)) {
    throw new Error('中獎者或流水碼已不在目前名單中，已取消登記。');
  }
  if (value === '9') {
    if (!source || !winnerData.includes(source)) throw new Error('幸運分享來源已失效');
    const available = recordAvailableAmount(source);
    if (context.amount > available) throw new Error(`分享金額超過餘額：${available}`);
  }
  const fixedAmount = Number(prizeAmounts[value] || 0);
  const record = {
    recordId: makeRecordId(),
    createdAt: new Date().toISOString(),
    dept: winner.dept,
    id: winner.id,
    name: winner.name,
    drawCode: winner.drawCode,
    prize: context.prizeName,
    prizeValue: Number(value),
    bonusSource: source ? `${source.drawCode}｜${source.dept} - ${source.id} - ${source.name}` : '',
    bonus: source ? `${source.dept} - ${source.name}` : '',
    bonusSourceId: source?.id || '',
    bonusSourceRecordId: source?.recordId || '',
    prizeAmounts: value === '9' ? context.amount : fixedAmount,
    specialBonus: value === '10' || value === '11'
      ? context.amount
      : (value === '9' ? context.extraBonus : 0),
    bonus2Source: context.cashProvider
      ? `${context.cashProvider.dept} - ${context.cashProvider.name}`
      : '',
    sharedAmount: 0
  };
  const previousSharedAmount = source?.sharedAmount;
  if (source) source.sharedAmount = recordSharedAmount(source) + context.amount;
  winnerData.push(record);
  // 儲存失敗時回滾畫面資料，讓抽獎錯誤處理能一致撤銷中獎狀態。
  try {
    saveState();
  } catch (error) {
    winnerData.pop();
    if (source) source.sharedAmount = previousSharedAmount;
    throw error;
  }
  renderWinnerList();
  updateCounts();
}

function createWinnerItem(record) {
  const item = document.createElement('li');
  const received = recordReceivedAmount(record);
  const shared = recordSharedAmount(record);
  const available = recordAvailableAmount(record);

  if (Number(record.prizeValue) === 9) {
    const shareAmount = Number(record.prizeAmounts || 0).toLocaleString();
    const cashBonus = Number(record.specialBonus || 0);

    const amountText = cashBonus > 0
      ? `${shareAmount} + 現金加碼：${cashBonus.toLocaleString()}`
      : shareAmount;

    item.innerHTML = `
      <p class="winner-share-summary">
        ${escapeHtml(record.prize)}【中獎金額：${amountText}】
      </p>

      <p class="winner-code">
        抽獎碼：${escapeHtml(record.drawCode)}
      </p>

      <p class="winner-share-person fs-3">
        ${escapeHtml(record.dept)} - <span style="color:#FF5151;">${escapeHtml(record.name)}</span>
      </p>

      <p class="winner-share-source">
        【${escapeHtml(record.bonus || '')} - 幸運分享】
      </p>
    `;

    return item;
  }

  item.innerHTML = `
    <p>
      ${escapeHtml(record.prize)}
      ${received ? `【中獎金額：${received.toLocaleString()}】` : ''}
    </p>

    <p class="winner-code">
      抽獎碼：${escapeHtml(record.drawCode)}
    </p>

    <p class="winner-person fs-3">
      ${escapeHtml(record.dept)} - <span style="color:#FF5151;">${escapeHtml(record.name)}</span>
    </p>

    ${Number(record.specialBonus || 0) > 0
      ? `<p style="color:#413d376e;">
          【${escapeHtml(record.bonus2Source)}】
        </p>`
      : ''
    }

    ${shared
      ? `<p style="color:#413d376e;">
          【已分享：${shared.toLocaleString()}】
        </p>`
      : ''
    }
  `;

  return item;
}

function updateCounts() {
  const eligibleIds = new Set(eligibleNames.map(person => person.id));
  const won = [...drawnWinners].filter(id => eligibleIds.has(id)).length;
  $('#total-count').textContent = eligibleNames.length;
  $('#win-count').textContent = won;
  $('#remain-count').textContent = Math.max(eligibleNames.length - won, 0);
}

function saveState() {
  // 將紀錄與已中獎工號合併為單一寫入，避免兩個儲存鍵只更新一半。
  localStorage.setItem(`${STORAGE_KEY}_state`, JSON.stringify({
    winnerData,
    drawnWinners: [...drawnWinners]
  }));
}

$('#export-btn')?.addEventListener('click', () => {
  if (!winnerData.length) return showToast('沒有中獎名單可匯出。');

  // 現金交易一律匯入「加碼金額」；分享欄只匯出有轉出紀錄者的合計。
  const headers = [
    '部門', '工號', '姓名', '抽獎碼', '獎項',
    '中獎來源', '公司提供金額', '加碼金額', '加碼來源',
    '已分享金額', '剩餘可分享金額'
  ];

  const rows = winnerData.map(record => {
    const shared = recordSharedAmount(record);
    const hasShared = shared > 0;

    return [
      record.dept,
      record.id,
      record.name,
      record.drawCode,
      record.prize,
      record.bonusSource,
      Number(record.prizeAmounts || 0),
      Number(record.specialBonus || 0),
      record.bonus2Source,
      hasShared ? shared : '',
      hasShared ? recordAvailableAmount(record) : ''
    ];
  });

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '中獎名單');
  XLSX.writeFile(workbook, '大寶2027年尾牙中獎名單.xlsx');
});
$('#show-winners-btn')?.addEventListener('click', () => {
  localStorage.setItem('winnerData', JSON.stringify(winnerData));
  window.open('winnersData.html', '_blank');
});

$('#clear-all-btn')?.addEventListener('click', async () => {
  // 防呆：沒有中獎名單就不觸發清除確認
  if (!winnerData.length) {
    showToast('目前沒有中獎紀錄可清除。');
    return;
  }

  const confirmed = await askConfirmToast(
    '確定清除所有中獎紀錄？',
    '確定清除',
    '取消'
  );

  if (!confirmed) return;

  winnerData = [];
  drawnWinners.clear();
  winnerList.innerHTML = '';

  localStorage.removeItem(`${STORAGE_KEY}_state`);
  localStorage.removeItem(`${STORAGE_KEY}_winnerData`);
  localStorage.removeItem(`${STORAGE_KEY}_drawnWinners`);

  updateCounts();

  showToast('所有中獎紀錄已清除。');
});

(function restoreState() {
  try {
    // 優先讀取合併儲存格式；沒有時沿用舊版兩個儲存鍵以相容既有資料。
    const savedState = localStorage.getItem(`${STORAGE_KEY}_state`);
    const savedWinners = localStorage.getItem(`${STORAGE_KEY}_winnerData`);
    const savedDrawn = localStorage.getItem(`${STORAGE_KEY}_drawnWinners`);
    if (savedState) {
      const parsed = JSON.parse(savedState);
      winnerData = Array.isArray(parsed.winnerData) ? parsed.winnerData : [];
      drawnWinners = new Set(Array.isArray(parsed.drawnWinners) ? parsed.drawnWinners : []);
    }
    if (savedWinners) {
      if (!savedState) {
        const parsed = JSON.parse(savedWinners);
        winnerData = Array.isArray(parsed) ? parsed : [];
      }
    }
    if (savedDrawn && !savedState) drawnWinners = new Set(JSON.parse(savedDrawn));
    winnerData.forEach(record => {
      record.recordId ||= makeRecordId();
      record.createdAt ||= '';
      record.sharedAmount = Number(record.sharedAmount ?? record.balance ?? 0);
      delete record.balance;
      delete record.bonus2Id;
      record.prizeAmounts = Number(record.prizeAmounts || 0);
      record.specialBonus = Number(record.specialBonus || 0);
      // 以中獎紀錄補齊已中獎工號，避免舊版分開儲存時狀態不同步造成重複中獎。
      if (record.id != null) drawnWinners.add(record.id);
    });
    renderWinnerList();
  } catch (error) {
    console.error('還原資料失敗：', error);
  }
})();
