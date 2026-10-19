//! Cooperative request cancellation and progress; callbacks never enter protocol stdout.
use crate::{Error, Result};
use serde::Serialize;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
#[derive(Clone, Debug, Serialize)]
pub struct Progress {
    pub phase: &'static str,
    pub completed: u32,
    pub total: u32,
}
#[derive(Clone, Default)]
pub struct RenderControl {
    cancelled: Arc<AtomicBool>,
    observer: Option<Arc<dyn Fn(Progress) + Send + Sync>>,
}
impl RenderControl {
    pub fn with_observer(observer: impl Fn(Progress) + Send + Sync + 'static) -> Self {
        Self::default().observe(observer)
    }
    pub fn observe(mut self, observer: impl Fn(Progress) + Send + Sync + 'static) -> Self {
        self.observer = Some(Arc::new(observer));
        self
    }
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
    pub fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Relaxed) {
            Err(Error::new(
                "CANCELLED",
                "Render cancelled before output publication",
            ))
        } else {
            Ok(())
        }
    }
    pub fn progress(&self, phase: &'static str, completed: u32, total: u32) {
        if let Some(observer) = &self.observer {
            observer(Progress {
                phase,
                completed,
                total,
            });
        }
    }
}
