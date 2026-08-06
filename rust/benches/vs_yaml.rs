//! Performance comparison against yaml-rust2, Core only (no References/
//! partials — yaml-rust2 has no equivalent concept, so comparing those
//! would not be an apples-to-apples comparison). Mirrors
//! `js/bench/vs-yaml.ts` scenario-for-scenario so the two are directly
//! comparable. Not a CI gate. Run: `cargo bench` (from `rust/`). Add
//! `--json` for machine-readable output (append after `--`:
//! `cargo bench -- --json`).
//!
//! Purpose: yaml-rust2 is the actively maintained YAML 1.2 parser in the
//! Rust ecosystem (serde_yaml was deprecated in 2024) and the natural
//! comparison point for the same reason js-yaml is on the TypeScript side
//! — see that file's doc comment. Differing *output* between the two
//! parsers on the same input is expected and irrelevant here; only
//! relative parse time is being compared.

use lima::parse_core;
use std::env;
use std::time::Instant;
use yaml_rust2::YamlLoader;

const SAMPLES: usize = 25;

struct BenchResult {
    name: String,
    iterations: usize,
    median_us: f64,
    p95_us: f64,
    min_us: f64,
    max_us: f64,
    ops_per_sec: f64,
}

fn time(mut f: impl FnMut(), iterations: usize) -> f64 {
    let start = Instant::now();
    for _ in 0..iterations {
        f();
    }
    (start.elapsed().as_secs_f64() / iterations as f64) * 1_000_000.0
}

fn summarize(name: &str, mut samples: Vec<f64>, iterations: usize) -> BenchResult {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median_us = samples[samples.len() / 2];
    let p95_idx = ((samples.len() as f64 * 0.95).ceil() as usize - 1).min(samples.len() - 1);
    let p95_us = samples[p95_idx];
    BenchResult {
        name: name.to_string(),
        iterations,
        median_us,
        p95_us,
        min_us: samples[0],
        max_us: samples[samples.len() - 1],
        ops_per_sec: 1_000_000.0 / median_us,
    }
}

fn print_result(r: &BenchResult) {
    println!(
        "{:<60} median {:>9.2} us/op  p95 {:>9.2} us/op  {:>9.0} ops/sec",
        r.name, r.median_us, r.p95_us, r.ops_per_sec
    );
}

fn compare(name: &str, doc: &str, iterations: usize, json: bool, results: &mut Vec<BenchResult>) {
    let parse_lima = || {
        parse_core(doc, false).unwrap();
    };
    let parse_yaml = || {
        YamlLoader::load_from_str(doc).unwrap();
    };

    for i in 0..iterations.min(1000) {
        if i % 2 == 0 {
            parse_lima();
        } else {
            parse_yaml();
        }
    }

    let mut lima_samples = Vec::with_capacity(SAMPLES);
    let mut yaml_samples = Vec::with_capacity(SAMPLES);
    let mut speedups = Vec::with_capacity(SAMPLES);
    for sample in 0..SAMPLES {
        // Alternating which parser runs first prevents systematic order
        // bias from CPU frequency changes and background load.
        let (lima_us, yaml_us) = if sample % 2 == 0 {
            let l = time(parse_lima, iterations);
            let y = time(parse_yaml, iterations);
            (l, y)
        } else {
            let y = time(parse_yaml, iterations);
            let l = time(parse_lima, iterations);
            (l, y)
        };
        lima_samples.push(lima_us);
        yaml_samples.push(yaml_us);
        speedups.push(yaml_us / lima_us);
    }

    let lima = summarize(
        &format!("{name} — Lima (parse_core)"),
        lima_samples,
        iterations,
    );
    let yaml = summarize(
        &format!("{name} — yaml-rust2 (YamlLoader)"),
        yaml_samples,
        iterations,
    );
    if !json {
        print_result(&lima);
        print_result(&yaml);
        speedups.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!(
            "  -> paired speedup min {:.2}x, median {:.2}x, max {:.2}x\n",
            speedups[0],
            speedups[speedups.len() / 2],
            speedups[speedups.len() - 1]
        );
    }
    results.push(lima);
    results.push(yaml);
}

/// Joins lines with `\n` and appends a trailing `\n` — avoids fragile
/// backslash-continuation escaping for the indented scenario documents
/// below while keeping their content easy to diff against
/// `js/bench/vs-yaml.ts`.
fn doc(lines: &[&str]) -> String {
    let mut s = lines.join("\n");
    s.push('\n');
    s
}

fn main() {
    let json = env::args().any(|a| a == "--json");
    let mut results = Vec::new();

    // ── Representative frontmatter-shaped documents (Core-only) ──────────
    // Kept identical to js/bench/vs-yaml.ts's six scenarios.

    compare(
        "typical blog post (9 keys, flat)",
        &doc(&[
            "title: My Blog Post",
            "slug: my-blog-post",
            "date: 2024-03-01T09:00:00Z",
            "draft: false",
            "author: Alice",
            "tags: [javascript, webdev, tutorial]",
            "excerpt: A short excerpt about the post, nothing fancy.",
            "readingTime: 4.5",
            "category: Engineering",
        ]),
        20000,
        json,
        &mut results,
    );

    compare(
        "nested author + block array of tags",
        &doc(&[
            "title: My Blog Post",
            "date: 2024-03-01",
            "draft: false",
            "author:",
            "  name: Alice",
            "  email: alice@example.com",
            "tags:",
            "  - javascript",
            "  - webdev",
            "  - tutorial",
        ]),
        20000,
        json,
        &mut results,
    );

    compare(
        "SEO-heavy frontmatter (nested mapping, many string fields)",
        &doc(&[
            "title: My Blog Post",
            "description: A longer description used for SEO meta tags and social previews.",
            "seo:",
            "  title: My Blog Post | My Site",
            "  description: A longer description used for SEO meta tags and social previews.",
            "  image: /images/my-blog-post/cover.png",
            "  canonical: https://example.com/blog/my-blog-post",
            "social:",
            "  twitter: \"@example\"",
            "  ogType: article",
        ]),
        20000,
        json,
        &mut results,
    );

    let wide_array = {
        let mut s = String::from("tags:\n");
        for i in 0..50 {
            s.push_str(&format!("  - tag{i}\n"));
        }
        s
    };
    compare(
        "wide block array (50 tags)",
        &wide_array,
        10000,
        json,
        &mut results,
    );

    let author_list = {
        let mut s = String::from("authors:\n");
        for i in 0..10 {
            s.push_str(&format!(
                "  - name: Author {i}\n    email: author{i}@example.com\n"
            ));
        }
        s
    };
    compare(
        "list of author objects (block sequence of mappings)",
        &author_list,
        10000,
        json,
        &mut results,
    );

    let mixed_keys = {
        let mut s = String::new();
        for i in 0..50 {
            let line = match i % 4 {
                0 => format!("key{i}: {i}\n"),
                1 => format!("key{i}: value {i}\n"),
                2 => format!("key{i}: {}\n", i % 2 == 0),
                _ => format!("key{i}: 2024-0{}-01\n", (i % 9) + 1),
            };
            s.push_str(&line);
        }
        s
    };
    compare(
        "many scalar keys, mixed types (50 keys)",
        &mixed_keys,
        10000,
        json,
        &mut results,
    );

    if json {
        print!("[");
        for (i, r) in results.iter().enumerate() {
            if i > 0 {
                print!(",");
            }
            print!(
                "{{\"name\":{:?},\"iterations\":{},\"medianUs\":{},\"p95Us\":{},\"minUs\":{},\"maxUs\":{},\"opsPerSec\":{}}}",
                r.name, r.iterations, r.median_us, r.p95_us, r.min_us, r.max_us, r.ops_per_sec
            );
        }
        println!("]");
    }
}
