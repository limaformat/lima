//! Property smoke test: neither `parse_core` nor `parse` may **panic** on
//! any input, in either mode. Every reachable input is either a parsed
//! value or a `LimaError` — never an abort.
//!
//! This is not a coverage-guided fuzzer. Real libFuzzer/cargo-fuzz needs a
//! nightly toolchain and an out-of-tree `fuzz/` crate and is tracked
//! separately. This is a deterministic, dependency-free generator that
//! runs on stable as part of `cargo test`, closing the "we never
//! systematically checked `parse` for panics" gap. It feeds:
//!
//!   - random byte strings,
//!   - random strings over a Lima-syntax-biased alphabet,
//!   - byte-level mutations of a seed corpus of valid Lima documents.
//!
//! Iterations: `LIMA_FUZZ_ITERS` (default 20_000). The seed defaults to the
//! wall clock, so each run — including each CI run — explores fresh inputs;
//! a failure prints the seed, iteration, and the offending input (lossy +
//! hex). Reproduce with `LIMA_FUZZ_SEED=<printed> cargo test --test
//! fuzz_smoke`. To fuzz in earnest: `LIMA_FUZZ_ITERS=5000000 cargo test
//! --release --test fuzz_smoke -- --nocapture`.

use lima::{parse, parse_core, ParseOptions};
use std::panic::{catch_unwind, AssertUnwindSafe};

/// xorshift64* — deterministic, no dependencies.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        // xorshift is stuck at zero; any non-zero state is fine.
        Rng(if seed == 0 {
            0x9E37_79B9_7F4A_7C15
        } else {
            seed
        })
    }
    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }
    fn byte(&mut self) -> u8 {
        self.next_u64() as u8
    }
    fn coin(&mut self) -> bool {
        self.next_u64() & 1 == 1
    }
}

const SEEDS: &[&str] = &[
    "title: Hello\n",
    "a: 1\nb: 2\nc: true\nd: null\n",
    "list:\n  - one\n  - two\n  - three\n",
    "flow: [1, 2, 3]\nmap: {x: 1, y: 2}\n",
    "text: |\n  line one\n  line two\n",
    "when: 2024-03-01\nwhen2: 2024-03-01T09:00:00Z\noffset: 2024-03-01T09:00:00+02:00\n",
    "quoted: \"a \\\"b\\\" c\"\nsingle: 'it''s here'\n",
    "ref: ${title}\npartial: ($x)\nother: (%y)\ndeep: ${a.b.c}\n",
    "nested:\n  a:\n    b: [x, {y: z}, [1, 2]]\n",
    "num: -12.5e3\nbig: 99999999999999999999\nnegzero: -0\nhex: 0xFF\n",
    "  \n\t\n# comment only\n",
    "key:\nkey2: \n",
];

/// Bytes that most often appear in — or right next to — Lima syntax.
const ALPHABET: &[u8] = b": -[]{}\"'|#$()%,.\n\t 0123abcXYZ_/\\=>*&!~";

fn random_bytes(rng: &mut Rng, max: usize) -> Vec<u8> {
    let n = rng.below(max);
    (0..n).map(|_| rng.byte()).collect()
}

fn random_alpha(rng: &mut Rng, max: usize) -> Vec<u8> {
    let n = rng.below(max);
    (0..n)
        .map(|_| ALPHABET[rng.below(ALPHABET.len())])
        .collect()
}

/// Pathological shapes that target recursion / limit handling: deep flow
/// nesting, deep indentation, long runs of one byte.
fn pathological(rng: &mut Rng) -> Vec<u8> {
    let depth = 1 + rng.below(4000);
    match rng.below(4) {
        0 => {
            let mut v = b"k: ".to_vec();
            v.resize(v.len() + depth, b'[');
            let close = rng.below(depth + 1);
            v.resize(v.len() + close, b']');
            v
        }
        1 => {
            let mut v = b"k: ".to_vec();
            v.resize(v.len() + depth, b'{');
            v
        }
        2 => {
            let mut v = Vec::new();
            for _ in 0..rng.below(400) {
                let pad = rng.below(80);
                v.resize(v.len() + pad, b' ');
                v.extend_from_slice(b"- x\n");
            }
            v
        }
        _ => vec![ALPHABET[rng.below(ALPHABET.len())]; depth],
    }
}

fn mutate(rng: &mut Rng, seed: &str) -> Vec<u8> {
    let mut b = seed.as_bytes().to_vec();
    for _ in 0..1 + rng.below(16) {
        if b.is_empty() {
            b.push(rng.byte());
            continue;
        }
        let i = rng.below(b.len());
        match rng.below(5) {
            0 => b[i] = rng.byte(),
            1 => b.insert(
                i,
                if rng.coin() {
                    rng.byte()
                } else {
                    ALPHABET[rng.below(ALPHABET.len())]
                },
            ),
            2 => {
                b.remove(i);
            }
            3 => b.truncate(i),
            _ => {
                let c = b[i];
                b.insert(i, c);
            }
        }
    }
    b
}

fn no_panic<F: FnOnce()>(f: F) -> bool {
    catch_unwind(AssertUnwindSafe(f)).is_ok()
}

fn exercise(input: &[u8]) -> Result<(), &'static str> {
    let s = String::from_utf8_lossy(input).into_owned();
    let s = s.as_str();

    if !no_panic(|| {
        let _ = parse_core(s, false);
    }) {
        return Err("parse_core panicked (non-strict)");
    }
    if !no_panic(|| {
        let _ = parse_core(s, true);
    }) {
        return Err("parse_core panicked (strict)");
    }
    if !no_panic(|| {
        let _ = parse(s, ParseOptions::default());
    }) {
        return Err("parse panicked (non-strict)");
    }
    if !no_panic(|| {
        let _ = parse(
            s,
            ParseOptions {
                strict: true,
                ..Default::default()
            },
        );
    }) {
        return Err("parse panicked (strict)");
    }
    Ok(())
}

#[test]
fn no_panic_on_adversarial_input() {
    let iters: u64 = std::env::var("LIMA_FUZZ_ITERS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20_000);
    let base_seed: u64 = std::env::var("LIMA_FUZZ_SEED")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| {
            use std::time::{SystemTime, UNIX_EPOCH};
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(0x9E37_79B9_7F4A_7C15);
            nanos ^ 0x9E37_79B9_7F4A_7C15
        });

    let mut rng = Rng::new(base_seed);
    for i in 0..iters {
        let input = match rng.below(10) {
            0..=2 => random_bytes(&mut rng, 256),
            3..=5 => random_alpha(&mut rng, 400),
            6 => pathological(&mut rng),
            _ => {
                let seed = SEEDS[rng.below(SEEDS.len())];
                mutate(&mut rng, seed)
            }
        };
        if let Err(what) = exercise(&input) {
            let hex: String = input.iter().map(|b| format!("{b:02x}")).collect();
            panic!(
                "{what}\n  iteration : {i}\n  base seed : {base_seed:#018x}\n  \
                 input (lossy): {:?}\n  input (hex)  : {hex}",
                String::from_utf8_lossy(&input),
            );
        }
    }
    eprintln!("fuzz smoke: {iters} iterations, no panic");
}
