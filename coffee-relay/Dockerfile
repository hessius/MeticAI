FROM python:3.11-slim

# Install Docker CLI (to talk to the sibling container)
RUN apt-get update && apt-get install -y docker.io

WORKDIR /app

# Install Python deps
RUN pip install fastapi uvicorn google-generativeai pillow python-multipart

COPY main.py .

# Run the app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
