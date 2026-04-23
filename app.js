import * as THREE from "three";

// Mode Management
const modeSections = document.querySelectorAll(".mode-section");
const modeButtons = document.querySelectorAll(".mode-button");

modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    modeButtons.forEach((b) => b.classList.remove("mode-button--active"));
    modeSections.forEach((section) => section.classList.remove("mode-section--active"));
    btn.classList.add("mode-button--active");
    document.getElementById(`${mode}Mode`).classList.add("mode-section--active");
  });
});

const configStatus = document.getElementById("configStatus");
const enhancedPromptBox = document.getElementById("enhancedPromptBox");
const gallery = document.getElementById("gallery");

const videoForm = document.getElementById("videoForm");

const enhanceVideoPromptButton = document.getElementById("enhanceVideoPrompt");
const videoInputImage = document.getElementById("videoInputImage");
const videoSourcePreview = document.getElementById("videoSourcePreview");
const photoshootUpload = document.getElementById("photoshootUpload");
const photoshootBackgroundImage = document.getElementById("photoshootBackgroundImage");
const photoshootInstructions = document.getElementById("photoshootInstructions");
const applyPhotoshootBatchButton = document.getElementById("applyPhotoshootBatch");
const downloadPhotoshootBatchButton = document.getElementById("downloadPhotoshootBatch");
const photoshootBatchGrid = document.getElementById("photoshootBatchGrid");
const photoshootResultsGrid = document.getElementById("photoshootResultsGrid");
const historyGrid = document.getElementById("historyGrid");
const clearAllHistoryButton = document.getElementById("clearAllHistory");
const deleteSelectedHistoryButton = document.getElementById("deleteSelectedHistory");
const installAppButton = document.getElementById("installAppButton");

const panoramaInput = document.getElementById("panoramaInput");
const startSpinButton = document.getElementById("startSpin");
const recordSpinButton = document.getElementById("recordSpin");

let panorama = null;
let latestGeneratedImage = null;
let lastRenderedVideoBlobUrl = null;
let photoshootBatchItems = [];
let photoshootProcessedItems = [];
let mediaHistory = [];
let deferredInstallPrompt = null;

// Initialize app when DOM is ready
(async () => {
  await loadConfig();
  setupViewer();
  loadHistory();
  registerPwa();
})();

enhanceVideoPromptButton.addEventListener("click", () => previewEnhancedPrompt("video"));
videoForm.addEventListener("submit", handleVideoSubmit);
videoInputImage.addEventListener("change", handleVideoSourceChange);
photoshootUpload.addEventListener("change", handlePhotoshootUpload);
applyPhotoshootBatchButton.addEventListener("click", applyPhotoshootBatch);
downloadPhotoshootBatchButton.addEventListener("click", downloadPhotoshootBatch);
clearAllHistoryButton.addEventListener("click", clearAllHistory);
deleteSelectedHistoryButton.addEventListener("click", deleteSelectedHistory);
installAppButton.addEventListener("click", installPwa);
panoramaInput.addEventListener("change", handlePanoramaUpload);
startSpinButton.addEventListener("click", () => {
  if (panorama) {
    panorama.isAutoRotating = !panorama.isAutoRotating;
    startSpinButton.textContent = panorama.isAutoRotating ? "Stop rotation" : "Auto rotate preview";
  }
});
recordSpinButton.addEventListener("click", recordPanoramaSpin);


async function loadConfig() {
  const response = await fetch("/api/config");
  const data = await response.json();

  configStatus.innerHTML = [
    statusPill("Groq Prompt AI", data.groqEnabled ? "Connected" : "Not configured", data.groqEnabled),
    statusPill(
      "Image Mode",
      data.imageMode === "huggingface"
        ? "Hugging Face"
        : data.imageMode === "pollinations-free"
          ? "Free no-key mode"
          : "Custom provider",
      true,
    ),
    statusPill(
      "Video Mode",
      data.videoMode === "huggingface-video"
        ? "Hugging Face Video"
        : data.videoMode === "local-animation"
          ? "Local animation mode"
          : "Custom provider",
      data.videoMode !== "local-animation" || data.videoEnabled,
    ),
  ].join("");
}

async function previewEnhancedPrompt(medium) {
  const payload =
    {
      medium,
      prompt: buildVideoPrompt(),
      style: document.getElementById("videoStyle").value,
      camera: document.getElementById("shotType").value,
      platformRatio: getVideoAspectRatioValue(),
      duration: document.getElementById("videoDuration").value,
      is360: document.getElementById("is360Video").checked,
    };

  if (!payload.prompt) {
    enhancedPromptBox.textContent = "Pehle prompt likhiye.";
    return;
  }

  enhancedPromptBox.textContent = "Enhancing prompt...";
  const response = await fetch("/api/enhance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  enhancedPromptBox.textContent =
    `Expanded prompt:\n${data.expandedPrompt || payload.prompt}\n\nNegative prompt:\n${data.negativePrompt || ""}\n\nNotes:\n${data.shotNotes || ""}\n${data.textInstructions || ""}`;
}

async function handleVideoSubmit(event) {
  event.preventDefault();
  const prompt = buildVideoPrompt();
  const uploadedInputImage = await fileToDataUrl(document.getElementById("videoInputImage").files[0]);
  const inputImage = uploadedInputImage || latestGeneratedImage;

  if (!prompt && !inputImage) {
    enhancedPromptBox.textContent = "Video prompt ya input image dein.";
    return;
  }

  const enhanced = prompt ? await getEnhancedPrompt("video") : null;
  const shotType = document.getElementById("shotType").value;
  const videoStyle = document.getElementById("videoStyle").value;
  const aspectRatio = getVideoAspectRatioValue();

  const payload = {
    prompt: [enhanced?.expandedPrompt || prompt, videoStyle, shotType, `platform ratio ${aspectRatio}`]
      .filter(Boolean)
      .join(", "),
    style: videoStyle,
    duration: Number(document.getElementById("videoDuration").value),
    shotType,
    motionStrength: document.getElementById("motionStrength").value,
    aspectRatio,
    is360: document.getElementById("is360Video").checked,
    inputImage,
  };

  await createMedia("/api/generate-video", payload, "video");
}

async function getEnhancedPrompt(medium) {
  const payload = {
    medium,
    prompt: buildVideoPrompt(),
    style: document.getElementById("videoStyle").value,
    camera: document.getElementById("shotType").value,
    platformRatio: getVideoAspectRatioValue(),
    duration: document.getElementById("videoDuration").value,
    is360: document.getElementById("is360Video").checked,
  };

  const response = await fetch("/api/enhance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  enhancedPromptBox.textContent =
    `Expanded prompt:\n${data.expandedPrompt}\n\nNegative prompt:\n${data.negativePrompt || ""}`;
  return data;
}

async function createMedia(url, payload, mediaType) {
  enhancedPromptBox.textContent = `Submitting ${mediaType} job...`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();

  if (!response.ok) {
    enhancedPromptBox.textContent = data.error || "Request failed.";
    return;
  }

  if (data.warning) {
    enhancedPromptBox.textContent = data.warning;
  }

  if (data.localAnimation) {
    if (!data.warning) {
      enhancedPromptBox.textContent = "Creating local animated clip...";
    }
    const localVideoUrl = await createAnimatedVideo(data.localAnimation);
    lastRenderedVideoBlobUrl = localVideoUrl;
    if (!data.warning) {
      enhancedPromptBox.textContent = "Local animation complete.";
    }
    renderGallery([{ url: localVideoUrl, localBlob: true }], "video");
    return;
  }

  enhancedPromptBox.textContent = `${mediaType} generation complete.`;
  renderGallery(data.media || [], mediaType);
}

function renderGallery(items, mediaType) {
  if (!items.length) {
    gallery.innerHTML = `<div class="status-strip">No ${mediaType} returned by provider.</div>`;
    return;
  }

  gallery.innerHTML = "";
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "gallery-card";
    if (mediaType === "image") {
      latestGeneratedImage = item.url;
    }
    const media =
      mediaType === "video"
        ? `<video controls src="${item.url}"></video>`
        : `<img src="${item.url}" alt="Generated media" />`;
    const downloadName = mediaType === "video" ? "visionforge-video.webm" : "visionforge-image.png";
    card.innerHTML = `${media}<div class="meta"><a href="${item.url}" download="${downloadName}">Download</a></div>`;
    gallery.appendChild(card);
    addHistoryItem({
      type: mediaType,
      url: item.url,
      source: mediaType === "video" ? "video-generator" : "image-generator",
      label: mediaType === "video" ? "Generated video" : "Generated image",
    });

    if (mediaType === "video" && item.localBlob) {
      const exportButton = document.createElement("button");
      exportButton.type = "button";
      exportButton.className = "ghost";
      exportButton.textContent = "Export MP4";
      exportButton.addEventListener("click", async () => {
        await exportMp4(item.url, exportButton);
      });
      card.querySelector(".meta").appendChild(exportButton);
    }
  }
}

async function handlePhotoshootUpload(event) {
  const files = Array.from(event.target.files || []).slice(0, 10);
  photoshootBatchItems = await Promise.all(
    files.map(async (file, index) => ({
      id: `upload-${Date.now()}-${index}`,
      name: file.name,
      selected: true,
      sourceUrl: await fileToDataUrl(file),
    })),
  );
  photoshootProcessedItems = [];
  renderPhotoshootBatch();
  renderPhotoshootResults();
  enhancedPromptBox.textContent =
    files.length === 10 && event.target.files.length > 10
      ? "Sirf pehli 10 images load ki gayi hain."
      : `${files.length} image(s) batch studio mein load ho gayi hain.`;
}

function renderPhotoshootBatch() {
  if (!photoshootBatchItems.length) {
    photoshootBatchGrid.innerHTML = `<div class="status-strip">Upload up to 10 photos to start batch editing.</div>`;
    return;
  }

  photoshootBatchGrid.innerHTML = "";
  for (const item of photoshootBatchItems) {
    const card = document.createElement("article");
    card.className = "batch-card";
    card.innerHTML = `
      <img class="batch-card__image" src="${item.sourceUrl}" alt="${item.name}" />
      <div class="batch-card__meta">
        <div class="batch-card__top">
          <strong>${escapeHtml(item.name)}</strong>
          <input type="checkbox" ${item.selected ? "checked" : ""} data-batch-select="${item.id}" />
        </div>
        <span class="badge">Ready</span>
      </div>
    `;
    photoshootBatchGrid.appendChild(card);
  }

  photoshootBatchGrid.querySelectorAll("[data-batch-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const target = photoshootBatchItems.find((item) => item.id === event.target.dataset.batchSelect);
      if (target) {
        target.selected = event.target.checked;
      }
    });
  });
}

function renderPhotoshootResults() {
  if (!photoshootProcessedItems.length) {
    photoshootResultsGrid.innerHTML = "";
    return;
  }

  photoshootResultsGrid.innerHTML = "";
  for (const item of photoshootProcessedItems) {
    const card = document.createElement("article");
    card.className = "batch-card";
    card.innerHTML = `
      <img class="batch-card__image" src="${item.url}" alt="${item.name}" />
      <div class="batch-card__meta">
        <div class="batch-card__top">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="badge">${item.format.toUpperCase()}</span>
        </div>
        <div class="batch-card__actions">
          <a href="${item.url}" download="${item.downloadName}">Download</a>
        </div>
      </div>
    `;
    photoshootResultsGrid.appendChild(card);
  }
}

async function applyPhotoshootBatch() {
  const selectedItems = photoshootBatchItems.filter((item) => item.selected);
  if (!selectedItems.length) {
    enhancedPromptBox.textContent = "Batch apply se pehle kam az kam aik image select karein.";
    return;
  }

  enhancedPromptBox.textContent = "Applying photoshoot edits to selected batch...";
  const config = await collectPhotoshootConfig();
  photoshootProcessedItems = [];

  for (const item of selectedItems) {
    const processed = await processPhotoshootImage(item, config);
    photoshootProcessedItems.push(processed);
    latestGeneratedImage = processed.url;
    addHistoryItem({
      type: "image",
      url: processed.url,
      source: "photoshoot-batch",
      label: `Batch edit: ${item.name}`,
    });
  }

  renderPhotoshootResults();
  enhancedPromptBox.textContent = `${photoshootProcessedItems.length} image(s) par photoshoot edits apply ho gaye.`;
}

async function collectPhotoshootConfig() {
  let config = {
    removeBg: document.getElementById("photoshootRemoveBg").checked,
    maintainColors: document.getElementById("photoshootMaintainColors").checked,
    backgroundMode: document.getElementById("photoshootBackgroundMode").value,
    bgColor: document.getElementById("photoshootBgColor").value,
    accentColor: document.getElementById("photoshootAccentColor").value,
    width: Number(document.getElementById("photoshootWidth").value) || null,
    height: Number(document.getElementById("photoshootHeight").value) || null,
    format: document.getElementById("photoshootFormat").value,
    quality: Number(document.getElementById("photoshootQuality").value) / 100,
    text: document.getElementById("photoshootText").value.trim(),
    textColor: document.getElementById("photoshootTextColor").value,
    backgroundImage: await fileToDataUrl(photoshootBackgroundImage.files[0]),
  };

  if (document.getElementById("photoshootAutoApplyInstructions").checked) {
    config = { ...config, ...parsePhotoshootInstructions(photoshootInstructions.value, config) };
  }

  return config;
}

function parsePhotoshootInstructions(text, config) {
  const raw = String(text || "").toLowerCase();
  const next = {};
  if (raw.includes("background remov") || raw.includes("bg remov") || raw.includes("cutout")) {
    next.removeBg = true;
  }

  const sizeMatch = raw.match(/(\d{3,4})\s*[xby]{1,2}\s*(\d{3,4})/);
  if (sizeMatch) {
    next.width = Number(sizeMatch[1]);
    next.height = Number(sizeMatch[2]);
  }

  const quotedTextMatch = String(text || "").match(/['"]([^'"]{1,80})['"]/);
  if (quotedTextMatch && !config.text) {
    next.text = quotedTextMatch[1];
  }

  if (raw.includes("white background")) {
    next.backgroundMode = "solid";
    next.bgColor = "#ffffff";
  } else if (raw.includes("black background")) {
    next.backgroundMode = "solid";
    next.bgColor = "#000000";
  } else if (raw.includes("gradient")) {
    next.backgroundMode = "gradient";
  }

  return next;
}

async function processPhotoshootImage(item, config) {
  const image = await loadImage(item.sourceUrl);
  const width = config.width || image.width;
  const height = config.height || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  await drawPhotoshootBackground(context, width, height, config);

  if (config.removeBg) {
    const foreground = await createBackgroundRemovedCanvas(image, config.maintainColors);
    drawContain(context, foreground, width, height);
  } else {
    drawContain(context, image, width, height);
  }

  if (config.text) {
    drawPhotoshootText(context, config.text, config.textColor, width, height);
  }

  const mimeType = `image/${config.format === "jpeg" ? "jpeg" : config.format}`;
  const url = canvas.toDataURL(mimeType, config.quality);
  return {
    name: item.name.replace(/\.[^.]+$/, ""),
    url,
    format: config.format,
    downloadName: `${item.name.replace(/\.[^.]+$/, "")}.${config.format === "jpeg" ? "jpg" : config.format}`,
  };
}

async function drawPhotoshootBackground(context, width, height, config) {
  if (config.backgroundMode === "transparent") {
    context.clearRect(0, 0, width, height);
    return;
  }

  if (config.backgroundMode === "gradient") {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, config.bgColor);
    gradient.addColorStop(1, config.accentColor);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    return;
  }

  if (config.backgroundMode === "image" && config.backgroundImage) {
    const image = await loadImage(config.backgroundImage);
    context.fillStyle = config.bgColor;
    context.fillRect(0, 0, width, height);
    drawCover(context, image, width, height);
    return;
  }

  context.fillStyle = config.bgColor;
  context.fillRect(0, 0, width, height);
}

async function createBackgroundRemovedCanvas(image, maintainColors) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;
  const sample = sampleCornerAverage(data, width, height);
  const threshold = maintainColors ? 48 : 64;

  for (let i = 0; i < data.length; i += 4) {
    const distance = colorDistance(data[i], data[i + 1], data[i + 2], sample.r, sample.g, sample.b);
    if (distance < threshold) {
      data[i + 3] = 0;
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function sampleCornerAverage(data, width, height) {
  const points = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  let r = 0;
  let g = 0;
  let b = 0;

  for (const [x, y] of points) {
    const index = (y * width + x) * 4;
    r += data[index];
    g += data[index + 1];
    b += data[index + 2];
  }

  return { r: r / 4, g: g / 4, b: b / 4 };
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function drawContain(context, source, width, height) {
  const ratio = source.width / source.height;
  const targetRatio = width / height;
  let drawWidth;
  let drawHeight;
  if (ratio > targetRatio) {
    drawWidth = width;
    drawHeight = width / ratio;
  } else {
    drawHeight = height;
    drawWidth = height * ratio;
  }
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  context.drawImage(source, x, y, drawWidth, drawHeight);
}

function drawCover(context, source, width, height) {
  const ratio = source.width / source.height;
  const targetRatio = width / height;
  let drawWidth;
  let drawHeight;
  if (ratio > targetRatio) {
    drawHeight = height;
    drawWidth = height * ratio;
  } else {
    drawWidth = width;
    drawHeight = width / ratio;
  }
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  context.drawImage(source, x, y, drawWidth, drawHeight);
}

function drawPhotoshootText(context, text, color, width, height) {
  context.fillStyle = color;
  context.font = `700 ${Math.max(24, Math.round(width * 0.045))}px "Space Grotesk", sans-serif`;
  context.textAlign = "center";
  context.fillText(text, width / 2, height - 36, width - 64);
}

function downloadPhotoshootBatch() {
  if (!photoshootProcessedItems.length) {
    enhancedPromptBox.textContent = "Download se pehle batch process chalayein.";
    return;
  }

  for (const item of photoshootProcessedItems) {
    const anchor = document.createElement("a");
    anchor.href = item.url;
    anchor.download = item.downloadName;
    anchor.click();
  }
}

function loadHistory() {
  try {
    mediaHistory = JSON.parse(localStorage.getItem("visionforge-history") || "[]");
  } catch {
    mediaHistory = [];
  }
  renderHistory();
}

function addHistoryItem(item) {
  mediaHistory.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    selected: false,
    ...item,
  });
  mediaHistory = mediaHistory.slice(0, 120);
  persistHistory();
}

function persistHistory() {
  localStorage.setItem("visionforge-history", JSON.stringify(mediaHistory));
  renderHistory();
}

function renderHistory() {
  if (!mediaHistory.length) {
    historyGrid.innerHTML = `<div class="status-strip">History yahan save hogi.</div>`;
    return;
  }

  historyGrid.innerHTML = "";
  for (const item of mediaHistory) {
    const card = document.createElement("article");
    card.className = "history-card";
    const media =
      item.type === "video"
        ? `<video class="history-card__media" src="${item.url}" controls></video>`
        : `<img class="history-card__media" src="${item.url}" alt="${escapeHtml(item.label || item.type)}" />`;
    card.innerHTML = `
      ${media}
      <div class="history-card__meta">
        <div class="history-card__top">
          <strong>${escapeHtml(item.label || item.type)}</strong>
          <input type="checkbox" ${item.selected ? "checked" : ""} data-history-select="${item.id}" />
        </div>
        <span class="muted-note">${escapeHtml(item.source || "history")} • ${new Date(item.createdAt).toLocaleString()}</span>
        <div class="history-card__actions">
          <a href="${item.url}" download>Download</a>
          <button type="button" class="ghost ghost--small" data-history-delete="${item.id}">Delete</button>
        </div>
      </div>
    `;
    historyGrid.appendChild(card);
  }

  historyGrid.querySelectorAll("[data-history-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      mediaHistory = mediaHistory.filter((item) => item.id !== button.dataset.historyDelete);
      persistHistory();
    });
  });

  historyGrid.querySelectorAll("[data-history-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const target = mediaHistory.find((item) => item.id === event.target.dataset.historySelect);
      if (target) {
        target.selected = event.target.checked;
        localStorage.setItem("visionforge-history", JSON.stringify(mediaHistory));
      }
    });
  });
}

function deleteSelectedHistory() {
  mediaHistory = mediaHistory.filter((item) => !item.selected);
  persistHistory();
}

function clearAllHistory() {
  mediaHistory = [];
  persistHistory();
}

function statusPill(label, value, isReady) {
  const statusClass = isReady ? "status-pill status-pill--ready" : "status-pill status-pill--muted";
  return `<span class="${statusClass}"><strong>${label}</strong><em>${value}</em></span>`;
}

async function handleVideoSourceChange() {
  const dataUrl = await fileToDataUrl(videoInputImage.files[0]);
  if (dataUrl) {
    setVideoSourcePreview(dataUrl, "Uploaded image will be animated.");
  } else if (latestGeneratedImage) {
    setVideoSourcePreview(latestGeneratedImage, "Latest generated image will be animated.");
  } else {
    videoSourcePreview.textContent = "No source selected yet.";
  }
}

function useLatestGeneratedImage() {
  if (!latestGeneratedImage) {
    enhancedPromptBox.textContent = "Pehle photoshoot batch se koi processed image bana lein, phir latest result yahan use ho sakta hai.";
    return;
  }

  videoInputImage.value = "";
  setVideoSourcePreview(latestGeneratedImage, "Latest generated image selected.");
  enhancedPromptBox.textContent = "Latest photoshoot result video source ke liye select ho gaya.";
}

function setVideoSourcePreview(imageUrl, caption) {
  videoSourcePreview.innerHTML = `<img src="${imageUrl}" alt="Video source preview" />`;
  if (caption) {
    enhancedPromptBox.textContent = caption;
  }
}

async function exportMp4(blobUrl, button) {
  try {
    button.disabled = true;
    button.textContent = "Exporting...";
    const dataUrl = await blobUrlToDataUrl(blobUrl);
    const response = await fetch("/api/export-mp4", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoDataUrl: dataUrl }),
    });
    const data = await response.json();

    if (!response.ok) {
      enhancedPromptBox.textContent = data.error || "MP4 export failed.";
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = data.videoUrl;
    anchor.download = "visionforge-video.mp4";
    anchor.click();
    enhancedPromptBox.textContent = "MP4 export complete.";
  } catch (error) {
    enhancedPromptBox.textContent = error.message || "MP4 export failed.";
  } finally {
    button.disabled = false;
    button.textContent = "Export MP4";
  }
}

async function createAnimatedVideo(config) {
  const { width, height } = aspectRatioToCanvas(config.aspectRatio || "16:9", config.customSize);
  const durationMs = Math.max(4, Number(config.duration || 15)) * 1000;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size) {
      chunks.push(event.data);
    }
  };

  const image = await loadImage(config.inputImage);
  const motionPreset = buildMotionPreset(config.shotType, config.motionStrength);

  const videoReady = new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      resolve(URL.createObjectURL(blob));
    };
  });

  recorder.start();
  const start = performance.now();

  await new Promise((resolve) => {
    function frame(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / durationMs, 1);
      drawAnimatedFrame(context, image, width, height, progress, motionPreset, config);
      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        recorder.stop();
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });

  return videoReady;
}

function drawAnimatedFrame(context, image, width, height, progress, motionPreset, config) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#040814";
  context.fillRect(0, 0, width, height);

  const zoom = motionPreset.startZoom + (motionPreset.endZoom - motionPreset.startZoom) * easeInOutCubic(progress);
  const offsetX = motionPreset.panX * Math.sin(progress * Math.PI * 2) * width;
  const offsetY = motionPreset.panY * Math.cos(progress * Math.PI * 2) * height;
  const rotation = motionPreset.rotation * Math.sin(progress * Math.PI * 2);

  const imageRatio = image.width / image.height;
  const canvasRatio = width / height;
  let drawWidth = width * zoom;
  let drawHeight = height * zoom;

  if (imageRatio > canvasRatio) {
    drawHeight = height * zoom;
    drawWidth = drawHeight * imageRatio;
  } else {
    drawWidth = width * zoom;
    drawHeight = drawWidth / imageRatio;
  }

  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(rotation);
  context.drawImage(image, -drawWidth / 2 + offsetX, -drawHeight / 2 + offsetY, drawWidth, drawHeight);
  context.restore();

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(4,8,20,0.10)");
  gradient.addColorStop(1, "rgba(4,8,20,0.35)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  if (config.prompt) {
    context.fillStyle = "rgba(239,246,255,0.92)";
    context.font = "600 26px 'Plus Jakarta Sans', sans-serif";
    context.fillText(trimOverlayText(config.prompt), 28, height - 34, width - 56);
  }
}

function buildMotionPreset(shotType, strength) {
  const level = strength === "high" ? 1 : strength === "low" ? 0.45 : 0.7;
  const presets = {
    "product reveal": { startZoom: 1.08, endZoom: 1.18, panX: 0.03, panY: 0.02, rotation: 0.003 },
    "close-up hero shot": { startZoom: 1.16, endZoom: 1.28, panX: 0.015, panY: 0.01, rotation: 0.002 },
    "tracking shot": { startZoom: 1.1, endZoom: 1.2, panX: 0.06, panY: 0, rotation: 0.002 },
    "360 orbit": { startZoom: 1.14, endZoom: 1.14, panX: 0.045, panY: 0.012, rotation: 0.01 },
    "dolly in": { startZoom: 1.0, endZoom: 1.24, panX: 0.01, panY: 0.01, rotation: 0.001 },
    "top-down motion": { startZoom: 1.08, endZoom: 1.18, panX: 0.01, panY: 0.05, rotation: 0.004 },
    "side profile tracking": { startZoom: 1.12, endZoom: 1.16, panX: 0.055, panY: 0.005, rotation: 0.002 },
    "back closure focus": { startZoom: 1.18, endZoom: 1.28, panX: -0.02, panY: 0.015, rotation: 0.002 },
    "fabric movement": { startZoom: 1.06, endZoom: 1.12, panX: 0.018, panY: 0.028, rotation: 0.005 },
    "cosmetic shine pass": { startZoom: 1.12, endZoom: 1.22, panX: 0.022, panY: 0.005, rotation: 0.002 },
    "macro texture pass": { startZoom: 1.2, endZoom: 1.34, panX: 0.01, panY: 0.01, rotation: 0.001 },
    "hanger rotation": { startZoom: 1.08, endZoom: 1.1, panX: 0.04, panY: 0.01, rotation: 0.008 },
    "luxury studio sweep": { startZoom: 1.06, endZoom: 1.16, panX: 0.03, panY: 0.016, rotation: 0.003 },
  };

  const preset = presets[shotType] || presets["product reveal"];
  return {
    startZoom: 1 + (preset.startZoom - 1) * level,
    endZoom: 1 + (preset.endZoom - 1) * level,
    panX: preset.panX * level,
    panY: preset.panY * level,
    rotation: preset.rotation * level,
  };
}

function aspectRatioToCanvas(ratio) {
  if (String(ratio).includes("x")) {
    const [widthText, heightText] = String(ratio).split("x");
    const customWidth = Number(widthText);
    const customHeight = Number(heightText);
    if (customWidth >= 256 && customHeight >= 256) {
      return { width: customWidth, height: customHeight };
    }
  }

  const map = {
    "16:9": { width: 1280, height: 720 },
    "9:16": { width: 720, height: 1280 },
    "1:1": { width: 1080, height: 1080 },
    "4:5": { width: 1080, height: 1350 },
    "2.39:1": { width: 1434, height: 600 },
    "21:9": { width: 1680, height: 720 },
    "3:2": { width: 1440, height: 960 },
    "2:3": { width: 960, height: 1440 },
    "1.91:1": { width: 1200, height: 628 },
    "2:1": { width: 1440, height: 720 },
  };
  return map[ratio] || map["16:9"];
}

function getVideoAspectRatioValue() {
  const customWidth = Number(document.getElementById("videoCustomWidth").value);
  const customHeight = Number(document.getElementById("videoCustomHeight").value);
  if (customWidth >= 256 && customHeight >= 256) {
    return `${customWidth}x${customHeight}`;
  }
  return document.getElementById("videoAspectRatio").value;
}

function easeInOutCubic(value) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function trimOverlayText(text) {
  const clean = String(text || "").trim();
  return clean.length > 70 ? `${clean.slice(0, 67)}...` : clean;
}

function blobUrlToDataUrl(blobUrl) {
  return new Promise((resolve, reject) => {
    fetch(blobUrl)
      .then((response) => response.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      })
      .catch(reject);
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildVideoPrompt() {
  const notes = document.getElementById("videoPrompt").value.trim();
  const productType = document.getElementById("videoProductType").value;
  const style = document.getElementById("videoStyle").value;
  const move = document.getElementById("shotType").value;
  const motion = document.getElementById("motionStrength").value;

  const presets = {
    undergarments:
      "realistic undergarment product animation, fabric realism, fit detail, tasteful commercial presentation",
    cosmetics:
      "premium cosmetics animation, glossy packaging, reflective highlights, luxury beauty commercial feel",
    fashion: "modern fashion product animation, clean studio movement, fabric realism, polished brand reel",
    jewelry: "luxury jewelry animation, precise sparkle highlights, elegant reflective motion",
    "bag-shoes": "premium accessories animation, material texture detail, showroom style movement",
    "general-product": "clean studio product animation, premium reveal, commercial-quality motion",
  };

  return [presets[productType], style, move, `${motion} motion`, notes].filter(Boolean).join(", ");
}

function registerPwa() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installAppButton.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    installAppButton.hidden = true;
    enhancedPromptBox.textContent = "App mobile home screen par install ho gayi.";
  });
}

async function installPwa() {
  if (!deferredInstallPrompt) {
    enhancedPromptBox.textContent =
      "Agar install button show nahi ho raha to Android Chrome mein page open karke browser menu se Install app use karein.";
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installAppButton.hidden = true;
}

function setupViewer() {
  const container = document.getElementById("panoramaViewer");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 1, 1100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const geometry = new THREE.SphereGeometry(500, 60, 40);
  geometry.scale(-1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0x18212f });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  camera.position.set(0, 0, 0.1);

  panorama = {
    scene,
    camera,
    renderer,
    mesh,
    container,
    yaw: 0,
    isAutoRotating: false,
  };

  renderer.setAnimationLoop(() => {
    if (!panorama) {
      return;
    }

    if (panorama.isAutoRotating) {
      panorama.yaw += 0.0025;
    }

    camera.rotation.y = panorama.yaw;
    renderer.render(scene, camera);
  });

  window.addEventListener("resize", () => {
    if (!panorama) {
      return;
    }
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}

async function handlePanoramaUpload(event) {
  const file = event.target.files[0];
  if (!file || !panorama) {
    return;
  }

  const dataUrl = await fileToDataUrl(file);
  const texture = await new THREE.TextureLoader().loadAsync(dataUrl);
  panorama.mesh.material.map = texture;
  panorama.mesh.material.needsUpdate = true;
  enhancedPromptBox.textContent = "360 panorama loaded in viewer.";
}

async function recordPanoramaSpin() {
  if (!panorama) {
    return;
  }

  const stream = panorama.renderer.domElement.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size) {
      chunks.push(event.data);
    }
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    renderGallery([{ url }], "video");
    enhancedPromptBox.textContent = "Panorama rotation record ho gayi. WebM download available hai.";
  };

  panorama.isAutoRotating = true;
  startSpinButton.textContent = "Stop rotation";
  recorder.start();
  enhancedPromptBox.textContent = "Recording 8 second rotating panorama...";

  setTimeout(() => {
    panorama.isAutoRotating = false;
    startSpinButton.textContent = "Auto rotate preview";
    recorder.stop();
  }, 8000);
}

function fileToDataUrl(file) {
  if (!file) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
