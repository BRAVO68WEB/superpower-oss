use anyhow::{anyhow, Result};
use chrono::Utc;
use cron::Schedule;
use std::str::FromStr;
use std::time::Duration;

pub fn cron_sleep_duration(expression: &str) -> Result<Duration> {
    let schedule = Schedule::from_str(expression).map_err(|error| anyhow!(error.to_string()))?;
    let now = Utc::now();
    let next = schedule
        .upcoming(Utc)
        .next()
        .ok_or_else(|| anyhow!("cron expression has no future schedule"))?;
    let millis = (next - now).num_milliseconds().max(250) as u64;
    Ok(Duration::from_millis(millis))
}
