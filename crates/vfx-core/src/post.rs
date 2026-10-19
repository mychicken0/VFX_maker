//! Ordered image operations with explicit alpha/color semantics and bounded work.
use crate::{Error, Result, assets::DecodedAsset, control::RenderControl, model::*};
use std::collections::{BTreeMap, BTreeSet};
fn finite(x: f64, min: f64, max: f64) -> bool {
    x.is_finite() && (min..=max).contains(&x)
}
pub fn validate(effects: &[PostProcess], assets: &BTreeMap<String, DecodedAsset>) -> Result<()> {
    if effects.len() > 8 {
        return Err(Error::new(
            "LIMIT_EXCEEDED",
            "At most 8 post-processing operations",
        ));
    }
    for effect in effects {
        let valid = match effect {
            PostProcess::Palette {
                colors,
                dither,
                alpha_levels,
            } => {
                (2..=64).contains(&colors.len())
                    && colors.iter().collect::<BTreeSet<_>>().len() == colors.len()
                    && finite(*dither, 0.0, 1.0)
                    && (2..=256).contains(alpha_levels)
            }
            PostProcess::Mask { asset, frame, .. } => {
                assets.get(asset).is_some_and(|a| *frame < a.frames)
            }
            PostProcess::WaveDistortion {
                amount,
                frequency,
                period_seconds,
            } => {
                amount.iter().all(|x| finite(*x, -32.0, 32.0))
                    && frequency.iter().all(|x| finite(*x, 0.0, 1.0))
                    && finite(*period_seconds, 0.01, 10.0)
            }
        };
        if !valid {
            return Err(Error::invalid(
                "Invalid palette, mask asset/frame or distortion parameters",
            ));
        }
    }
    Ok(())
}
pub fn work(effects: &[PostProcess], pixels: u64) -> u64 {
    effects
        .iter()
        .map(|e| {
            pixels
                * match e {
                    PostProcess::Palette { colors, .. } => colors.len() as u64 + 1,
                    _ => 8,
                }
        })
        .sum()
}
pub fn unpremultiply(p: [f64; 4]) -> [u8; 4] {
    let a = (p[3].clamp(0.0, 1.0) * 255.0).round() as u8;
    if a == 0 {
        return [0; 4];
    }
    let mut out = [0; 4];
    for c in 0..3 {
        out[c] = (crate::render::srgb((p[c] / p[3]).clamp(0.0, 1.0)) * 255.0).round() as u8;
    }
    out[3] = a;
    out
}
pub fn apply(
    rgba: &mut Vec<u8>,
    canvas: &Canvas,
    effects: &[PostProcess],
    assets: &BTreeMap<String, DecodedAsset>,
    time: f64,
    control: &RenderControl,
) -> Result<()> {
    let (w, h) = (canvas.width, canvas.height);
    for effect in effects {
        control.check()?;
        match effect {
            PostProcess::Mask {
                asset,
                frame,
                channel,
                invert,
            } => {
                let image = &assets[asset];
                let (mw, mh) = image.frame_size();
                let edge = [0.5 / f64::from(mw), 0.5 / f64::from(mh)];
                for y in 0..h {
                    control.check()?;
                    for x in 0..w {
                        let sample = image.sample(
                            *frame,
                            [
                                ((f64::from(x) + 0.5) / f64::from(w)).clamp(edge[0], 1.0 - edge[0]),
                                ((f64::from(y) + 0.5) / f64::from(h)).clamp(edge[1], 1.0 - edge[1]),
                            ],
                            !canvas.pixel_mode,
                        );
                        let mask = match channel {
                            MaskChannel::Alpha => sample[3],
                            MaskChannel::Luminance => {
                                sample[0] * 0.2126 + sample[1] * 0.7152 + sample[2] * 0.0722
                            }
                        };
                        let factor = if *invert { 1.0 - mask } else { mask };
                        let i = ((y * w + x) * 4) as usize;
                        rgba[i + 3] = (f64::from(rgba[i + 3]) * factor).round() as u8;
                        if rgba[i + 3] == 0 {
                            rgba[i..i + 4].fill(0);
                        }
                    }
                }
            }
            PostProcess::Palette {
                colors,
                dither,
                alpha_levels,
            } => {
                const BAYER: [[u8; 4]; 4] =
                    [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
                let palette: Vec<_> = colors
                    .iter()
                    .map(|p| p.map(|v| crate::render::linear(f64::from(v) / 255.0)))
                    .collect();
                for y in 0..h {
                    control.check()?;
                    for x in 0..w {
                        let i = ((y * w + x) * 4) as usize;
                        if rgba[i + 3] == 0 {
                            continue;
                        }
                        let threshold =
                            (f64::from(BAYER[y as usize % 4][x as usize % 4]) + 0.5) / 16.0 - 0.5;
                        let rgb: [f64; 3] = std::array::from_fn(|c| {
                            crate::render::linear(
                                (f64::from(rgba[i + c]) / 255.0 + threshold * dither)
                                    .clamp(0.0, 1.0),
                            )
                        });
                        let closest = palette
                            .iter()
                            .enumerate()
                            .min_by(|(_, a), (_, b)| {
                                let distance = |p: &&[f64; 3]| {
                                    (0..3).map(|c| (rgb[c] - p[c]).powi(2)).sum::<f64>()
                                };
                                distance(a).total_cmp(&distance(b))
                            })
                            .expect("validated palette")
                            .0;
                        rgba[i..i + 3].copy_from_slice(&colors[closest]);
                        let levels = f64::from(*alpha_levels - 1);
                        rgba[i + 3] = ((f64::from(rgba[i + 3]) / 255.0 * levels).round() / levels
                            * 255.0)
                            .round() as u8;
                        if rgba[i + 3] == 0 {
                            rgba[i..i + 4].fill(0);
                        }
                    }
                }
            }
            PostProcess::WaveDistortion {
                amount,
                frequency,
                period_seconds,
            } => {
                let source = DecodedAsset {
                    width: w,
                    height: h,
                    rgba: std::mem::take(rgba),
                    columns: 1,
                    rows: 1,
                    frames: 1,
                };
                *rgba = vec![0; (w * h * 4) as usize];
                let phase = std::f64::consts::TAU * time / period_seconds;
                for y in 0..h {
                    control.check()?;
                    for x in 0..w {
                        let sx = f64::from(x)
                            + 0.5
                            + amount[0]
                                * (f64::from(y) * frequency[0] * std::f64::consts::TAU + phase)
                                    .sin();
                        let sy = f64::from(y)
                            + 0.5
                            + amount[1]
                                * (f64::from(x) * frequency[1] * std::f64::consts::TAU + phase)
                                    .sin();
                        let pixel = unpremultiply(source.sample(
                            0,
                            [sx / f64::from(w), sy / f64::from(h)],
                            !canvas.pixel_mode,
                        ));
                        let i = ((y * w + x) * 4) as usize;
                        rgba[i..i + 4].copy_from_slice(&pixel);
                    }
                }
            }
        }
    }
    Ok(())
}
