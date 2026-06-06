# HashCerebrum Cloud Server — Multi-stage Docker build
# ==============================================================

# --------------------------------------------------
# Builder stage
# --------------------------------------------------
FROM rust:1.77-slim-bookworm AS builder

WORKDIR /app

# Install build dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests and fetch dependencies first (layer caching).
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs
RUN cargo fetch
RUN cargo build --release && rm -rf src

# Copy source and build.
COPY src ./src
COPY migrations ./migrations
RUN touch src/main.rs
RUN cargo build --release

# --------------------------------------------------
# Runtime stage
# --------------------------------------------------
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/hashcerebrum-server /usr/local/bin/
COPY migrations ./migrations

ENV RUST_LOG=info
EXPOSE 3000

ENTRYPOINT ["hashcerebrum-server"]
