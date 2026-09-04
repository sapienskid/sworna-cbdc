#build stage
FROM golang:1.24 AS builder
WORKDIR /go/src/app
COPY go.mod .
COPY go.sum .
RUN go mod download
RUN find /go/pkg/mod/github.com/hyperledger-labs/fabric-smart-client@* -name envelope.go -exec chmod +w {} \; && \
    find /go/pkg/mod/github.com/hyperledger-labs/fabric-smart-client@* -name envelope.go -exec sed -i 's/string(cis.ChaincodeSpec.Input.Args\[0\])/func() string { if len(cis.ChaincodeSpec.Input.Args) > 0 { return string(cis.ChaincodeSpec.Input.Args[0]) }; return "" }()/' {} \;
COPY . .
RUN go build -o /go/bin/app

#final stage
FROM golang:1.24
COPY --from=builder /go/bin/app /app
ENTRYPOINT /app
LABEL Name=tokens Version=0.1.0

ENV PORT=9000
ENV CONF_DIR=/conf
EXPOSE 9000
EXPOSE 9001
