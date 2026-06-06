//! HashCerebrum Cloud Server
//!
//! Axum-based backend with:
//!   - PostgreSQL for relational data
//!   - Qdrant for vector search (connected via gRPC/HTTP)
//!   - OAuth2 / OpenID Connect authentication
//!   - RBAC: researcher, reviewer, admin
//!   - GPU node scheduling scaffolding
//!
//! Run locally:
//!   docker compose up -d db qdrant
//!   cargo run

mod auth;
mod rbac;

use axum::{
    routing::get,
    Router,
};
use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
use std::sync::Arc;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Application state shared across handlers.
#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Arc<AppConfig>,
}

/// Runtime configuration loaded from environment.
#[derive(Clone, Debug)]
pub struct AppConfig {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub jwt_secret: String,
    pub oauth_client_id: String,
    pub oauth_client_secret: String,
    pub oauth_redirect_url: String,
    pub qdrant_url: String,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        dotenvy::dotenv().ok();
        Ok(Self {
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/hashcerebrum".into()),
            bind_addr: std::env::var("BIND_ADDR")
                .unwrap_or_else(|_| "0.0.0.0:3000".into())
                .parse()?,
            jwt_secret: std::env::var("JWT_SECRET")
                .unwrap_or_else(|_| {
                    tracing::warn!("JWT_SECRET not set; using insecure default for development");
                    "dev-secret-change-in-production".into()
                }),
            oauth_client_id: std::env::var("OAUTH_CLIENT_ID").unwrap_or_default(),
            oauth_client_secret: std::env::var("OAUTH_CLIENT_SECRET").unwrap_or_default(),
            oauth_redirect_url: std::env::var("OAUTH_REDIRECT_URL")
                .unwrap_or_else(|_| "http://localhost:3000/auth/callback".into()),
            qdrant_url: std::env::var("QDRANT_URL")
                .unwrap_or_else(|_| "http://localhost:6334".into()),
        })
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "hashcerebrum_server=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Arc::new(AppConfig::from_env()?);

    // Database connection pool.
    let db = PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database_url)
        .await?;

    // Run migrations on startup.
    sqlx::migrate!("./migrations")
        .run(&db)
        .await?;

    tracing::info!("database migrations applied");

    let state = AppState {
        db: db.clone(),
        config: config.clone(),
    };

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/auth/login", get(auth::login))
        .route("/api/v1/auth/callback", get(auth::callback))
        .route("/api/v1/auth/me", get(auth::me))
        .route("/api/v1/admin/users", get(rbac::list_users))
        .layer(tower_http::cors::CorsLayer::permissive()) // TODO: tighten for production
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    tracing::info!(addr = %config.bind_addr, "starting server");
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health_check() -> &'static str {
    "ok"
}
