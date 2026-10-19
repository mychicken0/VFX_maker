//! Bounded in-process export jobs; cancellation cleans staged outputs through the core API.
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::sync::Notify;
use vfx_core::{Error, Result, Workspace, api::JobExportRequest, control::RenderControl};
#[derive(Clone, Default)]
pub struct Jobs {
    registry: Arc<Registry>,
}
#[derive(Default)]
struct Registry {
    entries: Mutex<BTreeMap<String, Arc<Job>>>,
    next: AtomicU64,
}
struct Job {
    control: RenderControl,
    changed: Notify,
    status: Mutex<Value>,
}
fn terminal(state: &Value) -> bool {
    matches!(
        state["state"].as_str(),
        Some("succeeded" | "failed" | "cancelled")
    )
}
impl Drop for Registry {
    fn drop(&mut self) {
        if let Ok(entries) = self.entries.lock() {
            for job in entries.values() {
                job.control.cancel();
                job.changed.notify_one();
            }
        }
    }
}
impl Jobs {
    pub fn start(&self, workspace: Workspace, request: JobExportRequest) -> Result<Value> {
        workspace.resolve(&request.export.project)?;
        workspace.resolve(&request.export.out)?;
        let mut entries = self.registry.entries.lock().expect("job registry");
        if entries.len() >= 32 {
            let finished = entries.iter().find_map(|(id, job)| {
                terminal(&job.status.lock().expect("job status")).then(|| id.clone())
            });
            if let Some(id) = finished {
                entries.remove(&id);
            } else {
                return Err(Error::new(
                    "LIMIT_EXCEEDED",
                    "At most 32 retained export jobs; wait for an active job to finish",
                ));
            }
        }
        let serial = self
            .registry
            .next
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_add(1))
            .map_err(|_| Error::new("LIMIT_EXCEEDED", "Export job ID space exhausted"))?;
        let id = format!("job-{serial:016x}");
        let job = Arc::new_cyclic(|weak: &Weak<Job>| {
            let weak = weak.clone();
            let control = RenderControl::with_observer(move |event| {
                if let Some(job) = weak.upgrade() {
                    job.status.lock().expect("job status")["progress"] = json!(event);
                }
            });
            Job {
                control,
                changed: Notify::new(),
                status: Mutex::new(
                    json!({"job_id":id,"state":"queued","project":request.export.project,"expected_revision":request.expected_revision,"progress":null,"result":null,"error":null}),
                ),
            }
        });
        let initial = job.status.lock().expect("job status").clone();
        entries.insert(id, job.clone());
        drop(entries);
        tokio::spawn(async move {
            let permit = tokio::select! {
                permit=crate::SLOTS.acquire()=>permit.ok(),
                _=job.changed.notified()=>None,
            };
            let Some(permit) = permit else {
                job.status.lock().expect("job status")["state"] = json!("cancelled");
                return;
            };
            if job.control.check().is_err() {
                job.status.lock().expect("job status")["state"] = json!("cancelled");
                return;
            }
            job.status.lock().expect("job status")["state"] = json!("running");
            let control = job.control.clone();
            let result = tokio::task::spawn_blocking(move || {
                let _permit = permit;
                control.check()?;
                let project = workspace.read_project(&request.export.project)?;
                if project.revision != request.expected_revision {
                    return Err(Error::new(
                        "REVISION_CONFLICT",
                        format!(
                            "Job expected revision {}, current revision is {}",
                            request.expected_revision, project.revision
                        ),
                    ));
                }
                vfx_core::export::export_controlled(&workspace, &project, &request.export, &control)
            })
            .await
            .unwrap_or_else(|e| Err(Error::new("WORKER_FAILED", e.to_string())));
            let mut state = job.status.lock().expect("job status");
            match result {
                Ok(value) => {
                    state["state"] = json!("succeeded");
                    state["result"] = value;
                }
                Err(error) => {
                    state["state"] = json!(if error.code == "CANCELLED" {
                        "cancelled"
                    } else {
                        "failed"
                    });
                    state["error"] = json!(error);
                }
            }
        });
        Ok(initial)
    }
    fn find(&self, id: &str) -> Result<Arc<Job>> {
        self.registry
            .entries
            .lock()
            .expect("job registry")
            .get(id)
            .cloned()
            .ok_or_else(|| {
                Error::new(
                    "UNKNOWN_JOB",
                    "Job does not exist in this server session or was evicted after completion",
                )
            })
    }
    pub fn get(&self, id: &str) -> Result<Value> {
        Ok(self.find(id)?.status.lock().expect("job status").clone())
    }
    pub fn cancel(&self, id: &str) -> Result<Value> {
        let job = self.find(id)?;
        let mut state = job.status.lock().expect("job status");
        if !terminal(&state) {
            job.control.cancel();
            job.changed.notify_one();
            state["state"] = json!("cancelling");
        }
        Ok(state.clone())
    }
}
