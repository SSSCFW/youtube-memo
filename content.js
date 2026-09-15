// YouTube動画のIDを取得
function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// メモコンテナを作成
function createMemoContainer() {
  const container = document.createElement('div');
  container.id = 'youtube-memo-container';
  container.className = 'youtube-memo-visible';
  
  // トグルボタン
  const toggleButton = document.createElement('button');
  toggleButton.id = 'youtube-memo-toggle';
  toggleButton.textContent = 'メモを非表示';
  toggleButton.addEventListener('click', toggleMemo);
  
  // メモエリア
  const memoArea = document.createElement('div');
  memoArea.id = 'youtube-memo-area';
  
  const memoTitle = document.createElement('h3');
  memoTitle.textContent = 'メモ';
  memoTitle.style.margin = '0 0 10px 0';
  
  const textarea = document.createElement('textarea');
  textarea.id = 'youtube-memo-textarea';
  textarea.placeholder = '歌詞やメモを入力してください...';
  
  // メモの読み込みと保存
  const videoId = getVideoId();
  if (videoId) {
    loadMemo(videoId, textarea);
    textarea.addEventListener('input', () => saveMemo(videoId, textarea.value));
    
    // リサイズ時に高さを保存（ユーザーがドラッグでリサイズした時）
    let resizeTimeout;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        saveHeight(videoId, textarea);
      }, 300);
    });
    observer.observe(textarea);
  }
  
  memoArea.appendChild(memoTitle);
  memoArea.appendChild(textarea);
  
  container.appendChild(toggleButton);
  container.appendChild(memoArea);
  
  return container;
}

// メモの表示/非表示を切り替え
function toggleMemo() {
  const container = document.getElementById('youtube-memo-container');
  const button = document.getElementById('youtube-memo-toggle');
  const memoArea = document.getElementById('youtube-memo-area');
  
  if (container.classList.contains('youtube-memo-visible')) {
    container.classList.remove('youtube-memo-visible');
    container.classList.add('youtube-memo-hidden');
    button.textContent = 'メモを表示';
    memoArea.style.display = 'none';
  } else {
    container.classList.remove('youtube-memo-hidden');
    container.classList.add('youtube-memo-visible');
    button.textContent = 'メモを非表示';
    memoArea.style.display = 'block';
  }
}

// メモをlocalStorageから読み込み
function loadMemo(videoId, textarea) {
  chrome.storage.local.get([`memo_${videoId}`, `height_${videoId}`], (result) => {
    if (result[`memo_${videoId}`]) {
      textarea.value = result[`memo_${videoId}`];
    } else {
      textarea.value = ''; // メモがない場合は空にする
    }
    if (result[`height_${videoId}`]) {
      textarea.style.height = result[`height_${videoId}`];
      textarea.style.minHeight = result[`height_${videoId}`];
    } else {
      textarea.style.height = '';
      textarea.style.minHeight = '';
    }
  });
}

// メモをlocalStorageに保存
function saveMemo(videoId, content) {
  chrome.storage.local.set({ [`memo_${videoId}`]: content });
}

// メモの高さを保存
function saveHeight(videoId, element) {
  if (element) {
    const height = window.getComputedStyle(element).height;
    if (height && height !== 'auto') {
      chrome.storage.local.set({ [`height_${videoId}`]: height });
    }
  }
}

// レイアウトを調整
function adjustLayout() {
  const secondary = document.querySelector('#secondary');
  const container = document.getElementById('youtube-memo-container');
  
  if (secondary && container) {
    // メモコンテナをセカンダリの前に挿入
    secondary.parentNode.insertBefore(container, secondary);
  }
}

let memoInitializationTimer = null;

// 初期化を多重起動させずに予約する
function scheduleMemoInitialization(delay = 250) {
  if (memoInitializationTimer !== null) {
    return;
  }

  memoInitializationTimer = setTimeout(() => {
    memoInitializationTimer = null;
    initializeMemo();
  }, delay);
}

function cancelMemoInitialization() {
  if (memoInitializationTimer !== null) {
    clearTimeout(memoInitializationTimer);
    memoInitializationTimer = null;
  }
}

// メインの初期化関数
function initializeMemo() {
  const videoId = getVideoId();
  const existingContainer = document.getElementById('youtube-memo-container');
  const existingTextarea = document.getElementById('youtube-memo-textarea');

  // 動画ページでない場合は既存のコンテナを削除
  if (!videoId) {
    cancelMemoInitialization();
    if (existingContainer) {
      existingContainer.remove();
    }
    return;
  }

  // YouTubeの右カラムが遅れて生成される場合も、見つかるまで待ち続ける
  const secondary = document.querySelector('#secondary');
  if (!secondary) {
    scheduleMemoInitialization(500);
    return;
  }

  cancelMemoInitialization();

  if (existingContainer && existingTextarea) {
    // 同じ動画IDならDOMを作り直さない
    const currentVideoId = existingTextarea.dataset.videoId;
    if (currentVideoId === videoId) {
      // YouTube側の再描画で位置だけ変わった場合も正しい場所へ戻す
      if (existingContainer.parentNode !== secondary) {
        secondary.insertBefore(existingContainer, secondary.firstChild);
      }
      return;
    }

    // 違う動画の場合は新しいtextareaを作成
    const newTextarea = document.createElement('textarea');
    newTextarea.id = 'youtube-memo-textarea';
    newTextarea.placeholder = '歌詞やメモを入力してください...';
    newTextarea.dataset.videoId = videoId;

    loadMemo(videoId, newTextarea);
    newTextarea.addEventListener('input', () => saveMemo(videoId, newTextarea.value));

    let resizeTimeout;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        saveHeight(videoId, newTextarea);
      }, 300);
    });
    observer.observe(newTextarea);

    existingTextarea.parentNode.replaceChild(newTextarea, existingTextarea);
    if (existingContainer.parentNode !== secondary) {
      secondary.insertBefore(existingContainer, secondary.firstChild);
    }
    return;
  }

  // 中途半端なDOMが残っている場合は作り直す
  if (existingContainer) {
    existingContainer.remove();
  }

  const memoContainer = createMemoContainer();
  const textarea = memoContainer.querySelector('#youtube-memo-textarea');
  textarea.dataset.videoId = videoId;
  secondary.insertBefore(memoContainer, secondary.firstChild);
}

// ページ読み込み時に初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeMemo);
} else {
  initializeMemo();
}

// YouTube のSPA遷移とDOM再描画を検出
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  const urlChanged = url !== lastUrl;
  if (urlChanged) {
    lastUrl = url;
  }

  const videoId = getVideoId();
  const container = document.getElementById('youtube-memo-container');
  const textarea = document.getElementById('youtube-memo-textarea');
  const memoMissing = videoId && (!container || !textarea);

  // URL変更だけでなく、同じ動画のままYouTubeがメモDOMを消した場合も復元する
  if (urlChanged || memoMissing) {
    scheduleMemoInitialization(urlChanged ? 100 : 250);
  }
}).observe(document, { subtree: true, childList: true });

// ページ遷移をより確実に検出
window.addEventListener('yt-navigate-finish', () => {
  scheduleMemoInitialization(100);
});
