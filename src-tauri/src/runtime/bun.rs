use anyhow::{anyhow, Context, Result};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::fs;
use tokio::process::Command;

#[derive(Debug, Clone)]
pub struct BunRuntime {
    pub executable: PathBuf,
    pub bundled_available: bool,
}

impl BunRuntime {
    pub async fn resolve(app: &AppHandle) -> Result<Self> {
        let app_data_dir = app.path().app_data_dir()?;
        let runtime_dir = app_data_dir.join("runtime");
        fs::create_dir_all(&runtime_dir).await?;

        if let Some(candidate) = bundled_bun_candidate(app, &runtime_dir).await? {
            return Ok(Self {
                executable: candidate,
                bundled_available: true,
            });
        }

        Ok(Self {
            executable: PathBuf::from("bun"),
            bundled_available: false,
        })
    }

    pub async fn version(&self) -> Option<String> {
        Command::new(&self.executable)
            .arg("--version")
            .output()
            .await
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|value| value.trim().to_string())
    }
}

async fn bundled_bun_candidate(app: &AppHandle, runtime_dir: &Path) -> Result<Option<PathBuf>> {
    let candidate_names = platform_candidates();
    let resource_dir = app.path().resource_dir().ok();

    for name in candidate_names {
        if let Some(resource_dir) = &resource_dir {
            let source = resource_dir.join("bun").join(name);
            if source.exists() {
                let target = runtime_dir.join(name);
                if !target.exists() {
                    fs::copy(&source, &target).await.with_context(|| {
                        format!("failed to copy bundled bun from {}", source.display())
                    })?;
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let mut perms = fs::metadata(&target).await?.permissions();
                        perms.set_mode(0o755);
                        fs::set_permissions(&target, perms).await?;
                    }
                }
                return Ok(Some(target));
            }
        }
    }

    Ok(None)
}

fn platform_candidates() -> &'static [&'static str] {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        &["bun-darwin-aarch64", "bun"]
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        &["bun-darwin-x64", "bun"]
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        &["bun-linux-x64", "bun"]
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        &["bun-windows-x64.exe", "bun.exe"]
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64")
    )))]
    {
        &["bun"]
    }
}

pub fn validate_bun_path(path: &Path) -> Result<()> {
    if path.as_os_str().is_empty() {
        return Err(anyhow!("empty bun runtime path"));
    }
    Ok(())
}
