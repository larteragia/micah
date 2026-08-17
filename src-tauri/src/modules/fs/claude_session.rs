//! Offset-based tail of a Claude Code session transcript (JSONL) for the
//! Ai Viewer. The transcript grows to many MB; rereading it per poll is not
//! acceptable, so the frontend keeps the offset and only new bytes cross IPC.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::modules::pty::agent_detect::is_uuid;

/// Per-poll ceiling; a session mid-burst catches up over a few polls.
const MAX_CHUNK: u64 = 256 * 1024;
/// How far back the first poll looks. The frontend drops the leading
/// partial line, so starting mid-file is safe.
const FIRST_POLL_BACK: u64 = 256 * 1024;

#[derive(Serialize)]
pub struct SessionTail {
    pub found: bool,
    pub data: String,
    pub next_offset: u64,
    pub has_more: bool,
    /// True when this response did not start at byte 0, so the first line
    /// in `data` may be a fragment.
    pub clipped: bool,
}

fn empty_tail(found: bool) -> SessionTail {
    SessionTail {
        found,
        data: String::new(),
        next_offset: 0,
        has_more: false,
        clipped: false,
    }
}

/// `<root>/<project-dir>/<session>.jsonl`, one directory level deep, exactly
/// how the harness lays transcripts out. `session` is already uuid-gated, so
/// the only path components not from `read_dir` are fixed.
fn find_session_file(root: &Path, session: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let candidate = entry.path().join(format!("{session}.jsonl"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Longest prefix that is complete UTF-8. A chunk boundary can split a
/// multi-byte char; only a truncated tail is deferred to the next poll.
/// Genuinely invalid bytes are consumed lossily so the offset always moves.
fn take_utf8(buf: Vec<u8>) -> (String, usize) {
    match String::from_utf8(buf) {
        Ok(s) => {
            let len = s.len();
            (s, len)
        }
        Err(e) => {
            let buf = e.into_bytes();
            match std::str::from_utf8(&buf) {
                Err(e) if e.error_len().is_none() && e.valid_up_to() > 0 => {
                    let valid = e.valid_up_to();
                    (
                        String::from_utf8_lossy(&buf[..valid]).into_owned(),
                        valid,
                    )
                }
                _ => {
                    let len = buf.len();
                    (String::from_utf8_lossy(&buf).into_owned(), len)
                }
            }
        }
    }
}

fn tail_file(path: &Path, offset: Option<u64>) -> Result<SessionTail, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let start = match offset {
        // A shrunk file means the transcript was replaced; start over.
        Some(o) if o <= len => o,
        Some(_) => 0,
        None => len.saturating_sub(FIRST_POLL_BACK),
    };
    let take = (len - start).min(MAX_CHUNK) as usize;
    if take == 0 {
        return Ok(SessionTail {
            found: true,
            data: String::new(),
            next_offset: start,
            has_more: false,
            clipped: false,
        });
    }
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; take];
    file.read_exact(&mut buf).map_err(|e| e.to_string())?;
    let (data, consumed) = take_utf8(buf);
    let next_offset = start + consumed as u64;
    Ok(SessionTail {
        found: true,
        data,
        next_offset,
        has_more: next_offset < len,
        clipped: start > 0,
    })
}

/// Transcript roots to probe, in order. The default CLI writes to
/// ~/.claude/projects; wrapper configs (the micah alias sets
/// CLAUDE_CONFIG_DIR to ~/.claude-micah) write their own tree, and the mind
/// must follow sessions launched either way on the same machine.
fn transcript_roots(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".claude").join("projects"),
        home.join(".claude-micah").join("projects"),
    ]
}

fn find_session_in_roots(roots: &[PathBuf], session: &str) -> Option<PathBuf> {
    for root in roots {
        if let Some(path) = find_session_file(root, session) {
            return Some(path);
        }
    }
    None
}

#[tauri::command]
pub async fn claude_session_tail(
    session_id: String,
    offset: Option<u64>,
) -> Result<SessionTail, String> {
    if !is_uuid(&session_id) {
        return Err("invalid session id".into());
    }
    let roots = match dirs::home_dir() {
        Some(home) => transcript_roots(&home),
        None => return Ok(empty_tail(false)),
    };
    match find_session_in_roots(&roots, &session_id.to_lowercase()) {
        Some(path) => tail_file(&path, offset),
        None => Ok(empty_tail(false)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_session(root: &Path, project: &str, session: &str, body: &[u8]) -> PathBuf {
        let dir = root.join(project);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{session}.jsonl"));
        let mut f = File::create(&path).unwrap();
        f.write_all(body).unwrap();
        path
    }

    const SESSION: &str = "3f8a1c2e-9b4d-4f6a-8e2c-1a5d7b9c0e42";

    #[test]
    fn finds_the_session_one_level_deep() {
        let tmp = tempfile::tempdir().unwrap();
        let path = write_session(tmp.path(), "C--proj", SESSION, b"{}\n");
        assert_eq!(find_session_file(tmp.path(), SESSION), Some(path));
        assert_eq!(find_session_file(tmp.path(), "0000-missing"), None);
    }

    #[test]
    fn falls_through_to_the_second_root() {
        let primary = tempfile::tempdir().unwrap();
        let secondary = tempfile::tempdir().unwrap();
        let path = write_session(secondary.path(), "C--proj", SESSION, b"{}\n");
        let roots = vec![primary.path().to_path_buf(), secondary.path().to_path_buf()];
        assert_eq!(find_session_in_roots(&roots, SESSION), Some(path));
        // the primary root still wins when both hold the id
        let first = write_session(primary.path(), "C--proj", SESSION, b"{}\n");
        assert_eq!(find_session_in_roots(&roots, SESSION), Some(first));
    }

    #[test]
    fn first_poll_reads_from_the_start_of_a_small_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = write_session(tmp.path(), "p", SESSION, b"{\"a\":1}\n");
        let t = tail_file(&path, None).unwrap();
        assert_eq!(t.data, "{\"a\":1}\n");
        assert_eq!(t.next_offset, 8);
        assert!(!t.has_more);
        assert!(!t.clipped);
    }

    #[test]
    fn continuation_returns_only_new_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let path = write_session(tmp.path(), "p", SESSION, b"line1\n");
        let first = tail_file(&path, None).unwrap();
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"line2\n")
            .unwrap();
        let second = tail_file(&path, Some(first.next_offset)).unwrap();
        assert_eq!(second.data, "line2\n");
        assert_eq!(second.next_offset, 12);
    }

    #[test]
    fn offset_beyond_len_restarts_from_zero() {
        let tmp = tempfile::tempdir().unwrap();
        let path = write_session(tmp.path(), "p", SESSION, b"ab\n");
        let t = tail_file(&path, Some(999)).unwrap();
        assert_eq!(t.data, "ab\n");
        assert_eq!(t.next_offset, 3);
    }

    #[test]
    fn large_file_first_poll_is_clipped_and_capped() {
        let tmp = tempfile::tempdir().unwrap();
        let mut body = Vec::new();
        while body.len() < (FIRST_POLL_BACK as usize) * 2 {
            body.extend_from_slice(b"{\"pad\":\"xxxxxxxxxxxxxxxx\"}\n");
        }
        let path = write_session(tmp.path(), "p", SESSION, &body);
        let t = tail_file(&path, None).unwrap();
        assert!(t.clipped);
        assert!(t.data.len() as u64 <= MAX_CHUNK);
        assert_eq!(t.next_offset, body.len() as u64);
        assert!(!t.has_more);
    }

    #[test]
    fn multibyte_char_split_at_chunk_edge_is_deferred_not_mangled() {
        // "é" is two bytes; hand take_utf8 a buffer cut inside it.
        let text = "abc\u{e9}";
        let bytes = text.as_bytes();
        let (data, consumed) = take_utf8(bytes[..bytes.len() - 1].to_vec());
        assert_eq!(data, "abc");
        assert_eq!(consumed, 3);
        let (rest, _) = take_utf8(bytes[consumed..].to_vec());
        assert_eq!(rest, "\u{e9}");
    }

    #[test]
    fn invalid_bytes_are_consumed_lossily_so_the_offset_advances() {
        let (data, consumed) = take_utf8(vec![0xff, 0xfe, b'o', b'k']);
        assert_eq!(consumed, 4);
        assert!(data.ends_with("ok"));
    }
}
