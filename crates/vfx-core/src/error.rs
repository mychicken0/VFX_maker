use serde::Serialize;
use serde_json::{Value, json};
use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Serialize)]
pub struct Error {
    pub code: &'static str,
    pub message: String,
}

impl Error {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("INVALID_PROJECT", message)
    }
    pub fn envelope(&self) -> Value {
        json!({"ok": false, "error": self})
    }
    pub fn exit_code(&self) -> u8 {
        match self.code {
            "IO" | "BUSY" | "ALREADY_EXISTS" => 3,
            "REVISION_CONFLICT" => 4,
            "PATH_OUTSIDE_ROOT" => 5,
            "LIMIT_EXCEEDED" => 6,
            _ => 2,
        }
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for Error {}
impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Self::new("IO", e.to_string())
    }
}
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Self::new("INVALID_JSON", e.to_string())
    }
}
impl From<png::EncodingError> for Error {
    fn from(e: png::EncodingError) -> Self {
        Self::new("ENCODING_ERROR", e.to_string())
    }
}
impl From<gif::EncodingError> for Error {
    fn from(e: gif::EncodingError) -> Self {
        Self::new("ENCODING_ERROR", e.to_string())
    }
}

pub fn success(value: impl Serialize) -> Value {
    json!({"ok": true, "data": value})
}
