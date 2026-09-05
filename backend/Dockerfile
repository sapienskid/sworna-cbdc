FROM python:3.14-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl jq tar ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=hyperledger/fabric-ca:1.5.22 /usr/local/bin/fabric-ca-client /usr/local/bin/fabric-ca-client
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]