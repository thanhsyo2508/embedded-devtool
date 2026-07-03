//! Flash profiles (M2-T1.6): a reusable (files + offsets + options) bundle,
//! saved as plain JSON so it can be committed to a project's git repo per
//! the plan's "config as project file" principle — not a proprietary format.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashProfileSegment {
    pub offset: u32,
    pub path: String,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashProfile {
    pub name: String,
    #[serde(default)]
    pub chip: Option<String>,
    pub baud_rate: u32,
    pub segments: Vec<FlashProfileSegment>,
}

pub fn save_profile(path: &Path, profile: &FlashProfile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(profile).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn load_profile(path: &Path) -> Result<FlashProfile, String> {
    let json = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_json() {
        let dir = std::env::temp_dir().join(format!(
            "edt-flash-profile-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("profile.json");

        let profile = FlashProfile {
            name: "my-esp32".to_string(),
            chip: Some("ESP32-S3".to_string()),
            baud_rate: 460_800,
            segments: vec![
                FlashProfileSegment {
                    offset: 0x1000,
                    path: "bootloader.bin".to_string(),
                    label: None,
                },
                FlashProfileSegment {
                    offset: 0x10000,
                    path: "app.bin".to_string(),
                    label: Some("app".to_string()),
                },
            ],
        };

        save_profile(&path, &profile).unwrap();
        let loaded = load_profile(&path).unwrap();

        assert_eq!(loaded.name, "my-esp32");
        assert_eq!(loaded.segments.len(), 2);
        assert_eq!(loaded.segments[1].offset, 0x10000);

        fs::remove_dir_all(&dir).ok();
    }
}
