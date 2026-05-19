const API_BASE_URL = "/api";
const BREAST_API_URL = "http://localhost:8081/api";
let currentResult = null;
let modelCatalog = {};
let selectedFile = null;

const classEmojis = {
  "No Tumor": "✅",
  Tumor: "🟠",
  Meningioma: "🔵",
  Glioma: "🔴",
  Pituitary: "🟠",
  "pas de tumeur": "✅",
  tumeur: "🟠",
};

// Mapping for breast model class names to French labels
function translateBreastClassName(className) {
  const breastClassMap = {
    class_0: "pas de tumeur",
    class_1: "tumeur",
    0: "pas de tumeur",
    1: "tumeur",
    "No Tumor": "pas de tumeur",
    Tumor: "tumeur",
    "no tumor": "pas de tumeur",
    tumor: "tumeur",
  };
  return breastClassMap[className] || className;
}

document.addEventListener("DOMContentLoaded", () => {
  initializeEventListeners();
  loadApiState();
});

function initializeEventListeners() {
  const dropZone = document.getElementById("dropZone");
  const imageInput = document.getElementById("imageInput");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const clearButton = document.getElementById("clearButton");
  const newAnalysisBtn = document.getElementById("newAnalysisBtn");
  const dismissErrorBtn = document.getElementById("dismissErrorBtn");
  const downloadResultsBtn = document.getElementById("downloadResultsBtn");
  const browseLink = document.getElementById("browseLink");
  const tumorType = document.getElementById("tumorType");

  dropZone.addEventListener("click", () => imageInput.click());
  browseLink.addEventListener("click", (e) => {
    e.stopPropagation();
    imageInput.click();
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("over");
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  });

  imageInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });

  tumorType.addEventListener("change", () => {
    document.getElementById("resultsSection").style.display = "none";
    currentResult = null;
    updateAnalyzeButtonState();
  });

  analyzeBtn.addEventListener("click", analyzeImage);
  clearButton.addEventListener("click", clearImage);
  newAnalysisBtn.addEventListener("click", resetInterface);
  dismissErrorBtn.addEventListener("click", () => {
    document.getElementById("errorSection").style.display = "none";
  });
  downloadResultsBtn.addEventListener("click", downloadResults);
}

async function loadApiState() {
  await Promise.all([checkHealth(), loadModelInfo()]);
  updateAnalyzeButtonState();
}

async function checkHealth() {
  try {
    const [mainResp, breastResp] = await Promise.allSettled([
      fetch(`${API_BASE_URL}/health`),
      fetch(`${BREAST_API_URL}/health`),
    ]);

    const mainOk =
      mainResp.status === "fulfilled" && mainResp.value.ok
        ? await mainResp.value
            .json()
            .then((d) => Boolean(d.model_loaded))
            .catch(() => false)
        : false;

    const breastOk =
      breastResp.status === "fulfilled" && breastResp.value.ok
        ? await breastResp.value
            .json()
            .then((d) => Boolean(d.model_loaded))
            .catch(() => false)
        : false;

    // show online if at least one service is available
    updateStatusBadge(mainOk || breastOk);
  } catch (error) {
    console.error("Erreur de connexion a l'API:", error);
    updateStatusBadge(false);
  }
}

async function loadModelInfo() {
  try {
    modelCatalog = {};

    const [mainResp, breastResp] = await Promise.allSettled([
      fetch(`${API_BASE_URL}/info`),
      fetch(`${BREAST_API_URL}/info`),
    ]);

    if (mainResp.status === "fulfilled" && mainResp.value.ok) {
      const data = await mainResp.value.json().catch(() => null);
      if (data && data.models) {
        modelCatalog = { ...modelCatalog, ...data.models };
      }
    }

    if (breastResp.status === "fulfilled" && breastResp.value.ok) {
      const data = await breastResp.value.json().catch(() => null);
      if (data && data.models) {
        modelCatalog = { ...modelCatalog, ...data.models };
      }
    }

    syncTumorTypeOptions();
  } catch (error) {
    console.error("Erreur lors du chargement des modeles:", error);
  }
}

function syncTumorTypeOptions() {
  const tumorType = document.getElementById("tumorType");
  const options = Array.from(tumorType.options);

  options.forEach((option) => {
    if (!option.dataset.baseLabel) {
      option.dataset.baseLabel = option.textContent.replace(
        /\s*\(non disponible\)\s*$/i,
        "",
      );
    }

    const baseLabel = option.dataset.baseLabel;
    const modelInfo = modelCatalog[option.value];
    const isLoaded = Boolean(modelInfo && modelInfo.loaded);
    option.disabled = !isLoaded;
    option.textContent = isLoaded ? baseLabel : `${baseLabel} (non disponible)`;
  });

  const selectedModel = modelCatalog[tumorType.value];
  if (!selectedModel || !selectedModel.loaded) {
    const firstAvailable = options.find((opt) => !opt.disabled);
    if (firstAvailable) {
      tumorType.value = firstAvailable.value;
    }
  }
}

function updateStatusBadge(isConnected) {
  const badge = document.getElementById("statusBadge");
  const dot = badge.querySelector(".status-dot");
  const text = document.getElementById("statusText");

  if (isConnected) {
    dot.classList.add("on");
    text.textContent = "En ligne";
    badge.style.background = "rgba(16, 185, 129, 0.2)";
  } else {
    dot.classList.remove("on");
    text.textContent = "Hors ligne";
    badge.style.background = "rgba(239, 68, 68, 0.2)";
  }
}

function handleFileSelect(file) {
  if (!file.type.startsWith("image/")) {
    showError("Veuillez sélectionner un fichier image valide.");
    return;
  }

  selectedFile = file;
  showPreview(file);
  updateAnalyzeButtonState();
}

function updateAnalyzeButtonState() {
  const analyzeBtn = document.getElementById("analyzeBtn");
  const selectedTumorType = document.getElementById("tumorType").value;
  const isModelAvailable =
    !modelCatalog[selectedTumorType] || modelCatalog[selectedTumorType].loaded;

  analyzeBtn.disabled = !(selectedFile && isModelAvailable);
}

function showPreview(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById("previewContainer");
    const img = document.getElementById("previewImage");
    const filename = document.getElementById("previewFilename");

    img.src = e.target.result;
    filename.textContent = file.name;
    preview.style.display = "flex";
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  selectedFile = null;
  document.getElementById("imageInput").value = "";
  document.getElementById("previewContainer").style.display = "none";
  updateAnalyzeButtonState();
}

async function analyzeImage() {
  if (!selectedFile) {
    showError("Sélectionnez d'abord une image.");
    return;
  }

  const tumorType = document.getElementById("tumorType").value;

  document.getElementById("loadingText").style.display = "inline-flex";
  document.getElementById("analyzeBtn").disabled = true;
  document.getElementById("resultsSection").style.display = "none";
  document.getElementById("errorSection").style.display = "none";

  try {
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("tumor_type", tumorType);

    const endpoint =
      tumorType === "breast"
        ? `${BREAST_API_URL}/predict`
        : `${API_BASE_URL}/predict`;

    const response = await fetch(endpoint, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.detail || "Échec de la prédiction.");
    }

    currentResult = data;
    displayResults(data, tumorType);
  } catch (error) {
    console.error("Erreur:", error);
    showError(error.message || "Échec de l'analyse.");
  } finally {
    document.getElementById("loadingText").style.display = "none";
    updateAnalyzeButtonState();
  }
}

function displayResults(data, tumorType) {
  const resultsSection = document.getElementById("resultsSection");
  const mainResult = document.getElementById("mainResult");
  const predictionClass = document.getElementById("predictionClass");
  const confidencePercent = document.getElementById("confidencePercent");
  const confidenceFill = document.getElementById("confidenceFill");
  const resultEmoji = document.getElementById("resultEmoji");
  const reviewAlert = document.getElementById("reviewAlert");
  const resultFilename = document.getElementById("resultFilename");
  const scoresContainer = document.getElementById("scoresContainer");
  const resultModelName = document.getElementById("resultModelName");
  const resultThreshold = document.getElementById("resultThreshold");
  const thresholdMarker = document.querySelector(".bar-threshold");

  // Get raw class name from response
  let className = data.prediction_en || data.prediction;

  // Always translate for breast model — covers class_0/class_1, "Tumor", "No Tumor", etc.
  if (tumorType === "breast") {
    className = translateBreastClassName(className);
  }

  const emoji = classEmojis[className] || "❓";
  const confidence = data.confidence_percent;
  const color = data.color || "#378ADD";
  const thresholdPercent = Math.round((data.threshold || 0.7) * 100);

  predictionClass.textContent = className;
  predictionClass.style.color = color;
  confidencePercent.textContent = confidence;
  confidenceFill.style.width = `${Math.min(confidence, 100)}%`;
  confidenceFill.style.background = `linear-gradient(90deg, ${color} 0%, ${adjustBrightness(color, -20)} 100%)`;
  resultEmoji.textContent = emoji;
  resultFilename.textContent = data.filename;
  resultModelName.textContent = data.model_display_name || "CNN Baseline";
  resultThreshold.textContent = `${thresholdPercent}%`;
  thresholdMarker.style.left = `${thresholdPercent}%`;

  mainResult.style.borderLeft = `4px solid ${color}`;

  if (data.requires_manual_review) {
    reviewAlert.style.display = "flex";
    reviewAlert.querySelector("span").textContent =
      data.review_reason ||
      "Confiance inférieure au seuil. Une revue clinique manuelle est requise.";
  } else {
    reviewAlert.style.display = "none";
  }

  scoresContainer.innerHTML = "";
  const highestScore = Math.max(...Object.values(data.all_scores));

  for (const [name, score] of Object.entries(data.all_scores)) {
    const scorePercent = Math.round(score * 100);
    const isActive = score === highestScore;

    // Translate breast class names in the scores breakdown too
    const displayName =
      tumorType === "breast" ? translateBreastClassName(name) : name;

    const scoreItem = document.createElement("div");
    scoreItem.className = `score-item ${isActive ? "active" : ""}`;
    scoreItem.innerHTML = `
      <div class="score-name">${displayName}</div>
      <div class="score-bar-track">
        <div class="score-bar-fill" style="width: ${scorePercent}%"></div>
      </div>
      <div class="score-value">${scorePercent}%</div>
    `;
    scoresContainer.appendChild(scoreItem);
  }

  resultsSection.style.display = "block";
  resultsSection.scrollIntoView({ behavior: "smooth" });
}

function showError(message) {
  const errorSection = document.getElementById("errorSection");
  const errorMessage = document.getElementById("errorMessage");
  if (
    message === "Prediction failed." ||
    message === "Échec de la prédiction."
  ) {
    errorMessage.textContent = "Échec de la prédiction.";
  } else if (
    message === "Analysis failed." ||
    message === "Échec de l'analyse."
  ) {
    errorMessage.textContent = "Échec de l'analyse.";
  } else {
    errorMessage.textContent = message;
  }
  errorSection.style.display = "flex";
  errorSection.scrollIntoView({ behavior: "smooth" });
}

function resetInterface() {
  clearImage();
  currentResult = null;
  document.getElementById("resultsSection").style.display = "none";
  document.getElementById("errorSection").style.display = "none";
  document.getElementById("loadingText").style.display = "none";
  document.querySelector(".drop-zone").scrollIntoView({ behavior: "smooth" });
}

function downloadResults() {
  if (!currentResult) {
    showError("Aucun résultat d'analyse à télécharger.");
    return;
  }

  const tumorType = document.getElementById("tumorType").value;
  let prediction = currentResult.prediction_en || currentResult.prediction;
  if (tumorType === "breast") {
    prediction = translateBreastClassName(prediction);
  }

  const results = {
    timestamp: new Date().toISOString(),
    filename: currentResult.filename,
    tumor_type: currentResult.tumor_type,
    model: currentResult.model_display_name,
    prediction: prediction,
    confidence_percent: currentResult.confidence_percent,
    all_scores: currentResult.all_scores,
    threshold: currentResult.threshold,
    requires_manual_review: currentResult.requires_manual_review,
    review_reason: currentResult.review_reason,
  };

  const dataStr = JSON.stringify(results, null, 2);
  const dataBlob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tumor_result_${new Date().toISOString().split("T")[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function adjustBrightness(color, percent) {
  const num = parseInt(color.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const red = (num >> 16) + amt;
  const green = ((num >> 8) & 0x00ff) + amt;
  const blue = (num & 0x0000ff) + amt;

  return (
    "#" +
    (
      0x1000000 +
      (red < 255 ? (red < 1 ? 0 : red) : 255) * 0x10000 +
      (green < 255 ? (green < 1 ? 0 : green) : 255) * 0x100 +
      (blue < 255 ? (blue < 1 ? 0 : blue) : 255)
    )
      .toString(16)
      .slice(1)
  );
}

setInterval(() => {
  checkHealth();
}, 10000);
