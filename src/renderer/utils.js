export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(1)} ${sizes[i]}`;
}

export function isArchiveUrl(url) {
  return /\.(zip|rar|7z)($|\?|#)/i.test(url) ||
    (url.includes('.bin?') && /f=[^&]*\.(zip|rar|7z)/i.test(url));
}

export function isArchiveFile(filename) {
  return /\.(zip|rar|7z)$/i.test(filename);
}

export function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function getArchiveIdFromUrl(url) {
  console.log(`getArchiveIdFromUrl called with: ${url}`);
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash &= hash;
  }
  const result = Math.abs(hash).toString(16).padStart(16, '0');
  console.log(`getArchiveIdFromUrl result: ${result}`);
  return result;
}

