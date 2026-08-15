const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const OSC_INTRO: u8 = b']';
const ST_FINAL: u8 = b'\\';

const OSC_MAX: usize = 2048;

const DEFAULT_AGENTS: &[&str] = &["claude", "codex", "gemini", "pi", "opencode", "grok"];

// OSC 777 marker our agent hooks emit. Legacy 3-field `notify;Micah;<event>`
// (Claude) or 4-field `notify;Micah;<agent>;<event>` (Codex/Gemini/Pi).
const MICAH_MARKER: &[u8] = b"notify;Micah;";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Ground,
    Esc,
    Osc,
    OscEsc,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Status {
    Working,
    Waiting,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Transition {
    Started { agent: String },
    Working,
    Attention,
    Finished,
    Exited,
    Session { session: String },
}

#[derive(Clone, serde::Serialize)]
pub struct AgentSignal {
    pub id: u32,
    pub kind: &'static str,
    pub agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
}

impl Transition {
    pub fn into_signal(self, id: u32) -> AgentSignal {
        match self {
            Transition::Started { agent } => {
                AgentSignal { id, kind: "started", agent: Some(agent), session: None }
            }
            Transition::Working => AgentSignal { id, kind: "working", agent: None, session: None },
            Transition::Attention => {
                AgentSignal { id, kind: "attention", agent: None, session: None }
            }
            Transition::Finished => {
                AgentSignal { id, kind: "finished", agent: None, session: None }
            }
            Transition::Exited => AgentSignal { id, kind: "exited", agent: None, session: None },
            Transition::Session { session } => {
                AgentSignal { id, kind: "session", agent: None, session: Some(session) }
            }
        }
    }
}

/// Strict 8-4-4-4-12 hex UUID. PTY output is untrusted, so a session id only
/// crosses into a signal after passing this.
fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 36 {
        return false;
    }
    for (i, &c) in b.iter().enumerate() {
        if matches!(i, 8 | 13 | 18 | 23) {
            if c != b'-' {
                return false;
            }
        } else if !c.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

pub struct AgentDetector {
    agents: Vec<String>,
    state: State,
    osc: Vec<u8>,
    armed: bool,
    status: Status,
}

impl AgentDetector {
    pub fn new() -> Self {
        Self::with_agents(DEFAULT_AGENTS.iter().map(|s| s.to_string()).collect())
    }

    pub fn with_agents(agents: Vec<String>) -> Self {
        Self {
            agents,
            state: State::Ground,
            osc: Vec::new(),
            armed: false,
            status: Status::Working,
        }
    }

    /// Feed a chunk of raw PTY output. Transitions come only from OSC sequences
    /// (`133` prompt boundaries, our `777` hook marker), never from raw output,
    /// so a TUI agent that repaints continuously never flaps working/waiting.
    pub fn process<F: FnMut(Transition)>(&mut self, input: &[u8], mut emit: F) {
        if self.state == State::Ground && !input.contains(&ESC) {
            return;
        }

        for &b in input {
            match self.state {
                State::Ground => {
                    if b == ESC {
                        self.state = State::Esc;
                    }
                }
                State::Esc => match b {
                    OSC_INTRO => {
                        self.state = State::Osc;
                        self.osc.clear();
                    }
                    ESC => {}
                    _ => self.state = State::Ground,
                },
                State::Osc => match b {
                    BEL => {
                        self.finish_osc(&mut emit);
                        self.state = State::Ground;
                    }
                    ESC => self.state = State::OscEsc,
                    _ => {
                        if self.osc.len() < OSC_MAX {
                            self.osc.push(b);
                        } else {
                            self.osc.clear();
                            self.state = State::Ground;
                        }
                    }
                },
                State::OscEsc => match b {
                    ST_FINAL => {
                        self.finish_osc(&mut emit);
                        self.state = State::Ground;
                    }
                    ESC => {}
                    _ => {
                        self.osc.clear();
                        self.state = State::Ground;
                    }
                },
            }
        }
    }

    /// Called when the underlying PTY closes. Reports the agent as exited so the
    /// UI doesn't leave a stale entry if the shell died mid-command.
    pub fn finish<F: FnMut(Transition)>(&mut self, mut emit: F) {
        if self.armed {
            self.disarm();
            emit(Transition::Exited);
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
        self.status = Status::Working;
    }

    fn finish_osc<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        let body = std::mem::take(&mut self.osc);
        let (ps, pt) = match body.iter().position(|&c| c == b';') {
            Some(i) => (&body[..i], &body[i + 1..]),
            None => (&body[..], &body[0..0]),
        };
        match ps {
            b"133" => self.handle_osc133(pt, emit),
            // OSC 9;4 is taskbar progress, not a notification.
            b"9" if !pt.starts_with(b"4;") && pt != b"4" => self.generic_attention(emit),
            b"777" => self.handle_osc777(pt, emit),
            _ => {}
        }
    }

    fn handle_osc777<F: FnMut(Transition)>(&mut self, pt: &[u8], emit: &mut F) {
        if let Some(tail) = pt.strip_prefix(MICAH_MARKER) {
            // PTY output is untrusted: only self-arm for known agents.
            let (agent, event) = match tail.iter().position(|&c| c == b';') {
                Some(i) => {
                    let Ok(name) = std::str::from_utf8(&tail[..i]) else {
                        return;
                    };
                    if !self.agents.iter().any(|a| a == name) {
                        return;
                    }
                    (name, &tail[i + 1..])
                }
                None => ("claude", tail),
            };
            // New `session;<uuid>` verb: the shell wrapper anchors the Claude
            // Code session id it generated (or re-anchors a typed one).
            if let Some(raw) = event.strip_prefix(b"session;") {
                if let Ok(session) = std::str::from_utf8(raw) {
                    if is_uuid(session) {
                        self.ensure_armed(agent, emit);
                        emit(Transition::Session { session: session.to_string() });
                    }
                }
                return;
            }
            // Self-arms when no shell preexec fired (bash, Windows, tmux).
            match event {
                b"working" => {
                    self.ensure_armed(agent, emit);
                    self.set_working(emit);
                }
                b"attention" => {
                    self.ensure_armed(agent, emit);
                    self.status = Status::Waiting;
                    emit(Transition::Attention);
                }
                b"finished" => {
                    self.ensure_armed(agent, emit);
                    self.status = Status::Waiting;
                    emit(Transition::Finished);
                }
                _ => {}
            }
            return;
        }
        self.generic_attention(emit);
    }

    fn handle_osc133<F: FnMut(Transition)>(&mut self, pt: &[u8], emit: &mut F) {
        match pt.first() {
            Some(b'C') => {
                if self.armed {
                    return;
                }
                let cmd = pt.strip_prefix(b"C;").unwrap_or(b"");
                if let Some(agent) = self.match_agent(cmd) {
                    self.armed = true;
                    self.status = Status::Working;
                    emit(Transition::Started { agent });
                }
            }
            Some(b'D') if self.armed => {
                self.disarm();
                emit(Transition::Exited);
            }
            _ => {}
        }
    }

    fn ensure_armed<F: FnMut(Transition)>(&mut self, agent: &str, emit: &mut F) {
        if !self.armed {
            self.armed = true;
            self.status = Status::Working;
            emit(Transition::Started { agent: agent.to_string() });
        }
    }

    fn set_working<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        if self.status != Status::Working {
            self.status = Status::Working;
            emit(Transition::Working);
        }
    }

    fn generic_attention<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        if self.armed {
            self.status = Status::Waiting;
            emit(Transition::Attention);
        }
    }

    fn match_agent(&self, cmd: &[u8]) -> Option<String> {
        let cmd = std::str::from_utf8(cmd).ok()?;
        for token in cmd.split_whitespace() {
            if token.starts_with('-') {
                continue;
            }
            let base = token.rsplit(['/', '\\']).next().unwrap_or(token);
            if let Some(agent) = self.agents.iter().find(|a| {
                base.strip_prefix(a.as_str())
                    .is_some_and(|rest| rest.is_empty() || rest.starts_with('-'))
            }) {
                return Some(agent.clone());
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(d: &mut AgentDetector, input: &[u8]) -> Vec<Transition> {
        let mut out = Vec::new();
        d.process(input, |t| out.push(t));
        out
    }

    fn osc(body: &str) -> Vec<u8> {
        let mut v = vec![ESC, OSC_INTRO];
        v.extend_from_slice(body.as_bytes());
        v.extend_from_slice(&[ESC, ST_FINAL]);
        v
    }

    fn started(agent: &str) -> Transition {
        Transition::Started { agent: agent.into() }
    }

    #[test]
    fn arms_on_agent_command() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;claude -p hello")), vec![started("claude")]);
    }

    #[test]
    fn arms_on_pi_command() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;pi")), vec![started("pi")]);
    }

    #[test]
    fn arms_on_opencode_and_grok_commands() {
        for agent in ["opencode", "grok"] {
            let mut d = AgentDetector::new();
            assert_eq!(
                run(&mut d, &osc(&format!("133;C;{agent}"))),
                vec![started(agent)]
            );
        }
    }

    #[test]
    fn arms_on_pathed_and_wrapped_command() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("133;C;/usr/local/bin/codex exec")),
            vec![started("codex")]
        );
        let mut d2 = AgentDetector::new();
        assert_eq!(run(&mut d2, &osc("133;C;npx claude")), vec![started("claude")]);
    }

    #[test]
    fn arms_on_dash_suffixed_alias() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;claude-enigma")), vec![started("claude")]);
    }

    #[test]
    fn does_not_arm_on_other_commands() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("133;C;vim src/main.rs")).is_empty());
        assert!(run(&mut d, &osc("133;C;cat claude.txt")).is_empty());
        assert!(run(&mut d, &osc("133;C;claudexyz")).is_empty());
    }

    #[test]
    fn ignores_bell_and_plain_output() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert!(run(&mut d, &[BEL]).is_empty());
        assert!(run(&mut d, b"thinking...\x07more").is_empty());
    }

    #[test]
    fn micah_marker_drives_status() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert_eq!(run(&mut d, &osc("777;notify;Micah;attention")), vec![Transition::Attention]);
        assert_eq!(run(&mut d, &osc("777;notify;Micah;working")), vec![Transition::Working]);
        assert!(run(&mut d, &osc("777;notify;Micah;working")).is_empty());
        assert_eq!(run(&mut d, &osc("777;notify;Micah;finished")), vec![Transition::Finished]);
    }

    #[test]
    fn micah_marker_auto_arms_without_preexec() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("777;notify;Micah;attention")),
            vec![started("claude"), Transition::Attention]
        );
    }

    #[test]
    fn four_field_marker_self_arms_named_agent() {
        // Fresh arm already implies Working, so `working` emits only Started.
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("777;notify;Micah;codex;working")), vec![started("codex")]);
        let mut g = AgentDetector::new();
        assert_eq!(
            run(&mut g, &osc("777;notify;Micah;gemini;finished")),
            vec![started("gemini"), Transition::Finished]
        );
    }

    #[test]
    fn pi_marker_self_arms_and_drives_status() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("777;notify;Micah;pi;working")),
            vec![started("pi")]
        );
        assert_eq!(
            run(&mut d, &osc("777;notify;Micah;pi;finished")),
            vec![Transition::Finished]
        );
    }

    #[test]
    fn session_verb_self_arms_and_carries_uuid() {
        let mut d = AgentDetector::new();
        let uuid = "3f8a1c2e-9b4d-4f6a-8e2c-1a5d7b9c0e42";
        assert_eq!(
            run(&mut d, &osc(&format!("777;notify;Micah;claude;session;{uuid}"))),
            vec![started("claude"), Transition::Session { session: uuid.into() }]
        );
    }

    #[test]
    fn session_verb_after_preexec_emits_only_session() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let uuid = "94144000-8101-401c-808b-f7c2291aa747";
        assert_eq!(
            run(&mut d, &osc(&format!("777;notify;Micah;claude;session;{uuid}"))),
            vec![Transition::Session { session: uuid.into() }]
        );
    }

    #[test]
    fn session_verb_rejects_non_uuid_payload() {
        for bad in [
            "not-a-uuid",
            "3f8a1c2e-9b4d-4f6a-8e2c-1a5d7b9c0e4",
            "3f8a1c2e-9b4d-4f6a-8e2c-1a5d7b9c0e422",
            "3f8a1c2eG9b4d-4f6a-8e2c-1a5d7b9c0e42",
            "$(rm -rf ~); echo 3f8a1c2e-9b4d-4f6a-8e2c-1a5d7b9c0e42",
            "",
        ] {
            let mut d = AgentDetector::new();
            assert!(
                run(&mut d, &osc(&format!("777;notify;Micah;claude;session;{bad}"))).is_empty(),
                "payload {bad:?} must be dropped"
            );
        }
    }

    #[test]
    fn session_verb_ignores_unknown_agent() {
        let mut d = AgentDetector::new();
        assert!(run(
            &mut d,
            &osc("777;notify;Micah;evil;session;3f8a1c2e-9b4d-4f6a-8e2c-1a5d7b9c0e42")
        )
        .is_empty());
    }

    #[test]
    fn legacy_three_field_session_shape_is_not_a_session() {
        // `notify;Micah;session;<uuid>` parses "session" as an agent name,
        // which is unknown: dropped without touching the legacy verbs.
        let mut d = AgentDetector::new();
        assert!(run(
            &mut d,
            &osc("777;notify;Micah;session;3f8a1c2e-9b4d-4f6a-8e2c-1a5d7b9c0e42")
        )
        .is_empty());
        assert_eq!(
            run(&mut d, &osc("777;notify;Micah;attention")),
            vec![started("claude"), Transition::Attention]
        );
    }

    #[test]
    fn is_uuid_accepts_canonical_and_uppercase() {
        assert!(is_uuid("3f8a1c2e-9b4d-4f6a-8e2c-1a5d7b9c0e42"));
        assert!(is_uuid("3F8A1C2E-9B4D-4F6A-8E2C-1A5D7B9C0E42"));
        assert!(!is_uuid("3f8a1c2e09b4d04f6a08e2c01a5d7b9c0e42"));
    }

    #[test]
    fn four_field_marker_ignores_unknown_agent() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("777;notify;Micah;evil;attention")).is_empty());
        // A known agent in the same chunk still works.
        assert_eq!(
            run(&mut d, &osc("777;notify;Micah;codex;attention")),
            vec![started("codex"), Transition::Attention]
        );
    }

    #[test]
    fn four_field_marker_drives_status_after_preexec() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;gemini"));
        assert_eq!(run(&mut d, &osc("777;notify;Micah;gemini;attention")), vec![Transition::Attention]);
        assert_eq!(run(&mut d, &osc("777;notify;Micah;gemini;working")), vec![Transition::Working]);
        assert_eq!(run(&mut d, &osc("777;notify;Micah;gemini;finished")), vec![Transition::Finished]);
    }

    #[test]
    fn generic_osc777_and_osc9_attention_only_when_armed() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("777;notify;Other;ready")).is_empty());
        run(&mut d, &osc("133;C;codex"));
        assert_eq!(run(&mut d, &osc("777;notify;Codex;ready")), vec![Transition::Attention]);
        assert_eq!(run(&mut d, &osc("9;needs you")), vec![Transition::Attention]);
        assert!(run(&mut d, &osc("9;4;1;50")).is_empty());
    }

    #[test]
    fn exits_on_133d() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert_eq!(run(&mut d, &osc("133;D;0")), vec![Transition::Exited]);
        assert!(run(&mut d, &osc("133;D;0")).is_empty());
    }

    #[test]
    fn bel_terminator_inside_osc_is_not_attention() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut seq = vec![ESC, OSC_INTRO];
        seq.extend_from_slice(b"0;set title");
        seq.push(BEL);
        assert!(run(&mut d, &seq).is_empty());
    }

    #[test]
    fn started_split_across_chunks() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &[ESC, OSC_INTRO]).is_empty());
        assert!(run(&mut d, b"133;C;cla").is_empty());
        let mut out = run(&mut d, b"ude");
        out.extend(run(&mut d, &[ESC, ST_FINAL]));
        assert_eq!(out, vec![started("claude")]);
    }

    #[test]
    fn finish_reports_exited_when_armed() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut out = Vec::new();
        d.finish(|t| out.push(t));
        assert_eq!(out, vec![Transition::Exited]);
        let mut out2 = Vec::new();
        d.finish(|t| out2.push(t));
        assert!(out2.is_empty());
    }

    #[test]
    fn oversized_osc_does_not_panic() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut seq = vec![ESC, OSC_INTRO];
        seq.extend(std::iter::repeat_n(b'x', OSC_MAX + 100));
        seq.extend_from_slice(&[ESC, ST_FINAL]);
        assert!(run(&mut d, &seq).is_empty());
        assert_eq!(run(&mut d, &osc("777;notify;Micah;attention")), vec![Transition::Attention]);
    }
}
