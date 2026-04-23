use serde_json::{json, Value};

pub fn file_watch_payload(kind: &str, paths: Vec<String>) -> Value {
    json!({
        "kind": kind,
        "paths": paths,
    })
}
