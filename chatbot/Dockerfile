FROM python:3.11-slim
WORKDIR /srv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY db ./db
COPY seed ./seed
COPY web ./web
RUN useradd --system --uid 10001 chatbot && chown -R chatbot /srv
USER chatbot
EXPOSE 8090
# Seed (idempotent: unchanged documents are skipped), then serve.
CMD ["sh", "-c", "python -m app.ingest && uvicorn app.main:app --host 0.0.0.0 --port 8090"]
