export function createStatusUI({ elements, state, electron }) {
  function updateStatus(message, isError = false) {
    elements.status.textContent = message;
    elements.status.style.color = isError ? '#ff6b6b' : '#ccc';
  }

  function showLoading(title, text, showProgress = false) {
    elements.loadingTitle.textContent = title;
    elements.loadingText.textContent = text;
    elements.loading.style.display = 'block';

    if (showProgress) {
      elements.progressContainer.style.display = 'block';
      elements.progressFill.style.width = '0%';
      elements.progressText.textContent = '0%';
    } else {
      elements.progressContainer.style.display = 'none';
    }
  }

  function hideLoading() {
    elements.loading.style.display = 'none';
    elements.progressContainer.style.display = 'none';

    if (state.downloadProgressHandler) {
      electron.removeDownloadProgressListener();
      state.downloadProgressHandler = null;
    }
  }

  function updateDownloadProgress(progress) {
    const percentage = Math.round(progress);
    elements.progressFill.style.width = `${percentage}%`;
    elements.progressText.textContent = `${percentage}%`;
  }

  function showArchiveLoading() {
    elements.archiveLoading.style.display = 'flex';
  }

  function hideArchiveLoading() {
    elements.archiveLoading.style.display = 'none';
  }

  return {
    updateStatus,
    showLoading,
    hideLoading,
    updateDownloadProgress,
    showArchiveLoading,
    hideArchiveLoading
  };
}
