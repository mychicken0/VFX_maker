use crate::{Error, Result, graph, model::Project};
use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

pub const MAX_PROJECT_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct Workspace {
    root: PathBuf,
}

impl Workspace {
    pub fn new(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().canonicalize()?;
        if !root.is_dir() {
            return Err(Error::new(
                "INVALID_PATH",
                "Root must be an existing directory",
            ));
        }
        Ok(Self { root })
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn resolve(&self, path: impl AsRef<Path>) -> Result<PathBuf> {
        let path = path.as_ref();
        if path.as_os_str().is_empty()
            || path.components().any(|c| matches!(c, Component::ParentDir))
        {
            return Err(Error::new(
                "PATH_OUTSIDE_ROOT",
                "Empty paths and parent traversal are not allowed",
            ));
        }
        let joined = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.root.join(path)
        };
        let resolved = match fs::symlink_metadata(&joined) {
            Ok(_) => joined.canonicalize()?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let parent = joined
                    .parent()
                    .ok_or_else(|| Error::new("INVALID_PATH", "Path must have a parent"))?
                    .canonicalize()?;
                parent.join(
                    joined
                        .file_name()
                        .ok_or_else(|| Error::new("INVALID_PATH", "Path must have a filename"))?,
                )
            }
            Err(e) => return Err(e.into()),
        };
        if !resolved.starts_with(&self.root) || resolved == self.root {
            return Err(Error::new(
                "PATH_OUTSIDE_ROOT",
                "Path must be a file or new output directory within --root",
            ));
        }
        Ok(resolved)
    }
    pub fn read_bytes(&self, path: impl AsRef<Path>) -> Result<Vec<u8>> {
        let path = self.resolve(path)?;
        let file = File::open(path)?;
        if !file.metadata()?.is_file() {
            return Err(Error::new("INVALID_PATH", "Expected a regular file"));
        }
        let mut bytes = vec![];
        file.take(MAX_PROJECT_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_PROJECT_BYTES {
            return Err(Error::new("LIMIT_EXCEEDED", "Input exceeds 4 MiB"));
        }
        Ok(bytes)
    }
    pub fn read_project(&self, path: impl AsRef<Path>) -> Result<Project> {
        let project = serde_json::from_slice(&self.read_bytes(path)?)?;
        graph::validate_project(&project)?;
        Ok(project)
    }
    pub(crate) fn lock(&self, path: &Path) -> Result<File> {
        let mut lock_name = path.as_os_str().to_os_string();
        lock_name.push(".lock");
        let lock_path = self.resolve(PathBuf::from(lock_name))?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)?;
        FileExt::try_lock_exclusive(&lock).map_err(|e| {
            if e.kind() == std::io::ErrorKind::WouldBlock {
                Error::new(
                    "BUSY",
                    "Another process is editing this project; retry after it finishes",
                )
            } else {
                e.into()
            }
        })?;
        Ok(lock)
    }
    pub(crate) fn write_project(&self, path: &Path, project: &Project, new: bool) -> Result<()> {
        graph::validate_project(project)?;
        let mut bytes = serde_json::to_vec_pretty(project)?;
        bytes.push(b'\n');
        if bytes.len() as u64 > MAX_PROJECT_BYTES {
            return Err(Error::new(
                "LIMIT_EXCEEDED",
                "Saved project would exceed 4 MiB",
            ));
        }
        atomic_write(path, &bytes, !new)
    }
}

pub fn atomic_write(path: &Path, bytes: &[u8], overwrite: bool) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::new("INVALID_PATH", "Missing parent directory"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    let result = if overwrite {
        temp.persist(path)
    } else {
        temp.persist_noclobber(path)
    };
    result.map_err(|e| {
        if e.error.kind() == std::io::ErrorKind::AlreadyExists {
            Error::new("ALREADY_EXISTS", "Target exists; choose a new output path")
        } else {
            e.error.into()
        }
    })?;
    Ok(())
}
