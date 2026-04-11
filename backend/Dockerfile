FROM golang:1.23 AS build
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/itms-server ./cmd/server

FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/itms-server /app/itms-server
COPY db/postgres_migrations /app/db/postgres_migrations
COPY certs /app/certs

EXPOSE 3001
CMD ["/app/itms-server"]
