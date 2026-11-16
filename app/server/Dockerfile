FROM pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir cython "numpy<2.0" && pip install --no-cache-dir -r requirements.txt
COPY cifra_server ./cifra_server
ENV STORAGE_DIR=/data
EXPOSE 8000
CMD ["uvicorn", "cifra_server.main:app", "--host", "0.0.0.0", "--port", "8000"]
