use async_trait::async_trait;
use russh::client;
use russh_keys::key::PublicKey;

/// Handles server events for a single SSH connection.
pub struct SshClientHandler {
    host: String,
    port: u16,
}

impl SshClientHandler {
    pub fn new(host: String, port: u16) -> Self {
        Self { host, port }
    }
}

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    /// Called when the server presents its host key.
    /// Verifies against the user's known_hosts file.
    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        russh_keys::known_hosts::check_known_hosts(
            &self.host,
            self.port,
            server_public_key,
        )
        .map_err(|_| russh::Error::UnknownKey)
    }
}