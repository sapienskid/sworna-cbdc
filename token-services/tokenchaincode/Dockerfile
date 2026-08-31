FROM golang:1.24 as builder
RUN git clone https://github.com/hyperledger-labs/fabric-token-sdk.git
WORKDIR fabric-token-sdk

RUN git checkout v0.3.0 && go mod download
RUN python3 -c 'p="token/services/network/fabric/tcc/tcc.go"; c=open(p).read(); old="case QueryPublicParamsFunction:"; new="case \"init\", \"setup\":\n\t\t\treturn cc.Init(stub)\n\t\tcase QueryPublicParamsFunction:"; assert old in c; open(p,"w").write(c.replace(old,new,1))'
RUN CGO_ENABLED=1 go build -buildvcs=false -o /tcc token/services/network/fabric/tcc/main/main.go && chmod +x /tcc

# Final image
FROM golang:1.24
COPY --from=builder /tcc /tcc
EXPOSE 9999

ENV PUBLIC_PARAMS_FILE_PATH=/zkatdlog_pp.json
ADD zkatdlog_pp.json /zkatdlog_pp.json

CMD [ "/tcc"]
