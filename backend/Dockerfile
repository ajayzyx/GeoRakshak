FROM python:3.11-slim
WORKDIR /srv
COPY ml /srv/ml
COPY backend/requirements.txt /srv/backend/requirements.txt
RUN pip install --no-cache-dir -r /srv/backend/requirements.txt && pip install --no-cache-dir /srv/ml
COPY backend /srv/backend
WORKDIR /srv/backend
EXPOSE 8000
CMD ["sh", "-c", "python -m scripts.migrate && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
