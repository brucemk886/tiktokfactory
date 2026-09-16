FROM python:3.13-slim

RUN apt-get update \\
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \\
  && rm -rf /var/lib/apt/lists/* \\
  && pip install --no-cache-dir yt-dlp

WORKDIR /app
COPY server.py /app/server.py
EXPOSE 8080
CMD ["python", "/app/server.py"]
