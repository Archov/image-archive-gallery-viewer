// Image Gallery Manager - Main Entry Point

// Load modules using script tags instead of require
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
}

async function loadModules() {
  try {
    await loadScript('debug-logger.js')
    await loadScript('image-loader.js')
    await loadScript('fullscreen-viewer.js')
    await loadScript('ui-controls.js')
    await loadScript('archive-manager.js')
    await loadScript('gallery-core.js')

    console.log('✅ All modules loaded successfully')
  } catch (error) {
    console.error('❌ Module loading failed:', error)
    throw error
  }
}

// Check if electronAPI is available
console.log('🔌 App.js: Checking electronAPI availability')
if (typeof window.electronAPI === 'undefined') {
  console.error('❌ App.js: window.electronAPI is undefined! Preload script failed.')
} else {
  console.log('✅ App.js: window.electronAPI is available')
}

// Initialize the gallery when the page loads
document.addEventListener('DOMContentLoaded', async () => {
  console.log('📄 App.js: DOMContentLoaded fired, loading modules')

  try {
    await loadModules()
    console.log('📄 App.js: All modules loaded, initializing gallery')

    const gallery = new window.ImageGallery()
    console.log('✅ App.js: Gallery initialized successfully')
    window.gallery = gallery // For debugging
  } catch (error) {
    console.error('❌ App.js: Failed to initialize gallery:', error)
  }
})

// Handle window resize for responsive grid
window.addEventListener('resize', () => {
  // Gallery will automatically adjust via CSS grid
  // Could add more sophisticated responsive logic here if needed
})
