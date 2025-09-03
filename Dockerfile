FROM python:3.11-slim

WORKDIR /app

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Default command runs the Flask visualization server
EXPOSE 5000
CMD ["python", "visualize_grants_web.py"]
