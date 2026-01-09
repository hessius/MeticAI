FROM python:3.11-slim

# Install Docker CLI (to talk to the sibling container)
RUN apt-get update && apt-get install -y docker.io

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python deps
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Run the app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
