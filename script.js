/* 2026 尾牙四碼抽獎系統：平滑循環滾輪版
 * allNames: 完整名單，現金加碼以工號查找，不要求抽獎碼。
 * eligibleNames: 僅有效四碼者，正式抽獎只能從此名單抽出。
 */
let allNames = [];
let eligibleNames = [];
let winnerData = [];
let drawnWinners = new Set();
let isDrawing = false;
let autoScrollId = null;
let lastAutoTime = 0;

const ITEM_HEIGHT = 90;
const REEL_COUNT = 4;
const MIN_REEL_ITEMS = 240;
const AUTO_SPEED = 72;
const STOP_GAP = 550;
const BASE_SPIN_DURATION = 3200;
const DECELERATION_DURATION = 800;
const EXTRA_LOOPS = 5;
const STORAGE_KEY = 'lucky-draw-formal_2026';

const $ = selector => document.querySelector(selector);
const scrollArea = $('#scroll-area');
const prizeBtn = $('#prize-btn');
const winnerList = $('#winner-list');
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
  body.innerHTML = `<p class="m-0">${message}</p>`;
  new bootstrap.Toast(element).show();
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

const reels = Array.from({ length: REEL_COUNT }, () => ({
  el: document.createElement('div'),
  items: [],
  personIndexes: [],
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

    scrollArea.appendChild(indicator);

    return indicator;
  }
);

function clearReels() {
  reels.forEach(reel => {
    reel.el.innerHTML = '';
    reel.items = [];
    reel.personIndexes = [];
    reel.positionPx = 0;
    reel.cycleHeight = 0;
    reel.finalItemIndex = -1;
    reel.highlightedItemIndex = -1;
    reel.el.style.zIndex = '';
    reel.el.style.transform = 'translate3d(0, 0, 0)';
  });
}

/* 建立足夠長的循環資料，避免人少時滑到內容尾端出現空白。 */
function populateReels() {
  clearReels();
  if (!eligibleNames.length) return;

  const personCount = eligibleNames.length;
  const repeatedCount = Math.max(
    MIN_REEL_ITEMS,
    Math.ceil(MIN_REEL_ITEMS / personCount) * personCount
  );

  for (let itemIndex = 0; itemIndex < repeatedCount; itemIndex++) {
    const personIndex = itemIndex % personCount;
    const digits = eligibleNames[personIndex].drawCode.split('');

    reels.forEach((reel, reelIndex) => {
      const symbol = document.createElement('div');
      symbol.className = 'symbol digit-symbol';
      symbol.textContent = digits[reelIndex];
      reel.el.appendChild(symbol);
      reel.items.push(symbol);
      reel.personIndexes.push(personIndex);
    });
  }

  reels.forEach(reel => {
    reel.cycleHeight = reel.items.length * ITEM_HEIGHT;
    // 匯入後從第一組資料開始顯示。不要一開始就把整條 reel 位移到中段，
    // 避免瀏覽器在首次 layout 時出現看似沒有滾動的狀況。
    reel.positionPx = 0;
    applyReelPosition(reel);
  });
}

function applyReelPosition(reel) {
  reel.el.style.transform = `translate3d(0, -${reel.positionPx}px, 0)`;
}

/* 自動滾動時只在完全相同人物週期上重定位，畫面不會跳。 */
function normalizeAutoPosition(reel) {
  if (!eligibleNames.length) return;

  // 每 N 個 symbol，畫面內容會完全相同。只在完整人員週期上回捲，
  // 因此即使回捲數千 px，使用者看到的數字位置仍完全一致。
  const personCycleHeight = eligibleNames.length * ITEM_HEIGHT;
  const maxSafePosition = reel.cycleHeight - ITEM_HEIGHT * 12;

  if (reel.positionPx >= maxSafePosition) {
    const cyclesToRemove = Math.max(
      1,
      Math.floor(reel.positionPx / personCycleHeight) - 2
    );
    reel.positionPx -= cyclesToRemove * personCycleHeight;
  }
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

/* 從目前位置往下找 winner 的下一個安全出現位置。
   終點一開始就固定，最後一格不再強制改號，因此不會 3 突跳 1。 */
function calculateTargetPosition(reel, winnerIndex, extraLoops) {
  const viewport = $('.scroll-viewport');
  const centerOffset = viewport.offsetHeight / 2 - ITEM_HEIGHT / 2;
  const currentCenterItem = Math.ceil((reel.positionPx + centerOffset) / ITEM_HEIGHT);
  const minimumAdvanceItems = extraLoops * eligibleNames.length + 8;
  const minimumTargetItem = currentCenterItem + minimumAdvanceItems;

  // 每次依「目前實際位置」擴充，避免第三次之後已接近尾端，
  // 但 requiredLength 仍比現有長度小，造成找不到終點與遞迴錯誤。
  const requiredLength = minimumTargetItem + eligibleNames.length * 3 + 12;
  extendReels(requiredLength);

  let targetItem = -1;
  for (let index = minimumTargetItem; index < reel.personIndexes.length; index++) {
    if (reel.personIndexes[index] === winnerIndex) {
      targetItem = index;
      break;
    }
  }

  if (targetItem < 0) {
    throw new Error(`無法計算滾輪終點：winnerIndex=${winnerIndex}`);
  }

  return {
    targetItem,
    targetPositionPx: targetItem * ITEM_HEIGHT - centerOffset
  };
}

function extendReels(requiredLength) {
  if (!eligibleNames.length) return;
  const currentLength = reels[0].items.length;
  if (currentLength >= requiredLength) return;

  for (let itemIndex = currentLength; itemIndex < requiredLength; itemIndex++) {
    const personIndex = itemIndex % eligibleNames.length;
    const digits = eligibleNames[personIndex].drawCode.split('');

    reels.forEach((reel, reelIndex) => {
      const symbol = document.createElement('div');
      symbol.className = 'symbol digit-symbol';
      symbol.textContent = digits[reelIndex];
      reel.el.appendChild(symbol);
      reel.items.push(symbol);
      reel.personIndexes.push(personIndex);
      reel.cycleHeight = reel.items.length * ITEM_HEIGHT;
    });
  }
}

// 抽獎完成後，把同一位中獎者無感搬回安全區。
// 畫面仍是同一組四碼，但下一次抽獎不會從內容尾端繼續累積。
function rebaseReelsToWinner(winnerIndex) {
  const viewport = $('.scroll-viewport');
  const centerOffset = viewport.offsetHeight / 2 - ITEM_HEIGHT / 2;
  const safeCycle = 3;
  const safeItemIndex = safeCycle * eligibleNames.length + winnerIndex;

  extendReels(safeItemIndex + eligibleNames.length * 4);

  reels.forEach(reel => {
    reel.positionPx = safeItemIndex * ITEM_HEIGHT - centerOffset;
    reel.finalItemIndex = safeItemIndex;
    applyReelPosition(reel);
  });
}

function spinReel(
  reel,
  winnerIndex,
  extraLoops,
  pixelsPerMs,
  onStop
) {
  return new Promise(resolve => {
    const startPosition = reel.positionPx;

    const target = calculateTargetPosition(
      reel,
      winnerIndex,
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

      // ==========================================
      // 最後一幀：停止 + 框選完全同步
      // ==========================================

      // 先記住真正中獎位置
      reel.finalItemIndex = target.targetItem;

      // 同一個 JS frame 內：
      // 1. 精確停到中獎數字
      // 2. 同時顯示停止框
      reel.positionPx = target.targetPositionPx;
      applyReelPosition(reel);
      reel.highlightedItemIndex = target.targetItem;
      reel.items[target.targetItem].classList.add('winner-highlight');
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

  const reader = new FileReader();
  reader.onload = e => {
    try {
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
    }
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
    amountInput.value = '';
    balanceInput.value = '';

    const special = ['9', '10', '11'].includes(value);
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

/* 幸運分享：只選既有中獎者。 */
shareInput?.addEventListener('focus', () => {
  shareDropdown.innerHTML = '';
  winnerData.slice().reverse().forEach(winner => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'list-group-item list-group-item-action';
    button.textContent = `${winner.drawCode}｜${winner.dept} - ${winner.id} - ${winner.name}`;
    button.addEventListener('mousedown', event => {
      event.preventDefault();
      shareInput.dataset.id = winner.id;
      shareInput.value = button.textContent;
      shareDropdown.style.display = 'none';
    });
    shareDropdown.appendChild(button);
  });
  shareDropdown.style.display = winnerData.length ? 'block' : 'none';
});

balanceBtn?.addEventListener('click', () => {
  balanceInput.style.display = 'block';
  balanceBtn.style.display = 'none';
  cashBonusLabel.style.display = 'block';
});

function validateSpecialPrize(value) {
  const amount = Number(amountInput?.value || 0);
  if (value === '9' && (!shareInput.dataset.id || amount <= 0)) {
    showToast('請選擇分享人並輸入分享金額。');
    return false;
  }
  if (value === '10') {
    if (!getCashProvider()) {
      showToast('請從完整名單點選一位現金加碼人。');
      return false;
    }
    if (amount <= 0) {
      showToast('請輸入現金加碼金額。');
      return false;
    }
  }
  if (value === '11' && amount <= 0) {
    showToast('請輸入金額。');
    return false;
  }
  return true;
}

document.querySelectorAll('.lever .prize-btn').forEach(button => {
  button.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();
    const value = prizeBtn.dataset.value;

    if (!value) return showToast('請先選擇獎項。');
    if (isDrawing) return;
    if (!allNames.length) return showToast('請先匯入完整名單。');
    if (!eligibleNames.length) return showToast('沒有具備抽獎碼的人員可抽。');

    const count = winnerData.filter(winner => winner.prize === prizeBtn.textContent).length;
    if (count >= (prizeLimits[value] ?? 0)) return showToast('獎項已全數抽完。');
    if (!validateSpecialPrize(value)) return;

    await doDraw();
  });
});

async function doDraw() {
  /* 正式中獎者永遠只從 eligibleNames 抽。 */
  const available = eligibleNames.filter(person => !drawnWinners.has(person.id));
  if (!available.length) return showToast('所有具備抽獎碼的人都已中獎。');

  stopAutoScroll();
  clearReelHighlights();

  stopIndicators.forEach(indicator => {
    indicator.classList.remove('is-visible');
  });

  isDrawing = true;
  lever?.classList.add('no-glow');
  const winner = available[Math.floor(Math.random() * available.length)];
  const winnerIndex = eligibleNames.findIndex(person => person.id === winner.id);
  drawnWinners.add(winner.id);
  playAudio(drawSound);

  try {
    const nominalDistance =
      (EXTRA_LOOPS * eligibleNames.length + 8) * ITEM_HEIGHT;
    const pixelsPerMs = nominalDistance / BASE_SPIN_DURATION;
    const loopsPerStop = Math.max(
      1,
      Math.ceil(
        (pixelsPerMs * STOP_GAP) /
        (eligibleNames.length * ITEM_HEIGHT)
      )
    );

    const spinTasks = reels.map((reel, index) =>
      spinReel(
        reel,
        winnerIndex,
        EXTRA_LOOPS + index * loopsPerStop,
        pixelsPerMs,
        () => highlightReel(index)
      ).then(() => {
        playDon();
      })
    );

    await Promise.all(spinTasks);
    recordWinner(winner);
    stopAudio(drawSound);
    playAudio(winSound);
    await new Promise(resolve => setTimeout(resolve, 1500));
  } catch (error) {
    console.error(error);
    drawnWinners.delete(winner.id);
    showToast('抽獎發生錯誤，本次未記錄。');
  } finally {
    isDrawing = false;
    lever?.classList.remove('no-glow');
    // 不立刻重啟，保留結果短暫停格後再平順滾動。
    setTimeout(() => {
      stopIndicators.forEach(indicator => {
        indicator.classList.remove('is-visible');
      });
      clearReelHighlights();
      rebaseReelsToWinner(winnerIndex);
      startAutoScroll();
    }, 1000);
  }
}

function recordWinner(winner) {
  const value = prizeBtn.dataset.value;
  let cashProvider = null;
  if (value === '10') {
    cashProvider = getCashProvider();
    if (!cashProvider) throw new Error('現金加碼人工號不存在於完整名單');
  }

  const record = {
    dept: winner.dept,
    id: winner.id,
    name: winner.name,
    drawCode: winner.drawCode,
    prize: prizeBtn.textContent,
    prizeValue: Number(value),
    bonusSource: value === '9' ? shareInput.value.trim() : '',
    prizeAmounts: prizeAmounts[value] || (value === '11' ? Number(amountInput.value || 0) : 0),
    specialBonus: value === '10' ? Number(amountInput.value || 0) : Number(balanceInput.value || 0),
    bonus2Source: cashProvider ? `${cashProvider.dept} - ${cashProvider.id} - ${cashProvider.name}` : '',
    bonus2Id: cashProvider?.id || '',
    balance: 0
  };

  winnerData.push(record);
  winnerList.insertBefore(createWinnerItem(record), winnerList.firstChild);
  updateCounts();
  saveState();
}

function createWinnerItem(record) {
  const item = document.createElement('li');
  item.innerHTML = `
    <p>${escapeHtml(record.prize)}${record.prizeAmounts ? `【金額：${Number(record.prizeAmounts).toLocaleString()}】` : ''}</p>
    <p class="winner-code">抽獎碼：${escapeHtml(record.drawCode)}</p>
    <p class="winner-person">${escapeHtml(record.dept)} - ${escapeHtml(record.id)} - ${escapeHtml(record.name)}</p>
    ${record.bonusSource ? `<p style="color:#D64545;">【${escapeHtml(record.bonusSource)} - 幸運分享】</p>` : ''}
    ${record.bonus2Source ? `<p style="color:#D64545;">【加碼來源：${escapeHtml(record.bonus2Source)}】</p>` : ''}
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
  localStorage.setItem(`${STORAGE_KEY}_winnerData`, JSON.stringify(winnerData));
  localStorage.setItem(`${STORAGE_KEY}_drawnWinners`, JSON.stringify([...drawnWinners]));
}

$('#export-btn')?.addEventListener('click', () => {
  if (!winnerData.length) return showToast('沒有中獎名單可匯出。');
  const headers = ['部門','工號','姓名','抽獎碼','獎項','中獎來源','公司提供金額','加碼金額','加碼來源','加碼來源工號','轉出金額'];
  const rows = winnerData.map(record => [
    record.dept, record.id, record.name, record.drawCode, record.prize,
    record.bonusSource, record.prizeAmounts, record.specialBonus,
    record.bonus2Source, record.bonus2Id, record.balance ?? 0
  ]);
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '中獎名單');
  XLSX.writeFile(workbook, '大寶2026年尾牙中獎名單.xlsx');
});

$('#show-winners-btn')?.addEventListener('click', () => {
  localStorage.setItem('winnerData', JSON.stringify(winnerData));
  window.open('winnersData.html', '_blank');
});

$('#clear-all-btn')?.addEventListener('click', () => {
  if (!confirm('確定清除所有中獎紀錄？')) return;
  winnerData = [];
  drawnWinners.clear();
  winnerList.innerHTML = '';
  localStorage.removeItem(`${STORAGE_KEY}_winnerData`);
  localStorage.removeItem(`${STORAGE_KEY}_drawnWinners`);
  updateCounts();
});

(function restoreState() {
  try {
    const savedWinners = localStorage.getItem(`${STORAGE_KEY}_winnerData`);
    const savedDrawn = localStorage.getItem(`${STORAGE_KEY}_drawnWinners`);
    if (savedWinners) winnerData = JSON.parse(savedWinners);
    if (savedDrawn) drawnWinners = new Set(JSON.parse(savedDrawn));
    winnerList.innerHTML = '';
    winnerData.slice().reverse().forEach(record => winnerList.appendChild(createWinnerItem(record)));
  } catch (error) {
    console.error('還原資料失敗：', error);
  }
})();
