//! Validated, normalized-age animation data shared by every effect.
use crate::{Error, Result};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Interpolation {
    Linear,
    Smooth,
    Hold,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Keyframe {
    pub time: f64,
    pub value: f64,
    pub interpolation: Interpolation,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Curve {
    pub keys: Vec<Keyframe>,
}

fn times(values: impl Iterator<Item = f64>, count: usize) -> Result<()> {
    if !(2..=32).contains(&count) {
        return Err(Error::invalid(
            "Animation requires 2..=32 ordered keys spanning 0 to 1",
        ));
    }
    let keys: Vec<_> = values.collect();
    if keys[0] != 0.0
        || keys[count - 1] != 1.0
        || keys
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
        || keys.windows(2).any(|p| p[0] >= p[1])
    {
        return Err(Error::invalid(
            "Animation key times must strictly increase from 0 to 1",
        ));
    }
    Ok(())
}

fn weight(t: f64, mode: Interpolation) -> f64 {
    match mode {
        Interpolation::Linear => t,
        Interpolation::Smooth => t * t * (3.0 - 2.0 * t),
        Interpolation::Hold => 0.0,
    }
}

impl Curve {
    pub fn validate(&self, min: f64, max: f64) -> Result<()> {
        times(self.keys.iter().map(|k| k.time), self.keys.len())?;
        if self
            .keys
            .iter()
            .any(|k| !k.value.is_finite() || !(min..=max).contains(&k.value))
        {
            return Err(Error::invalid(format!(
                "Curve values must be finite and in {min}..={max}"
            )));
        }
        Ok(())
    }
    pub fn sample(&self, t: f64) -> f64 {
        if t >= 1.0 {
            return self.keys[self.keys.len() - 1].value;
        }
        let t = t.clamp(0.0, 1.0);
        let i = self
            .keys
            .partition_point(|k| k.time <= t)
            .saturating_sub(1)
            .min(self.keys.len() - 2);
        let (a, b) = (&self.keys[i], &self.keys[i + 1]);
        a.value + (b.value - a.value) * weight((t - a.time) / (b.time - a.time), a.interpolation)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ColorStop {
    pub time: f64,
    pub color: [u8; 4],
    pub interpolation: Interpolation,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Gradient {
    pub stops: Vec<ColorStop>,
}

impl Gradient {
    pub fn validate(&self) -> Result<()> {
        times(self.stops.iter().map(|k| k.time), self.stops.len())
    }
    pub fn sample(&self, t: f64) -> [f64; 4] {
        if t >= 1.0 {
            return self.stops[self.stops.len() - 1]
                .color
                .map(|v| f64::from(v) / 255.0);
        }
        let t = t.clamp(0.0, 1.0);
        let i = self
            .stops
            .partition_point(|k| k.time <= t)
            .saturating_sub(1)
            .min(self.stops.len() - 2);
        let (a, b) = (&self.stops[i], &self.stops[i + 1]);
        let x = weight((t - a.time) / (b.time - a.time), a.interpolation);
        std::array::from_fn(|c| {
            (f64::from(a.color[c]) + (f64::from(b.color[c]) - f64::from(a.color[c])) * x) / 255.0
        })
    }
}
