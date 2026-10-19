//! Portable PNG assets; no external texture paths are stored in projects.
use crate::{Error, Result};
use base64::{Engine, engine::general_purpose::STANDARD};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
pub const MAX_ASSET_BYTES: usize = 512 * 1024;
pub const MAX_ASSET_PIXELS: u64 = 256 * 1024;
pub const MAX_TOTAL_ASSET_PIXELS: u64 = 1024 * 1024;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ImageAsset {
    /// Base64-encoded PNG, embedded for portability.
    pub png: String,
    pub columns: u32,
    pub rows: u32,
    pub frames: u32,
}
#[derive(Clone, Debug)]
pub struct DecodedAsset {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub columns: u32,
    pub rows: u32,
    pub frames: u32,
}
impl DecodedAsset {
    /// Sample normalized sheet-frame coordinates, returning premultiplied linear RGBA.
    pub fn sample(&self, frame: u32, uv: [f64; 2], smooth: bool) -> [f64; 4] {
        if frame >= self.frames || uv.iter().any(|v| !v.is_finite()) {
            return [0.0; 4];
        }
        let (w, h) = self.frame_size();
        let point = [uv[0] * f64::from(w) - 0.5, uv[1] * f64::from(h) - 0.5];
        // Reject the empty filter footprint before integer conversion. Tiny
        // transformed sprites can produce very large (or overflowing) UVs.
        if point[0] <= -1.0
            || point[1] <= -1.0
            || point[0] >= f64::from(w)
            || point[1] >= f64::from(h)
        {
            return [0.0; 4];
        }
        let convert = |p: [u8; 4]| {
            let a = f64::from(p[3]) / 255.0;
            [
                crate::render::linear(f64::from(p[0]) / 255.0) * a,
                crate::render::linear(f64::from(p[1]) / 255.0) * a,
                crate::render::linear(f64::from(p[2]) / 255.0) * a,
                a,
            ]
        };
        if !smooth {
            return convert(self.texel(
                frame,
                (point[0] + 0.5).floor() as i32,
                (point[1] + 0.5).floor() as i32,
            ));
        }
        let x = point[0].floor();
        let y = point[1].floor();
        let fx = point[0] - x;
        let fy = point[1] - y;
        let mut out = [0.0; 4];
        for (dx, dy, weight) in [
            (0, 0, (1.0 - fx) * (1.0 - fy)),
            (1, 0, fx * (1.0 - fy)),
            (0, 1, (1.0 - fx) * fy),
            (1, 1, fx * fy),
        ] {
            let p = convert(self.texel(frame, x as i32 + dx, y as i32 + dy));
            for c in 0..4 {
                out[c] += p[c] * weight;
            }
        }
        out
    }
    pub fn frame_size(&self) -> (u32, u32) {
        (self.width / self.columns, self.height / self.rows)
    }
    pub fn texel(&self, frame: u32, x: i32, y: i32) -> [u8; 4] {
        let (w, h) = self.frame_size();
        if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
            return [0; 4];
        }
        let px = (frame % self.columns) * w + x as u32;
        let py = (frame / self.columns) * h + y as u32;
        let index = ((py * self.width + px) * 4) as usize;
        self.rgba[index..index + 4]
            .try_into()
            .expect("decoded RGBA texel")
    }
}
impl ImageAsset {
    pub fn from_png(bytes: &[u8], columns: u32, rows: u32, frames: u32) -> Result<Self> {
        if bytes.len() > MAX_ASSET_BYTES {
            return Err(Error::new("LIMIT_EXCEEDED", "PNG asset exceeds 512 KiB"));
        }
        let asset = Self {
            png: STANDARD.encode(bytes),
            columns,
            rows,
            frames,
        };
        asset.decode()?;
        Ok(asset)
    }
    pub fn decode(&self) -> Result<DecodedAsset> {
        if self.png.len() > MAX_ASSET_BYTES.div_ceil(3) * 4 {
            return Err(Error::new(
                "LIMIT_EXCEEDED",
                "Encoded PNG asset exceeds 512 KiB",
            ));
        }
        let bytes = STANDARD
            .decode(&self.png)
            .map_err(|_| Error::new("INVALID_ASSET", "Asset is not valid base64"))?;
        if bytes.len() > MAX_ASSET_BYTES {
            return Err(Error::new("LIMIT_EXCEEDED", "PNG asset exceeds 512 KiB"));
        }
        let mut decoder = png::Decoder::new_with_limits(
            Cursor::new(bytes),
            png::Limits {
                bytes: 8 * 1024 * 1024,
            },
        );
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = decoder
            .read_info()
            .map_err(|e| Error::new("INVALID_ASSET", e.to_string()))?;
        let info = reader.info();
        let (w, h) = (info.width, info.height);
        if w == 0
            || h == 0
            || u64::from(w) * u64::from(h) > MAX_ASSET_PIXELS
            || w > 1024
            || h > 1024
        {
            return Err(Error::new(
                "LIMIT_EXCEEDED",
                "PNG asset is limited to 256 Ki pixels and 1024 per side",
            ));
        }
        if self.columns == 0
            || self.rows == 0
            || self.columns > 64
            || self.rows > 64
            || !w.is_multiple_of(self.columns)
            || !h.is_multiple_of(self.rows)
            || self.frames == 0
            || self.frames > 256
            || self.frames > self.columns * self.rows
        {
            return Err(Error::new(
                "INVALID_ASSET",
                "Flipbook requires a divisible 1..64 grid and 1..256 valid frames",
            ));
        }
        if reader.info().animation_control.is_some() {
            return Err(Error::new(
                "INVALID_ASSET",
                "Use a static PNG sheet rather than APNG",
            ));
        }
        let size = reader
            .output_buffer_size()
            .ok_or_else(|| Error::new("INVALID_ASSET", "PNG output size overflow"))?;
        let mut buffer = vec![0; size];
        let out = reader
            .next_frame(&mut buffer)
            .map_err(|e| Error::new("INVALID_ASSET", e.to_string()))?;
        let mut rgba = Vec::with_capacity((w * h * 4) as usize);
        for p in buffer[..out.buffer_size()].chunks(out.color_type.samples()) {
            let color = match out.color_type {
                png::ColorType::Rgba => [p[0], p[1], p[2], p[3]],
                png::ColorType::Rgb => [p[0], p[1], p[2], 255],
                png::ColorType::GrayscaleAlpha => [p[0], p[0], p[0], p[1]],
                png::ColorType::Grayscale => [p[0], p[0], p[0], 255],
                png::ColorType::Indexed => {
                    return Err(Error::new("INVALID_ASSET", "Palette expansion failed"));
                }
            };
            rgba.extend_from_slice(if color[3] == 0 { &[0; 4] } else { &color });
        }
        Ok(DecodedAsset {
            width: w,
            height: h,
            rgba,
            columns: self.columns,
            rows: self.rows,
            frames: self.frames,
        })
    }
}
