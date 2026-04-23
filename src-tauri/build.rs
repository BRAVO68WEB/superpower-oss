fn main() {
    println!("cargo:rerun-if-env-changed=SUPERPOWER_GH_REPO");
    println!("cargo:rerun-if-env-changed=SUPERPOWER_TAURI_UPDATER_PUBKEY");
    tauri_build::build()
}
