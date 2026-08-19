fn main() {
    emit_build_id();
    configure_sidecar();
    tauri_build::build()
}

/// Stamp the binary with the commit it was built from, so a running app can be
/// asked what it is instead of being taken at its word. `unknown` when git is
/// unavailable (release tarball, no .git); `-dirty` when the tree had changes.
fn emit_build_id() {
    let head = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let build_id = match head {
        Some(hash) => {
            let dirty = std::process::Command::new("git")
                .args(["status", "--porcelain"])
                .output()
                .ok()
                .filter(|out| out.status.success())
                .is_some_and(|out| !out.stdout.is_empty());
            if dirty {
                format!("{hash}-dirty")
            } else {
                hash
            }
        }
        None => "unknown".to_string(),
    };

    println!("cargo:rustc-env=MICAH_BUILD_ID={build_id}");
    // Without this the stamp would be frozen at the first build of the session.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/index");
}

fn configure_sidecar() {
    let Ok(target) = std::env::var("TARGET") else {
        return;
    };
    let extension = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    // Every declared sidecar with its build command. A dev build tolerates a
    // missing one by shrinking externalBin to the present subset — never by
    // zeroing it, which would silently drop the sidecars that DO exist.
    let sidecars = [
        ("micah-cli", "pnpm build:cli"),
        ("mindwalk", "pnpm build:mindwalk"),
    ];
    let mut present = Vec::new();
    let mut missing = Vec::new();
    for (name, fix) in sidecars {
        let path =
            std::path::PathBuf::from("binaries").join(format!("{name}-{target}{extension}"));
        let valid =
            std::fs::metadata(&path).is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0);
        if valid {
            present.push(format!("binaries/{name}"));
        } else {
            missing.push((path, fix));
        }
    }
    if missing.is_empty() {
        return;
    }
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let list = missing
            .iter()
            .map(|(path, fix)| format!("{} (run {fix})", path.display()))
            .collect::<Vec<_>>()
            .join(", ");
        panic!("release sidecar(s) missing or empty: {list}");
    }

    let mut config = std::env::var("TAURI_CONFIG")
        .map(|value| serde_json::from_str(&value).expect("parse TAURI_CONFIG"))
        .unwrap_or_else(|_| serde_json::json!({}));
    config["bundle"]["externalBin"] = serde_json::json!(present);
    std::env::set_var(
        "TAURI_CONFIG",
        serde_json::to_string(&config).expect("serialize TAURI_CONFIG"),
    );
}
