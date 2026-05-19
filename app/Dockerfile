# Utiliser une image Python 3.11 slim (bookworm pour stabilité)
FROM python:3.11-slim-bookworm

# Définir le répertoire de travail
WORKDIR /app

# Définir les variables d'environnement
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive

# Installer les dépendances système pour OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    libhdf5-dev \
    zlib1g-dev \
    libjpeg-dev \
    libpng-dev \
    libopenblas-dev \
    liblapack-dev \
    libgomp1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1 \
    libglu1-mesa \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Copier le fichier requirements.txt
COPY requirements.txt .

# Installer les dépendances Python et TensorFlow compatible avec le modèle d'entraînement (2.13.0)
RUN pip install --upgrade pip && \
    pip install --no-cache-dir numpy==1.24.3 && \
    pip install --no-cache-dir tensorflow==2.13.0 && \
    pip install --no-cache-dir -r requirements.txt

# Copier l'application
COPY main.py .
COPY static/ ./static/

# Exposer le port
EXPOSE 8000

# Commande de démarrage
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
