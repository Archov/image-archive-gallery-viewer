const fs = require('fs');
const http = require('http');
const https = require('https');

function downloadFile(url, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;

    const request = client.get(url, (response) => {
      if (response.statusCode === 200) {
        const contentLength = parseInt(response.headers['content-length'], 10);
        let downloadedBytes = 0;

        const fileStream = fs.createWriteStream(outputPath);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (onProgress && contentLength) {
            const progress = (downloadedBytes / contentLength) * 100;
            onProgress(progress, downloadedBytes, contentLength);
          }
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', reject);
      } else if (response.statusCode === 302 || response.statusCode === 301) {
        downloadFile(response.headers.location, outputPath, onProgress)
          .then(resolve)
          .catch(reject);
      } else {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
      }
    });

    request.on('error', reject);
    request.setTimeout(60000, () => {
      request.destroy(new Error('Request timed out'));
    });
  });
}

module.exports = {
  downloadFile
};
