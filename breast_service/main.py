"""
Breast Tumor Microservice - FastAPI

This service is isolated so loading an incompatible model won't affect the main brain service.
It exposes `/api/health`, `/api/info` and `/api/predict` on port 8081.
"""
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
from pathlib import Path
import json
import zipfile
import tempfile
import numpy as np
import cv2
import tensorflow as tf
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("breast_service")

app = FastAPI(title="Breast Tumor Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = os.getenv("BREAST_MODEL_PATH", "/app/models/baseline_tumor_model.keras")
IMG_SIZE = int(os.getenv("IMG_SIZE", 128))

model = None
model_loaded = False

CLASS_COLORS = {
    0: "#639922",
    1: "#378ADD",
    2: "#EF9F27",
    3: "#E24B4A",
}

BINARY_CLASS_LABELS = {
    0: "No Tumor",
    1: "Tumor",
}


def _patch_inputlayer_config(node):
    if isinstance(node, dict):
        if node.get("class_name") == "InputLayer" and isinstance(node.get("config"), dict):
            cfg = node["config"]
            if "batch_shape" in cfg and "batch_input_shape" not in cfg:
                cfg["batch_input_shape"] = cfg.pop("batch_shape")
        for value in node.values():
            _patch_inputlayer_config(value)
    elif isinstance(node, list):
        for item in node:
            _patch_inputlayer_config(item)


def load_model_with_compat(model_path: str):
    try:
        return tf.keras.models.load_model(model_path, compile=False)
    except Exception as e:
        err = str(e)
        if "batch_shape" not in err or not model_path.endswith(".keras"):
            raise

        logger.warning(
            "Model load failed due to InputLayer batch_shape incompatibility. "
            "Applying temporary .keras config patch..."
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            extract_dir = Path(tmpdir) / "model_extract"
            extract_dir.mkdir(parents=True, exist_ok=True)

            with zipfile.ZipFile(model_path, "r") as zf:
                zf.extractall(extract_dir)

            config_path = extract_dir / "config.json"
            if not config_path.exists():
                raise RuntimeError("Invalid .keras archive: config.json not found")

            with open(config_path, "r", encoding="utf-8") as f:
                config_data = json.load(f)

            _patch_inputlayer_config(config_data)

            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config_data, f)

            patched_model_path = Path(tmpdir) / "patched_model.keras"
            with zipfile.ZipFile(patched_model_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for root, _, files in os.walk(extract_dir):
                    root_path = Path(root)
                    for file_name in files:
                        full_path = root_path / file_name
                        arcname = full_path.relative_to(extract_dir)
                        zf.write(full_path, arcname.as_posix())

            return tf.keras.models.load_model(str(patched_model_path), compile=False)

try:
    logger.info(f"Loading breast model from: {MODEL_PATH}")
    model = load_model_with_compat(MODEL_PATH)
    model_loaded = True
    logger.info("✓ Breast model loaded")
except Exception as e:
    logger.error(f"Breast model not loaded: {e}")
    model = None


def preprocess_image(image_bytes: bytes) -> np.ndarray:
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Unable to decode image")
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = cv2.resize(img, (IMG_SIZE, IMG_SIZE))
    img = img / 255.0
    img = np.expand_dims(img, axis=0)
    return img


@app.get("/api/health")
async def health():
    return {"status": "ok", "model_loaded": model_loaded}


@app.get("/api/info")
async def info():
    return {
        "model_name": "Breast CNN",
        "input_size": IMG_SIZE,
        "description": "Modèle de classification pour la détection de tumeurs mammaires",
        "models": {
            "breast": {
                "display_name": Path(MODEL_PATH).name,
                "path": MODEL_PATH,
                "loaded": model_loaded,
                "classes": ["No Tumor", "Tumor"],
                "colors": {
                    0: CLASS_COLORS[0],
                    1: CLASS_COLORS[1],
                },
                "confidence_threshold": 0.7,
            }
        },
    }


@app.post("/api/predict")
async def predict(file: UploadFile = File(...)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    if not model_loaded or model is None:
        raise HTTPException(status_code=503, detail="Breast model not available")

    try:
        contents = await file.read()
        img = preprocess_image(contents)
        preds = model.predict(img, verbose=0)
        pred_class = int(np.argmax(preds[0]))
        confidence = float(np.max(preds[0]))

        # Create generic class names if not known
        num_classes = preds.shape[1]
        if num_classes == 2:
            classes = [BINARY_CLASS_LABELS[0], BINARY_CLASS_LABELS[1]]
        else:
            classes = [f"class_{i}" for i in range(num_classes)]

        all_scores = {classes[i]: float(preds[0][i]) for i in range(num_classes)}

        return JSONResponse({
            "success": True,
            "tumor_type": "breast",
            "model_display_name": Path(MODEL_PATH).name,
            "prediction": classes[pred_class],
            "prediction_en": classes[pred_class],
            "color": CLASS_COLORS.get(pred_class, "#378ADD"),
            "confidence": round(confidence, 4),
            "confidence_percent": round(confidence * 100, 2),
            "requires_manual_review": False,
            "all_scores": all_scores,
            "filename": file.filename,
            "threshold": 0.7,
        })

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8081, log_level="info")
