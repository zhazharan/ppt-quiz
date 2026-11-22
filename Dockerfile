FROM python:3.11-slim
RUN useradd -m -u 1000 user
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=user . .
USER user
ENV PORT=7860
EXPOSE 7860
CMD gunicorn -w 1 --threads 8 -t 300 -b 0.0.0.0:$PORT app:app
