//! 节奏引擎：纯函数快照计算（可单测）+ 常驻 tick 循环。
//! 引擎跑在 Rust 进程，窗口只是订阅者。

use crate::holidays::HolidayStore;
use crate::model::{weekday_index, LegalDaysSettings, PulseState, Schedule, StateKind};
use crate::state::AppState;
use crate::{tray, windows};
use chrono::{Local, NaiveDate, NaiveTime, Timelike};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// 引擎每秒推送的快照，也是 tick / transition 事件的载荷
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PulseSnapshot {
    pub state: Option<PulseState>,
    pub block_note: Option<String>,
    pub block_id: Option<String>,
    pub remaining_secs: i64,
    /// 当前块已进行比例 0~1
    pub progress: f64,
    /// 下一个切换点 "HH:MM"
    pub next_at: Option<String>,
    pub next_state_label: Option<String>,
    pub schedule_name: Option<String>,
    /// "HH:MM:SS" 引擎时钟
    pub now: String,
    pub is_idle: bool,
    /// 总开关是否开启；停止时其余字段清零
    pub running: bool,
}

#[derive(Clone, Debug)]
pub struct Skipped {
    pub block_id: String,
    pub date: NaiveDate,
}

/// 引擎运行期记忆（跨 tick 需要保留的判断依据）
#[derive(Default)]
pub struct EngineState {
    last_block_id: Option<String>,
    last_state: Option<PulseState>,
    pub skipped: Option<Skipped>,
    /// 用户手动关掉休息屏且未跳过的块（该块内不再弹出）
    pub rest_dismissed_block: Option<String>,
    /// 已发送过结束预告的块 id（专注/摸鱼类，每块只发一次）
    pub pre_end_sent: Option<String>,
}

impl EngineState {
    /// 清空切换记忆（启动/停止时调用），下一 tick 将当前块视作「新进入」
    pub fn reset(&mut self) {
        self.last_block_id = None;
        self.last_state = None;
        self.rest_dismissed_block = None;
        self.pre_end_sent = None;
        self.skipped = None;
    }
}

// ---------- 纯函数部分 ----------

pub fn parse_hhmm(s: &str) -> Option<u32> {
    let s = s.trim();
    let (h, m) = s.split_once(':')?;
    let h: u32 = h.parse().ok()?;
    let m: u32 = m.parse().ok()?;
    if h > 24 || m > 59 || (h == 24 && m != 0) {
        return None;
    }
    Some(h * 60 + m)
}

fn fmt_hhmm(mins: u32) -> String {
    format!("{:02}:{:02}", mins / 60, mins % 60)
}

/// 计算某日的「等效周几」，用于时间表匹配：
/// 调休补班日 → 1（工作日档）；法定节假日 → 6（休息日档）；其余按真实周几。
/// 查找顺序：用户手动补充（legalDays）→ 自动数据（HolidayStore，内置/下载）。
pub fn effective_weekday(
    date: NaiveDate,
    legal: Option<&LegalDaysSettings>,
    holidays: Option<&HolidayStore>,
) -> u8 {
    let real = weekday_index(date);
    let Some(legal) = legal else { return real };
    if !legal.enabled {
        return real;
    }
    let ds = date.format("%Y-%m-%d").to_string();
    if legal.workdays.iter().any(|d| d == &ds) {
        return 1;
    }
    if legal.holidays.iter().any(|d| d == &ds) {
        return 6;
    }
    if let Some(store) = holidays {
        if store.is_work_day(date) {
            return 1;
        }
        if store.is_off_day(date) {
            return 6;
        }
    }
    real
}

pub fn active_schedule<'a>(
    schedules: &'a [Schedule],
    date: NaiveDate,
    legal: Option<&LegalDaysSettings>,
    holidays: Option<&HolidayStore>,
) -> Option<&'a Schedule> {
    let day = effective_weekday(date, legal, holidays);
    schedules
        .iter()
        .find(|s| s.active_days.contains(&day))
}

/// 给定时刻计算完整快照。
/// 规则：包含当前时刻的块中取 start 最晚者（重叠时最具体的优先）；
/// 被跳过的块视作空闲；空闲时 remaining 指向下一个块的开始。
pub fn compute_snapshot(
    schedules: &[Schedule],
    states: &[PulseState],
    legal: Option<&LegalDaysSettings>,
    holidays: Option<&HolidayStore>,
    running: bool,
    date: NaiveDate,
    time: NaiveTime,
    skipped: Option<&Skipped>,
) -> PulseSnapshot {
    let now_secs =
        time.hour() as i64 * 3600 + time.minute() as i64 * 60 + time.second() as i64;
    let now_mins = now_secs / 60;

    let state_of = |id: &str| states.iter().find(|s| s.id == id).cloned();

    let schedule = active_schedule(schedules, date, legal, holidays);
    let blocks = schedule.map(|s| s.blocks.as_slice()).unwrap_or(&[]);

    // 当前块：start <= now < end，取 start 最晚
    let current = blocks
        .iter()
        .filter_map(|b| {
            let s = parse_hhmm(&b.start)?;
            let e = parse_hhmm(&b.end)?;
            if e <= s {
                return None;
            }
            let sm = s as i64;
            let em = e as i64;
            if now_mins >= sm && now_mins < em {
                Some((sm, em, b))
            } else {
                None
            }
        })
        .max_by_key(|(sm, _, _)| *sm);

    // 下一个块：start >= now（或当前块结束后紧接着的），取 start 最早
    let next = blocks
        .iter()
        .filter_map(|b| {
            let s = parse_hhmm(&b.start)?;
            let e = parse_hhmm(&b.end)?;
            if e <= s {
                return None;
            }
            Some((s as i64, e as i64, b))
        })
        .filter(|(sm, _, _)| match current {
            Some((_csm, cem, _)) => *sm >= cem, // 当前块结束之后的块
            None => *sm > now_mins,
        })
        .min_by_key(|(sm, _, _)| *sm);

    let skipped_now = skipped
        .map(|sk| sk.date == date)
        .unwrap_or(false);

    let mut snap = match current {
        Some((sm, em, b)) => {
            let is_skipped =
                skipped_now && skipped.map(|sk| sk.block_id == b.id).unwrap_or(false);
            let state = if is_skipped { None } else { state_of(&b.state_id) };
            let start_secs = sm * 60;
            let end_secs = em * 60;
            let remaining = (end_secs - now_secs).max(0);
            let progress = if end_secs > start_secs {
                ((now_secs - start_secs) as f64 / (end_secs - start_secs) as f64).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let next_label = next
                .and_then(|(_, _, nb)| state_of(&nb.state_id))
                .map(|s| s.label);
            let is_idle = is_skipped || state.is_none();
            PulseSnapshot {
                state,
                block_note: b.note.clone(),
                block_id: Some(b.id.clone()),
                remaining_secs: remaining,
                progress,
                next_at: Some(fmt_hhmm(em as u32)),
                next_state_label: next_label,
                schedule_name: schedule.map(|s| s.name.clone()),
                now: format!("{}:{}:{}", time.hour(), time.minute(), time.second()),
                is_idle,
                running,
            }
        }
        None => {
            let (remaining, next_at, next_label) = match next {
                Some((sm, _, b)) => (
                    (sm * 60 - now_secs).max(0),
                    Some(fmt_hhmm(sm as u32)),
                    state_of(&b.state_id).map(|s| s.label),
                ),
                None => (0, None, None),
            };
            PulseSnapshot {
                state: None,
                block_note: None,
                block_id: None,
                remaining_secs: remaining,
                progress: 0.0,
                next_at,
                next_state_label: next_label,
                schedule_name: schedule.map(|s| s.name.clone()),
                now: format!("{}:{}:{}", time.hour(), time.minute(), time.second()),
                is_idle: true,
                running,
            }
        }
    };

    // 停止中：快照清零，窗口层据此显示「已停止」
    if !running {
        snap.state = None;
        snap.block_note = None;
        snap.block_id = None;
        snap.remaining_secs = 0;
        snap.progress = 0.0;
        snap.next_at = None;
        snap.next_state_label = None;
        snap.schedule_name = None;
        snap.is_idle = true;
    }
    snap
}

// ---------- 运行时部分 ----------

pub fn current_snapshot(app: &AppHandle) -> PulseSnapshot {
    let st = app.state::<AppState>();
    let now = Local::now();
    let config = st.config.read().unwrap();
    let engine = st.engine.read().unwrap();
    let store = st.holidays.read().unwrap();
    compute_snapshot(
        &config.schedules,
        &config.states,
        Some(&config.settings.legal_days),
        Some(&store),
        config.settings.running,
        now.date_naive(),
        now.time(),
        engine.skipped.as_ref(),
    )
}

pub fn emit_tick(app: &AppHandle, snap: &PulseSnapshot) {
    let _ = app.emit(crate::EV_TICK, snap);
}

/// 单次 tick：计算快照 → 处理切换副作用 → 推送
fn tick_once(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let now = Local::now();
    let st = app.state::<AppState>();
    let config = st.config.read().unwrap();
    let mut engine = st.engine.write().unwrap();
    let store = st.holidays.read().unwrap();

    // 过期的跳过标记（跨天）自动清除
    if let Some(sk) = &engine.skipped {
        if sk.date != now.date_naive() {
            engine.skipped = None;
        }
    }
    let snap = compute_snapshot(
        &config.schedules,
        &config.states,
        Some(&config.settings.legal_days),
        Some(&store),
        config.settings.running,
        now.date_naive(),
        now.time(),
        engine.skipped.as_ref(),
    );
    let notifications = config.settings.notifications;
    let running = config.settings.running;
    let end_reminders = config.settings.end_reminders;
    drop(config);
    drop(store);

    // 停止中：不检测切换、不通知、不弹休息屏，只推快照
    if !running {
        let need_cleanup = engine.last_block_id.is_some();
        engine.last_block_id = None;
        engine.last_state = None;
        engine.rest_dismissed_block = None;
        engine.pre_end_sent = None;
        engine.skipped = None;
        drop(engine);
        if need_cleanup {
            windows::hide_rest(app);
            let _ = app.emit(crate::EV_REST_DISMISSED, ());
        }
        emit_tick(app, &snap);
        tray::update(app, None);
        return Ok(());
    }

    let in_rest = snap
        .state
        .as_ref()
        .map(|s| s.kind == StateKind::Rest)
        .unwrap_or(false);

    // 状态反应 · 结束预告：专注类提前 5 分钟、摸鱼类提前 2 分钟各提醒一次。
    // 同一块只发一次（记 block_id），空闲/跳过/短块不触发。
    if notifications && end_reminders && !snap.is_idle {
        if let (Some(state), Some(block_id)) = (&snap.state, &snap.block_id) {
            let threshold: i64 = match state.kind {
                StateKind::Focus => 300,
                StateKind::Slack => 120,
                _ => 0,
            };
            let already = engine.pre_end_sent.as_deref() == Some(block_id.as_str());
            if threshold > 0 && !already && (1..=threshold).contains(&snap.remaining_secs) {
                engine.pre_end_sent = Some(block_id.clone());
                let mins = (snap.remaining_secs / 60).max(1);
                let body = match state.kind {
                    StateKind::Focus => {
                        format!("「{}」还剩约 {} 分钟，准备收尾 ✍️", state.label, mins)
                    }
                    StateKind::Slack => {
                        format!("摸鱼时间快结束啦，「{}」还剩约 {} 分钟 🐟", state.label, mins)
                    }
                    _ => String::new(),
                };
                if !body.is_empty() {
                    let _ = app
                        .notification()
                        .builder()
                        .title("块结束预告")
                        .body(body)
                        .show();
                }
            }
        }
    }

    // 块切换检测
    if snap.block_id != engine.last_block_id {
        let from_state = engine.last_state.clone();
        let was_rest = from_state
            .as_ref()
            .map(|s| s.kind == StateKind::Rest)
            .unwrap_or(false);
        engine.last_block_id = snap.block_id.clone();
        engine.last_state = snap.state.clone();
        engine.rest_dismissed_block = None;

        let payload = serde_json::json!({ "from": from_state, "to": &snap });
        let _ = app.emit(crate::EV_TRANSITION, &payload);

        // 系统通知
        if notifications {
            if let Some(state) = &snap.state {
                let until = snap.next_at.clone().unwrap_or_default();
                let note = snap
                    .block_note
                    .as_deref()
                    .filter(|n| !n.trim().is_empty())
                    .map(|n| format!(" · 📝 {n}"))
                    .unwrap_or_default();
                let _ = app
                    .notification()
                    .builder()
                    .title("节奏切换")
                    .body(format!(
                        "进入「{}」，直到 {}{}",
                        state.label, until, note
                    ))
                    .show();
            }
        }

        // 全屏休息接管
        if in_rest {
            windows::show_rest(app);
        } else if was_rest {
            windows::hide_rest(app);
            let _ = app.emit(crate::EV_REST_DISMISSED, ());
            // 休息结束的回归提醒
            if notifications {
                let _ = app
                    .notification()
                    .builder()
                    .title("休息结束")
                    .body(format!(
                        "回到「{}」{}",
                        snap.state.as_ref().map(|s| s.label.as_str()).unwrap_or("自由时间"),
                        snap.next_at
                            .as_deref()
                            .map(|t| format!("，直到 {t}"))
                            .unwrap_or_default()
                    ))
                    .show();
            }
        }
    }

    drop(engine);
    emit_tick(app, &snap);
    tray::update(app, snap.state.as_ref());
    Ok(())
}

pub async fn run(app: AppHandle) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
    loop {
        interval.tick().await;
        if let Err(e) = tick_once(&app) {
            eprintln!("[tempo-pulse] engine tick error: {e}");
        }
    }
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{PulseState, Schedule, TimeBlock};

    fn states() -> Vec<PulseState> {
        vec![
            PulseState {
                id: "focus".into(),
                label: "认真工作".into(),
                emoji: None,
                color: "#f97316".into(),
                kind: StateKind::Focus,
            },
            PulseState {
                id: "rest".into(),
                label: "休息".into(),
                emoji: None,
                color: "#34d399".into(),
                kind: StateKind::Rest,
            },
        ]
    }

    fn schedule() -> Schedule {
        let block = |id: &str, start: &str, end: &str, state_id: &str| TimeBlock {
            id: id.into(),
            start: start.into(),
            end: end.into(),
            state_id: state_id.into(),
            note: None,
        };
        Schedule {
            id: "s1".into(),
            name: "工作日".into(),
            blocks: vec![
                block("b1", "09:00", "12:00", "focus"),
                block("b2", "12:00", "13:30", "rest"),
                block("b3", "13:30", "18:00", "focus"),
            ],
            active_days: vec![1, 2, 3, 4, 5],
        }
    }

    fn t(h: u32, m: u32, s: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, s).unwrap()
    }

    // 2026-08-28 是周五（工作日）
    fn friday() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, 28).unwrap()
    }

    fn sunday() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, 30).unwrap()
    }

    #[test]
    fn parse_hhmm_valid() {
        assert_eq!(parse_hhmm("09:30"), Some(570));
        assert_eq!(parse_hhmm("24:00"), Some(1440));
        assert_eq!(parse_hhmm("24:01"), None);
        assert_eq!(parse_hhmm("9:5"), Some(545)); // 宽松解析
        assert_eq!(parse_hhmm("abc"), None);
    }

    #[test]
    fn inside_block() {
        let snap = compute_snapshot(
            &[schedule()],
            &states(),
            None,
            None,
            true,
            friday(),
            t(10, 30, 0),
            None,
        );
        assert_eq!(snap.block_id.as_deref(), Some("b1"));
        assert_eq!(snap.state.as_ref().unwrap().id, "focus");
        assert_eq!(snap.remaining_secs, 90 * 60);
        assert!((snap.progress - (90.0 / 180.0)).abs() < 1e-9);
        assert_eq!(snap.next_at.as_deref(), Some("12:00"));
        assert_eq!(snap.next_state_label.as_deref(), Some("休息"));
        assert!(!snap.is_idle);
    }

    #[test]
    fn block_boundary_start_inclusive_end_exclusive() {
        let s = &[schedule()];
        let st = states();
        // 12:00:00 恰好切到休息块
        let snap = compute_snapshot(s, &st, None, None, true, friday(), t(12, 0, 0), None);
        assert_eq!(snap.block_id.as_deref(), Some("b2"));
        // 13:30:00 恰好离开休息块
        let snap = compute_snapshot(s, &st, None, None, true, friday(), t(13, 30, 0), None);
        assert_eq!(snap.block_id.as_deref(), Some("b3"));
    }

    #[test]
    fn idle_counts_down_to_next_block() {
        let snap = compute_snapshot(
            &[schedule()],
            &states(),
            None,
            None,
            true,
            friday(),
            t(8, 0, 0),
            None,
        );
        assert!(snap.is_idle);
        assert_eq!(snap.block_id, None);
        assert_eq!(snap.next_at.as_deref(), Some("09:00"));
        assert_eq!(snap.remaining_secs, 3600);
    }

    #[test]
    fn skipped_block_becomes_idle() {
        let sk = Skipped { block_id: "b1".into(), date: friday() };
        let snap = compute_snapshot(
            &[schedule()],
            &states(),
            None,
            None,
            true,
            friday(),
            t(10, 0, 0),
            Some(&sk),
        );
        assert!(snap.is_idle);
        assert_eq!(snap.state, None);
        // 快照仍带块信息（剩余时间照常计算）
        assert_eq!(snap.block_id.as_deref(), Some("b1"));
        // 跨天后跳过失效
        let snap2 = compute_snapshot(
            &[schedule()],
            &states(),
            None,
            None,
            true,
            NaiveDate::from_ymd_opt(2026, 8, 21).unwrap(), // 上周五
            t(10, 0, 0),
            Some(&sk),
        );
        assert!(!snap2.is_idle);
    }

    #[test]
    fn schedule_picked_by_weekday() {
        // 周日无匹配（周末模板在另一个数组里才会命中）
        let snap = compute_snapshot(&[schedule()], &states(), None, None, true, sunday(), t(10, 0, 0), None);
        assert!(snap.is_idle);
        assert_eq!(snap.schedule_name, None);
    }

    #[test]
    fn overlap_prefers_latest_start() {
        let mut s = schedule();
        s.blocks.push(TimeBlock {
            id: "b4".into(),
            start: "11:00".into(),
            end: "11:45".into(),
            state_id: "rest".into(),
            note: None,
        });
        let snap = compute_snapshot(&[s], &states(), None, None, true, friday(), t(11, 20, 0), None);
        assert_eq!(snap.block_id.as_deref(), Some("b4"));
    }

    // ---------- 法定工作日 ----------

    fn legal() -> LegalDaysSettings {
        LegalDaysSettings {
            enabled: true,
            // 2026-05-01（周五）为法定假日，2026-05-09（周六）为补班日
            holidays: vec!["2026-05-01".into(), "2026-05-02".into()],
            workdays: vec!["2026-05-09".into()],
            auto_update: true,
            last_updated: None,
        }
    }

    fn workday_and_restday_schedules() -> Vec<Schedule> {
        let work = schedule(); // [1-5] 有块
        let rest = Schedule {
            id: "s2".into(),
            name: "周末".into(),
            blocks: vec![],
            active_days: vec![6, 7],
        };
        vec![work, rest]
    }

    #[test]
    fn effective_weekday_mapping() {
        let may1 = NaiveDate::from_ymd_opt(2026, 5, 1).unwrap(); // 周五·法定假日
        let may9 = NaiveDate::from_ymd_opt(2026, 5, 9).unwrap(); // 周六·补班
        let may4 = NaiveDate::from_ymd_opt(2026, 5, 4).unwrap(); // 周一·普通
        assert_eq!(effective_weekday(may1, Some(&legal()), None), 6);
        assert_eq!(effective_weekday(may9, Some(&legal()), None), 1);
        assert_eq!(effective_weekday(may4, Some(&legal()), None), 1);
        // 关闭后按真实周几
        let off = LegalDaysSettings { enabled: false, ..legal() };
        assert_eq!(effective_weekday(may1, Some(&off), None), 5);
        assert_eq!(effective_weekday(may1, None, None), 5);
    }

    #[test]
    fn statutory_holiday_hits_restday_schedule() {
        let s = workday_and_restday_schedules();
        let may1 = NaiveDate::from_ymd_opt(2026, 5, 1).unwrap();
        let snap = compute_snapshot(&s, &states(), Some(&legal()), None, true, may1, t(10, 0, 0), None);
        assert_eq!(snap.schedule_name.as_deref(), Some("周末"));
        assert!(snap.is_idle);
    }

    #[test]
    fn makeup_workday_hits_workday_schedule() {
        let s = workday_and_restday_schedules();
        let may9 = NaiveDate::from_ymd_opt(2026, 5, 9).unwrap();
        let snap = compute_snapshot(&s, &states(), Some(&legal()), None, true, may9, t(10, 0, 0), None);
        assert_eq!(snap.schedule_name.as_deref(), Some("工作日"));
        assert_eq!(snap.block_id.as_deref(), Some("b1"));
    }

    #[test]
    fn builtin_holiday_cn_data_parses() {
        // 内置 2026 数据：33 天假期 + 6 天补班（与国务院通知一致）
        let store = HolidayStore::load(std::path::Path::new("/nonexistent"));
        let y = store.years.get(&2026).expect("内置 2026 数据应存在");
        assert_eq!(y.off_days.len(), 33);
        assert_eq!(y.work_days.len(), 6);
        assert!(y.off_days.contains(&"2026-10-01".to_string()));
        assert!(y.work_days.contains(&"2026-10-10".to_string()));
    }

    #[test]
    fn effective_weekday_uses_holiday_store() {
        let store = HolidayStore::load(std::path::Path::new("/nonexistent"));
        let on = LegalDaysSettings { enabled: true, holidays: vec![], workdays: vec![], auto_update: true, last_updated: None };
        // 国庆 10-01（周四）→ 休息日档；补班 10-10（周六）→ 工作日档
        let oct1 = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let oct10 = NaiveDate::from_ymd_opt(2026, 10, 10).unwrap();
        let oct12 = NaiveDate::from_ymd_opt(2026, 10, 12).unwrap(); // 普通周一
        assert_eq!(effective_weekday(oct1, Some(&on), Some(&store)), 6);
        assert_eq!(effective_weekday(oct10, Some(&on), Some(&store)), 1);
        assert_eq!(effective_weekday(oct12, Some(&on), Some(&store)), 1);
        // 手动补充优先于自动数据（把普通周一标为假）
        let manual = LegalDaysSettings { enabled: true, holidays: vec!["2026-10-12".into()], workdays: vec![], auto_update: true, last_updated: None };
        assert_eq!(effective_weekday(oct12, Some(&manual), Some(&store)), 6);
    }

    #[test]
    fn stopped_snapshot_is_zeroed() {
        let snap = compute_snapshot(
            &[schedule()],
            &states(),
            None,
            None,
            false,
            friday(),
            t(10, 30, 0),
            None,
        );
        assert!(!snap.running);
        assert!(snap.is_idle);
        assert_eq!(snap.state, None);
        assert_eq!(snap.block_id, None);
        assert_eq!(snap.remaining_secs, 0);
        assert_eq!(snap.schedule_name, None);
    }

    #[test]
    fn legal_disabled_uses_real_weekday() {
        let off = LegalDaysSettings { enabled: false, ..legal() };
        let s = workday_and_restday_schedules();
        let may1 = NaiveDate::from_ymd_opt(2026, 5, 1).unwrap(); // 周五
        let snap = compute_snapshot(&s, &states(), Some(&off), None, true, may1, t(10, 0, 0), None);
        assert_eq!(snap.schedule_name.as_deref(), Some("工作日"));
        assert!(!snap.is_idle);
    }
}
