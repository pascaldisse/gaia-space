//! Chat link extraction and unfurling (KB §04 §1.3 "link unfurling").
//!
//! Two separate acts, deliberately:
//!   * **extraction** happens at write time and is pure string work — the URLs a message
//!     carries become rows (`message_links`) so history paging never re-parses text and an
//!     edit is a diff, not a wipe;
//!   * **unfurling** is an outbound fetch and therefore never happens on a read path. It is
//!     requested explicitly, runs server-side only, and every hop is re-validated against
//!     the same SSRF guard the signed application dispatcher uses
//!     (`payload_dispatch::guard_endpoint_with`) instead of a second, weaker copy.
//!
//! The fetched metadata is stored on the message's own link row — not in a global
//! `url → preview` cache. A global cache is a cross-channel oracle: anyone could ask for a
//! URL and learn from a cache hit that some private channel had discussed it. Per-message
//! storage means a preview is reachable only through the channel ACL of its message.
//! Nothing external is stored or re-served: no image/thumbnail URL, text only.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

type Result<T> = std::result::Result<T, String>;

/// Links unfurled per message. A wall of links is a spam vector against the outbound
/// fetcher, so only the first few of a message are ever tracked.
pub const MAX_LINKS_PER_MESSAGE: usize = 5;
/// Longer than this is not a link anyone typed; it is a payload.
pub const MAX_URL_BYTES: usize = 2048;
/// Response body actually parsed. Metadata lives in `<head>`; anything past this is
/// page content we do not want and must not buffer.
pub const MAX_BODY_BYTES: u64 = 256 * 1024;
/// Redirect hops followed — each one re-guarded, because a public URL that 302s to
/// 169.254.169.254 is the classic SSRF.
pub const MAX_REDIRECTS: usize = 3;
pub const FETCH_TIMEOUT_SECS: u64 = 5;
/// Env switch: let the unfurler reach a loopback/private/link-local address. Off by
/// default; separate from the app-dispatch switch, because opening one must not silently
/// open the other.
pub const ALLOW_PRIVATE_UNFURL_ENV: &str = "GAIA_SPACE_UNFURL_ALLOW_PRIVATE";
const MAX_TITLE_CHARS: usize = 200;
const MAX_DESCRIPTION_CHARS: usize = 500;

/// One extracted link with whatever unfurling learned about it.
/// `status`: `pending` (never fetched) · `ok` · `refused` (policy said no — do not retry)
/// · `failed` (transport/parse said no).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MessageLink {
    pub url: String,
    pub position: i64,
    pub status: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
    pub error: Option<String>,
    pub fetched_at: Option<i64>,
}

/// What a transport returned. Injected in tests so link policy is exercised without a
/// socket, and so the parser is testable apart from the network.
pub struct FetchedDoc {
    pub content_type: String,
    pub body: String,
}

/// Extract the http(s) URLs of a message body, in text order, de-duplicated, capped.
///
/// Hand-rolled rather than regex-with-lookaround: a URL ends at whitespace or one of the
/// characters that only ever wrap a link in prose, and trailing sentence punctuation is
/// peeled off (`see https://x.example/a.` → the link is not `…/a.`). A closing bracket is
/// kept only if the URL itself opened one, so `(https://x.example/a_(b))` survives.
pub fn extract_urls(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        let rest = &text[i..];
        let start = match rest.find("http") {
            Some(p) => i + p,
            None => break,
        };
        let tail = &text[start..];
        let scheme_len = if tail.starts_with("https://") {
            8
        } else if tail.starts_with("http://") {
            7
        } else {
            i = start + 4;
            continue;
        };
        // A URL must not begin mid-word: `xhttp://` is not a link.
        if start > 0 && !text[..start].ends_with(|c: char| c.is_whitespace() || "(<[\"'".contains(c))
        {
            i = start + scheme_len;
            continue;
        }
        let end = tail
            .find(|c: char| c.is_whitespace() || "<>\"'`".contains(c))
            .map(|p| start + p)
            .unwrap_or(text.len());
        let mut candidate = &text[start..end];
        candidate = trim_trailing_punctuation(candidate);
        i = end.max(start + scheme_len);
        if candidate.len() <= scheme_len || candidate.len() > MAX_URL_BYTES {
            continue;
        }
        let candidate = candidate.to_string();
        if out.contains(&candidate) {
            continue;
        }
        out.push(candidate);
        if out.len() == MAX_LINKS_PER_MESSAGE {
            break;
        }
    }
    out
}

fn trim_trailing_punctuation(mut s: &str) -> &str {
    loop {
        let trimmed = s.trim_end_matches(['.', ',', ';', ':', '!', '?']);
        // An unbalanced closer was prose wrapping the link, not part of it.
        let unbalanced = [('(', ')'), ('[', ']')].iter().any(|(open, close)| {
            trimmed.ends_with(*close)
                && trimmed.matches(*open).count() < trimmed.matches(*close).count()
        });
        let trimmed = if unbalanced {
            &trimmed[..trimmed.len() - 1]
        } else {
            trimmed
        };
        if trimmed == s {
            return s;
        }
        s = trimmed;
    }
}

/// Set the link rows of a message to exactly what its text carries now. A URL that
/// survives an edit keeps its fetched preview (position may shift); a URL that leaves
/// takes its preview with it. Never re-fetches — that is `unfurl_message_links`' job.
pub(crate) fn sync_links_on(c: &Connection, message_id: &str, text: &str) -> Result<()> {
    let wanted = extract_urls(text);
    let existing = links_for(c, message_id)?;
    for stale in existing.iter().filter(|l| !wanted.contains(&l.url)) {
        c.execute(
            "DELETE FROM message_links WHERE message_id=?1 AND url=?2",
            rusqlite::params![message_id, stale.url],
        )
        .map_err(|e| e.to_string())?;
    }
    for (position, url) in wanted.iter().enumerate() {
        let position = position as i64;
        match existing.iter().find(|l| &l.url == url) {
            Some(kept) if kept.position != position => {
                c.execute(
                    "UPDATE message_links SET position=?3 WHERE message_id=?1 AND url=?2",
                    rusqlite::params![message_id, url, position],
                )
                .map_err(|e| e.to_string())?;
            }
            Some(_) => {}
            None => {
                c.execute(
                    "INSERT INTO message_links(message_id,position,url,status) VALUES(?1,?2,?3,'pending')",
                    rusqlite::params![message_id, position, url],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

pub(crate) fn links_for(c: &Connection, message_id: &str) -> Result<Vec<MessageLink>> {
    let mut s = c
        .prepare(
            "SELECT url,position,status,title,description,site_name,error,fetched_at \
             FROM message_links WHERE message_id=?1 ORDER BY position",
        )
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([message_id], |r| {
            Ok(MessageLink {
                url: r.get(0)?,
                position: r.get(1)?,
                status: r.get(2)?,
                title: r.get(3)?,
                description: r.get(4)?,
                site_name: r.get(5)?,
                error: r.get(6)?,
                fetched_at: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Unfurl every not-yet-fetched link of a message with the given transport, writing the
/// outcome (including refusals) so a read never triggers network work and a refused URL
/// is not retried on every open.
pub(crate) fn unfurl_links_with(
    c: &Connection,
    message_id: &str,
    fetch: &dyn Fn(&str) -> Result<FetchedDoc>,
) -> Result<Vec<MessageLink>> {
    for link in links_for(c, message_id)?
        .into_iter()
        .filter(|l| l.status == "pending")
    {
        let (status, preview, error) = match fetch(&link.url) {
            Ok(doc) => match parse_preview(&doc) {
                Ok(preview) => ("ok", Some(preview), None),
                Err(e) => ("refused", None, Some(e)),
            },
            Err(e) => {
                // A policy refusal is terminal; a transport failure is also recorded
                // terminal here rather than left pending, so one dead host cannot make
                // every subsequent unfurl request re-dial it.
                let status = if e.starts_with("refused:") {
                    "refused"
                } else {
                    "failed"
                };
                (status, None, Some(e))
            }
        };
        let preview = preview.unwrap_or_default();
        c.execute(
            "UPDATE message_links SET status=?3,title=?4,description=?5,site_name=?6,error=?7,fetched_at=unixepoch() \
             WHERE message_id=?1 AND url=?2",
            rusqlite::params![
                message_id,
                link.url,
                status,
                preview.title,
                preview.description,
                preview.site_name,
                error
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    links_for(c, message_id)
}

#[derive(Default, Debug, PartialEq, Eq)]
pub struct Preview {
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
}

/// Read OpenGraph/`<title>` metadata out of an HTML document as **plain text**: tags are
/// dropped, a small set of entities decoded, everything else left literal. Nothing here
/// can ever produce markup for the client, so an unfurled page cannot inject anything
/// into a channel it was merely linked in.
pub fn parse_preview(doc: &FetchedDoc) -> Result<Preview> {
    let kind = doc
        .content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if kind != "text/html" && kind != "application/xhtml+xml" && kind != "text/plain" {
        return Err(format!("refused: content type {kind} is not unfurlable"));
    }
    if kind == "text/plain" {
        let title = clean(doc.body.lines().next().unwrap_or(""), MAX_TITLE_CHARS);
        return Ok(Preview {
            title,
            ..Preview::default()
        });
    }
    let head = &doc.body[..doc.body.len().min(MAX_BODY_BYTES as usize)];
    let mut preview = Preview {
        title: meta_content(head, "og:title").and_then(|v| clean(&v, MAX_TITLE_CHARS)),
        description: meta_content(head, "og:description")
            .or_else(|| meta_content(head, "description"))
            .and_then(|v| clean(&v, MAX_DESCRIPTION_CHARS)),
        site_name: meta_content(head, "og:site_name").and_then(|v| clean(&v, MAX_TITLE_CHARS)),
    };
    if preview.title.is_none() {
        preview.title = title_tag(head).and_then(|v| clean(&v, MAX_TITLE_CHARS));
    }
    Ok(preview)
}

fn clean(raw: &str, max_chars: usize) -> Option<String> {
    let decoded = decode_entities(raw);
    let flattened: String = decoded
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let collapsed = flattened.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }
    Some(collapsed.chars().take(max_chars).collect())
}

fn decode_entities(raw: &str) -> String {
    raw.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

/// `<meta property="og:title" content="…">` in either attribute order, `property` or
/// `name`, single or double quotes.
fn meta_content(html: &str, key: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(open) = lower[cursor..].find("<meta") {
        let start = cursor + open;
        let end = lower[start..].find('>').map(|p| start + p)? + 1;
        let tag = &html[start..end];
        let tag_lower = &lower[start..end];
        cursor = end;
        let names = [
            attribute(tag, tag_lower, "property"),
            attribute(tag, tag_lower, "name"),
        ];
        if names
            .iter()
            .flatten()
            .any(|n| n.eq_ignore_ascii_case(key))
        {
            if let Some(content) = attribute(tag, tag_lower, "content") {
                return Some(content);
            }
        }
    }
    None
}

fn attribute(tag: &str, tag_lower: &str, name: &str) -> Option<String> {
    let at = tag_lower.find(&format!("{name}="))? + name.len() + 1;
    let rest = &tag[at..];
    let quote = rest.chars().next()?;
    if quote == '"' || quote == '\'' {
        let close = rest[1..].find(quote)? + 1;
        Some(rest[1..close].to_string())
    } else {
        let close = rest
            .find(|c: char| c.is_whitespace() || c == '>')
            .unwrap_or(rest.len());
        Some(rest[..close].to_string())
    }
}

fn title_tag(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let open = lower.find("<title")?;
    let text_start = open + lower[open..].find('>')? + 1;
    let close = lower[text_start..].find("</title>")? + text_start;
    Some(html[text_start..close].to_string())
}

/// The real transport. Redirects are followed by hand so that **every** hop passes the
/// SSRF guard: `reqwest`'s own follow policy would only ever have judged the first URL.
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub(crate) fn fetch_url(url: &str) -> Result<FetchedDoc> {
    use std::io::Read;
    let allow_private = std::env::var(ALLOW_PRIVATE_UNFURL_ENV)
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(FETCH_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("unfurl client: {e}"))?;
    let mut target = url.to_string();
    for _ in 0..=MAX_REDIRECTS {
        // No body is sent, so plaintext http carries no secret: the guard's plaintext
        // switch is opened deliberately here, its address rules are not.
        crate::payload_dispatch::guard_endpoint_with(&target, "", allow_private, true)
            .map_err(|e| format!("refused: {e}"))?;
        let response = client
            .get(&target)
            .header("accept", "text/html,application/xhtml+xml,text/plain")
            .header("user-agent", "gaia-space-unfurl/1.0")
            .send()
            .map_err(|e| format!("unfurl fetch failed: {e}"))?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "unfurl redirect without a location".to_string())?;
            // Relative redirects are resolved against the hop we actually made.
            target = reqwest::Url::parse(&target)
                .map_err(|e| format!("refused: {e}"))?
                .join(location)
                .map_err(|e| format!("refused: bad redirect target: {e}"))?
                .to_string();
            continue;
        }
        if !response.status().is_success() {
            return Err(format!("unfurl fetch returned {}", response.status()));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let mut buf = Vec::new();
        response
            .take(MAX_BODY_BYTES)
            .read_to_end(&mut buf)
            .map_err(|e| format!("unfurl read failed: {e}"))?;
        let body = String::from_utf8_lossy(&buf).to_string();
        return Ok(FetchedDoc { content_type, body });
    }
    Err("refused: too many redirects".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_are_extracted_in_order_deduplicated_and_capped() {
        let text = "see https://a.example/x and https://a.example/x, then http://b.example.";
        assert_eq!(
            extract_urls(text),
            vec![
                "https://a.example/x".to_string(),
                "http://b.example".to_string()
            ]
        );
        let many = (0..10)
            .map(|i| format!("https://x{i}.example"))
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(extract_urls(&many).len(), MAX_LINKS_PER_MESSAGE);
    }

    #[test]
    fn a_wrapping_paren_is_not_part_of_the_link_but_an_inner_one_is() {
        assert_eq!(
            extract_urls("(https://a.example/a_(b))"),
            vec!["https://a.example/a_(b)".to_string()]
        );
        assert_eq!(
            extract_urls("nothing here: xhttps://a.example"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn preview_is_plain_text_from_opengraph_with_a_title_fallback() {
        let doc = FetchedDoc {
            content_type: "text/html; charset=utf-8".into(),
            body: "<html><head><title>Fallback</title>\
                   <meta property='og:title' content='Real &amp; True'>\
                   <meta name=\"description\" content=\"a  page\">\
                   <meta property='og:site_name' content='Example'></head></html>"
                .into(),
        };
        let preview = parse_preview(&doc).unwrap();
        assert_eq!(preview.title.as_deref(), Some("Real & True"));
        assert_eq!(preview.description.as_deref(), Some("a page"));
        assert_eq!(preview.site_name.as_deref(), Some("Example"));

        let only_title = FetchedDoc {
            content_type: "text/html".into(),
            body: "<html><head><title>Just This</title></head></html>".into(),
        };
        assert_eq!(
            parse_preview(&only_title).unwrap().title.as_deref(),
            Some("Just This")
        );
    }

    #[test]
    fn a_non_document_content_type_is_refused_not_parsed() {
        let doc = FetchedDoc {
            content_type: "image/png".into(),
            body: "\u{0}\u{1}binary".into(),
        };
        assert!(parse_preview(&doc).unwrap_err().starts_with("refused:"));
    }

    #[test]
    fn markup_in_metadata_never_survives_as_markup() {
        let doc = FetchedDoc {
            content_type: "text/html".into(),
            body: "<html><head><meta property='og:title' content='&lt;script&gt;x&lt;/script&gt;'></head></html>".into(),
        };
        let title = parse_preview(&doc).unwrap().title.unwrap();
        // Decoded to text, and it is text the client renders — never re-serialized HTML.
        assert_eq!(title, "<script>x</script>");
    }
}
