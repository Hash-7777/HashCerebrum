//! OAuth2 / OpenID Connect authentication handlers.
//!
//! Supports generic OIDC providers. Institutional SAML is handled
//! via an OIDC bridge (e.g. Keycloak, Okta, or Authentik).

use axum::{
    extract::{Query, State},
    response::Redirect,
    Json,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{AppConfig, AppState};

/// Claims stored inside the JWT session cookie / bearer token.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,        // user UUID
    pub email: String,
    pub role: String,       // researcher | reviewer | admin
    pub exp: i64,
    pub iat: i64,
}

/// OAuth2 authorization URL request.
#[derive(Debug, Deserialize)]
pub struct LoginQuery {
    pub provider: Option<String>,
}

/// Start the OAuth2 authorization code flow.
pub async fn login(
    State(state): State<AppState>,
    Query(_query): Query<LoginQuery>,
) -> Redirect {
    // In a full implementation, construct the OAuth2 authorization URL
    // using the configured provider metadata and redirect to it.
    // For the scaffold, redirect to a placeholder.
    let _config = &state.config;
    Redirect::temporary("/auth/not-yet-implemented")
}

/// OAuth2 callback — exchange code for tokens, create/update user.
#[derive(Debug, Deserialize)]
pub struct CallbackQuery {
    pub code: String,
    pub state: Option<String>,
}

pub async fn callback(
    State(_state): State<AppState>,
    Query(_query): Query<CallbackQuery>,
) -> Json<AuthResponse> {
    // TODO: exchange code for token, verify ID token, create/update user in DB,
    // issue JWT session, and redirect to frontend.
    Json(AuthResponse {
        access_token: "placeholder".into(),
        token_type: "Bearer".into(),
        expires_in: 3600,
    })
}

/// Return the currently authenticated user's profile.
pub async fn me(State(_state): State<AppState>) -> Json<UserProfile> {
    // TODO: extract JWT from Authorization header, validate, query DB.
    Json(UserProfile {
        id: uuid::Uuid::new_v4().to_string(),
        email: "user@example.com".into(),
        name: "Researcher".into(),
        role: "researcher".into(),
        institution: None,
    })
}

/// Generate a JWT for the given user.
pub fn issue_jwt(user_id: &str, email: &str, role: &str, config: &AppConfig) -> anyhow::Result<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        role: role.to_string(),
        iat: now.timestamp(),
        exp: (now + Duration::hours(24)).timestamp(),
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )?;
    Ok(token)
}

/// Validate a JWT and return its claims.
pub fn validate_jwt(token: &str, config: &AppConfig) -> anyhow::Result<Claims> {
    let validation = Validation::default();
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &validation,
    )?;
    Ok(token_data.claims)
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: u64,
}

#[derive(Debug, Serialize)]
pub struct UserProfile {
    pub id: String,
    pub email: String,
    pub name: String,
    pub role: String,
    pub institution: Option<String>,
}
