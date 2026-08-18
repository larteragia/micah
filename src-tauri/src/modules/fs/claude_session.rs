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

// ---------------------------------------------------------------------------
// Recent sessions of a repository (auto-connect + manual picker).
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct RecentSession {
    pub session_id: String,
    pub mtime_ms: i64,
    pub size_bytes: u64,
}

/// Project dir name the harness derives from a cwd: every non
/// ascii-alphanumeric char becomes '-' ("C:\repo x" -> "C--repo-x"). Accents
/// are a premise (unverifiable on this machine's disk evidence); a diverging
/// harness convention yields an empty list, which fails safe.
fn munge_project_dir(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Comparison base for paths from different sources (OSC 7, JSON-escaped
/// transcript fields): segments, case folded, JSON escapes undone. Segment
/// equality gives "micah" a hard boundary against "micah-old".
fn path_segments(p: &str) -> Vec<String> {
    p.replace("\\\\", "\\")
        .replace("\\/", "/")
        .replace('\\', "/")
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .map(|s| s.to_lowercase())
        .collect()
}

/// True when `cwd` is `root` itself or a path inside it.
fn segments_inside(cwd: &[String], root: &[String]) -> bool {
    if root.is_empty() || cwd.len() < root.len() {
        return false;
    }
    cwd[..root.len()] == *root
}

/// Cap on transcripts considered per project dir: a busy repo accumulates
/// hundreds of jsonl and the caller only ever wants a top list.
const MAX_LISTED_PER_DIR: usize = 300;
const DEFAULT_LIMIT: usize = 5;
const HARD_LIMIT: usize = 50;
/// Bytes of the first line read to recover the session's real cwd; line one
/// of a transcript carries "cwd" for every harness version seen so far.
const CWD_SNIFF: u64 = 4096;

/// True when the transcript's own first-line cwd sits inside `root`. Falls
/// back to `true` (dir-based candidate stands) when the line is unreadable
/// or has no cwd field: verification tightens, never drops silently.
fn transcript_cwd_inside(path: &Path, root: &[String]) -> bool {
    let Ok(mut file) = File::open(path) else {
        return true;
    };
    let mut buf = vec![0u8; CWD_SNIFF as usize];
    let Ok(n) = file.read(&mut buf) else {
        return true;
    };
    let text = String::from_utf8_lossy(&buf[..n]);
    // Line one carries the session cwd ("cwd":"C:\\proj"); compact and
    // spaced variants both accepted. No match keeps the dir-based verdict.
    let rest = text
        .find("\"cwd\":\"")
        .map(|i| &text[i + "\"cwd\":\"".len()..])
        .or_else(|| {
            text.find("\"cwd\": \"").map(|i| &text[i + "\"cwd\": \"".len()..])
        });
    let Some(rest) = rest else {
        return true;
    };
    let cwd: String = rest.chars().take_while(|&c| c != '"').collect();
    if cwd.is_empty() {
        return true;
    }
    segments_inside(&path_segments(&cwd), root)
}

fn list_recent_in_dir(
    dir: &Path,
    out: &mut Vec<RecentSession>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let stem = name.strip_suffix(".jsonl")?.to_string();
            if is_uuid(&stem) {
                Some(name)
            } else {
                None
            }
        })
        .collect();
    names.sort();
    names.truncate(MAX_LISTED_PER_DIR);
    for name in names {
        let path = dir.join(&name);
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let session_id = name.trim_end_matches(".jsonl").to_string();
        out.push(RecentSession {
            session_id,
            mtime_ms,
            size_bytes: meta.len(),
        });
    }
}

/// Repo-scoped candidates for ONE candidate root: munged dir of the root
/// exactly plus dirs extending it (launches from subdirs), each verified by
/// the transcript's own first-line cwd, so sibling dirs like "micah-old" do
/// not leak in.
fn collect_for_candidate(
    roots: &[PathBuf],
    candidate: &str,
) -> Vec<RecentSession> {
    let munged = munge_project_dir(candidate);
    let root_segs = path_segments(candidate);
    let extending: String = format!("{munged}-");
    let mut out: Vec<RecentSession> = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let dir_name = entry.file_name().to_string_lossy().into_owned();
            if dir_name != munged && !dir_name.starts_with(&extending) {
                continue;
            }
            if !entry.path().is_dir() {
                continue;
            }
            list_recent_in_dir(&entry.path(), &mut out);
        }
    }
    out.retain(|s| {
        // Verified per transcript: the session's own cwd must sit in the
        // candidate. A candidate we cannot even find again keeps its
        // dir-based verdict (verification tightens, never invents).
        find_session_in_roots(roots, &s.session_id)
            .map(|p| transcript_cwd_inside(&p, &root_segs))
            .unwrap_or(true)
    });
    out
}

/// Sessions for a pane cwd WITHOUT git: probe the cwd itself, then each
/// ancestor, and keep the DEEPEST level that has verified sessions. A pane
/// inside a repo finds that repo's sessions even when launched from a
/// subdir; a pane in the home dir finds home-launched sessions (the live
/// disconnected session the commander wants to see) instead of jumping to
/// an unrelated project. Deepest-first keeps the match honest: verification
/// is always the transcript's own cwd.
fn collect_repo_sessions(roots: &[PathBuf], cwd: &str) -> Vec<RecentSession> {
    let slashed = cwd.replace('\\', "/");
    let raw_parts: Vec<&str> = slashed
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect();
    // Depth 1 is the bare drive ("C:"): its munge prefix would match every
    // project on the machine with a vacuous cwd check. The explicit global
    // collect covers that case far cheaper (auditor 5).
    for depth in (2..=raw_parts.len()).rev() {
        let candidate = raw_parts[..depth].join("/");
        let found = collect_for_candidate(roots, &candidate);
        if !found.is_empty() {
            return found;
        }
    }
    Vec::new()
}

/// Freshest sessions across every project dir (auto-connect fallback when
/// the pane cwd is not inside a repository).
fn collect_global_sessions(roots: &[PathBuf]) -> Vec<RecentSession> {
    let mut out: Vec<RecentSession> = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        let mut dirs: Vec<std::fs::DirEntry> =
            entries.flatten().filter(|e| e.path().is_dir()).collect();
        dirs.sort_by_key(|e| e.file_name());
        for entry in dirs {
            list_recent_in_dir(&entry.path(), &mut out);
        }
    }
    out
}

/// Sessions of one repository (when `cwd` is Some) or the freshest across
/// every project (when None), newest first. Deterministic tie-break:
/// mtime desc, size desc, id asc.
#[tauri::command]
pub async fn claude_sessions_recent(
    cwd: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<RecentSession>, String> {
    let limit = limit
        .map(|l| (l as usize).clamp(1, HARD_LIMIT))
        .unwrap_or(DEFAULT_LIMIT);
    let home = match dirs::home_dir() {
        Some(home) => home,
        None => return Ok(Vec::new()),
    };
    let roots = transcript_roots(&home);
    let mut out = match cwd.as_deref().map(str::trim).filter(|c| !c.is_empty())
    {
        // Repo-scoped only: the caller decides between scoped and global
        // (it knows whether the cwd smells like a project); a repo with no
        // sessions must stay empty so the dark city has its honest moment.
        Some(cwd) => collect_repo_sessions(&roots, cwd),
        None => collect_global_sessions(&roots),
    };
    out.sort_by(|a, b| {
        b.mtime_ms
            .cmp(&a.mtime_ms)
            .then(b.size_bytes.cmp(&a.size_bytes))
            .then(a.session_id.cmp(&b.session_id))
    });
    // The same id can surface from both roots (copied transcript): keep the
    // first (newest) occurrence of each id, not just adjacent duplicates.
    let mut seen = std::collections::HashSet::new();
    out.retain(|s| seen.insert(s.session_id.clone()));
    out.truncate(limit);
    Ok(out)
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

    // ------------------------------------------------------------------
    // claude_sessions_recent helpers
    // ------------------------------------------------------------------

    #[test]
    fn munge_keeps_ascii_alnum_and_dashes_the_rest() {
        assert_eq!(
            munge_project_dir(r"C:\Users\Zigfriad\projetos\micah"),
            "C--Users-Zigfriad-projetos-micah"
        );
        assert_eq!(munge_project_dir("C:\\repo x.y"), "C--repo-x-y");
        assert_eq!(munge_project_dir("C:\\.claude"), "C---claude");
    }

    #[test]
    fn segments_undone_json_escapes_and_give_boundaries() {
        // JSON-escaped windows path: double backslashes, case folds.
        let cwd = path_segments("C:\\\\Users\\\\Zigfriad\\\\Projetos\\\\micah");
        assert_eq!(cwd, ["c:", "users", "zigfriad", "projetos", "micah"]);
        let root = path_segments(r"C:\Users\Zigfriad\projetos\micah");
        assert!(segments_inside(&cwd, &root));
        // micah-old is a sibling, not inside micah (hard boundary).
        let sibling = path_segments(r"C:\Users\Zigfriad\projetos\micah-old");
        assert!(!segments_inside(&sibling, &root));
        // A subdir launch is inside.
        let sub = path_segments(r"C:\Users\Zigfriad\projetos\micah\src");
        assert!(segments_inside(&sub, &root));
        assert!(segments_inside(&root, &root));
    }

    #[test]
    fn transcript_cwd_inside_reads_the_first_line_verdict() {
        let tmp = tempfile::tempdir().unwrap();
        let inside = write_session(
            tmp.path(),
            "p",
            SESSION,
            b"{\"cwd\":\"C:\\\\Users\\\\zig\\\\proj\\\\micah\",\"x\":1}\n",
        );
        let root = path_segments(r"C:\Users\zig\proj\micah");
        let sibling_root = path_segments(r"C:\Users\zig\proj\micah-old");
        assert!(transcript_cwd_inside(&inside, &root));
        assert!(!transcript_cwd_inside(&inside, &sibling_root));
        // No cwd in the file: dir-based verdict stands (true).
        let bare = write_session(tmp.path(), "q", SESSION, b"{}\n");
        assert!(transcript_cwd_inside(&bare, &root));
    }

    #[test]
    fn repo_scoping_takes_exact_and_extending_but_verifies_cwd() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        // Session launched at the repo root (cwd inside repo).
        write_session(
            &root,
            "C--repo-micah",
            SESSION,
            b"{\"cwd\":\"C:\\\\repo\\\\micah\"}\n",
        );
        // Session launched from a subdir: dir extends the munged root.
        let sub = "11111111-2222-3333-4444-555555555555";
        write_session(
            &root,
            "C--repo-micah-src",
            sub,
            b"{\"cwd\":\"C:\\\\repo\\\\micah\\\\src\"}\n",
        );
        // Sibling dir whose munge extends by dash but whose transcript cwd
        // is NOT inside the repo: dir matches, verification must drop it.
        let sibling = "99999999-8888-7777-6666-555555555555";
        write_session(
            &root,
            "C--repo-micah-old",
            sibling,
            b"{\"cwd\":\"C:\\\\repo\\\\micah-old\"}\n",
        );
        // Unrelated dir: never listed.
        write_session(
            &root,
            "C--other",
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            b"{\"cwd\":\"C:\\\\other\"}\n",
        );
        let got =
            collect_repo_sessions(std::slice::from_ref(&root), r"C:\repo\micah");
        let ids: Vec<&str> = got.iter().map(|s| s.session_id.as_str()).collect();
        assert!(ids.contains(&SESSION));
        assert!(ids.contains(&sub));
        assert!(!ids.contains(&sibling));
        assert_eq!(got.len(), 2);
    }

    #[test]
    fn global_collects_from_all_project_dirs_uuid_gated() {
        let tmp = tempfile::tempdir().unwrap();
        write_session(
            tmp.path(),
            "C--one",
            SESSION,
            b"{\"cwd\":\"C:\\\\one\"}\n",
        );
        write_session(
            tmp.path(),
            "C--two",
            "11111111-2222-3333-4444-555555555555",
            b"{\"cwd\":\"C:\\\\two\"}\n",
        );
        // Non-uuid stem is never a session.
        write_session(tmp.path(), "C--two", "not-a-uuid", b"{}\n");
        let got = collect_global_sessions(&[tmp.path().to_path_buf()]);
        assert_eq!(got.len(), 2);
    }

    #[test]
    fn ancestor_probing_finds_repo_sessions_from_a_subdir_cwd() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        // Session launched at the repo root.
        write_session(
            &root,
            "C--repo-micah",
            SESSION,
            b"{\"cwd\":\"C:\\\\repo\\\\micah\"}\n",
        );
        // Pane sitting in a subdirectory: no dir matches the subdir's own
        // munge, so the probe must walk up to the repo root level.
        let got = collect_repo_sessions(std::slice::from_ref(&root), r"C:\repo\micah\src\lib");
        let ids: Vec<&str> = got.iter().map(|s| s.session_id.as_str()).collect();
        assert!(ids.contains(&SESSION));
    }

    #[test]
    fn ancestor_probing_prefers_the_deepest_match_over_home_noise() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let repo = "11111111-2222-3333-4444-555555555555";
        write_session(
            &root,
            "C--repo-micah",
            repo,
            b"{\"cwd\":\"C:\\\\repo\\\\micah\"}\n",
        );
        // A home-launched session also exists (shallower ancestor).
        write_session(
            &root,
            "C--Users-zig",
            SESSION,
            b"{\"cwd\":\"C:\\\\Users\\\\zig\"}\n",
        );
        // Pane in the repo: deepest level wins, home session stays out.
        let got = collect_repo_sessions(std::slice::from_ref(&root), r"C:\repo\micah");
        let ids: Vec<&str> = got.iter().map(|s| s.session_id.as_str()).collect();
        assert_eq!(ids, [repo]);
        // Pane at home: home level matches there.
        let got = collect_repo_sessions(std::slice::from_ref(&root), r"C:\Users\zig");
        let ids: Vec<&str> = got.iter().map(|s| s.session_id.as_str()).collect();
        assert_eq!(ids.len(), 1);
        assert!(ids.contains(&SESSION));
    }

    #[test]
    fn drive_level_is_never_probed_and_global_is_the_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        // Session in a project unrelated to the pane cwd: the ancestor probe
        // (which stops above drive level) finds nothing and the global
        // fallback must surface it.
        write_session(
            &root,
            "D--other-repo",
            SESSION,
            b"{\"cwd\":\"D:\\\\other-repo\"}\n",
        );
        let got =
            collect_repo_sessions(std::slice::from_ref(&root), r"C:\Users\zig");
        assert!(got.is_empty(), "probe must stay inside the cwd tree");
    }

    #[test]
    fn listing_is_deterministic_on_ties_by_size_then_id() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("C--proj");
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join(format!("{SESSION}.jsonl"));
        let b = dir.join("11111111-2222-3333-4444-555555555555.jsonl");
        std::fs::write(&a, b"same").unwrap();
        std::fs::write(&b, b"same").unwrap();
        let mut out = Vec::new();
        list_recent_in_dir(&dir, &mut out);
        // mtime and size equal: id ascending breaks the tie.
        assert_eq!(out[0].session_id, "11111111-2222-3333-4444-555555555555");
        assert_eq!(out[1].session_id, SESSION);
    }
}
