FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=hyperledger/fabric-ca:1.5.22 /usr/local/bin/fabric-ca-client /usr/local/bin/fabric-ca-client

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]