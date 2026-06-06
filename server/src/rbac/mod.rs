//! Role-based access control (RBAC).
//!
//! Roles:
//!   - researcher  — can create projects, run searches, draft manuscripts
//!   - reviewer    — can view projects, add peer-review comments
//!   - admin       — can manage users, view audit logs, configure policies
//!
//! Multi-tenant isolation is planned via row-level security in PostgreSQL.

use axum::{
    extract::State,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Researcher,
    Reviewer,
    Admin,
}

impl Role {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "researcher" => Some(Role::Researcher),
            "reviewer" => Some(Role::Reviewer),
            "admin" => Some(Role::Admin),
            _ => None,
        }
    }

    pub fn permissions(&self) -> Vec<&'static str> {
        match self {
            Role::Researcher => vec![
                "project:create",
                "project:read",
                "project:update",
                "search:execute",
                "manuscript:draft",
                "manuscript:export",
            ],
            Role::Reviewer => vec![
                "project:read",
                "review:comment",
                "review:approve",
                "review:reject",
            ],
            Role::Admin => vec![
                "project:create",
                "project:read",
                "project:update",
                "project:delete",
                "user:manage",
                "audit:read",
                "config:write",
            ],
        }
    }
}

/// Axum extractor that validates the requester has one of the required roles.
/// TODO: implement as a `FromRequestParts` extractor that reads the JWT.

#[derive(Debug, Serialize)]
pub struct UserListItem {
    pub id: String,
    pub email: String,
    pub name: String,
    pub role: String,
    pub created_at: String,
}

/// List all users (admin only).
pub async fn list_users(State(_state): State<AppState>) -> Json<Vec<UserListItem>> {
    // TODO: query DB, enforce admin role.
    Json(vec![
        UserListItem {
            id: uuid::Uuid::new_v4().to_string(),
            email: "admin@example.com".into(),
            name: "System Administrator".into(),
            role: "admin".into(),
            created_at: chrono::Utc::now().to_rfc3339(),
        },
    ])
}
