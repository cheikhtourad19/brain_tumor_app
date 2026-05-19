"""
Détection de Tumeurs Cérébrales - API FastAPI
Brain Tumor Detection - FastAPI Application
"""

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
import numpy as np
import cv2
import tensorflow as tf
from io import BytesIO
import os
from pathlib import Path
import logging

# Configuration du logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialisation de l'application FastAPI
app = FastAPI(
    title="Détection de Tumeurs Cérébrales",
    description="Application IA pour la détection de tumeurs cérébrales en IRM",
    version="1.0.0"
)

# Montage des fichiers statiques
static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Configuration
MODEL_PATH = os.getenv("MODEL_PATH", "/app/models/cnn_baseline.keras")
IMG_SIZE = 128
CONFIDENCE_THRESHOLD = 0.7

# Mappage des classes
CLASS_MAPPING = {
    0: "Pas de tumeur",
    1: "Méningiome",
    2: "Hypophyse",
    3: "Gliome"
}

CLASS_MAPPING_EN = {
    0: "No Tumor",
    1: "Meningioma",
    2: "Pituitary",
    3: "Glioma"
}

COLORS = {
    0: "#639922",
    1: "#378ADD",
    2: "#EF9F27",
    3: "#E24B4A"
}

# Chargement du modèle au démarrage
logger.info("Chargement du modèle CNN...")
try:
    model = tf.keras.models.load_model(MODEL_PATH, compile=False)
    logger.info("✓ Modèle chargé avec succès")
except Exception as e:
    logger.error(f"✗ Erreur lors du chargement du modèle: {e}")
    model = None


def preprocess_image(image_bytes: bytes) -> np.ndarray:
    """
    Prétraite l'image pour le modèle CNN
    
    Args:
        image_bytes: Bytes de l'image uploadée
        
    Returns:
        Image prétraitée normalisée (128, 128, 3)
    """
    # Convertir bytes en numpy array
    nparr = np.frombuffer(image_bytes, np.uint8)
    
    # Décoder l'image
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if img is None:
        raise ValueError("Impossible de décoder l'image")
    
    # Convertir BGR en RGB
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    
    # Redimensionner à 128x128
    img = cv2.resize(img, (IMG_SIZE, IMG_SIZE))
    
    # Normaliser [0, 255] -> [0, 1]
    img = img / 255.0
    
    # Ajouter dimension batch
    img = np.expand_dims(img, axis=0)
    
    return img


@app.get("/")
async def root():
    """
    Page d'accueil - retourne le fichier HTML
    """
    with open(static_dir / "index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/api/health")
async def health_check():
    """
    Vérification de la santé de l'API
    """
    return {
        "status": "✓ En ligne",
        "model_loaded": model is not None,
        "available_models": {"brain": model is not None},
        "version": "1.1.0"
    }


@app.post("/api/predict")
async def predict(file: UploadFile = File(...)):
    """
    Endpoint de prédiction
    
    Args:
        file: Image IRM uploadée
        
    Returns:
        Prédiction avec scores de confiance et classe détectée
    """
    
    if model is None:
        raise HTTPException(status_code=500, detail="Le modèle n'est pas chargé")
    
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Le fichier doit être une image")
    
    try:
        # Lecture du fichier
        contents = await file.read()
        
        # Prétraitement
        logger.info(f"Prétraitement de l'image: {file.filename}")
        processed_image = preprocess_image(contents)
        
        # Prédiction
        logger.info("Exécution de la prédiction...")
        predictions = model.predict(processed_image, verbose=0)

        if predictions.shape[1] != len(CLASS_MAPPING):
            raise HTTPException(
                status_code=500,
                detail=(
                    "Incohérence entre la sortie du modèle "
                    f"({predictions.shape[1]} classes) et la configuration "
                    f"({len(CLASS_MAPPING)} classes)"
                )
            )

        # Extraction des résultats
        pred_class = int(np.argmax(predictions[0]))
        confidence = float(np.max(predictions[0]))

        # We return class names in English for the frontend; keep French mapping available
        english_map = CLASS_MAPPING_EN
        french_map = CLASS_MAPPING
        colors = COLORS
        confidence_threshold = CONFIDENCE_THRESHOLD

        # Tous les scores (keys in English so UI shows English class names)
        all_scores = {
            english_map[i]: float(predictions[0][i])
            for i in range(len(english_map))
        }
        
        # Vérification du seuil de confiance
        requires_review = confidence < confidence_threshold
        
        logger.info(
            f"[brain] Classe prédite: {english_map[pred_class]} "
            f"(Confiance: {confidence:.2%})"
        )

        return JSONResponse({
            "success": True,
            "tumor_type": "brain",
            "model_display_name": "Brain CNN",
            "prediction": english_map[pred_class],
            "prediction_fr": french_map[pred_class],
            "prediction_en": english_map[pred_class],
            "confidence": round(confidence, 4),
            "confidence_percent": round(confidence * 100, 2),
            "requires_manual_review": requires_review,
            "review_reason": (
                f"Confiance inférieure à {int(confidence_threshold * 100)}%"
                if requires_review
                else None
            ),
            "all_scores": all_scores,
            "color": colors[pred_class],
            "filename": file.filename,
            "threshold": confidence_threshold
        })
        
    except ValueError as e:
        logger.error(f"Erreur de valeur: {e}")
        raise HTTPException(status_code=400, detail=f"Erreur de traitement: {str(e)}")
    except Exception as e:
        logger.error(f"Erreur lors de la prédiction: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur serveur: {str(e)}")


@app.get("/api/info")
async def get_info():
    """
    Informations sur le modèle et les classes
    """
    return {
        "model_name": "Brain CNN",
        "input_size": IMG_SIZE,
        "description": "Modèle de classification pour la détection de tumeurs cérébrales",
        "models": {
            "brain": {
                "display_name": "Brain CNN",
                "path": MODEL_PATH,
                "loaded": model is not None,
                "classes": list(CLASS_MAPPING.values()),
                "colors": COLORS,
                "confidence_threshold": CONFIDENCE_THRESHOLD
            }
        }
    }


# Gestion des erreurs
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "success": False}
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info"
    )
