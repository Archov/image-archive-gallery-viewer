import { debounce } from '../utils.js';

export function createGalleryController({ state, elements, ui, electron }) {
  let loadAdjacentArchive = null;
  let refreshLibraryInfo = null;

  function setArchiveIntegration({ loadAdjacent, updateLibraryInfo }) {
    loadAdjacentArchive = loadAdjacent;
    refreshLibraryInfo = updateLibraryInfo;
  }

  function getImageArchiveId(image) {
    return image?.originalArchiveId || state.currentArchiveId || null;
  }

  function attachEventListeners() {
    elements.columnSlider.addEventListener('input', () => {
      elements.galleryGrid.style.gridTemplateColumns = `repeat(${elements.columnSlider.value}, 1fr)`;
      elements.columnValue.textContent = elements.columnSlider.value;
    });

    elements.zoomSlider.addEventListener('input', () => {
      elements.zoomValue.textContent = `${elements.zoomSlider.value}%`;
      updateHoverZoom();
      updateZoomSliderMax();
    });

    elements.fullscreenPrev.addEventListener('click', () => navigateFullscreen(-1));
    elements.fullscreenNext.addEventListener('click', () => navigateFullscreen(1));
    elements.fullscreenClose.addEventListener('click', closeFullscreen);

    elements.fullscreenOverlay.addEventListener('click', (event) => {
      if (event.target === elements.fullscreenOverlay) {
        closeFullscreen();
      }
    });

    elements.fullscreenOverlay.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (event.deltaY < 0) {
        navigateFullscreen(-1);
      } else if (event.deltaY > 0) {
        navigateFullscreen(1);
      }
    }, { passive: false });

    document.addEventListener('keydown', handleKeyboard);
  }

  function displayGallery(images, filename) {
    state.currentImages = images;
    state.currentIndex = 0;

    elements.welcome.style.display = 'none';
    elements.galleryContainer.style.display = 'block';

    const archiveNames = [...new Set(images.map(img => img.archiveName).filter(Boolean))];
    if (archiveNames.length > 0) {
      elements.archiveTitle.textContent = `📦 ${archiveNames.join(', ')} (${images.length} images)`;
    } else {
      elements.archiveTitle.textContent = `📦 ${filename} (${images.length} images)`;
    }

    elements.galleryGrid.innerHTML = '';
    elements.galleryGrid.style.gridTemplateColumns = `repeat(${elements.columnSlider.value}, 1fr)`;

    images.forEach((image, index) => {
      const container = document.createElement('div');
      container.className = 'image-container';
      container.style.position = 'relative';

      const img = document.createElement('img');
      img.src = image.url;
      img.alt = image.name;
      img.title = image.archiveName ? `${image.archiveName} - ${image.name}` : image.name;
      img.loading = 'lazy';

      const starBtn = document.createElement('button');
      starBtn.className = `star-btn ${image.starred ? 'starred' : ''}`;
      starBtn.innerHTML = image.starred ? '★' : '☆';
      starBtn.title = image.starred ? 'Remove from favorites' : 'Add to favorites';
      starBtn.onclick = (event) => {
        event.stopPropagation();
        const archiveId = resolveArchiveId(image);
        toggleImageStar(image.id, starBtn, archiveId);
      };

      img.addEventListener('click', () => openFullscreen(index));
      img.addEventListener('mouseenter', () => applyHoverZoom(img));
      img.addEventListener('mouseleave', () => removeHoverZoom(img));

      container.appendChild(img);
      container.appendChild(starBtn);
      elements.galleryGrid.appendChild(container);
    });

    updateHoverZoom();
  }

  function resolveArchiveId(image) {
    if (image.originalArchiveId) {
      return image.originalArchiveId;
    }

    if (image.id && image.id.includes('_')) {
      const [prefix] = image.id.split('_');
      if (prefix) {
        return prefix;
      }
    }

    return state.currentArchiveId;
  }

  async function toggleImageStar(imageId, starButton, archiveId) {
    const targetArchiveId = archiveId || state.currentArchiveId;
    if (!targetArchiveId) return;

    try {
      const result = await electron.toggleImageStar(targetArchiveId, imageId);

      starButton.className = `star-btn ${result.starred ? 'starred' : ''}`;
      starButton.innerHTML = result.starred ? '★' : '☆';
      starButton.title = result.starred ? 'Remove from favorites' : 'Add to favorites';

      const image = state.currentImages.find(img => img.id === imageId && getImageArchiveId(img) === targetArchiveId);
      if (image) {
        image.starred = result.starred;
      }

      if (refreshLibraryInfo) {
        await refreshLibraryInfo();
      }
    } catch (error) {
      console.error('Failed to toggle image star:', error);
    }
  }

  function updateFullscreenUpscaling() {
    if (state.settings.allowFullscreenUpscaling) {
      elements.fullscreenImage.classList.add('allow-upscaling');
    } else {
      elements.fullscreenImage.classList.remove('allow-upscaling');
    }
  }

  function updateZoomSliderMax() {
    if (state.settings.allowFullscreenUpscaling) {
      elements.zoomSlider.max = 500;
      elements.zoomValue.textContent = `${elements.zoomSlider.value}%`;
    } else {
      elements.zoomSlider.max = 200;
      if (parseInt(elements.zoomSlider.value, 10) > 200) {
        elements.zoomSlider.value = 200;
        elements.zoomValue.textContent = '200%';
      }
    }
  }

  function updateHoverZoom() {
    // Hover zoom is applied dynamically in applyHoverZoom using the current slider value.
  }

  function applyHoverZoom(img) {
    const scale = elements.zoomSlider.value / 100;
    img.style.transform = `scale(${scale})`;
    img.style.zIndex = '100';
    img.style.position = 'relative';
  }

  function removeHoverZoom(img) {
    img.style.transform = 'scale(1)';
    img.style.zIndex = 'auto';
    img.style.position = 'static';
  }

  function openFullscreen(index) {
    if (!state.currentImages[index]) return;

    state.currentIndex = index;
    elements.fullscreenImage.src = state.currentImages[index].url;
    updateFullscreenUpscaling();
    updateFullscreenCounter();
    elements.fullscreenOverlay.style.display = 'flex';
  }

  function closeFullscreen() {
    elements.fullscreenOverlay.style.display = 'none';
  }

  function updateFullscreenCounter() {
    if (state.currentImages.length > 0) {
      elements.fullscreenCounter.textContent = `${state.currentIndex + 1} / ${state.currentImages.length}`;
    }
  }

  async function navigateFullscreen(direction) {
    const newIndex = state.currentIndex + direction;

    if (newIndex < 0 && state.settings.autoLoadAdjacentArchives && loadAdjacentArchive) {
      const loaded = await loadAdjacentArchive(-1);
      if (loaded) {
        const finalIndex = state.currentIndex - 1;
        if (finalIndex >= 0) {
          state.currentIndex = finalIndex;
          elements.fullscreenImage.src = state.currentImages[state.currentIndex].url;
          updateFullscreenCounter();
          ui.updateStatus(`Image ${state.currentIndex + 1} of ${state.currentImages.length}`);
        }
        return;
      }
    } else if (newIndex >= state.currentImages.length && state.settings.autoLoadAdjacentArchives && loadAdjacentArchive) {
      const loaded = await loadAdjacentArchive(1);
      if (loaded) {
        state.currentIndex = newIndex;
        elements.fullscreenImage.src = state.currentImages[state.currentIndex].url;
        updateFullscreenCounter();
        ui.updateStatus(`Image ${state.currentIndex + 1} of ${state.currentImages.length}`);
        return;
      }
    }

    if (newIndex >= 0 && newIndex < state.currentImages.length) {
      state.currentIndex = newIndex;
      elements.fullscreenImage.src = state.currentImages[state.currentIndex].url;
      updateFullscreenCounter();
      ui.updateStatus(`Image ${state.currentIndex + 1} of ${state.currentImages.length}`);
    }
  }

  async function navigateGallery(direction) {
    const newIndex = state.currentIndex + direction;

    if (newIndex < 0 && state.settings.autoLoadAdjacentArchives && loadAdjacentArchive) {
      const loaded = await loadAdjacentArchive(-1);
      if (loaded) {
        return;
      }
    } else if (newIndex >= state.currentImages.length && state.settings.autoLoadAdjacentArchives && loadAdjacentArchive) {
      const loaded = await loadAdjacentArchive(1);
      if (loaded) {
        return;
      }
    }

    if (newIndex >= 0 && newIndex < state.currentImages.length) {
      state.currentIndex = newIndex;
      scrollToImage(state.currentIndex);
      ui.updateStatus(`Image ${state.currentIndex + 1} of ${state.currentImages.length}`);
    }
  }

  function scrollToImage(index) {
    const imageContainers = elements.galleryGrid.querySelectorAll('.image-container');
    if (imageContainers[index]) {
      imageContainers[index].scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center'
      });

      imageContainers[index].style.boxShadow = '0 0 0 3px #4CAF50';
      setTimeout(() => {
        imageContainers[index].style.boxShadow = '';
      }, 1000);
    }
  }

  function handleKeyboard(event) {
    if (elements.fullscreenOverlay.style.display === 'flex') {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFullscreen();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        navigateFullscreen(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        navigateFullscreen(1);
      }
    } else if (elements.galleryContainer.style.display === 'block') {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        navigateGallery(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        navigateGallery(1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (state.currentImages[state.currentIndex]) {
          openFullscreen(state.currentIndex);
        }
      }
    }
  }

  function showWelcome() {
    elements.welcome.style.display = 'flex';
    elements.galleryContainer.style.display = 'none';
    elements.urlInput.value = '';
    ui.updateStatus('Ready');
  }

  function getScrollHandler() {
    return debounce(async (event) => {
      if (!state.settings.autoLoadAdjacentArchives || elements.fullscreenOverlay.style.display === 'flex') {
        return;
      }

      const scrollElement = event.target.classList.contains('main-content')
        ? event.target
        : event.target.closest('.main-content');
      if (!scrollElement) return;

      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const scrollBottom = scrollTop + clientHeight;

      if (scrollTop < 100 && loadAdjacentArchive) {
        const loaded = await loadAdjacentArchive(-1);
        if (loaded) {
          scrollElement.scrollTop = scrollTop + 200;
        }
      } else if (scrollBottom > scrollHeight - 100 && loadAdjacentArchive) {
        await loadAdjacentArchive(1);
      }
    }, 200);
  }

  return {
    attachEventListeners,
    displayGallery,
    toggleImageStar,
    openFullscreen,
    closeFullscreen,
    navigateGallery,
    handleKeyboard,
    showWelcome,
    updateFullscreenUpscaling,
    updateZoomSliderMax,
    updateHoverZoom,
    setArchiveIntegration,
    getScrollHandler
  };
}
