//! OpenAI-compatible chat-completions client (roadmap.md, Stage 1).
//!
//! One wire format covers OpenAI, gateways, Ollama and vLLM; the only per-deployment
//! difference is the base URL stored beside the key. Like `payload_dispatch.rs`, the
//! HTTP call is an injected [`Transport`] so tests script every reply and never touch
//! a socket.
//!
//! Two rules this module exists to keep:
//!
//! - The key is decrypted at call time ([`provider_for_key_in`]) and never logged.
//!   `Provider` and `ResolvedKey` print `<redacted>` in their `Debug`.
//! - A non-2xx response is an error bound for the caller, not a truncated body
//!   silently parsed as an empty answer.

use crate::agent::keys;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

type Result<T> = std::result::Result<T, String>;

/// Where a key without a `base_url` points. Anything else — a gateway, Ollama, vLLM —
/// must say so when the key is saved.
pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
/// The path every OpenAI-compatible endpoint serves.
pub const CHAT_PATH: &str = "/chat/completions";
/// A completion with a full transcript is slower than a webhook; but a hung connection
/// must not hold a session forever.
pub const CALL_TIMEOUT_SECS: u64 = 120;
/// How much of a provider's error body is worth showing. It is the provider's text, not
/// ours, so it is capped rather than trusted.
const ERROR_BODY_MAX: usize = 500;

/// One outbound call: `(url, headers, body) -> (status, body)`.
pub(crate) type Transport = fn(&str, &[(String, String)], &str) -> Result<(i64, String)>;

/// `role` is `system` | `user` | `assistant` | `tool`, exactly as the wire spells them.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Message {
    pub role: String,
    /// Absent on a pure tool-call turn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    /// Set on a `tool` message: which call this is the result of.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

impl Message {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".into(),
            content: Some(content.into()),
            tool_calls: None,
            tool_call_id: None,
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".into(),
            content: Some(content.into()),
            tool_calls: None,
            tool_call_id: None,
        }
    }

    /// A model turn: text, tool calls, or both.
    pub fn assistant(content: Option<String>, tool_calls: Option<Vec<ToolCall>>) -> Self {
        Self {
            role: "assistant".into(),
            content,
            tool_calls,
            tool_call_id: None,
        }
    }

    pub fn tool(call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: "tool".into(),
            content: Some(content.into()),
            tool_calls: None,
            tool_call_id: Some(call_id.into()),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ToolCall {
    pub id: String,
    /// Always `function` today; kept because the wire requires the field.
    #[serde(rename = "type", default = "function_type")]
    pub kind: String,
    pub function: FunctionCall,
}

fn function_type() -> String {
    "function".into()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct FunctionCall {
    pub name: String,
    /// The arguments are a JSON *string* on the wire, not an object — kept verbatim so
    /// a malformed call is reported against the model's own output.
    pub arguments: String,
}

impl FunctionCall {
    /// Parse the arguments into the object the tool will be given.
    pub fn args(&self) -> Result<Value> {
        let value: Value = serde_json::from_str(&self.arguments)
            .map_err(|e| format!("tool call {} has invalid arguments: {e}", self.name))?;
        if !value.is_object() {
            return Err(format!("tool call {} arguments must be a JSON object", self.name));
        }
        Ok(value)
    }
}

/// The tool declaration the model sees: a JSON Schema per tool.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ToolSchema {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub function: FunctionSchema,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct FunctionSchema {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

impl ToolSchema {
    pub fn function(name: impl Into<String>, description: impl Into<String>, parameters: Value) -> Self {
        Self {
            kind: "function",
            function: FunctionSchema {
                name: name.into(),
                description: description.into(),
                parameters,
            },
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<Message>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<ToolSchema>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
}

impl ChatRequest {
    pub fn new(model: impl Into<String>, messages: Vec<Message>) -> Self {
        Self {
            model: model.into(),
            messages,
            tools: Vec::new(),
            temperature: None,
        }
    }

    pub fn with_tools(mut self, tools: Vec<ToolSchema>) -> Self {
        self.tools = tools;
        self
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ChatResponse {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub choices: Vec<Choice>,
    #[serde(default)]
    pub usage: Option<Usage>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Choice {
    #[serde(default)]
    pub index: u32,
    pub message: Message,
    #[serde(default)]
    pub finish_reason: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct Usage {
    #[serde(default)]
    pub prompt_tokens: u64,
    #[serde(default)]
    pub completion_tokens: u64,
    #[serde(default)]
    pub total_tokens: u64,
}

impl ChatResponse {
    /// The one answer we ask for. `choices: []` is a protocol violation, not an empty
    /// reply, so it is reported rather than turned into silence.
    pub fn reply(&self) -> Result<&Choice> {
        let choice = self
            .choices
            .first()
            .ok_or_else(|| "provider returned no choices".to_string())?;
        if choice.index != 0 {
            return Err(format!(
                "provider returned choice {} first; only a single completion is requested",
                choice.index
            ));
        }
        Ok(choice)
    }
}

pub struct Provider {
    base_url: String,
    api_key: String,
    transport: Transport,
}

/// Never print the key, whatever a caller does with a `Provider`.
impl std::fmt::Debug for Provider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Provider")
            .field("base_url", &self.base_url)
            .field("api_key", &"<redacted>")
            .finish()
    }
}

impl Provider {
    /// The real network client. `base_url: None` means OpenAI itself.
    pub fn new(api_key: impl Into<String>, base_url: Option<impl Into<String>>) -> Self {
        Self::with_transport(api_key, base_url, post_json)
    }

    pub fn with_transport(
        api_key: impl Into<String>,
        base_url: Option<impl Into<String>>,
        transport: Transport,
    ) -> Self {
        let base_url = base_url
            .map(Into::into)
            .map(|url| url.trim().trim_end_matches('/').to_string())
            .filter(|url| !url.is_empty())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
        Self {
            base_url,
            api_key: api_key.into(),
            transport,
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// A base URL may be stored with or without the endpoint path; both are accepted,
    /// because people paste whichever their gateway documents.
    pub fn endpoint(&self) -> String {
        if self.base_url.ends_with(CHAT_PATH) {
            self.base_url.clone()
        } else {
            format!("{}{CHAT_PATH}", self.base_url)
        }
    }

    pub fn complete(&self, request: &ChatRequest) -> Result<ChatResponse> {
        let body = serde_json::to_string(request).map_err(|e| e.to_string())?;
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            (
                "authorization".to_string(),
                format!("Bearer {}", self.api_key),
            ),
        ];
        let (status, text) = (self.transport)(&self.endpoint(), &headers, &body)?;
        if !(200..300).contains(&status) {
            let detail = text.trim();
            let detail = if detail.len() > ERROR_BODY_MAX {
                format!("{}…", &detail[..floor_char_boundary(detail, ERROR_BODY_MAX)])
            } else {
                detail.to_string()
            };
            return Err(if detail.is_empty() {
                format!("provider returned HTTP {status}")
            } else {
                format!("provider returned HTTP {status}: {detail}")
            });
        }
        serde_json::from_str(&text)
            .map_err(|e| format!("provider response is not a chat completion: {e}"))
    }
}

/// Build a provider for one call by decrypting the stored key. The plaintext exists
/// only for the life of this `Provider`, which is dropped when the call returns.
pub fn provider_for_key_in(c: &Connection, key_id: &str, transport: Transport) -> Result<Provider> {
    let resolved = keys::resolve_key_in(c, key_id)?;
    Ok(Provider::with_transport(
        resolved.key,
        resolved.base_url,
        transport,
    ))
}

/// `str::floor_char_boundary` is still unstable; a byte cut inside a multi-byte
/// character would panic in the error path, which is the worst place to panic.
fn floor_char_boundary(text: &str, index: usize) -> usize {
    if index >= text.len() {
        return text.len();
    }
    let mut cut = index;
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    cut
}

fn post_json(
    url: &str,
    headers: &[(String, String)],
    body: &str,
) -> Result<(i64, String)> {
    let mut request = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(CALL_TIMEOUT_SECS))
        // No redirects: a 30x must never carry the Authorization header to another host.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?
        .post(url);
    for (name, value) in headers {
        request = request.header(name.as_str(), value.as_str());
    }
    let response = request.body(body.to_string()).send().map_err(|e| e.to_string())?;
    let status = i64::from(response.status().as_u16());
    let text = response.text().map_err(|e| e.to_string())?;
    Ok((status, text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;

    /// One recorded call. The transport is a `fn` pointer, so the capture is a global
    /// and these tests hold `SERIAL` to keep it from crossing another test's call.
    struct Recorded {
        url: String,
        headers: Vec<(String, String)>,
        body: Value,
    }

    static SERIAL: Mutex<()> = Mutex::new(());
    static LAST: Mutex<Option<Recorded>> = Mutex::new(None);
    static REPLY: Mutex<(i64, String)> = Mutex::new((200, String::new()));

    fn scripted(status: i64, body: &str) -> Transport {
        *REPLY.lock().unwrap_or_else(|e| e.into_inner()) = (status, body.to_string());
        fn transport(url: &str, headers: &[(String, String)], body: &str) -> Result<(i64, String)> {
            let body: Value = serde_json::from_str(body).expect("the request body is JSON");
            *LAST.lock().unwrap_or_else(|e| e.into_inner()) = Some(Recorded {
                url: url.to_string(),
                headers: headers.to_vec(),
                body,
            });
            Ok(REPLY
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone())
        }
        transport
    }

    fn last() -> Recorded {
        LAST.lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
            .expect("the transport was called")
    }

    const TOOL_REPLY: &str = r#"{
      "id": "chatcmpl-1",
      "object": "chat.completion",
      "model": "gpt-test",
      "choices": [{
        "index": 0,
        "message": {
          "role": "assistant",
          "content": null,
          "tool_calls": [{
            "id": "call_1",
            "type": "function",
            "function": {"name": "read_file", "arguments": "{\"path\":\"README.md\"}"}
          }]
        },
        "finish_reason": "tool_calls"
      }],
      "usage": {"prompt_tokens": 42, "completion_tokens": 7, "total_tokens": 49}
    }"#;

    #[test]
    fn the_request_is_openai_chat_completions_with_bearer_auth_and_tool_schemas() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let provider = Provider::with_transport(
            "sk-test-secret",
            Some("https://gateway.example.test/v1/"),
            scripted(200, TOOL_REPLY),
        );
        let request = ChatRequest::new(
            "gpt-test",
            vec![
                Message::system("You are a coding agent."),
                Message::user("What is in the README?"),
            ],
        )
        .with_tools(vec![ToolSchema::function(
            "read_file",
            "Read one file from the repository.",
            json!({
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
                "additionalProperties": false
            }),
        )]);

        let response = provider.complete(&request).expect("parsed reply");
        let sent = last();

        assert_eq!(
            sent.url, "https://gateway.example.test/v1/chat/completions",
            "the stored base URL is honoured and the trailing slash normalized"
        );
        let header = |name: &str| {
            sent.headers
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.as_str())
        };
        assert_eq!(header("content-type"), Some("application/json"));
        assert_eq!(header("authorization"), Some("Bearer sk-test-secret"));

        assert_eq!(sent.body["model"], "gpt-test");
        assert_eq!(sent.body["messages"][0]["role"], "system");
        assert_eq!(sent.body["messages"][1]["content"], "What is in the README?");
        assert_eq!(sent.body["tools"][0]["type"], "function");
        assert_eq!(sent.body["tools"][0]["function"]["name"], "read_file");
        assert_eq!(sent.body["tools"][0]["function"]["parameters"]["type"], "object");
        assert_eq!(
            sent.body["tools"][0]["function"]["parameters"]["required"][0],
            "path"
        );
        assert!(
            sent.body.get("temperature").is_none(),
            "an unset temperature is omitted, not sent as null"
        );

        // The reply is parsed, not re-serialized: tool calls survive the round trip.
        assert_eq!(response.reply().unwrap().finish_reason.as_deref(), Some("tool_calls"));
        let call = &response.choices[0].message.tool_calls.as_ref().unwrap()[0];
        assert_eq!((call.id.as_str(), call.function.name.as_str()), ("call_1", "read_file"));
        assert_eq!(call.function.args().unwrap()["path"], "README.md");
        assert_eq!(
            response.usage,
            Some(Usage { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 })
        );
    }

    #[test]
    fn a_text_answer_parses_and_absent_usage_is_not_an_error() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let provider = Provider::with_transport(
            "k",
            None::<String>,
            scripted(
                200,
                r#"{"model":"m","choices":[{"index":0,"message":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}"#,
            ),
        );
        assert_eq!(provider.base_url(), DEFAULT_BASE_URL);
        let response = provider
            .complete(&ChatRequest::new("m", vec![Message::user("hi")]))
            .unwrap();
        let choice = response.reply().unwrap();
        assert_eq!(choice.message.content.as_deref(), Some("done"));
        assert_eq!(choice.finish_reason.as_deref(), Some("stop"));
        assert_eq!(response.usage, None);
        assert!(response.id.is_empty());
    }

    #[test]
    fn a_full_endpoint_url_is_not_given_the_path_twice() {
        let provider = Provider::with_transport(
            "k",
            Some("https://api.example.test/v1/chat/completions"),
            post_json_stub,
        );
        assert_eq!(provider.endpoint(), "https://api.example.test/v1/chat/completions");
        assert_eq!(
            Provider::with_transport("k", Some("http://127.0.0.1:11434/v1"), post_json_stub)
                .endpoint(),
            "http://127.0.0.1:11434/v1/chat/completions"
        );
    }

    fn post_json_stub(_: &str, _: &[(String, String)], _: &str) -> Result<(i64, String)> {
        Err("not called".into())
    }

    #[test]
    fn an_http_error_is_reported_and_never_echoes_the_key_it_was_given() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let provider = Provider::with_transport(
            "sk-test-secret",
            None::<String>,
            scripted(401, r#"{"error":{"message":"Incorrect API key provided"}}"#),
        );
        let error = provider
            .complete(&ChatRequest::new("m", vec![Message::user("hi")]))
            .unwrap_err();
        assert!(error.contains("401"), "{error}");
        assert!(error.contains("Incorrect API key"), "{error}");
        assert!(
            !error.contains("sk-test-secret"),
            "a provider error must not include the key we sent: {error}"
        );
    }

    #[test]
    fn a_body_that_is_not_a_completion_is_an_error_not_a_silent_empty_reply() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let provider = Provider::with_transport("k", None::<String>, scripted(200, "<html>proxy</html>"));
        assert!(provider
            .complete(&ChatRequest::new("m", vec![Message::user("hi")]))
            .is_err());

        let provider = Provider::with_transport("k", None::<String>, scripted(200, r#"{"choices":[]}"#));
        let response = provider
            .complete(&ChatRequest::new("m", vec![Message::user("hi")]))
            .unwrap();
        assert!(response.reply().is_err(), "no choices is a protocol violation");
    }

    #[test]
    fn a_long_error_body_is_capped_without_splitting_a_character() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        // Multi-byte characters straddle the cap; the slice must stay on a boundary.
        let body = format!("x{}", "ä".repeat(ERROR_BODY_MAX));
        let provider = Provider::with_transport("k", None::<String>, scripted(500, &body));
        let error = provider
            .complete(&ChatRequest::new("m", vec![Message::user("hi")]))
            .unwrap_err();
        assert!(error.contains('…'));
        assert!(error.len() < body.len());
    }

    #[test]
    fn tool_arguments_must_be_a_json_object() {
        let call = ToolCall {
            id: "c".into(),
            kind: "function".into(),
            function: FunctionCall {
                name: "read_file".into(),
                arguments: "\"README.md\"".into(),
            },
        };
        assert!(call.function.args().is_err(), "a bare string is not an argument object");
        let call = ToolCall {
            function: FunctionCall {
                name: "read_file".into(),
                arguments: "{not json".into(),
            },
            ..call
        };
        assert!(call.function.args().is_err());
    }

    #[test]
    fn debug_never_prints_the_key() {
        let provider = Provider::with_transport("sk-test-secret", None::<String>, post_json_stub);
        let printed = format!("{provider:?}");
        assert!(!printed.contains("sk-test-secret"), "{printed}");
        assert!(printed.contains("<redacted>"), "{printed}");
    }

    const TEXT_REPLY: &str = r#"{"model":"m","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}"#;

    /// The whole chain Stage 1 promises: a stored, sealed key becomes a provider for the
    /// duration of one call — and the wire carries the *decrypted* key as a Bearer token
    /// against the base URL that was stored with it.
    #[test]
    fn the_key_is_decrypted_at_call_time_and_carries_its_stored_base_url() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let _env = crate::db::test_serial();
        let previous = std::env::var(crate::secretbox::KEY_ENV).ok();
        std::env::set_var(crate::secretbox::KEY_ENV, "77".repeat(32));

        let c = crate::db::open_in_memory().expect("db");
        crate::db::migrate(&c).expect("migrate");
        let stored = keys::save_key_in(
            &c,
            "ollama",
            "Local",
            Some("http://127.0.0.1:11434/v1"),
            "sk-local-secret",
            None,
        )
        .expect("save");

        let provider = provider_for_key_in(&c, &stored.id, scripted(200, TEXT_REPLY)).expect("provider");
        assert!(
            !format!("{provider:?}").contains("sk-local-secret"),
            "the provider must not print the key"
        );
        let response = provider.complete(&ChatRequest::new("llama3", vec![Message::user("hi")]));
        let sent = last();

        match previous {
            Some(value) => std::env::set_var(crate::secretbox::KEY_ENV, value),
            None => std::env::remove_var(crate::secretbox::KEY_ENV),
        }

        assert_eq!(response.unwrap().reply().unwrap().message.content.as_deref(), Some("ok"));
        assert_eq!(sent.url, "http://127.0.0.1:11434/v1/chat/completions");
        assert_eq!(
            sent.headers
                .iter()
                .find(|(name, _)| name == "authorization")
                .map(|(_, value)| value.as_str()),
            Some("Bearer sk-local-secret"),
            "the stored secret is what authenticates the call"
        );
        assert_eq!(sent.body["model"], "llama3");

        assert!(
            provider_for_key_in(&c, "no-such-key", post_json_stub).is_err(),
            "an unknown key id is an error, not a call without authentication"
        );
    }
}
