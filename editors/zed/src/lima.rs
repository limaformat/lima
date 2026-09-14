use std::{env, fs};

use zed_extension_api::{self as zed, serde_json, settings::LspSettings, Result};

const PACKAGE_NAME: &str = "@limaformat/lima-language-server";
const SERVER_PATH: &str = "node_modules/@limaformat/lima-language-server/dist/server.js";

struct LimaExtension {
    did_find_server: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum InstallDecision {
    Current,
    StaleFallback(String),
}

#[derive(Debug, PartialEq, Eq)]
enum NetworkDecision<T> {
    Current(T),
    StaleFallback(String),
}

fn network_decision<T>(result: Result<T>, server_exists_after: bool) -> Result<NetworkDecision<T>> {
    match (result, server_exists_after) {
        (Ok(value), _) => Ok(NetworkDecision::Current(value)),
        (Err(error), true) => Ok(NetworkDecision::StaleFallback(error)),
        (Err(error), false) => Err(error),
    }
}

fn install_decision(result: Result<()>, server_exists_after: bool) -> Result<InstallDecision> {
    match (result, server_exists_after) {
        (Ok(()), true) => Ok(InstallDecision::Current),
        (Ok(()), false) => Err(format!(
            "installed package '{PACKAGE_NAME}' did not contain expected path '{SERVER_PATH}'"
        )),
        (Err(error), true) => Ok(InstallDecision::StaleFallback(error)),
        (Err(error), false) => Err(error),
    }
}

impl LimaExtension {
    fn server_exists(&self) -> bool {
        fs::metadata(SERVER_PATH).is_ok_and(|metadata| metadata.is_file())
    }

    fn server_script_path(&mut self, language_server_id: &zed::LanguageServerId) -> Result<String> {
        let server_exists = self.server_exists();
        if self.did_find_server && server_exists {
            return Ok(SERVER_PATH.to_string());
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );
        let latest_version = match network_decision(
            zed::npm_package_latest_version(PACKAGE_NAME),
            self.server_exists(),
        )? {
            NetworkDecision::Current(version) => version,
            NetworkDecision::StaleFallback(error) => {
                return Ok(self.use_stale_server(language_server_id, "update check", error));
            }
        };

        let server_exists = self.server_exists();
        let installed_version = if server_exists {
            match network_decision(
                zed::npm_package_installed_version(PACKAGE_NAME),
                self.server_exists(),
            )? {
                NetworkDecision::Current(version) => version,
                NetworkDecision::StaleFallback(error) => {
                    return Ok(self.use_stale_server(
                        language_server_id,
                        "installed-version check",
                        error,
                    ));
                }
            }
        } else {
            None
        };

        if !server_exists || installed_version.as_ref() != Some(&latest_version) {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            match install_decision(
                zed::npm_install_package(PACKAGE_NAME, &latest_version),
                self.server_exists(),
            )? {
                InstallDecision::Current => {}
                InstallDecision::StaleFallback(error) => {
                    return Ok(self.use_stale_server(language_server_id, "update", error));
                }
            }
        }

        self.did_find_server = true;
        Ok(SERVER_PATH.to_string())
    }

    fn use_stale_server(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        stage: &str,
        error: String,
    ) -> String {
        self.did_find_server = false;
        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::Failed(format!(
                "{stage} failed ({error}); using the installed version and retrying on the next language-server start"
            )),
        );
        SERVER_PATH.to_string()
    }
}

impl zed::Extension for LimaExtension {
    fn new() -> Self {
        Self {
            did_find_server: false,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let server_path = self.server_script_path(language_server_id)?;
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                env::current_dir()
                    .map_err(|error| error.to_string())?
                    .join(server_path)
                    .to_string_lossy()
                    .to_string(),
                "--stdio".to_string(),
            ],
            env: Default::default(),
        })
    }

    fn language_server_initialization_options(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        Ok(LspSettings::for_worktree("lima-language-server", worktree)
            .ok()
            .and_then(|settings| settings.initialization_options))
    }

    fn language_server_workspace_configuration(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        Ok(LspSettings::for_worktree("lima-language-server", worktree)
            .ok()
            .and_then(|settings| settings.settings))
    }
}

zed::register_extension!(LimaExtension);

#[cfg(test)]
mod tests {
    use super::{install_decision, network_decision, InstallDecision, NetworkDecision};

    #[test]
    fn failed_version_check_with_existing_server_uses_stale_fallback() {
        assert_eq!(
            network_decision::<String>(Err("offline".to_string()), true),
            Ok(NetworkDecision::StaleFallback("offline".to_string())),
        );
    }

    #[test]
    fn failed_version_check_without_server_remains_a_hard_error() {
        assert_eq!(
            network_decision::<String>(Err("offline".to_string()), false),
            Err("offline".to_string()),
        );
    }

    #[test]
    fn failed_installed_version_check_with_existing_server_uses_stale_fallback() {
        assert_eq!(
            network_decision::<Option<String>>(Err("offline".to_string()), true),
            Ok(NetworkDecision::StaleFallback("offline".to_string())),
        );
    }

    #[test]
    fn failed_update_with_stale_server_keeps_retrying() {
        assert_eq!(
            install_decision(Err("offline".to_string()), true),
            Ok(InstallDecision::StaleFallback("offline".to_string())),
        );
    }

    #[test]
    fn failed_first_install_remains_a_hard_error() {
        assert_eq!(
            install_decision(Err("offline".to_string()), false),
            Err("offline".to_string()),
        );
    }
}
